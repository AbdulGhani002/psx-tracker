import type { MonthlyTable } from "@/lib/analytics/performance";

// Monthly returns as a grid: years down, months across, the year's figure at
// the end. Green for a month up, red for a month down, deeper with size.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shade(r: number | undefined): { bg: string; fg: string } {
  if (r == null) return { bg: "var(--surface-2)", fg: "var(--muted)" };
  const a = Math.min(1, Math.abs(r) / 0.12); // 12% saturates
  const alpha = 0.15 + a * 0.75;
  return r >= 0 ? { bg: `color-mix(in srgb, var(--positive) ${Math.round(alpha * 100)}%, transparent)`, fg: "var(--ink)" } : { bg: `color-mix(in srgb, var(--negative) ${Math.round(alpha * 100)}%, transparent)`, fg: "var(--ink)" };
}

export function Heatmap({ table, years, title }: { table: MonthlyTable; years?: number; title?: string }) {
  const ys = years ? table.years.slice(0, years) : table.years;
  if (ys.length === 0) return <div className="text-[12px] text-muted">No months yet.</div>;
  return (
    <div className="overflow-x-auto">
      {title && <div className="label-cap mb-2">{title}</div>}
      <div className="heat" style={{ minWidth: 720 }}>
        <div />
        {MONTHS.map((m) => (
          <div key={m} className="text-center text-muted pb-1">{m}</div>
        ))}
        <div className="text-center text-muted pb-1">Year</div>
        {ys.map((y) => (
          <YearRow key={y} y={y} table={table} />
        ))}
      </div>
    </div>
  );
}

function YearRow({ y, table }: { y: number; table: MonthlyTable }) {
  const ytd = table.ytd.get(y);
  const ys = shade(ytd);
  return (
    <>
      <div className="text-muted py-1.5 pl-1">{y}</div>
      {MONTHS.map((_, i) => {
        const r = table.cells.get(`${y}-${String(i + 1).padStart(2, "0")}`);
        const s = shade(r);
        return (
          <div key={i} className="cell" style={{ background: s.bg, color: s.fg }} title={r == null ? "" : `${y} ${MONTHS[i]}: ${(r * 100).toFixed(2)}%`}>
            {r == null ? "" : `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}`}
          </div>
        );
      })}
      <div className="cell font-semibold" style={{ background: ys.bg, color: ys.fg }}>
        {ytd == null ? "" : `${ytd >= 0 ? "+" : ""}${(ytd * 100).toFixed(1)}%`}
      </div>
    </>
  );
}

// Two series month by month as paired bars: the portfolio and the market.
export function MonthlyBars({ a, b, months = 24, labelA = "Portfolio", labelB = "KSE-100" }: { a: MonthlyTable; b: MonthlyTable; months?: number; labelA?: string; labelB?: string }) {
  const keys = [...a.cells.keys()].sort().slice(-months);
  if (keys.length === 0) return <div className="text-[12px] text-muted">No months yet.</div>;
  const vals = keys.flatMap((k) => [a.cells.get(k) ?? 0, b.cells.get(k) ?? 0]);
  const lim = Math.max(0.02, ...vals.map((v) => Math.abs(v)));
  const W = Math.max(600, keys.length * 34), H = 200, T = 10, B = 24, L = 40;
  const plotH = H - T - B;
  const zero = T + plotH / 2;
  const y = (v: number) => zero - (v / lim) * (plotH / 2);
  const slot = (W - L) / keys.length;
  return (
    <div className="overflow-x-auto">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 600 }}>
        {[lim, lim / 2, 0, -lim / 2, -lim].map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeDasharray={t === 0 ? "" : "2 4"} />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{`${t >= 0 ? "+" : ""}${(t * 100).toFixed(0)}%`}</text>
          </g>
        ))}
        {keys.map((k, i) => {
          const va = a.cells.get(k) ?? 0, vb = b.cells.get(k) ?? 0;
          const x0 = L + i * slot + slot * 0.15;
          const bw = slot * 0.32;
          return (
            <g key={k}>
              <rect x={x0} y={Math.min(y(va), zero)} width={bw} height={Math.abs(y(va) - zero)} fill={va >= 0 ? "var(--positive)" : "var(--negative)"} rx="2">
                <title>{`${k} ${labelA}: ${(va * 100).toFixed(2)}%`}</title>
              </rect>
              <rect x={x0 + bw + 2} y={Math.min(y(vb), zero)} width={bw} height={Math.abs(y(vb) - zero)} fill="var(--blue)" opacity="0.75" rx="2">
                <title>{`${k} ${labelB}: ${(vb * 100).toFixed(2)}%`}</title>
              </rect>
              {(i % Math.ceil(keys.length / 12) === 0 || i === keys.length - 1) && (
                <text x={x0 + bw} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{k.slice(2).replace("-", "/")}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 mt-1 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: "var(--positive)" }} /> {labelA} (green up, red down)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: "var(--blue)" }} /> {labelB}</span>
      </div>
    </div>
  );
}
