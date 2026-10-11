import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { listings } from "@/lib/watchlist";
import { WatchlistPicker, type PickGroup } from "@/app/watchlist/WatchlistPicker";

// The watchlist page on the real share list with nothing saved, for looking
// at the design on a machine with no database. Development only.
export const dynamic = "force-dynamic";

export default async function WatchlistPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const bySector = new Map<string, PickGroup>();
  for (const l of listings()) {
    const g = bySector.get(l.sector) ?? { key: l.sector, name: l.sectorName, rows: [] };
    g.rows.push({ symbol: l.symbol, name: l.name, price: null, pe: null, grade: null, held: ["MEBL", "HUBC", "MARI"].includes(l.symbol) });
    bySector.set(l.sector, g);
  }
  const groups = [...bySector.values()].sort((a, b) => (a.key === "OTHER" ? 1 : b.key === "OTHER" ? -1 : a.name.localeCompare(b.name)));
  return (
    <div>
      <PageHeader title="Watchlist" subtitle="Tick the shares and sectors you would buy. The strategy page works out when." />
      <WatchlistPicker groups={groups} initial={{ symbols: ["MEBL", "OGDC"], sectors: ["COMMERCIAL BANKS"] }} />
    </div>
  );
}
