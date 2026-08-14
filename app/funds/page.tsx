import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { FundsManager } from "./FundsManager";
import { SavingsManager } from "./SavingsManager";
import { StatementCard } from "./StatementCard";
import {
  getMutualFundsValued,
  getSavingsValued,
  getEffectiveInflationPct,
  getAppSettings,
  checkDataAvailability,
} from "@/lib/data";
import { whtPct } from "@/lib/calculations/pk-tax";
import { CashPlans } from "./CashPlans";
import { fmtRs, fmtSignedRs } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FundsPage() {
  const avail = await checkDataAvailability();
  const [funds, savings, inf, settings] = await Promise.all([
    getMutualFundsValued(),
    getSavingsValued(),
    getEffectiveInflationPct(),
    getAppSettings(),
  ]);

  const fundValue = funds.reduce((s, f) => s + f.value, 0);
  const fundCost = funds.reduce((s, f) => s + f.cost, 0);
  const fundPL = fundValue - fundCost;
  const savingsValue = savings.reduce((s, a) => s + a.balance, 0);
  // Value-weighted published yield, so a big fund at 10% is not averaged flat
  // against a dust holding at 20%.
  const weightedYield =
    fundValue > 0 ? funds.reduce((s, f) => s + (f.annualYieldPct ?? 0) * f.value, 0) / fundValue : 0;
  const navAsOf = funds.map((f) => f.navAsOf).filter(Boolean).sort().slice(-1)[0];

  return (
    <div>
      <PageHeader
        eyebrow="Mutual funds & savings"
        title="What the funds hold, at today's NAV."
        subtitle="Your MCB iSave and Alhamra units, valued live from MUFAP. Upload an iSave statement and it reconciles itself against what is recorded here. Savings accounts accrue profit daily on their own."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Fund value" value={fmtRs(fundValue)} size="lg" />
        <Stat label="Cost" value={fmtRs(fundCost)} tone="muted" />
        <Stat label="Unrealised" value={fmtSignedRs(fundPL)} tone={fundPL >= 0 ? "positive" : "negative"} />
        <Stat label="Yield (weighted)" value={weightedYield > 0 ? weightedYield.toFixed(2) + "%" : "—"} tone="muted" />
        <Stat label="Savings" value={fmtRs(savingsValue)} />
        <Stat label="NAV as of" value={navAsOf ? String(navAsOf) : "live"} tone="muted" />
      </StatRow>

      <Section
        number="01"
        title="Mutual funds"
        display="Units you hold, valued at today's NAV."
        description="Search any Pakistani fund (MCB, Alhamra, etc.). The NAV is pulled live from MUFAP daily — you never type a price."
      >
        <FundsManager funds={funds} inflationPct={inf.pct} dividendWhtPct={whtPct("dividend", settings as any)} />
        <div className="mt-4">
          <StatementCard />
        </div>
      </Section>

      <Section
        number="02"
        title="Savings accounts"
        display="Profit that accrues while you sleep."
        description="For accounts like Bank Alfalah Alfa that calculate profit daily. Set the balance + rate once; the app compounds it forward automatically. Update the anchor when you get a statement; record deposits/withdrawals as they happen."
      >
        <SavingsManager accounts={savings} inflationPct={inf.pct} podWhtPct={whtPct("profit-on-debt", settings as any)} />
      </Section>

      <Section
        number="03"
        title="Cash discipline"
        display="Every rupee of parked cash carries a purpose and an expiry."
        description="Cash is a position, not the absence of one. Give each vehicle a job and a review date — past-due or purposeless cash shows up on the Decisions page with its inflation drag."
      >
        <CashPlans
          funds={funds.map((f) => ({ id: f._id, label: f.name, plan: (f as any).cashPlan ?? {} }))}
          savings={savings.map((a) => ({ id: a._id, label: a.name, plan: (a as any).cashPlan ?? {} }))}
          broker={{ purpose: (settings as any).brokerCashPurpose ?? "", reviewBy: (settings as any).brokerCashReviewBy ?? "", reviewReason: (settings as any).brokerCashReviewReason ?? "" }}
        />
      </Section>
    </div>
  );
}
