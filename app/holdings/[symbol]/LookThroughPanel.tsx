"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { Stat, StatRow } from "@/components/ui/Stat";
import { fmtRs, fmtCompact, fmtNum } from "@/lib/format";

// Look-through weight is a magnitude, so this is a one-hue sequential ramp,
// not categorical hues.
const LT_COLORS = ["var(--ramp-8)", "var(--ramp-7)", "var(--ramp-6)", "var(--ramp-5)", "var(--ramp-4)", "var(--ramp-3)", "var(--ramp-2)", "var(--ramp-1)"];
const UNLISTED_SHADES = ["#6B7280", "#7E8794", "#5A6472", "#909AA6", "#4A5462"];

// Shares of a constituent owned per ONE share of the holding company.
function fmtPerShare(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  return v.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}

type Constituent = { label: string; symbol: string; shares: number; ownershipPct?: number };
type UnlistedHolding = { label: string; valuePkr: number; ownershipPct?: number; note?: string };
type Config = {
  enabled: boolean;
  constituents: Constituent[];
  unlistedHoldings: UnlistedHolding[];
  unlistedValuePkr: number;
  netDebtPkr: number;
  sharesOutstanding: number;
};
type ResultUnlisted = { label: string; value: number; ownershipPct: number; note: string; pctOfAssets: number };
type LTNode = {
  symbol?: string;
  name?: string;
  constituents: { label: string; symbol: string; shares: number; price: number; value: number; pctOfAssets: number; priced: boolean }[];
  unlistedHoldings: ResultUnlisted[];
  listedValue: number;
  unlistedValue: number;
  netDebt: number;
  navTotal: number;
  sharesOutstanding: number;
  navPerShare: number;
  marketPrice: number;
  discountPct: number | null;
  yourMarketValue: number;
  yourLookThroughValue: number;
  missingPrices: string[];
  children?: LTNode[];
  partial?: boolean;
};
type Result = LTNode | null;

type Known = { name: string; listed: { label: string; symbol: string; ownershipPct: number }[]; unlisted: { label: string; note: string; ownershipPct?: number; valuePkr?: number }[]; sharesOutstanding?: number; source: string } | null;

export function LookThroughPanel({ symbol, initial, result, known }: { symbol: string; initial: Config; result: Result; known?: Known }) {
  const router = useRouter();
  const [c, setC] = useState<Config>({ ...initial, constituents: initial.constituents ?? [], unlistedHoldings: initial.unlistedHoldings ?? [] });
  const [editing, setEditing] = useState(!initial.enabled);
  const [saving, setSaving] = useState(false);

  function setRow(i: number, k: keyof Constituent, v: string | number) {
    setC((p) => ({ ...p, constituents: p.constituents.map((row, j) => (j === i ? { ...row, [k]: v } : row)) }));
  }
  function addRow() {
    setC((p) => ({ ...p, constituents: [...p.constituents, { label: "", symbol: "", shares: 0, ownershipPct: 0 }] }));
  }
  function removeRow(i: number) {
    setC((p) => ({ ...p, constituents: p.constituents.filter((_, j) => j !== i) }));
  }

  function setUnlisted(i: number, k: keyof UnlistedHolding, v: string | number) {
    setC((p) => ({ ...p, unlistedHoldings: p.unlistedHoldings.map((row, j) => (j === i ? { ...row, [k]: v } : row)) }));
  }
  function addUnlisted() {
    setC((p) => ({ ...p, unlistedHoldings: [...p.unlistedHoldings, { label: "", valuePkr: 0, ownershipPct: 0, note: "" }] }));
  }
  function removeUnlisted(i: number) {
    setC((p) => ({ ...p, unlistedHoldings: p.unlistedHoldings.filter((_, j) => j !== i) }));
  }
  function loadKnown() {
    if (!known) return;
    setC((p) => ({
      ...p,
      enabled: true,
      constituents: known.listed.map((k) => ({ label: k.label, symbol: k.symbol, shares: 0, ownershipPct: k.ownershipPct })),
      unlistedHoldings: known.unlisted.map((u) => ({ label: u.label, valuePkr: u.valuePkr ?? 0, ownershipPct: u.ownershipPct ?? 0, note: u.note })),
      sharesOutstanding: known.sharesOutstanding ?? p.sharesOutstanding,
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/holdings/${symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lookThrough: {
            enabled: c.enabled,
            constituents: c.constituents.filter((r) => r.symbol.trim()).map((r) => ({ label: r.label, symbol: r.symbol.toUpperCase().trim(), shares: r.shares, ownershipPct: r.ownershipPct ?? 0 })),
            unlistedHoldings: c.unlistedHoldings.filter((u) => (u.label ?? "").trim() || u.valuePkr).map((u) => ({ label: u.label, valuePkr: u.valuePkr || 0, ownershipPct: u.ownershipPct ?? 0, note: u.note ?? "" })),
            unlistedValuePkr: c.unlistedValuePkr,
            netDebtPkr: c.netDebtPkr,
            sharesOutstanding: c.sharesOutstanding,
          },
        }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  const disc = result?.discountPct ?? null;
  const gross = result ? result.listedValue + result.unlistedValue : 0;
  const sharesOut = result?.sharesOutstanding ?? 0;
  const legacyLump = result ? Math.max(0, result.unlistedValue - (result.unlistedHoldings ?? []).reduce((s, u) => s + u.value, 0)) : 0;

  return (
    <div className="space-y-5">
      {result && c.enabled && !editing && (
        <Card>
          <StatRow>
            <Stat label="Look-through NAV / share" value={fmtRs(result.navPerShare, true)} tone="accent" size="lg" />
            <Stat label="Market price" value={fmtRs(result.marketPrice, true)} />
            <Stat
              label={disc != null && disc >= 0 ? "Discount to NAV" : "Premium to NAV"}
              value={disc != null ? `${Math.abs(disc).toFixed(0)}%` : "—"}
              tone={disc != null && disc >= 0 ? "positive" : "negative"}
              hint={disc != null && disc >= 0 ? "trading below assets" : "trading above assets"}
            />
            <Stat label="Your shares — market" value={fmtCompact(result.yourMarketValue)} tone="muted" />
            <Stat label="Your shares — assets" value={fmtCompact(result.yourLookThroughValue)} tone="muted" hint="look-through value" />
          </StatRow>

          {gross > 0 && (
            <div className="mt-6">
              <div className="label-cap mb-2">Asset composition — what one company is made of</div>
              <div className="flex w-full h-8 rounded overflow-hidden border border-ink">
                {result.constituents.map((r, i) => {
                  const w = (r.value / gross) * 100;
                  return (
                    <div
                      key={r.symbol}
                      title={`${r.symbol}: ${w.toFixed(1)}% of assets`}
                      className="flex items-center justify-center"
                      style={{ width: `${w}%`, background: LT_COLORS[i % LT_COLORS.length], opacity: r.priced ? 1 : 0.35 }}
                    >
                      {w >= 9 && <span className="text-[9px] font-mono font-semibold" style={{ color: "rgba(0,0,0,0.6)" }}>{r.symbol}</span>}
                    </div>
                  );
                })}
                {result.unlistedHoldings.map((u, i) => (
                  <div
                    key={`u-${i}`}
                    title={`${u.label}: ${u.pctOfAssets.toFixed(1)}% (unlisted)`}
                    className="flex items-center justify-center"
                    style={{ width: `${u.pctOfAssets}%`, background: UNLISTED_SHADES[i % UNLISTED_SHADES.length] }}
                  >
                    {u.pctOfAssets >= 9 && <span className="text-[9px] font-mono font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>{u.label.split(" ")[0]}</span>}
                  </div>
                ))}
                {legacyLump > 0 && (
                  <div title={`Other unlisted: ${((legacyLump / gross) * 100).toFixed(1)}%`} style={{ width: `${(legacyLump / gross) * 100}%`, background: "#5A6472" }} />
                )}
              </div>
            </div>
          )}

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="label-cap" style={{ textAlign: "left" }}>
                  <th className="py-1">Company</th>
                  <th className="py-1 text-right">Shares owned</th>
                  <th className="py-1 text-right">Per {symbol} share</th>
                  <th className="py-1 text-right">Price</th>
                  <th className="py-1 text-right">Value</th>
                  <th className="py-1 text-right">Rs / share</th>
                  <th className="py-1 text-right">% of assets</th>
                </tr>
              </thead>
              <tbody className="mono-num">
                {result.constituents.map((r) => (
                  <tr key={r.symbol} className="border-t border-rule">
                    <td className="py-1.5"><span className="font-mono font-medium">{r.symbol}</span> <span className="text-muted">{r.label && r.label !== r.symbol ? r.label : ""}</span></td>
                    <td className="py-1.5 text-right">{fmtNum(r.shares)}</td>
                    <td className="py-1.5 text-right" style={{ color: "var(--accent-deep)" }}>{sharesOut > 0 ? fmtPerShare(r.shares / sharesOut) : "—"}</td>
                    <td className="py-1.5 text-right">{r.priced ? fmtRs(r.price, true) : <span style={{ color: "var(--negative)" }}>no price</span>}</td>
                    <td className="py-1.5 text-right">{fmtCompact(r.value)}</td>
                    <td className="py-1.5 text-right">{sharesOut > 0 ? fmtRs(r.value / sharesOut, true) : "—"}</td>
                    <td className="py-1.5 text-right text-muted">{r.pctOfAssets.toFixed(1)}%</td>
                  </tr>
                ))}
                {result.unlistedHoldings.map((u, i) => (
                  <tr key={`ur-${i}`} className="border-t border-rule">
                    <td className="py-1.5">
                      <span className="text-muted">{u.label}</span>
                      {u.ownershipPct > 0 && <span className="text-[10px] text-muted ml-1">({u.ownershipPct}%)</span>}
                      <span className="label-cap ml-2">unlisted</span>
                    </td>
                    <td /><td /><td />
                    <td className="py-1.5 text-right">{fmtCompact(u.value)}</td>
                    <td className="py-1.5 text-right">{sharesOut > 0 ? fmtRs(u.value / sharesOut, true) : "—"}</td>
                    <td className="py-1.5 text-right text-muted">{u.pctOfAssets.toFixed(1)}%</td>
                  </tr>
                ))}
                {legacyLump > 0 && (
                  <tr className="border-t border-rule">
                    <td className="py-1.5 text-muted">Other unlisted</td><td /><td /><td />
                    <td className="py-1.5 text-right">{fmtCompact(legacyLump)}</td>
                    <td className="py-1.5 text-right">{sharesOut > 0 ? fmtRs(legacyLump / sharesOut, true) : "—"}</td>
                    <td className="py-1.5 text-right text-muted">{((legacyLump / gross) * 100).toFixed(1)}%</td>
                  </tr>
                )}
                {result.netDebt > 0 && (
                  <tr className="border-t border-rule">
                    <td className="py-1.5 text-muted">Net debt</td><td /><td /><td />
                    <td className="py-1.5 text-right" style={{ color: "var(--negative)" }}>−{fmtCompact(result.netDebt)}</td>
                    <td className="py-1.5 text-right" style={{ color: "var(--negative)" }}>{sharesOut > 0 ? "−" + fmtRs(result.netDebt / sharesOut, true) : "—"}</td>
                    <td />
                  </tr>
                )}
                <tr className="border-t border-ink font-medium">
                  <td className="py-1.5">Look-through NAV</td>
                  <td className="py-1.5 text-right text-muted">{fmtNum(Math.round(result.sharesOutstanding))} sh</td>
                  <td /><td />
                  <td className="py-1.5 text-right">{fmtCompact(result.navTotal)}</td>
                  <td className="py-1.5 text-right" style={{ color: "var(--accent-deep)" }}>{fmtRs(result.navPerShare, true)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted mt-3 max-w-[82ch]">
            <b>Per {symbol} share</b> is how many shares of each company one {symbol} share owns. <b>Rs / share</b> is the live
            value that stake adds to each {symbol} share — those add up (minus debt) to the {fmtRs(result.navPerShare, true)} NAV per share.
          </p>
          {result.missingPrices.length > 0 && (
            <p className="text-[11px] mt-3" style={{ color: "var(--negative)" }}>
              No live price for: {result.missingPrices.join(", ")} — those are excluded, so the NAV is understated. Check the symbols.
            </p>
          )}
          {result.children && result.children.length > 0 && (
            <div className="mt-6 space-y-4">
              <div className="label-cap" style={{ color: "var(--accent-deep)" }}>Going deeper — sub-holdings that are themselves holding companies</div>
              {result.children.map((child) => (
                <div key={child.symbol} className="border-l-2 pl-4 py-1" style={{ borderColor: "var(--accent)" }}>
                  <div className="flex items-baseline justify-between flex-wrap gap-2">
                    <span className="font-mono font-medium text-[13px]">{child.symbol} <span className="text-muted font-normal">{child.name}</span></span>
                    {child.partial ? (
                      <span className="text-[12px] text-muted font-mono mono-num">Holdings book value {fmtCompact(child.navTotal)}</span>
                    ) : (
                      <span className="text-[12px] text-muted font-mono mono-num">
                        NAV/sh {fmtRs(child.navPerShare, true)}
                        {child.discountPct != null && ` · ${Math.abs(child.discountPct).toFixed(0)}% ${child.discountPct >= 0 ? "below" : "above"} assets`}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted mt-0.5 mb-2">
                    What {child.symbol} itself owns{child.partial ? " (a portfolio inside its operating business — book values, not its standalone worth)" : ""}:
                  </p>
                  <div className="text-[12px] space-y-1">
                    {child.constituents.map((cc) => (
                      <div key={cc.symbol} className="flex items-baseline justify-between gap-3">
                        <span><span className="font-mono font-medium">{cc.symbol}</span> <span className="text-muted">{cc.label && cc.label !== cc.symbol ? cc.label : ""}</span></span>
                        <span className="font-mono mono-num text-muted shrink-0">{cc.pctOfAssets.toFixed(1)}% · {fmtCompact(cc.value)}</span>
                      </div>
                    ))}
                    {child.unlistedHoldings.map((u, i) => (
                      <div key={`cu-${i}`} className="flex items-baseline justify-between gap-3">
                        <span className="text-muted">{u.label} <span className="label-cap">unlisted</span></span>
                        <span className="font-mono mono-num text-muted shrink-0">{u.pctOfAssets.toFixed(1)}% · {fmtCompact(u.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4"><Button variant="outline" onClick={() => setEditing(true)}>Edit constituents</Button></div>
        </Card>
      )}

      {(editing || !c.enabled) && (
        <Card>
          <Toggle label="Value this as a holding company (look-through)" value={c.enabled} onChange={(v) => setC((p) => ({ ...p, enabled: v }))} hint="Sum the live value of the stakes it owns and compare to its market price." />
          {c.enabled && (
            <div className="mt-4 space-y-3">
              <p className="text-[12px] text-muted max-w-[74ch]">
                Add each listed company this one owns. Give either the <b>stake %</b> (from the annual report — shares are then
                derived from that company&apos;s own shares outstanding) or an exact <b>share count</b>. Prices are pulled live.
                The holding-co shares-outstanding auto-derives from earnings if left 0.
              </p>
              <div className="grid grid-cols-12 gap-2 label-cap">
                <span className="col-span-3">Name</span>
                <span className="col-span-2">Symbol</span>
                <span className="col-span-3 text-right">Stake %</span>
                <span className="col-span-3 text-right">or shares</span>
                <span className="col-span-1" />
              </div>
              <div className="space-y-2">
                {c.constituents.map((row, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="col-span-3 bg-transparent border-b border-rule text-[13px] py-1" placeholder="Name" value={row.label} onChange={(e) => setRow(i, "label", e.target.value)} />
                    <input className="col-span-2 bg-transparent border-b border-rule text-[13px] py-1 font-mono uppercase" placeholder="SYM" value={row.symbol} onChange={(e) => setRow(i, "symbol", e.target.value)} />
                    <input className="col-span-3 bg-transparent border-b border-rule text-[13px] py-1 font-mono text-right" type="number" placeholder="%" value={row.ownershipPct || ""} onChange={(e) => setRow(i, "ownershipPct", Number(e.target.value))} />
                    <input className="col-span-3 bg-transparent border-b border-rule text-[13px] py-1 font-mono text-right" type="number" placeholder="shares" value={row.shares || ""} onChange={(e) => setRow(i, "shares", Number(e.target.value))} />
                    <button className="col-span-1 text-[11px] text-muted hover:text-[var(--negative)]" onClick={() => removeRow(i)}>✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4">
                <button className="label-cap hover:text-[var(--accent-deep)]" onClick={addRow}>+ Add company</button>
                {known && (
                  <button className="label-cap hover:text-[var(--accent-deep)]" style={{ color: "var(--accent)" }} onClick={loadKnown}>
                    ↻ Load {known.name}&apos;s known stakes
                  </button>
                )}
              </div>
              <div className="pt-4 border-t border-rule">
                <div className="label-cap mb-1">Private / unlisted holdings</div>
                <p className="text-[12px] text-muted max-w-[78ch] mb-3">
                  Companies it owns that aren&apos;t on PSX — e.g. PIA, Sachal Energy for AHCL; CPHGC, Thar Energy for HUBCO.
                  Enter each one&apos;s value from the annual report (book / equity-method carrying value), not a market price. Leave 0 if unknown.
                  {known && known.unlisted.length > 0 && <> Tip: &quot;Load known stakes&quot; pre-fills these from {known.source}</>}
                </p>
                <div className="grid grid-cols-12 gap-2 label-cap">
                  <span className="col-span-4">Name</span>
                  <span className="col-span-2 text-right">Stake %</span>
                  <span className="col-span-3 text-right">Value (Rs)</span>
                  <span className="col-span-2">Note</span>
                  <span className="col-span-1" />
                </div>
                <div className="space-y-2 mt-1">
                  {c.unlistedHoldings.map((row, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <input className="col-span-4 bg-transparent border-b border-rule text-[13px] py-1" placeholder="e.g. PIA" value={row.label} onChange={(e) => setUnlisted(i, "label", e.target.value)} />
                      <input className="col-span-2 bg-transparent border-b border-rule text-[13px] py-1 font-mono text-right" type="number" placeholder="%" value={row.ownershipPct || ""} onChange={(e) => setUnlisted(i, "ownershipPct", Number(e.target.value))} />
                      <input className="col-span-3 bg-transparent border-b border-rule text-[13px] py-1 font-mono text-right" type="number" placeholder="value" value={row.valuePkr || ""} onChange={(e) => setUnlisted(i, "valuePkr", Number(e.target.value))} />
                      <input className="col-span-2 bg-transparent border-b border-rule text-[12px] py-1" placeholder="note" value={row.note || ""} onChange={(e) => setUnlisted(i, "note", e.target.value)} />
                      <button className="col-span-1 text-[11px] text-muted hover:text-[var(--negative)]" onClick={() => removeUnlisted(i)}>✕</button>
                    </div>
                  ))}
                </div>
                <button className="label-cap hover:text-[var(--accent-deep)] mt-2" onClick={addUnlisted}>+ Add unlisted holding</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3">
                <label className="block"><span className="label-cap">Other unlisted lump (Rs)</span><input className="field w-full text-[14px] font-mono" type="number" value={c.unlistedValuePkr || ""} onChange={(e) => setC((p) => ({ ...p, unlistedValuePkr: Number(e.target.value) }))} /></label>
                <label className="block"><span className="label-cap">Net debt (Rs)</span><input className="field w-full text-[14px] font-mono" type="number" value={c.netDebtPkr || ""} onChange={(e) => setC((p) => ({ ...p, netDebtPkr: Number(e.target.value) }))} /></label>
                <label className="block"><span className="label-cap">Shares outstanding (0 = auto)</span><input className="field w-full text-[14px] font-mono" type="number" value={c.sharesOutstanding || ""} onChange={(e) => setC((p) => ({ ...p, sharesOutstanding: Number(e.target.value) }))} /></label>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-rule">
            <Button variant="solid" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            {initial.enabled && <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>}
          </div>
        </Card>
      )}
    </div>
  );
}
