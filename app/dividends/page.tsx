import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { DividendUploader } from "./DividendUploader";
import { PayoutBars } from "@/components/charts/PayoutBars";
import { getAllTransactions, getAllHoldings, checkDataAvailability, getDividendForecast } from "@/lib/data";
import { getYields } from "@/lib/analytics/dashboard";
import { fmtRs, fmtDate, fmtNum } from "@/lib/format";
import type { Transaction } from "@/lib/types";

export const dynamic = "force-dynamic";

// The Pakistan tax year runs July to June.
function taxYearOf(d: Date): string {
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}

export default async function DividendsPage() {
  const avail = await checkDataAvailability();
  const [allTx, holdings, yields, forecast] = await Promise.all([getAllTransactions(), getAllHoldings(), getYields().catch(() => null), getDividendForecast().catch(() => null)]);

  const dividends = allTx.filter((t) => t.type === "DIVIDEND");
  const bonuses = allTx.filter((t) => t.type === "BONUS");
  const grossTotal = dividends.reduce((s, t) => s + t.totalAmount, 0);
  const taxTotal = dividends.reduce((s, t) => s + (t.taxDeducted ?? 0), 0);
  const zakatTotal = dividends.reduce((s, t) => s + (t.zakatDeducted ?? 0), 0);
  const netTotal = dividends.reduce((s, t) => s + t.netAmount, 0);
  const thisYear = new Date().getFullYear();
  const ytdGross = dividends
    .filter((t) => new Date(t.date).getFullYear() === thisYear)
    .reduce((s, t) => s + t.totalAmount, 0);
  const cutoff = new Date(Date.now() - 365 * 86400000);
  const last12 = dividends.filter((t) => new Date(t.date) >= cutoff).reduce((s, t) => s + t.netAmount, 0);
  const fy = taxYearOf(new Date());
  const fyNet = dividends.filter((t) => taxYearOf(new Date(t.date)) === fy).reduce((s, t) => s + t.netAmount, 0);
  const fyTax = dividends.filter((t) => taxYearOf(new Date(t.date)) === fy).reduce((s, t) => s + (t.taxDeducted ?? 0), 0);
  // By month, net, for the bars: the last 24 months.
  const byMonth = new Map<string, number>();
  for (const t of dividends) {
    const k = new Date(t.date).toISOString().slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + t.netAmount);
  }
  const months: Array<{ month: string; amount: number }> = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const k = d.toISOString().slice(0, 7);
    months.push({ month: k, amount: byMonth.get(k) ?? 0 });
  }
  const byYear = new Map<string, { gross: number; tax: number; zakat: number; net: number; count: number }>();
  for (const t of dividends) {
    const k = taxYearOf(new Date(t.date));
    const r = byYear.get(k) ?? { gross: 0, tax: 0, zakat: 0, net: 0, count: 0 };
    r.gross += t.totalAmount; r.tax += t.taxDeducted ?? 0; r.zakat += t.zakatDeducted ?? 0; r.net += t.netAmount; r.count++;
    byYear.set(k, r);
  }
  const upcoming = (forecast?.events ?? []).filter((e) => new Date(e.date) >= new Date()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 12);

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
        eyebrow="Payouts"
        title="What the businesses paid you."
        subtitle="Every dividend and bonus, with the tax and zakat taken at source, what each name yields, and what the record says is coming."
      >
        <Link href="/forecast" className="text-[12px] link-underline">
          12-month forecast
        </Link>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Received, all time" value={fmtRs(netTotal)} size="lg" tone="positive" hint={`Gross ${fmtRs(grossTotal)} · ${dividends.length} warrants`} />
        <Stat label="Last 12 months" value={fmtRs(last12)} size="lg" hint={yields ? `${yields.portfolioYieldPct.toFixed(2)}% on today's value · ${yields.yieldOnCostPct.toFixed(2)}% on cost` : undefined} />
        <Stat label={`${fy}, net`} value={fmtRs(fyNet)} size="lg" hint={`Tax withheld ${fmtRs(fyTax)} this tax year`} />
        <Stat label="Tax withheld, all time" value={fmtRs(taxTotal)} size="lg" tone="muted" hint={`Zakat ${fmtRs(zakatTotal)}`} />
        <Stat label="Expected, next 12 months" value={forecast ? fmtRs(forecast.total12m) : "–"} size="lg" hint={forecast ? `From each name's own record; paid last 12m ${fmtRs(forecast.paidLast12m)}` : undefined} />
      </StatRow>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-6">
        <div className="xl:col-span-2">
          <Card title="Payouts by month" eyebrow="Net received, last 24 months">
            <PayoutBars months={months} />
          </Card>
        </div>
        <Card title="By tax year" eyebrow="July to June">
          <table className="table-zar">
            <thead>
              <tr><th>Year</th><th className="text-right">Gross</th><th className="text-right">Tax</th><th className="text-right">Net</th></tr>
            </thead>
            <tbody>
              {[...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, r]) => (
                <tr key={k}><td>{k}</td><td className="text-right font-mono mono-num">{fmtRs(r.gross)}</td><td className="text-right font-mono mono-num text-muted">{fmtRs(r.tax)}</td><td className="text-right font-mono mono-num" style={{ color: "var(--positive)" }}>{fmtRs(r.net)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {yields && yields.rows.length > 0 && (
        <Card className="mt-4" title="Yield by name" eyebrow="Last twelve months per share against today's price and your cost">
          <div className="overflow-x-auto">
            <table className="table-zar">
              <thead>
                <tr><th>Name</th><th className="text-right">Shares</th><th className="text-right">12m per share</th><th className="text-right">12m received</th><th className="text-right">Yield on price</th><th className="text-right">Yield on cost</th><th className="text-right">All time</th><th className="text-right">Last paid</th></tr>
              </thead>
              <tbody>
                {yields.rows.map((r) => (
                  <tr key={r.symbol}>
                    <td><Link href={`/holdings/${r.symbol}`} className="font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link> <span className="text-[11px] text-muted">{r.name}</span></td>
                    <td className="text-right font-mono mono-num">{r.shares.toLocaleString()}</td>
                    <td className="text-right font-mono mono-num">{r.ttmPerShare ? r.ttmPerShare.toFixed(2) : "–"}</td>
                    <td className="text-right font-mono mono-num">{r.ttmDividends ? fmtRs(r.ttmDividends) : "–"}</td>
                    <td className="text-right font-mono mono-num">{r.yieldOnPricePct ? `${r.yieldOnPricePct.toFixed(2)}%` : "–"}</td>
                    <td className="text-right font-mono mono-num">{r.yieldOnCostPct ? `${r.yieldOnCostPct.toFixed(2)}%` : "–"}</td>
                    <td className="text-right font-mono mono-num">{r.allTimeDividends ? fmtRs(r.allTimeDividends) : "–"}</td>
                    <td className="text-right text-muted">{r.lastPaid ? fmtDate(r.lastPaid) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card className="mt-4" title="Coming up" eyebrow="Expected from each name's own payout record; a forecast, not an announcement">
          <div className="overflow-x-auto">
            <table className="table-zar">
              <thead>
                <tr><th>Expected</th><th>Name</th><th className="text-right">Per share</th><th className="text-right">Shares</th><th className="text-right">Gross</th><th>Confidence</th></tr>
              </thead>
              <tbody>
                {upcoming.map((e, i) => (
                  <tr key={i}>
                    <td>{fmtDate(e.date)}</td>
                    <td><span className="font-medium">{e.symbol}</span> <span className="text-[11px] text-muted">{e.name}</span></td>
                    <td className="text-right font-mono mono-num">{e.expectedRatePerShare.toFixed(2)}</td>
                    <td className="text-right font-mono mono-num">{e.shares.toLocaleString()}</td>
                    <td className="text-right font-mono mono-num">{fmtRs(e.expectedGross)}</td>
                    <td><span className="pill" data-tone={e.confidence === "high" ? "positive" : "muted"}>{e.confidence}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {bonuses.length > 0 && (
        <Card className="mt-4" title="Bonus shares" eyebrow="Shares received without payment">
          <table className="table-zar">
            <thead><tr><th>Date</th><th>Name</th><th className="text-right">Shares</th><th>Notes</th></tr></thead>
            <tbody>
              {bonuses.slice(0, 20).map((t) => (
                <tr key={String(t._id)}><td>{fmtDate(t.date)}</td><td className="font-medium">{t.symbol}</td><td className="text-right font-mono mono-num">{fmtNum(t.shares)}</td><td className="text-muted">{t.notes}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

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
