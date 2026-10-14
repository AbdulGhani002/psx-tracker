import { getSellList } from "@/lib/sell-list/data";
import { getPortfolioSummary } from "@/lib/data";
import { listings } from "@/lib/listings";
import { SellListView } from "./SellListView";

export const dynamic = "force-dynamic";

// The sell list (lib/sell-list): shares with the prices to sell them at and
// their stops. The shares you hold come first in the picker.
export default async function SellListPage() {
  const [{ items, asOf }, summary] = await Promise.all([getSellList(), getPortfolioSummary()]);
  const heldRows = summary.positions.filter((p) => p.shares > 0);
  const held = Object.fromEntries(heldRows.map((p) => [p.symbol, { shares: p.shares, avgCost: p.avgCost }]));
  const all = listings().map((l) => [l.symbol, l.name] as [string, string]);
  const mine = new Set(heldRows.map((p) => p.symbol));
  const shares = [...all.filter(([s]) => mine.has(s)), ...all.filter(([s]) => !mine.has(s))];
  return <SellListView items={items} asOf={asOf} shares={shares} held={held} />;
}
