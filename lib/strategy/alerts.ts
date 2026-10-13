// Telegram messages for the strategy: the KSE-100 reaching a buy zone, and a
// T-bill or sukuk about to mature with the rates to buy again at. Pure, so
// scripts/test-strategy.ts runs them.

import { zoneRange, type Rates, type StrategyPlan } from "./plan";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${Math.round(v * 10) / 10}%`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// `zones` are the zones reached since the last message (usually one).
export function kseStepMessage(plan: StrategyPlan, kse: { level: number; high: number }, zones: number[]): string {
  const top = Math.max(...zones);
  const t = plan.tranches.find((x) => x.n === top);
  const amount = plan.tranches.filter((x) => zones.includes(x.n)).reduce((s, x) => s + x.amount, 0);
  const next = plan.tranches.find((x) => x.n > top && x.kseLevel != null);
  const which = zones.length > 1 ? `zones ${Math.min(...zones)} to ${top}` : `zone ${top}`;
  const lines = [`📉 <b>KSE-100 ${n0(kse.level)}</b>, ${pct((1 - kse.level / kse.high) * 100)} below its high: in buy ${which} of ${plan.tranches.length}${t ? `, ${zoneRange(t)} (${esc(t.why)})` : ""}.`];
  lines.push(amount > 0 ? `   → Plan: invest Rs ${n0(amount)}.` : `   → Plan: no buying. Stocks ${pct(plan.allocation.stocksNowPct)}, target ${pct(plan.allocation.stocksTargetPct)}.`);
  if (next) lines.push(`   Next zone: ${zoneRange(next)}`);
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
