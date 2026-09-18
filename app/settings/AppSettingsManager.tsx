"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Toggle } from "@/components/ui/Toggle";

type Settings = {
  filerStatus: string;
  dividendWhtFiler: number;
  dividendWhtNonFiler: number;
  cgtRateFiler: number;
  cgtRateNonFiler: number;
  brokeragePct?: number;
  podWhtFiler: number;
  podWhtNonFiler: number;
  pmexCommissionPerLot: number;
  pmexCgtPercent: number;
  concentrationCap: number;
  mfCashReservePct: number;
  inflationPct: number;
  equityRiskPremiumPct: number;
  defaultFairPE: number;
  targetMonthlyIncome: number;
  telegramBotToken: string;
  telegramChatId: string;
  alertsEnabled: boolean;
  autoDividends: boolean;
  autoBonus: boolean;
  zakatOnDividends: string;
  bonusTaxWithheld: boolean;
  bonusTaxFiler: number;
  bonusTaxNonFiler: number;
  announceTelegram?: boolean;
  announceEmail?: boolean;
  announceEmailTo?: string;
};

export function AppSettingsManager({ initial, telegramConfigured }: { initial: Settings; telegramConfigured?: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sendingAnn, setSendingAnn] = useState(false);
  const [annMsg, setAnnMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  async function sendTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      // Save first so the server has the latest token/chat id.
      await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
      const res = await fetch("/api/alerts/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setTestMsg(res.ok ? { ok: true, text: "Sent — check Telegram." } : { ok: false, text: d?.detail ?? "Failed." });
    } finally {
      setTesting(false);
    }
  }

  async function sendLatestAnnouncement() {
    setSendingAnn(true);
    setAnnMsg(null);
    try {
      await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
      const res = await fetch("/api/announcements/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setAnnMsg(res.ok ? { ok: true, text: `${d?.detail ?? "Sent."} (Telegram: ${d?.telegram ?? "off"}, email: ${d?.email ?? "off"})` } : { ok: false, text: d?.detail ?? "Failed." });
    } finally {
      setSendingAnn(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
      if (res.ok) {
        setSavedAt(Date.now());
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5">
        <Select
          label="Tax filer status"
          value={s.filerStatus}
          onChange={(v) => set("filerStatus", v)}
          options={[
            { value: "filer", label: "Filer (on ATL)" },
            { value: "non-filer", label: "Non-filer" },
          ]}
          hint="Drives the tax report and the filer/non-filer meter."
        />
        <NumberInput label="Concentration cap (%)" value={s.concentrationCap} onChange={(v) => set("concentrationCap", v)} min={0} max={100} step={1} suffix="%" />
        <NumberInput label="Fund cash reserve (%)" value={s.mfCashReservePct ?? 5} onChange={(v) => set("mfCashReservePct", v)} min={0} max={100} step={0.5} suffix="%" hint="Share of total wealth that never leaves the money-market fund. Buy-zone deployment plans subtract it before anything is spendable." />
        <NumberInput label="Inflation (CPI) %" value={s.inflationPct} onChange={(v) => set("inflationPct", v)} min={0} max={100} step={0.5} suffix="%" hint="0 = automatic (live PBS CPI, computed from the official index). Set a value only to OVERRIDE the feed." />
        <div />

        <NumberInput label="Dividend WHT — filer (%)" value={s.dividendWhtFiler} onChange={(v) => set("dividendWhtFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <NumberInput label="Dividend WHT — non-filer (%)" value={s.dividendWhtNonFiler} onChange={(v) => set("dividendWhtNonFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <div />

        <NumberInput label="CGT — filer (%)" value={s.cgtRateFiler} onChange={(v) => set("cgtRateFiler", v)} min={0} max={100} step={0.5} suffix="%" hint="Equities; verify against the current FBR schedule." />
        <NumberInput label="CGT — non-filer (%)" value={s.cgtRateNonFiler} onChange={(v) => set("cgtRateNonFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <NumberInput label="Brokerage commission (% of value; 3 paisa a share floor, 15% SST added)" value={s.brokeragePct ?? 0.15} onChange={(v) => set("brokeragePct", v)} min={0} max={5} step={0.01} suffix="%" />
        <NumberInput label="Profit-on-debt WHT — filer (%)" value={s.podWhtFiler ?? 15} onChange={(v) => set("podWhtFiler", v)} min={0} max={100} step={0.5} suffix="%" hint="Bank/savings profit and T-bills (Sec 151); withheld at source." />
        <NumberInput label="Profit-on-debt WHT — non-filer (%)" value={s.podWhtNonFiler ?? 35} onChange={(v) => set("podWhtNonFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <div />

        <NumberInput label="PMEX commission / lot (Rs)" value={s.pmexCommissionPerLot} onChange={(v) => set("pmexCommissionPerLot", v)} min={0} step={10} hint="Round-turn, from your broker schedule." />
        <NumberInput label="PMEX CGT (%)" value={s.pmexCgtPercent} onChange={(v) => set("pmexCgtPercent", v)} min={0} max={100} step={0.5} suffix="%" />
        <div />

        <NumberInput label="Equity risk premium (%)" value={s.equityRiskPremiumPct} onChange={(v) => set("equityRiskPremiumPct", v)} min={0} max={30} step={0.5} suffix="%" hint="Added to the SBP rate for the fair-value required return." />
        <NumberInput label="Default fair P/E" value={s.defaultFairPE} onChange={(v) => set("defaultFairPE", v)} min={1} max={40} step={0.5} hint="Used for the earnings-based fair value." />
        <NumberInput label="Target income (Rs/mo)" value={s.targetMonthlyIncome} onChange={(v) => set("targetMonthlyIncome", v)} min={0} step={10000} hint="For the income planner & passive-income coverage." />
      </div>

      <div className="mt-6 pt-5 border-t border-rule">
        <div className="label-cap mb-3">Telegram alerts</div>
        <p className="text-[12px] text-muted mb-4 max-w-[60ch]">
          Create a bot with @BotFather, paste its token, and your chat id (message @userinfobot to get yours).
          When enabled: rebalance drift, buy-zone entries, upcoming ex-dates, foreign-flow streaks and KMI drop-outs — pushed once a day.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <TextInput
            label="Bot token"
            value={s.telegramBotToken}
            onChange={(e) => set("telegramBotToken", e.target.value)}
            placeholder={telegramConfigured ? "•••• configured — paste to change" : "123456:ABC-..."}
            hint={telegramConfigured ? "Saved. Leave blank to keep it." : undefined}
          />
          <TextInput label="Chat id" value={s.telegramChatId} onChange={(e) => set("telegramChatId", e.target.value)} placeholder="123456789" />
          <Toggle label="Enable alerts" value={s.alertsEnabled} onChange={(v) => set("alertsEnabled", v)} hint="Pushes during scheduled checks." />
          <div className="flex items-end">
            <Button variant="outline" onClick={sendTest} disabled={testing}>
              {testing ? "Sending…" : "Send test message"}
            </Button>
          </div>
        </div>
        {testMsg && <div className="text-[12px] mt-2" style={{ color: testMsg.ok ? "var(--positive)" : "var(--negative)" }}>{testMsg.text}</div>}
      </div>

      <div className="mt-6 pt-4 border-t border-rule">
        <div className="text-[14px] font-semibold">Automatic recording</div>
        <p className="text-[12.5px] text-muted mt-1 mb-3">
          Dividends and bonus shares announced on the exchange are written to the ledger on their book-closure date from the shares you held, at your filer rate. A warrant uploaded later replaces the figures.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <Toggle label="Record dividends" value={s.autoDividends ?? true} onChange={(v) => set("autoDividends", v)} hint="On the book-closure date, gross less withholding." />
          <Toggle label="Record bonus shares" value={s.autoBonus ?? true} onChange={(v) => set("autoBonus", v)} hint="Whole shares only; the fraction is paid in cash by the company." />
          <div>
            <div className="text-[13px] font-medium">Zakat on dividends</div>
            <div className="seg mt-1.5">
              <button type="button" data-active={(s.zakatOnDividends ?? "none") === "none"} onClick={() => set("zakatOnDividends", "none")}>None (declaration filed)</button>
              <button type="button" data-active={s.zakatOnDividends === "paidUp"} onClick={() => set("zakatOnDividends", "paidUp")}>2.5% of paid-up value</button>
            </div>
          </div>
          <Toggle label="Bonus shares withheld for tax" value={s.bonusTaxWithheld ?? true} onChange={(v) => set("bonusTaxWithheld", v)} hint={`Companies keep ${s.filerStatus === "non-filer" ? s.bonusTaxNonFiler ?? 20 : s.bonusTaxFiler ?? 10}% of a bonus issue against the tax on it.`} />
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-rule">
        <div className="text-[14px] font-semibold">Company announcements</div>
        <p className="text-[12.5px] text-muted mt-1 mb-3">
          The exchange&apos;s announcements board is read every five minutes. Anything a company you hold posts (results, board meetings, dividends, notices) is sent to you as it appears: the document itself with its link on Telegram, and by email with the document attached.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <Toggle label="Send to Telegram" value={s.announceTelegram ?? true} onChange={(v) => set("announceTelegram", v)} hint="Uses the bot and chat id above." />
          <Toggle label="Send by email" value={s.announceEmail ?? true} onChange={(v) => set("announceEmail", v)} hint="The document attached when it is under 20 MB, the link otherwise." />
          <TextInput label="Email address" value={s.announceEmailTo ?? ""} onChange={(e) => set("announceEmailTo", e.target.value)} placeholder="Blank: your account email" />
          <div className="flex items-end">
            <Button variant="outline" onClick={sendLatestAnnouncement} disabled={sendingAnn}>
              {sendingAnn ? "Sending…" : "Send the latest announcement now"}
            </Button>
          </div>
        </div>
        {annMsg && <div className="text-[12px] mt-2" style={{ color: annMsg.ok ? "var(--positive)" : "var(--negative)" }}>{annMsg.text}</div>}
      </div>

      <div className="flex items-center gap-3 mt-6 pt-4 border-t border-rule">
        <Button variant="solid" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save Settings"}
        </Button>
        {savedAt && Date.now() - savedAt < 3500 && (
          <span className="text-[13px]" style={{ color: "var(--positive)" }}>Saved.</span>
        )}
      </div>
    </Card>
  );
}
