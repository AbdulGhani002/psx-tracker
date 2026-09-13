import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { FundsManager } from "@/app/funds/FundsManager";
import { SavingsManager } from "@/app/funds/SavingsManager";
import { StatementCard } from "@/app/funds/StatementCard";
import { CashForm } from "./CashForm";
import { getCashSummary, getCashEntries, getMutualFundsValued, getSavingsValued, getEffectiveInflationPct, getAppSettings } from "@/lib/data";
import { whtPct } from "@/lib/calculations/pk-tax";
import { fmtRs, fmtSignedRs, fmtDate } from "@/lib/format";

// Cash: the brokerage ledger the way Zar keeps it (deposits, withdrawals,
// the balance) and, under it, the money-market funds and savings accounts
// that are this portfolio's cash in all but name.
export async function CashTab() {
  const [cash, entries, funds, savings, inf, settings] = await Promise.all([getCashSummary(), getCashEntries(), getMutualFundsValued(), getSavingsValued(), getEffectiveInflationPct(), getAppSettings()]);
  const fundValue = funds.reduce((s, f) => s + f.value, 0);
  const fundCost = funds.reduce((s, f) => s + f.cost, 0);
  const savingsValue = savings.reduce((s, a) => s + a.balance, 0);
  const weightedYield = fundValue > 0 ? funds.reduce((s, f) => s + (f.annualYieldPct ?? 0) * f.value, 0) / fundValue : 0;
  const fundTrades = funds.flatMap((f) => (f.trades ?? []).map((t) => ({ ...t, fund: f.name }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label="Net deposits" value={fmtRs(cash.deposits - cash.withdrawals)} hint={cash.impliedDeposits > 0 ? `Plus ${fmtRs(cash.impliedDeposits)} the trades prove arrived` : undefined} />
        <StatCard label="Total deposits" value={fmtRs(cash.deposits)} />
        <StatCard label="Total withdrawals" value={fmtRs(cash.withdrawals)} />
        <StatCard label="Brokerage balance" value={fmtRs(cash.balance)} tone={cash.balance < 0 ? "negative" : undefined} hint={cash.cgtWithheld > 0 ? `${fmtRs(cash.cgtWithheld)} of it is CGT held back` : "Deposits and sale proceeds less buys and withdrawals"} />
      </div>

      <Card className="mt-3" title="Cash history" eyebrow={`${entries.length} entries`} action={<CashForm />}>
        {entries.length === 0 ? (
          <div className="text-[12px] text-muted">No deposits or withdrawals recorded. The balance above then comes from the trades alone.</div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead><tr><th>Date</th><th>Type</th><th className="text-right">Amount (PKR)</th><th>Description</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e._id}>
                    <td className="mono-num text-muted">{fmtDate(e.date)}</td>
                    <td><span className="pill" data-tone={e.type === "DEPOSIT" ? "positive" : "negative"}>{e.type === "DEPOSIT" ? "Deposit" : "Withdrawal"}</span></td>
                    <td className="text-right mono-num font-medium" style={{ color: e.type === "DEPOSIT" ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(e.type === "DEPOSIT" ? e.amount : -e.amount)}</td>
                    <td className="text-muted">{e.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cash.topUps.length > 0 && (
          <p className="text-[12px] text-muted mt-3 leading-relaxed">
            {cash.topUps.length} top-up{cash.topUps.length === 1 ? "" : "s"} the ledger never recorded but the trades prove arrived, {fmtRs(cash.impliedDeposits)} in all. Record them here to make the balance exact.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 stagger">
        <StatCard label="Money-market funds" value={fmtRs(fundValue)} hint={weightedYield > 0 ? `Published yield ${weightedYield.toFixed(2)}%` : undefined} />
        <StatCard label="Fund cost" value={fmtRs(fundCost)} />
        <StatCard label="Fund gain" value={fmtSignedRs(fundValue - fundCost)} tone={fundValue - fundCost >= 0 ? "positive" : "negative"} />
        <StatCard label="Savings" value={fmtRs(savingsValue)} />
      </div>

      <Card className="mt-3" title="Mutual funds" eyebrow="Units you hold, valued at today's NAV from MUFAP" action={<Link href="/transactions/new?asset=fund" className="btn-green !py-1.5 text-[12px]">+ Buy units</Link>}>
        <FundsManager funds={funds} inflationPct={inf.pct} dividendWhtPct={whtPct("dividend", settings as any)} />
        <div className="mt-4">
          <StatementCard />
        </div>
      </Card>

      {fundTrades.length > 0 && (
        <Card className="mt-3" title="Fund trades" eyebrow="Units bought and redeemed through the trade form">
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead><tr><th>Date</th><th>Fund</th><th>Side</th><th className="text-right">Units</th><th className="text-right">NAV</th><th className="text-right">Amount</th><th>Notes</th></tr></thead>
              <tbody>
                {fundTrades.map((t, i) => (
                  <tr key={i}>
                    <td className="mono-num text-muted">{fmtDate(t.date)}</td>
                    <td className="font-semibold">{t.fund}</td>
                    <td><span className="pill" data-tone={t.side === "BUY" ? "positive" : "negative"}>{t.side === "BUY" ? "Buy" : "Redeem"}</span></td>
                    <td className="text-right mono-num">{t.units.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="text-right mono-num">{t.nav.toFixed(4)}</td>
                    <td className="text-right mono-num">{fmtRs(t.amount)}</td>
                    <td className="text-muted">{t.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-3" title="Savings accounts" eyebrow="Profit accrues daily on the balance and rate you set">
        <SavingsManager accounts={savings} inflationPct={inf.pct} podWhtPct={whtPct("profit-on-debt", settings as any)} />
      </Card>
    </div>
  );
}
