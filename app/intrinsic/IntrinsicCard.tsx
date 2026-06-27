"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/Badge";
import { FootballField } from "@/components/charts/FootballField";
import { ZoneBar } from "@/components/charts/ZoneBar";
import { PriceZoneChart } from "@/components/charts/PriceZoneChart";
import { Tornado } from "@/components/charts/Tornado";
import { computeIntrinsic, intrinsicSensitivity, sectorFairPE } from "@/lib/calculations/intrinsic";
import type { IntrinsicView } from "@/lib/data";
import { fmtRs } from "@/lib/format";

// A number that smoothly counts up/down to its target — so when you drag a
// slider the value visibly "recalculates" instead of snapping.
function AnimatedNumber({ value, prefix = "Rs ", decimals = 2, className }: { value: number | null; prefix?: string; decimals?: number; className?: string }) {
  const [shown, setShown] = useState(value ?? 0);
  const ref = useRef(value ?? 0);
  useEffect(() => {
    if (value == null) return;
    const from = ref.current;
    const to = value;
    const start = performance.now();
    const dur = 380;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      const cur = from + (to - from) * eased;
      setShown(cur);
      ref.current = cur;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (value == null) return <span className={className}>—</span>;
  return <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{prefix}{shown.toLocaleString("en-PK", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</span>;
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="label-cap">{label}</span>
        <span className="font-mono text-[12px]" style={{ color: "var(--accent-deep)" }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}

const zoneTone = (z: string): "positive" | "negative" | "default" => (z === "strong buy" || z === "buy" ? "positive" : z === "expensive" ? "negative" : "default");

function Fund({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: "pos" | "neg" }) {
  return (
    <div>
      <div className="label-cap mb-0.5">{label}</div>
      <div className="font-mono" style={{ color: accent ? "var(--accent-deep)" : tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

export function IntrinsicCard({ v }: { v: IntrinsicView }) {
  const def = v.inputs;
  const [erp, setErp] = useState(def?.equityRiskPremiumPct ?? 0);
  const [growth, setGrowth] = useState(Math.round((def?.epsGrowthPct ?? 0) * 10) / 10);

  // Fair P/E is DERIVED from the stock's SECTOR + growth + margin trend + the
  // rate, not a free knob — that's how a real PK multiple is set.
  const fairPE = def ? sectorFairPE(def.sector ?? "", growth, def.sbpRatePct, def.marginTrendPct ?? 0) : 8;
  const touched = !!def && (erp !== def.equityRiskPremiumPct || growth !== Math.round((def.epsGrowthPct ?? 0) * 10) / 10);

  // Re-run the SAME model client-side with the user's assumptions. If the raw
  // inputs are missing (older cached data), fall back to the precomputed result.
  const live = useMemo(() => {
    if (!def) return { result: v as ReturnType<typeof computeIntrinsic>, sensitivity: v.sensitivity };
    const inputs = { ...def, equityRiskPremiumPct: erp, epsGrowthPct: growth, dividendGrowthPct: growth, fairPE };
    return { result: computeIntrinsic(inputs), sensitivity: intrinsicSensitivity(inputs) };
  }, [def, v, erp, growth, fairPE]);
  const r = live.result;

  const reset = () => {
    if (!def) return;
    setErp(def.equityRiskPremiumPct);
    setGrowth(Math.round((def.epsGrowthPct ?? 0) * 10) / 10);
  };

  return (
    <div id={v.symbol} className="border border-rule p-5 md:p-7 scroll-mt-24 fade-in-up" style={{ background: "var(--paper-2)" }}>
      {/* header */}
      <div className="flex items-baseline justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-baseline gap-3">
          <Link href={`/holdings/${v.symbol}`} className="font-mono font-medium text-[17px] hover:text-[var(--accent-deep)]">{v.symbol}</Link>
          <span className="text-muted text-[13px]">{v.name}</span>
          {r.basis === "nav" && <span className="label-cap border px-1 py-px" style={{ borderColor: "var(--rule)" }}>NAV basis</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="label-cap">{r.confidence} confidence</span>
          <Badge tone={zoneTone(r.zone)}>{r.zone}</Badge>
        </div>
      </div>

      {/* headline stats (animated) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div>
          <div className="label-cap mb-1">Live price</div>
          <div className="font-display mono-num text-[24px] leading-none" style={{ fontVariationSettings: "'opsz' 144" }}>{fmtRs(v.price, true)}</div>
        </div>
        <div>
          <div className="label-cap mb-1">Intrinsic value</div>
          <AnimatedNumber value={r.intrinsic} className="font-display mono-num text-[24px] leading-none" />
          {r.low != null && r.high != null && <div className="text-[11px] text-muted mt-1 font-mono">range {fmtRs(r.low, true)}–{fmtRs(r.high, true)}</div>}
        </div>
        <div>
          <div className="label-cap mb-1">Margin of safety</div>
          <div className="font-display mono-num text-[24px] leading-none" style={{ fontVariationSettings: "'opsz' 144", color: r.marginOfSafetyPct != null && r.marginOfSafetyPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
            {r.marginOfSafetyPct == null ? "—" : `${r.marginOfSafetyPct >= 0 ? "+" : ""}${r.marginOfSafetyPct.toFixed(0)}%`}
          </div>
          <div className="text-[11px] text-muted mt-1 font-mono">demands {r.requiredMosPct.toFixed(0)}%</div>
        </div>
        <div>
          <div className="label-cap mb-1">Buy below</div>
          <AnimatedNumber value={r.buyBelow} className="font-display mono-num text-[24px] leading-none" />
          {r.strongBuyBelow != null && <div className="text-[11px] text-muted mt-1 font-mono">strong buy ≤ {fmtRs(r.strongBuyBelow, true)}</div>}
        </div>
      </div>

      {/* zone gauge */}
      <ZoneBar price={v.price} strongBuyBelow={r.strongBuyBelow} buyBelow={r.buyBelow} fairUpTo={r.fairUpTo} intrinsic={r.intrinsic} zone={r.zone} />

      {/* fundamentals — what the valuation is reading */}
      {def && (
        <div className="mt-6 flex flex-wrap gap-x-7 gap-y-2 text-[12px]">
          {def.sector && <Fund label="Sector" value={def.sector} />}
          <Fund label="Trailing P/E" value={def.peTtm != null ? `${def.peTtm.toFixed(1)}×` : v.epsLatest && v.epsLatest > 0 ? `${(v.price / v.epsLatest).toFixed(1)}×` : "—"} />
          <Fund label="Fair P/E (sector)" value={`${fairPE.toFixed(1)}×`} accent />
          <Fund label="Net margin" value={def.netMarginPct != null ? `${def.netMarginPct.toFixed(1)}%${def.marginTrendPct != null ? ` (${def.marginTrendPct >= 0 ? "+" : ""}${def.marginTrendPct.toFixed(1)})` : ""}` : "—"} tone={def.marginTrendPct == null ? undefined : def.marginTrendPct >= 0 ? "pos" : "neg"} />
          <Fund label="Revenue YoY" value={def.revenueGrowthPct != null ? `${def.revenueGrowthPct >= 0 ? "+" : ""}${def.revenueGrowthPct.toFixed(0)}%` : "—"} tone={def.revenueGrowthPct == null ? undefined : def.revenueGrowthPct >= 0 ? "pos" : "neg"} />
          <Fund label="Through-cycle EPS" value={v.epsNormalized != null ? fmtRs(v.epsNormalized, true) : "—"} />
        </div>
      )}

      {/* interactive assumptions */}
      {def && (
        <div className="mt-7 border border-rule p-4" style={{ background: "var(--paper)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="label-cap">Test your own assumptions — everything updates live</div>
            {touched && <button onClick={reset} className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">Reset to model</button>}
          </div>
          <div className="grid md:grid-cols-3 gap-5 items-end">
            <Slider label="Required return" value={erp} min={0} max={14} step={0.5} onChange={setErp} fmt={(x) => `${(def.sbpRatePct + x).toFixed(1)}% (SBP ${def.sbpRatePct.toFixed(1)} + ${x.toFixed(1)})`} />
            <Slider label="Through-cycle growth" value={growth} min={-10} max={25} step={0.5} onChange={setGrowth} fmt={(x) => `${x.toFixed(1)}%/yr`} />
            <div>
              <div className="label-cap mb-1">Fair P/E (derived)</div>
              <div className="font-mono text-[13px]" style={{ color: "var(--accent-deep)" }}>{fairPE.toFixed(1)}×</div>
              <div className="text-[10px] text-muted mt-0.5">from growth + the SBP rate</div>
            </div>
          </div>
        </div>
      )}

      {/* methods table + why */}
      <div className="grid md:grid-cols-2 gap-6 mt-7">
        <div>
          <div className="label-cap mb-2">Every method ({r.methods.filter((m) => m.included).length} blended)</div>
          <div className="space-y-1.5">
            {r.methods.filter((m) => m.value != null).map((m) => (
              <div key={m.key} className="flex items-center gap-2 text-[12.5px]" style={{ opacity: m.included ? 1 : 0.5 }}>
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: m.included ? "var(--positive)" : "var(--muted)" }} title={m.included ? "blended in" : "excluded as an outlier"} />
                <span className="font-mono shrink-0 w-40 truncate" title={m.note}>{m.label}</span>
                <span className="font-mono mono-num">{fmtRs(m.value as number, true)}</span>
                {!m.included && <span className="label-cap" style={{ fontSize: 9 }}>outlier</span>}
              </div>
            ))}
            {r.methods.filter((m) => m.value == null && m.key !== "nav").map((m) => (
              <div key={m.key} className="flex items-center gap-2 text-[12.5px] text-muted" style={{ opacity: 0.5 }} title={m.note}>
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: "var(--rule)" }} />
                <span className="font-mono shrink-0 w-40 truncate">{m.label}</span>
                <span className="font-mono">n/a</span>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <FootballField methods={r.methods} price={v.price} intrinsic={r.intrinsic} />
          </div>
        </div>
        <div>
          <div className="label-cap mb-2">Why this zone</div>
          <ul className="space-y-2 text-[13px] text-muted">
            {r.drivers.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span style={{ color: "var(--accent-deep)" }}>—</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* price history with zones */}
      {v.history.length >= 5 && (
        <div className="mt-7">
          <div className="label-cap mb-2">Price vs buying zones · last year {v.annualVolPct != null && <span className="ml-2 normal-case tracking-normal">volatility {v.annualVolPct.toFixed(0)}%/yr</span>}</div>
          <PriceZoneChart history={v.history} strongBuyBelow={r.strongBuyBelow} buyBelow={r.buyBelow} fairUpTo={r.fairUpTo} intrinsic={r.intrinsic} />
        </div>
      )}

      {/* sensitivity */}
      {live.sensitivity.length > 0 && r.intrinsic != null && (
        <div className="mt-7">
          <div className="label-cap mb-2">What moves the value (sensitivity)</div>
          <Tornado rows={live.sensitivity} base={r.intrinsic} />
        </div>
      )}
    </div>
  );
}
