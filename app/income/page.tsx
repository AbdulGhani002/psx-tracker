import { PageHeader } from "@/components/layout/PageHeader";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { IncomePlanner } from "./IncomePlanner";
import { getPortfolioSummary, getDividendForecast, getNetWorth, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function IncomePage() {
  const avail = await checkDataAvailability();
  const [summary, forecast, netWorth] = await Promise.all([
    getPortfolioSummary(),
    getDividendForecast(),
    getNetWorth().catch(() => null),
  ]);

  // Anchor the growth assumption on YOUR actual money-weighted return (XIRR).
  const actualReturnPct = summary.xirr != null ? summary.xirr * 100 : null;
  const equityValue = summary.totalValue || 0;
  const totalNetWorth = (netWorth as any)?.total ?? equityValue;
  const forecastDividends12m = forecast.total12m || 0;

  return (
    <div>
      <PageHeader
        eyebrow="Planning"
        title="How much can you live on?"
        subtitle="A Pakistan-aware income planner. The global 4% rule is a real (inflation-adjusted) rule — in Pakistan, where inflation eats most of the nominal return, the honest safe rate is closer to 3%. Everything below is driven by your own portfolio's actual return."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}
      <IncomePlanner
        equityValue={equityValue}
        totalNetWorth={totalNetWorth}
        actualReturnPct={actualReturnPct}
        forecastDividends12m={forecastDividends12m}
      />
    </div>
  );
}
