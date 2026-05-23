"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Select } from "@/components/ui/Select";

export function CashForm() {
  const router = useRouter();
  const [type, setType] = useState<"DEPOSIT" | "WITHDRAWAL">("DEPOSIT");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (amount <= 0) {
      setError("Amount must be positive.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, amount, date, notes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Save failed.");
        return;
      }
      setAmount(0);
      setNotes("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
        <Select
          label="Type"
          value={type}
          onChange={(v) => setType(v as any)}
          options={[
            { value: "DEPOSIT", label: "Deposit (cash in)" },
            { value: "WITHDRAWAL", label: "Withdrawal (cash out)" },
          ]}
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
        <NumberInput
          label="Amount (Rs)"
          value={amount}
          onChange={setAmount}
          min={0}
          step={1000}
          large
        />
        <TextInput
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder='e.g. "Salary credit", "Withdrew for expenses"'
        />
        <div className="md:col-span-2 flex items-center gap-3">
          <Button type="submit" variant="solid" disabled={submitting}>
            {submitting ? "Saving…" : type === "DEPOSIT" ? "Record Deposit" : "Record Withdrawal"}
          </Button>
          {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
        </div>
      </form>
    </Card>
  );
}
