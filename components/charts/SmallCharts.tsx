import type { DailyPnl } from "@/lib/analytics/performance";

// Small server-rendered SVG charts for the analytics page: the drawdown as a
// filled area under zero, and daily profit as bars.

export function DrawdownChart({ series, height = 180 }: { series: Array<{ date: string; dd: number }>; height?: number }) {
  if (series.length < 2) return <div className="text-[12px] text-muted">Not enough history.</div>;
  const W = 600, H = height, L = 40, T = 8, B = 20;
  const plotW = W - L - 8, plotH = H - T - B;
  const min = Math.min(-0.02, ...series.map((s) => s.dd));
  const x = (i: number) => L + (i / (series.length - 1)) * plotW;
  const y = (v: number) => T + ((0 - v) / (0 - min)) * plotH;
  const line = series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.dd).toFixed(1)}`).join(" ");
  const area = `${line} L${x(series.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, min / 2, min];
  const labels: number[] = [];
  for (let i = 1; i < series.length; i++) if (series[i].date.slice(0, 7) !== series[i - 1].date.slice(0, 7)) labels.push(i);
  const every = Math.max(1, Math.ceil(labels.length / 6));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeDasharray="2 4" />
          <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{`${(t * 100).toFixed(0)}%`}</text>
        </g>
      ))}
      <path d={area} fill="var(--negative)" opacity="0.18" />
      <path d={line} fill="none" stroke="var(--negative)" strokeWidth="1.5" />
      {labels.filter((_, k) => k % every === 0).map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{series[i].date.slice(2, 7)}</text>
      ))}
    </svg>
  );
}

export function DailyBars({ days, height = 160 }: { days: DailyPnl[]; height?: number }) {
  if (days.length === 0) return null;
  const W = 800, H = height, L = 52, T = 8, B = 20;
  const plotW = W - L - 8, plotH = H - T - B;
  const lim = Math.max(1, ...days.map((d) => Math.abs(d.profit)));
  const zero = T + plotH / 2;
  const y = (v: number) => zero - (v / lim) * (plotH / 2);
  const slot = plotW / days.length;
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
      {[lim, 0, -lim].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeDasharray={t === 0 ? "" : "2 4"} />
          <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{`${t > 0 ? "+" : ""}${fmt(t)}`}</text>
        </g>
      ))}
      {days.map((d, i) => (
        <rect key={d.date} x={L + i * slot + slot * 0.2} y={Math.min(y(d.profit), zero)} width={slot * 0.6} height={Math.max(1, Math.abs(y(d.profit) - zero))} fill={d.profit >= 0 ? "var(--positive)" : "var(--negative)"} rx="1.5">
          <title>{`${d.date}: ${d.profit >= 0 ? "+" : ""}${Math.round(d.profit).toLocaleString()} (${(d.ret * 100).toFixed(2)}%)`}</title>
        </rect>
      ))}
      {days.map((d, i) => (i % Math.ceil(days.length / 8) === 0 ? <text key={d.date} x={L + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.date.slice(5)}</text> : null))}
    </svg>
  );
}
