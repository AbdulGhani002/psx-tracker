import type { ValuationMethod } from "@/lib/calculations/intrinsic";

// A "football field" dot-plot: every valuation method placed on one shared
// rupee scale, with the current price (ink, dashed) and the blended intrinsic
// value (accent) drawn as vertical reference lines. At a glance you see which
// methods say the stock is worth more than today's price (a buy) and which say
// less (expensive), and how tightly they agree.
export function FootballField({
  methods,
  price,
  intrinsic,
}: {
  methods: ValuationMethod[];
  price: number;
  intrinsic: number | null;
}) {
  const rows = methods.filter((m) => m.value != null && m.value > 0);
  if (!rows.length || intrinsic == null) return null;

  const vals = rows.map((m) => m.value as number);
  const lo = Math.min(...vals, price) * 0.92;
  const hi = Math.max(...vals, price) * 1.08;
  const span = hi - lo || 1;

  const W = 720;
  const L = 168; // label gutter
  const R = 28;
  const plot = W - L - R;
  const rowH = 26;
  const top = 14;
  const H = top + rows.length * rowH + 44;
  const x = (v: number) => L + ((v - lo) / span) * plot;

  const priceX = x(price);
  const intrinsicX = x(intrinsic);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Valuation methods vs price">
      {/* baseline grid */}
      <line x1={L} y1={top} x2={L} y2={top + rows.length * rowH} stroke="var(--rule)" strokeWidth="1" />

      {/* intrinsic value band: from the lowest to highest estimate */}
      <rect x={x(Math.min(...vals))} y={top} width={Math.max(2, x(Math.max(...vals)) - x(Math.min(...vals)))} height={rows.length * rowH} fill="var(--accent)" opacity={0.08} />

      {/* price line */}
      <line x1={priceX} y1={top - 4} x2={priceX} y2={top + rows.length * rowH + 6} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="3 3" />
      {/* intrinsic line */}
      <line x1={intrinsicX} y1={top - 4} x2={intrinsicX} y2={top + rows.length * rowH + 6} stroke="var(--accent-deep)" strokeWidth="2" />

      {rows.map((m, i) => {
        const cy = top + i * rowH + rowH / 2;
        const cx = x(m.value as number);
        const cheap = (m.value as number) >= price; // method values it above price → undervalued
        const excluded = m.included === false;
        return (
          <g key={m.key} opacity={excluded ? 0.4 : 1}>
            <text x={L - 10} y={cy + 3.5} textAnchor="end" fontSize="11" fill="var(--muted)" className="font-mono" style={excluded ? { textDecoration: "line-through" } : undefined}>
              {m.label}
            </text>
            <line x1={L} y1={cy} x2={cx} y2={cy} stroke="var(--rule)" strokeWidth="1" />
            {excluded ? (
              <circle cx={cx} cy={cy} r="4" fill="none" stroke="var(--muted)" strokeWidth="1.5" />
            ) : (
              <circle cx={cx} cy={cy} r="4.5" fill={cheap ? "var(--positive)" : "var(--negative)"} />
            )}
            <text x={cx + (cx > W - 70 ? -9 : 9)} y={cy + 3.5} textAnchor={cx > W - 70 ? "end" : "start"} fontSize="10.5" fill="var(--ink)" className="font-mono">
              {(m.value as number).toFixed(1)}
            </text>
          </g>
        );
      })}

      {/* legends */}
      <g>
        <text x={priceX} y={H - 24} textAnchor="middle" fontSize="9.5" fill="var(--ink)" className="font-mono" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
          price {price.toFixed(1)}
        </text>
        <text x={intrinsicX} y={H - 9} textAnchor="middle" fontSize="9.5" fill="var(--accent-deep)" className="font-mono" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
          intrinsic {intrinsic.toFixed(1)}
        </text>
      </g>
    </svg>
  );
}
