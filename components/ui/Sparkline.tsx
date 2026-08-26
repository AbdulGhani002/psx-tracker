// A 90-day price trend, small enough to sit in a table row.
//
// No axis, no grid, no tooltip: at this size those are noise, and the figures
// beside it already carry the precision. It answers one question — which way
// has this been going — and the colour follows the direction of the window, not
// the position's profit, so a name bought well that is currently sliding still
// shows as sliding.
//
// Drawn only when there are enough points to mean something. Two prices are not
// a trend, and a line through them would imply one.
export function Sparkline({
  points,
  width = 62,
  height = 18,
  className = "",
}: {
  points: number[] | undefined;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!points || points.length < 5) {
    return <span className={`inline-block ${className}`} style={{ width, height }} aria-hidden />;
  }
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo;
  const pad = 1.5;
  const h = height - pad * 2;
  // A dead-flat series would divide by zero; draw it down the middle instead.
  const y = (v: number) => (span === 0 ? height / 2 : pad + h - ((v - lo) / span) * h);
  const x = (i: number) => (i / (points.length - 1)) * (width - 1) + 0.5;
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const rising = points[points.length - 1] >= points[0];
  const stroke = rising ? "var(--positive)" : "var(--negative)";
  return (
    <svg
      className={`inline-block align-middle ${className}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${rising ? "Rising" : "falling"} over the window`}
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="1.6" fill={stroke} />
    </svg>
  );
}
