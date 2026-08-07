"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { fmtRs } from "@/lib/format";

type Invalidator = { text: string; occurredAt: string };
type Plan = {
  classification: string;
  fvLow: number; fvBase: number; fvHigh: number; fvMethod: string;
  invalidators: Invalidator[];
  maxWeightPct: number; timeStopMonths: number;
  cumOcf3y: number | null; openedAt: string;
  fvHighRaisedCount?: number; targetRaisedCount?: number; thesisEditCount?: number;
};
type Rebuy = { active: boolean; maxPrice: number; requiredConditions: string[]; reviewOn: string };

type Props = {
  symbol: string;
  price: number;
  weightPct: number;
  sharesHeld: number;
  cumPat3y: number | null; // from scraped financials — shown so OCF is entered in matching units
  fired: Array<{ type: string; message: string; severity: string }>;
  spreadPct: number | null;
  netRiskFreeLabel: string;
  engineFv: { low: number | null; base: number | null; high: number | null }; // the app's own blend, offered as a starting point
  initialPlan: Plan;
  initialRebuy: Rebuy;
};

const inputCls = "w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]";

export function SellPlanPanel(p: Props) {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan>(p.initialPlan);
  const [rebuy, setRebuy] = useState<Rebuy>(p.initialRebuy);
  const [newInv, setNewInv] = useState("");
  const [rebuyCondsText, setRebuyCondsText] = useState(p.initialRebuy.requiredConditions.join("\n"));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => setPlan((x) => ({ ...x, [k]: v }));

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        plan: {
          classification: plan.classification,
          fvLow: plan.fvLow, fvBase: plan.fvBase, fvHigh: plan.fvHigh, fvMethod: plan.fvMethod,
          invalidators: plan.invalidators,
          maxWeightPct: plan.maxWeightPct, timeStopMonths: plan.timeStopMonths,
          cumOcf3y: plan.cumOcf3y, openedAt: plan.openedAt,
        },
      };
      if (p.sharesHeld <= 0) {
        body.rebuyRule = { ...rebuy, requiredConditions: rebuyCondsText.split("\n").map((c) => c.trim()).filter(Boolean) };
      }
      const res = await fetch(`/api/holdings/${p.symbol}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setErr(b?.error ?? "Failed."); return; }
      setSavedAt(Date.now());
      router.refresh();
    } finally { setSaving(false); }
  }

  // FV gauge: where price sits inside [low..high].
  const gLow = plan.fvLow > 0 ? plan.fvLow : null;
  const gHigh = plan.fvHigh > 0 ? plan.fvHigh : null;
  const gaugePos = gLow != null && gHigh != null && gHigh > gLow
    ? Math.max(0, Math.min(100, ((p.price - gLow) / (gHigh - gLow)) * 100))
    : null;

  return (
    <div className="space-y-4">
      {/* Live discipline readout */}
      <Card>
        <div className="label-cap mb-3">Where it stands against your own rules</div>
        {gaugePos != null ? (
          <div className="mb-3">
            <div className="relative h-2 rounded-sm" style={{ background: "linear-gradient(to right, var(--positive), var(--paper-2), var(--negative))" }}>
              <span className="absolute -top-1 w-1 h-4" style={{ left: `${gaugePos}%`, background: "var(--ink)" }} />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-muted mt-1">
              <span>low {fmtRs(gLow!, true)}</span>
              {plan.fvBase > 0 && <span>base {fmtRs(plan.fvBase, true)}</span>}
              <span>ceiling {fmtRs(gHigh!, true)}</span>
            </div>
            <p className="text-[12px] mt-1">
              Price {fmtRs(p.price, true)} — {p.price >= gHigh! ? "IN YOUR SELL ZONE." : p.price <= gLow! ? "below your low band." : "inside your band."}
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-muted mb-3">No fair-value band set yet — set one below. Until then the price-ceiling trigger can&apos;t protect you.</p>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
          <span>Opportunity-cost spread:{" "}
            {p.spreadPct != null ? (
              <span className="font-mono" style={{ color: p.spreadPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                {p.spreadPct >= 0 ? "+" : ""}{p.spreadPct.toFixed(1)}pp vs {p.netRiskFreeLabel}
              </span>
            ) : (<span className="text-muted">needs a feed</span>)}
          </span>
          <span>Weight: <span className="font-mono">{p.weightPct.toFixed(1)}%</span>{plan.maxWeightPct > 0 && <span className="text-muted"> / cap {plan.maxWeightPct}%</span>}</span>
        </div>
        {p.fired.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {p.fired.map((t, i) => (
              <p key={i} className="text-[12px] border-l-2 pl-2" style={{ borderColor: t.severity === "action" ? "var(--negative)" : "var(--rule)" }}>{t.message}</p>
            ))}
          </div>
        )}
        {((plan.fvHighRaisedCount ?? 0) > 0 || (plan.thesisEditCount ?? 0) > 0) && (
          <p className="text-[10px] text-muted mt-3">
            Guard counters: ceiling raised {plan.fvHighRaisedCount ?? 0}×, target raised {plan.targetRaisedCount ?? 0}×, thesis edited {plan.thesisEditCount ?? 0}×. Counted server-side; only logged decisions justify them.
          </p>
        )}
      </Card>

      {/* The plan editor */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <label className="block">
            <span className="label-cap block mb-1">Asset class</span>
            <select value={plan.classification} onChange={(e) => set("classification", e.target.value)} className={inputCls}>
              <option value="">— unclassified (class rules off) —</option>
              <option value="compounder">Compounder</option>
              <option value="stalwart">Stalwart</option>
              <option value="cyclical">Cyclical</option>
              <option value="asset_play">Asset play</option>
              <option value="turnaround">Turnaround</option>
              <option value="value_trap">Value trap (be honest)</option>
            </select>
          </label>
          <NumberInput label="FV low (Rs)" value={plan.fvLow} onChange={(v) => set("fvLow", v)} min={0} step={0.5} />
          <NumberInput label="FV base (Rs)" value={plan.fvBase} onChange={(v) => set("fvBase", v)} min={0} step={0.5} />
          <NumberInput label="FV high — your CEILING (Rs)" value={plan.fvHigh} onChange={(v) => set("fvHigh", v)} min={0} step={0.5}
            hint={p.engineFv.high != null ? `The app's blend says low ${p.engineFv.low?.toFixed(0) ?? "—"} / base ${p.engineFv.base?.toFixed(0) ?? "—"} / high ${p.engineFv.high.toFixed(0)} — a starting point, not your answer.` : undefined} />
          <label className="block md:col-span-2">
            <span className="label-cap block mb-1">Method (yours, named)</span>
            <input value={plan.fvMethod} onChange={(e) => set("fvMethod", e.target.value)} className={inputCls} placeholder='e.g. "EV/EBITDA + residual income + normalised EPS"' />
          </label>
          <NumberInput label="Max weight (%)" value={plan.maxWeightPct} onChange={(v) => set("maxWeightPct", v)} min={0} max={100} step={1} hint="0 = use the global cap." />
          <NumberInput label="Time stop (months)" value={plan.timeStopMonths} onChange={(v) => set("timeStopMonths", v)} min={0} max={120} step={1} hint="0 = off. Nags when held this long with the thesis unproven." />
          <NumberInput label="3y operating cash flow (sum)" value={plan.cumOcf3y ?? 0} onChange={(v) => set("cumOcf3y", v === 0 ? null : v)} step={1}
            hint={p.cumPat3y != null ? `From the cash-flow statement. 3y PAT (scraped, same units): ${fmtRs(p.cumPat3y)}. No free feed carries OCF — 0 = not entered.` : "From the annual report's cash-flow statement. 0 = not entered."} />
        </div>

        <div className="mt-5">
          <div className="label-cap mb-2">Invalidators — what would prove the thesis wrong (falsifiable)</div>
          <div className="space-y-1.5">
            {plan.invalidators.map((inv, i) => (
              <div key={i} className="flex items-center gap-2 text-[13px]">
                <button
                  onClick={() => set("invalidators", plan.invalidators.map((x, j) => j === i ? { ...x, occurredAt: x.occurredAt ? "" : new Date().toISOString().slice(0, 10) } : x))}
                  className="font-mono text-[10px] uppercase tracking-stat border px-1.5 py-0.5"
                  style={{ borderColor: inv.occurredAt ? "var(--negative)" : "var(--rule)", color: inv.occurredAt ? "var(--negative)" : undefined }}
                  title="Toggle: has this invalidator come TRUE?"
                >
                  {inv.occurredAt ? `TRUE ${inv.occurredAt}` : "not occurred"}
                </button>
                <span className={inv.occurredAt ? "line-through opacity-70" : ""}>{inv.text}</span>
                <button onClick={() => set("invalidators", plan.invalidators.filter((_, j) => j !== i))} className="text-[10px] text-muted hover:underline ml-auto">remove</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input value={newInv} onChange={(e) => setNewInv(e.target.value)} className={inputCls}
              placeholder='"FY operating cash flow negative two years running" — a number or event, not "if things go bad"' />
            <Button variant="outline" onClick={() => { if (newInv.trim().length >= 10) { set("invalidators", [...plan.invalidators, { text: newInv.trim(), occurredAt: "" }]); setNewInv(""); } }}>Add</Button>
          </div>
          <p className="text-[10px] text-muted mt-1">Marking one TRUE fires the thesis-broken trigger on the Decisions page. That&apos;s the point.</p>
        </div>

        {p.sharesHeld <= 0 && (
          <div className="mt-5 pt-4 border-t border-rule">
            <div className="label-cap mb-2">Re-buy rule (position exited — this is the watchlist)</div>
            <label className="flex items-center gap-2 text-[13px] mb-3 cursor-pointer select-none">
              <input type="checkbox" checked={rebuy.active} onChange={(e) => setRebuy({ ...rebuy, active: e.target.checked })} className="w-4 h-4 accent-[var(--accent-deep)]" />
              Track for re-entry — with a ceiling and conditions, not on impulse
            </label>
            {rebuy.active && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <NumberInput label="Max price — do not chase (Rs)" value={rebuy.maxPrice} onChange={(v) => setRebuy({ ...rebuy, maxPrice: v })} min={0} step={0.5} />
                <label className="block">
                  <span className="label-cap block mb-1">Review on (when the data lands)</span>
                  <input type="date" value={rebuy.reviewOn} onChange={(e) => setRebuy({ ...rebuy, reviewOn: e.target.value })} className={`${inputCls} font-mono`} />
                </label>
                <label className="block md:col-span-2">
                  <span className="label-cap block mb-1">Required conditions (one per line)</span>
                  <textarea value={rebuyCondsText} onChange={(e) => setRebuyCondsText(e.target.value)} rows={3} className={inputCls} />
                </label>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 mt-5">
          <Button variant="solid" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save the plan"}</Button>
          {err && <span className="text-[12px]" style={{ color: "var(--negative)" }}>{err}</span>}
          {savedAt != null && Date.now() - savedAt < 3500 && <span className="text-[12px]" style={{ color: "var(--positive)" }}>Saved — the triggers now watch it.</span>}
        </div>
      </Card>
    </div>
  );
}
