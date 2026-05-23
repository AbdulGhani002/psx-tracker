"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Select } from "@/components/ui/Select";
import { TRANSACTION_TYPES, type TransactionType } from "@/lib/types";
import { fmtRs } from "@/lib/format";
import { computePSXFees } from "@/lib/calculations";

type Props = {
  id: string;
  symbol: string;
  initial: {
    type: TransactionType;
    date: string;
    shares: number;
    pricePerShare: number;
    fees: number;
    notes: string;
    ratio: string;
    warrantNo: string;
    taxDeducted: number;
    zakatDeducted: number;
    financialYear: string;
    dividendType: string;
  };
};

export function EditTransactionForm({ id, symbol, initial }: Props) {
  const router = useRouter();
  const [type, setType] = useState<TransactionType>(initial.type);
  const [date, setDate] = useState(initial.date);
  const [shares, setShares] = useState(initial.shares);
  const [price, setPrice] = useState(initial.pricePerShare);
  const [fees, setFees] = useState(initial.fees);
  const [notes, setNotes] = useState(initial.notes);
  const [ratio, setRatio] = useState(initial.ratio);
  const [warrantNo, setWarrantNo] = useState(initial.warrantNo);
  const [taxDeducted, setTaxDeducted] = useState(initial.taxDeducted);
  const [zakatDeducted, setZakatDeducted] = useState(initial.zakatDeducted);
  const [financialYear, setFinancialYear] = useState(initial.financialYear);
  const [dividendType, setDividendType] = useState(initial.dividendType || "Interim");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDividend = type === "DIVIDEND";
  const feeBreakdown = computePSXFees({ shares, price, type });

  const totalAmount = shares * price;
  const effectiveFees = isDividend ? taxDeducted + zakatDeducted : fees;
  const netAmount =
    type === "BUY" || type === "RIGHT"
      ? totalAmount + effectiveFees
      : type === "SELL" || type === "DIVIDEND"
      ? totalAmount - effectiveFees
      : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        type,
        date,
        shares,
        pricePerShare: price,
        fees: isDividend ? taxDeducted + zakatDeducted : fees,
        notes,
        ratio,
      };
      if (isDividend) {
        payload.warrantNo = warrantNo.trim() || null;
        payload.taxDeducted = taxDeducted;
        payload.zakatDeducted = zakatDeducted;
        payload.financialYear = financialYear.trim();
        payload.dividendType = dividendType.trim();
      }
      const res = await fetch(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Save failed.");
        return;
      }
      router.push(`/holdings/${symbol}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!confirm("Delete this transaction? Holding values will recompute.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Delete failed.");
        return;
      }
      router.push(`/holdings/${symbol}`);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  function fixSharesFromGross() {
    const grossStr = prompt("Actual gross dividend amount (Rs):");
    if (!grossStr) return;
    const g = Number(grossStr);
    if (!Number.isFinite(g) || g <= 0 || price <= 0) return;
    setShares(Math.round(g / price));
  }

  function fixRateFromGross() {
    const grossStr = prompt("Actual gross dividend amount (Rs):");
    if (!grossStr) return;
    const g = Number(grossStr);
    if (!Number.isFinite(g) || g <= 0 || shares <= 0) return;
    setPrice(Math.round((g / shares) * 10000) / 10000);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-[680px]">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <Select
            label="Type"
            value={type}
            onChange={(v) => setType(v as TransactionType)}
            options={TRANSACTION_TYPES.map((t) => ({ value: t, label: t }))}
          />
          <div className="space-y-1.5">
            <label className="label-cap block">Date</label>
            <div className="border-b border-ink">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none"
              />
            </div>
          </div>

          {type !== "SPLIT" && (
            <NumberInput label="Shares" value={shares} onChange={setShares} step={1} min={0} />
          )}
          {type !== "BONUS" && type !== "SPLIT" && (
            <NumberInput
              label={isDividend ? "Rate per share (Rs)" : "Price per share (Rs)"}
              value={price}
              onChange={setPrice}
              step={isDividend ? 0.0001 : 0.01}
              min={0}
            />
          )}

          {isDividend && (
            <>
              <div className="space-y-1.5">
                <label className="label-cap block">Warrant # (dedup key)</label>
                <div className="border-b border-ink">
                  <input
                    type="text"
                    value={warrantNo}
                    onChange={(e) => setWarrantNo(e.target.value)}
                    placeholder="From CDC warrant"
                    className="w-full bg-transparent py-1.5 text-[14px] focus:outline-none font-mono"
                  />
                </div>
              </div>
              <Select
                label="Dividend type"
                value={dividendType}
                onChange={setDividendType}
                options={[
                  { value: "Interim", label: "Interim" },
                  { value: "Final", label: "Final" },
                  { value: "Special", label: "Special" },
                  { value: "Other", label: "Other" },
                ]}
              />
              <NumberInput
                label="Tax deducted (Rs)"
                value={taxDeducted}
                onChange={setTaxDeducted}
                step={0.01}
                min={0}
              />
              <NumberInput
                label="Zakat deducted (Rs)"
                value={zakatDeducted}
                onChange={setZakatDeducted}
                step={0.01}
                min={0}
              />
              <div className="space-y-1.5">
                <label className="label-cap block">Financial year</label>
                <div className="border-b border-ink">
                  <input
                    type="text"
                    value={financialYear}
                    onChange={(e) => setFinancialYear(e.target.value)}
                    placeholder="2024-25"
                    className="w-full bg-transparent py-1.5 text-[14px] focus:outline-none font-mono mono-num"
                  />
                </div>
              </div>
            </>
          )}

          {!isDividend && (type === "BUY" || type === "SELL" || type === "RIGHT") && (
            <NumberInput
              label="Fees / charges (Rs)"
              value={fees}
              onChange={setFees}
              step={0.01}
              min={0}
              hint={feeBreakdown.rule !== "none" ? `Auto would be: ${feeBreakdown.explanation}` : undefined}
            />
          )}

          {type === "SPLIT" && (
            <TextInput
              label="Ratio (old:new)"
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
              placeholder="1:2"
            />
          )}

          <div className="md:col-span-2">
            <TextInput label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {isDividend && (price > 0 || shares > 0) && (
          <div className="mt-4 pt-4 border-t border-rule flex flex-wrap gap-2">
            {price > 0 && (
              <button
                type="button"
                onClick={fixSharesFromGross}
                className="font-mono text-[10px] uppercase tracking-button border border-[var(--rule)] hover:border-ink px-2 py-1"
                style={{ color: "var(--accent-deep)" }}
              >
                ↳ Fix shares from gross
              </button>
            )}
            {shares > 0 && (
              <button
                type="button"
                onClick={fixRateFromGross}
                className="font-mono text-[10px] uppercase tracking-button border border-[var(--rule)] hover:border-ink px-2 py-1"
                style={{ color: "var(--accent-deep)" }}
              >
                ↳ Fix rate from gross
              </button>
            )}
          </div>
        )}
      </Card>

      <Card inverted>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono mono-num">
          <div>
            <div className="text-[10px] tracking-stat uppercase" style={{ color: "rgba(245,241,232,0.65)" }}>Gross</div>
            <div className="text-[20px]">{fmtRs(totalAmount)}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase" style={{ color: "rgba(245,241,232,0.65)" }}>
              {isDividend ? "Tax + Zakat" : "Fees"}
            </div>
            <div className="text-[20px]">{fmtRs(effectiveFees)}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase" style={{ color: "rgba(245,241,232,0.65)" }}>Net</div>
            <div className="text-[20px]">{fmtRs(netAmount)}</div>
          </div>
        </div>
      </Card>

      {error && <div className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</div>}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="solid" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="font-mono text-[11px] uppercase tracking-button hover:underline disabled:opacity-40"
          style={{ color: "var(--negative)" }}
        >
          {deleting ? "Deleting…" : "Delete Transaction"}
        </button>
      </div>
    </form>
  );
}
