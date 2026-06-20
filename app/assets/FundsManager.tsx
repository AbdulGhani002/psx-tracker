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
  fundType: string;
  annualYieldPct: number;
  anchorDate: string;
  nav: number; // published par NAV
  effectiveNav: number; // total-return NAV (grows daily for daily-dividend funds)
  dailyYieldPct: number;
  navFound: boolean;
  value: number;
  cost: number;
  unrealizedPL: number;
  unrealizedPct: number;
  dailyDividend: boolean;
};

type NavHit = { name: string; amc: string; nav: number };

const todayISO = () => new Date().toISOString().slice(0, 10);
const dateCls = "w-full bg-transparent border-b border-ink text-[14px] py-1.5 font-mono focus:outline-none focus:border-[var(--accent-deep)]";

export function FundsManager({ funds }: { funds: ValuedFund[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NavHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<NavHit | null>(null);
  const [units, setUnits] = useState(0);
  const [avgCost, setAvgCost] = useState(0);
  const [daily, setDaily] = useState(false);
  const [yieldPct, setYieldPct] = useState(0);
  const [anchorDate, setAnchorDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Per-fund editor
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ units: 0, avgCost: 0, daily: false, yieldPct: 0, anchorDate: todayISO() });

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
    if (!selected) return setError("Pick a fund from the search results.");
    if (units <= 0) return setError("Enter the units you hold.");
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
          fundType: daily ? "dailyDividend" : "growth",
          annualYieldPct: daily ? yieldPct : 0,
          anchorDate: daily ? anchorDate : "",
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
      setDaily(false);
      setYieldPct(0);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(f: ValuedFund) {
    setEditId(f._id);
    setEdit({
      units: f.units,
      avgCost: f.avgCost,
      daily: f.dailyDividend,
      yieldPct: f.annualYieldPct || 0,
      anchorDate: f.anchorDate || todayISO(),
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setSaving(true);
    try {
      await fetch(`/api/funds/${editId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          units: edit.units,
          avgCost: edit.avgCost,
          fundType: edit.daily ? "dailyDividend" : "growth",
          annualYieldPct: edit.daily ? edit.yieldPct : 0,
          anchorDate: edit.daily ? edit.anchorDate : "",
        }),
      });
      setEditId(null);
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
          <div className="font-medium text-[13px] flex items-center gap-2">
            {f.name}
            {f.dailyDividend && <Badge tone="accent">daily dividend</Badge>}
          </div>
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
        f.dailyDividend ? (
          <div>
            <div>{fmtRs(f.effectiveNav, true)}</div>
            {f.dailyYieldPct > 0 ? (
              <div className="text-[10px]" style={{ color: "var(--positive)" }}>+{f.dailyYieldPct.toFixed(3)}%/day · par {fmtRs(f.nav, true)}</div>
            ) : (
              <div className="text-[10px] text-muted">set yield to accrue</div>
            )}
          </div>
        ) : f.navFound ? (
          fmtRs(f.nav, true)
        ) : (
          <Badge tone="negative">no NAV</Badge>
        ),
    },
    { key: "value", header: "Value", align: "right", mono: true, render: (f) => fmtRs(f.value) },
    {
      key: "pl",
      header: "Return",
      align: "right",
      mono: true,
      render: (f) =>
        f.cost > 0 ? (
          <span style={{ color: f.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedPct(f.unrealizedPct)}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "act",
      header: "",
      align: "right",
      render: (f) => (
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => startEdit(f)} className="font-mono text-[10px] uppercase tracking-stat hover:underline">Edit</button>
          <button onClick={() => remove(f._id)} className="font-mono text-[10px] uppercase tracking-stat hover:underline" style={{ color: "var(--negative)" }}>Remove</button>
        </div>
      ),
    },
  ];

  const editingFund = funds.find((f) => f._id === editId);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="label-cap">{funds.length} fund{funds.length === 1 ? "" : "s"}</div>
        <Button variant={open ? "outline" : "solid"} onClick={() => setOpen(!open)}>{open ? "Close" : "Add Fund"}</Button>
      </div>

      {editingFund && (
        <Card>
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-medium text-[14px]">{editingFund.name}</div>
            <button onClick={() => setEditId(null)} className="label-cap hover:text-[var(--accent-deep)]">Cancel</button>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none mb-4">
            <input type="checkbox" checked={edit.daily} onChange={(e) => setEdit((p) => ({ ...p, daily: e.target.checked }))} className="w-4 h-4 accent-[var(--accent-deep)]" />
            <span className="text-[13px]">Daily-dividend / money-market fund — NAV stays at par, units grow from reinvested dividends</span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <NumberInput label={edit.daily ? "Units on anchor date" : "Units held"} value={edit.units} onChange={(v) => setEdit((p) => ({ ...p, units: v }))} min={0} step={0.0001} />
            <NumberInput label="Avg cost / unit (Rs)" value={edit.avgCost} onChange={(v) => setEdit((p) => ({ ...p, avgCost: v }))} min={0} step={0.01} />
            {edit.daily && (
              <>
                <NumberInput label="Annual yield %" value={edit.yieldPct} onChange={(v) => setEdit((p) => ({ ...p, yieldPct: v }))} min={0} max={100} step={0.1} hint="The fund's recent annualised payout (check MUFAP). Units accrue daily at this rate." />
                <div>
                  <label className="label-cap block mb-1.5">Anchor date</label>
                  <input type="date" value={edit.anchorDate} onChange={(e) => setEdit((p) => ({ ...p, anchorDate: e.target.value }))} className={dateCls} />
                  <p className="text-[11px] text-muted mt-1">When your unit count was last accurate (e.g. a statement date).</p>
                </div>
              </>
            )}
          </div>
          <div className="mt-5"><Button variant="solid" onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></div>
        </Card>
      )}

      {open && (
        <Card>
          <form onSubmit={addFund} className="space-y-5">
            <TextInput
              label="Search MUFAP funds"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="e.g. Alhamra Islamic Stock, MCB Pakistan..."
              hint="Live search of every Pakistani open-end fund."
            />
            {searching && <div className="text-[12px] text-muted">Searching MUFAP…</div>}
            {!selected && hits.length > 0 && (
              <div className="border border-rule divide-y divide-[var(--rule)] max-h-64 overflow-y-auto">
                {hits.map((h) => (
                  <button key={h.name} type="button" onClick={() => { setSelected(h); setAvgCost(h.nav); }} className="w-full text-left px-3 py-2 hover:bg-[var(--paper-2)] flex justify-between items-center gap-3">
                    <span className="text-[13px]">{h.name}<span className="text-[11px] text-muted block">{h.amc}</span></span>
                    <span className="font-mono mono-num text-[13px]">{fmtRs(h.nav, true)}</span>
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <div className="border-l-[3px] border-l-[var(--accent)] bg-[var(--paper-2)] p-3">
                <div className="text-[13px] font-medium">{selected.name}</div>
                <div className="text-[11px] text-muted">{selected.amc} · live NAV {fmtRs(selected.nav, true)}</div>
              </div>
            )}
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} className="w-4 h-4 accent-[var(--accent-deep)]" />
              <span className="text-[13px]">Daily-dividend / money-market fund (NAV stays at par, units grow)</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <NumberInput label={daily ? "Units on anchor date" : "Units held"} value={units} onChange={setUnits} min={0} step={0.0001} />
              <NumberInput label="Avg cost / unit (Rs)" value={avgCost} onChange={setAvgCost} min={0} step={0.01} hint="Defaults to current NAV; set your real average." />
              {daily && (
                <>
                  <NumberInput label="Annual yield %" value={yieldPct} onChange={setYieldPct} min={0} max={100} step={0.1} hint="Fund's recent annualised payout (from MUFAP)." />
                  <div>
                    <label className="label-cap block mb-1.5">Anchor date</label>
                    <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className={dateCls} />
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="solid" disabled={saving || !selected}>{saving ? "Saving…" : "Add Fund"}</Button>
              {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
            </div>
          </form>
        </Card>
      )}

      <Table columns={columns} rows={funds} rowKey={(f) => f._id} empty="No funds yet. Add one — the NAV comes from MUFAP automatically." />
      {funds.some((f) => f.dailyDividend) && (
        <p className="text-[11px] text-muted max-w-[80ch]">
          For daily-dividend funds the published NAV stays at par; we show an <strong>effective NAV that ticks up every day</strong> at
          the yield you set (from your anchor date), so the daily income shows as a rising NAV and counts in your return. Set the
          anchor date to when you bought to capture profit already earned. Edit the yield to your fund&apos;s actual rate (from MUFAP).
        </p>
      )}
    </div>
  );
}
