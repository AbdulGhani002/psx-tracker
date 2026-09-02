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
} from "@/lib/data";
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
  const regime = scoreRegime([...autoSignals, ...manualSignals]);

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

  return {
    regime,
    regimeStale: auto.stale,
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
