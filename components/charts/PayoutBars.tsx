// Net payouts per month as bars, with the month labels thinned to fit.
export function PayoutBars({ months, height = 200 }: { months: Array<{ month: string; amount: number }>; height?: number }) {
  const W = 800, H = height, L = 56, T = 10, B = 24;
  const plotW = W - L - 8, plotH = H - T - B;
  const max = Math.max(1, ...months.map((m) => m.amount));
  const slot = plotW / Math.max(1, months.length);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const fmt = (v: number) => (v >= 1e5 ? `${(v / 1e3).toFixed(0)}k` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0));
  const ticks = [max, max / 2, 0];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeDasharray={t === 0 ? "" : "2 4"} />
          <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{fmt(t)}</text>
        </g>
      ))}
      {months.map((m, i) => (
        <g key={m.month}>
          <rect x={L + i * slot + slot * 0.2} y={y(m.amount)} width={slot * 0.6} height={Math.max(0, T + plotH - y(m.amount))} fill="var(--positive)" rx="2" opacity={m.amount > 0 ? 0.95 : 0}>
            <title>{`${m.month}: ${Math.round(m.amount).toLocaleString()}`}</title>
          </rect>
          {i % 3 === 0 && <text x={L + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{m.month.slice(2).replace("-", "/")}</text>}
        </g>
      ))}
    </svg>
  );
}
