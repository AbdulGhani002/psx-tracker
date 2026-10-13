import { getBuyList } from "@/lib/buy-list/data";
import { listings } from "@/lib/listings";
import { BuyListView } from "./BuyListView";

export const dynamic = "force-dynamic";

// The buy list (lib/buy-list): shares with the prices to buy them at, in tiers.
export default async function BuyListPage() {
  const { items, asOf } = await getBuyList();
  return <BuyListView items={items} asOf={asOf} shares={listings().map((l) => [l.symbol, l.name] as [string, string])} />;
}
