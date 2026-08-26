"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Select } from "@/components/ui/Select";
import { fmtRs, fmtPct, fmtDate } from "@/lib/format";
import { realPct } from "@/lib/calculations/pk-tax";

type ValuedSavings = {
  _id: string;
  name: string;
  bank: string;
  ratePercent: number;
  anchorDate: string;
  anchorBalance: number;
  notes: string;
  balance: number;
  principal: number;
  profit: number;
  netDeposits: number;
  movements: Array<{ date: string; type: "DEPOSIT" | "WITHDRAWAL"; amount: number; note: string }>;
};

export function SavingsManager({ accounts, inflationPct, podWhtPct }: { accounts: ValuedSavings[]; inflationPct: number | null; podWhtPct: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Bank Alfalah Alfa");
  const [bank, setBank] = useState("Bank Alfalah");
  const [rate, setRate] = useState(0);
  const [anchorDate, setAnchorDate] = useState(new Date().toISOString().slice(0, 10));
  const [anchorBalance, setAnchorBalance] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    if (rate <= 0 || anchorBalance <= 0) {
      setError("Enter the current balance and the annual profit rate.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/savings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, bank, ratePercent: rate, anchorDate, anchorBalance }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.detail ?? b?.error ?? "Failed.");
        return;
      }
      setOpen(false);
      setAnchorBalance(0);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="label-cap">
          {accounts.length} account{accounts.length === 1 ? "" : "s"}
        </div>
        <Button variant={open ? "outline" : "solid"} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Add Account"}
        </Button>
      </div>

      {open && (
        <Card>
          <form onSubmit={addAccount} className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <TextInput label="Account name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextInput label="Bank" value={bank} onChange={(e) => setBank(e.target.value)} />
            <NumberInput
              label="Current balance (Rs)"
              value={anchorBalance}
              onChange={setAnchorBalance}
              min={0}
              step={1}
              hint="From your latest statement / app."
            />
            <NumberInput
              label="Annual profit rate (%)"
              value={rate}
              onChange={setRate}
              min={0}
              max={100}
              step={0.1}
              suffix="%"
              hint="Bank Alfalah Alfa publishes this; update when it changes."
            />
            <div className="space-y-1.5">
              <label className="label-cap block">Balance as of</label>
              <div className="border-b border-ink">
                <input
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchorDate(e.target.value)}
                  className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none"
                />
              </div>
            </div>
            <div className="flex items-end gap-3">
              <Button type="submit" variant="solid" disabled={saving}>
                {saving ? "Saving…" : "Add Account"}
              </Button>
              {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
            </div>
          </form>
        </Card>
      )}

      {accounts.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            No savings accounts yet. Add one — the value will accrue daily at your rate without any
            further input.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <SavingsCard key={a._id} account={a} inflationPct={inflationPct} podWhtPct={podWhtPct} onChange={() => router.refresh()} />
          ))}
        </div>
      )}
    </div>
  );
}

function SavingsCard({ account, inflationPct, podWhtPct, onChange }: { account: ValuedSavings; inflationPct: number | null; podWhtPct: number; onChange: () => void }) {
  const [showMove, setShowMove] = useState(false);
  const [moveType, setMoveType] = useState<"DEPOSIT" | "WITHDRAWAL">("DEPOSIT");
  const [moveAmount, setMoveAmount] = useState(0);
  const [moveDate, setMoveDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function addMovement() {
    if (moveAmount <= 0) return;
    setBusy(true);
    try {
      await fetch(`/api/savings/${account._id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addMovement: { date: moveDate, type: moveType, amount: moveAmount, note: "" } }),
      });
      setShowMove(false);
      setMoveAmount(0);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${account.name}?`)) return;
    await fetch(`/api/savings/${account._id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-display text-[18px]">
            {account.name}
          </div>
          <div className="text-[11px] text-muted font-mono mt-0.5">
            {account.bank} · {fmtPct(account.ratePercent / 100, 2)}/yr
            {inflationPct != null && (() => {
              const real = realPct(account.ratePercent * (1 - podWhtPct / 100), inflationPct);
              return (
                <> · <span style={{ color: real >= 0 ? "var(--positive)" : "var(--negative)" }}>real after tax {real >= 0 ? "+" : ""}{real.toFixed(2)}%</span></>
              );
            })()}{" "}
            · since {fmtDate(account.anchorDate)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display mono-num text-[26px]">
            {fmtRs(account.balance)}
          </div>
          <div className="text-[11px] font-mono mt-0.5" style={{ color: "var(--positive)" }}>
            +{fmtRs(account.profit)} profit accrued
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-rule font-mono mono-num text-[13px]">
        <div>
          <div className="text-[10px] tracking-stat uppercase text-muted">Principal</div>
          <div>{fmtRs(account.principal)}</div>
        </div>
        <div>
          <div className="text-[10px] tracking-stat uppercase text-muted">Net deposits</div>
          <div>{fmtRs(account.netDeposits)}</div>
        </div>
        <div>
          <div className="text-[10px] tracking-stat uppercase text-muted">Movements</div>
          <div>{account.movements.length}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <Button variant="outline" onClick={() => setShowMove(!showMove)}>
          {showMove ? "Cancel" : "Deposit / Withdraw"}
        </Button>
        <div className="flex-1" />
        <button
          onClick={remove}
          className="font-mono text-[10px] uppercase tracking-stat hover:underline"
          style={{ color: "var(--negative)" }}
        >
          Delete
        </button>
      </div>

      {showMove && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-rule items-end">
          <Select
            label="Type"
            value={moveType}
            onChange={(v) => setMoveType(v as any)}
            options={[
              { value: "DEPOSIT", label: "Deposit" },
              { value: "WITHDRAWAL", label: "Withdrawal" },
            ]}
          />
          <NumberInput label="Amount (Rs)" value={moveAmount} onChange={setMoveAmount} min={0} step={1} />
          <div className="space-y-1.5">
            <label className="label-cap block">Date</label>
            <div className="border-b border-ink">
              <input
                type="date"
                value={moveDate}
                onChange={(e) => setMoveDate(e.target.value)}
                className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none"
              />
            </div>
          </div>
          <Button variant="solid" onClick={addMovement} disabled={busy}>
            {busy ? "Saving…" : "Record"}
          </Button>
        </div>
      )}
    </Card>
  );
}
