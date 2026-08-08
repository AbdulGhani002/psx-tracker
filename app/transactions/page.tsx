import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Button } from "@/components/ui/Button";
import { TransactionsView } from "./TransactionsView";
import { getAllTransactions, getAllHoldings, getCorporateActionSuggestions, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const avail = await checkDataAvailability();
  const [transactions, holdings, corpActions] = await Promise.all([
    getAllTransactions(),
    getAllHoldings(),
    getCorporateActionSuggestions().catch(() => []),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Transactions"
        title="Everything that moved."
        subtitle="A complete audit trail of buys, sells, dividends, bonuses, rights, and splits."
      >
        <div className="flex gap-3">
          <Link href="/transactions/new">
            <Button variant="solid">Add Transaction</Button>
          </Link>
          <Link href="/transactions/import">
            <Button variant="outline">Import CSV</Button>
          </Link>
        </div>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      {corpActions.length > 0 && (
        <Section
          number="00"
          title="Corporate actions announced"
          display="Entitlements waiting to be recorded."
          description="Bonus and right issues announced on shares you hold, with no matching transaction recorded yet. The share math uses TODAY's holding — entitlement actually depends on what you held at book closure, so adjust if your position changed. Nothing is recorded until you say so."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {corpActions.map((c) => (
              <div key={`${c.symbol}-${c.type}-${c.bookClosure}`} className="border border-rule p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono font-medium">{c.symbol}</span>
                  <span className="font-mono text-[10px] uppercase tracking-stat" style={{ color: "var(--accent-deep)" }}>
                    {c.type === "BONUS" ? "Bonus issue" : "Right issue"} {c.pct}%{c.cycle ? ` · ${c.cycle}` : ""}
                  </span>
                </div>
                <p className="text-[13px] mt-2">
                  Book closure <span className="font-mono">{c.bookClosure}</span>. On your{" "}
                  <span className="font-mono mono-num">{c.heldShares.toLocaleString()}</span> shares that&apos;s{" "}
                  <span className="font-mono mono-num font-medium">{c.suggestedShares.toLocaleString()}</span> new shares
                  {c.type === "BONUS" ? " at zero cost" : " — subscription price is on the rights letter, enter it when you subscribe"}.
                </p>
                <div className="mt-3">
                  <Link
                    href={`/transactions/new?symbol=${c.symbol}&type=${c.type}&shares=${c.suggestedShares}&date=${c.bookClosure}`}
                    className="label-cap border px-2 py-1 hover:text-[var(--accent-deep)]"
                    style={{ borderColor: "var(--ink)" }}
                  >
                    Record it →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section number="01" title={`${transactions.length} records`}>
        <TransactionsView transactions={transactions} symbols={holdings.map((h) => h.symbol)} />
      </Section>
    </div>
  );
}
