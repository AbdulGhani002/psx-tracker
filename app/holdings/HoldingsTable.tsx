"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CompanyMark } from "@/components/ui/CompanyMark";
import { Sparkline } from "@/components/ui/Sparkline";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum, fmtSignedPct, fmtPct } from "@/lib/format";

// The holdings table, sortable and filterable in the browser.
//
// Rows arrive as plain data rather than rendered cells, which is what lets the
// sort happen here instead of costing a round-trip. Every comparison is done on
// the NUMBER, never on the formatted string — sorting "Rs 1,240" as text puts
// it below "Rs 998", and a table that lies about order is worse than one that
// does not sort at all.

export type HoldingRow = {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  avgCost: number;
  price: number;
  priceKnown: boolean;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPct: number;
  dividendsReceived: number;
  totalCost: number;
  currentPercent: number;
  targetPercent: number;
  deviation: number;
  staleDays: number | null;
  spark: number[];
};

type SortKey =
  | "symbol" | "sector" | "shares" | "avgCost" | "price"
  | "marketValue" | "unrealizedPct" | "yoc" | "weight";

// A missing price is UNKNOWN, not zero. Unknowns sort to the bottom whichever
// way the column is pointing, so they never masquerade as the worst performer.
const VALUE: Record<SortKey, (r: HoldingRow) => number | string | null> = {
  symbol: (r) => r.symbol,
  sector: (r) => r.sector || "",
  shares: (r) => r.shares,
  avgCost: (r) => r.avgCost,
  price: (r) => (r.priceKnown ? r.price : null),
  marketValue: (r) => (r.priceKnown ? r.marketValue : null),
  unrealizedPct: (r) => (r.priceKnown ? r.unrealizedPct : null),
  yoc: (r) => (r.totalCost > 0 && r.dividendsReceived > 0 ? r.dividendsReceived / r.totalCost : null),
  weight: (r) => r.currentPercent,
};

const COLUMNS: Array<{ key: SortKey; label: string; align: "left" | "right" }> = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "sector", label: "Sector", align: "left" },
  { key: "shares", label: "Shares", align: "right" },
  { key: "avgCost", label: "Avg cost", align: "right" },
  { key: "price", label: "Price", align: "right" },
  { key: "marketValue", label: "Market value", align: "right" },
  { key: "unrealizedPct", label: "Unrealised", align: "right" },
  { key: "yoc", label: "YoC", align: "right" },
  { key: "weight", label: "% / target", align: "right" },
];

export function HoldingsTable({ rows, staleAfterDays }: { rows: HoldingRow[]; staleAfterDays: number }) {
  const [sort, setSort] = useState<SortKey>("marketValue");
  const [desc, setDesc] = useState(true);
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.symbol.toLowerCase().includes(needle) ||
            r.name.toLowerCase().includes(needle) ||
            (r.sector ?? "").toLowerCase().includes(needle)
        )
      : rows;
    const get = VALUE[sort];
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // unknowns last, both directions
      if (vb === null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(String(vb)) : Number(va) - Number(vb);
      return desc ? -cmp : cmp;
    });
  }, [rows, sort, desc, q]);

  const shown = view.reduce((s, r) => s + (r.priceKnown ? r.marketValue : 0), 0);

  function head(key: SortKey) {
    if (sort === key) setDesc(!desc);
    else {
      setSort(key);
      // Text reads A→Z first; money and percentages read biggest first.
      setDesc(key !== "symbol" && key !== "sector");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by symbol, name or sector…"
          aria-label="Filter holdings"
          className="text-[13px] bg-transparent border-b border-[var(--rule-strong)] pb-1 outline-none focus:border-[var(--accent)] transition-colors min-w-[240px]"
          style={{ color: "var(--ink)" }}
        />
        <span className="label-cap">
          {view.length} of {rows.length} · <span className="mono-num">{fmtRs(shown)}</span>
        </span>
        {q && (
          <button onClick={() => setQ("")} className="label-cap link-underline">
            clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-t-2 border-t-[var(--ink)] border-b border-b-[var(--ink)]">
              <th className="px-2 py-2 w-[34px]" />
              {COLUMNS.map((c) => {
                const on = sort === c.key;
                return (
                  <th
                    key={c.key}
                    className="px-3 py-2 font-mono text-[10px] uppercase tracking-stat font-medium"
                    style={{ textAlign: c.align, color: on ? "var(--ink)" : "var(--muted)" }}
                  >
                    <button
                      onClick={() => head(c.key)}
                      className="inline-flex items-center gap-1 hover:text-[var(--ink)] transition-colors"
                      aria-sort={on ? (desc ? "descending" : "ascending") : "none"}
                    >
                      {c.label}
                      <span aria-hidden style={{ opacity: on ? 1 : 0.25 }}>{on && !desc ? "▲" : "▼"}</span>
                    </button>
                  </th>
                );
              })}
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">
                90d
              </th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-3 py-8 text-center text-muted text-sm">
                  Nothing matches “{q}”.
                </td>
              </tr>
            )}
            {view.map((r) => {
              const stale = r.staleDays != null && r.staleDays >= staleAfterDays;
              const dev = Math.abs(r.deviation);
              const devTone = dev <= 3 ? "positive" : dev <= 6 ? "amber" : "negative";
              return (
                <tr key={r.symbol} className="border-b border-[var(--rule)] row-hover">
                  <td className="px-2 py-2">
                    <CompanyMark symbol={r.symbol} sector={r.sector} size="sm" />
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/holdings/${r.symbol}`} className="font-mono text-[13px] font-medium link-underline">
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-muted">{r.sector}</td>
                  <td className="px-3 py-2 text-right mono-num">{fmtNum(r.shares)}</td>
                  <td className="px-3 py-2 text-right mono-num">{fmtRs(r.avgCost, true)}</td>
                  <td className="px-3 py-2 text-right mono-num">
                    {!r.priceKnown ? (
                      <Badge tone="negative">no price</Badge>
                    ) : stale ? (
                      <span className="inline-flex items-center gap-1.5">
                        {fmtRs(r.price, true)}
                        <Badge tone="amber">{Math.floor(r.staleDays!)}d old</Badge>
                      </span>
                    ) : (
                      fmtRs(r.price, true)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right mono-num">
                    {r.priceKnown ? fmtRs(r.marketValue) : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right mono-num">
                    {r.priceKnown ? (
                      <span style={{ color: r.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>
                        {fmtSignedPct(r.unrealizedPct)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right mono-num">
                    {r.totalCost > 0 && r.dividendsReceived > 0 ? (
                      <span style={{ color: "var(--positive)" }}>{fmtPct(r.dividendsReceived / r.totalCost, 1)}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right mono-num">
                    <div className="flex items-center justify-end gap-2">
                      <span>{fmtPct(r.currentPercent / 100, 1)}</span>
                      <span className="text-muted">/</span>
                      <span className="text-muted">{fmtPct(r.targetPercent / 100, 0)}</span>
                      <Badge tone={devTone as "positive" | "amber" | "negative"}>
                        {fmtSignedPct(r.deviation / 100, 1)}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Sparkline points={r.spark} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
