import Link from "next/link";

// Whole-market heatmap: each sector is a block (header coloured by its
// market-cap-weighted move), and inside it every stock is a tile, green→red by
// its day change. Size hints at weight. No external chart lib — pure CSS.
type Stock = { symbol: string; change_pct: number; market_cap_000: number };
type Sector = { sector: string; change_pct: number; market_cap_000: number; count: number; stocks: Stock[] };

function tint(change: number): string {
  const c = Math.max(-4, Math.min(4, change)) / 4; // clamp to ±4%
  if (c >= 0) return `color-mix(in srgb, var(--positive) ${Math.round(18 + c * 70)}%, var(--paper-2))`;
  return `color-mix(in srgb, var(--negative) ${Math.round(18 + -c * 70)}%, var(--paper-2))`;
}
function fg(change: number): string {
  return Math.abs(change) > 2.2 ? "#fff" : "var(--ink)";
}

export function SectorHeatmap({ sectors }: { sectors: Sector[] }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {sectors.map((sec) => (
        <div key={sec.sector} className="border border-rule overflow-hidden">
          <div className="flex items-baseline justify-between px-3 py-2" style={{ background: tint(sec.change_pct) }}>
            <span className="font-mono text-[12px] font-medium truncate" style={{ color: fg(sec.change_pct) }}>{sec.sector}</span>
            <span className="font-mono mono-num text-[13px] font-semibold" style={{ color: fg(sec.change_pct) }}>{sec.change_pct >= 0 ? "+" : ""}{sec.change_pct.toFixed(2)}%</span>
          </div>
          <div className="flex flex-wrap gap-px p-1" style={{ background: "var(--rule)" }}>
            {sec.stocks.map((s) => (
              <Link
                key={s.symbol}
                href={`/stock/${s.symbol}`}
                title={`${s.symbol} ${s.change_pct >= 0 ? "+" : ""}${s.change_pct.toFixed(2)}%`}
                className="flex flex-col items-center justify-center px-2 py-1.5 grow min-w-[58px] hover:outline hover:outline-1 hover:outline-[var(--ink)]"
                style={{ background: tint(s.change_pct) }}
              >
                <span className="font-mono text-[11px] font-medium leading-tight" style={{ color: fg(s.change_pct) }}>{s.symbol}</span>
                <span className="font-mono mono-num text-[10px] leading-tight" style={{ color: fg(s.change_pct) }}>{s.change_pct >= 0 ? "+" : ""}{s.change_pct.toFixed(1)}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
