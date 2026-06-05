import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { SbpRatesManager } from "./SbpRatesManager";
import { AppSettingsManager } from "./AppSettingsManager";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Card } from "@/components/ui/Card";
import { getSbpRates, getAppSettings, checkDataAvailability } from "@/lib/data";
import { SBP_POLICY_RATE_DEFAULTS } from "@/lib/timeseries/sbp-rate";
import { APP_VERSION, BUILD_DATE, BUILD_SHA } from "@/lib/version";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const avail = await checkDataAvailability();
  const [rates, appSettings] = await Promise.all([getSbpRates(), getAppSettings()]);
  const usingDefaults = rates.length === 0;
  const defaults = SBP_POLICY_RATE_DEFAULTS.map((s) => ({
    effectiveDate: s.from,
    rate: s.rate,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Knobs you control."
        subtitle="Reference rates and app configuration. Changes here flow into the dashboard benchmark and projections."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <Section number="01" title="Appearance" display="Light or dark.">
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-[14px] text-muted">Toggle the theme. Charts and panels follow.</p>
            <ThemeToggle />
          </div>
        </Card>
      </Section>

      <Section
        number="02"
        title="Tax & trading config"
        display="Your filer status, tax rates, PMEX costs."
        description="These feed the tax report, the rebalance concentration cap, and PMEX P/L. Verify rates against the current FBR / your broker schedule."
      >
        <AppSettingsManager initial={appSettings} />
      </Section>

      <Section
        number="03"
        title="SBP policy rate"
        display="The risk-free line, your numbers."
        description="The dashboard's risk-free benchmark compounds the SBP policy rate. SBP changes it at MPC meetings (~every 6 weeks). Add the new rate here each time it changes — the benchmark updates automatically. Source: sbp.org.pk/m_policy."
      >
        <SbpRatesManager
          initialRates={rates}
          usingDefaults={usingDefaults}
          defaults={defaults}
        />
      </Section>

      <Section number="04" title="Build" display="What you're running.">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <div className="label-cap">Version</div>
            <div className="font-mono mono-num text-[16px] mt-1">v{APP_VERSION}</div>
          </div>
          <div>
            <div className="label-cap">Build date</div>
            <div className="font-mono mono-num text-[16px] mt-1">{BUILD_DATE || "—"}</div>
          </div>
          <div>
            <div className="label-cap">Commit</div>
            <div className="font-mono mono-num text-[16px] mt-1">{BUILD_SHA || "—"}</div>
          </div>
        </div>
      </Section>
    </div>
  );
}
