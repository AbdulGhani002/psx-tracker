"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { fmtRs } from "@/lib/format";
import type { RatedStock } from "@/lib/analytics";

function Stars({ n }: { n: number }) {
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  return (
    <span className="font-mono" style={{ color: "var(--accent)", letterSpacing: "1px" }} title={`${n}/5`}>
      {"★".repeat(full)}
      {half ? "⯨" : ""}
      <span style={{ color: "var(--rule)" }}>{"★".repeat(5 - full - (half ? 1 : 0))}</span>
    </span>
  );
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  const color = value >= 70 ? "var(--positive)" : value >= 45 ? "var(--amber)" : "var(--negative)";
  return (
    <div className="flex items-center gap-1.5" title={`${label} ${value}`}>
      <span className="font-mono mono-num text-[11px] w-5 text-right" style={{ color }}>{value}</span>
      <span className="inline-block h-1.5 w-10 rounded-sm overflow-hidden" style={{ background: "var(--rule)" }}>
        <span className="block h-full" style={{ width: `${value}%`, background: color }} />
      </span>
    </div>
  );
}

const verdictTone = (v: string): "positive" | "negative" | "default" =>
  v === "strong" || v === "good" ? "positive" : v === "weak" ? "negative" : "default";

function Row({ r, i }: { r: RatedStock; i: number }) {
  return (
    <tr className="border-b border-rule hover:bg-[var(--paper-2)]">
      <td className="px-2 py-1.5 text-muted font-mono text-[11px]">{i + 1}</td>
      <td className="px-2 py-1.5"><Link href={`/stock/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link></td>
      <td className="px-2 py-1.5 text-muted text-[11px] truncate max-w-[160px]">{(r.sector || "").split(" ").slice(0, 2).join(" ")}</td>
      <td className="px-2 py-1.5 text-right font-mono mono-num">{r.price == null ? "—" : fmtRs(r.price, true)}</td>
      <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: (r.change_pct ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>{r.change_pct == null ? "—" : `${r.change_pct >= 0 ? "+" : ""}${r.change_pct.toFixed(1)}%`}</td>
      <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{r.pe == null ? "—" : `${r.pe.toFixed(1)}×`}</td>
      <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: "var(--positive)" }}>{r.dividend_yield_pct == null ? "—" : r.dividend_yield_pct.toFixed(1)}</td>
      <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{r.rsi14 == null ? "—" : Math.round(r.rsi14)}</td>
      <td className="px-2 py-1.5"><ScoreBar value={r.score_fundamental} label="Fundamental" /></td>
      <td className="px-2 py-1.5"><ScoreBar value={r.score_technical} label="Technical" /></td>
      <td className="px-2 py-1.5"><ScoreBar value={r.score_risk} label="Risk" /></td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-display mono-num text-[18px]" style={{ fontVariationSettings: "'opsz' 144" }}>{r.overall}</span>
          <Stars n={r.stars} />
        </div>
      </td>
      <td className="px-2 py-1.5"><Badge tone={verdictTone(r.verdict)}>{r.verdict}</Badge></td>
    </tr>
  );
}

// Server renders the first slice for instant paint + small HTML; the rest of the
// board loads automatically when the sentinel scrolls into view.
export function RatingsBoard({ initial, sector, total }: { initial: RatedStock[]; sector?: string; total: number }) {
  const [rest, setRest] = useState<RatedStock[]>([]);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const fetched = useRef(false);
  const hasMore = total > initial.length && rest.length === 0;

  useEffect(() => {
    if (!hasMore || !sentinel.current) return;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting) || fetched.current) return;
        fetched.current = true;
        setLoading(true);
        try {
          const res = await fetch(`/api/market/screen?sort_by=overall&limit=500`);
          const d = await res.json();
          let rows: RatedStock[] = d.results || [];
          if (sector) rows = rows.filter((r) => r.sector === sector);
          setRest(rows.slice(initial.length));
        } catch {
          fetched.current = false; // allow retry on next scroll
        } finally {
          setLoading(false);
        }
      },
      { rootMargin: "600px" } // start loading well before the user reaches the end
    );
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [hasMore, sector, initial.length]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-t border-ink border-b border-ink">
            {["#", "Symbol", "Sector", "Price", "Day", "P/E", "Div%", "RSI", "Fund.", "Tech.", "Risk", "Rating", "Verdict"].map((h, i) => (
              <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i >= 3 && i <= 7 ? "right" : "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {initial.map((r, i) => <Row key={r.symbol} r={r} i={i} />)}
          {rest.map((r, i) => <Row key={r.symbol} r={r} i={initial.length + i} />)}
        </tbody>
      </table>
      {(hasMore || loading) && (
        <div ref={sentinel} className="py-6 text-center">
          <span className="label-cap">{loading ? "loading the rest…" : `${total - initial.length} more — keep scrolling`}</span>
        </div>
      )}
    </div>
  );
}
