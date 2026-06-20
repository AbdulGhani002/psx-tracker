import { fmtPct, fmtRs } from "@/lib/format";

// Dependency-free SVG donut. Each slice is an arc rotated to its start angle,
// so we never fight stroke-dashoffset math. Server-renderable (no client JS).
export type DonutSlice = { label: string; value: number };

const PALETTE = [
  "var(--accent-deep)",
  "var(--accent)",
  "var(--amber)",
  "#7a8a6a",
  "#a85a4a",
  "#6a7f9c",
  "#c08a3e",
  "#8a6a9c",
  "#5a554a",
  "#9aae7a",
];

export function AllocationDonut({
  slices,
  maxSlices = 8,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  maxSlices?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const clean = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = clean.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;

  // Collapse the long tail into "Other".
  let display = clean;
  if (clean.length > maxSlices) {
    const head = clean.slice(0, maxSlices - 1);
    const tail = clean.slice(maxSlices - 1);
    const otherVal = tail.reduce((s, x) => s + x.value, 0);
    display = [...head, { label: `Other (${tail.length})`, value: otherVal }];
  }

  const r = 70;
  const cx = 90;
  const cy = 90;
  const C = 2 * Math.PI * r;
  let startDeg = 0;
  const GAP = 1.2; // px gap between arcs

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg viewBox="0 0 180 180" width={180} height={180} className="shrink-0">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {display.map((s, i) => {
            const frac = s.value / total;
            const dash = Math.max(frac * C - GAP, 0.5);
            const seg = (
              <g key={s.label} transform={`rotate(${startDeg} ${cx} ${cy})`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={26}
                  strokeDasharray={`${dash} ${C - dash}`}
                >
                  <title>{`${s.label}: ${fmtPct(frac, 1)} (${fmtRs(s.value)})`}</title>
                </circle>
              </g>
            );
            startDeg += frac * 360;
            return seg;
          })}
        </g>
        {(centerValue || centerLabel) && (
          <>
            {centerValue && (
              <text x={cx} y={centerLabel ? cy - 2 : cy + 4} textAnchor="middle" className="font-mono" style={{ fontSize: 15, fontWeight: 600, fill: "var(--ink)" }}>
                {centerValue}
              </text>
            )}
            {centerLabel && (
              <text x={cx} y={cy + 14} textAnchor="middle" style={{ fontSize: 8, letterSpacing: 1, fill: "var(--muted)", textTransform: "uppercase" }}>
                {centerLabel}
              </text>
            )}
          </>
        )}
      </svg>

      <ul className="flex-1 min-w-0 w-full grid grid-cols-1 gap-y-1 text-[12px]">
        {display.map((s, i) => (
          <li key={s.label} className="flex items-baseline justify-between border-b border-rule py-1.5 gap-3">
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="inline-block w-2.5 h-2.5 mt-0.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="font-mono mono-num shrink-0">
              {fmtPct(s.value / total, 1)} <span className="text-muted ml-2">{fmtRs(s.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
