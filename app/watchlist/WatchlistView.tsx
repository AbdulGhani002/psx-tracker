"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Section } from "@/components/layout/Section";
import { fmtRs, fmtSignedPct } from "@/lib/format";

type Row = {
  _id: string;
  symbol: string;
  name: string;
  sector: string;
  notes: string;
  targetBuyPrice: number | null;
  targetSellPrice: number | null;
  currentPrice: number;
};

type Props = { rows: Row[] };

export function WatchlistView({ rows }: Props) {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const [notes, setNotes] = useState("");
  const [buyTarget, setBuyTarget] = useState<number>(0);
  const [sellTarget, setSellTarget] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addSymbol(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: sym,
          notes,
          targetBuyPrice: buyTarget > 0 ? buyTarget : null,
          targetSellPrice: sellTarget > 0 ? sellTarget : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error === "exists" ? "Already on the list." : body?.detail ?? "Failed.");
        return;
      }
      setSymbol("");
      setNotes("");
      setBuyTarget(0);
      setSellTarget(0);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(sym: string) {
    if (!confirm(`Remove ${sym} from watchlist?`)) return;
    await fetch(`/api/watchlist/${sym}`, { method: "DELETE" });
    router.refresh();
  }

  const columns: Column<Row>[] = [
    { key: "symbol", header: "Symbol", render: (r) => <span className="font-mono font-medium">{r.symbol}</span> },
    { key: "sector", header: "Sector", render: (r) => <span className="text-[12px] text-muted">{r.sector}</span> },
    { key: "price", header: "Price", align: "right", mono: true, render: (r) => fmtRs(r.currentPrice, true) },
    {
      key: "buyTarget",
      header: "Target Buy",
      align: "right",
      mono: true,
      render: (r) => {
        if (!r.targetBuyPrice) return "—";
        const hit = r.currentPrice > 0 && r.currentPrice <= r.targetBuyPrice;
        return (
          <div className="flex items-center justify-end gap-2">
            <span>{fmtRs(r.targetBuyPrice, true)}</span>
            {hit && <Badge tone="positive">HIT</Badge>}
          </div>
        );
      },
    },
    {
      key: "sellTarget",
      header: "Target Sell",
      align: "right",
      mono: true,
      render: (r) => {
        if (!r.targetSellPrice) return "—";
        const hit = r.currentPrice > 0 && r.currentPrice >= r.targetSellPrice;
        return (
          <div className="flex items-center justify-end gap-2">
            <span>{fmtRs(r.targetSellPrice, true)}</span>
            {hit && <Badge tone="amber">HIT</Badge>}
          </div>
        );
      },
    },
    {
      key: "gap",
      header: "Gap to Buy",
      align: "right",
      mono: true,
      render: (r) => {
        if (!r.targetBuyPrice || r.currentPrice <= 0) return "—";
        const gap = (r.currentPrice - r.targetBuyPrice) / r.targetBuyPrice;
        return (
          <span style={{ color: gap <= 0 ? "var(--positive)" : "var(--muted)" }}>
            {fmtSignedPct(gap, 1)}
          </span>
        );
      },
    },
    { key: "notes", header: "Notes", render: (r) => <span className="text-[12px] text-muted">{r.notes}</span> },
    {
      key: "remove",
      header: "",
      align: "right",
      render: (r) => (
        <button
          type="button"
          onClick={() => remove(r.symbol)}
          className="font-mono text-[10px] uppercase tracking-button hover:underline"
          style={{ color: "var(--negative)" }}
        >
          Remove
        </button>
      ),
    },
  ];

  return (
    <>
      <Section
        number="01"
        title="Add a ticker"
        display="Watch first. Buy later."
        description="Name + sector are scraped from PSX on add. Set optional target buy/sell prices to surface 'HIT' badges when the market gets there."
      >
        <Card>
          <form onSubmit={addSymbol} className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            <TextInput
              label="Symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. SYS, FCCL, ENGRO"
              hint="Will be scraped on add for name + sector."
            />
            <TextInput
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why this ticker?"
            />
            <NumberInput
              label="Target buy price (Rs)"
              value={buyTarget}
              onChange={setBuyTarget}
              min={0}
              step={0.01}
              hint="Optional. HIT badge when price ≤ this."
            />
            <NumberInput
              label="Target sell price (Rs)"
              value={sellTarget}
              onChange={setSellTarget}
              min={0}
              step={0.01}
              hint="Optional. HIT badge when price ≥ this."
            />
            <div className="md:col-span-2 flex items-center gap-3">
              <Button type="submit" variant="solid" disabled={submitting || !symbol.trim()}>
                {submitting ? "Adding…" : "Add to Watchlist"}
              </Button>
              {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
            </div>
          </form>
        </Card>
      </Section>

      <Section
        number="02"
        title={`Watching (${rows.length})`}
        display="Live prices, real targets."
      >
        <Table columns={columns} rows={rows} rowKey={(r) => r.symbol} empty="Nothing on the watchlist yet." />
      </Section>
    </>
  );
}
