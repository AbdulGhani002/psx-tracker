import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Badge } from "@/components/ui/Badge";
import { getRating } from "@/lib/analytics";
import { fmtRs } from "@/lib/format";

export const dynamic = "force-dynamic";

function num(v: any, suffix = "", d = 1) {
  return v == null ? "—" : `${Number(v).toFixed(d)}${suffix}`;
}

function SubScore({ label, value, max = 100, reasons, invert }: { label: string; value: number; max?: number; reasons?: string[]; invert?: boolean }) {
  const good = invert ? value <= 40 : value >= 60;
  const mid = invert ? value <= 60 : value >= 45;
  const color = good ? "var(--positive)" : mid ? "var(--amber)" : "var(--negative)";
  return (
    <div className="border border-rule p-4" style={{ background: "var(--paper-2)" }}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="label-cap">{label}</span>
        <span className="font-display mono-num text-[22px]" style={{ fontVariationSettings: "'opsz' 144", color }}>{value}<span className="text-[12px] text-muted">/{max}</span></span>
      </div>
      <span className="block h-1.5 w-full rounded-sm overflow-hidden mb-2" style={{ background: "var(--rule)" }}>
        <span className="block h-full" style={{ width: `${value}%`, background: color }} />
      </span>
      {reasons && reasons.length > 0 && (
        <ul className="space-y-1 text-[12px] text-muted">
          {reasons.slice(0, 4).map((r, i) => <li key={i} className="flex gap-1.5"><span style={{ color: "var(--accent-deep)" }}>·</span><span>{r}</span></li>)}
        </ul>
      )}
    </div>
  );
}

export default async function StockPage({ params }: { params: { symbol: string } }) {
  const sym = params.symbol.toUpperCase();
  const d = await getRating(sym);
  if (!d || d.error) {
    return (
      <div className="fade-in">
        <PageHeader eyebrow="Market · AI" title={`${sym} — no rating yet.`} subtitle="This symbol isn't in the analytics universe yet (it may still be collecting). Try again shortly." />
        <Link href="/ratings" className="font-mono text-[12px] text-muted hover:text-[var(--accent-deep)]">← All ratings</Link>
      </div>
    );
  }
  const r = d.rating, ind = d.indicators || {}, f = d.fundamentals || {};
  const tone = r.verdict === "strong" || r.verdict === "good" ? "positive" : r.verdict === "weak" ? "negative" : "default";

  return (
    <div className="fade-in">
      <PageHeader eyebrow={`Market · AI · ${d.sector || ""}`} title={`${sym} — ${d.name || ""}`} subtitle="The AI rating, fully broken down: every sub-score and the reasons behind it, plus the technicals and fundamentals it read.">
        <Link href="/ratings" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">← Ratings</Link>
      </PageHeader>

      <Section number="01" title="AI rating" display={`${r.overall}/100 — ${r.verdict}`} description="Overall = 40% Fundamental + 30% Technical + 20% Safety + 10% News. News is neutral (50) until the news engine lands.">
        <div className="flex items-center gap-4 mb-6">
          <div className="font-display mono-num text-[56px] leading-none" style={{ fontVariationSettings: "'opsz' 144" }}>{r.overall}</div>
          <div>
            <div className="text-[22px]" style={{ color: "var(--accent)" }} title={`${r.stars}/5`}>{"★".repeat(Math.floor(r.stars))}<span style={{ color: "var(--rule)" }}>{"★".repeat(5 - Math.floor(r.stars))}</span></div>
            <Badge tone={tone as any}>{r.verdict}</Badge>
          </div>
          <div className="ml-auto text-right">
            <div className="label-cap">Price</div>
            <div className="font-display mono-num text-[24px]" style={{ fontVariationSettings: "'opsz' 144" }}>{fmtRs(d.price ?? 0, true)}</div>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <SubScore label="Fundamental" value={r.scores.fundamental} reasons={r.reasons.fundamental} />
          <SubScore label="Technical" value={r.scores.technical} reasons={r.reasons.technical} />
          <SubScore label="Risk (higher = riskier)" value={r.scores.risk} reasons={r.reasons.risk} invert />
        </div>
      </Section>

      <Section number="02" title="The numbers it read" description="Live technicals and the latest fundamentals from the database.">
        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <div className="label-cap mb-2">Technicals</div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <Row k="RSI (14)" v={num(ind.rsi14, "", 0)} />
              <Row k="MACD hist" v={num(ind.macd_hist, "", 2)} />
              <Row k="Above SMA-50" v={ind.above_sma50 ? "yes" : "no"} />
              <Row k="Above SMA-200" v={ind.above_sma200 ? "yes" : "no"} />
              <Row k="1-month return" v={num(ind.ret_1m, "%")} />
              <Row k="12-month return" v={num(ind.ret_12m, "%")} />
              <Row k="Volatility (ann.)" v={num(ind.volatility_pct, "%", 0)} />
              <Row k="Beta" v={num(ind.beta, "", 2)} />
              <Row k="Volume spike" v={ind.vol_spike == null ? "—" : `${ind.vol_spike.toFixed(1)}×`} />
              <Row k="52-week position" v={ind.week52 ? num(ind.week52.position_pct, "%", 0) : "—"} />
            </dl>
          </div>
          <div>
            <div className="label-cap mb-2">Fundamentals</div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <Row k="P/E" v={f.pe == null ? "—" : `${f.pe.toFixed(1)}×`} />
              <Row k="Earnings yield" v={num(f.earnings_yield_pct, "%", 0)} />
              <Row k="Dividend yield" v={num(f.dividend_yield_pct, "%")} />
              <Row k="Net margin" v={num(f.net_margin_pct, "%")} />
              <Row k="Margin trend" v={num(f.margin_trend_pp, "pp")} />
              <Row k="EPS growth (yoy)" v={num(f.eps_growth_pct, "%")} />
              <Row k="EPS CAGR" v={num(f.eps_cagr_pct, "%")} />
              <Row k="Revenue growth" v={num(f.revenue_growth_pct, "%")} />
              <Row k="P/B" v={f.pb == null ? "needs book value" : `${f.pb.toFixed(1)}×`} />
              <Row k="ROE" v={f.roe_pct == null ? "needs book value" : num(f.roe_pct, "%")} />
            </dl>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (<><dt className="text-muted">{k}</dt><dd className="font-mono mono-num text-right">{v}</dd></>);
}
