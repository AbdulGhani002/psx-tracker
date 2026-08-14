"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

type Plan = { purpose?: string; reviewBy?: string; reviewReason?: string };
type Vehicle = { id: string; label: string; plan: Plan };

const PURPOSES = [
  ["", "— no purpose set (gets flagged) —"],
  ["strategic_wait", "Strategic wait — parked for a named opportunity"],
  ["dry_powder", "Dry powder — ready for drawdowns"],
  ["emergency", "Emergency fund"],
  ["default_dump", "Default dump — honestly, no plan"],
] as const;

function Row({ label, plan, onSave }: { label: string; plan: Plan; onSave: (p: Required<Plan>) => Promise<boolean> }) {
  const [purpose, setPurpose] = useState(plan.purpose ?? "");
  const [reviewBy, setReviewBy] = useState(plan.reviewBy ?? "");
  const [reason, setReason] = useState(plan.reviewReason ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);

  return (
    <div className="border border-rule p-3">
      <div className="text-[13px] font-medium mb-2">{label}</div>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_2fr_auto] gap-3 items-end">
        <label className="block">
          <span className="label-cap block mb-1">Purpose</span>
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]">
            {PURPOSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label-cap block mb-1">Review by</span>
          <input type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono" />
        </label>
        <label className="block">
          <span className="label-cap block mb-1">Waiting for what?</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]" placeholder='e.g. "await PTL FY26 report ~Oct 2026"' />
        </label>
        <Button
          variant="outline"
          onClick={async () => {
            setBusy(true);
            const ok = await onSave({ purpose, reviewBy, reviewReason: reason });
            setBusy(false);
            if (ok) setSaved(Date.now());
          }}
          disabled={busy}
        >
          {busy ? "…" : saved != null && Date.now() - saved < 3000 ? "Saved" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function CashPlans({ funds, savings, broker }: { funds: Vehicle[]; savings: Vehicle[]; broker: Plan }) {
  const router = useRouter();
  const patch = (url: string, body: unknown) =>
    fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => { if (r.ok) router.refresh(); return r.ok; });

  return (
    <div className="space-y-3">
      {funds.map((f) => (
        <Row key={f.id} label={f.label} plan={f.plan} onSave={(p) => patch(`/api/funds/${f.id}`, { cashPlan: p })} />
      ))}
      {savings.map((a) => (
        <Row key={a.id} label={a.label} plan={a.plan} onSave={(p) => patch(`/api/savings/${a.id}`, { cashPlan: p })} />
      ))}
      <Row
        label="Brokerage cash"
        plan={broker}
        onSave={(p) => patch("/api/settings", { brokerCashPurpose: p.purpose, brokerCashReviewBy: p.reviewBy, brokerCashReviewReason: p.reviewReason })}
      />
    </div>
  );
}
