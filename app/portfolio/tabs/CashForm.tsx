"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Add or withdraw brokerage cash: a small inline form that posts a cash entry
// against the selected portfolio and refreshes the tab.
export function CashForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"DEPOSIT" | "WITHDRAWAL">("DEPOSIT");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(amount);
    if (!(v > 0)) return setError("Enter an amount above zero.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/cash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, amount: v, date, notes }) });
    setBusy(false);
    if (!res.ok) return setError("Could not save. Try again.");
    setAmount("");
    setNotes("");
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button type="button" className="btn-green" onClick={() => setOpen(true)}>+ Add / Withdraw</button>;
  return (
    <form onSubmit={submit} className="card card-pad w-full mt-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label-cap block mb-1.5">Type</label>
          <div className="seg">
            <button type="button" data-active={type === "DEPOSIT"} onClick={() => setType("DEPOSIT")}>Deposit</button>
            <button type="button" data-active={type === "WITHDRAWAL"} onClick={() => setType("WITHDRAWAL")}>Withdraw</button>
          </div>
        </div>
        <div>
          <label className="label-cap block mb-1.5">Amount (Rs)</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="field mono-num" autoFocus />
        </div>
        <div>
          <label className="label-cap block mb-1.5">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field mono-num" />
        </div>
        <div>
          <label className="label-cap block mb-1.5">Note</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="Optional" />
        </div>
      </div>
      {error && <div className="text-[12.5px] mt-2" style={{ color: "var(--negative)" }}>{error}</div>}
      <div className="flex items-center gap-2 mt-3">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : type === "DEPOSIT" ? "Record deposit" : "Record withdrawal"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
