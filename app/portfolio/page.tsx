import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { selectedPortfolio, listPortfolios } from "@/lib/portfolios";
import { HoldingTab } from "./tabs/HoldingTab";
import { AnalyticsTab } from "./tabs/AnalyticsTab";
import { QualityTab } from "./tabs/QualityTab";
import { TradesTab } from "./tabs/TradesTab";
import { PayoutsTab } from "./tabs/PayoutsTab";
import { CashTab } from "./tabs/CashTab";
import { CgtTab } from "./tabs/CgtTab";
import { RebalanceTab } from "./tabs/RebalanceTab";
import { SettingsTab } from "./tabs/SettingsTab";

export const dynamic = "force-dynamic";

// One portfolio (or all of them together), with the tabs Zar gives a
// portfolio: holding, analytics, quality, trade history, payouts, cash, CGT, zakat,
// rebalance and settings. Which portfolio is a cookie set by the switcher or
// the sidebar; every reader below already filters by it.

const TABS = [
  { key: "holding", label: "Holding" },
  { key: "analytics", label: "Analytics" },
  { key: "quality", label: "Quality" },
  { key: "trades", label: "Trade history" },
  { key: "payouts", label: "Payouts" },
  { key: "cash", label: "Cash" },
  { key: "cgt", label: "CGT" },
  { key: "rebalance", label: "Rebalance" },
  { key: "settings", label: "Settings" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export type PortfolioSearch = { tab?: string; view?: string; range?: string; fy?: string };

export default async function PortfolioPage(props: { searchParams: Promise<PortfolioSearch> }) {
  const searchParams = await props.searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === searchParams?.tab)?.key ?? "holding") as TabKey;
  const [selected, all] = await Promise.all([selectedPortfolio(), listPortfolios()]);
  const name = selected ? selected.name : "All portfolios";
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  const color = selected?.color ?? "var(--brand)";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3">
          <span className="initials text-[12px]" style={{ background: `color-mix(in srgb, ${color} 18%, white)`, color }}>{initials || "ALL"}</span>
          <div>
            <div className="text-[18px] font-semibold leading-tight">{name}</div>
            <div className="text-[11.5px] text-muted flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--positive)" }} /> Priced at the last close{selected?.broker ? ` · ${selected.broker}` : ""}{!selected && all.length > 1 ? ` · ${all.length} portfolios together` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/transactions/import" className="btn-ghost">Import</Link>
          <Link href="/transactions/new" className="btn-primary">Add trade</Link>
        </div>
      </div>

      <div className="tabs mb-4">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "holding" ? "/portfolio" : `/portfolio?tab=${t.key}`} data-active={tab === t.key}>
            {t.label}
          </Link>
        ))}
      </div>

      <Suspense fallback={<Skeleton className="w-full" style={{ height: 420, borderRadius: 10 }} />}>
        {tab === "holding" && <HoldingTab />}
        {tab === "analytics" && <AnalyticsTab search={searchParams} />}
        {tab === "quality" && <QualityTab />}
        {tab === "trades" && <TradesTab />}
        {tab === "payouts" && <PayoutsTab />}
        {tab === "cash" && <CashTab />}
        {tab === "cgt" && <CgtTab search={searchParams} />}
        {tab === "rebalance" && <RebalanceTab />}
        {tab === "settings" && <SettingsTab />}
      </Suspense>
    </div>
  );
}
