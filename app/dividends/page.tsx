import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { DividendUploader } from "./DividendUploader";
import {
  getAllTransactions,
  getAllHoldings,
  checkDataAvailability,
} from "@/lib/data";
import { fmtRs, fmtDate, fmtNum } from "@/lib/format";
import type { Transaction } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DividendsPage() {
  const avail = await checkDataAvailability();
  const [allTx, holdings] = await Promise.all([
    getAllTransactions(),
    getAllHoldings(),
  ]);

  const dividends = allTx.filter((t) => t.type === "DIVIDEND");
  const grossTotal = dividends.reduce((s, t) => s + t.totalAmount, 0);
  const taxTotal = dividends.reduce((s, t) => s + (t.taxDeducted ?? 0), 0);
  const zakatTotal = dividends.reduce((s, t) => s + (t.zakatDeducted ?? 0), 0);
  const netTotal = dividends.reduce((s, t) => s + t.netAmount, 0);
  const thisYear = new Date().getFullYear();
  const ytdGross = dividends
    .filter((t) => new Date(t.date).getFullYear() === thisYear)
    .reduce((s, t) => s + t.totalAmount, 0);

  const existingWarrants = new Set(
    dividends.map((t) => t.warrantNo).filter((w): w is string => !!w)
  );
  const existingSymbols = holdings.map((h) => ({ symbol: h.symbol, name: h.name }));

  const columns: Column<Transaction>[] = [
    {
      key: "date",
      header: "Payment Date",
      render: (t) => <span className="font-mono text-[12px]">{fmtDate(t.date)}</span>,
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (t) => (
        <Link href={`/holdings/${t.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
          {t.symbol}
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (t) => (
        <Badge tone="positive">{(t.dividendType || "Dividend").toUpperCase()}</Badge>
      ),
    },
    { key: "fy", header: "FY", render: (t) => <span className="font-mono text-[12px]">{t.financialYear ?? "—"}</span> },
    { key: "shares", header: "Shares", align: "right", mono: true, render: (t) => fmtNum(t.shares) },
    { key: "rate", header: "Rate/Share", align: "right", mono: true, render: (t) => fmtRs(t.pricePerShare, true) },
    { key: "gross", header: "Gross", align: "right", mono: true, render: (t) => fmtRs(t.totalAmount) },
    { key: "tax", header: "Tax", align: "right", mono: true, render: (t) => fmtRs(t.taxDeducted ?? 0) },
    { key: "zakat", header: "Zakat", align: "right", mono: true, render: (t) => fmtRs(t.zakatDeducted ?? 0) },
    {
      key: "net",
      header: "Net Paid",
      align: "right",
      mono: true,
      render: (t) => (
        <span style={{ color: "var(--positive)" }}>{fmtRs(t.netAmount)}</span>
      ),
    },
    {
      key: "warrant",
      header: "Warrant #",
      render: (t) => (
        <span className="font-mono text-[11px] text-muted">{t.warrantNo ?? "—"}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Dividends"
        title="What the businesses paid you."
        subtitle="Drop a CDC dividend warrant PDF below. We'll extract the warrant number, shares, rate, deductions, and net paid, and add it to the symbol's transaction history."
      />

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Total Received" value={fmtRs(netTotal)} tone="positive" />
        <Stat label="Gross" value={fmtRs(grossTotal)} />
        <Stat label="Tax Withheld" value={fmtRs(taxTotal)} tone="muted" />
        <Stat label="Zakat" value={fmtRs(zakatTotal)} tone="muted" />
        <Stat label={`${thisYear} (gross)`} value={fmtRs(ytdGross)} />
        <Stat label="Warrants" value={String(dividends.length)} tone="muted" />
      </StatRow>

      <Section
        number="01"
        title="Upload warrants"
        description="One or many PDFs at a time. Parsed fields appear below; pick the PSX symbol if we can't auto-match, then Import. Duplicate warrant numbers are skipped automatically."
      >
        <DividendUploader
          existingSymbols={existingSymbols}
          existingWarrantNumbers={Array.from(existingWarrants)}
        />
      </Section>

      <Section
        number="02"
        title={`Recorded dividends (${dividends.length})`}
        description="Every DIVIDEND transaction across all holdings, newest first."
      >
        <Table
          columns={columns}
          rows={dividends}
          rowKey={(t) => String(t._id)}
          empty="No dividends recorded yet."
        />
      </Section>
    </div>
  );
}
