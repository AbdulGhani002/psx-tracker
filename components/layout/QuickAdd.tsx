"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Record a trade without leaving the page you are on.
//
// Deliberately scoped to the UNGATED case: adding to a position you already
// hold. A SELL needs a rationale and a falsifier logged atomically with the
// trade, and a BUY that opens a NEW position needs a class, a ceiling and an
// invalidator — those gates are the point of this app, and a modal that let you
// skip past them in four fields would be the one change that quietly undoes the
// discipline. When the API refuses for either reason this says so and hands you
// to the full form rather than trying to talk it round.
//
// Fees are entered, never assumed: the broker note is the source, and a
// commission this guessed at would be wrong by a rupee or two on every row.

type Holding = { symbol: string; name?: string; currentShares?: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

export function QuickAdd() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [symbol, setSymbol] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; gated: boolean } | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("psx:quick-add", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("psx:quick-add", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    if (holdings.length > 0) return;
    fetch("/api/holdings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHoldings((d?.holdings ?? []) as Holding[]))
      .catch(() => {
        /* the field still accepts a typed symbol */
      });
  }, [open, holdings.length]);

  const qty = Number(shares);
  const rate = Number(price);
  const fee = Number(fees || 0);
  const valid = symbol.trim() !== "" && qty > 0 && rate > 0 && Number.isFinite(fee) && fee >= 0;
  const net = valid ? r2(qty * rate + fee) : null;

  function reset() {
    setSymbol("");
    setShares("");
    setPrice("");
    setFees("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          type: "BUY",
          date,
          shares: qty,
          pricePerShare: rate,
          fees: fee,
          notes: "Quick entry",
        }),
      });
      if (res.ok) {
        setOpen(false);
        reset();
        router.push(`/holdings?added=${encodeURIComponent(symbol.trim().toUpperCase())}&type=BUY`);
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      const gated = body?.error === "plan_required";
      setError({
        msg:
          body?.detail ??
          (body?.error ? String(body.error).replace(/_/g, " ") : `The trade was refused (HTTP ${res.status}).`),
        gated,
      });
    } catch {
      setError({ msg: "Could not reach the server. The trade was not recorded.", gated: false });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const known = holdings.filter((h) => (h.currentShares ?? 0) > 0);

  return (
    <div
      className="fixed inset-0 z-50 overlay-in"
      style={{ background: "color-mix(in srgb, var(--ink) 38%, transparent)" }}
      onMouseDown={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Record a trade"
    >
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="max-w-[440px] mx-auto mt-[10vh] panel-in"
        style={{ background: "var(--paper)", border: "1px solid var(--ink)" }}
      >
        <div className="flex items-baseline justify-between px-5 pt-4 pb-3 border-b border-[var(--rule)]">
          <span className="font-display text-[22px] leading-none">Record a buy</span>
          <button type="button" onClick={() => setOpen(false)} className="label-cap link-underline">
            Esc
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="label-cap block mb-1.5" htmlFor="qa-symbol">Symbol</label>
            <input
              id="qa-symbol"
              ref={firstRef}
              list="qa-symbols"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="HINOON"
              autoComplete="off"
              className="w-full bg-transparent border-b border-[var(--rule-strong)] pb-1 outline-none focus:border-[var(--accent)] transition-colors font-mono text-[15px]"
              style={{ color: "var(--ink)" }}
            />
            <datalist id="qa-symbols">
              {known.map((h) => (
                <option key={h.symbol} value={h.symbol}>{h.name ?? ""}</option>
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-cap block mb-1.5" htmlFor="qa-date">Trade date</label>
              <input
                id="qa-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-transparent border-b border-[var(--rule-strong)] pb-1 outline-none focus:border-[var(--accent)] transition-colors mono-num text-[14px]"
                style={{ color: "var(--ink)" }}
              />
            </div>
            <div>
              <label className="label-cap block mb-1.5" htmlFor="qa-shares">Shares</label>
              <input
                id="qa-shares"
                type="number"
                min="0"
                step="any"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                className="w-full bg-transparent border-b border-[var(--rule-strong)] pb-1 outline-none focus:border-[var(--accent)] transition-colors mono-num text-[14px]"
                style={{ color: "var(--ink)" }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-cap block mb-1.5" htmlFor="qa-price">Market rate</label>
              <input
                id="qa-price"
                type="number"
                min="0"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-transparent border-b border-[var(--rule-strong)] pb-1 outline-none focus:border-[var(--accent)] transition-colors mono-num text-[14px]"
                style={{ color: "var(--ink)" }}
              />
            </div>
            <div>
              <label className="label-cap block mb-1.5" htmlFor="qa-fees">Fees (comm + SST)</label>
              <input
                id="qa-fees"
                type="number"
                min="0"
                step="any"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent border-b border-[var(--rule-strong)] pb-1 outline-none focus:border-[var(--accent)] transition-colors mono-num text-[14px]"
                style={{ color: "var(--ink)" }}
              />
            </div>
          </div>

          <p className="text-[11px] text-muted leading-snug">
            The market rate off the note, not the net rate — the net rate already has commission inside it, and adding
            fees on top would count them twice.
          </p>

          <div className="flex items-baseline justify-between border-t border-[var(--rule)] pt-3">
            <span className="label-cap">Net outlay</span>
            <span className="mono-num text-[19px]">
              {net != null ? net.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </span>
          </div>

          {error && (
            <div className="text-[13px] leading-snug" style={{ color: "var(--negative)" }}>
              {error.msg}
              {error.gated && (
                <>
                  {" "}
                  <a href="/transactions/new" className="link-underline">Open the full form</a> to set the plan.
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-t border-[var(--rule)]">
          <button
            type="submit"
            disabled={!valid || busy}
            className="px-4 py-2 text-[13px] transition-opacity disabled:opacity-40"
            style={{ background: "var(--ink)", color: "var(--paper)" }}
          >
            {busy ? "Recording…" : "Record buy"}
          </button>
          <a href="/transactions/new" className="label-cap link-underline">
            Sells and new positions →
          </a>
        </div>
      </form>
    </div>
  );
}
