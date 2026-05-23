import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { CashForm } from "./CashForm";
import {
  getCashSummary,
  getCashEntries,
  checkDataAvailability,
} from "@/lib/data";
import { fmtRs, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Entry = {
  _id: string;
  date: string;
  type: "DEPOSIT" | "WITHDRAWAL";
  amount: number;
  notes: string;
};

export default async function CashPage() {
  const avail = await checkDataAvailability();
  const [summary, entries] = await Promise.all([
    getCashSummary(),
    getCashEntries(),
  ]);

  const columns: Column<Entry>[] = [
    { key: "date", header: "Date", render: (e) => <span className="font-mono text-[12px]">{fmtDate(e.date)}</span> },
    {
      key: "type",
      header: "Type",
      render: (e) => (
        <Badge tone={e.type === "DEPOSIT" ? "positive" : "negative"}>{e.type}</Badge>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      mono: true,
      render: (e) => (
        <span style={{ color: e.type === "DEPOSIT" ? "var(--positive)" : "var(--negative)" }}>
          {e.type === "DEPOSIT" ? "+" : "−"}{fmtRs(e.amount)}
        </span>
      ),
    },
    { key: "notes", header: "Notes", render: (e) => <span className="text-[12px] text-muted">{e.notes}</span> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Cash"
        title="What's left in the brokerage account."
        subtitle="Balance is implied: deposits + sells + dividends − buys − rights − withdrawals. Record deposits and withdrawals here; share transactions and dividend imports adjust the balance automatically."
      />

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat
          label="Available Balance"
          value={fmtRs(summary.balance)}
          tone={summary.balance >= 0 ? "positive" : "negative"}
          size="lg"
        />
        <Stat label="Deposits" value={fmtRs(summary.deposits)} />
        <Stat label="Withdrawals" value={fmtRs(summary.withdrawals)} />
        <Stat label="Dividends In" value={fmtRs(summary.dividendsCollected)} tone="positive" />
        <Stat label="Sells In" value={fmtRs(summary.proceedsFromSells)} tone="positive" />
        <Stat label="Buys Out" value={fmtRs(summary.spentOnBuys)} tone="negative" />
      </StatRow>

      <Section
        number="01"
        title="Record movement"
        display="Deposit or withdraw."
        description="Only record cash you moved in or out of the brokerage account. Share buys/sells and dividend payments adjust the balance automatically."
      >
        <CashForm />
      </Section>

      <Section
        number="02"
        title={`Manual entries (${entries.length})`}
        display="Audit log."
        description="Only the manual deposit/withdrawal moves. Buys, sells, and dividends are shown on their respective pages."
      >
        <Table columns={columns} rows={entries as Entry[]} rowKey={(e) => e._id} empty="No manual deposits or withdrawals yet." />
      </Section>
    </div>
  );
}
