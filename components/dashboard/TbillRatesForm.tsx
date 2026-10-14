"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The 12-month T-bill cut-off on each year's first day, for the Yearly tab's
// comparison, when it should differ from SBP's auction kept for the year.
// Empty clears it, and SBP's rate (or the policy rate) stands in again.

export function TbillRatesForm({ years }: { years: Array<{ endYear: number; label: string; rate: number | null; inUse: number | null }> }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<number, string>>(Object.fromEntries(years.map((y) => [y.endYear, y.rate != null ? String(y.rate) : ""])));
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(endYear: number) {
    const raw = (values[endYear] ?? "").trim();
    const pct = raw === "" ? null : Number(raw);
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 60)) return setError("A rate between 0 and 60.");
    setBusy(endYear);
    setError(null);
    const res = await fetch("/api/yearly/tbill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endYear, pct }) });
    setBusy(null);
    if (!res.ok) return setError("Could not save it.");
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-2">
      {years.map((y) => (
        <div key={y.endYear} className="flex flex-wrap items-center gap-2">
          <span className="w-24 font-semibold">{y.label}</span>
          <span className="text-muted">1 July {y.endYear - 1}</span>
          <input value={values[y.endYear] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [y.endYear]: e.target.value }))} className="field mono-num w-24 !py-1" placeholder={y.inUse != null ? String(y.inUse) : "%"} inputMode="decimal" />
          <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => save(y.endYear)} disabled={busy === y.endYear}>{busy === y.endYear ? "Saving…" : "Save"}</button>
        </div>
      ))}
      {error && <p className="text-[12px]" style={{ color: "var(--negative)" }}>{error}</p>}
    </div>
  );
}
