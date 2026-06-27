import type { ZoneLabel } from "@/lib/calculations/intrinsic";
import { fmtRs } from "@/lib/format";

const ZONE_COLORS: Record<string, string> = {
  "strong buy": "#4f7a4a",
  buy: "#8fa07f",
  fair: "#d4a574",
  expensive: "#c87b68",
};

// A horizontal "where does today's price sit" gauge. The bar is split into the
// four price zones (strong buy / buy / fair / expensive) by the computed
// thresholds, and a marker drops the live price onto it.
export function ZoneBar({
  price,
  strongBuyBelow,
  buyBelow,
  fairUpTo,
  intrinsic,
  zone,
}: {
  price: number;
  strongBuyBelow: number | null;
  buyBelow: number | null;
  fairUpTo: number | null;
  intrinsic: number | null;
  zone: ZoneLabel;
}) {
  if (strongBuyBelow == null || buyBelow == null || fairUpTo == null || intrinsic == null) return null;

  // Scale gives a little room either side so the marker is never at the edge.
  const lo = Math.min(strongBuyBelow * 0.8, price * 0.95);
  const hi = Math.max(fairUpTo * 1.35, price * 1.05);
  const span = hi - lo || 1;
  const W = 720;
  const H = 64;
  const barY = 16;
  const barH = 20;
  const pos = (v: number) => ((v - lo) / span) * W;

  const segs = [
    { from: lo, to: strongBuyBelow, color: ZONE_COLORS["strong buy"], label: "Strong buy" },
    { from: strongBuyBelow, to: buyBelow, color: ZONE_COLORS.buy, label: "Buy" },
    { from: buyBelow, to: fairUpTo, color: ZONE_COLORS.fair, label: "Fair" },
    { from: fairUpTo, to: hi, color: ZONE_COLORS.expensive, label: "Expensive" },
  ];
  const priceX = Math.max(2, Math.min(W - 2, pos(price)));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Buying zone gauge">
        {segs.map((s) => {
          const x = pos(s.from);
          const w = Math.max(0, pos(s.to) - x);
          const mid = x + w / 2;
          return (
            <g key={s.label}>
              <rect x={x} y={barY} width={w} height={barH} fill={s.color} opacity={zone === s.label.toLowerCase() ? 1 : 0.45} />
              {w > 60 && (
                <text x={mid} y={barY + barH + 13} textAnchor="middle" fontSize="9.5" fill="var(--muted)" className="font-mono" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
        {/* intrinsic tick */}
        <line x1={pos(intrinsic)} y1={barY - 5} x2={pos(intrinsic)} y2={barY + barH + 5} stroke="var(--accent-deep)" strokeWidth="1.5" />
        {/* price marker */}
        <polygon points={`${priceX},${barY - 2} ${priceX - 6},${barY - 12} ${priceX + 6},${barY - 12}`} fill="var(--ink)" />
        <line x1={priceX} y1={barY - 2} x2={priceX} y2={barY + barH + 2} stroke="var(--ink)" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-[11px] text-muted mt-1 font-mono">
        <span>Strong buy ≤ {fmtRs(strongBuyBelow, true)}</span>
        <span>Buy ≤ {fmtRs(buyBelow, true)}</span>
        <span style={{ color: "var(--accent-deep)" }}>Intrinsic {fmtRs(intrinsic, true)}</span>
      </div>
    </div>
  );
}
