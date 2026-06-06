"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";

type RestoreReport = Record<string, { restored: number; cleared?: number; failed?: number; error?: string; rolledBack?: boolean }>;

export function BackupManager() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"replace" | "merge">("merge");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; report?: RestoreReport } | null>(null);

  async function restore() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, text: "Choose a backup .json file first." });
      return;
    }
    if (mode === "replace" && !confirmReplace) {
      setResult({ ok: false, text: "Tick the confirm box — replace wipes existing data." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        setResult({ ok: false, text: "That file is not valid JSON." });
        return;
      }
      if (!parsed?.collections) {
        setResult({ ok: false, text: "This does not look like a PSX backup (no collections)." });
        return;
      }
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          confirm: mode === "replace" ? "REPLACE" : undefined,
          collections: parsed.collections,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok !== false) {
        setResult({ ok: true, text: `Restore complete (${mode}).`, report: d.report });
        router.refresh();
      } else if (res.ok && d?.ok === false) {
        // HTTP succeeded but one or more collections failed — show the report.
        setResult({ ok: false, text: "Restore finished with errors — see below. Failed collections were rolled back where possible.", report: d.report });
        router.refresh();
      } else if (d?.issues) {
        setResult({ ok: false, text: `Backup rejected: ${d.issues.slice(0, 3).join("; ")}${d.issues.length > 3 ? " …" : ""}` });
      } else {
        setResult({ ok: false, text: d?.detail ?? d?.error ?? "Restore failed." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="space-y-6">
        <div>
          <div className="label-cap mb-2">Download</div>
          <p className="text-[13px] text-muted mb-3 max-w-[60ch]">
            Saves every collection (holdings, transactions including trash, dividends, cash,
            funds, savings, commodities, settings, watchlist) to one JSON file. Keep it somewhere safe.
          </p>
          {/* A plain link works: the endpoint sends a download header and the
              browser reuses your login. */}
          <a
            href="/api/backup"
            className="inline-flex items-center justify-center px-4 py-2 text-[12px] font-medium uppercase tracking-button bg-ink text-paper border border-ink hover:bg-[var(--accent-deep)] hover:border-[var(--accent-deep)] transition-colors"
          >
            Download backup
          </a>
        </div>

        <div className="pt-5 border-t border-rule">
          <div className="label-cap mb-2">Restore</div>
          <p className="text-[13px] text-muted mb-4 max-w-[60ch]">
            Load a backup file. <span className="font-medium">Merge</span> adds or overwrites rows by id and
            leaves everything else untouched. <span className="font-medium">Replace</span> wipes each
            collection first, then loads the file — use it to roll back to an exact snapshot.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-end">
            <div>
              <label className="label-cap block mb-1.5">Backup file</label>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="block w-full text-[13px] file:mr-3 file:px-3 file:py-1.5 file:border file:border-ink file:bg-transparent file:text-ink file:text-[11px] file:uppercase file:tracking-button"
              />
            </div>
            <Select
              label="Mode"
              value={mode}
              onChange={(v) => setMode(v as "replace" | "merge")}
              options={[
                { value: "merge", label: "Merge (safe — upsert by id)" },
                { value: "replace", label: "Replace (wipe then load)" },
              ]}
            />
          </div>

          {mode === "replace" && (
            <label className="flex items-center gap-2 mt-4 text-[13px]" style={{ color: "var(--negative)" }}>
              <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
              I understand this erases current data and replaces it with the file.
            </label>
          )}

          <div className="mt-4">
            <Button variant="solid" onClick={restore} disabled={busy}>
              {busy ? "Restoring…" : "Restore from file"}
            </Button>
          </div>

          {result && (
            <div className="mt-4 text-[13px]" style={{ color: result.ok ? "var(--positive)" : "var(--negative)" }}>
              {result.text}
            </div>
          )}
          {result?.report && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
              {Object.entries(result.report).map(([name, r]) => (
                <div key={name} className="text-[12px] flex justify-between border-b border-rule py-1">
                  <span className="font-mono">{name}</span>
                  <span className="font-mono mono-num" style={{ color: r.error ? "var(--negative)" : "var(--muted)" }}>
                    {r.error
                      ? r.rolledBack
                        ? "failed · rolled back"
                        : `failed${r.failed ? ` (${r.failed})` : ""}`
                      : `${r.restored}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
