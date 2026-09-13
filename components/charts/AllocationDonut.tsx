import { fmtPct, fmtRs } from "@/lib/format";

// Dependency-free SVG donut. Each slice is an arc rotated to its start angle,
// so we never fight stroke-dashoffset math. Server-renderable (no client JS).
export type DonutSlice = { label: string; value: number };

// Fixed order — slot N always means the same slice, so a filter that drops a
// series never repaints the survivors.
const PALETTE = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
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
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <svg viewBox="0 0 180 180" width={150} height={150} className="shrink-0">
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

      <ul className="flex-1 min-w-0 w-full grid grid-cols-1 gap-y-0.5 text-[12px]">
        {display.map((s, i) => (
          <li key={s.label} className="flex items-center justify-between py-1 gap-3" title={fmtRs(s.value)}>
            <span className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-2 h-2 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="text-muted leading-tight">{s.label}</span>
            </span>
            <span className="mono-num shrink-0 font-medium">{fmtPct(s.value / total, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
