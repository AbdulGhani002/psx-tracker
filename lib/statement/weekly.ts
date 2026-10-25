// Assemble the weekly plan report from the same view the plan page renders, so
// the PDF that lands on Sunday says exactly what the site said on Saturday.

import { assemblePlan } from "@/lib/plan";
import { getPortfolioSummary } from "@/lib/data";
import { getStrategy } from "@/lib/strategy/data";
import { zoneRange } from "@/lib/strategy/plan";
import { buildWeeklyTex, weekOf, weekAction, type WeeklyReportData } from "./weekly-template";

export { buildWeeklyTex, weekOf, type WeeklyReportData };

export async function assembleWeeklyReport(now = new Date()): Promise<WeeklyReportData> {
  const [plan, summary, s] = await Promise.all([assemblePlan(), getPortfolioSummary().catch(() => null as any), getStrategy().catch(() => null)]);
  const wk = weekOf(now);
  const gate = gateLine(s);
  const act = weekAction({ level: s?.kse?.level ?? null, tranches: s?.plan.tranches ?? [], allocationLine: s?.plan.allocation.line ?? "", gate });
  const r = s?.rates ?? null;
  const month = r ? new Date(r.month + "-01T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const strategy: WeeklyReportData["strategy"] = s
    ? {
        steps: s.plan.steps,
        zones: s.plan.tranches.map((t) => ({ range: zoneRange(t), why: t.why, reached: t.due })),
        rates: r
          ? {
              label: s.ratesEntered ? month : `${month}, not entered`,
              values: [["Policy", r.policyPct], ["T-bill 3M", r.tbill3mPct], ["6M", r.tbill6mPct], ["12M", r.tbill12mPct], ["Sukuk", r.sukukPct], ["Money market", r.moneyMarketPct], ["Savings", r.savingsPct], ["CPI", r.inflationPct]],
            }
          : null,
      }
    : null;

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
    cashComing: plan.calendar
      ? {
          in90: plan.calendar.in90,
          dividends: plan.calendar.items.filter((x) => x.kind === "dividend").reduce((s, x) => s + x.pkr, 0),
          fixed: plan.calendar.items.filter((x) => x.kind !== "dividend").reduce((s, x) => s + x.pkr, 0),
          needs: plan.calendar.needsTotal,
          shortBy: plan.calendar.shortBy,
        }
      : null,
    cashPct: plan.cashPct,
    cashCheckLine: plan.cashCheck.line,
    cashCheckOk: plan.cashCheck.ok,
    fundEarnedWeek: plan.cash.fundEarnedWeek,
    fundEarnedPerDay: plan.cash.fundEarnedPerDay,
    cashPlaces: plan.cash.places,
    cashLocked: plan.cash.locked,
    gateLine: gate,

    indexName: "KSE-100",
    indexLevel: s?.kse?.level ?? 0,
    indexAsOf: s?.kse?.asOf ?? "",
    action: act.action,
    actionLine: act.line,

    positions,
    parked,
    strategy,
  };
}

// The strategy's allocation decides first: with stocks above their target the
// week's answer is no buying, whatever the zones say.
function gateLine(s: Awaited<ReturnType<typeof getStrategy>> | null): string | null {
  const a = s?.plan.allocation;
  if (!a || a.total <= 0 || a.stocksNowPct <= a.stocksTargetPct + 5) return null;
  return `No buying: stocks are ${a.stocksNowPct.toFixed(1)}% of your book, above your ${a.stocksTargetPct.toFixed(0)}% target.`;
}

// Plain-text summary for the Telegram caption and the email body. The PDF is
// the document; this is what you read on a phone without opening it.
export function weeklySummaryText(d: WeeklyReportData): string {
  const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-PK")}`;
  const lines = [
    `Weekly plan — ${d.weekLabel}`,
    "",
    d.action === "DEPLOY" ? `ACTION: ${d.actionLine}` : `No action. ${d.actionLine}`,
    "",
    ...(d.strategy ? ["Strategy:", ...d.strategy.steps, ""] : []),
    `Regime: ${d.regimeLabel} (${d.rawScore >= 0 ? "+" : ""}${d.rawScore} of ${d.maxScore}, ${d.confidence.toLowerCase()} confidence)`,
    `Cash floor for this regime: ${d.cashFloorPct}%. You hold ${d.cashPct.toFixed(0)}%.`,
    `Favour: ${d.favour.join(", ")}`,
    `Avoid: ${d.avoid.join(", ")}`,
    "",
    `Cash available ${rs(d.cashAvailable)}${d.cashPlaces.length ? ` (${d.cashPlaces.map((p) => `${p.label} ${rs(p.pkr)}`).join(", ")})` : ""}${d.cashReceivable >= 1 ? ` · receivable ${rs(d.cashReceivable)}` : ""}${d.cashExpected >= 1 ? ` · expected ${rs(d.cashExpected)}` : ""}${d.cashLocked.length ? ` · locked ${d.cashLocked.map((p) => `${p.label} ${rs(p.pkr)} to ${p.until}`).join(", ")}` : ""}${d.cashComing && d.cashComing.in90 >= 1 ? ` · coming in 90 days ${rs(d.cashComing.in90)}` : ""}${d.cashComing && d.cashComing.needs >= 1 ? ` · price-rule adds would need ${rs(d.cashComing.needs)}${d.cashComing.shortBy >= 1 ? `, short by ${rs(d.cashComing.shortBy)}` : ""}` : ""}`,
    `Equities ${rs(d.equityValue)} · net worth ${rs(d.netWorth)}`,
  ];
  if (d.fundEarnedPerDay > 0) {
    lines.push(`The money-market fund earns about ${rs(d.fundEarnedPerDay)} a day (${rs(d.fundEarnedWeek)} over the past week).`);
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
<p style="color:#6b7280;font-size:12px;margin-top:14px">The full one-page plan is attached as a PDF. The buy zones come from the data, not from levels typed in. Nothing here is advice.</p>
</div>`;
}
