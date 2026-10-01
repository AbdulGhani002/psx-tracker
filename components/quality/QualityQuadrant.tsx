import type { QualityRow } from "@/lib/fundamentals/board";
import { QUADRANT_COLOR } from "./parts";

// Return on equity against the cycle-adjusted P/E, every company a dot: the
// horizontal line is the cost of equity, the vertical one the market's median
// multiple, so each name sits in the quadrant it is classed in. Held names
// are coloured by quadrant and sized by weight; the rest of the KSE-100 is the
// grey field they are judged against.

const W = 680, H = 380, L = 44, R = 14, T = 12, B = 36;
const X_MIN = Math.log(2), X_MAX = Math.log(40);
const Y_MIN = -10;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const X = (cape: number) => L + ((clamp(Math.log(cape), X_MIN, X_MAX) - X_MIN) / (X_MAX - X_MIN)) * (W - L - R);

export function QualityQuadrant({ rows, costOfEquityPct, marketMedianCape }: { rows: QualityRow[]; costOfEquityPct: number; marketMedianCape: number | null }) {
  const pts = rows.filter((r) => r.q.cape != null && r.q.cape > 0 && r.q.roePct != null);
  // The ROE scale reaches the highest holding and most of the field (a few
  // outliers above it sit on the top edge), in steps of ten.
  const field95 = pts.filter((r) => !r.held).map((r) => r.q.roePct!).sort((a, b) => a - b)[Math.floor(0.95 * Math.max(0, pts.filter((r) => !r.held).length - 1))] ?? 40;
  const topRoe = Math.max(field95, ...pts.filter((r) => r.held).map((r) => r.q.roePct!));
  const Y_MAX = Math.min(100, Math.max(50, Math.ceil((topRoe + 8) / 10) * 10));
  const Y = (roe: number) => T + (1 - (clamp(roe, Y_MIN, Y_MAX) - Y_MIN) / (Y_MAX - Y_MIN)) * (H - T - B);
  const yTicks: number[] = [];
  const yStep = Y_MAX - Y_MIN > 80 ? 20 : 10;
  for (let v = Math.ceil(Y_MIN / yStep) * yStep; v <= Y_MAX; v += yStep) yTicks.push(v);
  const held = pts.filter((r) => r.held).sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0));
  const field = pts.filter((r) => !r.held);
  const missing = rows.filter((r) => r.held && !(r.q.cape != null && r.q.cape > 0 && r.q.roePct != null)).map((r) => r.symbol);
  const xr = marketMedianCape ? X(marketMedianCape) : null;
  const yr = Y(costOfEquityPct);
  const tint = (c: string) => `color-mix(in srgb, ${c} 6%, transparent)`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Return on equity against the cycle-adjusted P/E">
        {xr != null && (
          <g>
            <rect x={L} y={T} width={xr - L} height={yr - T} fill={tint(QUADRANT_COLOR.compounder)} />
            <rect x={xr} y={T} width={W - R - xr} height={yr - T} fill={tint(QUADRANT_COLOR.premium)} />
            <rect x={L} y={yr} width={xr - L} height={H - B - yr} fill={tint(QUADRANT_COLOR.trap)} />
            <rect x={xr} y={yr} width={W - R - xr} height={H - B - yr} fill={tint(QUADRANT_COLOR.danger)} />
            <text x={L + 6} y={T + 14} fontSize="11" fontWeight="600" fill={QUADRANT_COLOR.compounder}>Undervalued compounders</text>
            <text x={W - R - 6} y={T + 14} fontSize="11" fontWeight="600" fill={QUADRANT_COLOR.premium} textAnchor="end">Quality at a premium</text>
            <text x={L + 6} y={H - B - 6} fontSize="11" fontWeight="600" fill={QUADRANT_COLOR.trap}>Possible value traps</text>
            <text x={W - R - 6} y={H - B - 6} fontSize="11" fontWeight="600" fill={QUADRANT_COLOR.danger} textAnchor="end">Poor and dear</text>
          </g>
        )}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--rule)" strokeWidth="0.6" />
            <text x={L - 6} y={Y(v) + 3.5} fontSize="10" fill="var(--muted)" textAnchor="end">{v}%</text>
          </g>
        ))}
        {[2.5, 5, 10, 20, 40].map((v) => (
          <g key={v}>
            <line x1={X(v)} x2={X(v)} y1={T} y2={H - B} stroke="var(--rule)" strokeWidth="0.6" />
            <text x={X(v)} y={H - B + 14} fontSize="10" fill="var(--muted)" textAnchor="middle">{v}×</text>
          </g>
        ))}
        <text x={(L + W - R) / 2} y={H - 4} fontSize="10.5" fill="var(--muted)" textAnchor="middle">Cycle-adjusted P/E (log scale)</text>
        <text x={12} y={(T + H - B) / 2} fontSize="10.5" fill="var(--muted)" textAnchor="middle" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>Return on equity</text>
        <line x1={L} x2={W - R} y1={yr} y2={yr} stroke="var(--ink)" strokeWidth="1" strokeDasharray="4 3" opacity="0.55" />
        <text x={W - R - 4} y={yr - 4} fontSize="10" fill="var(--ink)" textAnchor="end" opacity="0.7">cost of equity {costOfEquityPct.toFixed(1)}%</text>
        {xr != null && (
          <>
            <line x1={xr} x2={xr} y1={T} y2={H - B} stroke="var(--ink)" strokeWidth="1" strokeDasharray="4 3" opacity="0.55" />
            <text x={xr + 4} y={H - B - 20} fontSize="10" fill="var(--ink)" opacity="0.7">market median {marketMedianCape!.toFixed(1)}×</text>
          </>
        )}
        {field.map((r) => (
          <circle key={r.symbol} cx={X(r.q.cape!)} cy={Y(r.q.roePct!)} r="3" fill="var(--muted)" opacity="0.35">
            <title>{`${r.symbol}: ROE ${r.q.roePct!.toFixed(1)}%, CAPE ${r.q.cape!.toFixed(1)}×`}</title>
          </circle>
        ))}
        {held.map((r) => {
          const rad = Math.min(13, 4.5 + Math.sqrt(Math.max(0, r.weightPct ?? 0)) * 1.6);
          const c = r.q.quadrant ? QUADRANT_COLOR[r.q.quadrant] : "var(--ink)";
          const cx = X(r.q.cape!), cy = Y(r.q.roePct!);
          const right = cx < W - R - 60;
          return (
            <g key={r.symbol}>
              <circle cx={cx} cy={cy} r={rad} fill={c} fillOpacity="0.85" stroke="#fff" strokeWidth="1.5">
                <title>{`${r.symbol}: ROE ${r.q.roePct!.toFixed(1)}%, CAPE ${r.q.cape!.toFixed(1)}×, ${(r.weightPct ?? 0).toFixed(1)}% of the portfolio`}</title>
              </circle>
              <text x={right ? cx + rad + 3 : cx - rad - 3} y={cy + 3.5} fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor={right ? "start" : "end"}>{r.symbol}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--ink)" }} /> your holdings, sized by weight</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full opacity-40" style={{ background: "var(--muted)" }} /> the rest of the KSE-100</span>
        {missing.length > 0 && <span>Not plotted (no ROE or CAPE yet): {missing.join(", ")}</span>}
      </div>
    </div>
  );
}
