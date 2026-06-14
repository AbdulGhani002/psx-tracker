import { PageHeader } from "@/components/layout/PageHeader";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { IncomePlanner } from "./IncomePlanner";
import { getPortfolioSummary, getDividendForecast, getNetWorth, getAppSettings, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function IncomePage() {
  const avail = await checkDataAvailability();
  const [summary, forecast, netWorth, settings] = await Promise.all([
    getPortfolioSummary(),
    getDividendForecast(),
    getNetWorth().catch(() => null),
    getAppSettings(),
  ]);
  const defaultTarget = (settings as any).targetMonthlyIncome || 200_000;

  // Your actual money-weighted return (XIRR) — but only trust it as the planning
  // assumption with enough history and a believable value. A few weeks of recent
  // gains annualizes to a meaningless number (e.g. 200%), so fall back to the
  // PSX long-run ~13% and tell the user why.
  const actualReturnPct = summary.xirr != null ? summary.xirr * 100 : null;
  const reliableReturn =
    actualReturnPct != null && summary.xirrSpanDays >= 365 && actualReturnPct >= -20 && actualReturnPct <= 40;
  const defaultReturnPct = reliableReturn ? Number(actualReturnPct!.toFixed(1)) : 13;
  const equityValue = summary.totalValue || 0;
  const totalNetWorth = (netWorth as any)?.total ?? equityValue;
  const forecastDividends12m = forecast.total12m || 0;

  return (
    <div>
      <PageHeader
        eyebrow="Planning"
        title="How much can you live on?"
        subtitle="A Pakistan-aware income planner. The global 4% rule is a real (inflation-adjusted) rule — in Pakistan, where inflation eats most of the nominal return, the honest safe rate is closer to 3%. Defaults use your own return where you have enough history, else the PSX long-run average."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}
      <IncomePlanner
        equityValue={equityValue}
        totalNetWorth={totalNetWorth}
        actualReturnPct={actualReturnPct}
        reliableReturn={reliableReturn}
        defaultReturnPct={defaultReturnPct}
        defaultTarget={defaultTarget}
        forecastDividends12m={forecastDividends12m}
      />
    </div>
  );
}
