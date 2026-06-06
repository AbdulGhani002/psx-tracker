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
  pmexCommissionPerLot: number;
  pmexCgtPercent: number;
  concentrationCap: number;
  telegramBotToken: string;
  telegramChatId: string;
  alertsEnabled: boolean;
};

export function AppSettingsManager({ initial, telegramConfigured }: { initial: Settings; telegramConfigured?: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
        <div />

        <NumberInput label="Dividend WHT — filer (%)" value={s.dividendWhtFiler} onChange={(v) => set("dividendWhtFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <NumberInput label="Dividend WHT — non-filer (%)" value={s.dividendWhtNonFiler} onChange={(v) => set("dividendWhtNonFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <div />

        <NumberInput label="CGT — filer (%)" value={s.cgtRateFiler} onChange={(v) => set("cgtRateFiler", v)} min={0} max={100} step={0.5} suffix="%" hint="Equities; verify against the current FBR schedule." />
        <NumberInput label="CGT — non-filer (%)" value={s.cgtRateNonFiler} onChange={(v) => set("cgtRateNonFiler", v)} min={0} max={100} step={0.5} suffix="%" />
        <div />

        <NumberInput label="PMEX commission / lot (Rs)" value={s.pmexCommissionPerLot} onChange={(v) => set("pmexCommissionPerLot", v)} min={0} step={10} hint="Round-turn, from your broker schedule." />
        <NumberInput label="PMEX CGT (%)" value={s.pmexCgtPercent} onChange={(v) => set("pmexCgtPercent", v)} min={0} max={100} step={0.5} suffix="%" />
      </div>

      <div className="mt-6 pt-5 border-t border-rule">
        <div className="label-cap mb-3">Telegram alerts</div>
        <p className="text-[12px] text-muted mb-4 max-w-[60ch]">
          Create a bot with @BotFather, paste its token, and your chat id (message @userinfobot to get yours).
          When enabled, watchlist target-hits and rebalance drift are pushed once a day.
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
