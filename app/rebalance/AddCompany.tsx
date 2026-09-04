"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Add a not-yet-owned company to the plan so the rebalance can size a buy.
export function AddCompany() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function add() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/holdings/add-planned", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: sym, targetAllocationPercent: target === "" ? 0 : Number(target) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) {
        const weighted = Number(target) > 0;
        setMsg({
          kind: "ok",
          text: body.adopted
            ? weighted
              ? `${body.name || sym} was already on your books with no shares and no target, so it has been brought back rather than duplicated. Its history is intact and it is in the plan below as a BUY.`
              : `${body.name || sym} was already on your books and its history is intact, but you gave it no target — so it stays dormant and out of the plan. Add it again with a weight to bring it back.`
            : weighted
            ? `Added ${body.name || sym}${body.price ? ` at Rs ${body.price}` : ""}. It's now in the plan below as a BUY.`
            : `Added ${body.name || sym}${body.price ? ` at Rs ${body.price}` : ""}, but with no target weight it will not be sized for a buy. Give it a target in the table below.`,
        });
        setSymbol("");
        setTarget("");
        router.refresh();
      } else if (res.status === 409) {
        setMsg({
          kind: "err",
          text: `You already hold ${sym}, so it is in the targets table below — set its weight there rather than adding it again.`,
        });
      } else if (res.status === 404) {
        setMsg({ kind: "err", text: body.detail || `Couldn't find ${sym} on PSX.` });
      } else {
        setMsg({ kind: "err", text: body.detail || body.error || "Failed to add." });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="label-cap mb-1">Add a company to the plan</div>
      <p className="text-[12px] text-muted mb-4 max-w-[70ch]">
        Planning to buy something new? Add its symbol and a target weight. We verify it on PSX, pull a live price,
        and it shows up in the rebalance below as a BUY — sized to hit your target.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label-cap block mb-1.5">Symbol</label>
          <input
            type="text"
            value={symbol}
            placeholder="e.g. OGDC"
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="w-40 bg-transparent border-b border-ink py-1.5 font-mono uppercase text-[14px] focus:outline-none focus:border-[var(--accent-deep)]"
          />
        </div>
        <div>
          <label className="label-cap block mb-1.5">Target %</label>
          <input
            type="number"
            value={target}
            placeholder="0"
            min={0}
            max={100}
            step={0.5}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="w-24 bg-transparent border-b border-ink py-1.5 text-right font-mono mono-num text-[14px] focus:outline-none focus:border-[var(--accent-deep)]"
          />
        </div>
        <Button variant="solid" onClick={add} disabled={busy || !symbol.trim()}>
          {busy ? "Adding…" : "Add company"}
        </Button>
      </div>
      {msg && (
        <div className="text-[13px] mt-4" style={{ color: msg.kind === "ok" ? "var(--positive)" : "var(--negative)" }}>
          {msg.text}
        </div>
      )}
    </Card>
  );
}
