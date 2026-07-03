"use client";

import { useEffect, useState } from "react";
import { fmtRs, fmtSignedRs } from "@/lib/format";

type Position = { symbol: string; shares: number; price: number; marketValue: number };
type Matched = { acquired: string; shares: number; cost: number; proceeds: number; gain: number; longTerm: boolean };
type Preview = {
  symbol: string; price: number; rate: number; filerStatus: string; held: number;
  proceeds: number; netAfterTax: number; matched: Matched[]; totalGain: number; estCgt: number; insufficient: boolean;
  error?: string;
};

export function SimulatorClient() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState(0);
  const [price, setPrice] = useState<string>("");
  const [res, setRes] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portfolio/positions")
      .then((r) => r.json())
      .then((d) => {
        const pos: Position[] = d.positions || [];
        setPositions(pos);
        if (pos[0]) { setSymbol(pos[0].symbol); setShares(pos[0].shares); }
      })
      .catch(() => {});
  }, []);

  const sel = positions.find((p) => p.symbol === symbol);

  async function run() {
    if (!symbol || shares <= 0) return;
    setBusy(true); setErr(null);
    try {
      const qs = new URLSearchParams({ symbol, shares: String(shares) });
      if (price !== "" && Number(price) > 0) qs.set("price", price);
      const r = await fetch(`/api/cgt/preview?${qs.toString()}`);
      const d: Preview = await r.json();
      if (d.error) { setErr(d.error); setRes(null); }
      else setRes(d);
    } catch { setErr("Couldn't compute the preview."); setRes(null); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (symbol && shares > 0) run(); /* eslint-disable-next-line */ }, [symbol]);

  return (
    <div>
      <div className="border border-rule p-4 mb-5" style={{ background: "var(--paper-2)" }}>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="label-cap block mb-1">Holding</span>
            <select value={symbol} onChange={(e) => { setSymbol(e.target.value); const p = positions.find((x) => x.symbol === e.target.value); if (p) setShares(p.shares); }} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]">
              {positions.map((p) => <option key={p.symbol} value={p.symbol}>{p.symbol} ({p.shares})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label-cap block mb-1">Shares to sell</span>
            <input type="number" value={shares || ""} onChange={(e) => setShares(Number(e.target.value))} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono" />
            {sel && (
              <input type="range" min={0} max={sel.shares} step={1} value={Math.min(shares, sel.shares)} onChange={(e) => setShares(Number(e.target.value))} className="w-full mt-1.5 accent-[var(--accent)]" />
            )}
          </label>
          <label className="block">
            <span className="label-cap block mb-1">Price (blank = live)</span>
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={sel ? sel.price.toFixed(2) : ""} className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono" />
          </label>
          <button onClick={run} disabled={busy || !symbol || shares <= 0} className="border border-ink px-3 py-1.5 label-cap hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors disabled:opacity-50">
            {busy ? "Computing…" : "Preview sale"}
          </button>
        </div>
      </div>

      {err && <p className="text-sm py-3" style={{ color: "var(--negative)" }}>{err}</p>}

      {res && !err && (
        <div style={{ opacity: busy ? 0.5 : 1, transition: "opacity 150ms" }}>
          {res.insufficient && (
            <p className="text-[13px] mb-3 px-3 py-2 border" style={{ color: "var(--negative)", borderColor: "var(--negative)" }}>
              You only hold {res.held} shares — the preview covers what you have.
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="border border-rule p-3" style={{ background: "var(--paper-2)" }}>
              <div className="label-cap mb-1">Proceeds @ {fmtRs(res.price, true)}</div>
              <div className="font-display mono-num text-[20px]" style={{ fontVariationSettings: "'opsz' 144" }}>{fmtRs(res.proceeds)}</div>
            </div>
            <div className="border border-rule p-3" style={{ background: "var(--paper-2)" }}>
              <div className="label-cap mb-1">Capital gain</div>
              <div className="font-display mono-num text-[20px]" style={{ fontVariationSettings: "'opsz' 144", color: res.totalGain >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(res.totalGain)}</div>
            </div>
            <div className="border border-rule p-3" style={{ background: "var(--paper-2)" }}>
              <div className="label-cap mb-1">CGT ({res.rate}% · {res.filerStatus})</div>
              <div className="font-display mono-num text-[20px]" style={{ fontVariationSettings: "'opsz' 144", color: "var(--negative)" }}>{fmtRs(res.estCgt)}</div>
            </div>
            <div className="border border-rule p-3" style={{ background: "var(--paper-2)" }}>
              <div className="label-cap mb-1">Net in hand</div>
              <div className="font-display mono-num text-[20px]" style={{ fontVariationSettings: "'opsz' 144" }}>{fmtRs(res.netAfterTax)}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-t border-ink border-b border-ink">
                  {["Lot acquired", "Shares", "Cost", "Proceeds", "Gain", "Holding"].map((h, i) => (
                    <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.matched.map((m, i) => (
                  <tr key={i} className="border-b border-rule">
                    <td className="px-2 py-1.5 font-mono mono-num">{m.acquired}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num">{m.shares}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{fmtRs(m.cost)}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num">{fmtRs(m.proceeds)}</td>
                    <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: m.gain >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(m.gain)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[11px] text-muted">{m.longTerm ? "> 1 year" : "≤ 1 year"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted mt-3 max-w-[70ch]">
            FIFO — the oldest lots sell first, exactly as your broker and FBR treat it. Selling fewer shares can leave the low-cost (high-tax) lots untouched; drag the slider to see the tax curve.
          </p>
        </div>
      )}
    </div>
  );
}
