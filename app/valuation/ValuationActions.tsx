"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The valuation page's buttons: value everything now, open a share to value,
// approve or reject a draft.

export function RunNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost !py-1.5 text-[12px]"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/valuation/run", { method: "POST" }).catch(() => null);
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Valuing…" : "Value now"}
    </button>
  );
}

export function OpenShare() {
  const router = useRouter();
  const [s, setS] = useState("");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const sym = s.trim().toUpperCase();
        if (sym) router.push(`/valuation/${encodeURIComponent(sym)}`);
      }}
    >
      <input value={s} onChange={(e) => setS(e.target.value)} placeholder="Symbol, e.g. MCB" className="field !min-h-[34px] w-[150px] uppercase text-[13px]" />
      <button type="submit" className="btn-primary !py-1.5 text-[12px]">Value a share</button>
    </form>
  );
}

export function DraftButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const act = async (action: "approve" | "reject") => {
    setBusy(true);
    await fetch(`/api/valuation/assumptions/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);
    setBusy(false);
    router.refresh();
  };
  return (
    <span className="inline-flex gap-2">
      <button type="button" className="btn-primary !py-1 !px-3 text-[12px]" disabled={busy} onClick={() => act("approve")}>Approve</button>
      <button type="button" className="btn-ghost !py-1 !px-3 text-[12px]" disabled={busy} onClick={() => act("reject")}>Reject</button>
    </span>
  );
}
