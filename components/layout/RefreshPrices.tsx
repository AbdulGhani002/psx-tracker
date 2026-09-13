"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshPrices() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/prices/refresh", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok ? `Refreshed ${d.refreshed}/${d.total}` : "Refresh failed");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={refresh}
        disabled={busy}
        className="btn-ghost text-[12px] disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "↻ Refresh prices"}
      </button>
      {msg && <span className="text-[11px] text-muted font-mono">{msg}</span>}
    </div>
  );
}
