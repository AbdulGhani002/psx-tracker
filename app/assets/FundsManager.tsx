"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum, fmtSignedPct } from "@/lib/format";

type ValuedFund = {
  _id: string;
  name: string;
  mufapName: string;
  amc: string;
  units: number;
  avgCost: number;
  nav: number;
  navFound: boolean;
  value: number;
  cost: number;
  unrealizedPL: number;
  unrealizedPct: number;
};

type NavHit = { name: string; amc: string; nav: number };

export function FundsManager({ funds }: { funds: ValuedFund[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NavHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<NavHit | null>(null);
  const [units, setUnits] = useState(0);
  const [avgCost, setAvgCost] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setSearching(true);
      fetch(`/api/funds/nav-search?q=${encodeURIComponent(query)}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((d) => setHits(d.results ?? []))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, open]);

  async function addFund(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setError("Pick a fund from the search results.");
      return;
    }
    if (units <= 0) {
      setError("Enter the units you hold.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/funds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: selected.name,
          mufapName: selected.name,
          amc: selected.amc,
          units,
          avgCost: avgCost || selected.nav,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.detail ?? b?.error ?? "Failed.");
        return;
      }
      setOpen(false);
      setSelected(null);
      setQuery("");
      setUnits(0);
      setAvgCost(0);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this fund?")) return;
    await fetch(`/api/funds/${id}`, { method: "DELETE" });
    router.refresh();
  }

  const columns: Column<ValuedFund>[] = [
    {
      key: "name",
      header: "Fund",
      render: (f) => (
        <div>
          <div className="font-medium text-[13px]">{f.name}</div>
          <div className="text-[11px] text-muted">{f.amc}</div>
        </div>
      ),
    },
    { key: "units", header: "Units", align: "right", mono: true, render: (f) => fmtNum(f.units) },
    {
      key: "nav",
      header: "NAV",
      align: "right",
      mono: true,
      render: (f) =>
        f.navFound ? (
          fmtRs(f.nav, true)
        ) : (
          <Badge tone="negative">no NAV</Badge>
        ),
    },
    { key: "value", header: "Value", align: "right", mono: true, render: (f) => fmtRs(f.value) },
    {
      key: "pl",
      header: "Unrealised",
      align: "right",
      mono: true,
      render: (f) =>
        f.cost > 0 ? (
          <span style={{ color: f.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>
            {fmtSignedPct(f.unrealizedPct)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "remove",
      header: "",
      align: "right",
      render: (f) => (
        <button
          onClick={() => remove(f._id)}
          className="font-mono text-[10px] uppercase tracking-stat hover:underline"
          style={{ color: "var(--negative)" }}
        >
          Remove
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="label-cap">{funds.length} fund{funds.length === 1 ? "" : "s"}</div>
        <Button variant={open ? "outline" : "solid"} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Add Fund"}
        </Button>
      </div>

      {open && (
        <Card>
          <form onSubmit={addFund} className="space-y-5">
            <TextInput
              label="Search MUFAP funds"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              placeholder="e.g. Alhamra Islamic Stock, MCB Pakistan..."
              hint="Live search of every Pakistani open-end fund."
            />
            {searching && <div className="text-[12px] text-muted">Searching MUFAP…</div>}
            {!selected && hits.length > 0 && (
              <div className="border border-rule divide-y divide-[var(--rule)] max-h-64 overflow-y-auto">
                {hits.map((h) => (
                  <button
                    key={h.name}
                    type="button"
                    onClick={() => {
                      setSelected(h);
                      setAvgCost(h.nav);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--paper-2)] flex justify-between items-center gap-3"
                  >
                    <span className="text-[13px]">
                      {h.name}
                      <span className="text-[11px] text-muted block">{h.amc}</span>
                    </span>
                    <span className="font-mono mono-num text-[13px]">{fmtRs(h.nav, true)}</span>
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <div className="border-l-[3px] border-l-[var(--accent)] bg-[var(--paper-2)] p-3">
                <div className="text-[13px] font-medium">{selected.name}</div>
                <div className="text-[11px] text-muted">
                  {selected.amc} · live NAV {fmtRs(selected.nav, true)}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <NumberInput label="Units held" value={units} onChange={setUnits} min={0} step={0.0001} />
              <NumberInput
                label="Avg cost / unit (Rs)"
                value={avgCost}
                onChange={setAvgCost}
                min={0}
                step={0.01}
                hint="Defaults to current NAV; set your real average."
              />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="solid" disabled={saving || !selected}>
                {saving ? "Saving…" : "Add Fund"}
              </Button>
              {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
            </div>
          </form>
        </Card>
      )}

      <Table
        columns={columns}
        rows={funds}
        rowKey={(f) => f._id}
        empty="No funds yet. Add one — the NAV comes from MUFAP automatically."
      />
    </div>
  );
}
