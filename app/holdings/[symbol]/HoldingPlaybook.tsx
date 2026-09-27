"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { HOLDING_TIERS, GOAL_TAGS } from "@/lib/types";

type Metric = { name: string; source: string; green: string; red: string; current: string };

type Props = {
  symbol: string;
  initial: {
    tier: string;
    convictionScore: number;
    goalTag: string;
    thesis: string;
    trackedMetrics: Metric[];
  };
};

export function HoldingPlaybook({ symbol, initial }: Props) {
  const router = useRouter();
  const [tier, setTier] = useState(initial.tier || "");
  const [conviction, setConviction] = useState<number>(initial.convictionScore || 0);
  const [goal, setGoal] = useState(initial.goalTag || "");
  const [thesis, setThesis] = useState(initial.thesis || "");
  const [metrics, setMetrics] = useState<Metric[]>(
    initial.trackedMetrics.length > 0
      ? initial.trackedMetrics
      : [{ name: "", source: "", green: "", red: "", current: "" }]
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function setMetric(i: number, patch: Partial<Metric>) {
    setMetrics((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  function addMetric() {
    setMetrics((ms) => [...ms, { name: "", source: "", green: "", red: "", current: "" }]);
  }
  function removeMetric(i: number) {
    setMetrics((ms) => ms.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/holdings/${symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier,
          convictionScore: conviction,
          goalTag: goal,
          thesis,
          trackedMetrics: metrics.filter((m) => m.name.trim() !== ""),
        }),
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
          label="Tier"
          value={tier}
          onChange={setTier}
          options={[
            { value: "", label: "— Unassigned —" },
            ...HOLDING_TIERS.map((t) => ({ value: t, label: t })),
          ]}
        />
        <NumberInput
          label="Conviction score / 25"
          value={conviction}
          onChange={setConviction}
          min={0}
          max={25}
          step={1}
        />
        <Select
          label="Goal / job"
          value={goal}
          onChange={setGoal}
          options={[{ value: "", label: "— None —" }, ...GOAL_TAGS.map((g) => ({ value: g, label: g }))]}
        />
      </div>


      <div className="mt-5 space-y-1.5">
        <label className="label-cap block">Thesis (2 sentences)</label>
        <textarea
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          rows={2}
          className="field w-full text-[14px] resize-none"
          placeholder="What this company is and why you own it."
        />
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between mb-3">
          <div className="label-cap">The numbers to track each quarter</div>
          <button
            type="button"
            onClick={addMetric}
            className="font-mono text-[10px] uppercase tracking-button hover:underline"
            style={{ color: "var(--accent-deep)" }}
          >
            + Add metric
          </button>
        </div>
        <div className="space-y-3">
          {metrics.map((m, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
              <TextInput label={i === 0 ? "Metric" : ""} value={m.name} onChange={(e) => setMetric(i, { name: e.target.value })} placeholder="e.g. ROE" />
              <TextInput label={i === 0 ? "Source" : ""} value={m.source} onChange={(e) => setMetric(i, { source: e.target.value })} placeholder="filing note" />
              <TextInput label={i === 0 ? "Green" : ""} value={m.green} onChange={(e) => setMetric(i, { green: e.target.value })} placeholder="> 25%" />
              <TextInput label={i === 0 ? "Red" : ""} value={m.red} onChange={(e) => setMetric(i, { red: e.target.value })} placeholder="< 18%" />
              <div className="flex items-end gap-2">
                <TextInput label={i === 0 ? "Current" : ""} value={m.current} onChange={(e) => setMetric(i, { current: e.target.value })} placeholder="value" />
                <button
                  type="button"
                  onClick={() => removeMetric(i)}
                  className="font-mono text-[10px] uppercase pb-2 hover:underline"
                  style={{ color: "var(--negative)" }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-6 pt-4 border-t border-rule">
        <Button variant="solid" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save Playbook"}
        </Button>
        {savedAt && Date.now() - savedAt < 3500 && (
          <span className="text-[13px]" style={{ color: "var(--positive)" }}>Saved.</span>
        )}
      </div>
    </Card>
  );
}
