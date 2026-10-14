import "server-only";
import { connectDb } from "@/lib/db";
import { PriceRulesModel, FundamentalModel } from "@/lib/models";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getPortfolioSummary, getAllTransactions, getDividendForecast, getSbpRateSteps } from "@/lib/data";
import { getUsdPkrSeries } from "@/lib/analytics/dashboard";
import { rateOn } from "@/lib/analytics/dollarized";
import { policyRateOn } from "@/lib/timeseries/sbp-rate";
import { latestCloses, loadSheets, pktToday } from "@/lib/quant/sheet-bars";
import { advanceShare, cleanSteps, DEFAULT_STEPS, holdingSince, movePct, ruleMessage, signedPct, stepText, type Fired, type Step } from "./ladder";
import { checksLine, combine, dividendCheck, moveCheck, profitCheck, usualEpsMove, type Checks } from "./checks";

// The price rules (app/rules): the user's steps applied to every share held
// from its average price, after each closing file kept; what each share
// stands at; and the Telegram alerts, each with the checks on what changed.

export type RuleSettings = { on: boolean; steps: Step[]; ratePts: number; rupeePct: number; off: string[] };

const DEFAULTS: RuleSettings = { on: true, steps: DEFAULT_STEPS, ratePts: 2, rupeePct: 10, off: [] };

export async function getRuleSettings(userId?: string): Promise<RuleSettings & { fired: Fired[] }> {
  await connectDb();
  const id = userId ?? (await getCurrentUserId()) ?? "";
  const d: any = await PriceRulesModel.findOne({ userId: id }).lean();
  if (!d) return { ...DEFAULTS, fired: [] };
  return { on: d.on !== false, steps: cleanSteps(d.steps ?? DEFAULT_STEPS), ratePts: Number(d.ratePts ?? 2), rupeePct: Number(d.rupeePct ?? 10), off: d.off ?? [], fired: (d.fired ?? []) as Fired[] };
}

type Ctx = { usual: number | null; annualOf: Map<string, any[]>; divOf: Map<string, any[]>; rateSteps: Array<{ from: string; rate: number }>; usd: Array<{ date: string; close: number }> };

async function checkContext(): Promise<Ctx> {
  const [forecast, rateSteps, usd, funds] = await Promise.all([
    getDividendForecast().catch(() => null),
    getSbpRateSteps().then((r) => r.steps).catch(() => []),
    getUsdPkrSeries().catch(() => []),
    FundamentalModel.find({}, { symbol: 1, annual: 1 }).lean() as Promise<any[]>,
  ]);
  return {
    usual: usualEpsMove(funds.map((f) => f.annual ?? [])),
    annualOf: new Map(funds.map((f) => [f.symbol, f.annual ?? []])),
    divOf: new Map((forecast?.profiles ?? []).map((p) => [p.symbol, p.byFiscalYear])),
    rateSteps,
    usd,
  };
}

function checksFor(ctx: Ctx, s: RuleSettings, symbol: string, since: string | null, today: string): Checks {
  return combine({
    profit: profitCheck(ctx.annualOf.get(symbol) ?? [], ctx.usual),
    dividend: dividendCheck(ctx.divOf.get(symbol) ?? []),
    rate: since && ctx.rateSteps.length ? moveCheck(policyRateOn(since, ctx.rateSteps), policyRateOn(today, ctx.rateSteps), s.ratePts, false) : null,
    rupee: since && ctx.usd.length ? moveCheck(rateOn(ctx.usd, since), ctx.usd[ctx.usd.length - 1].close, s.rupeePct, true) : null,
  });
}

export type RuleShare = {
  symbol: string;
  shares: number;
  avgCost: number;
  close: number | null;
  closeDate: string | null;
  move: number | null;
  at: Step | null; // the deepest step reached now
  nextAdd: { step: Step; price: number } | null;
  nextSell: { step: Step; price: number } | null;
  told: Fired[];
  checks: Checks;
  since: string | null;
  off: boolean;
  addsOff: boolean; // a 0% target in Rebalance: adds are not told
};

export async function getRuleBoard(): Promise<{ settings: RuleSettings; shares: RuleShare[]; usualPct: number | null; asOf: string | null }> {
  const [settings, summary, txs, closes, ctx] = await Promise.all([getRuleSettings(), getPortfolioSummary(), getAllTransactions(), latestCloses().catch(() => new Map<string, { date: string; close: number }>()), checkContext()]);
  const today = pktToday();
  const targetsInUse = summary.positions.some((p) => p.targetPercent > 0);
  const falls = settings.steps.filter((s) => s.move < 0).sort((a, b) => b.move - a.move);
  const rises = settings.steps.filter((s) => s.move > 0).sort((a, b) => a.move - b.move);
  const shares: RuleShare[] = summary.positions
    .filter((p) => p.shares > 0 && p.avgCost > 0)
    .map((p) => {
      const c = closes.get(p.symbol) ?? null;
      const m = c ? movePct(c.close, p.avgCost) : null;
      const since = holdingSince(txs.filter((t) => t.symbol === p.symbol).map((t) => ({ date: new Date(t.date).toISOString().slice(0, 10), type: t.type, shares: t.shares, ratio: t.ratio ?? "" })));
      const at = m == null ? null : m < 0 ? [...falls].reverse().find((s) => m <= s.move) ?? null : m > 0 ? [...rises].reverse().find((s) => m >= s.move) ?? null : null;
      const add = m == null ? null : falls.find((s) => s.action === "add" && m > s.move) ?? null;
      const sell = m == null ? null : rises.find((s) => s.action === "sell" && m < s.move) ?? null;
      return {
        symbol: p.symbol,
        shares: p.shares,
        avgCost: p.avgCost,
        close: c?.close ?? null,
        closeDate: c?.date ?? null,
        move: m,
        at,
        nextAdd: add ? { step: add, price: p.avgCost * (1 + add.move / 100) } : null,
        nextSell: sell ? { step: sell, price: p.avgCost * (1 + sell.move / 100) } : null,
        told: settings.fired.filter((f) => f.symbol === p.symbol),
        checks: checksFor(ctx, settings, p.symbol, since, today),
        since,
        off: settings.off.includes(p.symbol),
        addsOff: targetsInUse && p.targetPercent <= 0,
      };
    })
    .sort((a, b) => Math.abs(b.move ?? 0) - Math.abs(a.move ?? 0));
  const asOf = [...closes.values()].reduce<string | null>((m, c) => (m == null || c.date > m ? c.date : m), null);
  return { settings, shares, usualPct: ctx.usual, asOf };
}

const nextDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

// Moves the rules on through every closing file not yet applied, then the
// Telegram alerts: each add or sell step told in the last week, one message
// a share a day (the alerts job dedupes them). The first run marks what is
// already reached and sends one summary instead.
export async function ruleAlerts(userId: string): Promise<Array<{ key: string; message: string }>> {
  await connectDb();
  let doc: any = await PriceRulesModel.findOne({ userId }).lean();
  if (!doc) doc = (await PriceRulesModel.create({ userId })).toObject();
  if (doc.on === false) return [];
  const settings: RuleSettings = { on: true, steps: cleanSteps(doc.steps ?? DEFAULT_STEPS), ratePts: Number(doc.ratePts ?? 2), rupeePct: Number(doc.rupeePct ?? 10), off: doc.off ?? [] };
  const summary = await getPortfolioSummary();
  const held = summary.positions.filter((p) => p.shares > 0 && p.avgCost > 0 && !settings.off.includes(p.symbol));
  const today = pktToday();
  const sheets = doc.checkedThrough ? await loadSheets(nextDay(doc.checkedThrough)) : (await loadSheets(new Date(Date.parse(today + "T00:00:00Z") - 10 * 86400000).toISOString().slice(0, 10))).slice(-1);
  let fired: Fired[] = ((doc.fired ?? []) as Fired[]).filter((f) => held.some((p) => p.symbol === f.symbol));
  const quiet = doc.quiet !== false;
  if (sheets.length > 0) {
    for (const p of held) {
      const days = sheets.map((s) => ({ date: s.date, close: s.rows.find((r) => r[0] === p.symbol)?.[4] ?? 0 })).filter((d) => d.close > 0);
      const r = advanceShare(settings.steps, fired, p.symbol, p.avgCost, days, quiet);
      fired = [...fired.filter((f) => f.symbol !== p.symbol), ...r.fired];
    }
    await PriceRulesModel.updateOne({ _id: doc._id, updatedAt: doc.updatedAt }, { $set: { fired, checkedThrough: sheets[sheets.length - 1].date, quiet: false } });
  }

  const out: Array<{ key: string; message: string }> = [];
  if (!doc.started && sheets.length > 0 && held.length > 0) {
    const last = sheets[sheets.length - 1];
    const lines = held
      .map((p) => {
        const close = last.rows.find((r) => r[0] === p.symbol)?.[4] ?? 0;
        if (!(close > 0)) return null;
        const m = movePct(close, p.avgCost);
        const at = fired.filter((f) => f.symbol === p.symbol).sort((a, b) => Math.abs(b.move) - Math.abs(a.move))[0];
        const step = at ? settings.steps.find((s) => s.move === at.move) : null;
        return { m, text: `   ${p.symbol} ${signedPct(m)}${step ? `: ${stepText(step)} (${signedPct(step.move, 0)})` : ""}` };
      })
      .filter((x): x is { m: number; text: string } => x != null)
      .sort((a, b) => a.m - b.m);
    out.push({ key: `rules:start:${last.date}`, message: [`🧭 <b>Price rules are on</b> for ${held.length} shares, from each one's average price:`, ...lines.map((l) => l.text), "   From here Telegram tells you of each add or sell step reached."].join("\n") });
    await PriceRulesModel.updateOne({ _id: doc._id }, { $set: { started: true } });
  }

  const since = new Date(Date.parse(today + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
  const recent = fired.filter((f) => f.told && f.at >= since);
  if (recent.length === 0) return out;
  const targetsInUse = summary.positions.some((p) => p.targetPercent > 0);
  const [ctx, txs] = await Promise.all([checkContext(), getAllTransactions()]);
  const groups = new Map<string, Fired[]>();
  for (const f of recent) (groups.get(`${f.symbol}|${f.at}`) ?? groups.set(`${f.symbol}|${f.at}`, []).get(`${f.symbol}|${f.at}`)!).push(f);
  for (const [k, list] of groups) {
    const [symbol, date] = k.split("|");
    const p = held.find((x) => x.symbol === symbol);
    if (!p) continue;
    let steps = list.map((f) => settings.steps.find((s) => s.move === f.move)).filter((s): s is Step => s != null && s.action !== "hold");
    if (targetsInUse && p.targetPercent <= 0) steps = steps.filter((s) => s.action !== "add");
    if (steps.length === 0) continue;
    const startedOn = holdingSince(txs.filter((t) => t.symbol === symbol).map((t) => ({ date: new Date(t.date).toISOString().slice(0, 10), type: t.type, shares: t.shares, ratio: t.ratio ?? "" })));
    const checks = checksLine(checksFor(ctx, settings, symbol, startedOn, today));
    const f0 = list[0];
    out.push({ key: `rule:${symbol}:${steps.map((s) => s.move).join(",")}:${date}`, message: ruleMessage({ symbol, date, close: f0.close, move: movePct(f0.close, f0.anchor), steps }, { shares: p.shares, avgCost: f0.anchor }, checks) });
  }
  return out;
}

// Saving the rules: what is already reached is marked again without a
// message at the next run.
export async function saveRuleSettings(userId: string, s: Partial<RuleSettings>): Promise<void> {
  await connectDb();
  const set: Record<string, unknown> = {};
  if (s.steps) set.steps = cleanSteps(s.steps);
  if (s.on != null) set.on = s.on;
  if (s.ratePts != null) set.ratePts = s.ratePts;
  if (s.rupeePct != null) set.rupeePct = s.rupeePct;
  if (s.off) set.off = [...new Set(s.off.map((x) => x.toUpperCase()))];
  if (s.steps || s.on != null) Object.assign(set, { fired: [], quiet: true, checkedThrough: "" });
  await PriceRulesModel.updateOne({ userId }, { $set: set }, { upsert: true });
}
