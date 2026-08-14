"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtSignedRs, fmtSignedPct, fmtNum } from "@/lib/format";

type Trade = {
  _id: string;
  symbol: string;
  name: string;
  side: "LONG" | "SHORT";
  lots: number;
  lotSize: number;
  entryPrice: number;
  entryDate: string;
  exitPrice: number | null;
  exitDate: string | null;
  currentPrice: number | null;
  status: string;
  notes: string;
  units: number;
  exposure: number;
  markPrice: number;
  grossPL: number;
  commission: number;
  netPL: number;
  cgt: number;
  netAfterTax: number;
  returnPct: number;
  returnOnMarginPct: number | null;
  leverage: number | null;
  isOpen: boolean;
  expiryDate: string | null;
  contractType: string;
  marginPosted: number;
  expiry: { state: "none" | "ok" | "near" | "expired"; daysToExpiry: number | null; deliveryRisk: boolean };
};

const SYMBOLS = [
  { value: "GOLD", label: "Gold (GC=F)" },
  { value: "SILVER", label: "Silver (SI=F)" },
  { value: "CRUDE", label: "Crude oil WTI (CL=F)" },
  { value: "BRENT", label: "Brent (BZ=F)" },
  { value: "COPPER", label: "Copper (HG=F)" },
  { value: "PLATINUM", label: "Platinum (PL=F)" },
  { value: "NATURALGAS", label: "Natural gas (NG=F)" },
  { value: "KSE100", label: "KSE-100 index" },
  { value: "EURUSD", label: "Currency — EUR/USD" },
  { value: "GBPUSD", label: "Currency — GBP/USD" },
  { value: "AUDUSD", label: "Currency — AUD/USD" },
  { value: "NZDUSD", label: "Currency — NZD/USD" },
  { value: "USDJPY", label: "Currency — USD/JPY" },
  { value: "USDCHF", label: "Currency — USD/CHF" },
  { value: "USDCAD", label: "Currency — USD/CAD" },
];

export function CommoditiesView({
  trades,
  commissionPerLot,
  cgtPercent,
  refs = {},
}: {
  trades: Trade[];
  commissionPerLot: number;
  cgtPercent: number;
  // Live international reference in PKR per unit, keyed by instrument. Shown
  // beside an open contract's mark so a stale mark is obvious. Never used to
  // compute P/L — PMEX settles on its own prices.
  refs?: Record<string, number | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("GOLD");
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [lots, setLots] = useState(1);
  const [lotSize, setLotSize] = useState(10);
  const [entryPrice, setEntryPrice] = useState(0);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState("");
  const [contractType, setContractType] = useState<"CASH_SETTLED" | "DELIVERABLE">("CASH_SETTLED");
  const [marginPosted, setMarginPosted] = useState(0);
  const [ref, setRef] = useState<{ usd: number | null; pkr: number | null; unit: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRef(sym: string) {
    setRef(null);
    try {
      const r = await fetch(`/api/commodities/ref/${sym}`);
      if (r.ok) setRef(await r.json());
    } catch {
      /* ignore */
    }
  }

  async function addTrade(e: React.FormEvent) {
    e.preventDefault();
    if (lots <= 0 || lotSize <= 0 || entryPrice <= 0) {
      setError("Lots, lot size and entry price must be positive.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/commodities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          name: SYMBOLS.find((s) => s.value === symbol)?.label ?? symbol,
          side,
          lots,
          lotSize,
          entryPrice,
          entryDate,
          currentPrice: entryPrice,
          expiryDate: expiryDate || null,
          contractType,
          marginPosted,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.detail ?? b?.error ?? "Failed.");
        return;
      }
      setOpen(false);
      setEntryPrice(0);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="label-cap">
          {trades.length} trade{trades.length === 1 ? "" : "s"} · comm. {fmtRs(commissionPerLot)}/lot · CGT {cgtPercent}%
        </div>
        <Button variant={open ? "outline" : "solid"} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Add Trade"}
        </Button>
      </div>

      {open && (
        <Card>
          <form onSubmit={addTrade} className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
            <Select
              label="Commodity"
              value={symbol}
              onChange={(v) => {
                setSymbol(v);
                loadRef(v);
              }}
              options={SYMBOLS}
            />
            <Select label="Side" value={side} onChange={(v) => setSide(v as any)} options={[{ value: "LONG", label: "Long (buy)" }, { value: "SHORT", label: "Short (sell)" }]} />
            <div className="space-y-1.5">
              <label className="label-cap block">Entry date</label>
              <div className="border-b border-ink">
                <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none" />
              </div>
            </div>
            <NumberInput label="Lots" value={lots} onChange={setLots} min={0} step={1} />
            <NumberInput label="Units / lot" value={lotSize} onChange={setLotSize} min={0} step={1} hint="oz, barrels, index pts per lot." />
            <NumberInput label="Entry price (Rs/unit)" value={entryPrice} onChange={setEntryPrice} min={0} step={0.01} hint={ref?.pkr ? `Ref ≈ Rs ${ref.pkr.toFixed(0)}/${ref.unit.split("/")[1] ?? "unit"}` : undefined} />
            <div className="space-y-1.5">
              <label className="label-cap block">Expiry date</label>
              <div className="border-b border-ink">
                <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none" style={{ color: "var(--ink)" }} />
              </div>
              <div className="text-[11px] text-muted">Left blank it is simply not tracked. Set it and you get a warning before the exchange settles it for you.</div>
            </div>
            <Select
              label="Settlement"
              value={contractType}
              onChange={(v) => setContractType(v as "CASH_SETTLED" | "DELIVERABLE")}
              options={[
                { value: "CASH_SETTLED", label: "Cash settled" },
                { value: "DELIVERABLE", label: "Deliverable" },
              ]}
              hint="A deliverable contract left open past expiry settles by actual delivery."
            />
            <NumberInput label="Margin posted (Rs)" value={marginPosted} onChange={setMarginPosted} min={0} step={100} hint="Optional. Enables return-on-margin and leverage." />
            <div className="md:col-span-3 flex items-center gap-3">
              <Button type="submit" variant="solid" disabled={saving}>{saving ? "Saving…" : "Add Trade"}</Button>
              {ref && (
                <span className="text-[11px] text-muted font-mono">
                  Live ref: {ref.usd != null ? `$${ref.usd.toFixed(2)} ${ref.unit}` : "—"}{ref.pkr != null ? ` ≈ Rs ${ref.pkr.toFixed(0)}` : ""}
                </span>
              )}
              {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
            </div>
          </form>
        </Card>
      )}

      {trades.length === 0 ? (
        <Card><p className="text-sm text-muted">No trades yet. Add your first PMEX swing.</p></Card>
      ) : (
        <div className="space-y-3">
          {trades.map((t) => (
            <TradeCard key={t._id} trade={t} refPkr={refs[t.symbol] ?? null} onChange={() => router.refresh()} />
          ))}
        </div>
      )}
    </div>
  );
}

function TradeCard({ trade: t, refPkr, onChange }: { trade: Trade; refPkr: number | null; onChange: () => void }) {
  const [mark, setMark] = useState<number>(t.currentPrice ?? t.entryPrice);
  const [showClose, setShowClose] = useState(false);
  const [exitPrice, setExitPrice] = useState<number>(t.markPrice);
  const [busy, setBusy] = useState(false);

  async function updateMark() {
    setBusy(true);
    try {
      await fetch(`/api/commodities/${t._id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPrice: mark }),
      });
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (exitPrice <= 0) return;
    setBusy(true);
    try {
      await fetch(`/api/commodities/${t._id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ close: true, exitPrice, exitDate: new Date().toISOString().slice(0, 10) }),
      });
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm("Delete this trade?")) return;
    await fetch(`/api/commodities/${t._id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="font-mono font-medium text-[15px]">{t.symbol}</span>
          <Badge tone={t.side === "LONG" ? "accent" : "negative"}>{t.side}</Badge>
          <Badge tone={t.isOpen ? "amber" : "default"}>{t.isOpen ? "OPEN" : "CLOSED"}</Badge>
          {t.isOpen && t.expiry.state === "expired" && (
            <Badge tone="negative">{t.expiry.deliveryRisk ? "EXPIRED · DELIVERY" : "EXPIRED"}</Badge>
          )}
          {t.isOpen && t.expiry.state === "near" && <Badge tone="amber">{t.expiry.daysToExpiry}D TO EXPIRY</Badge>}
          {t.contractType === "DELIVERABLE" && <Badge tone="default">DELIVERABLE</Badge>}
          <span className="text-[12px] text-muted font-mono">{t.lots} lot × {fmtNum(t.lotSize)} = {fmtNum(t.units)} units</span>
        </div>
        <div className="text-right">
          <div className="font-display mono-num text-[22px]" style={{ fontVariationSettings: "'opsz' 144", color: t.netPL >= 0 ? "var(--positive)" : "var(--negative)" }}>
            {fmtSignedRs(t.netPL)}
          </div>
          <div className="text-[11px] text-muted font-mono">{fmtSignedPct(t.returnPct, 1)} on {fmtRs(t.exposure)}</div>
          {t.returnOnMarginPct != null && (
            <div className="text-[11px] font-mono" style={{ color: t.returnOnMarginPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {fmtSignedPct(t.returnOnMarginPct, 1)} on {fmtRs(t.marginPosted)} margin
              {t.leverage != null ? ` · ${t.leverage.toFixed(1)}x` : ""}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-4 border-t border-rule font-mono mono-num text-[13px]">
        <Field label="Entry" value={fmtRs(t.entryPrice, true)} />
        <Field label={t.isOpen ? "Mark" : "Exit"} value={fmtRs(t.markPrice, true)} />
        <Field label="Gross P/L" value={fmtSignedRs(t.grossPL)} />
        <Field label="Commission" value={fmtRs(t.commission)} />
        <Field label={t.isOpen ? "CGT (on close)" : "CGT"} value={fmtRs(t.cgt)} />
      </div>

      {t.isOpen && refPkr != null && (
        <div className="mt-3 text-[11px] text-muted font-mono">
          World reference {fmtRs(refPkr, true)}/unit
          {t.currentPrice == null
            ? " — this contract has no mark, so its P/L above is shown at entry and is excluded from the year's open total."
            : ` — your mark is ${fmtSignedPct((t.currentPrice - refPkr) / refPkr, 1)} against it.`}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 mt-4">
        {t.isOpen && (
          <>
            <div className="flex items-end gap-2">
              <NumberInput label="Current price" value={mark} onChange={setMark} min={0} step={0.01} />
              <Button variant="outline" onClick={updateMark} disabled={busy}>Mark</Button>
            </div>
            <Button variant="outline" onClick={() => setShowClose(!showClose)}>{showClose ? "Cancel" : "Close trade"}</Button>
          </>
        )}
        <div className="flex-1" />
        <button onClick={remove} className="font-mono text-[10px] uppercase tracking-stat hover:underline" style={{ color: "var(--negative)" }}>Delete</button>
      </div>

      {showClose && t.isOpen && (
        <div className="flex items-end gap-2 mt-3 pt-3 border-t border-rule">
          <NumberInput label="Exit price (Rs/unit)" value={exitPrice} onChange={setExitPrice} min={0} step={0.01} />
          <Button variant="solid" onClick={close} disabled={busy}>{busy ? "…" : "Confirm close"}</Button>
        </div>
      )}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-stat uppercase text-muted">{label}</div>
      <div>{value}</div>
    </div>
  );
}
