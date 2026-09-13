import Link from "next/link";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { SbpRatesManager } from "./SbpRatesManager";
import { AppSettingsManager } from "./AppSettingsManager";
import { BackupManager } from "./BackupManager";
import { PortfoliosManager } from "./PortfoliosManager";
import { listPortfolios } from "@/lib/portfolios";
import { Card } from "@/components/ui/Card";
import { getSbpRates, getAppSettings, checkDataAvailability } from "@/lib/data";
import { SBP_POLICY_RATE_DEFAULTS } from "@/lib/timeseries/sbp-rate";
import { APP_VERSION, BUILD_DATE, BUILD_SHA } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const avail = await checkDataAvailability();
  const [rates, appSettings, portfolios] = await Promise.all([getSbpRates(), getAppSettings(), listPortfolios().catch(() => [])]);
  const usingDefaults = rates.length === 0;
  const defaults = SBP_POLICY_RATE_DEFAULTS.map((s) => ({ effectiveDate: s.from, rate: s.rate }));

  return (
    <div className="space-y-3">
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <Card title="Portfolios" eyebrow="One account, several books" action={<Link href="/portfolios" className="text-[12px] link-underline">See all</Link>}>
        <p className="text-[12.5px] text-muted mb-3">Keep a broker account, a family member&apos;s money or a trading book apart. The switcher in the top bar shows one of them or all together.</p>
        <PortfoliosManager initial={portfolios} />
      </Card>

      <Card title="Tax and trading" eyebrow="Filer status, tax rates, brokerage">
        <p className="text-[12.5px] text-muted mb-3">These feed the CGT tab, the rebalance concentration cap and the trade form&apos;s fee estimate. Check rates against the current FBR schedule and your broker.</p>
        <AppSettingsManager initial={{ ...appSettings, telegramBotToken: "" }} telegramConfigured={!!appSettings.telegramBotToken} />
      </Card>

      <Card title="SBP policy rate" eyebrow="The risk-free line">
        <p className="text-[12.5px] text-muted mb-3">The risk-free benchmark compounds the SBP policy rate. Add the new rate when the MPC changes it; the benchmark updates on its own. Source: sbp.org.pk/m_policy.</p>
        <SbpRatesManager initialRates={rates} usingDefaults={usingDefaults} defaults={defaults} />
      </Card>

      <Card title="Data and backup" eyebrow="Export everything, restore any time">
        <p className="text-[12.5px] text-muted mb-3">Download a full JSON snapshot of your data, or restore from one.</p>
        <BackupManager />
      </Card>

      <Card title="Build" eyebrow="What you are running" action={<Link href="/changelog" className="text-[12px] link-underline">Changelog</Link>}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div><div className="label-cap">Version</div><div className="mono-num text-[15px] font-medium mt-1">v{APP_VERSION}</div></div>
          <div><div className="label-cap">Build date</div><div className="mono-num text-[15px] font-medium mt-1">{BUILD_DATE || "–"}</div></div>
          <div><div className="label-cap">Commit</div><div className="mono-num text-[15px] font-medium mt-1">{BUILD_SHA || "–"}</div></div>
        </div>
      </Card>
    </div>
  );
}
