"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Rebuilds the analysis for the logged-in user (about a minute: the bars of
// ninety names, the model, thirteen charts) and reloads the page with it.
export function RefreshAnalysis() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/refresh", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={run} disabled={busy} className="label-cap border border-ink px-3 py-1.5 hover:bg-ink hover:text-[var(--paper)] disabled:opacity-50">
        {busy ? "Building, about a minute…" : "Rebuild now"}
      </button>
      {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
    </div>
  );
}
