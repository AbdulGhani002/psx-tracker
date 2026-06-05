"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { NumberInput } from "@/components/ui/NumberInput";

type Settings = {
  filerStatus: string;
  dividendWhtFiler: number;
  dividendWhtNonFiler: number;
  cgtRateFiler: number;
  cgtRateNonFiler: number;
  pmexCommissionPerLot: number;
  pmexCgtPercent: number;
  concentrationCap: number;
};

export function AppSettingsManager({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
      if (res.ok) {
        setSavedAt(Date.now());
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5">
        <Select
          label="Tax filer status"
          value={s.filerStatus}
          onChange={(v) => set("filerStatus", v)}
          options={[
            { value: "filer", label: "Filer (on ATL)" },
            { value: "non-filer", label: "Non-filer" },
          ]}
          hint="Drives the tax report and the filer/non-filer meter."
        />
        <NumberInput label="Concentration cap (%)" value={s.concentrationCap} onChange={(v) => set("concentrationCap", v)} min={0} max={100} step={1} suffix="%" />
        <div />

        <NumberInput label="Dividend WHT — filer (%)" value={s.dividendWhtFiler} onChange={(v) => set("dividendWhtFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <NumberInput label="Dividend WHT — non-filer (%)" value={s.dividendWhtNonFiler} onChange={(v) => set("dividendWhtNonFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <div />

        <NumberInput label="CGT — filer (%)" value={s.cgtRateFiler} onChange={(v) => set("cgtRateFiler", v)} min={0} max={100} step={0.5} suffix="%" hint="Equities; verify against the current FBR schedule." />
        <NumberInput label="CGT — non-filer (%)" value={s.cgtRateNonFiler} onChange={(v) => set("cgtRateNonFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <div />

        <NumberInput label="PMEX commission / lot (Rs)" value={s.pmexCommissionPerLot} onChange={(v) => set("pmexCommissionPerLot", v)} min={0} step={10} hint="Round-turn, from your broker schedule." />
        <NumberInput label="PMEX CGT (%)" value={s.pmexCgtPercent} onChange={(v) => set("pmexCgtPercent", v)} min={0} max={100} step={0.5} suffix="%" />
      </div>

      <div className="flex items-center gap-3 mt-6 pt-4 border-t border-rule">
        <Button variant="solid" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save Settings"}
        </Button>
        {savedAt && Date.now() - savedAt < 3500 && (
          <span className="text-[13px]" style={{ color: "var(--positive)" }}>Saved.</span>
        )}
      </div>
    </Card>
  );
}
