// Assemble the weekly plan report from the same view the plan page renders, so
// the PDF that lands on Sunday says exactly what the site said on Saturday.

import { assemblePlan } from "@/lib/plan";
import { getPortfolioSummary } from "@/lib/data";
import { buildWeeklyTex, weekOf, type WeeklyReportData } from "./weekly-template";

export { buildWeeklyTex, weekOf, type WeeklyReportData };

export async function assembleWeeklyReport(now = new Date()): Promise<WeeklyReportData> {
  const [plan, summary] = await Promise.all([assemblePlan(), getPortfolioSummary().catch(() => null as any)]);
  const wk = weekOf(now);

  const positions = ((summary?.positions ?? []) as any[])
    .filter((p) => p.shares > 0)
    .map((p) => ({
      symbol: p.symbol,
      weightPct: p.currentPercent ?? 0,
      value: p.marketValue ?? 0,
      priceKnown: (p.currentPrice ?? 0) > 0,
    }));
  const parked = ((summary?.parked ?? []) as any[]).filter((p) => p.shares > 0).map((p) => ({ symbol: p.symbol, shares: p.shares, value: p.marketValue ?? 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    weekKey: wk.key,
    weekLabel: wk.label,
    generatedOn: now.toISOString().slice(0, 10),

    regimeBand: plan.regime.band,
    regimeLabel: plan.regime.label,
    regimeLine: plan.regime.line,
    rawScore: plan.regime.rawScore,
    maxScore: plan.regime.maxScore,
    confidence: plan.regime.confidence,
    cashFloorPct: plan.regime.cashFloorPct,
    favour: plan.regime.favour,
    avoid: plan.regime.avoid,
    signals: plan.regime.signals.map((s) => ({
      label: s.label,
      source: s.source,
      score: s.score,
      reading: s.reading,
      known: s.known,
    })),
    missing: plan.regime.missing,

    netWorth: plan.netWorth,
    equityValue: plan.equityValue,
    cashAvailable: plan.cash.available,
    cashReceivable: plan.cash.receivable,
    cashExpected: plan.cash.expected,
    cashPct: plan.cashPct,
    cashCheckLine: plan.cashCheck.line,
    cashCheckOk: plan.cashCheck.ok,
    fundEarnedWeek: plan.cash.fundEarnedWeek,
    fundEarnedPerDay: plan.cash.fundEarnedPerDay,

    indexName: plan.ladder.indexName,
    indexLevel: plan.ladder.indexLevel,
    indexAsOf: plan.ladder.indexAsOf,
    ladderAction: plan.ladderVerdict.action,
    ladderLine: plan.ladderVerdict.line,
    rungs: plan.ladder.rows.map((r) => ({
      level: r.level,
      pct: r.pct,
      label: r.label,
      amount: r.amount,
      status: r.status,
      moveRequiredPct: r.moveRequiredPct,
    })),
    ladderWarnings: plan.ladder.warnings,

    positions,
    parked,
  };
}

// Plain-text summary for the Telegram caption and the email body. The PDF is
// the document; this is what you read on a phone without opening it.
export function weeklySummaryText(d: WeeklyReportData): string {
  const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-PK")}`;
  const lines = [
    `Weekly plan — ${d.weekLabel}`,
    "",
    d.ladderAction === "DEPLOY" ? `ACTION: ${d.ladderLine}` : `No action. ${d.ladderLine}`,
    "",
    `Regime: ${d.regimeLabel} (${d.rawScore >= 0 ? "+" : ""}${d.rawScore} of ${d.maxScore}, ${d.confidence.toLowerCase()} confidence)`,
    `Cash floor for this regime: ${d.cashFloorPct}%. You hold ${d.cashPct.toFixed(0)}%.`,
    `Favour: ${d.favour.join(", ")}`,
    `Avoid: ${d.avoid.join(", ")}`,
    "",
    `Cash available ${rs(d.cashAvailable)} · receivable ${rs(d.cashReceivable)} · expected ${rs(d.cashExpected)}`,
    `Equities ${rs(d.equityValue)} · net worth ${rs(d.netWorth)}`,
  ];
  if (d.fundEarnedPerDay > 0) {
    lines.push(`The parked cash earned about ${rs(d.fundEarnedWeek)} this week while it waited.`);
  }
  if (d.missing.length > 0) lines.push("", `Not scored: ${d.missing.join(", ")}.`);
  return lines.join("\n");
}

export function weeklyEmailHtml(d: WeeklyReportData): string {
  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = esc(weeklySummaryText(d)).replace(/\n/g, "<br>");
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:640px;color:#15171b;line-height:1.55">
<h2 style="margin:0 0 4px;font-size:20px">Weekly plan</h2>
<div style="color:#6b7280;font-size:13px;margin-bottom:14px">${esc(d.weekLabel)}</div>
<div style="border:1px solid #d5d8dd;padding:14px 16px;font-size:14px">${body}</div>
<p style="color:#6b7280;font-size:12px;margin-top:14px">The full one-page plan is attached as a PDF. The ladder is a rule, not a forecast: it reports what your own levels commit you to this week. Nothing here is advice.</p>
</div>`;
}
