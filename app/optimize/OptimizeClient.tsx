"use client";

import { useEffect, useState } from "react";

type Port = { weights: Record<string, number>; expected_return_pct: number; volatility_pct: number; sharpe: number };
type Asset = { symbol: string; expected_return_pct: number; volatility_pct: number };
type Result = {
  symbols: string[];
  max_sharpe: Port;
  min_vol: Port;
  frontier: { vol: number; ret: number }[];
  assets: Asset[];
  risk_free_pct: number;
  error?: string;
};

function Frontier({ res }: { res: Result }) {
  const W = 720, H = 320, padL = 44, padR = 16, padT = 14, padB = 34;
  const vols = [...res.frontier.map((f) => f.vol), ...res.assets.map((a) => a.volatility_pct), res.max_sharpe.volatility_pct, res.min_vol.volatility_pct];
  const rets = [...res.frontier.map((f) => f.ret), ...res.assets.map((a) => a.expected_return_pct), res.max_sharpe.expected_return_pct, res.risk_free_pct];
  const xMin = Math.min(...vols) * 0.95, xMax = Math.max(...vols) * 1.05;
  const yMin = Math.min(...rets, 0), yMax = Math.max(...rets) * 1.05;
  const x = (v: number) => padL + ((v - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const line = res.frontier.map((f, i) => `${i === 0 ? "M" : "L"}${x(f.vol).toFixed(1)},${y(f.ret).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 360 }} role="img" aria-label="Efficient frontier">
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--ink)" strokeWidth={1} />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="var(--ink)" strokeWidth={1} />
      <text x={(W + padL) / 2} y={H - 4} textAnchor="middle" className="font-mono" fontSize={10} fill="var(--muted)">Risk — annualised volatility %</text>
      <text x={12} y={(H - padB + padT) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(H - padB + padT) / 2})`} className="font-mono" fontSize={10} fill="var(--muted)">Return %</text>
      {/* frontier */}
      <path d={line} fill="none" stroke="var(--accent-deep)" strokeWidth={1.75} opacity={0.85} />
      {/* individual assets */}
      {res.assets.map((a) => (
        <g key={a.symbol}>
          <circle cx={x(a.volatility_pct)} cy={y(a.expected_return_pct)} r={3} fill="none" stroke="var(--muted)" strokeWidth={1.25} />
          <text x={x(a.volatility_pct) + 5} y={y(a.expected_return_pct) + 3} className="font-mono" fontSize={9} fill="var(--muted)">{a.symbol}</text>
        </g>
      ))}
      {/* min-vol + max-sharpe */}
      <circle cx={x(res.min_vol.volatility_pct)} cy={y(res.min_vol.expected_return_pct)} r={5} fill="var(--ink)" />
      <text x={x(res.min_vol.volatility_pct)} y={y(res.min_vol.expected_return_pct) - 9} textAnchor="middle" className="font-mono" fontSize={9} fill="var(--ink)">min-vol</text>
      <circle cx={x(res.max_sharpe.volatility_pct)} cy={y(res.max_sharpe.expected_return_pct)} r={5.5} fill="var(--accent)" stroke="var(--ink)" strokeWidth={1} />
      <text x={x(res.max_sharpe.volatility_pct)} y={y(res.max_sharpe.expected_return_pct) - 9} textAnchor="middle" className="font-mono" fontSize={9} fill="var(--accent-deep)">max-Sharpe</text>
    </svg>
  );
}

function Weights({ port, title, accent }: { port: Port; title: string; accent?: boolean }) {
  const rows = Object.entries(port.weights).filter(([, w]) => w >= 0.5).sort((a, b) => b[1] - a[1]);
  return (
    <div className="border p-4" style={{ background: "var(--paper-2)", borderColor: accent ? "var(--accent)" : "var(--rule)" }}>
      <div className="flex items-baseline justify-between mb-3">
        <span className="label-cap" style={{ color: accent ? "var(--accent-deep)" : undefined }}>{title}</span>
        <span className="font-mono text-[11px] text-muted">Sharpe {port.sharpe.toFixed(2)}</span>
      </div>
      <div className="flex gap-4 mb-3 text-[13px]">
        <div><span className="label-cap block">Return</span><span className="font-display mono-num text-[20px]" style={{ fontVariationSettings: "'opsz' 144", color: "var(--positive)" }}>{port.expected_return_pct.toFixed(1)}%</span></div>
        <div><span className="label-cap block">Risk</span><span className="font-display mono-num text-[20px]" style={{ fontVariationSettings: "'opsz' 144" }}>{port.volatility_pct.toFixed(1)}%</span></div>
      </div>
      <div className="space-y-1.5">
        {rows.map(([sym, w]) => (
          <div key={sym} className="grid grid-cols-[64px_1fr_44px] items-center gap-2">
            <span className="font-mono text-[12px]">{sym}</span>
            <span className="inline-block h-2 rounded-sm" style={{ width: `${w}%`, minWidth: 3, background: accent ? "var(--accent)" : "var(--ink)" }} />
            <span className="font-mono mono-num text-[12px] text-right text-muted">{w.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OptimizeClient() {
  const [input, setInput] = useState("MEBL, HUBC, OGDC, LUCK, ENGRO, FFC");
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pf, setPf] = useState<{ totalValue: number; positions: { symbol: string; shares: number; price: number; marketValue: number }[] } | null>(null);
  const [applyBudget, setApplyBudget] = useState<string>("");

  useEffect(() => {
    fetch("/api/portfolio/positions").then((r) => r.json()).then(setPf).catch(() => {});
  }, []);

  async function run() {
    const syms = input.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (syms.length < 2) { setErr("Enter at least two symbols."); return; }
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/market/optimize?symbols=${encodeURIComponent(syms.join(","))}`);
      const d: Result = await r.json();
      if (d.error || !d.max_sharpe) { setErr("Need at least two symbols with enough price history."); setRes(null); }
      else setRes(d);
    } catch { setErr("Couldn't reach the analytics engine."); setRes(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  return (
    <div>
      <div className="border border-rule p-4 mb-5" style={{ background: "var(--paper-2)" }}>
        <label className="block">
          <span className="label-cap block mb-1">Symbols (comma-separated, 2–12)</span>
          <div className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && run()} className="flex-1 border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono uppercase" />
            <button onClick={run} disabled={loading} className="border border-ink px-3 py-1.5 label-cap hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors disabled:opacity-50 whitespace-nowrap">
              {loading ? "Optimising…" : "Optimise"}
            </button>
          </div>
        </label>
      </div>

      {err && <p className="text-sm py-4" style={{ color: "var(--negative)" }}>{err}</p>}

      {res && !err && (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms" }}>
          <div className="grid md:grid-cols-2 gap-4 mb-5">
            <Weights port={res.max_sharpe} title="Max-Sharpe — best risk-adjusted" accent />
            <Weights port={res.min_vol} title="Minimum volatility — calmest" />
          </div>
          <div className="border border-rule p-4" style={{ background: "var(--paper-2)" }}>
            <div className="label-cap mb-2">Efficient frontier — {res.symbols.length} stocks (risk-free {res.risk_free_pct}%)</div>
            <Frontier res={res} />
            <p className="text-[11px] text-muted mt-2">
              Each hollow dot is one stock on its own. The curve is the best return you could have had at each level of risk by mixing them — notice the blends sit up and to the left of the individual stocks. That gap is diversification.
            </p>
          </div>
          <div className="border border-rule p-4 mt-5" style={{ background: "var(--paper-2)" }}>
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
              <div className="label-cap">Apply the max-Sharpe mix to your money</div>
              <label className="flex items-center gap-2 text-[12px] text-muted">
                Budget Rs
                <input type="number" value={applyBudget} placeholder={pf ? String(Math.round(pf.totalValue)) : ""} onChange={(e) => setApplyBudget(e.target.value)} className="w-32 border border-rule bg-transparent px-2 py-1 text-[13px] font-mono" />
              </label>
            </div>
            {!pf ? (
              <p className="text-[13px] text-muted">Loading your portfolio…</p>
            ) : (
              (() => {
                const budget = Number(applyBudget) > 0 ? Number(applyBudget) : pf.totalValue;
                const bySym = new Map(pf.positions.map((p) => [p.symbol, p]));
                const rows = Object.entries(res.max_sharpe.weights)
                  .filter(([, w]) => w >= 0.5)
                  .map(([sym, w]) => {
                    const targetRs = (w / 100) * budget;
                    const cur = bySym.get(sym);
                    const curRs = cur?.marketValue ?? 0;
                    const price = cur?.price ?? null;
                    const deltaRs = targetRs - curRs;
                    const shares = price && price > 0 ? Math.round(Math.abs(deltaRs) / price) : null;
                    return { sym, w, targetRs, curRs, deltaRs, shares, price };
                  });
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="border-t border-ink border-b border-ink">
                          {["Symbol", "Weight", "Target Rs", "You hold Rs", "Action"].map((h, i) => (
                            <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.sym} className="border-b border-rule">
                            <td className="px-2 py-1.5 font-mono font-medium">{r.sym}</td>
                            <td className="px-2 py-1.5 text-right font-mono mono-num">{r.w.toFixed(1)}%</td>
                            <td className="px-2 py-1.5 text-right font-mono mono-num">{Math.round(r.targetRs).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{Math.round(r.curRs).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: r.deltaRs >= 0 ? "var(--positive)" : "var(--negative)" }}>
                              {Math.abs(r.deltaRs) < Math.max(500, budget * 0.005)
                                ? "hold"
                                : `${r.deltaRs > 0 ? "BUY" : "SELL"}${r.shares != null ? ` ~${r.shares}` : ""} (Rs ${Math.round(Math.abs(r.deltaRs)).toLocaleString()})`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[11px] text-muted mt-2 max-w-[72ch]">
                      Based on your live positions and prices. Stocks you hold that aren't in this basket aren't counted — this sizes the basket against the budget above (default: your current equity value). Fees and CGT not included; check the CGT simulator before selling.
                    </p>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
