"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Select } from "@/components/ui/Select";
import { TRANSACTION_TYPES, type TransactionType } from "@/lib/types";
import { fmtRs } from "@/lib/format";
import { computePSXFees } from "@/lib/calculations";

type Props = {
  existingSymbols: string[];
  defaultSymbol?: string;
  portfolios?: Array<{ _id: string; name: string; color: string; isDefault: boolean }>;
  defaultPortfolioId?: string;
  brokeragePct?: number;
};

const TYPE_HINTS: Record<TransactionType, string> = {
  BUY: "Adds shares at the purchase price. Increases avg cost basis.",
  SELL: "Removes shares; realises P/L vs. avg cost.",
  DIVIDEND: "Cash dividend received. Price field = dividend per share.",
  BONUS: "Free shares from the issuer. Avg cost drops automatically.",
  RIGHT: "Subscribed at the rights price. Treated like a buy.",
  SPLIT: "Share split. Use the ratio field (e.g. 1:2 means 1 old → 2 new).",
};

type Lookup = {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  asOf: string | null;
};

export function NewTransactionForm({ existingSymbols, defaultSymbol, portfolios = [], defaultPortfolioId = "", brokeragePct }: Props) {
  const router = useRouter();
  const [portfolioId, setPortfolioId] = useState<string>(defaultPortfolioId);
  // Size by shares, or by the rupees to invest (whole shares at the price).
  const [sizeMode, setSizeMode] = useState<"shares" | "investment">("shares");
  const [investment, setInvestment] = useState<number>(0);
  const initialSymbol =
    defaultSymbol && existingSymbols.includes(defaultSymbol)
      ? defaultSymbol
      : existingSymbols[0] ?? "__new__";

  const [symbolMode, setSymbolMode] = useState<string>(initialSymbol);
  const [customSymbol, setCustomSymbol] = useState(defaultSymbol && !existingSymbols.includes(defaultSymbol) ? defaultSymbol : "");
  const [type, setType] = useState<TransactionType>(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("type");
      if (t === "SELL" || t === "BUY" || t === "DIVIDEND" || t === "BONUS" || t === "RIGHT") return t as TransactionType;
    }
    return "BUY";
  });
  // Corporate-action cards deep-link with the entitlement math pre-filled —
  // date and shares from the announcement, still fully editable here.
  const [date, setDate] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const d = new URLSearchParams(window.location.search).get("date");
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    }
    return new Date().toISOString().slice(0, 10);
  });
  const [shares, setShares] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const s = Number(new URLSearchParams(window.location.search).get("shares"));
      if (Number.isFinite(s) && s > 0) return Math.floor(s);
    }
    return 0;
  });
  const [price, setPrice] = useState<number>(0);
  const [fees, setFees] = useState<number>(0);
  const [feesManual, setFeesManual] = useState<boolean>(false);
  const [ratio, setRatio] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const feeBreakdown = computePSXFees({ shares, price, type, ratePct: brokeragePct });

  // Auto-fill fees from PSX brokerage formula whenever shares/price/type changes,
  // unless the user manually edited the fee field.
  useEffect(() => {
    if (!feesManual) setFees(feeBreakdown.fee);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeBreakdown.fee, feesManual]);
  const [submitting, setSubmitting] = useState(false);
  // SELL discipline: a sale cannot be recorded without its decision. These
  // fields ARE the log entry — written before the trade, frozen with it.
  const [rationale, setRationale] = useState("");
  const [falsifier, setFalsifier] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [guardWarnings, setGuardWarnings] = useState<string[]>([]);
  const [ackGuards, setAckGuards] = useState(false);
  const [attachRebuy, setAttachRebuy] = useState(false);
  const [rebuyMax, setRebuyMax] = useState(0);
  const [rebuyConds, setRebuyConds] = useState("");
  const [rebuyReview, setRebuyReview] = useState("");
  // New-position plan (asked for only when the server demands it).
  const [planRequired, setPlanRequired] = useState(false);
  const [planClass, setPlanClass] = useState("stalwart");
  const [planFvHigh, setPlanFvHigh] = useState(0);
  const [planInvalidator, setPlanInvalidator] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const lookupAbort = useRef<AbortController | null>(null);
  // Tracks whether the user manually typed a price for the CURRENT symbol.
  // Reset to false when the symbol changes so the new symbol's price auto-fills.
  const priceManualRef = useRef(false);

  const isCustom = symbolMode === "__new__";
  const finalSymbol = (isCustom ? customSymbol : symbolMode).trim().toUpperCase();

  // Pre-trade CGT preview for SELLs (FIFO against open lots).
  const [cgtPreview, setCgtPreview] = useState<{ totalGain: number; estCgt: number; rate: number; insufficient: boolean; sharesHeld: number } | null>(null);
  useEffect(() => {
    if (type !== "SELL" || !finalSymbol || shares <= 0 || price <= 0) {
      setCgtPreview(null);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/holdings/${finalSymbol}/sell-preview?shares=${shares}&price=${price}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setCgtPreview(d))
        .catch(() => setCgtPreview(null));
    }, 350);
    return () => clearTimeout(t);
  }, [type, finalSymbol, shares, price]);

  // Look up symbol whenever it stabilises. A new symbol re-enables auto-fill.
  useEffect(() => {
    if (!finalSymbol || finalSymbol.length < 2) {
      setLookup(null);
      setLookupError(null);
      return;
    }
    // Symbol changed → the price field is no longer "the user's" until they type.
    priceManualRef.current = false;
    const t = setTimeout(() => {
      lookupAbort.current?.abort();
      const ac = new AbortController();
      lookupAbort.current = ac;
      setLookupLoading(true);
      setLookupError(null);
      fetch(`/api/lookup/${encodeURIComponent(finalSymbol)}`, { signal: ac.signal })
        .then(async (res) => {
          if (!res.ok) {
            setLookup(null);
            setLookupError(res.status === 404 ? "Not found on PSX." : "Lookup failed.");
            return;
          }
          const data = (await res.json()) as Lookup;
          setLookup(data);
          // Auto-fill the price for the new symbol unless the user has already
          // typed one for it. Applies to BUY/SELL/RIGHT (price-bearing trades).
          if (
            data.price != null &&
            !priceManualRef.current &&
            (type === "BUY" || type === "SELL" || type === "RIGHT")
          ) {
            setPrice(data.price);
          }
        })
        .catch((e) => {
          if (e?.name !== "AbortError") setLookupError("Lookup failed.");
        })
        .finally(() => setLookupLoading(false));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalSymbol]);

  const totalAmount = shares * price;
  const netAmount =
    type === "BUY" || type === "RIGHT"
      ? totalAmount + fees
      : type === "SELL"
      ? totalAmount - fees
      : type === "DIVIDEND"
      ? totalAmount - fees
      : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!finalSymbol) {
      setError("Pick or enter a symbol.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: finalSymbol,
          type,
          date,
          shares,
          pricePerShare: price,
          fees,
          notes,
          ratio,
          ...(portfolioId ? { portfolioId } : {}),
          ...(type === "SELL"
            ? {
                decision: {
                  rationale,
                  falsifier,
                  expectedOutcome,
                  reviewDate,
                  acknowledgeGuards: ackGuards,
                  ...(attachRebuy
                    ? {
                        rebuy: {
                          maxPrice: rebuyMax,
                          requiredConditions: rebuyConds.split("\n").map((c) => c.trim()).filter(Boolean),
                          reviewOn: rebuyReview,
                        },
                      }
                    : {}),
                },
              }
            : {}),
          ...(planRequired && type === "BUY"
            ? { plan: { classification: planClass, fvHigh: planFvHigh, invalidator: planInvalidator } }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body?.error === "guard_warnings") {
          // The behavioural guard: look at what you're avoiding, then proceed.
          setGuardWarnings(body.warnings ?? []);
          return;
        }
        if (body?.error === "plan_required") {
          setPlanRequired(true);
          setError("New position — set its class, your price ceiling and one invalidator below, then record again.");
          return;
        }
        setError(body?.issues?.[0]?.message ?? body?.detail ?? body?.error ?? "Submission failed.");
        return;
      }
      // Jump to the holdings list with a success flag so it's obvious it saved.
      router.push(`/holdings?added=${encodeURIComponent(finalSymbol)}&type=${type}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8 max-w-[640px]">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <Select
            label="Symbol"
            value={symbolMode}
            onChange={setSymbolMode}
            options={[
              ...existingSymbols.map((s) => ({ value: s, label: s })),
              { value: "__new__", label: "+ Add new symbol" },
            ]}
          />
          {isCustom && (
            <TextInput
              label="New symbol"
              value={customSymbol}
              onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. ENGRO"
              hint="We'll fetch the company name and sector from PSX."
            />
          )}

          {finalSymbol && (
            <div className="md:col-span-2">
              <div className="border-l-[3px] border-l-[var(--accent)] bg-[var(--paper-2)] p-4">
                <div className="label-cap mb-1">PSX lookup — {finalSymbol}</div>
                {lookupLoading ? (
                  <div className="text-[12px] text-muted">Fetching from dps.psx.com.pk…</div>
                ) : lookupError ? (
                  <div className="text-[12px]" style={{ color: "var(--negative)" }}>{lookupError}</div>
                ) : lookup ? (
                  <div className="text-[13px] leading-relaxed">
                    <div className="font-display" style={{ fontSize: 17 }}>
                      {lookup.name}
                    </div>
                    <div className="mt-1 text-muted text-[12px]">
                      {lookup.sector}
                      {lookup.price != null && (
                        <>
                          {" · "}
                          <span className="font-mono mono-num text-ink">{fmtRs(lookup.price, true)}</span>
                        </>
                      )}
                      {lookup.asOf && <span className="font-mono"> · as of {lookup.asOf}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="text-[12px] text-muted">Type at least two characters.</div>
                )}
              </div>
            </div>
          )}

          <Select
            label="Type"
            value={type}
            onChange={(v) => {
              setType(v as TransactionType);
              setFeesManual(false); // Re-enable auto fees on type change
              priceManualRef.current = false; // and re-enable price auto-fill
            }}
            options={TRANSACTION_TYPES.map((t) => ({ value: t, label: t }))}
            hint={TYPE_HINTS[type]}
          />
          <div className="space-y-1.5">
            <label className="label-cap block">Date</label>
            <div className="border-b border-ink">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none"
              />
            </div>
          </div>

          {portfolios.length > 1 && (
            <label className="block">
              <span className="text-[11.5px] text-muted">Portfolio</span>
              <select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--surface-2)", border: "1px solid var(--rule)", color: "var(--ink)" }}>
                {portfolios.map((p) => (
                  <option key={p._id} value={p._id}>{p.name}{p.isDefault ? " (default)" : ""}</option>
                ))}
              </select>
            </label>
          )}
          {(type === "BUY" || type === "RIGHT") && (
            <div>
              <span className="text-[11.5px] text-muted">Size by</span>
              <div className="seg mt-1">
                <button type="button" data-active={sizeMode === "shares"} onClick={() => setSizeMode("shares")}>Shares</button>
                <button type="button" data-active={sizeMode === "investment"} onClick={() => setSizeMode("investment")}>Rupees</button>
              </div>
            </div>
          )}
          {type !== "SPLIT" && (type === "BUY" || type === "RIGHT") && sizeMode === "investment" && (
            <NumberInput
              label="Rupees to invest"
              value={investment}
              onChange={(v) => {
                setInvestment(v);
                if (price > 0) setShares(Math.max(0, Math.floor(v / price)));
              }}
              step={1000}
              min={0}
              hint={price > 0 && shares > 0 ? `${shares.toLocaleString()} whole shares at ${price.toFixed(2)}; ${(shares * price).toLocaleString(undefined, { maximumFractionDigits: 0 })} before fees` : "Enter a price first"}
            />
          )}
          {type !== "SPLIT" && !((type === "BUY" || type === "RIGHT") && sizeMode === "investment") && (
            <NumberInput
              label={type === "DIVIDEND" ? "Shares at record date" : "Shares"}
              value={shares}
              onChange={setShares}
              step={1}
              min={0}
            />
          )}
          {type !== "BONUS" && type !== "SPLIT" && (
            <NumberInput
              label={type === "DIVIDEND" ? "Dividend per share (Rs)" : "Price per share (Rs)"}
              value={price}
              onChange={(v) => {
                setPrice(v);
                priceManualRef.current = true;
              }}
              step={0.01}
              min={0}
              hint={
                lookup?.price != null && type !== "DIVIDEND"
                  ? `PSX last: ${fmtRs(lookup.price, true)}`
                  : undefined
              }
            />
          )}
          {(type === "BUY" || type === "SELL" || type === "RIGHT" || type === "DIVIDEND") && (
            <div className="space-y-1">
              <NumberInput
                label="Fees / charges (Rs)"
                value={fees}
                onChange={(v) => {
                  setFees(v);
                  setFeesManual(true);
                }}
                step={0.01}
                min={0}
                hint={
                  feeBreakdown.rule !== "none"
                    ? `Auto: ${feeBreakdown.explanation}`
                    : type === "DIVIDEND"
                    ? "No brokerage on dividends."
                    : undefined
                }
              />
              {feesManual && feeBreakdown.rule !== "none" && (
                <button
                  type="button"
                  onClick={() => {
                    setFeesManual(false);
                    setFees(feeBreakdown.fee);
                  }}
                  className="font-mono text-[10px] uppercase tracking-button hover:underline"
                  style={{ color: "var(--accent-deep)" }}
                >
                  ↻ Reset to auto (Rs {feeBreakdown.fee.toFixed(2)})
                </button>
              )}
            </div>
          )}
          {type === "SPLIT" && (
            <TextInput
              label="Ratio (old:new)"
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
              placeholder="1:2"
              hint="1:2 = each old share becomes 2 new shares."
            />
          )}
          {type === "BONUS" && (
            <NumberInput
              label="Bonus shares received"
              value={shares}
              onChange={setShares}
              step={1}
              min={0}
            />
          )}

          <div className="md:col-span-2">
            <TextInput
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='e.g. "Q3 FY26 dividend"'
            />
          </div>
        </div>
      </Card>

      <Card inverted>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono mono-num">
          <div>
            <div className="text-[10px] tracking-stat uppercase" style={{ color: "rgba(245,241,232,0.65)" }}>
              Total
            </div>
            <div className="text-[20px]">{fmtRs(totalAmount)}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase" style={{ color: "rgba(245,241,232,0.65)" }}>
              Fees
            </div>
            <div className="text-[20px]">{fmtRs(fees)}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-stat uppercase" style={{ color: "rgba(245,241,232,0.65)" }}>
              Net amount
            </div>
            <div className="text-[20px]">{fmtRs(netAmount)}</div>
          </div>
        </div>
      </Card>

      {type === "SELL" && cgtPreview && (
        <div className="border-l-[3px] border-l-[var(--accent)] bg-[var(--paper-2)] p-4">
          <div className="label-cap mb-1">CGT preview (FIFO)</div>
          {cgtPreview.insufficient ? (
            <p className="text-[13px]" style={{ color: "var(--negative)" }}>
              You only hold {fmtRs(cgtPreview.sharesHeld).replace("Rs ", "")} shares — selling more than you own.
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed">
              This sell realises a{" "}
              <span className="font-mono mono-num font-medium" style={{ color: cgtPreview.totalGain >= 0 ? "var(--positive)" : "var(--negative)" }}>
                {fmtRs(cgtPreview.totalGain)}
              </span>{" "}
              {cgtPreview.totalGain >= 0 ? "gain" : "loss"} against your oldest lots ·{" "}
              estimated CGT{" "}
              <span className="font-mono mono-num font-medium" style={{ color: "var(--accent-deep)" }}>
                {fmtRs(cgtPreview.estCgt)}
              </span>{" "}
              <span className="text-muted">@ {cgtPreview.rate}%</span>
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="text-[13px]" style={{ color: "var(--negative)" }}>
          {error}
        </div>
      )}

      <div className="flex gap-3">
        {type === "SELL" && (
          <div className="border-l-[3px] pl-4 py-3 space-y-3" style={{ borderColor: "var(--accent)" }}>
            <div className="label-cap">The decision — logged with the trade, append-only</div>
            <label className="block">
              <span className="label-cap block mb-1">Why sell, in your words (min 20 chars)</span>
              <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3}
                className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]"
                placeholder="Which of your rules fired? What changed? Not the price story — YOUR reasoning." />
            </label>
            <label className="block">
              <span className="label-cap block mb-1">Falsifier — what would prove this sale wrong?</span>
              <input value={falsifier} onChange={(e) => setFalsifier(e.target.value)}
                className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]"
                placeholder='e.g. "FY26 margins recover above 15% and it re-rates past my ceiling"' />
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="label-cap block mb-1">What you expect to happen (optional)</span>
                <input value={expectedOutcome} onChange={(e) => setExpectedOutcome(e.target.value)}
                  className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]" />
              </label>
              <label className="block">
                <span className="label-cap block mb-1">Grade me on (optional)</span>
                <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)}
                  className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
              <input type="checkbox" checked={attachRebuy} onChange={(e) => setAttachRebuy(e.target.checked)} className="w-4 h-4 accent-[var(--accent-deep)]" />
              Attach a re-buy rule (price ceiling + conditions — enforced later so you don&apos;t chase)
            </label>
            {attachRebuy && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6">
                <NumberInput label="Re-buy ceiling (Rs)" value={rebuyMax} onChange={setRebuyMax} min={0} step={0.5} hint="Above this: do not chase." />
                <label className="block">
                  <span className="label-cap block mb-1">Review when the data lands</span>
                  <input type="date" value={rebuyReview} onChange={(e) => setRebuyReview(e.target.value)}
                    className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono" />
                </label>
                <label className="block md:col-span-2">
                  <span className="label-cap block mb-1">Required conditions (one per line, falsifiable)</span>
                  <textarea value={rebuyConds} onChange={(e) => setRebuyConds(e.target.value)} rows={3}
                    className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]"
                    placeholder={"FY26 operating cash flow positive with gross margin >= 15%\nQ1 FY27 gross margin holds >= 13%"} />
                </label>
              </div>
            )}
            {guardWarnings.length > 0 && (
              <div className="border-l-[3px] pl-3 py-2 space-y-2" style={{ borderColor: "var(--negative)" }}>
                {guardWarnings.map((w, i) => (
                  <p key={i} className="text-[13px]" style={{ color: "var(--negative)" }}>{w}</p>
                ))}
                <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                  <input type="checkbox" checked={ackGuards} onChange={(e) => setAckGuards(e.target.checked)} className="w-4 h-4 accent-[var(--accent-deep)]" />
                  I&apos;ve looked at what I was avoiding — record it anyway.
                </label>
              </div>
            )}
          </div>
        )}

        {planRequired && type === "BUY" && (
          <div className="border-l-[3px] pl-4 py-3 space-y-3" style={{ borderColor: "var(--accent)" }}>
            <div className="label-cap">New position — pre-commit the exit before the entry</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="label-cap block mb-1">Asset class (drives the sell rules)</span>
                <select value={planClass} onChange={(e) => setPlanClass(e.target.value)}
                  className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]">
                  <option value="compounder">Compounder</option>
                  <option value="stalwart">Stalwart</option>
                  <option value="cyclical">Cyclical</option>
                  <option value="asset_play">Asset play</option>
                  <option value="turnaround">Turnaround</option>
                  <option value="value_trap">Value trap (be honest)</option>
                </select>
              </label>
              <NumberInput label="Your price ceiling (Rs)" value={planFvHigh} onChange={setPlanFvHigh} min={0} step={0.5} hint="The pre-committed sell line — fair-value high." />
            </div>
            <label className="block">
              <span className="label-cap block mb-1">One falsifiable invalidator</span>
              <input value={planInvalidator} onChange={(e) => setPlanInvalidator(e.target.value)}
                className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]"
                placeholder='Phrased so a number or event can confirm it: "operating cash flow negative two years running"' />
            </label>
          </div>
        )}

        <Button type="submit" variant="solid" disabled={submitting || (type === "SELL" && (rationale.length < 20 || falsifier.length < 10 || (guardWarnings.length > 0 && !ackGuards)))}>
          {submitting ? "Saving…" : "Record Transaction"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
