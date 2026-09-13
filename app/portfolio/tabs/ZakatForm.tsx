"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Record a zakat payment, or remove one recorded by mistake.
export function ZakatForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    const res = await fetch("/api/zakat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: v, date, notes }) });
    setBusy(false);
    if (!res.ok) return setError("Could not save. Try again.");
    setAmount("");
    setNotes("");
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ Pay zakat</button>;
  return (
    <form onSubmit={submit} className="card card-pad w-full mt-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="label-cap block mb-1.5">Amount (Rs)</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="field mono-num" autoFocus />
        </div>
        <div>
          <label className="label-cap block mb-1.5">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field mono-num" />
        </div>
        <div>
          <label className="label-cap block mb-1.5">Comments</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="What it covered" />
        </div>
      </div>
      {error && <div className="text-[12.5px] mt-2" style={{ color: "var(--negative)" }}>{error}</div>}
      <div className="flex items-center gap-2 mt-3">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Record payment"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function DeleteZakat({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="text-[12px] text-muted hover:text-[var(--negative)]"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Remove this zakat payment?")) return;
        setBusy(true);
        await fetch(`/api/zakat/${id}`, { method: "DELETE" });
        setBusy(false);
        router.refresh();
      }}
    >
      Delete
    </button>
  );
}
