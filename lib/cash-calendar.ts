import "server-only";
import { connectDb } from "@/lib/db";
import { FixedIncomeModel, FundamentalModel, PlaybookModel, ShareEventModel, TransactionModel } from "@/lib/models";
import { getAppSettings, getCashSummary, getMutualFundsValued, getPortfolioSummary } from "@/lib/data";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getRuleBoard } from "@/lib/rules/data";
import { fixedIncomeEvents, type FixedIncomeHolding } from "@/lib/fixed-income/value";
import { faceOf } from "@/lib/calculations/face-value";
import { buildCashCalendar, dividendItems, fixedItems, ruleNeeds, type CashCalendar } from "@/lib/calculations/cash-calendar";
import { sharesEntitled } from "@/lib/calculations/corporate-actions";
import { marketHolidays } from "@/lib/market-calendar";

// The cash calendar for the current user (lib/calculations/cash-calendar):
// cash now as the weekly plan counts it (the funds, broker cash and what you
// marked available), the dividends of every share held (parked ones too),
// the T-bills', sukuks' and deposits' coupons and maturities, and the price
// rules' next adds.

const DAY = 86400000;
const pkToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const back = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") - n * DAY).toISOString().slice(0, 10);

export async function getCashCalendar(days = 90): Promise<CashCalendar> {
  await connectDb();
  const userId = (await getCurrentUserId()) ?? "";
  const today = pkToday();
  const [summary, funds, cashSum, settings, pb, fixedDocs, rules] = await Promise.all([
    getPortfolioSummary(),
    getMutualFundsValued().catch(() => [] as any[]),
    getCashSummary().catch(() => null as any),
    getAppSettings().catch(() => ({}) as any),
    PlaybookModel.findOne({ userId }, { cashSources: 1 }).lean() as Promise<any>,
    FixedIncomeModel.find({ userId, maturityDate: { $gt: today } }).lean() as Promise<any[]>,
    getRuleBoard().catch(() => null),
  ]);

  const available = ((pb?.cashSources ?? []) as any[]).filter((c) => !c.settledAt && c.kind === "available").reduce((s, c) => s + Number(c.amount) * (c.currency === "USD" ? Number(c.fxRate) || 0 : 1), 0);
  const cashNow = (funds as any[]).reduce((s, f) => s + (f.value ?? 0), 0) + Math.max(0, Number(cashSum?.balance ?? 0)) + available;

  const from = back(today, 30);
  const [txs, holidays] = await Promise.all([TransactionModel.find({ userId, deletedAt: null }).sort({ date: 1, createdAt: 1 }).lean() as Promise<any[]>, marketHolidays().catch(() => new Set<string>())]);
  const recorded = txs.filter((t) => t.type === "DIVIDEND" && new Date(t.date).toISOString().slice(0, 10) >= from);
  // A dividend is owed on shares sold since its book closure, so those names count too.
  const symbols = [...new Set([...[...summary.positions, ...summary.parked].filter((p) => p.shares > 0).map((p) => p.symbol), ...recorded.map((t) => String(t.symbol))])];
  const [fundamentals, events] = await Promise.all([
    FundamentalModel.find({ symbol: { $in: symbols } }, { symbol: 1, faceValue: 1, payouts: 1 }).lean() as Promise<any[]>,
    ShareEventModel.find({ symbol: { $in: symbols }, kind: "cash", date: { $gte: back(from, 15) } }, { symbol: 1, date: 1, cash: 1 }).lean() as Promise<any[]>,
  ]);
  const payouts = fundamentals.flatMap((f) =>
    ((f.payouts ?? []) as any[])
      .filter((p) => p.payoutType === "cash" && p.bookClosure && p.bookClosure >= from && p.pctOfFace > 0)
      .map((p) => ({
        symbol: String(f.symbol),
        bookClosure: String(p.bookClosure),
        pctOfFace: Number(p.pctOfFace),
        face: faceOf(p, events.filter((e) => e.symbol === f.symbol).map((e) => ({ date: String(e.date), cash: Number(e.cash) })))?.face ?? Number(f.faceValue ?? 10),
        cycle: String(p.cycle ?? ""),
      }))
  );
  const taxPct = settings?.filerStatus === "non-filer" ? Number(settings?.dividendWhtNonFiler ?? 30) : Number(settings?.dividendWhtFiler ?? 15);
  const dividends = dividendItems({
    today,
    days,
    taxPct,
    entitled: (symbol, bookClosure) => sharesEntitled(txs, symbol, bookClosure, holidays),
    payouts,
    recorded: recorded.map((r) => ({ symbol: String(r.symbol), date: new Date(r.date).toISOString().slice(0, 10), net: Number(r.netAmount) || 0, auto: r.source === "auto" })),
  });
  const fixed = fixedItems({
    today,
    days,
    holdings: fixedDocs.map((d) => {
      const h: FixedIncomeHolding = { kind: d.kind, name: d.name, face: d.face, cost: d.cost, purchaseDate: d.purchaseDate, maturityDate: d.maturityDate, couponPct: d.couponPct ?? 0, couponsPerYear: d.couponsPerYear ?? 0, taxPct: d.taxPct ?? 15 };
      return { name: String(d.name), face: Number(d.face), cost: Number(d.cost), rollover: String(d.rollover ?? ""), maturityDate: String(d.maturityDate), events: fixedIncomeEvents(h) };
    }),
  });
  const needs = ruleNeeds(
    (rules?.settings.on ? rules.shares : []).map((s) => ({ symbol: s.symbol, shares: s.shares, off: s.off, addsOff: s.addsOff, nextAdd: s.nextAdd ? { move: s.nextAdd.step.move, sizePct: s.nextAdd.step.sizePct, price: s.nextAdd.price } : null }))
  );
  return buildCashCalendar({ today, days, cashNow, items: [...dividends, ...fixed], needs });
}
