// Telegram messages for the strategy: the KSE-100 reaching a buy step, and a
// T-bill or sukuk about to mature with the rates to buy again at. Pure, so
// scripts/test-strategy.ts runs them.

import { TRANCHE_LEVELS, type Rates, type StrategyPlan } from "./plan";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${Math.round(v * 10) / 10}%`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// `steps` are the steps reached since the last message (usually one).
export function kseStepMessage(plan: StrategyPlan, kse: { level: number; high: number }, steps: number[]): string {
  const top = Math.max(...steps);
  const amount = plan.tranches.filter((t) => steps.includes(t.n)).reduce((s, t) => s + t.amount, 0);
  const next = plan.tranches.find((t) => t.n > top && t.kseLevel != null);
  const which = steps.length > 1 ? `steps ${Math.min(...steps)} to ${top}` : `step ${top}`;
  const lines = [`📉 <b>KSE-100 ${n0(kse.level)}</b>, ${pct((1 - kse.level / kse.high) * 100)} below its high: buy ${which} of ${TRANCHE_LEVELS.length}.`];
  lines.push(amount > 0 ? `   → Plan: invest Rs ${n0(amount)}.` : `   → Plan: no buying. Stocks ${pct(plan.allocation.stocksNowPct)}, target ${pct(plan.allocation.stocksTargetPct)}.`);
  if (plan.quality.add.length) lines.push(`   Buy list: ${plan.quality.add.map((n) => n.symbol).join(", ")}`);
  if (next?.kseLevel != null) lines.push(`   Next step: ${n0(next.kseLevel)}`);
  return lines.join("\n");
}

export function maturityMessage(f: { name: string; face: number; maturityDate: string; daysLeft: number }, rates: Rates | null, entered: boolean): string {
  const day = new Date(f.maturityDate + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const lines = [`🗓 <b>${esc(f.name)}</b> matures ${f.daysLeft <= 1 ? "tomorrow" : `in ${f.daysLeft} days`} (${day}): Rs ${n0(f.face)} back.`];
  const tb = rates ? ([["3M", rates.tbill3mPct], ["6M", rates.tbill6mPct], ["12M", rates.tbill12mPct]] as const).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v!.toFixed(2)}%`) : [];
  const parts = [tb.length ? `T-bill ${tb.join(", ")}` : "", rates?.sukukPct != null ? `sukuk ${rates.sukukPct.toFixed(2)}%` : ""].filter(Boolean);
  if (parts.length) lines.push(`   Rates${entered ? "" : " (not this month's)"}: ${parts.join("; ")}`);
  return lines.join("\n");
}
