import { Card } from "@/components/ui/Card";
import { PortfoliosManager } from "@/app/settings/PortfoliosManager";
import { listPortfolios, selectedPortfolio } from "@/lib/portfolios";

// This portfolio's own settings: its name, broker, colour and kind. The
// account-wide settings (tax status, alerts, backup) live under Settings.
export async function SettingsTab() {
  const [all, selected] = await Promise.all([listPortfolios(), selectedPortfolio()]);
  return (
    <div>
      <Card title={selected ? `${selected.name} settings` : "Portfolios"} eyebrow={selected ? "Name, broker, colour and kind" : "Pick a portfolio in the switcher to edit one; all of them are listed here"}>
        <PortfoliosManager initial={all} only={selected?._id} />
      </Card>
      <p className="text-[12px] text-muted mt-3">Account-wide settings, tax status, alerts and backups are under <a href="/settings" className="link-underline">Settings</a>.</p>
    </div>
  );
}
