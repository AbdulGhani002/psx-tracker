"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { fmtRs } from "@/lib/format";
import { gordonValue } from "@/lib/calculations/gordon";

type Disclosed = {
  requiredReturnPct: number;
  growthPct: number;
  baseDps: number;
  source: string;
  asOf: string;
};

type Props = {
  symbol: string;
  initial: Disclosed;
};

// Transcribe the company's OWN published fair-value assumptions (e.g. a Level-3
// model in its audited accounts) — r, g, the dividend it was built on, and the
// citation. The valuation engine weights this above every model of ours, so the
// bar is strict: enter only what the report actually says, with its source.
export function DisclosedModelEditor({ symbol, initial }: Props) {
  const router = useRouter();
  const [r, setR] = useState(initial.requiredReturnPct || 0);
  const [g, setG] = useState(initial.growthPct || 0);
  const [dps, setDps] = useState(initial.baseDps || 0);
  const [source, setSource] = useState(initial.source || "");
  const [asOf, setAsOf] = useState(initial.asOf || "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!(r > 0) || !(dps > 0)) return null;
    return gordonValue(dps, r, g).value;
  }, [r, g, dps]);

  const isSet = initial.baseDps > 0 && initial.requiredReturnPct > 0;
  const filled = r > 0 && dps > 0;
  // A number wearing an auditor's name MUST carry the citation.
  const missingSource = filled && source.trim().length < 8;

  async function save(clear = false) {
    setSaving(true);
    setError(null);
    try {
      const body = clear
        ? { disclosedValuation: { requiredReturnPct: 0, growthPct: 0, baseDps: 0, source: "", asOf: "" } }
        : { disclosedValuation: { requiredReturnPct: r, growthPct: g, baseDps: dps, source: source.trim(), asOf } };
      const res = await fetch(`/api/holdings/${symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? "Failed to save.");
        return;
      }
      if (clear) {
        setR(0); setG(0); setDps(0); setSource(""); setAsOf("");
      }
      setSavedAt(Date.now());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
        <NumberInput label="Required return r (%)" value={r} onChange={setR} min={0} max={40} step={0.5} hint="The discount rate the company used." />
        <NumberInput label="Growth g (%)" value={g} onChange={setG} min={0} max={20} step={0.5} hint="Their perpetual growth assumption." />
        <NumberInput label="Base dividend (Rs)" value={dps} onChange={setDps} min={0} step={0.05} hint="The dividend the model discounts." />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-x-6 gap-y-4 mt-4">
        <TextInput
          label="Source (report + auditor)"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder='e.g. "FY25 annual report note 7.2, Level-3 fair value, signed off by A.F. Ferguson"'
          hint="Required — an audited number must be citable."
        />
        <div>
          <label className="label-cap block mb-1.5">Report date</label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="field w-full text-[14px] font-mono"
          />
        </div>
      </div>

      {preview != null && (
        <p className="text-[13px] mt-4">
          Their assumptions price it at{" "}
          <span className="font-mono mono-num font-medium">{fmtRs(preview, true)}</span>
          <span className="text-muted"> — Gordon: {dps.toFixed(2)} × {(1 + g / 100).toFixed(2)} ÷ ({(r / 100).toFixed(2)} − {(g / 100).toFixed(2)})</span>
        </p>
      )}

      <div className="flex items-center gap-3 mt-5">
        <Button variant="solid" onClick={() => save(false)} disabled={saving || !filled || missingSource}>
          {saving ? "Saving…" : "Save the company's model"}
        </Button>
        {isSet && (
          <Button variant="outline" onClick={() => save(true)} disabled={saving}>
            Clear
          </Button>
        )}
        {missingSource && <span className="text-[12px]" style={{ color: "var(--negative)" }}>Add the source first — no citation, no save.</span>}
        {error && <span className="text-[12px]" style={{ color: "var(--negative)" }}>{error}</span>}
        {savedAt != null && Date.now() - savedAt < 3500 && (
          <span className="text-[12px]" style={{ color: "var(--positive)" }}>Saved — the valuation now anchors on it.</span>
        )}
      </div>
      <p className="text-[11px] text-muted mt-4 max-w-[80ch]">
        Only enter what the report actually discloses. When set, this outweighs every model of ours in the intrinsic
        blend; when empty, the method shows &quot;not applicable&quot; — it is never guessed.
      </p>
    </Card>
  );
}
