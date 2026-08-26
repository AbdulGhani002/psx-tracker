import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Button } from "@/components/ui/Button";
import { getPortfolioSummary, checkDataAvailability, getSparklines } from "@/lib/data";
import { getPriceFreshness } from "@/lib/prices";
import { HoldingsTable, type HoldingRow } from "./HoldingsTable";

const STALE_AFTER_DAYS = 7;

export const dynamic = "force-dynamic";

export default async function HoldingsPage({
  searchParams,
}: {
  searchParams: { all?: string; added?: string; type?: string };
}) {
  const avail = await checkDataAvailability();
  const summary = await getPortfolioSummary();
  // getPortfolioSummary already refreshed anything refreshable, so this reads
  // pure snapshot age: a badge appears only when the scraper has been failing
  // for a week and the "current" price is really last week's.
  const freshness = await getPriceFreshness(summary.positions.map((p) => p.symbol));
  const showAll = searchParams?.all === "1";
  const added = searchParams?.added;
  const addedType = searchParams?.type;
  const active = summary.positions.filter((p) => p.shares > 0);
  const historical = summary.positions.filter((p) => p.shares <= 0);
  const rows = showAll ? summary.positions : active;

  const spark = await getSparklines(rows.map((r) => r.symbol));
  // Plain data across the boundary: the client sorts on numbers, so it must be
  // handed numbers rather than cells that have already been formatted.
  const tableRows: HoldingRow[] = rows.map((r) => {
    const f = freshness.get(r.symbol);
    return {
      symbol: r.symbol,
      name: r.name ?? "",
      sector: r.sector ?? "",
      shares: r.shares,
      avgCost: r.avgCost,
      price: r.currentPrice,
      priceKnown: r.priceKnown,
      marketValue: r.marketValue,
      unrealizedPL: r.unrealizedPL,
      unrealizedPct: r.unrealizedPct,
      dividendsReceived: r.dividendsReceived,
      totalCost: r.totalCost,
      currentPercent: r.currentPercent,
      targetPercent: r.targetPercent,
      deviation: r.deviation,
      staleDays: f ? f.ageDays : null,
      spark: spark[r.symbol] ?? [],
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Holdings"
        title="The positions you hold."
        subtitle="Click a row to inspect cost basis, dividends, and a forward projection."
      >
        <div className="flex gap-3">
          <Link href="/transactions/new">
            <Button variant="solid">Add Transaction</Button>
          </Link>
          <Link href="/transactions">
            <Button variant="outline">View All Transactions</Button>
          </Link>
        </div>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      {/* Totals exclude anything we couldn't price, so say so plainly. Silently
          showing an incomplete total as THE total is how a wrong number becomes
          a decision. */}
      {summary.unpricedSymbols.length > 0 && (
        <div className="border-l-[3px] p-3 mb-4 text-[13px]" style={{ borderColor: "var(--negative)", background: "var(--paper-2)" }}>
          <span className="font-medium">No price for {summary.unpricedSymbols.join(", ")}.</span>{" "}
          <span className="text-muted">
            Your market value, unrealised P/L and % weights below exclude {summary.unpricedSymbols.length === 1 ? "it" : "them"} —
            they are not counted as a loss, just as unknown. Try “Refresh prices”, or check the symbol is still listed on PSX.
          </span>
        </div>
      )}

      {added && (
        <div
          className="mb-6 flex items-center gap-3 border-l-[4px] px-4 py-3"
          style={{ borderColor: "var(--positive)", background: "var(--paper-2)" }}
        >
          <span aria-hidden style={{ color: "var(--positive)" }}>✓</span>
          <span className="text-[14px]">
            <span className="font-mono font-medium">{added}</span> {addedType ?? "transaction"} recorded.
            Its avg cost and P/L below have been updated.
          </span>
        </div>
      )}

      <Section
        number="01"
        title={`${rows.length} ${showAll ? "total" : "active"} positions`}
        action={
          historical.length > 0 ? (
            <Link
              href={showAll ? "/holdings" : "/holdings?all=1"}
              className="label-cap hover:text-[var(--accent-deep)]"
            >
              {showAll
                ? "Hide historical →"
                : `Show ${historical.length} historical →`}
            </Link>
          ) : undefined
        }
        description={
          historical.length > 0 && !showAll
            ? `${historical.length} symbol${historical.length > 1 ? "s" : ""} with no current shares (dividend-only history) hidden.`
            : undefined
        }
      >
        <HoldingsTable rows={tableRows} staleAfterDays={STALE_AFTER_DAYS} />
      </Section>
    </div>
  );
}
