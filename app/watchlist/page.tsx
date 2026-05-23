import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { WatchlistView } from "./WatchlistView";
import {
  getWatchlist,
  getCurrentPrices,
  checkDataAvailability,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const avail = await checkDataAvailability();
  const entries = await getWatchlist();
  const prices = await getCurrentPrices(entries.map((e) => e.symbol));
  const rows = entries.map((e) => ({
    ...e,
    currentPrice: prices.get(e.symbol) ?? 0,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Watchlist"
        title="What you're watching, not yet holding."
        subtitle="Track candidates without polluting your holdings. We scrape live prices and surface tickers that hit your target buy/sell."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}
      <WatchlistView rows={rows} />
    </div>
  );
}
