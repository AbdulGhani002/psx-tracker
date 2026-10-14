import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { getAllTransactions } from "@/lib/data";
import { ExportForm } from "./ExportForm";

export const dynamic = "force-dynamic";

// Downloading trades and dividends (lib/export/records.ts) for a period or
// all time, as a CSV or a PDF, for the portfolio chosen at the top.
export default async function ExportPage() {
  const txs = await getAllTransactions();
  const symbols = [...new Set(txs.filter((t) => t.type === "BUY" || t.type === "SELL" || t.type === "DIVIDEND").map((t) => t.symbol))].sort();
  return (
    <div className="fade-in">
      <PageHeader title="Export" subtitle="Your trades and dividends for any period, as a CSV or a PDF." />
      <Card>
        <ExportForm symbols={symbols} />
      </Card>
    </div>
  );
}
