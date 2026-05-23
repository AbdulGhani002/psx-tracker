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

type Props = {
  existingSymbols: string[];
  defaultSymbol?: string;
};

const TYPE_HINTS: Record<TransactionType, string> = {
  BUY: "Adds shares at the purchase price. Increases avg cost basis.",
  SELL: "Removes shares; realises P/L vs. avg cost.",
  DIVIDEND: "Cash dividend received. Price field = dividend per share.",
  BONUS: "Free shares from the issuer. Avg cost drops automatically.",
  RIGHT: "Subscribed at the rights price. Treated like a buy.",
  SPLIT: "Share split. Use the ratio field (e.g. 1:2 means 1 old → 2 new).",
};

export function NewTransactionForm({ existingSymbols, defaultSymbol }: Props) {
  const router = useRouter();
  const [symbol, setSymbol] = useState<string>(defaultSymbol ?? existingSymbols[0] ?? "");
  const [customSymbol, setCustomSymbol] = useState("");
  const [type, setType] = useState<TransactionType>("BUY");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [shares, setShares] = useState<number>(0);
  const [price, setPrice] = useState<number>(0);
  const [fees, setFees] = useState<number>(0);
  const [ratio, setRatio] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustom = !existingSymbols.includes(symbol) || symbol === "__new__";
  const finalSymbol = (isCustom ? customSymbol : symbol).trim().toUpperCase();

  const totalAmount = shares * price;
  const netAmount =
    type === "BUY" || type === "RIGHT"
      ? totalAmount + fees
      : type === "SELL"
      ? totalAmount - fees
      : type === "DIVIDEND"
      ? totalAmount - fees
      : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!finalSymbol) {
      setError("Pick or enter a symbol.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: finalSymbol,
          type,
          date,
          shares,
          pricePerShare: price,
          fees,
          notes,
          ratio,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Submission failed.");
        return;
      }
      router.push(`/holdings/${finalSymbol}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8 max-w-[640px]">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <Select
            label="Symbol"
            value={symbol}
            onChange={setSymbol}
            options={[
              ...existingSymbols.map((s) => ({ value: s, label: s })),
              { value: "__new__", label: "+ Add new symbol" },
            ]}
          />
          {isCustom && (
            <TextInput
              label="New symbol"
              value={customSymbol}
              onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. ENGRO"
            />
          )}
          <Select
            label="Type"
            value={type}
            onChange={(v) => setType(v as TransactionType)}
            options={TRANSACTION_TYPES.map((t) => ({ value: t, label: t }))}
            hint={TYPE_HINTS[type]}
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
            <NumberInput
              label={type === "DIVIDEND" ? "Shares at record date" : "Shares"}
              value={shares}
              onChange={setShares}
              step={1}
              min={0}
            />
          )}
          {type !== "BONUS" && type !== "SPLIT" && (
            <NumberInput
              label={type === "DIVIDEND" ? "Dividend per share (Rs)" : "Price per share (Rs)"}
              value={price}
              onChange={setPrice}
              step={0.01}
              min={0}
            />
          )}
          {(type === "BUY" || type === "SELL" || type === "RIGHT" || type === "DIVIDEND") && (
            <NumberInput
              label="Fees / charges (Rs)"
              value={fees}
              onChange={setFees}
              step={0.01}
              min={0}
            />
          )}
          {type === "SPLIT" && (
            <TextInput
              label="Ratio (old:new)"
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
              placeholder="1:2"
              hint="1:2 = each old share becomes 2 new shares."
            />
          )}
          {type === "BONUS" && (
            <NumberInput
              label="Bonus shares received"
              value={shares}
              onChange={setShares}
              step={1}
              min={0}
            />
          )}

          <div className="md:col-span-2">
            <TextInput
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='e.g. "Q3 FY26 dividend"'
            />
          </div>
        </div>
      </Card>

      <Card inverted>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono mono-num">
          <div>
            <div className="text-[10px] tracking-stat uppercase" style={{ color: "rgba(245,241,232,0.65)" }}>
              Total
            </div>
            <div className="text-[20px]">{fmtRs(totalAmount)}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase" style={{ color: "rgba(245,241,232,0.65)" }}>
              Fees
            </div>
            <div className="text-[20px]">{fmtRs(fees)}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase" style={{ color: "rgba(245,241,232,0.65)" }}>
              Net amount
            </div>
            <div className="text-[20px]">{fmtRs(netAmount)}</div>
          </div>
        </div>
      </Card>

      {error && (
        <div className="text-[13px]" style={{ color: "var(--negative)" }}>
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button type="submit" variant="solid" disabled={submitting}>
          {submitting ? "Saving…" : "Record Transaction"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
