"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Starts a rebuild of the analysis (a minute or two: the bars of ninety
// names, the model, thirteen charts) and asks after it every few seconds
// until it is done, then reloads the page with the new one.
export function RefreshAnalysis() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function run() {
    setBusy(true);
    setError(null);
    setSeconds(0);
    try {
      const res = await fetch("/api/analysis/refresh", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      const t0 = Date.now();
      timer.current = setInterval(async () => {
        setSeconds(Math.round((Date.now() - t0) / 1000));
        try {
          const s = await fetch("/api/analysis/refresh", { cache: "no-store" });
          const st = await s.json().catch(() => ({}));
          if (!s.ok) throw new Error(st?.error ?? `HTTP ${s.status}`);
          if (!st.running) {
            if (timer.current) clearInterval(timer.current);
            timer.current = null;
            setBusy(false);
            if (st.job?.error) setError(st.job.error);
            else router.refresh();
          }
        } catch (e) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          setBusy(false);
          setError(String(e instanceof Error ? e.message : e));
        }
      }, 4000);
    } catch (e) {
      setBusy(false);
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={run} disabled={busy} className="btn-ghost text-[12px] disabled:opacity-50">
        {busy ? `Building… ${seconds}s` : "Rebuild now"}
      </button>
      {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
    </div>
  );
}
