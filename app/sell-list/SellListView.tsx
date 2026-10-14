import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import type { SellListItem } from "@/lib/sell-list/data";
import { SellListForm } from "./SellListForm";
import { SellListCard } from "./SellListCard";

// The sell list's page body (the preview page draws it on sample shares).
export function SellListView({ items, asOf, shares, held }: { items: SellListItem[]; asOf: string | null; shares: Array<[string, string]>; held: Record<string, { shares: number; avgCost: number }> }) {
  return (
    <div className="fade-in">
      <PageHeader title="Sell list" subtitle="Prices to take profit at and stops. Telegram tells you after the close when one gets there." />

      <Card title="Add a share">
        <SellListForm shares={shares} />
      </Card>

      {items.length === 0 ? (
        <Card className="mt-3">
          <p className="text-[13px] text-muted">Nothing yet. Add a share you hold, a price to sell at and a stop.</p>
        </Card>
      ) : (
        <>
          <div className="text-[12px] text-muted mt-4 mb-2">{items.length} share{items.length === 1 ? "" : "s"}{asOf ? `, closes of ${asOf}` : ""}, nearest a level first</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {items.map((i) => <SellListCard key={i.id} item={i} held={held[i.symbol] ?? null} shares={shares} />)}
          </div>
        </>
      )}

      <details className="mt-4 text-[12.5px] text-muted">
        <summary className="cursor-pointer select-none">How it works</summary>
        <ul className="mt-2 space-y-1 pl-4 list-disc">
          <li>A sell price is reached when a day&apos;s highest price gets to it; a stop when a day closes at or under it. Both count from the day you save them.</li>
          <li>Prices come from the exchange&apos;s closing file, so Telegram tells you in the evening, with the shares to sell at the % you set.</li>
          <li>Each level is told once. It counts again after the share closes 5% back the other way, or when you change the share.</li>
        </ul>
      </details>
    </div>
  );
}
