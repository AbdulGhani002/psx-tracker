import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { FundsManager } from "./FundsManager";
import { SavingsManager } from "./SavingsManager";
import {
  getNetWorth,
  getMutualFundsValued,
  getSavingsValued,
  checkDataAvailability,
} from "@/lib/data";
import { fmtRs, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const avail = await checkDataAvailability();
  const [netWorth, funds, savings] = await Promise.all([
    getNetWorth(),
    getMutualFundsValued(),
    getSavingsValued(),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Assets"
        title="Everything you own, in one place."
        subtitle="PSX equities, mutual funds (live NAV from MUFAP), and profit-bearing savings — combined into your net worth. Fund NAVs and the savings accrual update automatically; you only enter what you bought."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Net Worth" value={fmtRs(netWorth.total)} size="lg" />
        <Stat label="PSX Equities" value={fmtRs(netWorth.equity)} />
        <Stat label="Mutual Funds" value={fmtRs(netWorth.funds)} />
        <Stat label="Savings" value={fmtRs(netWorth.savings)} />
        <Stat label="Cash" value={fmtRs(netWorth.cash)} />
        <Stat
          label="Allocation"
          value={netWorth.total > 0 ? fmtPct(netWorth.equity / netWorth.total, 0) + " eq" : "—"}
          tone="muted"
        />
      </StatRow>

      <Section
        number="01"
        title="Mutual funds"
        display="Units you hold, valued at today's NAV."
        description="Search any Pakistani fund (MCB, Alhamra, etc.). The NAV is pulled live from MUFAP daily — you never type a price."
      >
        <FundsManager funds={funds} />
      </Section>

      <Section
        number="02"
        title="Savings accounts"
        display="Profit that accrues while you sleep."
        description="For accounts like Bank Alfalah Alfa that calculate profit daily. Set the balance + rate once; the app compounds it forward automatically. Update the anchor when you get a statement; record deposits/withdrawals as they happen."
      >
        <SavingsManager accounts={savings} />
      </Section>
    </div>
  );
}
