"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Rules written in advance: a figure, a comparison, a threshold and what to
// do. Price figures are tested on every close; filing figures (entered with
// the assumptions) when a version is approved.

type Row = { id: string; metric: string; op: string; threshold: number; action: string; note: string; active: boolean; lastFiredAt: string };

const METRICS: Array<[string, string]> = [["price", "Price"], ["pb", "P/B"], ["pe", "P/E"], ["yield", "Dividend yield %"], ["excess", "Return over hurdle (pts)"], ["discount", "Discount to fair value %"]];

export function TriggerEditor({ symbol, rows }: { symbol: string; rows: Row[] }) {
  const router = useRouter();
  const [metric, setMetric] = useState("pb");
  const [custom, setCustom] = useState("");
  const [op, setOp] = useState(">=");
  const [threshold, setThreshold] = useState("");
  const [action, setAction] = useState("trim");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const m = metric === "custom" ? custom.trim() : metric;
    if (!m || threshold.trim() === "" || !Number.isFinite(Number(threshold))) return setError("Pick a figure and a threshold.");
    setError(null);
    const res = await fetch("/api/valuation/triggers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, metric: m, op, threshold: Number(threshold), action, note }) });
    if (!res.ok) return setError("Could not save it.");
    setThreshold("");
    setNote("");
    router.refresh();
  }
  const toggle = async (r: Row) => {
    await fetch(`/api/valuation/triggers/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !r.active }) });
    router.refresh();
  };
  const remove = async (r: Row) => {
    await fetch(`/api/valuation/triggers/${r.id}`, { method: "DELETE" });
    router.refresh();
  };
  const label = (m: string) => METRICS.find(([k]) => k === m)?.[1] ?? m;

  return (
    <div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">None yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--rule)]">
          {rows.map((r) => (
            <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-[13px]" style={r.active ? undefined : { opacity: 0.55 }}>
              <span>
                <span className="mono-num">{label(r.metric)} {r.op} {r.threshold}</span> → <span className="font-semibold">{r.action}</span>
                {r.note && <span className="text-muted"> · {r.note}</span>}
                {r.lastFiredAt && <span className="pill ml-2" data-tone="negative">fired {r.lastFiredAt}</span>}
              </span>
              <span className="flex gap-3">
                <button type="button" className="text-[12px] link-underline" onClick={() => toggle(r)}>{r.active ? "Turn off" : "Turn on"}</button>
                <button type="button" className="text-[12px] link-underline" style={{ color: "var(--negative)" }} onClick={() => remove(r)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-3 items-end">
        <select value={metric} onChange={(e) => setMetric(e.target.value)} className="field text-[13px]">
          {METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          <option value="custom">A filing figure…</option>
        </select>
        {metric === "custom" && <input value={custom} onChange={(e) => setCustom(e.target.value)} className="field text-[13px]" placeholder="e.g. combinedRatio" />}
        <select value={op} onChange={(e) => setOp(e.target.value)} className="field text-[13px] mono-num">
          {[">=", "<=", ">", "<"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} className="field mono-num text-[13px]" placeholder="Threshold" inputMode="decimal" />
        <select value={action} onChange={(e) => setAction(e.target.value)} className="field text-[13px]">
          <option value="trim">Trim</option>
          <option value="exit">Exit</option>
          <option value="buy">Buy</option>
          <option value="review">Review</option>
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="field text-[13px]" placeholder="Note" />
        <button type="button" className="btn-primary !py-1.5 text-[12px]" onClick={add}>Add trigger</button>
      </div>
      {error && <div className="text-[12px] mt-2" style={{ color: "var(--negative)" }}>{error}</div>}
    </div>
  );
}
