import { notFound } from "next/navigation";
import { BuyListView } from "@/app/buy-list/BuyListView";
import { listings } from "@/lib/listings";
import { advance, awayPct, cleanTiers } from "@/lib/buy-list/zones";
import type { BuyListItem } from "@/lib/buy-list/data";

// The buy list on made-up shares, moved on by the real tier logic, for
// looking at the design on a machine with no database. Development only.
export const dynamic = "force-dynamic";

function item(symbol: string, name: string, price: number, tiers: Array<{ high: number; low?: number; note?: string }>, days: Array<[string, number, number]>, note = ""): BuyListItem {
  const r = advance(cleanTiers(tiers, "2026-10-05"), days.map(([date, low, close]) => ({ date, low, close })));
  const withAway = r.tiers.map((t) => ({ ...t, away: awayPct(price, t) }));
  const next = withAway.findIndex((t) => !t.reachedAt);
  return { id: symbol, symbol, name, note, price, priceDate: "2026-10-12", tiers: withAway, next: next >= 0 ? next : null };
}

export default function BuyListPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const items = [
    item("MEBL", "Meezan Bank Limited", 452.3, [{ high: 460, low: 440, note: "buy 100" }, { high: 420, low: 400, note: "buy 200" }, { high: 380 }], [["2026-10-08", 455.1, 461], ["2026-10-09", 449.5, 452.3]]),
    item("LUCK", "Lucky Cement Limited", 407.8, [{ high: 390 }, { high: 360 }], [["2026-10-09", 401, 407.8]], "Wait for the results"),
    item("BAHL", "Bank AL Habib Limited", 171.5, [{ high: 168, low: 160 }, { high: 150, low: 140 }], [["2026-10-07", 166.2, 170.1], ["2026-10-08", 159.4, 162], ["2026-10-09", 168, 171.5]]),
    item("HUBC", "The Hub Power Company Limited", 1_210, [{ high: 1_100 }, { high: 1_000 }, { high: 900 }], [["2026-10-09", 1_190, 1_210]]),
  ];
  const gap = (i: BuyListItem) => (i.next != null ? i.tiers[i.next].away ?? 999 : 1000);
  items.sort((a, b) => gap(a) - gap(b));
  return <BuyListView items={items} asOf="2026-10-12" shares={listings().map((l) => [l.symbol, l.name] as [string, string])} />;
}
