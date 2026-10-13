import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import type { BuyListItem } from "@/lib/buy-list/data";
import { BuyListForm } from "./BuyListForm";
import { BuyListCard } from "./BuyListCard";

// The buy list's page body (the preview page draws it on sample shares).
export function BuyListView({ items, asOf, shares }: { items: BuyListItem[]; asOf: string | null; shares: Array<[string, string]> }) {
  return (
    <div className="fade-in">
      <PageHeader title="Buy list" subtitle="Shares at the prices you'd buy them. Telegram tells you after the close when one gets there." />

      <Card title="Add a share">
        <BuyListForm shares={shares} />
      </Card>

      {items.length === 0 ? (
        <Card className="mt-3">
          <p className="text-[13px] text-muted">Nothing yet. Add a share and the prices you&apos;d buy at.</p>
        </Card>
      ) : (
        <>
          <div className="text-[12px] text-muted mt-4 mb-2">{items.length} share{items.length === 1 ? "" : "s"}{asOf ? `, closes of ${asOf}` : ""}, nearest its next tier first</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {items.map((i) => <BuyListCard key={i.id} item={i} shares={shares} />)}
          </div>
        </>
      )}

      <details className="mt-4 text-[12.5px] text-muted">
        <summary className="cursor-pointer select-none">How it works</summary>
        <ul className="mt-2 space-y-1 pl-4 list-disc">
          <li>A tier is reached when a day&apos;s lowest price gets to its top price, on or after the day you saved it.</li>
          <li>Prices come from the exchange&apos;s closing file, so Telegram tells you in the evening, not during the day.</li>
          <li>Each tier is told once. It counts again after the share closes 5% above it, or when you change the share.</li>
        </ul>
      </details>
    </div>
  );
}
