"use client";

import { useEffect, useState } from "react";

type Result = {
  symbol: string;
  strategy: string;
  bars: number;
  total_return_pct: number;
  buy_hold_return_pct: number;
  trades: number;
  closed_trades: number;
  open_position: boolean;
  win_rate_pct: number | null;
  max_drawdown_pct: number;
  exposure_pct: number;
  equity_curve: number[];
  error?: string;
};

const STRATEGIES = [
  { key: "rsi", label: "RSI oversold / overbought" },
  { key: "sma_cross", label: "SMA cross (fast > slow)" },
  { key: "above_sma", label: "Hold while above SMA" },
];

function EquityCurve({ curve, buyHoldMult }: { curve: number[]; buyHoldMult: number }) {
  if (curve.length < 2) return null;
  const W = 720, H = 220, padL = 40, padR = 12, padT = 12, padB = 22;
  const ys = [...curve, 1, buyHoldMult];
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const x = (i: number) => padL + (i / (curve.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const path = curve.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = curve[curve.length - 1];
  const beat = last >= buyHoldMult;
  const gridVals = [min, 1, max].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 260 }} role="img" aria-label="Equity curve">
      <line x1={padL} y1={y(1)} x2={W - padR} y2={y(1)} stroke="var(--rule)" strokeWidth={1} />
      <line x1={padL} y1={y(buyHoldMult)} x2={W - padR} y2={y(buyHoldMult)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
      <text x={W - padR} y={y(buyHoldMult) - 4} textAnchor="end" className="font-mono" fontSize={10} fill="var(--muted)">buy &amp; hold</text>
      {gridVals.map((v) => (
        <text key={v} x={padL - 6} y={y(v) + 3} textAnchor="end" className="font-mono" fontSize={9} fill="var(--muted)">{v.toFixed(2)}×</text>
      ))}
      <path d={path} fill="none" stroke={beat ? "var(--positive)" : "var(--ink)"} strokeWidth={1.75} />
      <circle cx={x(curve.length - 1)} cy={y(last)} r={3} fill={beat ? "var(--positive)" : "var(--ink)"} />
    </svg>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "var(--positive)" : tone === "neg" ? "var(--negative)" : "var(--ink)";
  return (
    <div className="border border-rule p-3" style={{ background: "var(--paper-2)" }}>
      <div className="label-cap mb-1">{label}</div>
      <div className="font-display mono-num text-[22px]" style={{ fontVariationSettings: "'opsz' 144", color }}>{value}</div>
    </div>
  );
}

export function BacktestClient({ initialSymbol = "MEBL" }: { initialSymbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [strategy, setStrategy] = useState("rsi");
  const [p, setP] = useState<Record<string, string>>({ period: "14", oversold: "30", overbought: "70", fast: "50", slow: "200" });
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true); setErr(null);
    const qs = new URLSearchParams({ strategy });
    if (strategy === "rsi") { qs.set("period", p.period); qs.set("oversold", p.oversold); qs.set("overbought", p.overbought); }
    if (strategy === "sma_cross") { qs.set("fast", p.fast); qs.set("slow", p.slow); }
    if (strategy === "above_sma") { qs.set("period", p.period); }
    try {
      const r = await fetch(`/api/market/backtest/${encodeURIComponent(sym)}?${qs.toString()}`);
      const d: Result = await r.json();
      if (d.error) { setErr(d.error === "not_found" ? `No price history for ${sym}.` : "Not enough history to test."); setRes(null); }
      else setRes(d);
    } catch { setErr("Couldn't reach the analytics engine."); setRes(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const edge = res ? res.total_return_pct - res.buy_hold_return_pct : 0;
  const field = (k: string, label: string, min: number, max: number, step = 1) => (
    <label className="block">
      <span className="label-cap block mb-1">{label}</span>
      <input type="number" value={p[k]} onChange={(e) => setP((s) => ({ ...s, [k]: e.target.value }))} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono" />
      <input type="range" min={min} max={max} step={step} value={Number(p[k]) || min} onChange={(e) => setP((s) => ({ ...s, [k]: e.target.value }))} className="w-full mt-1.5 accent-[var(--accent)]" />
    </label>
  );

  return (
    <div>
      <div className="border border-rule p-4 mb-5" style={{ background: "var(--paper-2)" }}>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="label-cap block mb-1">Symbol</span>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && run()} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono uppercase" />
          </label>
          <label className="block md:col-span-2">
            <span className="label-cap block mb-1">Strategy</span>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]">
              {STRATEGIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <button onClick={run} disabled={loading} className="border border-ink px-3 py-1.5 label-cap hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors disabled:opacity-50">
            {loading ? "Testing…" : "Run backtest"}
          </button>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          {strategy === "rsi" && <>{field("period", "RSI period", 2, 50)}{field("oversold", "Buy below RSI", 10, 45)}{field("overbought", "Sell above RSI", 55, 90)}</>}
          {strategy === "sma_cross" && <>{field("fast", "Fast SMA", 5, 100)}{field("slow", "Slow SMA", 50, 300, 5)}</>}
          {strategy === "above_sma" && <>{field("period", "SMA period", 10, 250, 5)}</>}
        </div>
      </div>

      {err && <p className="text-sm py-4" style={{ color: "var(--negative)" }}>{err}</p>}

      {res && !err && (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms" }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Stat label="Strategy return" value={`${res.total_return_pct >= 0 ? "+" : ""}${res.total_return_pct.toFixed(0)}%`} tone={res.total_return_pct >= 0 ? "pos" : "neg"} />
            <Stat label="Buy & hold" value={`${res.buy_hold_return_pct >= 0 ? "+" : ""}${res.buy_hold_return_pct.toFixed(0)}%`} />
            <Stat label="Edge vs hold" value={`${edge >= 0 ? "+" : ""}${edge.toFixed(0)}%`} tone={edge >= 0 ? "pos" : "neg"} />
            <Stat label="Max drawdown" value={`${res.max_drawdown_pct.toFixed(0)}%`} tone="neg" />
            <Stat label="Trades" value={res.open_position ? `${res.trades} · holding` : `${res.trades}`} />
            <Stat label="Win rate" value={res.win_rate_pct == null ? (res.open_position ? "open" : "—") : `${res.win_rate_pct.toFixed(0)}%`} />
            <Stat label="Time in market" value={`${res.exposure_pct.toFixed(0)}%`} />
            <Stat label="Bars tested" value={`${res.bars}`} />
          </div>
          <div className="border border-rule p-4" style={{ background: "var(--paper-2)" }}>
            <div className="label-cap mb-2">Growth of Rs 1 — {res.symbol}, {STRATEGIES.find((s) => s.key === res.strategy)?.label}</div>
            <EquityCurve curve={res.equity_curve} buyHoldMult={1 + res.buy_hold_return_pct / 100} />
            <p className="text-[11px] text-muted mt-2">
              The line is your strategy; the dashed line is where buy-and-hold ended. {edge >= 0 ? "The rule beat buy-and-hold here" : "Buy-and-hold won here"} — and it was only in the market {res.exposure_pct.toFixed(0)}% of the time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
