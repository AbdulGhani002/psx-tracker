"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CompanyMark } from "@/components/ui/CompanyMark";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum, fmtSignedPct, fmtSignedRs, fmtPct } from "@/lib/format";

// The active holdings table, the way Zar lays it out: the name with its
// mark and the KMI leaf, then quantity, prices, today's and total P&L,
// market value, investment, dividend yield, weight and a Sell button.
// Rows arrive as plain numbers so sorting happens here on the number, never
// on the formatted string.

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
  todayPct: number | null;
  todayProfit: number | null;
  shariah: "KMI30" | "KMIALL" | "NON" | null;
};

type SortKey = "symbol" | "shares" | "avgCost" | "price" | "today" | "total" | "unrealized" | "marketValue" | "totalCost" | "yield" | "weight";

const VALUE: Record<SortKey, (r: HoldingRow) => number | string | null> = {
  symbol: (r) => r.symbol,
  shares: (r) => r.shares,
  avgCost: (r) => r.avgCost,
  price: (r) => (r.priceKnown ? r.price : null),
  today: (r) => r.todayProfit,
  total: (r) => (r.priceKnown ? r.unrealizedPL + r.dividendsReceived : null),
  unrealized: (r) => (r.priceKnown ? r.unrealizedPL : null),
  marketValue: (r) => (r.priceKnown ? r.marketValue : null),
  totalCost: (r) => r.totalCost,
  yield: (r) => (r.totalCost > 0 && r.dividendsReceived > 0 ? r.dividendsReceived / r.totalCost : null),
  weight: (r) => r.currentPercent,
};

const ALL_COLUMNS: Array<{ key: SortKey; label: string; align: "left" | "right"; always?: boolean }> = [
  { key: "symbol", label: "Symbol", align: "left", always: true },
  { key: "shares", label: "Quantity", align: "right" },
  { key: "avgCost", label: "Avg. price", align: "right" },
  { key: "price", label: "Curr. price", align: "right" },
  { key: "today", label: "Today P&L", align: "right" },
  { key: "total", label: "Total P&L", align: "right" },
  { key: "unrealized", label: "Unrealized profit", align: "right" },
  { key: "marketValue", label: "Market value", align: "right" },
  { key: "totalCost", label: "Total investment", align: "right" },
  { key: "yield", label: "Dividend yield", align: "right" },
  { key: "weight", label: "Portfolio %", align: "right" },
];

const DEFAULT_HIDDEN: SortKey[] = ["totalCost"];

const SHARIAH_LABEL: Record<string, { text: string; tone: "positive" | "negative" | "amber"; title: string }> = {
  KMI30: { text: "KMI-30", tone: "positive", title: "In the KMI-30 index, which is Meezan-screened" },
  KMIALL: { text: "Shariah", tone: "positive", title: "In the KMI All-Share index, which is Meezan-screened" },
  NON: { text: "Non-KMI", tone: "negative", title: "Not in either KMI index, so it did not pass the screen" },
};

const Money = ({ v, pct, tone = true }: { v: number; pct?: number | null; tone?: boolean }) => (
  <div style={{ color: tone ? (v >= 0 ? "var(--positive)" : "var(--negative)") : undefined }}>
    <div className="mono-num">{fmtSignedRs(v)}</div>
    {pct != null && <div className="mono-num text-[11px] opacity-80">{v >= 0 ? "↗" : "↘"} {fmtSignedPct(pct)}</div>}
  </div>
);

export function HoldingsTable({ rows, staleAfterDays }: { rows: HoldingRow[]; staleAfterDays: number }) {
  const [sort, setSort] = useState<SortKey>("marketValue");
  const [desc, setDesc] = useState(true);
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState<Set<SortKey>>(new Set(DEFAULT_HIDDEN));
  const [colsOpen, setColsOpen] = useState(false);

  const columns = ALL_COLUMNS.filter((c) => !hidden.has(c.key));

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle ? rows.filter((r) => r.symbol.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle) || (r.sector ?? "").toLowerCase().includes(needle)) : rows;
    const get = VALUE[sort];
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(String(vb)) : Number(va) - Number(vb);
      return desc ? -cmp : cmp;
    });
  }, [rows, sort, desc, q]);

  function head(key: SortKey) {
    if (sort === key) setDesc(!desc);
    else {
      setSort(key);
      setDesc(key !== "symbol");
    }
  }

  function exportCsv() {
    const header = ["symbol", "name", "quantity", "avgPrice", "price", "marketValue", "investment", "unrealized", "unrealizedPct", "dividends", "weightPct"];
    const lines = [header.join(",")].concat(view.map((r) => [r.symbol, `"${r.name.replace(/"/g, '""')}"`, r.shares, r.avgCost.toFixed(2), r.priceKnown ? r.price.toFixed(2) : "", r.marketValue.toFixed(0), r.totalCost.toFixed(0), r.unrealizedPL.toFixed(0), r.unrealizedPct.toFixed(2), r.dividendsReceived.toFixed(0), r.currentPercent.toFixed(2)].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `holdings-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="text-[14px] font-semibold mr-auto">Active holdings</div>
        <div className="field !min-h-[34px] w-[220px]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted shrink-0" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by symbol" aria-label="Filter holdings" className="!py-1 text-[13px]" />
        </div>
        <div className="relative">
          <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => setColsOpen((v) => !v)}>Columns</button>
          {colsOpen && (
            <div className="absolute right-0 top-full mt-1 card py-1 min-w-[190px] z-30" onMouseLeave={() => setColsOpen(false)}>
              {ALL_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-[var(--surface-2)] cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={c.always}
                    checked={!hidden.has(c.key)}
                    onChange={(e) => {
                      const next = new Set(hidden);
                      if (e.target.checked) next.delete(c.key);
                      else next.add(c.key);
                      setHidden(next);
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={exportCsv}>Export</button>
        <span className="text-[12px] text-muted">{view.length} positions</span>
      </div>

      <div className="overflow-x-auto -mx-2">
        <table className="table-zar">
          <thead>
            <tr>
              {columns.map((c) => {
                const on = sort === c.key;
                return (
                  <th key={c.key} style={{ textAlign: c.align, color: on ? "var(--ink)" : undefined }}>
                    <button onClick={() => head(c.key)} className="inline-flex items-center gap-1 hover:text-[var(--ink)] transition-colors uppercase" aria-sort={on ? (desc ? "descending" : "ascending") : "none"}>
                      {c.label}
                      <span aria-hidden className="text-[9px]" style={{ opacity: on ? 1 : 0.3 }}>{on && !desc ? "▲" : "▼"}</span>
                    </button>
                  </th>
                );
              })}
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="py-10 text-center text-muted">
                  {rows.length === 0 ? "No positions yet." : `Nothing matches "${q}".`}
                </td>
              </tr>
            )}
            {view.map((r) => {
              const stale = r.staleDays != null && r.staleDays >= staleAfterDays;
              const total = r.unrealizedPL + r.dividendsReceived;
              const totalPct = r.totalCost > 0 ? total / r.totalCost : null;
              const cell = (key: SortKey) => {
                switch (key) {
                  case "symbol":
                    return (
                      <td key={key}>
                        <div className="flex items-center gap-2.5">
                          <CompanyMark symbol={r.symbol} sector={r.sector} size="sm" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link href={`/holdings/${r.symbol}`} className="font-semibold text-[13px] hover:text-[var(--accent-deep)]">{r.symbol}</Link>
                              {r.shariah && SHARIAH_LABEL[r.shariah] && (
                                <span title={SHARIAH_LABEL[r.shariah].title}>
                                  <Badge tone={SHARIAH_LABEL[r.shariah].tone}>{SHARIAH_LABEL[r.shariah].text}</Badge>
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted truncate max-w-[200px]">{r.name || r.sector}</div>
                          </div>
                        </div>
                      </td>
                    );
                  case "shares":
                    return <td key={key} className="text-right mono-num">{fmtNum(r.shares)}</td>;
                  case "avgCost":
                    return <td key={key} className="text-right mono-num">{r.avgCost.toFixed(2)}</td>;
                  case "price":
                    return (
                      <td key={key} className="text-right mono-num">
                        {!r.priceKnown ? <Badge tone="negative">no price</Badge> : stale ? <span className="inline-flex items-center gap-1.5">{r.price.toFixed(2)}<Badge tone="amber">{Math.floor(r.staleDays!)}d old</Badge></span> : r.price.toFixed(2)}
                      </td>
                    );
                  case "today":
                    return <td key={key} className="text-right">{r.todayProfit != null ? <Money v={r.todayProfit} pct={r.todayPct} /> : <span className="text-muted">–</span>}</td>;
                  case "total":
                    return <td key={key} className="text-right">{r.priceKnown ? <Money v={total} pct={totalPct} /> : <span className="text-muted">–</span>}</td>;
                  case "unrealized":
                    return <td key={key} className="text-right">{r.priceKnown ? <Money v={r.unrealizedPL} pct={r.unrealizedPct} /> : <span className="text-muted">–</span>}</td>;
                  case "marketValue":
                    return <td key={key} className="text-right mono-num">{r.priceKnown ? fmtRs(r.marketValue) : <span className="text-muted">–</span>}</td>;
                  case "totalCost":
                    return <td key={key} className="text-right mono-num">{fmtRs(r.totalCost)}</td>;
                  case "yield":
                    return <td key={key} className="text-right mono-num">{r.totalCost > 0 && r.dividendsReceived > 0 ? `${((r.dividendsReceived / r.totalCost) * 100).toFixed(2)}%` : "0.00%"}</td>;
                  case "weight":
                    return (
                      <td key={key} className="text-right">
                        <div className="mono-num">{fmtPct(r.currentPercent / 100, 1)}</div>
                        {r.targetPercent > 0 && <div className="text-[11px] text-muted mono-num">target {fmtPct(r.targetPercent / 100, 0)}</div>}
                      </td>
                    );
                }
              };
              return (
                <tr key={r.symbol}>
                  {columns.map((c) => cell(c.key))}
                  <td className="text-right">
                    <Link href={`/transactions/new?symbol=${r.symbol}&type=SELL&shares=${r.shares}`} className="btn-danger">Sell</Link>
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
