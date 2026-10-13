"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { value, METHODS, PREMIUM, MARGINS, WEIGHTS, type Assumption, type BusinessType, type Policy, type Governance, type Method, type SotpPart } from "@/lib/valuation/engine";
import { SIGNAL, pct, level, bandText } from "../signal";

// A share's valuation inputs, edited and saved as a new version: approved at
// once, or kept as a draft. The fair value, zones and signal update as you
// type, from the same engine the evening run uses.

type Initial = Partial<Assumption> & { asOf?: string; note?: string };
const num = (v: string) => (v.trim() === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const today = () => new Date().toISOString().slice(0, 10);

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium">{label}</span>
      <span className="block mt-1">{children}</span>
      {hint && <span className="block text-[11px] text-muted mt-0.5">{hint}</span>}
    </label>
  );
}

export function AssumptionEditor({ symbol, initial, price, tbill, held, prices }: { symbol: string; initial: Initial; price: number | null; tbill: number | null; held: boolean; prices: Record<string, number> }) {
  const router = useRouter();
  const [type, setType] = useState<BusinessType>((initial.type as BusinessType) ?? "operating");
  const [policy, setPolicy] = useState<Policy>((initial.policy as Policy) ?? "standard");
  const [gov, setGov] = useState<Governance>((initial.governance as Governance) ?? "green");
  const [confirm, setConfirm] = useState(initial.confirm ?? "");
  const [f, setF] = useState({
    eps: str(initial.eps), dps: str(initial.dps), bvps: str(initial.bvps), roe: str(initial.roe), g: str(initial.g), valueGrowth: str(initial.valueGrowth),
    pe: str(initial.pe), peSpread: str(initial.peSpread), premium: str(initial.premium),
    first: initial.margins?.first != null ? String(initial.margins.first * 100) : "", second: initial.margins?.second != null ? String(initial.margins.second * 100) : "", trim: str(initial.margins?.trim ?? null),
  });
  const [weights, setWeights] = useState<Record<Method, string>>(Object.fromEntries(METHODS.map((m) => [m, initial.weights?.[m] != null ? String(initial.weights[m]) : ""])) as Record<Method, string>);
  const [parts, setParts] = useState<SotpPart[]>(initial.sotp?.parts ?? []);
  const [sotpMeta, setSotpMeta] = useState({ netDebt: str(initial.sotp?.netDebt ?? null), discount: initial.sotp?.discount ? String(initial.sotp.discount * 100) : "", shares: str(initial.sotp?.shares ?? null) });
  const [metrics, setMetrics] = useState<Array<[string, string]>>(Object.entries(initial.metrics ?? {}).map(([k, v]) => [k, String(v)]));
  const [illiquid, setIlliquid] = useState(!!initial.illiquid);
  const [asOf, setAsOf] = useState(initial.asOf ?? today());
  const [note, setNote] = useState(initial.note ?? "");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showSotp = parts.length > 0 || type === "holdco" || type === "shell" || type === "insurer" || type === "opco-investments";

  const assumption = useMemo<Assumption>(() => {
    const w = Object.fromEntries(METHODS.filter((m) => weights[m].trim() !== "").map((m) => [m, Number(weights[m])])) as Partial<Record<Method, number>>;
    const margins = f.first || f.second || f.trim ? { ...(f.first ? { first: Number(f.first) / 100 } : {}), ...(f.second ? { second: Number(f.second) / 100 } : {}), ...(f.trim ? { trim: Number(f.trim) } : {}) } : null;
    const sotpShares = num(sotpMeta.shares);
    return {
      symbol, type, policy, governance: gov, confirm,
      eps: num(f.eps), dps: num(f.dps), bvps: num(f.bvps), roe: num(f.roe), g: num(f.g), valueGrowth: num(f.valueGrowth),
      pe: num(f.pe), peSpread: num(f.peSpread), premium: num(f.premium),
      weights: Object.keys(w).length ? w : null,
      margins,
      sotp: parts.length && sotpShares ? { parts, netDebt: num(sotpMeta.netDebt) ?? 0, discount: (num(sotpMeta.discount) ?? 0) / 100, shares: sotpShares } : null,
      illiquid,
      metrics: metrics.filter(([k, v]) => k.trim() && num(v) != null).length ? Object.fromEntries(metrics.filter(([k, v]) => k.trim() && num(v) != null).map(([k, v]) => [k.trim(), Number(v)])) : null,
    };
  }, [symbol, type, policy, gov, confirm, f, weights, parts, sotpMeta, illiquid, metrics]);

  const v = useMemo(() => (price && tbill != null ? value(assumption, { price, tbillPct: tbill, held, stale: false, prices: new Map(Object.entries(prices)) }) : null), [assumption, price, tbill, held, prices]);

  async function save(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/valuation/assumptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...assumption, asOf, note, approve }) });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.issues?.[0] ? `${b.issues[0].path?.join(".")}: ${b.issues[0].message}` : b?.error ?? "Could not save.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const input = (k: keyof typeof f, placeholder = "") => <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="field mono-num" placeholder={placeholder} inputMode="decimal" />;
  const setPart = (i: number, p: Partial<SotpPart>) => setParts(parts.map((x, k) => (k === i ? { ...x, ...p } : x)));

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <F label="Business">
          <select value={type} onChange={(e) => { const t = e.target.value as BusinessType; setType(t); if (t === "holdco" || t === "shell") setPolicy(t); }} className="field">
            <option value="bank">Bank</option>
            <option value="insurer">Insurer</option>
            <option value="operating">Operating company</option>
            <option value="opco-investments">Operating, with an investment book</option>
            <option value="holdco">Holding company</option>
            <option value="shell">Cash shell</option>
          </select>
        </F>
        <F label="Policy" hint={tbill != null ? `Hurdle ${(tbill + (num(f.premium) ?? PREMIUM[policy])).toFixed(1)}%` : undefined}>
          <select value={policy} onChange={(e) => setPolicy(e.target.value as Policy)} className="field">
            <option value="quality">Quality (T-bill + 3.5)</option>
            <option value="standard">Standard (T-bill + 4.5)</option>
            <option value="holdco">Holding company (48 / 55% under NAV)</option>
            <option value="shell">Cash shell (55 / 60% under NAV)</option>
          </select>
        </F>
        <F label="Governance">
          <div className="seg">
            {(["green", "amber", "red"] as Governance[]).map((g) => (
              <button key={g} type="button" data-active={gov === g} onClick={() => setGov(g)}>{g[0].toUpperCase() + g.slice(1)}</button>
            ))}
          </div>
        </F>
        {gov === "amber" ? (
          <F label="Confirm on">
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field" placeholder="e.g. 1QFY27 results" />
          </F>
        ) : (
          <F label="As of">
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="field mono-num" />
          </F>
        )}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mt-3">
        <F label="EPS next year">{input("eps")}</F>
        <F label="Dividend D1">{input("dps")}</F>
        <F label="Book a share">{input("bvps")}</F>
        <F label="ROE %">{input("roe")}</F>
        <F label="Growth %">{input("g")}</F>
        <F label="P/E" hint="Or a spread below">{input("pe")}</F>
      </div>

      {showSotp && (
        <div className="mt-4">
          <div className="text-[12px] font-medium mb-1.5">Sum of the parts</div>
          <div className="space-y-2">
            {parts.map((p, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-6 gap-2 items-center">
                <input value={p.label} onChange={(e) => setPart(i, { label: e.target.value })} className="field text-[13px]" placeholder="Part" />
                <select value={p.kind} onChange={(e) => setPart(i, { kind: e.target.value as SotpPart["kind"] })} className="field text-[13px]">
                  <option value="listed">Listed stake</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="operating">Operating business</option>
                  <option value="cash">Cash</option>
                </select>
                {p.kind === "listed" ? (
                  <>
                    <input value={p.symbol ?? ""} onChange={(e) => setPart(i, { symbol: e.target.value.toUpperCase() })} className="field text-[13px] uppercase" placeholder="Symbol" />
                    <input value={str(p.shares)} onChange={(e) => setPart(i, { shares: num(e.target.value) ?? undefined })} className="field mono-num text-[13px]" placeholder="Shares held" />
                  </>
                ) : (
                  <input value={str(p.value)} onChange={(e) => setPart(i, { value: num(e.target.value) ?? undefined })} className="field mono-num text-[13px] md:col-span-2" placeholder="Value (Rs)" />
                )}
                <input value={p.haircut ? String(p.haircut * 100) : ""} onChange={(e) => setPart(i, { haircut: (num(e.target.value) ?? 0) / 100 })} className="field mono-num text-[13px]" placeholder="Haircut %" />
                <button type="button" className="text-[12px] link-underline text-left" style={{ color: "var(--negative)" }} onClick={() => setParts(parts.filter((_, k) => k !== i))}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => setParts([...parts, { label: "", kind: "listed" }])}>+ Part</button>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-2">
            <F label="Net debt (Rs)"><input value={sotpMeta.netDebt} onChange={(e) => setSotpMeta({ ...sotpMeta, netDebt: e.target.value })} className="field mono-num" /></F>
            <F label="Holding discount %" hint="0 for a NAV"><input value={sotpMeta.discount} onChange={(e) => setSotpMeta({ ...sotpMeta, discount: e.target.value })} className="field mono-num" /></F>
            <F label="Shares outstanding" hint="From the latest filing"><input value={sotpMeta.shares} onChange={(e) => setSotpMeta({ ...sotpMeta, shares: e.target.value })} className="field mono-num" /></F>
          </div>
        </div>
      )}

      <button type="button" className="text-[12px] link-underline mt-3" onClick={() => setMore(!more)}>{more ? "Fewer settings" : "More settings"}</button>
      {more && (
        <div className="mt-2 space-y-3">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <F label="P/E spread (pts)" hint="P/E = 1 / (r − spread)">{input("peSpread")}</F>
            <F label="Value growth %" hint="For the return; growth if blank">{input("valueGrowth")}</F>
            <F label="Premium (pts)" hint={`${PREMIUM[policy]} by policy`}>{input("premium")}</F>
            <F label="1st margin %" hint={`${MARGINS[policy].first * 100} by policy`}>{input("first")}</F>
            <F label="2nd margin %" hint={`${MARGINS[policy].second * 100} by policy`}>{input("second")}</F>
            <F label="Trim at ×" hint={`${MARGINS[policy].trim} by policy`}>{input("trim")}</F>
          </div>
          <div>
            <div className="text-[12px] font-medium mb-1">Weights <span className="text-muted font-normal">(blank: {Object.entries(WEIGHTS[type]).map(([m, w]) => `${m.toUpperCase()} ${w}`).join(", ")})</span></div>
            <div className="grid grid-cols-5 gap-2">
              {METHODS.map((m) => (
                <input key={m} value={weights[m]} onChange={(e) => setWeights({ ...weights, [m]: e.target.value })} className="field mono-num text-[13px]" placeholder={m.toUpperCase()} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[12px] font-medium mb-1">Filing figures <span className="text-muted font-normal">(for triggers, e.g. combinedRatio 98)</span></div>
            {metrics.map(([k, val], i) => (
              <div key={i} className="grid grid-cols-3 gap-2 mb-1">
                <input value={k} onChange={(e) => setMetrics(metrics.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} className="field text-[13px]" placeholder="Name" />
                <input value={val} onChange={(e) => setMetrics(metrics.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} className="field mono-num text-[13px]" placeholder="Value" />
                <button type="button" className="text-[12px] link-underline text-left" style={{ color: "var(--negative)" }} onClick={() => setMetrics(metrics.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => setMetrics([...metrics, ["", ""]])}>+ Figure</button>
          </div>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={illiquid} onChange={(e) => setIlliquid(e.target.checked)} /> Thin trading: watch only</label>
          {gov === "amber" && (
            <F label="As of"><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="field mono-num w-[180px]" /></F>
          )}
        </div>
      )}

      <F label="Note">
        <input value={note} onChange={(e) => setNote(e.target.value)} className="field" placeholder="Why: one-offs stripped, known changes added" />
      </F>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
        <div><div className="label-cap">Fair value</div><div className="mono-num font-semibold mt-0.5">{level(v?.fairValue)}</div>{bandText(v?.band) && <div className="text-[10.5px] text-muted">{bandText(v?.band)}</div>}</div>
        <div><div className="label-cap">Accumulate / strong</div><div className="mono-num font-semibold mt-0.5">{v?.zones ? `${level(v.zones.accumulate)} / ${level(v.zones.strong)}` : "—"}</div></div>
        <div><div className="label-cap">Trim</div><div className="mono-num font-semibold mt-0.5">{v?.zones ? level(v.zones.trim) : "—"}</div></div>
        <div><div className="label-cap">Return / hurdle</div><div className="mono-num font-semibold mt-0.5">{v?.expected ? `${pct(v.expected.total)} / ${pct(v.r)}` : "—"}</div></div>
        <div><div className="label-cap">Signal</div><div className="mt-0.5">{v ? <span className="pill" data-tone={SIGNAL[v.signal].tone}>{SIGNAL[v.signal].label}</span> : "—"}</div></div>
      </div>
      {v?.notes.length ? <ul className="text-[12px] text-muted mt-2 list-disc pl-4">{v.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}

      {error && <div className="text-[12.5px] mt-3 rounded-lg px-3 py-2" style={{ color: "var(--negative)", background: "#fef2f2" }}>{error}</div>}
      <div className="flex items-center gap-2 mt-4">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => save(true)}>{busy ? "Saving…" : "Approve"}</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => save(false)}>Save as draft</button>
      </div>
    </div>
  );
}
