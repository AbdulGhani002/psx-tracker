"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Update prices: starts one update (app/api/prices/update) and shows what it
// did; the page then reloads its figures. The daily read goes on regardless.
export function UpdatePrices({ label = "", className = "" }: { label?: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/prices/update", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setNote({ text: String(d.note ?? (res.ok ? "Updated" : "Update failed")), ok: res.ok });
      router.refresh();
    } catch {
      setNote({ text: "Update failed", ok: false });
    } finally {
      setBusy(false);
    }
  }

  const text = note?.text ?? label;
  return (
    <div className={`flex items-center justify-end gap-2 ${className}`}>
      {text && <span className="text-[11px]" style={{ color: note && !note.ok ? "var(--negative)" : "var(--muted)" }}>{text}</span>}
      <button type="button" onClick={run} disabled={busy} className="btn-ghost !py-1 !px-2.5 !text-[12px] disabled:opacity-60">
        {busy ? "Updating…" : "Update prices"}
      </button>
    </div>
  );
}
