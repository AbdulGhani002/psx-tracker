"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { fmtDate } from "@/lib/format";

type Rate = { _id?: string; effectiveDate: string; rate: number; note?: string };

type Props = {
  initialRates: Array<{ _id: string; effectiveDate: string; rate: number; note: string }>;
  usingDefaults: boolean;
  defaults: Array<{ effectiveDate: string; rate: number }>;
};

export function SbpRatesManager({ initialRates, usingDefaults, defaults }: Props) {
  const router = useRouter();
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState<number>(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function addRate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rate <= 0) {
      setError("Enter a rate above 0%.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/sbp-rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effectiveDate: date, rate, note }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Save failed.");
        return;
      }
      setRate(0);
      setNote("");
      setSavedAt(Date.now());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function seedDefaults() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sbp-rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "seed-defaults" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Seed failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this rate entry?")) return;
    setBusy(true);
    try {
      await fetch(`/api/sbp-rates/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const rows: Rate[] = usingDefaults ? defaults : initialRates;

  const columns: Column<Rate>[] = [
    {
      key: "date",
      header: "Effective from",
      render: (r) => <span className="font-mono text-[12px]">{fmtDate(r.effectiveDate)}</span>,
    },
    {
      key: "rate",
      header: "Policy rate",
      align: "right",
      mono: true,
      render: (r) => (
        <span className="font-medium" style={{ color: "var(--accent-deep)" }}>
          {r.rate.toFixed(2)}%
        </span>
      ),
    },
    {
      key: "note",
      header: "Note",
      render: (r) => <span className="text-[12px] text-muted">{r.note ?? ""}</span>,
    },
    {
      key: "remove",
      header: "",
      align: "right",
      render: (r) =>
        usingDefaults || !r._id ? (
          <span className="text-[10px] font-mono text-muted uppercase tracking-stat">built-in</span>
        ) : (
          <button
            onClick={() => remove(r._id!)}
            className="font-mono text-[10px] uppercase tracking-stat hover:underline"
            style={{ color: "var(--negative)" }}
          >
            Remove
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      {usingDefaults && (
        <Card>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Badge tone="amber">Using built-in defaults</Badge>
              <p className="text-[13px] text-muted mt-2 max-w-[60ch]">
                You haven&apos;t set any rates yet, so the benchmark uses the built-in table below.
                Click to copy them into an editable table, then add new rates as SBP changes them.
              </p>
            </div>
            <Button variant="solid" onClick={seedDefaults} disabled={busy}>
              {busy ? "Loading…" : "Make editable"}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <form onSubmit={addRate} className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-4 items-end">
          <div className="space-y-1.5">
            <label className="label-cap block">Effective from</label>
            <div className="border-b border-ink">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none"
              />
            </div>
          </div>
          <NumberInput
            label="Policy rate (%)"
            value={rate}
            onChange={setRate}
            step={0.25}
            min={0}
            max={100}
            suffix="%"
          />
          <TextInput
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. MPC 16 Jun"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="solid" disabled={busy}>
              {busy ? "Saving…" : "Add / Update"}
            </Button>
          </div>
          {error && (
            <div className="md:col-span-4 text-[13px]" style={{ color: "var(--negative)" }}>
              {error}
            </div>
          )}
          {savedAt && Date.now() - savedAt < 3500 && (
            <div className="md:col-span-4 text-[13px]" style={{ color: "var(--positive)" }}>
              Saved. The benchmark risk-free line will use it on next load.
            </div>
          )}
        </form>
      </Card>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r._id ?? r.effectiveDate}
        empty="No rates."
      />
      <p className="text-[11px] text-muted font-mono">
        Same date entered twice updates the rate. The most recent rate on or before each day is used.
      </p>
    </div>
  );
}
