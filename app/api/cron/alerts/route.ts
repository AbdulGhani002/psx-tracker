import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { AlertLogModel, BuyListModel, FundamentalModel, RateSnapshotModel } from "@/lib/models";
import { appOrigin } from "@/lib/auth/mailer";
import { getAppSettings, getCurrentPrices, getPortfolioSummary, getAllHoldings, getUpcomingExDates, getAllUserIds, getShariahStatus, getFeedSnapshot, saveFeedSnapshot, getNetWorth, getEffectiveInflationPct, getFixedIncomeValued, getFbrPack } from "@/lib/data";
import { currentTaxYear } from "@/lib/dates";
import { juneDue, juneMessage } from "@/lib/tax/june";
import { announcedDividendMessage, exDateOf, exDividendMessage } from "@/lib/calculations/exdate";
import { noteAlerts } from "@/lib/analytics/trade-review";
import { pktToday } from "@/lib/quant/sheet-bars";
import { getUsdPkr } from "@/lib/fx";
import { getPriceFreshness } from "@/lib/prices";
import { getFlows, getEarningsCalendar } from "@/lib/analytics";
import { realPct } from "@/lib/calculations/pk-tax";
import { getDecisionInbox, getSellDiscipline } from "@/lib/data-decisions";
import { runAsUser } from "@/lib/auth/current-user";
import { uid } from "@/lib/auth/uid";
import { sendTelegram } from "@/lib/notify/telegram";
import { getStrategy, getRatesPrefill } from "@/lib/strategy/data";
import { kseStepMessage, maturityMessage } from "@/lib/strategy/alerts";
import { buyListAlerts } from "@/lib/buy-list/data";
import { ruleAlerts } from "@/lib/rules/data";
import { getIndexForecasts, weekMessage, weekMessageDue } from "@/lib/index-week/data";
import { cronAuthorised } from "@/lib/auth/cron";
import { dailyBriefForCurrentUser } from "@/lib/daily-brief";
import { missedReviewForCurrentUser } from "@/lib/missed-trades";
import { monthScore } from "@/lib/scorecard";
import { scoreMessage } from "@/lib/calculations/scorecard";
import { getPrinciples } from "@/lib/principles";
import { marketEvents, marketHolidays, missedDecision } from "@/lib/market-calendar";
import { eventsMessage, missedMpcMessage, nextTradingDay, policyMessage } from "@/lib/calculations/market-calendar";
import { freshPolicyStep } from "@/lib/market-history";
import { rolledMessage } from "@/lib/fixed-income/rollover";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Candidate = { key: string; message: string };

// Which alerts this user wants. Every candidate carries a key whose prefix
// says what it is, so one filter at the end decides what goes out instead of
// nine scattered conditions.
const PRICE_KEYS = ["drift", "near-ceiling", "near-buy", "fipi", "kmi-drop", "sellsig"];
// The user's own lists and rules: they fire only for what was set on them,
// so they have their own switch, apart from the market alerts above.
const LIST_KEYS = ["buy-zone", "rule", "rules", "index-week", "missed", "principles"];

function wanted(key: string, s: any): boolean {
  const prefix = key.split(":")[0];
  if (prefix === "board") return s.alertBoardMeetings !== false;
  if (prefix === "exdiv" || prefix === "divnew") return s.alertExDates !== false;
  if (prefix === "digest") return s.alertWeeklyDigest !== false;
  if (prefix === "daily") return s.alertDaily !== false;
  if (prefix === "scorecard") return s.alertWeeklyDigest !== false;
  if (prefix === "events" || prefix === "policy" || prefix === "policy-missed") return s.alertEvents !== false;
  if (PRICE_KEYS.includes(prefix)) return s.alertPrices !== false;
  if (LIST_KEYS.includes(prefix)) return s.alertLists !== false;
  return true;
}

// Scheduled timer hits this. Runs the alert check for EVERY user (each with
// their own Telegram config, buy list, holdings) and pushes deduped alerts.
export async function POST(req: Request) {
  // Machine-only: a logged-in session must not reach this. See lib/auth/cron.ts.
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  // Optional body {forceDigest:true} sends the weekly digest NOW (machine-only
  // endpoint, so this is an operator control, not a user surface).
  const force = await req.json().then((b) => b?.forceDigest === true).catch(() => false);
  const userIds = await getAllUserIds();
  let sent = 0;
  for (const uid of userIds) {
    const r = (await runAsUser(uid, () => runAlertsForCurrentUser(force))) as { sent?: number } | undefined;
    sent += r?.sent ?? 0;
  }
  // Deliberately aggregate-only: keying the response by user id leaked the whole
  // roster (and who has Telegram configured) to anyone who could call this.
  return NextResponse.json({ ok: true, users: userIds.length, sent });
}

// Checks buy-list tiers + rebalance drift + upcoming ex-dates and the rest for
// the CURRENT user, pushing deduped Telegram alerts (each key fires once).
async function runAlertsForCurrentUser(forceDigest = false) {
  const settings: any = await getAppSettings();
  const token = settings.telegramBotToken ?? "";
  const chatId = settings.telegramChatId ?? "";
  if (!settings.alertsEnabled || !token || !chatId) {
    return { skipped: true, reason: "alerts_disabled_or_unconfigured" };
  }

  const today = new Date().toISOString().slice(0, 10);
  const candidates: Candidate[] = [];

  // 2. Rebalance drift (position beyond its band)
  //    One message a week listing everything out of band, not one message per
  //    name per night. Drift is slow; seven separate pings every evening about
  //    the same seven positions was noise that trained the reader to ignore the
  //    channel, and the buy-zone hits were drowning in it.
  const [summary, holdings] = await Promise.all([getPortfolioSummary(), getAllHoldings()]);
  const bandBySymbol = new Map(holdings.map((h) => [h.symbol, (h as any).rebalanceBand ?? 3]));
  const drifted: string[] = [];
  for (const p of summary.positions) {
    if (p.shares <= 0 || p.targetPercent <= 0) continue;
    const band = bandBySymbol.get(p.symbol) ?? 3;
    if (Math.abs(p.deviation) > band) {
      const dir = p.deviation > 0 ? "over" : "under";
      drifted.push(`${p.symbol} ${dir} — ${p.currentPercent.toFixed(1)}% vs ${p.targetPercent}% (±${band}%)`);
    }
  }
  if (drifted.length > 0) {
    candidates.push({
      key: `drift:all:${isoWeekKey(new Date())}`,
      message: `⚖️ <b>Out of band this week</b> (${drifted.length}):\n` + drifted.map((d) => `   ${d}`).join("\n"),
    });
  }

  // 3. Upcoming ex-dividend / book-closure (next 14 days). Deduped by symbol+date
  //    so each entitlement is announced once, not every day. The ex-date is
  //    two trading days before the book closure; one that only came to light
  //    after it is still told, as gone ex, with what the shares held earn.
  let exDatesAhead: Awaited<ReturnType<typeof getUpcomingExDates>> = [];
  try {
    const exDates = await getUpcomingExDates(14);
    exDatesAhead = exDates;
    const heldBy = new Map([...summary.positions, ...summary.parked].map((p) => [p.symbol, p.shares]));
    const divTax = settings.filerStatus === "non-filer" ? Number(settings.dividendWhtNonFiler ?? 30) : Number(settings.dividendWhtFiler ?? 15);
    const pkToday = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    for (const e of exDates) {
      candidates.push({
        key: `exdiv:${e.symbol}:${e.date}`,
        message: exDividendMessage({ symbol: e.symbol, bookClosure: e.date, pctOfFace: e.pctOfFace, faceValue: e.faceValue }, heldBy.get(e.symbol) ?? 0, divTax, pkToday),
      });
    }
  } catch {
    /* best-effort */
  }

  // 3b. A dividend declared by a share on the buy list that is not held,
  //     while a day to buy it is left: once per book closure.
  try {
    const held = new Set([...summary.positions, ...summary.parked].filter((p) => p.shares > 0).map((p) => p.symbol));
    const listed = ((await BuyListModel.find({ userId: await uid() }, { symbol: 1 }).lean()) as any[]).map((r) => String(r.symbol)).filter((s) => !held.has(s));
    if (listed.length > 0) {
      const pkDay = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 5 * 3600_000 + 60 * 86400000).toISOString().slice(0, 10);
      const [funds, prices] = await Promise.all([FundamentalModel.find({ symbol: { $in: listed } }, { symbol: 1, faceValue: 1, payouts: 1 }).lean() as Promise<any[]>, getCurrentPrices(listed).catch(() => new Map<string, number>())]);
      for (const f of funds) {
        for (const p of f.payouts ?? []) {
          if (p.payoutType !== "cash" || !p.bookClosure || !(p.pctOfFace > 0) || p.bookClosure < pkDay || p.bookClosure > end) continue;
          const msg = announcedDividendMessage({ symbol: f.symbol, bookClosure: p.bookClosure, pctOfFace: p.pctOfFace, faceValue: f.faceValue ?? 10, cycle: p.cycle ?? "" }, prices.get(f.symbol) ?? null, pkDay);
          if (msg) candidates.push({ key: `divnew:${f.symbol}:${p.bookClosure}`, message: msg });
        }
      }
    }
  } catch {
    /* no buy-list dividend this run */
  }

  // 4. The buy list (lib/buy-list): a share whose day's low got to one of
  //    its tiers on a closing file kept since the last run. Each tier once,
  //    until it arms again.
  try {
    for (const c of await buyListAlerts(await uid())) candidates.push(c);
  } catch {
    /* no buy-list alert this run */
  }

  // 4.3 The price rules (lib/rules): a held share whose close reached one of
  //     the user's add or sell steps from its average price, with the checks
  //     on what changed since it was bought.
  try {
    for (const c of await ruleAlerts(await uid())) candidates.push(c);
  } catch {
    /* no rule alert this run */
  }

  // 4.5 Plan proximity: your OWN pre-committed levels, approaching. The price
  //     trigger fires AT the ceiling; this is the heads-up 3% out, so the
  //     decision gets thought about before the day it's due. Fires only where
  //     a plan exists (levels are never guessed), skips week-old prices, and
  //     re-arms weekly.
  try {
    const { positions } = await getSellDiscipline();
    const withPlans = positions.filter((p) => p.signal.fairValueHigh != null || p.signal.fairValueLow != null);
    if (withPlans.length > 0) {
      const fresh = await getPriceFreshness(withPlans.map((p) => p.signal.symbol));
      const week = isoWeekKey(new Date());
      for (const p of withPlans) {
        const s = p.signal;
        if (s.price <= 0) continue;
        const f = fresh.get(s.symbol);
        if (f && f.ageDays >= 7) continue;
        if (s.fairValueHigh != null && s.price < s.fairValueHigh && s.price >= s.fairValueHigh * 0.97) {
          candidates.push({
            key: `near-ceiling:${s.symbol}:${week}`,
            message: `📏 <b>${s.symbol}</b> Rs ${s.price.toFixed(2)} is within 3% of YOUR Rs ${s.fairValueHigh} ceiling. Decide the trim before the day it hits.`,
          });
        }
        if (s.fairValueLow != null && s.price > s.fairValueLow && s.price <= s.fairValueLow * 1.03) {
          candidates.push({
            key: `near-buy:${s.symbol}:${week}`,
            message: `📏 <b>${s.symbol}</b> Rs ${s.price.toFixed(2)} is within 3% of YOUR Rs ${s.fairValueLow} buy level.`,
          });
        }
      }
    }
  } catch {
    /* discipline data unavailable — skip */
  }

  // 5. Foreign-flow streaks (FIPI): sustained foreign buying/selling is a
  //    regime signal. Fires only as the streak crosses 3/5/7/10 sessions.
  try {
    const flows = await getFlows(30);
    if (flows && [3, 5, 7, 10].includes(flows.streak) && flows.streak_side !== "flat") {
      const emoji = flows.streak_side === "buying" ? "🟩" : "🟥";
      candidates.push({
        key: `fipi:${flows.streak_side}:${flows.streak}:${flows.latest}`,
        message: `${emoji} Foreigners net ${flows.streak_side} <b>${flows.streak} sessions straight</b> (latest ${flows.fipi_today >= 0 ? "+" : ""}$${Math.abs(flows.fipi_today).toFixed(1)}m)`,
      });
    }
  } catch {
    /* analytics down — skip */
  }

  // 6. KMI drop-outs: a held share leaving the Meezan-screened KMI universe is
  //    exactly the moment a Shariah-conscious holder must act (exit/purify), and
  //    the semi-annual recomposition is otherwise silent. We diff against the
  //    last KNOWN membership snapshot; when the market-watch feed is down every
  //    row reads null and we skip entirely — a data outage must never read as
  //    "everything left the index".
  try {
    const sh = await getShariahStatus();
    const known = sh.holdings.filter((h) => h.compliant !== null && h.shares > 0);
    if (known.length > 0) {
      const myKey = `kmiMembers:${await uid()}`;
      const prev = await getFeedSnapshot<string[]>(myKey);
      const cur = known.filter((h) => h.compliant === true).map((h) => h.symbol);
      const curSet = new Set(cur);
      const month = today.slice(0, 7);
      for (const sym of prev.data ?? []) {
        const stillTracked = known.some((h) => h.symbol === sym);
        if (stillTracked && !curSet.has(sym)) {
          candidates.push({
            key: `kmi-drop:${sym}:${month}`,
            message: `🕌 <b>${sym}</b> has left the KMI Shariah universe (index recomposition). Review it: exit or purify per your policy — see the Shariah page.`,
          });
        }
      }
      await saveFeedSnapshot(myKey, cur, "ok", `${cur.length} compliant holdings`).catch(() => {});
    }
  } catch {
    /* shariah data unavailable — skip, never guess membership */
  }

  // 7. Board meetings for HELD stocks in the next 7 days — the one date an
  //    investor must not miss. From the PSX announcements the analytics service
  //    already collects. Deduped per meeting, so it pings once, not daily.
  let boardAhead: Array<{ symbol: string; date: string; purpose: string }> = [];
  try {
    const cal = await getEarningsCalendar();
    const heldSet = new Set(summary.positions.filter((x) => x.shares > 0).map((x) => x.symbol));
    const weekOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    boardAhead = (cal?.upcoming ?? []).filter((e) => heldSet.has(e.symbol) && e.date >= today && e.date <= weekOut);
    for (const e of boardAhead) {
      candidates.push({
        key: `board:${e.symbol}:${e.date}`,
        message: `📋 <b>${e.symbol}</b> board meeting ${e.date} — ${String(e.purpose || "announcement").slice(0, 90)}`,
      });
    }
  } catch {
    /* calendar unavailable — skip */
  }

  // 7.5 Sell-discipline: fired triggers, expired cash, due re-buy reviews —
  //     each becomes a Telegram nag, re-armed WEEKLY until a decision is logged
  //     (the suppression window lives in the engine, the weekly re-nag here).
  let decisionCards = 0;
  try {
    const inbox = await getDecisionInbox();
    decisionCards = inbox.cards.filter((c) => c.severity === "action").length + inbox.reviewsDue.length;
    const week = isoWeekKey(new Date());
    for (const card of inbox.cards) {
      if (card.severity !== "action") continue;
      candidates.push({
        key: `sellsig:${card.type}:${card.symbol}:${week}`,
        message: `🧭 ${card.message}\n→ Clear it on the Decisions page — sell, trim, or log "hold" with your reasoning.`,
      });
    }
  } catch {
    /* discipline data unavailable — skip */
  }

  // The KSE-100 reaching one of the strategy's buy zones (past lows, a bad
  // quarter, cheap against T-bills: lib/strategy/zones.ts), on the last
  // close. Not the model's zone: it moves with each close. Once per zone per
  // fall: the high's date names the fall, so a new high starts them again.
  // Zones passed on the way to a lower one, and those already reached when
  // this first ran, are logged without a message.
  const s = await getStrategy().catch(() => null);
  try {
    const k = s?.kse;
    if (s && k && Date.now() - Date.parse(k.asOf + "T00:00:00Z") < 5 * 86400000) {
      const me = await uid();
      const reached = s.plan.tranches.filter((t) => t.due && t.kind !== "model");
      // Each zone's own name in the key: its kind, numbered when two share
      // one (the nearest past lows "support", the deeper "support2").
      const count: Record<string, number> = {};
      const tag = new Map<number, string>();
      for (const t of s.plan.tranches) {
        count[t.kind] = (count[t.kind] ?? 0) + 1;
        tag.set(t.n, t.kind === "level" ? String(t.n) : count[t.kind] > 1 ? `${t.kind}${count[t.kind]}` : t.kind);
      }
      const keyOf = (t: (typeof reached)[number]) => `kse-zone:${k.highDate}:${tag.get(t.n)}`;
      const quiet = (t: (typeof reached)[number]) => AlertLogModel.updateOne({ userId: me, dedupeKey: keyOf(t) }, { $setOnInsert: { kind: "kse-zone", message: "" } }, { upsert: true }).catch(() => {});
      const logged = reached.length ? new Set(((await AlertLogModel.find({ userId: me, dedupeKey: { $in: reached.map(keyOf) } }, { dedupeKey: 1 }).lean()) as any[]).map((d) => d.dedupeKey)) : new Set<string>();
      const newly = reached.filter((t) => !logged.has(keyOf(t)));
      if (!(await AlertLogModel.exists({ userId: me, dedupeKey: "kse-zone:armed" }))) {
        for (const t of newly) await quiet(t);
        await AlertLogModel.create({ userId: me, dedupeKey: "kse-zone:armed", kind: "kse-zone", message: "" }).catch(() => {});
      } else if (newly.length > 0) {
        for (const t of newly.slice(0, -1)) await quiet(t);
        candidates.push({ key: keyOf(newly[newly.length - 1]), message: `${kseStepMessage(s.plan, k, newly.map((t) => t.n))}\n   ${appOrigin()}/strategy` });
      }
    }
  } catch {
    /* no zone alert this run */
  }

  // The June tax check (lib/tax/june.ts): once, from 1 June, before the tax
  // year closes: the gains and CGT so far and the shares under cost.
  try {
    if (juneDue(pktToday())) {
      const cur = currentTaxYear();
      const pack = await getFbrPack(cur.endYear);
      const losers = [...summary.positions, ...summary.parked].filter((p) => p.shares > 0 && p.priceKnown && p.unrealizedPL < 0).map((p) => ({ symbol: p.symbol, open: p.unrealizedPL, parked: p.parked }));
      candidates.push({ key: `june-tax:${cur.label}`, message: juneMessage({ label: cur.label, netGain: pack.cgt.netGain, cgt: pack.cgt.cgt, ratePct: pack.cgt.rate, dividendsNet: pack.divTotals.net, dividendTax: pack.divTotals.wht, losers }, `${appOrigin()}/portfolio?tab=cgt`) });
    }
  } catch {
    /* no tax check this run */
  }

  // Reasons typed on buys and sales, shown back three months and a year on
  // with what the price has done since (lib/notes).
  try {
    for (const c of await noteAlerts()) candidates.push(c);
  } catch {
    /* no note reminder this run */
  }

  // The model's week (lib/index-week): once the week's last close is in, the
  // indexes' levels for the week ahead and how this week's range did.
  try {
    const f = await getIndexForecasts();
    const key = weekMessageDue(f);
    const msg = f && key ? weekMessage(f, appOrigin()) : null;
    if (key && msg) candidates.push({ key, message: msg });
  } catch {
    /* no model message this run */
  }

  // A T-bill or sukuk maturing: a week before and the day before, with the
  // month's rates to buy again at. A deposit that rolls over is not money
  // coming back: its new term is told when it opens.
  try {
    const all = await getFixedIncomeValued();
    for (const f of all.filter((x) => x.rolledFrom && x.purchaseDate >= new Date(Date.now() + 5 * 3600_000 - 3 * 86400000).toISOString().slice(0, 10))) {
      candidates.push({ key: `rolled:${f._id}`, message: rolledMessage({ name: f.name, cost: f.cost, ratePct: f.couponPct, to: f.maturityDate, estimated: !/rate sheet/.test(f.notes) }) });
    }
    const soon = all.filter((f) => !f.matured && f.daysLeft <= 7 && !f.rollover);
    if (soon.length > 0) {
      const prefill = await getRatesPrefill().catch(() => null);
      for (const f of soon) {
        candidates.push({ key: `maturity:${f._id}:${f.daysLeft <= 1 ? "1d" : "7d"}`, message: maturityMessage(f, prefill?.values ?? null, prefill?.entered ?? false) });
      }
    }
  } catch {
    /* no maturity reminder this run */
  }

  // 8. Friday weekly digest (Pakistan time) — the portfolio's week in one
  //    message. Every number is the same live figure the site shows; the real
  //    return uses the PBS CPI feed. Deduped by ISO week.
  try {
    const pktDay = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", weekday: "short" }).format(new Date());
    if (forceDigest || pktDay === "Fri") {
      const [netWorth, inf, usdPkr] = await Promise.all([
        getNetWorth().catch(() => null),
        getEffectiveInflationPct().catch(() => ({ pct: null as number | null, source: "none", period: null })),
        getUsdPkr().catch(() => null),
      ]);
      const held = summary.positions.filter((x) => x.shares > 0 && x.priceKnown);
      const best = [...held].sort((a, b) => b.unrealizedPct - a.unrealizedPct)[0];
      const worst = [...held].sort((a, b) => a.unrealizedPct - b.unrealizedPct)[0];
      const lines: string[] = ["📬 <b>Weekly digest</b>"];
      if (netWorth) {
        const usd = usdPkr ? ` (≈ $${Math.round(netWorth.total / usdPkr).toLocaleString()})` : "";
        lines.push(`Net worth <b>Rs ${Math.round(netWorth.total).toLocaleString()}</b>${usd} — equities ${Math.round(netWorth.equity).toLocaleString()}, cash ${Math.round(netWorth.cash).toLocaleString()}${netWorth.equityFunds > 0 ? `, equity funds ${Math.round(netWorth.equityFunds).toLocaleString()}` : ""}${netWorth.sukuks > 0 ? `, sukuks ${Math.round(netWorth.sukuks).toLocaleString()}` : ""}`);
      }
      const plPct = summary.totalCost > 0 ? (summary.unrealizedPL / summary.totalCost) * 100 : null;
      lines.push(`Unrealised ${summary.unrealizedPL >= 0 ? "+" : ""}Rs ${Math.round(summary.unrealizedPL).toLocaleString()}${plPct != null ? ` (${plPct >= 0 ? "+" : ""}${plPct.toFixed(1)}%)` : ""} · dividends banked Rs ${Math.round(summary.dividendsTotal).toLocaleString()}`);
      if (summary.xirr != null) {
        const realX = inf.pct != null ? realPct(summary.xirr * 100, inf.pct) : null;
        lines.push(`XIRR ${(summary.xirr * 100).toFixed(1)}%${realX != null ? ` — real ${realX >= 0 ? "+" : ""}${realX.toFixed(1)}% after ${inf.pct!.toFixed(1)}% CPI` : ""}`);
      }
      if (best && worst && best.symbol !== worst.symbol) {
        lines.push(`Best <b>${best.symbol}</b> ${best.unrealizedPct >= 0 ? "+" : ""}${(best.unrealizedPct * 100).toFixed(1)}% · worst <b>${worst.symbol}</b> ${(worst.unrealizedPct * 100).toFixed(1)}%`);
      }
      const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10), weekOn = new Date(Date.now() + 5 * 3600_000 + 7 * 86400000).toISOString().slice(0, 10);
      const exWeek = exDatesAhead.map((e) => ({ symbol: e.symbol, ex: exDateOf(e.date).exDate })).filter((e) => e.ex >= today && e.ex <= weekOn);
      lines.push(exWeek.length ? `Ex-dates (7d): ${exWeek.map((e) => `${e.symbol} ${e.ex.slice(5)}`).join(", ")}` : "Ex-dates (7d): none");
      lines.push(boardAhead.length ? `Board meetings: ${boardAhead.map((e) => `${e.symbol} ${e.date.slice(5)}`).join(", ")}` : "Board meetings (7d): none");
      if (decisionCards > 0) lines.push(`⚠ <b>${decisionCards} decision${decisionCards === 1 ? "" : "s"} waiting</b> on the Decisions page — fired triggers and due reviews don't clear themselves.`);
      candidates.push({ key: `digest:${isoWeekKey(new Date())}`, message: lines.join("\n") });
    }
  } catch {
    /* digest is best-effort — a feed being down must not sink the other alerts */
  }

  // The evening brief: once today's closing file is in, from 17:00 in Karachi
  // (lib/daily-brief). And in a month's first week, the buy list looked back
  // on over the month before (lib/missed-trades).
  const pkNow = new Date(Date.now() + 5 * 3600_000);
  const pkDay = pkNow.toISOString().slice(0, 10);
  if (pkNow.getUTCHours() >= 17 && settings.alertDaily !== false) {
    try {
      const brief = await dailyBriefForCurrentUser(pkDay);
      if (brief) candidates.push({ key: `daily:${pkDay}`, message: brief });
    } catch {
      /* no brief this run */
    }
  }
  // The market's dates up to the next trading day (lib/market-calendar), the
  // evening before.
  if (pkNow.getUTCHours() >= 17 && settings.alertEvents !== false) {
    try {
      const weekOn = new Date(Date.parse(pkDay + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
      const holidays = await marketHolidays();
      const msg = eventsMessage(await marketEvents(pkDay, weekOn), pkDay, holidays);
      // Once for the trading day it leads up to: a Friday's message is not
      // sent again on Saturday and Sunday.
      if (msg) candidates.push({ key: `events:${nextTradingDay(pkDay, holidays)}`, message: msg });
    } catch {
      /* no dates this run */
    }
  }
  // A policy-rate decision caught from the news (lib/market-calendar), once;
  // and a word when an MPC day went by with none found.
  try {
    const step = await freshPolicyStep();
    if (step) candidates.push({ key: `policy:${step.from}`, message: policyMessage(step, step.before) });
    const missed = await missedDecision(pkDay);
    if (missed) candidates.push({ key: `policy-missed:${missed}`, message: missedMpcMessage(missed) });
  } catch {
    /* no decision this run */
  }
  if (pkNow.getUTCDate() <= 7) {
    try {
      const prevMonth = new Date(Date.UTC(pkNow.getUTCFullYear(), pkNow.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
      const review = await missedReviewForCurrentUser(prevMonth);
      if (review) candidates.push({ key: `missed:${prevMonth}`, message: review });
      const sc = await monthScore(prevMonth);
      const line = scoreMessage(sc.label, sc.score);
      if (line) candidates.push({ key: `scorecard:${prevMonth}`, message: line });
    } catch {
      /* no review this run */
    }
  }
  // Each July: read your principles again (or write them).
  if (pkNow.getUTCMonth() === 6) {
    try {
      const p = await getPrinciples();
      const written = Object.values(p.answers).some((a) => a.trim().length > 0);
      candidates.push({
        key: `principles:${pkNow.getUTCFullYear()}`,
        message: written ? `📜 <b>Your principles</b>: a year on, read them again and change what the year taught you. ${appOrigin()}/principles` : `📜 <b>Your principles</b>: eleven questions on how and why you invest, a sentence or two each. ${appOrigin()}/principles`,
      });
    } catch {
      /* no reminder this run */
    }
  }

  // Insert-only dedup: a successful insert means this key is fresh today.
  // Scoped by userId so each user has their own daily dedupe slots.
  const myId = await uid();
  const fresh: Array<{ id: unknown; message: string }> = [];
  for (const c of candidates.filter((c) => wanted(c.key, settings))) {
    try {
      const doc = await AlertLogModel.create({ userId: myId, dedupeKey: c.key, kind: c.key.split(":")[0], message: c.message });
      fresh.push({ id: doc._id, message: c.message });
    } catch {
      /* duplicate — already alerted today */
    }
  }

  if (fresh.length === 0) {
    return { sent: 0, checked: candidates.length };
  }

  // One message, or a few when a busy day runs past Telegram's 4,096
  // characters. An alert whose message did not go out comes off the log, so
  // the next run (half an hour on) sends it again.
  const header = "<b>PSX Portfolio alerts</b>";
  const batches: Array<typeof fresh> = [];
  let size = 0;
  for (const f of fresh) {
    const last = batches[batches.length - 1];
    if (!last || size + 1 + f.message.length > 3900) {
      batches.push([f]);
      size = header.length + 1 + f.message.length;
    } else {
      last.push(f);
      size += 1 + f.message.length;
    }
  }
  let sent = 0;
  let detail: string | undefined;
  for (const b of batches) {
    const r = await sendTelegram(token, chatId, `${header}\n${b.map((f) => f.message).join("\n")}`);
    if (r.ok) sent += b.length;
    else {
      detail = r.detail;
      await AlertLogModel.deleteMany({ _id: { $in: b.map((f) => f.id) } }).catch(() => {});
    }
  }
  return { sent, ok: sent === fresh.length, detail, checked: candidates.length };
}

// ISO-8601 week key, e.g. "2026-W29" — dedupes the digest to once a week.
function isoWeekKey(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y = x.getUTCFullYear();
  const week = Math.ceil(((x.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}
