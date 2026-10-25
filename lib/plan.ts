// The plan: one view combining what the market is doing and what money is
// free.
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
  getFixedIncomeValued,
} from "@/lib/data";
import { getAutoSignalsCached } from "@/lib/feeds/regime";
import { scoreRegime, cashCheck, SIGNAL_HINTS, MANUAL_SIGNALS, MANUAL_SIGNAL_DAYS, manualAgeDays, type RegimeSignal, type RegimeVerdict } from "@/lib/calculations/regime";
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
  equityValue: number;
  netWorth: number;
  investable: number;
  // The next 90 days of money in, dated (dividends, coupons, maturities), and
  // what the price rules' next adds would need. Never counted as cash in hand.
  calendar: CashCalendar | null;
  playbook: {
    weeklyReportEnabled: boolean;
    weeklyReportEmail: string;
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

  const calendar = await getCashCalendar().catch(() => null);

  return {
    regime,
    regimeStale: auto.stale,
    cash,
    cashPct,
    cashCheck: cashCheck(regime, cashPct),
    equityValue,
    netWorth: Number(netWorth?.total ?? 0),
    investable,
    calendar,
    playbook: {
      weeklyReportEnabled: !!pb.weeklyReportEnabled,
      weeklyReportEmail: pb.weeklyReportEmail ?? "",
      regimeManual: (pb.regimeManual ?? []) as any,
      cashSources: manualRows,
    },
  };
}
