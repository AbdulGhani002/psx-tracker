// The plan: one view combining what the market is doing, what money is free,
// and what the written rules say to do about it.
//
// Every screen and the weekly report read from here, so the dashboard, the plan
// page and the PDF can never disagree with each other. If they showed different
// numbers the rules would be worthless.

import { connectDb } from "@/lib/db";
import { PlaybookModel } from "@/lib/models/Playbook";
import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  getPortfolioSummary,
  getNetWorth,
  getMutualFundsValued,
  getCashSummary,
  getAppSettings,
  getLadderBuys,
} from "@/lib/data";
import { runRuleCheck, type RuleCheck } from "@/lib/feeds/backtest";
import type { DeployPlan } from "@/lib/calculations/deploy-plan";
import { getAutoSignalsCached } from "@/lib/feeds/regime";
import { scoreRegime, cashCheck, SIGNAL_HINTS, MANUAL_SIGNALS, type RegimeSignal, type RegimeVerdict } from "@/lib/calculations/regime";
import { planLadder, ladderVerdict, type LadderPlan } from "@/lib/calculations/ladder";
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
  fundEarnedWeek: number;
  usdRate: number;
};

export type PlanView = {
  regime: RegimeVerdict;
  regimeStale: boolean;
  cash: CashBreakdown;
  cashPct: number;
  cashCheck: ReturnType<typeof cashCheck>;
  ladder: LadderPlan;
  ladderVerdict: ReturnType<typeof ladderVerdict>;
  // What the ready rupees actually buy. Null when nothing is armed, so the page
  // shows an order list only when there is an order to place.
  ladderBuys: DeployPlan | null;
  // How these same rules would have done against the record. Null when the
  // index history has not been collected yet.
  ruleCheck: RuleCheck | null;
  equityValue: number;
  netWorth: number;
  investable: number;
  playbook: {
    indexName: string;
    poolAtArming: number;
    armedAt: string;
    ladderReservePct: number;
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
  const [pb, summary, netWorth, funds, cashSum, settings, auto] = await Promise.all([
    getPlaybook(),
    getPortfolioSummary().catch(() => null as any),
    getNetWorth().catch(() => null as any),
    getMutualFundsValued().catch(() => [] as any[]),
    getCashSummary().catch(() => null as any),
    getAppSettings().catch(() => ({} as any)),
    getAutoSignalsCached().catch(() => ({ data: null, stale: false })),
  ]);

  // --- regime ---------------------------------------------------------------
  const autoSignals: RegimeSignal[] = auto.data?.signals ?? [];
  const manualByKey = new Map<string, any>((pb.regimeManual ?? []).map((m: any) => [m.key, m]));
  const manualSignals: RegimeSignal[] = MANUAL_SIGNALS.map((m) => {
    const set = manualByKey.get(m.key);
    const opt = set ? m.options.find((o) => o.score === set.score) : undefined;
    return {
      key: m.key,
      label: m.label,
      source: "manual" as const,
      score: set?.score ?? 0,
      reading: set ? `${opt?.text ?? ""}${set.note ? ` — ${set.note}` : ""}${set.setAt ? ` (set ${set.setAt})` : ""}` : "not set",
      known: !!set,
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
    fundEarnedWeek: fundEarnedPerDay * 7,
    usdRate,
  };

  const equityValue = Number(summary?.totalValue ?? 0);
  const investable = equityValue + available;
  const cashPct = investable > 0 ? (available / investable) * 100 : 0;

  // --- ladder ----------------------------------------------------------------
  // The pool is frozen at arming. If it was never armed, fall back to the money
  // free right now so a fresh ladder still sizes itself sensibly.
  const poolAtArming = pb.poolAtArming > 0 ? pb.poolAtArming : available + receivable + expected;
  const ladder = planLadder({
    indexName: pb.indexName || "KSE-100",
    indexLevel: auto.data?.indexLevel ?? 0,
    indexAsOf: auto.data?.indexAsOf ?? "",
    rungs: (pb.rungs ?? []) as any,
    poolAtArming,
    poolNow: available,
    reservePct: pb.ladderReservePct ?? 10,
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

  return {
    regime,
    regimeStale: auto.stale,
    ladderBuys,
    ruleCheck,
    cash,
    cashPct,
    cashCheck: cashCheck(regime, cashPct),
    ladder,
    ladderVerdict: ladderVerdict(ladder),
    equityValue,
    netWorth: Number(netWorth?.total ?? 0),
    investable,
    playbook: {
      indexName: pb.indexName || "KSE-100",
      poolAtArming,
      armedAt: pb.armedAt ?? "",
      ladderReservePct: pb.ladderReservePct ?? 10,
      weeklyReportEnabled: !!pb.weeklyReportEnabled,
      weeklyReportEmail: pb.weeklyReportEmail ?? "",
      rungs: (pb.rungs ?? []) as any,
      regimeManual: (pb.regimeManual ?? []) as any,
      cashSources: manualRows,
    },
  };
}
