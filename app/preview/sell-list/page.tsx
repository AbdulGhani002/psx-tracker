import { notFound } from "next/navigation";
import { SellListView } from "@/app/sell-list/SellListView";
import { listings } from "@/lib/listings";
import { advance, cleanLevels, toGoPct } from "@/lib/sell-list/levels";
import type { SellListItem } from "@/lib/sell-list/data";

// The sell list on made-up shares, moved on by the real level logic, for
// looking at the design on a machine with no database. Development only.
export const dynamic = "force-dynamic";

function item(symbol: string, name: string, price: number, levels: Array<{ price: number; kind: "profit" | "stop"; sellPct?: number; note?: string }>, days: Array<[string, number, number]>, note = ""): SellListItem {
  const r = advance(cleanLevels(levels, "2026-10-05"), days.map(([date, high, close]) => ({ date, high, close })));
  return { id: symbol, symbol, name, note, price, priceDate: "2026-10-13", levels: r.levels.map((l) => ({ ...l, toGo: toGoPct(price, l) })) };
}

export default function SellListPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const items = [
    item("MEBL", "Meezan Bank Limited", 560, [{ price: 600, kind: "profit", sellPct: 20, note: "first trim" }, { price: 700, kind: "profit", sellPct: 30 }, { price: 480, kind: "stop", sellPct: 100 }], [["2026-10-12", 566, 560]]),
    item("PTL", "Panther Tyres Limited", 49.1, [{ price: 52, kind: "profit", sellPct: 50 }, { price: 45, kind: "stop", sellPct: 100 }], [["2026-10-08", 52.6, 51.2], ["2026-10-09", 50.4, 49.1]]),
    item("MUREB", "Murree Brewery Company Limited", 724.1, [{ price: 1000, kind: "profit" }, { price: 750, kind: "stop", sellPct: 50, note: "under the 2025 lows" }], [["2026-10-09", 760, 740], ["2026-10-10", 741, 724.1]]),
  ];
  const held = { MEBL: { shares: 789, avgCost: 549.94 }, PTL: { shares: 248, avgCost: 50.45 }, MUREB: { shares: 662, avgCost: 946.65 } };
  return <SellListView items={items} asOf="2026-10-13" shares={listings().map((l) => [l.symbol, l.name] as [string, string])} held={held} />;
}
