// Two payout charts, drawn as plain SVG the way Zar draws them: net dividends
// per month stacked by asset in shades of blue, and the life-to-date total
// per asset as teal bars.

const BLUES = ["#1e3a8a", "#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];

const fmtK = (v: number) => (v >= 1e6 ? `Rs ${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `Rs ${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}K` : `Rs ${v.toFixed(0)}`);
const monthLabel = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${String(y).slice(2)}`;
};

export type MonthStack = { month: string; byAsset: Record<string, number> };

export function StackedPayoutBars({ months, assets, height = 220 }: { months: MonthStack[]; assets: string[]; height?: number }) {
  const W = 800, H = height, L = 60, T = 12, B = 26, R = 8;
  const plotW = W - L - R, plotH = H - T - B;
  const totals = months.map((m) => assets.reduce((s, a) => s + (m.byAsset[a] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const slot = plotW / Math.max(1, months.length);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0];
  const color = (a: string) => BLUES[assets.indexOf(a) % BLUES.length];
  const every = months.length > 18 ? 3 : months.length > 9 ? 2 : 1;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeDasharray={t === 0 ? "" : "2 4"} />
            <text x={L - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)">{fmtK(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          let acc = 0;
          const x = L + i * slot + slot * 0.22, w = slot * 0.56;
          return (
            <g key={m.month}>
              {assets.map((a) => {
                const v = m.byAsset[a] ?? 0;
                if (v <= 0) return null;
                const y1 = y(acc + v), y0 = y(acc);
                acc += v;
                return <rect key={a} x={x} y={y1} width={w} height={Math.max(0, y0 - y1)} fill={color(a)} rx="1.5"><title>{`${monthLabel(m.month)} ${a}: Rs ${Math.round(v).toLocaleString()}`}</title></rect>;
              })}
              {i % every === 0 && <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{monthLabel(m.month)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center text-[11px] text-muted mt-1">
        {assets.map((a) => (
          <span key={a} className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color(a) }} />{a}</span>
        ))}
      </div>
    </div>
  );
}

export function AssetBars({ rows, height = 220 }: { rows: Array<{ label: string; value: number }>; height?: number }) {
  const W = 800, H = height, L = 60, T = 12, B = 26, R = 8;
  const plotW = W - L - R, plotH = H - T - B;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const slot = plotW / Math.max(1, rows.length);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeDasharray={t === 0 ? "" : "2 4"} />
          <text x={L - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)">{fmtK(t)}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const x = L + i * slot + slot * 0.25, w = slot * 0.5;
        return (
          <g key={r.label}>
            <rect x={x} y={y(r.value)} width={w} height={Math.max(0, T + plotH - y(r.value))} fill="var(--teal)" rx="2"><title>{`${r.label}: Rs ${Math.round(r.value).toLocaleString()}`}</title></rect>
            <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
