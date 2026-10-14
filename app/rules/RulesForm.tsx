"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RuleSettings } from "@/lib/rules/data";

// The price rules: each step's move from the average price, what to do there
// and how much, and the limits past which rates or the rupee have moved a
// lot. Saving marks again what each share has already reached.

type Row = { move: string; action: "hold" | "add" | "sell"; sizePct: string };

export function RulesForm({ settings }: { settings: RuleSettings }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(settings.steps.map((s) => ({ move: String(s.move), action: s.action, sizePct: s.action === "hold" ? "" : String(s.sizePct) })));
  const [on, setOn] = useState(settings.on);
  const [ratePts, setRatePts] = useState(String(settings.ratePts));
  const [rupeePct, setRupeePct] = useState(String(settings.rupeePct));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const set = (k: number, key: keyof Row, v: string) => setRows((rs) => rs.map((r, i) => (i === k ? { ...r, [key]: v } : r)));

  async function save() {
    const steps = rows.map((r) => ({ move: Number(r.move), action: r.action, sizePct: r.action === "hold" ? 0 : Number(r.sizePct) })).filter((s) => r0(s.move));
    if (steps.some((s) => !Number.isFinite(s.move) || s.move <= -100 || (s.action !== "hold" && !(s.sizePct > 0 && s.sizePct <= 100)))) return setMsg("Each step needs a move and, to add or sell, a % from 1 to 100.");
    if (steps.some((s) => (s.action === "add" && s.move > 0) || (s.action === "sell" && s.move < 0))) return setMsg("Add on a fall (minus), sell on a rise.");
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on, steps, ratePts: Number(ratePts), rupeePct: Number(rupeePct) }) });
    setBusy(false);
    setMsg(res.ok ? "Saved." : "Could not save them.");
    router.refresh();
  }

  return (
    <div>
      <div className="space-y-2">
        {rows.map((r, k) => (
          <div key={k} className="grid grid-cols-[90px_100px_90px_auto] gap-2 items-center">
            <input value={r.move} onChange={(e) => set(k, "move", e.target.value)} className="field mono-num" placeholder="−20" inputMode="decimal" aria-label="Move from the average price, %" />
            <select value={r.action} onChange={(e) => set(k, "action", e.target.value)} className="field">
              <option value="hold">Hold</option>
              <option value="add">Add</option>
              <option value="sell">Sell</option>
            </select>
            <input value={r.sizePct} onChange={(e) => set(k, "sizePct", e.target.value)} disabled={r.action === "hold"} className="field mono-num" placeholder={r.action === "hold" ? "" : "%"} inputMode="decimal" aria-label="% of the shares held" />
            <button type="button" className="text-[12px] link-underline justify-self-start" onClick={() => setRows((rs) => rs.filter((_, i) => i !== k))}>Remove</button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-[13px]">
        {rows.length < 20 && <button type="button" className="text-[12.5px] link-underline" onClick={() => setRows((rs) => [...rs, { move: "", action: "hold", sizePct: "" }])}>+ Step</button>}
        <label className="flex items-center gap-2">A lot: policy rate ± <input value={ratePts} onChange={(e) => setRatePts(e.target.value)} className="field mono-num w-16 !py-1" inputMode="decimal" /> points</label>
        <label className="flex items-center gap-2">rupee ± <input value={rupeePct} onChange={(e) => setRupeePct(e.target.value)} className="field mono-num w-16 !py-1" inputMode="decimal" />%</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Rules on</label>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button type="button" className="btn-primary !py-1.5 text-[13px]" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {msg && <span className="text-[12.5px] text-muted">{msg}</span>}
      </div>
    </div>
  );
}

const r0 = (v: number) => Number.isFinite(v) && v !== 0;
