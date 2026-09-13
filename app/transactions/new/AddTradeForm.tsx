"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CompanyMark } from "@/components/ui/CompanyMark";
import { computePSXFees } from "@/lib/calculations";
import { fmtRs } from "@/lib/format";

// Add trade, the way Zar does it: pick the asset (stock or mutual fund), the
// action, the name, then date, quantity, price and deductions; the strip at
// the bottom shows what the trade comes to before it is recorded.

type Held = { symbol: string; name: string; sector: string; shares: number; price: number | null };
type Fund = { _id: string; name: string; mufapName: string; amc: string; units: number; nav: number };
type Portfolio = { _id: string; name: string; isDefault: boolean };
type Hit = { symbol: string; name: string; sector: string; logo: boolean };
type NavHit = { name: string; amc: string; nav: number };

type StockAction = "BUY" | "SELL" | "DIVIDEND" | "BONUS" | "RIGHT" | "SPLIT";
const STOCK_ACTIONS: Array<{ key: StockAction; label: string }> = [
  { key: "BUY", label: "Buy" },
  { key: "SELL", label: "Sell" },
  { key: "DIVIDEND", label: "Dividend" },
  { key: "BONUS", label: "Bonus" },
  { key: "RIGHT", label: "Right" },
  { key: "SPLIT", label: "Split" },
];

const today = () => new Date().toISOString().slice(0, 10);

export type TradeInitial = { asset?: string; symbol?: string; type?: string; shares?: number; date?: string };

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-medium mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  );
}

export function AddTradeForm({ held, funds, portfolios, defaultPortfolioId, brokeragePct, initial = {} }: { held: Held[]; funds: Fund[]; portfolios: Portfolio[]; defaultPortfolioId: string; brokeragePct: number; initial?: TradeInitial }) {
  const router = useRouter();
  const [asset, setAsset] = useState<"stock" | "fund">(initial.asset === "fund" ? "fund" : "stock");
  const [portfolioId, setPortfolioId] = useState(defaultPortfolioId);
  const [date, setDate] = useState(initial.date && /^\d{4}-\d{2}-\d{2}$/.test(initial.date) ? initial.date : today());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stock
  const [action, setAction] = useState<StockAction>(STOCK_ACTIONS.some((a) => a.key === initial.type) ? (initial.type as StockAction) : "BUY");
  const [query, setQuery] = useState(initial.symbol?.toUpperCase() ?? "");
  const [symbol, setSymbol] = useState<string>(initial.symbol?.toUpperCase() ?? "");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<{ name: string; sector: string; price: number | null; asOf: string | null } | null>(null);
  const [qty, setQty] = useState<number>(initial.shares && initial.shares > 0 ? Math.floor(initial.shares) : 0);
  const [sizeMode, setSizeMode] = useState<"qty" | "rupees">("qty");
  const [rupees, setRupees] = useState(0);
  const [price, setPrice] = useState(0);
  const priceTouched = useRef(false);
  const [fees, setFees] = useState(0);
  const [feesTouched, setFeesTouched] = useState(false);
  const [ratio, setRatio] = useState("");
  const [preview, setPreview] = useState<{ totalGain: number; estCgt: number; rate: number; insufficient: boolean; sharesHeld: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Fund
  const [side, setSide] = useState<"BUY" | "REDEEM">("BUY");
  const [fundQuery, setFundQuery] = useState("");
  const [fundHits, setFundHits] = useState<NavHit[]>([]);
  const [fundOpen, setFundOpen] = useState(false);
  const [fund, setFund] = useState<{ id?: string; name: string; mufapName: string; amc: string; nav: number; units: number } | null>(null);
  const [fundMode, setFundMode] = useState<"rupees" | "units">("rupees");
  const [amount, setAmount] = useState(0);
  const [units, setUnits] = useState(0);
  const [nav, setNav] = useState(0);
  const [moneyMarket, setMoneyMarket] = useState(true);

  const heldBy = useMemo(() => new Map(held.map((h) => [h.symbol, h])), [held]);
  const heldRow = heldBy.get(symbol);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFundOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Symbol search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1 || q === symbol) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/symbols?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setHits(d.results ?? []))
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query, symbol]);

  // Quote for the chosen symbol; fills the price unless the user typed one.
  useEffect(() => {
    if (!symbol) {
      setQuote(null);
      return;
    }
    priceTouched.current = false;
    const h = heldBy.get(symbol);
    if (h?.price && (action === "BUY" || action === "SELL" || action === "RIGHT")) setPrice(h.price);
    fetch(`/api/lookup/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setQuote(d);
        if (d.price != null && !priceTouched.current && (action === "BUY" || action === "SELL" || action === "RIGHT")) setPrice(d.price);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const feeCalc = computePSXFees({ shares: qty, price, type: action, ratePct: brokeragePct });
  useEffect(() => {
    if (!feesTouched) setFees(feeCalc.fee);
  }, [feeCalc.fee, feesTouched]);

  useEffect(() => {
    if (action !== "SELL" || !symbol || qty <= 0 || price <= 0) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/holdings/${symbol}/sell-preview?shares=${qty}&price=${price}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [action, symbol, qty, price]);

  // Fund search.
  useEffect(() => {
    const q = fundQuery.trim();
    if (q.length < 2 || (fund && q === fund.name)) {
      setFundHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/funds/nav-search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setFundHits(d.results ?? []))
        .catch(() => setFundHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [fundQuery, fund]);

  const fundUnits = fundMode === "rupees" ? (nav > 0 ? amount / nav : 0) : units;
  const fundAmount = fundMode === "rupees" ? amount : units * nav;

  const gross = qty * price;
  const net = action === "BUY" || action === "RIGHT" ? gross + fees : action === "SELL" || action === "DIVIDEND" ? gross - fees : 0;

  function pickSymbol(sym: string) {
    setSymbol(sym);
    setQuery(sym);
    setOpen(false);
    setFeesTouched(false);
  }

  async function submitStock() {
    if (!symbol) return setError("Pick a company.");
    if (action !== "SPLIT" && qty <= 0) return setError("Enter a quantity.");
    if ((action === "BUY" || action === "SELL" || action === "RIGHT" || action === "DIVIDEND") && price <= 0) return setError(action === "DIVIDEND" ? "Enter the dividend per share." : "Enter a price.");
    if (action === "SPLIT" && !/^\d+\s*:\s*\d+$/.test(ratio)) return setError("Enter the split ratio as old:new, e.g. 1:2.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, type: action, date, shares: qty, pricePerShare: price, fees, notes, ratio, ...(portfolioId ? { portfolioId } : {}) }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.issues?.[0]?.message ?? b?.detail ?? b?.error ?? "Could not record the trade.");
        return;
      }
      router.push("/portfolio");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitFund() {
    if (!fund) return setError("Pick a fund.");
    if (!(nav > 0)) return setError("Enter the NAV.");
    if (!(fundUnits > 0)) return setError(fundMode === "rupees" ? "Enter the amount." : "Enter the units.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/funds/trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fundId: fund.id,
          fund: fund.id ? undefined : { name: fund.name, mufapName: fund.mufapName, amc: fund.amc, moneyMarket },
          side,
          units: fundUnits,
          nav,
          date,
          notes,
          ...(portfolioId ? { portfolioId } : {}),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.issues?.[0]?.message ?? b?.detail ?? b?.error ?? "Could not record the trade.");
        return;
      }
      router.push("/portfolio?tab=cash");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={boxRef} className="max-w-[760px]">
      <div className="card card-pad">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="seg">
            <button type="button" data-active={asset === "stock"} onClick={() => setAsset("stock")}>Stock</button>
            <button type="button" data-active={asset === "fund"} onClick={() => setAsset("fund")}>Mutual fund</button>
          </div>
          {portfolios.length > 1 && (
            <div className="field !min-h-[34px] w-[200px] relative">
              <select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} className="!py-1 text-[13px]">
                {portfolios.map((p) => (
                  <option key={p._id} value={p._id}>{p.name}{p.isDefault ? " (default)" : ""}</option>
                ))}
              </select>
              <svg className="field-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
            </div>
          )}
        </div>

        {asset === "stock" ? (
          <>
            <div className="tabs mt-4">
              {STOCK_ACTIONS.map((a) => (
                <button key={a.key} type="button" data-active={action === a.key} onClick={() => { setAction(a.key); setFeesTouched(false); }}>{a.label}</button>
              ))}
            </div>

            <div className="mt-4">
              <div className="text-[12px] font-medium mb-1.5">Company</div>
              <div className="relative">
                <div className="field">
                  {symbol && heldBy.get(symbol) ? <CompanyMark symbol={symbol} sector={heldBy.get(symbol)?.sector} size="sm" /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted shrink-0" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>}
                  <input value={query} onChange={(e) => { setQuery(e.target.value.toUpperCase()); setSymbol(""); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search by symbol or company name" className="uppercase" autoComplete="off" />
                  {symbol && quote && <span className="text-[12px] text-muted truncate max-w-[220px]">{quote.name}{quote.price != null ? ` · ${quote.price.toFixed(2)}` : ""}</span>}
                </div>
                {open && (hits.length > 0 || (!query && held.length > 0)) && (
                  <div className="absolute left-0 right-0 top-full mt-1 card py-1 z-30 max-h-[300px] overflow-auto">
                    {!query && <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-[0.06em] text-muted">Your holdings</div>}
                    {(query ? hits : held.map((h) => ({ symbol: h.symbol, name: h.name, sector: h.sector, logo: false }))).map((h) => (
                      <button key={h.symbol} type="button" onClick={() => pickSymbol(h.symbol)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--surface-2)]">
                        <CompanyMark symbol={h.symbol} sector={h.sector} size="sm" />
                        <span className="min-w-0"><span className="block text-[13px] font-semibold">{h.symbol}</span><span className="block text-[11px] text-muted truncate">{h.name}{h.sector ? ` · ${h.sector}` : ""}</span></span>
                        {heldBy.get(h.symbol) && <span className="ml-auto text-[11px] text-muted mono-num">{heldBy.get(h.symbol)!.shares.toLocaleString()} held</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Field label="Date">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field mono-num" />
              </Field>
              {action === "SPLIT" ? (
                <Field label="Ratio (old:new)" hint="1:2 means each old share becomes two.">
                  <input value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="1:2" className="field mono-num" />
                </Field>
              ) : (
                <Field
                  label={action === "DIVIDEND" ? "Shares at record date" : action === "BONUS" ? "Bonus shares received" : sizeMode === "rupees" ? "Rupees to invest" : "Quantity"}
                  hint={
                    action === "SELL" && heldRow ? (
                      <button type="button" className="link-underline" onClick={() => setQty(heldRow.shares)}>Max {heldRow.shares.toLocaleString()}</button>
                    ) : (action === "BUY" || action === "RIGHT") ? (
                      <span className="flex items-center gap-2">
                        <button type="button" className={sizeMode === "qty" ? "font-semibold text-ink" : "link-underline"} onClick={() => setSizeMode("qty")}>Shares</button>
                        <span>·</span>
                        <button type="button" className={sizeMode === "rupees" ? "font-semibold text-ink" : "link-underline"} onClick={() => setSizeMode("rupees")}>Rupees</button>
                        {sizeMode === "rupees" && price > 0 && qty > 0 && <span>= {qty.toLocaleString()} shares</span>}
                      </span>
                    ) : undefined
                  }
                >
                  {sizeMode === "rupees" && (action === "BUY" || action === "RIGHT") ? (
                    <input type="number" min={0} step={1000} value={rupees || ""} onChange={(e) => { const v = Number(e.target.value); setRupees(v); if (price > 0) setQty(Math.max(0, Math.floor(v / price))); }} className="field mono-num" placeholder="0" />
                  ) : (
                    <input type="number" min={0} step={1} value={qty || ""} onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value))))} className="field mono-num" placeholder="0" />
                  )}
                </Field>
              )}
              {action !== "BONUS" && action !== "SPLIT" && (
                <Field label={action === "DIVIDEND" ? "Dividend per share (Rs)" : "Price (Rs)"} hint={quote?.price != null && action !== "DIVIDEND" ? `Market ${quote.price.toFixed(2)}${quote.asOf ? ` · ${quote.asOf}` : ""}` : undefined}>
                  <input type="number" min={0} step={0.01} value={price || ""} onChange={(e) => { setPrice(Number(e.target.value)); priceTouched.current = true; if (sizeMode === "rupees" && Number(e.target.value) > 0) setQty(Math.max(0, Math.floor(rupees / Number(e.target.value)))); }} className="field mono-num" placeholder="0.00" />
                </Field>
              )}
              {(action === "BUY" || action === "SELL" || action === "RIGHT" || action === "DIVIDEND") && (
                <Field label="Deductions (Rs)" hint={feeCalc.rule !== "none" ? <span>Auto: {feeCalc.explanation}{feesTouched && <> · <button type="button" className="link-underline" onClick={() => { setFeesTouched(false); setFees(feeCalc.fee); }}>reset</button></>}</span> : action === "DIVIDEND" ? "No brokerage on dividends" : undefined}>
                  <input type="number" min={0} step={0.01} value={fees || ""} onChange={(e) => { setFees(Number(e.target.value)); setFeesTouched(true); }} className="field mono-num" placeholder="0.00" />
                </Field>
              )}
              <div className="md:col-span-2">
                <Field label="Notes">
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="Optional" />
                </Field>
              </div>
            </div>

            {action !== "SPLIT" && action !== "BONUS" && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
                <div><div className="label-cap">{action === "SELL" ? "Sale value" : action === "DIVIDEND" ? "Gross" : "Trade value"}</div><div className="mono-num font-semibold mt-0.5">{fmtRs(gross)}</div></div>
                <div><div className="label-cap">Deductions</div><div className="mono-num font-semibold mt-0.5">{fmtRs(fees)}</div></div>
                <div><div className="label-cap">{action === "SELL" ? "Net proceeds" : action === "DIVIDEND" ? "Net paid" : "Net cost"}</div><div className="mono-num font-semibold mt-0.5">{fmtRs(net)}</div></div>
                {action === "SELL" && (
                  <div>
                    <div className="label-cap">Est. P&amp;L</div>
                    <div className="mono-num font-semibold mt-0.5" style={{ color: preview ? (preview.totalGain >= 0 ? "var(--positive)" : "var(--negative)") : undefined }}>
                      {preview ? (preview.insufficient ? "Over held" : `${preview.totalGain >= 0 ? "+" : "-"}${fmtRs(Math.abs(preview.totalGain))}`) : "–"}
                    </div>
                    {preview && !preview.insufficient && preview.estCgt > 0 && <div className="text-[10.5px] text-muted">CGT about {fmtRs(preview.estCgt)}</div>}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="tabs mt-4">
              <button type="button" data-active={side === "BUY"} onClick={() => setSide("BUY")}>Buy units</button>
              <button type="button" data-active={side === "REDEEM"} onClick={() => setSide("REDEEM")}>Redeem units</button>
            </div>

            <div className="mt-4">
              <div className="text-[12px] font-medium mb-1.5">Fund</div>
              <div className="relative">
                <div className="field">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted shrink-0" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                  <input value={fundQuery} onChange={(e) => { setFundQuery(e.target.value); setFund(null); setFundOpen(true); }} onFocus={() => setFundOpen(true)} placeholder="Search MUFAP, e.g. MCB Cash Management Optimizer" autoComplete="off" />
                  {fund && <span className="text-[12px] text-muted truncate max-w-[220px]">{fund.amc}{fund.units > 0 ? ` · ${fund.units.toLocaleString(undefined, { maximumFractionDigits: 2 })} units held` : ""}</span>}
                </div>
                {fundOpen && (fundHits.length > 0 || (!fundQuery && funds.length > 0)) && (
                  <div className="absolute left-0 right-0 top-full mt-1 card py-1 z-30 max-h-[300px] overflow-auto">
                    {!fundQuery && <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-[0.06em] text-muted">Your funds</div>}
                    {!fundQuery &&
                      funds.map((f) => (
                        <button key={f._id} type="button" onClick={() => { setFund({ id: f._id, name: f.name, mufapName: f.mufapName, amc: f.amc, nav: f.nav, units: f.units }); setFundQuery(f.name); setNav(f.nav); setFundOpen(false); }} className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--surface-2)]">
                          <span className="min-w-0"><span className="block text-[13px] font-semibold truncate">{f.name}</span><span className="block text-[11px] text-muted">{f.amc} · {f.units.toLocaleString(undefined, { maximumFractionDigits: 2 })} units</span></span>
                          <span className="mono-num text-[12px]">{f.nav ? f.nav.toFixed(4) : ""}</span>
                        </button>
                      ))}
                    {fundQuery &&
                      fundHits.map((h) => {
                        const mine = funds.find((f) => f.mufapName === h.name);
                        return (
                          <button key={h.name} type="button" onClick={() => { setFund({ id: mine?._id, name: mine?.name ?? h.name, mufapName: h.name, amc: h.amc, nav: h.nav, units: mine?.units ?? 0 }); setFundQuery(mine?.name ?? h.name); setNav(h.nav); setMoneyMarket(/cash|money|liquid|optimizer|sovereign|income/i.test(h.name)); setFundOpen(false); }} className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--surface-2)]">
                            <span className="min-w-0"><span className="block text-[13px] font-semibold truncate">{h.name}</span><span className="block text-[11px] text-muted">{h.amc}{mine ? " · held" : ""}</span></span>
                            <span className="mono-num text-[12px]">NAV {h.nav.toFixed(4)}</span>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Field label="Date">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field mono-num" />
              </Field>
              <Field label="NAV per unit (Rs)" hint={fund ? `MUFAP ${fund.nav.toFixed(4)}` : undefined}>
                <input type="number" min={0} step={0.0001} value={nav || ""} onChange={(e) => setNav(Number(e.target.value))} className="field mono-num" placeholder="0.0000" />
              </Field>
              <Field
                label={fundMode === "rupees" ? (side === "BUY" ? "Amount to invest (Rs)" : "Amount to redeem (Rs)") : "Units"}
                hint={
                  <span className="flex items-center gap-2">
                    <button type="button" className={fundMode === "rupees" ? "font-semibold text-ink" : "link-underline"} onClick={() => setFundMode("rupees")}>Rupees</button>
                    <span>·</span>
                    <button type="button" className={fundMode === "units" ? "font-semibold text-ink" : "link-underline"} onClick={() => setFundMode("units")}>Units</button>
                    {side === "REDEEM" && fund && fund.units > 0 && <><span>·</span><button type="button" className="link-underline" onClick={() => { setFundMode("units"); setUnits(fund.units); }}>Max {fund.units.toLocaleString(undefined, { maximumFractionDigits: 2 })}</button></>}
                  </span>
                }
              >
                {fundMode === "rupees" ? (
                  <input type="number" min={0} step={1000} value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} className="field mono-num" placeholder="0" />
                ) : (
                  <input type="number" min={0} step={0.0001} value={units || ""} onChange={(e) => setUnits(Number(e.target.value))} className="field mono-num" placeholder="0" />
                )}
              </Field>
              {fund && !fund.id && (
                <Field label="Fund type">
                  <label className="flex items-center gap-2 text-[13px] h-[38px]">
                    <input type="checkbox" checked={moneyMarket} onChange={(e) => setMoneyMarket(e.target.checked)} /> Money-market fund (NAV carries forward on non-trading days)
                  </label>
                </Field>
              )}
              <div className="md:col-span-2">
                <Field label="Notes">
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="Optional" />
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4 rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
              <div><div className="label-cap">Units</div><div className="mono-num font-semibold mt-0.5">{fundUnits > 0 ? fundUnits.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "–"}</div></div>
              <div><div className="label-cap">NAV</div><div className="mono-num font-semibold mt-0.5">{nav > 0 ? nav.toFixed(4) : "–"}</div></div>
              <div><div className="label-cap">{side === "BUY" ? "Amount" : "Proceeds"}</div><div className="mono-num font-semibold mt-0.5">{fmtRs(fundAmount)}</div></div>
            </div>
          </>
        )}

        {error && <div className="text-[12.5px] mt-3 rounded-lg px-3 py-2" style={{ color: "var(--negative)", background: "#fef2f2" }}>{error}</div>}

        <div className="flex items-center gap-2 mt-4">
          <button type="button" onClick={asset === "stock" ? submitStock : submitFund} disabled={busy} className={asset === "stock" && action === "SELL" ? "btn-danger !py-2 !px-4 !text-[13px] !rounded-lg" : "btn-primary"}>
            {busy ? "Saving…" : asset === "stock" ? `Record ${STOCK_ACTIONS.find((a) => a.key === action)?.label.toLowerCase()}` : side === "BUY" ? "Record purchase" : "Record redemption"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => router.back()}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
