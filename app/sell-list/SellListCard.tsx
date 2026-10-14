"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import type { SellListItem } from "@/lib/sell-list/data";
import { money, sharesToSell } from "@/lib/sell-list/levels";
import { SellListForm } from "./SellListForm";

// One share on the sell list: its last close, what you hold, each level
// reached or how far away, and changing or removing it.

const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function SellListCard({ item, held, shares }: { item: SellListItem; held: { shares: number; avgCost: number } | null; shares: Array<[string, string]> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const gain = held && held.avgCost > 0 && item.price != null ? (item.price / held.avgCost - 1) * 100 : null;

  async function remove() {
    if (!window.confirm(`Take ${item.symbol} off the sell list?`)) return;
    await fetch(`/api/sell-list/${item.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={held ? `/holdings/${item.symbol}` : `/stock/${item.symbol}`} className="text-[16px] font-bold hover:underline">{item.symbol}</Link>
          <div className="text-[12px] text-muted truncate">{held ? `${held.shares.toLocaleString("en-US")} held at ${money(held.avgCost)}` : "Not held"}</div>
        </div>
        <div className="text-right">
          <div className="mono-num text-[15px] font-semibold">{item.price != null ? money(item.price) : "—"}</div>
          <div className="text-[11px] text-muted">
            {gain != null && <span style={{ color: gain >= 0 ? "var(--positive)" : "var(--negative)" }}>{gain >= 0 ? "+" : "−"}{Math.abs(gain).toFixed(1)}% · </span>}
            {item.priceDate ? `close ${day(item.priceDate)}` : ""}
          </div>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-[var(--rule)] text-[12.5px]">
        {item.levels.map((l, k) => {
          const n = held ? sharesToSell(held.shares, l.sellPct) : null;
          return (
            <li key={k} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
              <span>
                <span className="font-semibold" style={{ color: l.kind === "stop" ? "var(--negative)" : "var(--positive)" }}>{l.kind === "stop" ? "Stop" : "Sell"}</span> <span className="mono-num">{money(l.price)}</span>
                {l.sellPct != null && <span className="text-muted"> · {l.sellPct}%{n != null ? ` = ${n.toLocaleString("en-US")}` : ""}</span>}
                {l.note && <span className="text-muted"> · {l.note}</span>}
              </span>
              {l.reachedAt ? (
                <span style={{ color: l.kind === "stop" ? "var(--negative)" : "var(--positive)" }}>Reached {day(l.reachedAt)}</span>
              ) : (
                <span className="text-muted mono-num">{l.toGo != null ? ((l.kind === "profit" ? l.toGo <= 0 : l.toGo >= 0) ? "there now" : `${Math.abs(l.toGo).toFixed(1)}% ${l.kind === "profit" ? "up" : "down"}`) : "—"}</span>
              )}
            </li>
          );
        })}
      </ul>
      {item.note && <p className="text-[12px] text-muted mt-2">{item.note}</p>}

      {editing ? (
        <div className="mt-3 pt-3 border-t border-rule">
          <SellListForm shares={shares} initial={{ symbol: item.symbol, note: item.note, levels: item.levels.map((l) => ({ price: l.price, kind: l.kind, sellPct: l.sellPct, note: l.note })) }} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div className="mt-3 flex gap-4 text-[12px]">
          <button type="button" className="link-underline" onClick={() => setEditing(true)}>Change</button>
          <button type="button" className="link-underline" style={{ color: "var(--negative)" }} onClick={remove}>Remove</button>
        </div>
      )}
    </Card>
  );
}
