"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Toggle } from "@/components/ui/Toggle";

type Props = {
  symbol: string;
  initial: {
    name: string;
    sector: string;
    shariaCompliant: boolean;
    targetAllocationPercent: number;
    rebalanceBand: number;
    targetRationale: string;
    standsInFor: string;
    notes: string;
  };
  transactionCount: number;
};

export function HoldingSettings({ symbol, initial, transactionCount }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [sector, setSector] = useState(initial.sector);
  const [sharia, setSharia] = useState(initial.shariaCompliant);
  const [target, setTarget] = useState<number>(initial.targetAllocationPercent);
  const [band, setBand] = useState<number>(initial.rebalanceBand);
  const [rationale, setRationale] = useState(initial.targetRationale);
  const [notes, setNotes] = useState(initial.notes);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/holdings/${symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          sector,
          shariaCompliant: sharia,
          targetAllocationPercent: target,
          rebalanceBand: band,
          targetRationale: rationale,
          standsInFor: "",
          notes,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Save failed.");
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function refreshFromPSX() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/holdings/${symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshFromPSX: true, name: "", sector: "" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Refresh failed.");
        return;
      }
      const updated = await res.json();
      if (updated.name) setName(updated.name);
      if (updated.sector) setSector(updated.sector);
      setSavedAt(Date.now());
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function deleteHolding() {
    if (transactionCount > 0) {
      setError(`Delete this holding's ${transactionCount} transaction(s) first.`);
      return;
    }
    if (!confirm(`Delete the ${symbol} holding? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/holdings/${symbol}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "Delete failed.");
        return;
      }
      router.push("/holdings");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  const recentlySaved = savedAt && Date.now() - savedAt < 3500;

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <NumberInput
            label="Target allocation"
            value={target}
            onChange={setTarget}
            step={0.5}
            min={0}
            max={100}
            suffix="%"
            hint="Your goal weight in the portfolio."
          />
          <NumberInput
            label="Rebalance band"
            value={band}
            onChange={setBand}
            step={0.5}
            min={0}
            max={50}
            suffix="%"
            hint="Tolerance before /rebalance flags drift."
          />
          <div className="md:col-span-2">
            <Toggle
              label="Sharia compliant"
              value={sharia}
              onChange={setSharia}
              hint="Counted toward the Sharia exposure on the dashboard."
            />
          </div>
          <TextInput
            label="Company name (override)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="From PSX"
            hint="Leave the PSX-scraped value or override it."
          />
          <TextInput
            label="Sector (override)"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="From PSX"
          />
          <div className="md:col-span-2 space-y-1.5">
            <label className="label-cap block">Target rationale</label>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
              className="field w-full text-[14px] resize-none"
              placeholder="Why is this position weighted at this %?"
            />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <label className="label-cap block">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="field w-full text-[14px] resize-none"
              placeholder="Anything to remember about this position."
            />
          </div>
        </div>

        {error && (
          <div className="text-[13px] mt-4" style={{ color: "var(--negative)" }}>
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-6 pt-4 border-t border-rule">
          <Button variant="solid" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </Button>
          <Button variant="outline" onClick={refreshFromPSX} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh from PSX"}
          </Button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={deleteHolding}
            disabled={deleting || transactionCount > 0}
            className="font-mono text-[11px] uppercase tracking-button hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--negative)" }}
            title={
              transactionCount > 0
                ? `Delete the ${transactionCount} transaction(s) first.`
                : "Delete this holding"
            }
          >
            {deleting ? "Deleting…" : "Delete Holding"}
          </button>
        </div>

        {recentlySaved && (
          <div className="text-[12px] mt-2" style={{ color: "var(--positive)" }}>
            Saved.
          </div>
        )}
      </Card>
    </div>
  );
}
