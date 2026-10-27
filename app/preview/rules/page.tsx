import { notFound } from "next/navigation";
import { RulesView } from "@/app/rules/RulesView";
import { advanceShare, DEFAULT_STEPS, movePct } from "@/lib/rules/ladder";
import { combine, dividendCheck, moveCheck, profitCheck } from "@/lib/rules/checks";
import type { RuleShare } from "@/lib/rules/data";

// The price rules on made-up shares, through the real step logic, for
// looking at the design on a machine with no database. Development only.
export const dynamic = "force-dynamic";

function share(symbol: string, shares: number, avgCost: number, close: number, eps: [number, number], dps: [number, number], target = 10, div = 0): RuleShare {
  const m = movePct(close + div, avgCost);
  const falls = DEFAULT_STEPS.filter((s) => s.move < 0).sort((a, b) => b.move - a.move);
  const rises = DEFAULT_STEPS.filter((s) => s.move > 0).sort((a, b) => a.move - b.move);
  const add = falls.find((s) => s.action === "add" && m > s.move) ?? null;
  const sell = rises.find((s) => s.action === "sell" && m < s.move) ?? null;
  const told = advanceShare(DEFAULT_STEPS, [], symbol, avgCost, [{ date: "2026-10-13", close }], false, () => div).fired;
  return {
    symbol,
    shares,
    avgCost,
    dividends: div,
    close,
    closeDate: "2026-10-13",
    move: m,
    at: m < 0 ? [...falls].reverse().find((s) => m <= s.move) ?? null : [...rises].reverse().find((s) => m >= s.move) ?? null,
    nextAdd: add ? { step: add, price: avgCost * (1 + add.move / 100) - div } : null,
    nextSell: sell ? { step: sell, price: avgCost * (1 + sell.move / 100) - div } : null,
    told,
    checks: combine({
      profit: profitCheck([{ fiscalYear: 2026, eps: eps[0] }, { fiscalYear: 2025, eps: eps[1] }], 31),
      dividend: dividendCheck([{ fyEndYear: 2026, label: "FY25-26", dps: dps[0], complete: true }, { fyEndYear: 2025, label: "FY24-25", dps: dps[1], complete: true }]),
      rate: moveCheck(11, 11, 2, false),
      rupee: moveCheck(281.2, 282.1, 10, true),
    }),
    since: "2025-10-01",
    off: false,
    addsOff: target <= 0,
  };
}

export default function RulesPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const shares = [
    share("MUREB", 662, 946.65, 724.1, [70.2, 75.5], [31.5, 30], 10, 26.78),
    share("MEBL", 789, 549.94, 720.4, [62, 55], [28.5, 26]),
    share("HINOON", 479, 974.54, 860, [35, 72], [50, 50]),
    share("PTL", 248, 50.45, 49.1, [6.1, 5.8], [4, 4], 0),
    share("AHCL", 12000, 15.29, 15.42, [3.1, 2.9], [1, 1]),
  ].sort((a, b) => Math.abs(b.move ?? 0) - Math.abs(a.move ?? 0));
  return <RulesView settings={{ on: true, steps: DEFAULT_STEPS, ratePts: 2, rupeePct: 10, off: [] }} shares={shares} usualPct={31} asOf="2026-10-13" />;
}
