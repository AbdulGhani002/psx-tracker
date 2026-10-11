import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { listings, sectorGroups } from "@/lib/watchlist";
import { SectorPicker } from "@/app/watchlist/SectorPicker";

// The watchlist page on the real sector list with one sector saved, for
// looking at the design on a machine with no database. Development only.
export const dynamic = "force-dynamic";

export default async function WatchlistPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  return (
    <div>
      <PageHeader title="Watchlist" subtitle="Tick sectors. The strategy page researches every share in them." />
      <SectorPicker groups={sectorGroups(listings(), new Set(["MEBL", "HUBC", "MARI"]))} initial={["COMMERCIAL BANKS"]} />
    </div>
  );
}
