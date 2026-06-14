"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { NumberInput } from "@/components/ui/NumberInput";

type Override = {
  parValue: number;
  cadence: string;
  payoutRatioPct: number;
  expectedAnnualDps: number;
};

export function DividendOverride({ symbol, initial }: { symbol: string; initial: Override }) {
  const router = useRouter();
  const [o, setO] = useState<Override>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof Override>(k: K, v: Override[K]) {
    setO((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/holdings/${symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dividendOverride: o }),
      });
      if (res.ok) {
        setSavedAt(Date.now());
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setO({ parValue: 0, cadence: "", payoutRatioPct: 0, expectedAnnualDps: 0 });
  }

  return (
    <Card>
      <p className="text-[13px] text-muted mb-4 max-w-[68ch]">
        Leave a field at 0 / Auto to let the model decide. Set a value to pin it — useful when the
        automatic calibration can&apos;t resolve a stock (e.g. an unusual par value, or a company whose
        recorded dividends are incomplete). These feed straight into the dividend forecast.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
        <NumberInput
          label="Par / face value (Rs)"
          value={o.parValue}
          onChange={(v) => set("parValue", v)}
          min={0}
          step={1}
          hint="0 = auto (calibrated from your dividends)"
        />
        <Select
          label="Cadence"
          value={o.cadence}
          onChange={(v) => set("cadence", v)}
          options={[
            { value: "", label: "Auto" },
            { value: "annual", label: "Annual" },
            { value: "semi-annual", label: "Semi-annual" },
            { value: "quarterly", label: "Quarterly" },
          ]}
          hint="how many payouts a year"
        />
        <NumberInput
          label="Payout ratio (% of EPS)"
          value={o.payoutRatioPct}
          onChange={(v) => set("payoutRatioPct", v)}
          min={0}
          max={500}
          step={5}
          suffix="%"
          hint="0 = auto"
        />
        <NumberInput
          label="Expected dividend (Rs/share/yr)"
          value={o.expectedAnnualDps}
          onChange={(v) => set("expectedAnnualDps", v)}
          min={0}
          step={0.5}
          hint="0 = auto · pins the forward dividend directly"
        />
      </div>
      <div className="flex items-center gap-3 mt-6 pt-4 border-t border-rule">
        <Button variant="solid" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save override"}
        </Button>
        <Button variant="outline" onClick={reset} disabled={saving}>
          Reset to auto
        </Button>
        {savedAt && Date.now() - savedAt < 3500 && <span className="text-[13px]" style={{ color: "var(--positive)" }}>Saved.</span>}
      </div>
    </Card>
  );
}
