import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Badge } from "@/components/ui/Badge";
import { getRating, getPatterns, getNews } from "@/lib/analytics";
import { fmtRs } from "@/lib/format";
import { EventRecordCard } from "@/app/holdings/[symbol]/EventRecordCard";
import { getEventRecord } from "@/lib/quant/event-record";

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
        <span className="font-display mono-num text-[22px]" style={{ color }}>{value}<span className="text-[12px] text-muted">/{max}</span></span>
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

export default async function StockPage(props: { params: Promise<{ symbol: string }> }) {
  const params = await props.params;
  const sym = params.symbol.toUpperCase();
  const [d, pat, news, eventRecord] = await Promise.all([getRating(sym), getPatterns(sym), getNews(sym, 5), getEventRecord(sym).catch(() => null)]);
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

      <Section number="01" title="AI rating" display={`${r.overall}/100 — ${r.verdict}`} description={`Overall = 40% Fundamental + 30% Technical + 20% Safety + 10% News. News score ${r.scores.news}/100 from tagged press coverage (neutral 50 when under 2 recent articles).`}>
        <div className="flex items-center gap-4 mb-6">
          <div className="font-display mono-num text-[56px] leading-none">{r.overall}</div>
          <div>
            <div className="text-[22px]" style={{ color: "var(--accent)" }} title={`${r.stars}/5`}>{"★".repeat(Math.floor(r.stars))}<span style={{ color: "var(--rule)" }}>{"★".repeat(5 - Math.floor(r.stars))}</span></div>
            <Badge tone={tone as any}>{r.verdict}</Badge>
          </div>
          <div className="ml-auto text-right">
            <div className="label-cap">Price</div>
            <div className="font-display mono-num text-[24px]">{fmtRs(d.price ?? 0, true)}</div>
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

      <Section number="03" title="Chart patterns" description="Reversal and continuation shapes detected from the recent price swings. A heuristic, not a signal — confirm with volume.">
        {pat && pat.patterns && pat.patterns.length > 0 ? (
          <div className="space-y-2">
            {pat.patterns.map((p, i) => {
              const bull = p.direction === "bullish";
              const color = bull ? "var(--positive)" : "var(--negative)";
              return (
                <div key={i} className="flex items-center gap-3 border border-rule px-3 py-2" style={{ background: "var(--paper-2)" }}>
                  <span className="font-medium text-[13px]">{p.pattern}</span>
                  <span className="font-mono text-[11px] uppercase" style={{ color }}>{bull ? "bullish" : "bearish"}</span>
                  {p.triggered && <span className="font-mono text-[10px] uppercase tracking-stat px-1.5 py-0.5" style={{ background: color, color: "var(--paper)" }}>triggered</span>}
                  <span className="text-muted text-[12px] ml-auto">{p.note}</span>
                  <span className="font-mono mono-num text-[12px] text-muted">{Math.round(p.confidence * 100)}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted text-sm">No clean chart pattern on {sym} right now.</p>
        )}
      </Section>
      <Section number="04" title="Latest coverage" description="Stories our news desk confidently tagged to this company (headline-matched, transparent sentiment). These feed the rating's news score.">
        {news && news.articles.length > 0 ? (
          <div className="space-y-3">
            {news.articles.map((a) => (
              <div key={a.url} className="flex items-baseline gap-3 flex-wrap">
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-[14px] hover:text-[var(--accent-deep)]">{a.title}</a>
                <span className="font-mono text-[10px] uppercase tracking-stat text-muted">{a.source}</span>
                <span className="font-mono text-[10px] uppercase tracking-stat" style={{ color: a.sentiment > 0.15 ? "var(--positive)" : a.sentiment < -0.15 ? "var(--negative)" : "var(--muted)" }}>
                  {a.sentiment > 0.15 ? "positive" : a.sentiment < -0.15 ? "negative" : "neutral"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm">No recent coverage tagged to {sym} — its news score stays neutral (50) rather than guessed.</p>
        )}
      </Section>
      <Section number="05" title="Dividends, bonuses and splits" description="Every payout, bonus issue and split on the exchange's own record, with the price against the market in the 20 sessions before the ex-date and the 5 and 20 after.">
        <EventRecordCard record={eventRecord} />
      </Section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (<><dt className="text-muted">{k}</dt><dd className="font-mono mono-num text-right">{v}</dd></>);
}
