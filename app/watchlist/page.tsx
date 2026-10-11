import { PageHeader } from "@/components/layout/PageHeader";
import { getAllHoldings } from "@/lib/data";
import { listings, getWatchlist, sectorGroups } from "@/lib/watchlist";
import { SectorPicker } from "./SectorPicker";

export const dynamic = "force-dynamic";

// The exchange's sectors, to tick and save. The strategy page researches every
// share of a ticked sector.
export default async function WatchlistPage() {
  const [watch, holdings] = await Promise.all([getWatchlist(), getAllHoldings().catch(() => [])]);
  const held = new Set(holdings.filter((h: any) => (h.currentShares ?? 0) > 0).map((h: any) => h.symbol as string));
  return (
    <div>
      <PageHeader title="Watchlist" subtitle="Tick sectors. The strategy page researches every share in them." />
      <SectorPicker groups={sectorGroups(listings(), held)} initial={watch.sectors} />
    </div>
  );
}
