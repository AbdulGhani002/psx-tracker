"use client";

import { useEffect, useMemo, useState } from "react";

// What to export: a period (or all time), trades, dividends or both, one share
// or all, and CSV or PDF. The count and totals update as the choice changes.

type Kind = "trades" | "dividends" | "all";
type Totals = { count: number; buys: number; sells: number; dividends: number; bought: number; sold: number; fees: number; divNet: number; divTax: number };

const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-US")}`;

function taxYear(offset: number): { from: string; to: string } {
  const t = today();
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const start = (m >= 7 ? y : y - 1) - offset;
  return { from: `${start}-07-01`, to: offset === 0 ? t : `${start + 1}-06-30` };
}

const PRESETS: Array<{ key: string; label: string; range: () => { from: string; to: string } | null }> = [
  { key: "all", label: "All time", range: () => null },
  { key: "fy", label: "This tax year", range: () => taxYear(0) },
  { key: "lastfy", label: "Last tax year", range: () => taxYear(1) },
  { key: "year", label: "This calendar year", range: () => ({ from: `${today().slice(0, 4)}-01-01`, to: today() }) },
  { key: "custom", label: "Dates", range: () => null },
];

export function ExportForm({ symbols }: { symbols: string[] }) {
  const [preset, setPreset] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [actions, setActions] = useState(true);
  const [symbol, setSymbol] = useState("");
  const [totals, setTotals] = useState<Totals | null>(null);

  const range = useMemo(() => {
    if (preset === "custom") return { from: from || null, to: to || null };
    const r = PRESETS.find((p) => p.key === preset)?.range() ?? null;
    return { from: r?.from ?? null, to: r?.to ?? null };
  }, [preset, from, to]);

  const query = (format: string) => {
    const p = new URLSearchParams({ kind, format, actions: actions ? "1" : "0" });
    if (range.from) p.set("from", range.from);
    if (range.to) p.set("to", range.to);
    if (symbol.trim()) p.set("symbol", symbol.trim().toUpperCase());
    return `/api/export/records?${p.toString()}`;
  };

  useEffect(() => {
    let live = true;
    fetch(query("json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setTotals(j?.totals ?? null))
      .catch(() => live && setTotals(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, actions, symbol, range.from, range.to]);

  const chip = (on: boolean) => `${on ? "btn-primary" : "btn-ghost"} !py-1 text-[12.5px]`;

  return (
    <div className="space-y-5">
      <div>
        <div className="label-cap mb-2">Period</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className={chip(preset === p.key)} onClick={() => setPreset(p.key)}>{p.label}</button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2 mt-3 text-[13px]">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="field !py-1" aria-label="From" />
            <span className="text-muted">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="field !py-1" aria-label="To" />
          </div>
        )}
      </div>

      <div>
        <div className="label-cap mb-2">What</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(kind === "all")} onClick={() => setKind("all")}>Trades and dividends</button>
          <button type="button" className={chip(kind === "trades")} onClick={() => setKind("trades")}>Trades only</button>
          <button type="button" className={chip(kind === "dividends")} onClick={() => setKind("dividends")}>Dividends only</button>
        </div>
        {kind !== "dividends" && (
          <label className="flex items-center gap-2 mt-3 text-[13px]">
            <input type="checkbox" checked={actions} onChange={(e) => setActions(e.target.checked)} /> Bonus, rights and splits too
          </label>
        )}
      </div>

      <div>
        <div className="label-cap mb-2">Share</div>
        <input list="export-symbols" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="field mono-num w-40" placeholder="All shares" autoCapitalize="characters" />
        <datalist id="export-symbols">
          {symbols.map((s) => <option key={s} value={s} />)}
        </datalist>
      </div>

      <div className="rounded-lg p-3 text-[13px]" style={{ background: "var(--surface-2)" }}>
        {totals == null ? (
          <span className="text-muted">Counting…</span>
        ) : totals.count === 0 ? (
          <span className="text-muted">Nothing in this choice.</span>
        ) : (
          <span>
            <span className="font-semibold">{totals.count.toLocaleString("en-US")} records</span>
            {totals.buys + totals.sells > 0 && <> · {totals.buys} buys {rs(totals.bought)} · {totals.sells} sales {rs(totals.sold)}</>}
            {totals.dividends > 0 && <> · {totals.dividends} dividends {rs(totals.divNet)} net</>}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <a href={query("csv")} className="btn-primary !py-1.5 text-[13px]" download>Download CSV</a>
        <a href={query("pdf")} className="btn-ghost !py-1.5 text-[13px]" download>Download PDF</a>
      </div>
    </div>
  );
}
