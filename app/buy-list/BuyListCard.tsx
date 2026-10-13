"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import type { BuyListItem } from "@/lib/buy-list/data";
import { money, zoneText } from "@/lib/buy-list/zones";
import { BuyListForm } from "./BuyListForm";

// One share on the buy list: its last close, each tier reached or how far
// away, and changing or removing it.

const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function BuyListCard({ item, shares }: { item: BuyListItem; shares: Array<[string, string]> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const next = item.next != null ? item.tiers[item.next] : null;

  async function remove() {
    if (!window.confirm(`Take ${item.symbol} off the buy list?`)) return;
    await fetch(`/api/buy-list/${item.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/stock/${item.symbol}`} className="text-[16px] font-bold hover:underline">{item.symbol}</Link>
          <div className="text-[12px] text-muted truncate">{item.name}</div>
        </div>
        <div className="text-right">
          <div className="mono-num text-[15px] font-semibold">{item.price != null ? money(item.price) : "—"}</div>
          {item.priceDate && <div className="text-[11px] text-muted">close {day(item.priceDate)}</div>}
        </div>
      </div>

      <div className="mt-2 text-[13px]">
        {next ? (
          next.away != null && next.away <= 0 ? (
            <span className="pill" data-tone="positive">In tier {item.next! + 1}</span>
          ) : (
            <span>
              Tier {item.next! + 1} at <span className="mono-num font-semibold">{money(next.high)}</span>
              {next.away != null && <span className="text-muted">: {next.away.toFixed(1)}% away</span>}
            </span>
          )
        ) : (
          <span className="pill" data-tone="positive">Every tier reached</span>
        )}
      </div>

      <ul className="mt-3 divide-y divide-[var(--rule)] text-[12.5px]">
        {item.tiers.map((t, k) => (
          <li key={k} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
            <span>
              <span className="font-semibold">{k + 1}</span> <span className="mono-num">{zoneText(t)}</span>
              {t.note && <span className="text-muted"> · {t.note}</span>}
            </span>
            {t.reachedAt ? (
              <span style={{ color: "var(--positive)" }}>Reached {day(t.reachedAt)}{t.reachedLow != null ? ` (low ${money(t.reachedLow)})` : ""}</span>
            ) : (
              <span className="text-muted mono-num">{t.away != null ? (t.away <= 0 ? "there now" : `${t.away.toFixed(1)}% away`) : "—"}</span>
            )}
          </li>
        ))}
      </ul>
      {item.note && <p className="text-[12px] text-muted mt-2">{item.note}</p>}

      {editing ? (
        <div className="mt-3 pt-3 border-t border-rule">
          <BuyListForm shares={shares} initial={{ symbol: item.symbol, note: item.note, tiers: item.tiers.map((t) => ({ high: t.high, low: t.low, note: t.note })) }} onDone={() => setEditing(false)} />
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
