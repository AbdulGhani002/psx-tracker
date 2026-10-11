import { PageHeader } from "@/components/layout/PageHeader";
import { getAllHoldings } from "@/lib/data";
import { getQualityBoard } from "@/lib/fundamentals/board";
import { latestCloses } from "@/lib/quant/sheet-bars";
import { listings, getWatchlist } from "@/lib/watchlist";
import { WatchlistPicker, type PickGroup } from "./WatchlistPicker";

export const dynamic = "force-dynamic";

// Every share the exchange lists, by sector, to tick. Each tick is saved as it
// is made; the strategy page reads the ticked shares and sectors.
export default async function WatchlistPage() {
  const [watch, holdings, board, closes] = await Promise.all([
    getWatchlist(),
    getAllHoldings().catch(() => []),
    getQualityBoard().catch(() => null),
    latestCloses().catch(() => new Map<string, { date: string; close: number }>()),
  ]);
  const held = new Set(holdings.filter((h: any) => (h.currentShares ?? 0) > 0).map((h: any) => h.symbol as string));
  const quality = new Map((board?.rows ?? []).map((r) => [r.symbol, r]));

  const bySector = new Map<string, PickGroup>();
  for (const l of listings()) {
    const g = bySector.get(l.sector) ?? { key: l.sector, name: l.sectorName, rows: [] };
    const q = quality.get(l.symbol);
    g.rows.push({
      symbol: l.symbol,
      name: l.name,
      price: q?.price ?? closes.get(l.symbol)?.close ?? null,
      pe: q?.q.pe ?? null,
      grade: q?.q.grade ?? null,
      held: held.has(l.symbol),
    });
    bySector.set(l.sector, g);
  }
  const groups = [...bySector.values()]
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => a.symbol.localeCompare(b.symbol)) }))
    .sort((a, b) => (a.key === "OTHER" ? 1 : b.key === "OTHER" ? -1 : a.name.localeCompare(b.name)));

  return (
    <div>
      <PageHeader title="Watchlist" subtitle="Tick the shares and sectors you would buy. The strategy page works out when." />
      <WatchlistPicker groups={groups} initial={watch} />
    </div>
  );
}
