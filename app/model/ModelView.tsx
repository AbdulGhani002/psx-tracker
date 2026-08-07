"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { CompoundingModel } from "@/components/model/CompoundingModel";
import { fmtRs, fmtPct } from "@/lib/format";
import type { PositionRow } from "@/lib/calculations";

type Props = {
  positions: PositionRow[];
  totalValue: number;
  totalCost: number;
  inflationPct: number | null;
};

export function ModelView({ positions, totalValue, totalCost, inflationPct }: Props) {
  const [mode, setMode] = useState<"per-holding" | "portfolio">("per-holding");
  const [symbol, setSymbol] = useState<string>(positions[0]?.symbol ?? "");

  const selected = positions.find((p) => p.symbol === symbol);

  return (
    <div className="space-y-6">
      <Tabs
        tabs={[
          { value: "per-holding", label: "Per holding" },
          { value: "portfolio", label: "Whole portfolio" },
        ]}
        value={mode}
        onChange={(v) => setMode(v as typeof mode)}
      />

      {mode === "per-holding" ? (
        positions.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Add holdings and transactions before modelling per-stock outcomes.
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Select
                label="Pick a holding"
                value={symbol}
                onChange={setSymbol}
                options={positions.map((p) => ({ value: p.symbol, label: `${p.symbol} — ${p.sector}` }))}
              />
              {selected && (
                <>
                  <div>
                    <div className="label-cap">Current shares</div>
                    <div className="font-display mono-num text-[20px]" style={{ fontVariationSettings: "'opsz' 144" }}>
                      {selected.shares.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="label-cap">Market value</div>
                    <div className="font-display mono-num text-[20px]" style={{ fontVariationSettings: "'opsz' 144" }}>
                      {fmtRs(selected.marketValue)}
                    </div>
                  </div>
                </>
              )}
            </div>

            {selected && (
              <CompoundingModel
                inflationPct={inflationPct}
                initialShares={selected.shares}
                currentPrice={selected.currentPrice}
                symbol={selected.symbol}
                totalCost={selected.totalCost}
              />
            )}
          </div>
        )
      ) : positions.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No positions to roll up yet.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <div className="label-cap mb-2">Portfolio rollup</div>
            <p className="text-sm leading-relaxed">
              Each holding is modelled with the same assumptions you set below, then summed. To use
              per-stock assumptions, switch to the Per-holding tab — those scenarios are saved
              independently. Blended outcome assumes a single fleet-wide growth and ending P/E.
            </p>
          </Card>
          <CompoundingModel
            inflationPct={inflationPct}
            initialShares={1}
            currentPrice={totalValue}
            totalCost={totalCost}
            symbol="Portfolio"
          />
          <Card>
            <div className="label-cap mb-3">Per-holding contribution</div>
            <ul className="space-y-2 text-sm">
              {positions.map((p) => (
                <li key={p.symbol} className="flex justify-between border-b border-rule pb-1.5">
                  <span className="font-mono">{p.symbol}</span>
                  <span className="text-muted">{p.sector}</span>
                  <span className="font-mono mono-num">{fmtPct(p.currentPercent / 100)}</span>
                  <span className="font-mono mono-num">{fmtRs(p.marketValue)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
