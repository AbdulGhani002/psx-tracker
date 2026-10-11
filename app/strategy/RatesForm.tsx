"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { Rates } from "@/lib/strategy/plan";

// This month's rates: prefilled from SBP, PBS and your own accounts, each
// with where its figure came from; saving them works the strategy out again
// and sends it to Telegram.

const FIELDS: Array<{ key: keyof Rates; label: string; hint?: string }> = [
  { key: "policyPct", label: "SBP policy rate" },
  { key: "tbill3mPct", label: "T-bill, 3 months" },
  { key: "tbill6mPct", label: "T-bill, 6 months" },
  { key: "tbill12mPct", label: "T-bill, 12 months" },
  { key: "sukukPct", label: "GoP Ijara sukuk" },
  { key: "moneyMarketPct", label: "Money market fund" },
  { key: "savingsPct", label: "Savings account" },
  { key: "inflationPct", label: "Inflation (CPI, a year)" },
  { key: "taxPct", label: "Tax on the profit" },
];

export function RatesForm({ values, sources, entered, monthLabel }: { values: Rates; sources: Partial<Record<keyof Rates, string>>; entered: boolean; monthLabel: string }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key] == null ? "" : String(values[f.key])])));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { month: values.month };
      for (const f of FIELDS) {
        const raw = v[f.key as string]?.trim();
        body[f.key as string] = raw === "" || raw == null ? (f.key === "taxPct" ? 15 : null) : Number(raw);
      }
      const res = await fetch("/api/rates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(b?.issues?.[0]?.message ?? b?.error ?? "Could not save.");
        return;
      }
      setMsg(b.sent ? "Saved · sent to Telegram" : "Saved");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      {!entered && <div className="text-[12px] text-muted mb-3">Filled in for you. Check and save.</div>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-[12px] text-muted">{f.label}</span>
            <div className="flex items-baseline gap-1 border-b border-ink">
              <input
                inputMode="decimal"
                value={v[f.key as string]}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                className="w-full bg-transparent text-[15px] py-1 font-mono mono-num focus:outline-none"
                placeholder="—"
              />
              <span className="text-[12px] text-muted">%</span>
            </div>
            {!entered && sources[f.key] && <span className="text-[10.5px] text-muted">{sources[f.key]}</span>}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button type="submit" variant="solid" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        {msg && <span className="text-[12.5px] text-muted">{msg}</span>}
      </div>
    </form>
  );
}
