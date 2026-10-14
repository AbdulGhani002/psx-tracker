"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Adding a share to the sell list, or changing one already on it: prices to
// sell at above (take profit) and stops below, each with the % of the shares
// to sell and a note. Saving counts every level again from today.

type LevelInput = { price: string; kind: "profit" | "stop"; sellPct: string; note: string };
type Initial = { symbol: string; note: string; levels: Array<{ price: number; kind: "profit" | "stop"; sellPct: number | null; note: string }> };

const blank = (kind: "profit" | "stop" = "profit"): LevelInput => ({ price: "", kind, sellPct: "", note: "" });
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));

export function SellListForm({ shares, initial, onDone }: { shares: Array<[string, string]>; initial?: Initial; onDone?: () => void }) {
  const router = useRouter();
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [levels, setLevels] = useState<LevelInput[]>(initial ? initial.levels.map((l) => ({ price: String(l.price), kind: l.kind, sellPct: l.sellPct != null ? String(l.sellPct) : "", note: l.note })) : [blank("profit"), blank("stop")]);
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: number, key: keyof LevelInput, v: string) => setLevels((ls) => ls.map((l, i) => (i === k ? { ...l, [key]: v } : l)));

  async function save() {
    const list = levels.map((l) => ({ price: num(l.price), kind: l.kind, sellPct: num(l.sellPct), note: l.note.trim() })).filter((l) => l.price != null);
    if (!symbol.trim()) return setError("Pick a share.");
    if (list.length === 0 || list.some((l) => !Number.isFinite(l.price!) || l.price! <= 0)) return setError("Give each level a price.");
    if (list.some((l) => l.sellPct != null && (!Number.isFinite(l.sellPct) || l.sellPct <= 0 || l.sellPct > 100))) return setError("Sell % is between 1 and 100.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sell-list", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: symbol.trim().toUpperCase(), levels: list, note }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body?.error ?? "Could not save it.");
    if (!initial) {
      setSymbol("");
      setLevels([blank("profit"), blank("stop")]);
      setNote("");
    }
    onDone?.();
    router.refresh();
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2">
        <label className="block">
          <span className="label-cap">Share</span>
          <input list="sell-list-shares" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} disabled={!!initial} className="field w-full mt-1 mono-num" placeholder="e.g. MEBL" autoCapitalize="characters" />
          <datalist id="sell-list-shares">
            {shares.map(([s, n]) => <option key={s} value={s}>{n}</option>)}
          </datalist>
        </label>
        <label className="block">
          <span className="label-cap">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="field w-full mt-1" placeholder="Optional" maxLength={200} />
        </label>
      </div>
      <div className="mt-3 space-y-2">
        {levels.map((l, k) => (
          <div key={k} className="grid grid-cols-[110px_1fr_1fr] sm:grid-cols-[120px_130px_110px_1fr_auto] gap-2 items-center">
            <select value={l.kind} onChange={(e) => set(k, "kind", e.target.value)} className="field">
              <option value="profit">Sell at</option>
              <option value="stop">Stop at</option>
            </select>
            <input value={l.price} onChange={(e) => set(k, "price", e.target.value)} className="field mono-num" placeholder="Price" inputMode="decimal" />
            <input value={l.sellPct} onChange={(e) => set(k, "sellPct", e.target.value)} className="field mono-num" placeholder="Sell % (optional)" inputMode="decimal" />
            <input value={l.note} onChange={(e) => set(k, "note", e.target.value)} className="field col-span-3 sm:col-span-1" placeholder="Note" maxLength={120} />
            {levels.length > 1 ? (
              <button type="button" className="text-[12px] link-underline justify-self-start" onClick={() => setLevels((ls) => ls.filter((_, i) => i !== k))}>Remove</button>
            ) : (
              <span className="hidden sm:block" />
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {levels.length < 6 && <button type="button" className="text-[12.5px] link-underline" onClick={() => setLevels((ls) => [...ls, blank("profit")])}>+ Level</button>}
        <button type="button" className="btn-primary !py-1.5 text-[13px]" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {onDone && <button type="button" className="text-[12.5px] link-underline" onClick={onDone}>Cancel</button>}
        {error && <span className="text-[12.5px]" style={{ color: "var(--negative)" }}>{error}</span>}
      </div>
    </div>
  );
}
