"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type FundResult = {
  code: string;
  mufapName: string | null;
  units: number;
  nav: number;
  value: number;
  asOf: string;
  tracked: boolean;
  unitsBefore: number | null;
  unitsDelta: number | null;
  applied: boolean;
  note: string;
  activityRows: number;
  avgCostBefore: number | null;
  avgCostProposed: number | null;
  costNote: string;
};
type StatementResponse = {
  ok: boolean;
  applied: boolean;
  appliedCount: number;
  navSeeded: boolean;
  registration: string | null;
  totalStated: number | null;
  totalComputed: number;
  problems: string[];
  funds: FundResult[];
  error?: string;
  detail?: string;
};

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function StatementCard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<StatementResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(apply: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("files", file);
      if (apply) form.append("apply", "1");
      const r = await fetch("/api/funds/statement", { method: "POST", body: form });
      const d: StatementResponse = await r.json();
      if (!r.ok) { setError(d?.detail ?? d?.error ?? "Parse failed."); return; }
      setRes(d);
      if (d.applied) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function onFile(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setRes(null);
    setError(null);
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="label-cap">Reconcile an iSave statement (.pdf)</div>
        <button onClick={() => fileRef.current?.click()} className="font-mono text-[10px] uppercase tracking-button hover:underline" style={{ color: "var(--accent-deep)" }} disabled={busy}>
          Choose PDF
        </button>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      <p className="text-[13px] text-muted max-w-[64ch]">
        Upload the statement of account MCB emails you. Units and repurchase NAVs are read per fund and re-checked against the statement&apos;s own
        total. When the window&apos;s transaction rows reconcile (every row&apos;s units proven against the balance chain), avg cost updates from them
        too — new money adds cost, reinvested dividends add units free, redemptions take cost out at your average. Anything unprovable leaves cost
        untouched and says why.
      </p>

      {file && (
        <div className="flex items-center gap-3 mt-3">
          <span className="font-mono text-[11px] text-muted">{file.name}</span>
          <Button variant="outline" onClick={() => send(false)} disabled={busy}>
            {busy ? "…" : "Preview"}
          </Button>
          {res && !res.applied && res.ok && (
            <Button variant="solid" onClick={() => send(true)} disabled={busy}>
              Apply to tracked funds
            </Button>
          )}
        </div>
      )}
      {error && <div className="mt-3 text-[13px]" style={{ color: "var(--negative)" }}>{error}</div>}

      {res && (
        <div className="mt-4 border-t border-rule pt-3">
          <div className="text-[13px]">
            Registration {res.registration ?? "—"} · statement total Rs {fmt(res.totalStated)} · rows sum Rs {fmt(res.totalComputed)}{" "}
            {res.ok ? (
              <span style={{ color: "var(--positive)" }}>reconciles ✓</span>
            ) : (
              <span style={{ color: "var(--negative)" }}>refused</span>
            )}
            {res.applied && (
              <span style={{ color: "var(--positive)" }}>
                {" "}
                — applied to {res.appliedCount} fund{res.appliedCount === 1 ? "" : "s"}
                {res.navSeeded ? ", NAV snapshot refreshed" : ""}
              </span>
            )}
          </div>
          {res.problems.length > 0 && (
            <ul className="mt-1 text-[12px] list-disc pl-5" style={{ color: "var(--negative)" }}>
              {res.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-[12px] font-mono mono-num">
              <thead>
                <tr className="border-t border-b border-ink text-left">
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px]">Fund</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">Units</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">NAV</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">Value</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">Δ units</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">Avg cost</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {res.funds.map((f) => (
                  <tr key={f.code} className="border-b border-rule">
                    <td className="px-2 py-1.5 font-medium" title={f.mufapName ?? undefined}>{f.code}</td>
                    <td className="px-2 py-1.5 text-right">{f.units}</td>
                    <td className="px-2 py-1.5 text-right">{f.nav}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(f.value)}</td>
                    <td className="px-2 py-1.5 text-right">{f.unitsDelta == null ? "—" : f.unitsDelta > 0 ? `+${f.unitsDelta}` : `${f.unitsDelta}`}</td>
                    <td className="px-2 py-1.5 text-right">
                      {f.avgCostProposed != null && f.avgCostBefore != null && f.avgCostProposed !== f.avgCostBefore ? (
                        <span style={{ color: "var(--accent-deep)" }}>{f.avgCostBefore} → {f.avgCostProposed}</span>
                      ) : (
                        f.avgCostBefore ?? "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-[11px]">
                      {f.applied ? <span style={{ color: "var(--positive)" }}>{f.note}</span> : f.note || (f.tracked ? "tracked" : "")}
                      {f.activityRows > 0 && (
                        <div className="text-muted">{f.activityRows} row{f.activityRows === 1 ? "" : "s"} in window{f.costNote ? ` — ${f.costNote}` : ""}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
