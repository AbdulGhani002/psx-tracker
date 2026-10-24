// The plan: one view combining what the market is doing, what money is free,
// and what the written rules say to do about it.
//
// Every screen and the weekly report read from here, so the dashboard, the plan
// page and the PDF can never disagree with each other. If they showed different
// numbers the rules would be worthless.

import { connectDb } from "@/lib/db";
import { getCashCalendar } from "@/lib/cash-calendar";
import type { CashCalendar } from "@/lib/calculations/cash-calendar";
import { PlaybookModel } from "@/lib/models/Playbook";
import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  getPortfolioSummary,
  getNetWorth,
  getMutualFundsValued,
  getCashSummary,
  getAppSettings,
  getLadderBuys,
  getFixedIncomeValued,
} from "@/lib/data";
import { runRuleCheck, getFallDistribution, type RuleCheck } from "@/lib/feeds/backtest";
import type { DeployPlan } from "@/lib/calculations/deploy-plan";
import { getAutoSignalsCached } from "@/lib/feeds/regime";
import { scoreRegime, cashCheck, SIGNAL_HINTS, MANUAL_SIGNALS, MANUAL_SIGNAL_DAYS, manualAgeDays, type RegimeSignal, type RegimeVerdict } from "@/lib/calculations/regime";
import { planLadder, ladderVerdict, suggestLadder, reweightLadder, cappedPool, type LadderPlan } from "@/lib/calculations/ladder";
import { fetchUsdPkrSpot } from "@/lib/timeseries/yahoo";

export type CashBreakdown = {
  available: number; // spendable this morning: money-market fund + broker cash + manual "available"
  receivable: number; // owed to you, not landed
  expected: number; // you expect it, no claim yet
  total: number;
  fundValue: number;
  brokerCash: number;
  manualRows: Array<{
    id: string;
    label: string;
    kind: string;
    amount: number;
    currency: string;
    pkr: number;
    expectedDate: string;
    note: string;
  }>;
  fundEarnedPerDay: number;
  fundEarnedWeek: number; // what the funds earned over the last seven days they were held
  usdRate: number;
  // Where the money that counts as available is, and what is locked away
  // (term deposits, T-bills, sukuks) and so not counted until it matures.
  places: Array<{ label: string; pkr: number; yieldPct: number | null }>;
  locked: Array<{ label: string; pkr: number; until: string }>;
};

export type PlanView = {
  regime: RegimeVerdict;
  regimeStale: boolean;
  cash: CashBreakdown;
  cashPct: number;
  cashCheck: ReturnType<typeof cashCheck>;
  ladder: LadderPlan;
  ladderVerdict: ReturnType<typeof ladderVerdict>;
  // A ladder shape drawn from how often the index has actually visited each
  // level, offered when the written one has money parked where the market
  // rarely goes. Empty when there is nothing to say.
  ladderSuggestion: ReturnType<typeof suggestLadder>;
  // The gentler correction: your own levels, reweighted by how often each one
  // actually turns up. Offered first, because the levels are usually the part
  // that was thought about.
  ladderReweight: ReturnType<typeof reweightLadder>;
  // What the ready rupees actually buy. Null when nothing is armed, so the page
  // shows an order list only when there is an order to place.
  ladderBuys: DeployPlan | null;
  // How these same rules would have done against the record. Null when the
  // index history has not been collected yet.
  ruleCheck: RuleCheck | null;
  equityValue: number;
  netWorth: number;
  investable: number;
  // The pool the ladder was armed with, when more than the money there is now
  // (spent outside the ladder since): the rungs are cut from what is left.
  poolCut: { armed: number; armedAt: string; now: number } | null;
  // The next 90 days of money in, dated (dividends, coupons, maturities), and
  // what the price rules' next adds would need. Never counted as cash in hand.
  calendar: CashCalendar | null;
  playbook: {
    indexName: string;
    poolAtArming: number;
    armedAt: string;
    ladderReservePct: number;
    ladderCorePct: number;
    weeklyReportEnabled: boolean;
    weeklyReportEmail: string;
    rungs: Array<{ level: number; pct: number; label: string; firedAt: string; firedAmount: number }>;
    regimeManual: Array<{ key: string; score: number; note: string; setAt: string }>;
    cashSources: CashBreakdown["manualRows"];
  };
};

async function meId(): Promise<string> {
  return (await getCurrentUserId()) ?? "__no_user__";
}

// One playbook per user, created empty on first read so the page always has
// something to render and the user never meets a null.
export async function getPlaybook() {
  await connectDb();
  const userId = await meId();
  let doc = await PlaybookModel.findOne({ userId }).lean();
  if (!doc) {
    await PlaybookModel.create({ userId });
    doc = await PlaybookModel.findOne({ userId }).lean();
  }
  return JSON.parse(JSON.stringify(doc)) as any;
}

export async function savePlaybook(patch: Record<string, unknown>) {
  await connectDb();
  const userId = await meId();
  await PlaybookModel.updateOne({ userId }, { $set: patch }, { upsert: true });
  return getPlaybook();
}

export async function assemblePlan(): Promise<PlanView> {
  const [pb, summary, netWorth, funds, cashSum, settings, auto, fixed] = await Promise.all([
    getPlaybook(),
    getPortfolioSummary().catch(() => null as any),
    getNetWorth().catch(() => null as any),
    getMutualFundsValued().catch(() => [] as any[]),
    getCashSummary().catch(() => null as any),
    getAppSettings().catch(() => ({} as any)),
    getAutoSignalsCached().catch(() => ({ data: null, stale: false })),
    getFixedIncomeValued().catch(() => [] as any[]),
  ]);
  const todayIso = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

  // --- regime ---------------------------------------------------------------
  const autoSignals: RegimeSignal[] = auto.data?.signals ?? [];
  const manualByKey = new Map<string, any>((pb.regimeManual ?? []).map((m: any) => [m.key, m]));
  // A reading set by hand counts for a month: an old judgement must not keep
  // steering the score after the market has moved on. Past that it is shown,
  // not counted, and a live feed for the same signal takes over.
  const manualSignals: RegimeSignal[] = MANUAL_SIGNALS.map((m) => {
    const set = manualByKey.get(m.key);
    const opt = set ? m.options.find((o) => o.score === set.score) : undefined;
    const age = set?.setAt ? manualAgeDays(set.setAt, todayIso) : null;
    const stale = age != null && age > MANUAL_SIGNAL_DAYS;
    return {
      key: m.key,
      label: m.label,
      source: "manual" as const,
      score: set && !stale ? set.score : 0,
      reading: set ? `${opt?.text ?? ""}${set.note ? ` — ${set.note}` : ""}${set.setAt ? ` (set ${set.setAt}${stale ? `, ${age} days ago: not counted` : ""})` : ""}` : "not set",
      known: !!set && !stale,
      hint: SIGNAL_HINTS[m.key] ?? "",
    };
  });
  // Foreign flows and breadth are now fetched AND manually settable, so the two
  // lists overlap. Your judgement wins: a signal you have set overrides the feed
  // for that key, and an unset manual entry never displaces a real reading.
  // Without this both would be counted twice and quietly double-weighted.
  //
  // An override that wins is SAID SO, with the reading it is covering. These
  // scores were set by hand when there was no feed to read, and a stale
  // judgement silently sitting on top of live data is exactly the failure this
  // scorecard exists to prevent.
  const merged = new Map<string, RegimeSignal>();
  for (const s of autoSignals) merged.set(s.key, s);
  for (const s of manualSignals) {
    if (!s.known && merged.has(s.key)) continue;
    const covered = merged.get(s.key);
    merged.set(
      s.key,
      covered?.known
        ? { ...s, overrides: { score: covered.score, reading: covered.reading } }
        : s
    );
  }
  const regime = scoreRegime([...merged.values()]);

  // --- cash ------------------------------------------------------------------
  const usdRate = (await fetchUsdPkrSpot().catch(() => null)) ?? 0;
  const fundValue = (funds as any[]).reduce((s, f) => s + (f.value ?? 0), 0);
  const fundEarnedPerDay = (funds as any[]).reduce((s, f) => s + (f.earnedPerDay ?? 0), 0);
  // The last seven days each fund was actually held: one bought on Friday has
  // earned two days, not a week.
  const fundEarnedWeek = (funds as any[]).reduce((s, f) => {
    const buys = ((f.trades ?? []) as any[]).filter((t) => t.side === "BUY").map((t) => String(t.date)).sort();
    const since = buys.length ? buys[buys.length - 1] : String(f.anchorDate ?? "");
    const days = since ? Math.max(0, Math.min(7, manualAgeDays(since, todayIso))) : 7;
    return s + (f.earnedPerDay ?? 0) * days;
  }, 0);
  const brokerCash = Math.max(0, Number(cashSum?.balance ?? 0));

  const manualRows: CashBreakdown["manualRows"] = ((pb.cashSources ?? []) as any[])
    .filter((c) => !c.settledAt)
    .map((c) => {
      const rate = c.currency === "USD" ? (c.fxRate > 0 ? c.fxRate : usdRate) : 1;
      return {
        id: String(c._id ?? ""),
        label: c.label,
        kind: c.kind,
        amount: c.amount,
        currency: c.currency,
        pkr: c.amount * rate,
        expectedDate: c.expectedDate ?? "",
        note: c.note ?? "",
      };
    });

  const sumKind = (k: string) => manualRows.filter((r) => r.kind === k).reduce((s, r) => s + r.pkr, 0);
  const available = fundValue + brokerCash + sumKind("available");
  const receivable = sumKind("receivable");
  const expected = sumKind("expected");

  const cash: CashBreakdown = {
    available,
    receivable,
    expected,
    total: available + receivable + expected,
    fundValue,
    brokerCash,
    manualRows,
    fundEarnedPerDay,
    fundEarnedWeek,
    usdRate,
    places: [
      ...(funds as any[]).filter((f) => (f.value ?? 0) >= 1).map((f) => ({ label: String(f.name), pkr: Number(f.value), yieldPct: f.liveAnnualYieldPct ?? f.annualYieldPct ?? null })),
      ...(brokerCash >= 1 ? [{ label: "Broker cash", pkr: brokerCash, yieldPct: null }] : []),
      ...manualRows.filter((r) => r.kind === "available").map((r) => ({ label: r.label, pkr: r.pkr, yieldPct: null })),
    ],
    locked: (fixed as any[]).filter((f) => !f.matured && (f.value ?? 0) >= 1).map((f) => ({ label: String(f.name), pkr: Number(f.value), until: String(f.maturityDate) })),
  };

  const equityValue = Number(summary?.totalValue ?? 0);
  const investable = equityValue + available;
  const cashPct = investable > 0 ? (available / investable) * 100 : 0;

  // --- ladder ----------------------------------------------------------------
  // The pool is frozen at arming, so the ladder's own buys never shrink the
  // rungs still to come. But it is never more than the money there is: what
  // has a claim on it now plus what the ladder has already spent. Money spent
  // outside the ladder since arming is gone, and the rungs are cut from what
  // is left. Never armed: the money free right now.
  const firedTotal = ((pb.rungs ?? []) as any[]).reduce((s, r) => s + (r.firedAt ? Number(r.firedAmount) || 0 : 0), 0);
  const withClaim = available + receivable + expected;
  const poolAtArming = cappedPool(Number(pb.poolAtArming) || 0, withClaim, firedTotal);
  const poolCut = pb.poolAtArming > 0 && pb.poolAtArming > poolAtArming + 1 ? { armed: Number(pb.poolAtArming), armedAt: String(pb.armedAt ?? ""), now: poolAtArming } : null;

  // The record of how far the index has fallen below its own high, so each rung
  // can be judged on how often its level actually turns up rather than on how
  // decisive it felt to write down.
  const falls = await getFallDistribution().catch(() => null);
  // Measured from the index's own peak, which is the same peak the distribution
  // counts falls from. Today's level is the wrong reference: it would call a
  // rung shallow simply because the market has already fallen toward it.
  const refHigh = Math.max(falls?.peak ?? 0, auto.data?.indexLevel ?? 0);

  const calendar = await getCashCalendar().catch(() => null);

  const ladder = planLadder({
    indexName: pb.indexName || "KSE-100",
    indexLevel: auto.data?.indexLevel ?? 0,
    indexAsOf: auto.data?.indexAsOf ?? "",
    rungs: (pb.rungs ?? []) as any,
    poolAtArming,
    poolNow: available,
    reservePct: pb.ladderReservePct ?? 10,
    corePct: pb.ladderCorePct ?? 0,
    referenceHigh: refHigh,
    fallDistribution: falls?.dist,
    // Only money with a claim on it can fund a rung. "Expected" is included
    // because it is dated and the plan should say WHEN a rung becomes payable,
    // but it is never counted as cash in hand.
    // The cash calendar's dated money (dividends, coupons, maturities) is
    // added on the same terms.
    fundingSources: [
      ...manualRows.filter((r) => r.kind === "receivable" || r.kind === "expected").map((r) => ({ label: r.label, pkr: r.pkr, expectedDate: r.expectedDate })),
      ...(calendar?.items ?? []).map((x) => ({ label: x.label, pkr: x.pkr, expectedDate: x.date })),
    ],
  });

  // The names the ready money buys, and how the rules have actually performed.
  // Both are best-effort: a failure here must never take the plan down with it,
  // because the ladder verdict above is the part you act on.
  const [ladderBuys, ruleCheck] = await Promise.all([
    ladder.readyAmount > 0 ? getLadderBuys(ladder.readyAmount).catch(() => null) : Promise.resolve(null),
    runRuleCheck({
      rungs: (pb.rungs ?? []) as any,
      reservePct: pb.ladderReservePct ?? 10,
      armedAt: pb.armedAt ?? "",
      // Sized off the real book so the test is about this portfolio, not a
      // textbook one. The monthly figure is what the fund has been growing by.
      startCash: Math.max(50000, Math.round(available)),
      monthlyContribution: Math.max(0, Math.round(fundEarnedPerDay * 30)),
      cashYieldPct: 11,
    }).catch(() => null),
  ]);

  // Only offered when the written ladder actually has a problem. A suggestion
  // shown next to a sound ladder is noise, and noise is how a warning stops
  // being read.
  const offerFix = ladder.deadPct > 0 && !!falls?.dist?.length;
  const ladderSuggestion = offerFix ? suggestLadder(falls!.dist, refHigh, Math.max(2, ladder.rows.length)) : [];
  const ladderReweight = offerFix ? reweightLadder(ladder.rows, falls!.dist, refHigh) : [];

  return {
    regime,
    regimeStale: auto.stale,
    ladderBuys,
    ruleCheck,
    ladderSuggestion,
    ladderReweight,
    cash,
    cashPct,
    cashCheck: cashCheck(regime, cashPct),
    ladder,
    ladderVerdict: ladderVerdict(ladder),
    equityValue,
    netWorth: Number(netWorth?.total ?? 0),
    investable,
    poolCut,
    calendar,
    playbook: {
      indexName: pb.indexName || "KSE-100",
      poolAtArming,
      armedAt: pb.armedAt ?? "",
      ladderReservePct: pb.ladderReservePct ?? 10,
      ladderCorePct: pb.ladderCorePct ?? 0,
      weeklyReportEnabled: !!pb.weeklyReportEnabled,
      weeklyReportEmail: pb.weeklyReportEmail ?? "",
      rungs: (pb.rungs ?? []) as any,
      regimeManual: (pb.regimeManual ?? []) as any,
      cashSources: manualRows,
    },
  };
}
