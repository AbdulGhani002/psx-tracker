"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Parks a holding (a few shares kept for the company's reports, left out of
// the portfolio figures) or brings it back. One PATCH, then the page re-reads.
export function ParkButton({ symbol, parked, className = "" }: { symbol: string; parked: boolean; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/holdings/${symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parked: !parked, ...(parked ? {} : { parkedNote: "Kept for the company's reports and notices" }) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" onClick={toggle} disabled={busy} className={`btn-ghost !py-[5px] !px-3 !text-[12px] ${className}`} title={parked ? "Count it in the portfolio again" : "Keep it for the company's reports only, outside the portfolio figures"}>
        {busy ? "…" : parked ? "Unpark" : "Park"}
      </button>
      {error && <span className="text-[11px]" style={{ color: "var(--negative)" }}>{error}</span>}
    </span>
  );
}
