import type { Sensitivity } from "@/lib/calculations/intrinsic";

// A tornado chart: for each assumption (growth, required return, fair P/E), a
// bar showing how far the intrinsic value swings when that one input moves,
// centred on the base value. The widest bar is what your valuation hinges on.
export function Tornado({ rows, base }: { rows: Sensitivity[]; base: number }) {
  if (!rows.length) return null;
  const lo = Math.min(...rows.map((r) => Math.min(r.low, r.high)), base) * 0.97;
  const hi = Math.max(...rows.map((r) => Math.max(r.low, r.high)), base) * 1.03;
  const span = hi - lo || 1;

  const W = 720;
  const L = 150;
  const R = 16;
  const plot = W - L - R;
  const rowH = 34;
  const T = 8;
  const H = T + rows.length * rowH + 22;
  const x = (v: number) => L + ((v - lo) / span) * plot;
  const baseX = x(base);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Intrinsic value sensitivity">
      {/* base (intrinsic) line */}
      <line x1={baseX} y1={T} x2={baseX} y2={T + rows.length * rowH} stroke="var(--accent-deep)" strokeWidth="1.5" />

      {rows.map((r, i) => {
        const cy = T + i * rowH + rowH / 2;
        const xLow = x(r.low);
        const xHigh = x(r.high);
        const left = Math.min(xLow, xHigh);
        const right = Math.max(xLow, xHigh);
        return (
          <g key={r.label}>
            <text x={L - 10} y={cy + 3.5} textAnchor="end" fontSize="11" fill="var(--ink)" className="font-mono">
              {r.label}
            </text>
            {/* downside (left of base) */}
            <rect x={left} y={cy - 8} width={Math.max(0, baseX - left)} height={16} fill="var(--negative)" opacity={0.55} />
            {/* upside (right of base) */}
            <rect x={baseX} y={cy - 8} width={Math.max(0, right - baseX)} height={16} fill="var(--positive)" opacity={0.55} />
            <text x={left - 5} y={cy + 3.5} textAnchor="end" fontSize="9.5" fill="var(--muted)" className="font-mono">
              {r.loLabel}
            </text>
            <text x={right + 5} y={cy + 3.5} textAnchor="start" fontSize="9.5" fill="var(--muted)" className="font-mono">
              {r.hiLabel}
            </text>
          </g>
        );
      })}
      <text x={baseX} y={H - 6} textAnchor="middle" fontSize="9.5" fill="var(--accent-deep)" className="font-mono" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
        intrinsic {base.toFixed(1)}
      </text>
    </svg>
  );
}
