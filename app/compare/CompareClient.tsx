"use client";

import Link from "next/link";
import { useState } from "react";

type Stock = Record<string, any>;

const ROWS: { key: string; label: string; fmt?: (v: any) => string; better?: "high" | "low" }[] = [
  { key: "price", label: "Price", fmt: (v) => (v == null ? "—" : `Rs ${v.toFixed(2)}`) },
  { key: "overall", label: "AI score", better: "high" },
  { key: "verdict", label: "Verdict" },
  { key: "pe", label: "P/E", fmt: (v) => (v == null ? "—" : `${v.toFixed(1)}×`), better: "low" },
  { key: "earnings_yield_pct", label: "Earnings yield", fmt: (v) => (v == null ? "—" : `${v.toFixed(1)}%`), better: "high" },
  { key: "dividend_yield_pct", label: "Dividend yield", fmt: (v) => (v == null ? "—" : `${v.toFixed(1)}%`), better: "high" },
  { key: "net_margin_pct", label: "Net margin", fmt: (v) => (v == null ? "—" : `${v.toFixed(0)}%`), better: "high" },
  { key: "eps_cagr_pct", label: "EPS CAGR", fmt: (v) => (v == null ? "—" : `${v.toFixed(0)}%`), better: "high" },
  { key: "rsi14", label: "RSI", fmt: (v) => (v == null ? "—" : `${Math.round(v)}`) },
  { key: "volatility_pct", label: "Volatility", fmt: (v) => (v == null ? "—" : `${v.toFixed(0)}%`), better: "low" },
  { key: "beta", label: "Beta", fmt: (v) => (v == null ? "—" : v.toFixed(2)) },
  { key: "ret_12m", label: "12m return", fmt: (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`), better: "high" },
];

export function CompareClient() {
  const [input, setInput] = useState("MEBL, HUBC, LUCK");
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);

  async function run() {
    const syms = input.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 5);
    if (!syms.length) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/market/compare?symbols=${syms.join(",")}`);
      const d = await res.json();
      setStocks(d.stocks || []);
    } catch {
      setStocks([]);
    } finally {
      setLoading(false);
    }
  }

  function best(key: string, better?: "high" | "low") {
    if (!better) return null;
    const vals = stocks.map((s) => s[key]).filter((v) => typeof v === "number");
    if (!vals.length) return null;
    return better === "high" ? Math.max(...vals) : Math.min(...vals);
  }

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="MEBL, HUBC, LUCK, OGDC, MARI" className="flex-1 border border-rule bg-transparent px-3 py-2 text-[13px] font-mono" />
        <button onClick={run} className="border border-ink px-4 py-2 label-cap hover:bg-[var(--paper-2)]">Compare</button>
      </div>
      {stocks.length > 0 && (
        <div className="overflow-x-auto" style={{ opacity: loading ? 0.5 : 1 }}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-t border-ink border-b border-ink">
                <th className="px-3 py-2 text-left label-cap">Metric</th>
                {stocks.map((s) => (
                  <th key={s.symbol} className="px-3 py-2 text-right">
                    <Link href={`/stock/${s.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{s.symbol}</Link>
                    <div className="text-[10px] text-muted normal-case font-normal tracking-normal truncate max-w-[120px] ml-auto">{(s.sector || "").split(" ").slice(0, 2).join(" ")}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const b = best(row.key, row.better);
                return (
                  <tr key={row.key} className="border-b border-rule">
                    <td className="px-3 py-1.5 text-muted">{row.label}</td>
                    {stocks.map((s) => {
                      const v = s[row.key];
                      const isBest = b != null && typeof v === "number" && v === b;
                      return (
                        <td key={s.symbol} className="px-3 py-1.5 text-right font-mono mono-num" style={{ color: isBest ? "var(--accent-deep)" : undefined, fontWeight: isBest ? 600 : undefined }}>
                          {row.fmt ? row.fmt(v) : v ?? "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted mt-3">Amber = best of the group on that metric.</p>
        </div>
      )}
    </div>
  );
}
