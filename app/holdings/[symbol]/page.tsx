import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CompoundingModel } from "@/components/model/CompoundingModel";
import {
  getHoldingBySymbol,
  getTransactionsBySymbol,
  getCurrentPrices,
} from "@/lib/data";
import { deriveFromTransactions } from "@/lib/calculations";
import {
  fmtRs,
  fmtNum,
  fmtSignedRs,
  fmtSignedPct,
  fmtPct,
  fmtDate,
} from "@/lib/format";
import type { Transaction } from "@/lib/models";

export const dynamic = "force-dynamic";

type Props = { params: { symbol: string } };

export default async function HoldingDetail({ params }: Props) {
  const symbol = params.symbol.toUpperCase();
  const holding = await getHoldingBySymbol(symbol);
  if (!holding) notFound();

  const transactions = await getTransactionsBySymbol(symbol);
  const prices = await getCurrentPrices([symbol]);
  const currentPrice = prices.get(symbol) ?? 0;
  const derived = deriveFromTransactions(transactions);

  const marketValue = derived.shares * currentPrice;
  const unrealizedPL = marketValue - derived.totalCost;
  const unrealizedPct = derived.totalCost > 0 ? unrealizedPL / derived.totalCost : 0;
  const yieldOnCost = derived.totalCost > 0 ? derived.dividendsReceived / derived.totalCost : 0;

  const txColumns: Column<Transaction>[] = [
    { key: "date", header: "Date", render: (t) => <span className="font-mono text-[12px]">{fmtDate(t.date)}</span> },
    {
      key: "type",
      header: "Type",
      render: (t) => <Badge tone={t.type === "BUY" || t.type === "RIGHT" ? "accent" : t.type === "SELL" ? "negative" : "positive"}>{t.type}</Badge>,
    },
    { key: "shares", header: "Shares", align: "right", mono: true, render: (t) => fmtNum(Math.abs(t.shares)) },
    { key: "price", header: "Price", align: "right", mono: true, render: (t) => fmtRs(t.pricePerShare, true) },
    { key: "net", header: "Net Amount", align: "right", mono: true, render: (t) => fmtRs(t.netAmount) },
    { key: "notes", header: "Notes", render: (t) => <span className="text-[12px] text-muted">{t.notes}</span> },
  ];

  return (
    <div>
      <div className="mb-6">
        <Link href="/holdings" className="label-cap hover:text-[var(--accent-deep)]">
          ← Holdings
        </Link>
      </div>
      <PageHeader
        eyebrow={holding.sector}
        title={holding.name}
        subtitle={`${symbol}${holding.shariaCompliant ? " — Sharia compliant" : ""}`}
      >
        <div className="flex gap-3">
          <Link href={`/transactions/new?symbol=${symbol}`}>
            <Button variant="solid">Add Transaction</Button>
          </Link>
        </div>
      </PageHeader>

      <StatRow>
        <Stat label="Shares Held" value={fmtNum(derived.shares)} />
        <Stat label="Avg Cost" value={fmtRs(derived.avgCost, true)} />
        <Stat label="Current Price" value={fmtRs(currentPrice, true)} />
        <Stat label="Market Value" value={fmtRs(marketValue)} />
        <Stat
          label="Unrealised P/L"
          value={fmtSignedRs(unrealizedPL)}
          hint={fmtSignedPct(unrealizedPct)}
          tone={unrealizedPL >= 0 ? "positive" : "negative"}
        />
        <Stat label="Dividends" value={fmtRs(derived.dividendsReceived)} hint={`Yield on cost ${fmtPct(yieldOnCost, 2)}`} />
      </StatRow>

      <Section
        number="01"
        title="Transaction history"
        description="Every buy, sell, dividend, bonus, right, and split for this symbol."
      >
        <Table columns={txColumns} rows={transactions} rowKey={(t) => String(t._id)} empty="No transactions yet." />
      </Section>

      <Section
        number="02"
        title="Forward projection"
        description="A multi-scenario compounding model specific to this stock. Pick a preset or tune the sliders."
      >
        <CompoundingModel
          initialShares={derived.shares}
          currentPrice={currentPrice}
          symbol={symbol}
          totalCost={derived.totalCost}
        />
      </Section>
    </div>
  );
}
