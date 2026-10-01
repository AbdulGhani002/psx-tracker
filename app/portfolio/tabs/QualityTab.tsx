import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { QualityQuadrant } from "@/components/quality/QualityQuadrant";
import { GradeBadge, QuadrantPill, QUADRANT_COLOR, QUADRANT_SHORT, mult, rate, signed, toneOf } from "@/components/quality/parts";
import { getQualityBoard, type QualityBoard, type QualityRow } from "@/lib/fundamentals/board";
import { fmtDateTime } from "@/lib/format";

// Quality and price, for every holding and for the portfolio as a whole,
// against the KSE-100: what the companies earn on their equity and whether
// it beats what that equity costs, what the market charges for their
// earnings over a cycle, and which quadrant that puts each one in.

const pctOf = (v: number) => `${(v * 100).toFixed(0)}%`;

export async function QualityTab() {
  const b = await getQualityBoard().catch(() => null);
  if (!b) return <Card><p className="text-[13px] text-muted">The quality figures could not be gathered just now. Try again in a minute.</p></Card>;
  return <QualityView b={b} />;
}

// The tab itself, on a board already gathered (the preview page draws it on
// sample companies).
export function QualityView({ b }: { b: QualityBoard }) {
  const p = b.portfolio, m = b.market;
  const r = b.costOfEquityPct;
  const held = b.rows.filter((x) => x.held);
  const offer = b.rows
    .filter((x) => !x.held && x.inIndex && x.q.quadrant === "compounder" && (x.q.grade === "A" || x.q.grade === "B"))
    .sort((a, c) => (c.q.spreadPp ?? 0) - (a.q.spreadPp ?? 0))
    .slice(0, 12);
  const vs = (v: number | null | undefined, f: (x: number | null | undefined) => string) => (m ? `KSE-100 ${f(v)}` : undefined);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label="P/E" value={mult(p.pe)} delta={vs(m?.pe, mult)} deltaTone="muted" hint="value over earnings, as an index is" />
        <StatCard label="Cycle-adjusted P/E" value={mult(p.cape)} delta={vs(m?.cape, mult)} deltaTone="muted" hint={p.capeYieldPct != null ? `${p.capeYieldPct.toFixed(1)}% real earnings yield` : undefined} />
        <StatCard label="Price to book" value={mult(p.pb, 2)} delta={vs(m?.pb, (x) => mult(x, 2))} deltaTone="muted" />
        <StatCard label="Return on equity" value={rate(p.roePct)} tone={p.roePct == null ? "muted" : p.roePct >= r ? "positive" : "negative"} delta={`cost ${r.toFixed(1)}%`} deltaTone="muted" hint={`${m ? `KSE-100 ${rate(m.roePct)} · ` : ""}covers ${pctOf(p.coverage.roe)} of value`} />
        <StatCard label="Dividend yield" value={rate(p.dividendYieldPct)} delta={vs(m?.dividendYieldPct, rate)} deltaTone="muted" />
        <StatCard label="EPS growth a year" value={signed(p.epsCagrPct)} tone={p.epsCagrPct == null ? "muted" : p.epsCagrPct >= 0 ? "positive" : "negative"} delta={vs(m?.epsCagrPct, signed)} deltaTone="muted" />
        <StatCard label="Net margin" value={rate(p.netMarginPct)} delta={vs(m?.netMarginPct, rate)} deltaTone="muted" />
        <StatCard label="Implied return" value={rate(p.impliedReturnPct)} tone={p.impliedReturnPct == null ? "muted" : p.impliedReturnPct >= r ? "positive" : "negative"} delta={vs(m?.impliedReturnPct, rate)} deltaTone="muted" hint="dividend yield + growth from retained earnings" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2">
          <Card title="Quality against price" action={<span className="text-[12px] text-muted">{b.counts.withRoe} of {b.counts.companies} companies with an ROE</span>}>
            <QualityQuadrant rows={b.rows} costOfEquityPct={r} marketMedianCape={b.marketMedianCape} />
          </Card>
        </div>
        <Card title="Where the money sits">
          <div className="label-cap mb-2">By quadrant</div>
          <Shares
            items={[
              ...(["compounder", "premium", "trap", "danger"] as const).map((k) => ({ label: QUADRANT_SHORT[k], share: p.quadrants[k], color: QUADRANT_COLOR[k] })),
              { label: "Not classed", share: p.quadrants.unknown, color: "var(--rule-strong)" },
            ]}
          />
          <div className="label-cap mt-5 mb-2">By grade</div>
          <Shares
            items={[
              { label: "A", share: p.grades.A, color: "var(--positive)" },
              { label: "B", share: p.grades.B, color: "var(--teal)" },
              { label: "C", share: p.grades.C, color: "var(--amber)" },
              { label: "D", share: p.grades.D, color: "var(--negative)" },
              { label: "Not graded", share: p.grades.unknown, color: "var(--rule-strong)" },
            ]}
          />
          <p className="text-[11.5px] text-muted mt-4 leading-relaxed">
            Each bar is a share of the money in shares; funds and cash are left out. A name is not classed until its book value is known (from its filed balance sheet, or entered on the holding) and it has three years of earnings.
          </p>
        </Card>
      </div>

      <Card className="mt-3" title="Your holdings" action={<span className="text-[12px] text-muted">cost of equity {r.toFixed(1)}% · market median CAPE {mult(b.marketMedianCape)}</span>}>
        <QualityTable rows={held} r={r} showWeight />
      </Card>

      {offer.length > 0 && (
        <Card className="mt-3" title="Compounders you don't hold" action={<span className="text-[12px] text-muted">KSE-100, grade A or B, below the market&apos;s multiple</span>}>
          <QualityTable rows={offer} r={r} />
        </Card>
      )}

      <Card className="mt-3" title="How to read it">
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-3 text-[12.5px] leading-relaxed">
          <Term name="Cycle-adjusted P/E">Price over the average of the past years&apos; EPS, each restated in today&apos;s rupees with the PBS price index, so one boom or bust year does not swing it. Its inverse is the real earnings yield, the measure Shiller found to track the next decade&apos;s returns. The exchange keeps four years; the window lengthens to ten as they accumulate.</Term>
          <Term name="Return on equity">The year&apos;s profit over the shareholders&apos; equity in the company&apos;s own balance sheet. Above the cost of equity (the SBP rate plus the equity premium in your settings) the company creates value; below it, it destroys value however cheap it looks.</Term>
          <Term name="DuPont split">ROE as net margin × asset turnover × leverage, on each company&apos;s page. A high ROE from margin or turnover is earned; one from leverage is borrowed and carries the balance sheet&apos;s risk.</Term>
          <Term name="Justified P/B">The price to book a company&apos;s ROE and growth warrant at your cost of equity, (ROE − g) / (r − g). Trading below it means cheap for its quality.</Term>
          <Term name="Implied return">Dividend yield plus ROE × the share of earnings kept: what a buyer at today&apos;s price earns if the business simply carries on. Compare it with the cost of equity. It is a reading of the price, not a forecast of it.</Term>
          <Term name="Grade">A: ROE five points or more over its cost, profitable every year, earnings growing. B: earns its cost and always profitable. C: close to its cost, or growing without earning it yet. D: well under its cost.</Term>
          <Term name="Portfolio figures">Weighted by value. Multiples combine as total value over total earnings, the way an index&apos;s do, so one name on a huge multiple cannot dominate. The KSE-100 figures weight its companies by market value.</Term>
          <Term name="Where the numbers come from">Earnings, sales and margins from the exchange&apos;s company pages; equity and assets from the latest filed report&apos;s statement of financial position (scanned filings cannot be read: enter book value per share on the holding instead). Prices are live for your holdings and the last close for the rest.</Term>
        </div>
        <p className="text-[11px] text-muted mt-4">
          {b.counts.companies} companies · {b.counts.withStatement} with a balance sheet read from their filings · {b.counts.withCape} with a cycle-adjusted P/E · CPI to {b.cpiPeriod ?? "—"} · gathered {fmtDateTime(b.inputsAt)}
        </p>
      </Card>
    </div>
  );
}

function Shares({ items }: { items: Array<{ label: string; share: number; color: string }> }) {
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[96px_1fr_44px] items-center gap-2 text-[12px]">
          <span>{it.label}</span>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, it.share)) * 100}%`, background: it.color }} />
          </div>
          <span className="mono-num text-right">{(it.share * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-semibold text-[12.5px]">{name}</div>
      <div className="text-muted">{children}</div>
    </div>
  );
}

function QualityTable({ rows, r, showWeight }: { rows: QualityRow[]; r: number; showWeight?: boolean }) {
  return (
    <div className="overflow-x-auto -mx-2">
      <table className="table-zar">
        <thead>
          <tr>
            <th>Name</th>
            {showWeight && <th className="text-right">Weight</th>}
            <th className="text-center">Grade</th>
            <th>Quadrant</th>
            <th className="text-right">P/E</th>
            <th className="text-right">CAPE</th>
            <th className="text-right">P/B</th>
            <th className="text-right">Justified</th>
            <th className="text-right">ROE</th>
            <th className="text-right">vs cost</th>
            <th className="text-right">Margin × turnover × leverage</th>
            <th className="text-right">EPS growth</th>
            <th className="text-right">Div. yield</th>
            <th className="text-right">Implied</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const q = x.q;
            return (
              <tr key={x.symbol}>
                <td>
                  <Link href={x.held ? `/holdings/${x.symbol}` : `/stock/${x.symbol}`} className="font-semibold hover:underline">{x.symbol}</Link>
                  <div className="text-[11px] text-muted truncate max-w-[160px]">{x.sector}</div>
                </td>
                {showWeight && <td className="text-right mono-num">{x.weightPct != null ? `${x.weightPct.toFixed(1)}%` : "—"}</td>}
                <td className="text-center"><GradeBadge grade={q.grade} /></td>
                <td><QuadrantPill quadrant={q.quadrant} /></td>
                <td className="text-right mono-num">{mult(q.pe)}</td>
                <td className="text-right mono-num" title={q.capeYears ? `${q.capeYears} years` : undefined}>{mult(q.cape)}</td>
                <td className="text-right mono-num">{mult(q.pb, 2)}</td>
                <td className="text-right mono-num" style={{ color: q.pb != null && q.justifiedPb != null ? (q.pb <= q.justifiedPb ? "var(--positive)" : "var(--muted)") : undefined }}>{mult(q.justifiedPb, 2)}</td>
                <td className="text-right mono-num">{rate(q.roePct)}{q.bookSource === "manual" && <span className="text-muted" title="from the book value entered on the holding">*</span>}</td>
                <td className="text-right mono-num" style={{ color: toneOf(q.spreadPp) }}>{signed(q.spreadPp, 1, " pp")}</td>
                <td className="text-right mono-num text-[12px] whitespace-nowrap">{q.dupont ? `${q.dupont.netMarginPct.toFixed(1)}% × ${q.dupont.assetTurnover.toFixed(2)} × ${q.dupont.equityMultiplier.toFixed(2)}` : "—"}</td>
                <td className="text-right mono-num" style={{ color: toneOf(q.epsCagrPct) }}>{signed(q.epsCagrPct)}</td>
                <td className="text-right mono-num">{rate(q.dividendYieldPct)}</td>
                <td className="text-right mono-num" style={{ color: q.impliedReturnPct == null ? undefined : q.impliedReturnPct >= r ? "var(--positive)" : "var(--negative)" }}>{rate(q.impliedReturnPct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.some((x) => x.q.bookSource === "manual") && <p className="text-[11px] text-muted mt-2 px-2">* ROE from the book value per share entered on the holding.</p>}
    </div>
  );
}
