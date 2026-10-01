import { Stat } from "@/components/ui/Stat";
import { getCompanyQuality, type QualityContext, type QualityRow } from "@/lib/fundamentals/board";
import { QUADRANT_TEXT } from "@/lib/fundamentals/quality";
import { fmtDate } from "@/lib/format";
import { GradeBadge, GRADE_TEXT, QUADRANT_COLOR, mult, rate, signed } from "./parts";

// One company's quality and price, for its holding and stock pages: the
// grade and the quadrant, the eight figures behind them, the DuPont split of
// its return on equity, each year's earnings in today's rupees, and where the
// book value came from.

export async function CompanyQualityPanel({ symbol }: { symbol: string }) {
  const res = await getCompanyQuality(symbol).catch(() => null);
  if (!res) {
    return <p className="text-[13px] text-muted">No figures for {symbol} yet. The exchange&apos;s company page is read every day for the names you hold and the KSE-100; others are read once they are on the watchlist.</p>;
  }
  return <CompanyQualityView row={res.row} ctx={res.ctx} />;
}

export function CompanyQualityView({ row, ctx }: { row: QualityRow; ctx: QualityContext }) {
  const q = row.q;
  const r = ctx.costOfEquityPct;
  const latest = q.realEps[0];
  const span = q.realEps.length > 1 ? q.realEps[0].fiscalYear - q.realEps[q.realEps.length - 1].fiscalYear : 0;
  const maxReal = Math.max(1e-9, ...q.realEps.map((e) => Math.abs(e.real)));
  return (
    <div>
      <div className="flex items-start gap-3 flex-wrap">
        <GradeBadge grade={q.grade} size="lg" />
        <div className="min-w-0 flex-1">
          {q.quadrant ? (
            <>
              <div className="text-[14px] font-semibold" style={{ color: QUADRANT_COLOR[q.quadrant] }}>{QUADRANT_TEXT[q.quadrant].title}</div>
              <div className="text-[12.5px] text-muted">{QUADRANT_TEXT[q.quadrant].line}</div>
            </>
          ) : (
            <div className="text-[12.5px] text-muted">{q.roePct == null ? "No return on equity yet, so no quadrant." : "No cycle-adjusted P/E yet (fewer than three years of earnings), so no quadrant."}</div>
          )}
          {q.grade && <div className="text-[12px] text-muted mt-0.5">Grade {q.grade}: {GRADE_TEXT[q.grade].toLowerCase()}.</div>}
        </div>
        <div className="text-[11.5px] text-muted text-right leading-snug">
          Cost of equity {r.toFixed(1)}% (SBP {ctx.sbpRatePct.toFixed(1)}% + {ctx.equityRiskPremiumPct.toFixed(1)} pp premium)
          {ctx.marketMedianCape != null && <><br />KSE-100 median CAPE {ctx.marketMedianCape.toFixed(1)}×</>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 [&>*]:stat-card">
        <Stat label="P/E" value={mult(q.pe)} hint={`${q.latestYear ? `FY${q.latestYear} EPS Rs ${latest?.eps.toFixed(2) ?? "—"}` : "no annual EPS"}${row.peTtm ? ` · TTM ${row.peTtm.toFixed(1)}× on the exchange` : ""}`} />
        <Stat label={`Cycle-adjusted P/E (${q.capeYears} yrs)`} value={mult(q.cape)} hint={q.capeYieldPct != null ? `${q.capeYieldPct.toFixed(1)}% real earnings yield on average earnings` : "needs three years of earnings"} />
        <Stat label="Price to book" value={mult(q.pb, 2)} hint={q.justifiedPb != null ? `justified ${q.justifiedPb.toFixed(2)}× at its ROE and growth` : q.bvps != null ? `book Rs ${q.bvps.toFixed(2)} a share` : "no book value yet"} />
        <Stat label="Return on equity" value={rate(q.roePct)} tone={q.spreadPp == null ? "default" : q.spreadPp >= 0 ? "positive" : "negative"} hint={q.spreadPp != null ? `${signed(q.spreadPp, 1, " pp")} against its ${r.toFixed(1)}% cost` : undefined} />
        <Stat label="Dividend yield" value={rate(q.dividendYieldPct)} hint={q.payoutPct != null ? `pays out ${q.payoutPct.toFixed(0)}% of earnings` : "last twelve months' cash dividends"} />
        <Stat label={`EPS growth a year${span ? ` (${span} yrs)` : ""}`} value={signed(q.epsCagrPct)} tone={q.epsCagrPct == null ? "default" : q.epsCagrPct >= 0 ? "positive" : "negative"} hint={q.revenueCagrPct != null ? `revenue ${signed(q.revenueCagrPct)} a year` : undefined} />
        <Stat label="Net margin" value={rate(q.netMarginPct)} hint={[q.netMarginTrendPp != null ? `${signed(q.netMarginTrendPp, 1, " pp")} over the window` : null, q.grossMarginPct != null ? `gross ${q.grossMarginPct.toFixed(1)}%` : null].filter(Boolean).join(" · ") || undefined} />
        <Stat label="Implied return" value={rate(q.impliedReturnPct)} tone={q.impliedReturnPct == null ? "default" : q.impliedReturnPct >= r ? "positive" : "negative"} hint={q.impliedReturnPct != null ? `yield ${rate(q.dividendYieldPct)} + growth ${rate(q.sustainableGrowthPct)}, against ${r.toFixed(1)}%` : "needs a dividend record and an ROE"} />
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-5">
        <div>
          <div className="label-cap mb-2">Where the return on equity comes from</div>
          {q.dupont ? (
            <>
              <div className="flex items-center gap-2 flex-wrap text-[13px]">
                <Factor label="Net margin" value={rate(q.dupont.netMarginPct)} />
                <span className="text-muted">×</span>
                <Factor label="Asset turnover" value={mult(q.dupont.assetTurnover, 2)} />
                <span className="text-muted">×</span>
                <Factor label="Leverage" value={mult(q.dupont.equityMultiplier, 2)} />
                <span className="text-muted">=</span>
                <Factor label="ROE" value={rate(q.roePct)} strong />
              </div>
              <p className="text-[12px] text-muted mt-2 leading-relaxed">
                {q.dupont.equityMultiplier >= 4
                  ? "Most of this return is leverage: assets are several times the equity, as in a bank, so the ROE moves with the balance sheet's risk."
                  : q.dupont.netMarginPct >= 15
                  ? "Earned on margin: the business keeps a large share of each rupee of sales."
                  : q.dupont.assetTurnover >= 1.2
                  ? "Earned on turnover: thin margins on sales several times its assets."
                  : "A mix of margin, turnover and modest leverage."}
              </p>
            </>
          ) : (
            <p className="text-[12.5px] text-muted">{q.bookSource === "manual" ? "From the book value entered on the holding, so ROE is EPS over book value and there is no split." : "Needs the company's balance sheet."}</p>
          )}
          <div className="label-cap mt-5 mb-2">Book value</div>
          <p className="text-[12.5px] text-muted leading-relaxed">
            {q.bookSource === "statement" && row.balance ? (
              <>
                Equity Rs {(row.balance.equity / 1e9).toFixed(2)} bn and total assets Rs {(row.balance.totalAssets / 1e9).toFixed(2)} bn, from the {row.balance.consolidated ? "consolidated" : "standalone"} statement of financial position as at {fmtDate(row.balance.periodEnd)}
                {row.balance.source ? <> (<a href={row.balance.source} target="_blank" rel="noreferrer" className="underline">the filing</a>)</> : null}.
              </>
            ) : q.bookSource === "manual" ? (
              <>Rs {q.bvps?.toFixed(2)} a share, as entered on the holding.</>
            ) : (
              <>None yet. Scanned filings cannot be read; enter the book value per share on the holding&apos;s settings to add one.</>
            )}
          </p>
        </div>
        <div>
          <div className="label-cap mb-2">Earnings per share, in today&apos;s rupees</div>
          {q.realEps.length ? (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-muted text-[11px]">
                  <th className="text-left font-medium pb-1">Year</th>
                  <th className="text-right font-medium pb-1">EPS</th>
                  <th className="text-right font-medium pb-1">Today&apos;s Rs</th>
                  <th className="pb-1 w-[40%]" />
                </tr>
              </thead>
              <tbody>
                {q.realEps.map((e) => (
                  <tr key={e.fiscalYear}>
                    <td className="py-0.5">FY{e.fiscalYear}</td>
                    <td className="py-0.5 text-right mono-num">{e.eps.toFixed(2)}</td>
                    <td className="py-0.5 text-right mono-num">{e.real.toFixed(2)}</td>
                    <td className="py-0.5 pl-3">
                      <div className="h-1.5 rounded-full" style={{ width: `${(Math.abs(e.real) / maxReal) * 100}%`, background: e.real >= 0 ? "var(--teal)" : "var(--negative)" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[12.5px] text-muted">No annual earnings on record.</p>
          )}
          <p className="text-[11.5px] text-muted mt-2 leading-relaxed">
            Restated with the PBS consumer price index{ctx.cpiPeriod ? ` to ${ctx.cpiPeriod}` : ""}. The cycle-adjusted P/E is the price over their average: Shiller averages ten years, the exchange keeps four, and the window lengthens as the years accumulate.
          </p>
        </div>
      </div>

      {q.notes.length > 0 && (
        <ul className="mt-4 space-y-1 text-[12px] text-muted">
          {q.notes.map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted mt-3">
        Priced at Rs {row.price.toFixed(2)} ({row.priceFrom === "live" ? "live" : "last close"}){row.checkedAt ? ` · company page read ${fmtDate(row.checkedAt)}` : ""}.
      </p>
    </div>
  );
}

function Factor({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md px-2.5 py-1.5" style={{ background: strong ? "color-mix(in srgb, var(--positive) 10%, transparent)" : "var(--surface-2)" }}>
      <div className="text-[10.5px] text-muted leading-none">{label}</div>
      <div className={`mono-num mt-1 ${strong ? "font-semibold" : ""}`}>{value}</div>
    </div>
  );
}
