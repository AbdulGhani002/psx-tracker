"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Adding a share to the buy list, or changing one already on it: its tiers
// from the highest price down, each a top price and, if wanted, a floor and a
// note. Saving counts every tier again from today.

type TierInput = { high: string; low: string; note: string };
type Initial = { symbol: string; note: string; tiers: Array<{ high: number; low: number | null; note: string }> };

const blank = (): TierInput => ({ high: "", low: "", note: "" });
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));

export function BuyListForm({ shares, initial, onDone }: { shares: Array<[string, string]>; initial?: Initial; onDone?: () => void }) {
  const router = useRouter();
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [tiers, setTiers] = useState<TierInput[]>(initial ? initial.tiers.map((t) => ({ high: String(t.high), low: t.low != null ? String(t.low) : "", note: t.note })) : [blank()]);
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: number, key: keyof TierInput, v: string) => setTiers((ts) => ts.map((t, i) => (i === k ? { ...t, [key]: v } : t)));

  async function save() {
    const list = tiers.map((t) => ({ high: num(t.high), low: num(t.low), note: t.note.trim() })).filter((t) => t.high != null);
    if (!symbol.trim()) return setError("Pick a share.");
    if (list.length === 0 || list.some((t) => !Number.isFinite(t.high!) || t.high! <= 0)) return setError("Give each tier a top price.");
    if (list.some((t) => t.low != null && (!Number.isFinite(t.low) || t.low >= t.high!))) return setError("A floor must be under its top price.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/buy-list", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: symbol.trim().toUpperCase(), tiers: list, note }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body?.error ?? "Could not save it.");
    if (!initial) {
      setSymbol("");
      setTiers([blank()]);
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
          <input list="buy-list-shares" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} disabled={!!initial} className="field w-full mt-1 mono-num" placeholder="e.g. MEBL" autoCapitalize="characters" />
          <datalist id="buy-list-shares">
            {shares.map(([s, n]) => <option key={s} value={s}>{n}</option>)}
          </datalist>
        </label>
        <label className="block">
          <span className="label-cap">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="field w-full mt-1" placeholder="Optional" maxLength={200} />
        </label>
      </div>
      <div className="mt-3 space-y-2">
        {tiers.map((t, k) => (
          <div key={k} className="grid grid-cols-[52px_1fr_1fr] sm:grid-cols-[52px_140px_140px_1fr_auto] gap-2 items-center">
            <span className="text-[13px] font-semibold">Tier {k + 1}</span>
            <input value={t.high} onChange={(e) => set(k, "high", e.target.value)} className="field mono-num" placeholder="Buy at or under" inputMode="decimal" />
            <input value={t.low} onChange={(e) => set(k, "low", e.target.value)} className="field mono-num" placeholder="Down to (optional)" inputMode="decimal" />
            <input value={t.note} onChange={(e) => set(k, "note", e.target.value)} className="field col-span-3 sm:col-span-1" placeholder="Note, e.g. buy 100" maxLength={120} />
            {tiers.length > 1 ? (
              <button type="button" className="text-[12px] link-underline justify-self-start" onClick={() => setTiers((ts) => ts.filter((_, i) => i !== k))}>Remove</button>
            ) : (
              <span className="hidden sm:block" />
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {tiers.length < 6 && <button type="button" className="text-[12.5px] link-underline" onClick={() => setTiers((ts) => [...ts, blank()])}>+ Tier</button>}
        <button type="button" className="btn-primary !py-1.5 text-[13px]" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {onDone && <button type="button" className="text-[12.5px] link-underline" onClick={onDone}>Cancel</button>}
        {error && <span className="text-[12.5px]" style={{ color: "var(--negative)" }}>{error}</span>}
      </div>
    </div>
  );
}
