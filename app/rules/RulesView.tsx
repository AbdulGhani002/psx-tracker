import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import type { RuleSettings, RuleShare } from "@/lib/rules/data";
import { checkFacts } from "@/lib/rules/checks";
import { signedPct, stepText } from "@/lib/rules/ladder";
import { RulesForm } from "./RulesForm";
import { ShareToggle } from "./ShareToggle";

// The price rules' page body (the preview page draws it on sample shares).

const money = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
const tone = (v: number) => (v >= 0 ? "var(--positive)" : "var(--negative)");
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function RulesView({ settings, shares, usualPct, asOf }: { settings: RuleSettings; shares: RuleShare[]; usualPct: number | null; asOf: string | null }) {
  return (
    <div className="fade-in">
      <PageHeader title="Price rules" subtitle="Your steps from each share's average price. Telegram tells you after the close, with what has changed." />

      <Card title="Your shares" action={<span className="text-[12px] text-muted">{asOf ? `Closes of ${asOf}` : ""}{settings.on ? "" : " · rules off"}</span>}>
        {shares.length === 0 ? (
          <p className="text-[13px] text-muted">No shares held.</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead>
                <tr>
                  <th>Share</th>
                  <th className="text-right">Average</th>
                  <th className="text-right">Close</th>
                  <th>Now</th>
                  <th>Next add</th>
                  <th>Next sell</th>
                  <th>Checks</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => {
                  const told = s.told.filter((f) => f.told).sort((a, b) => b.at.localeCompare(a.at))[0];
                  return (
                    <tr key={s.symbol} style={{ opacity: s.off ? 0.55 : 1 }}>
                      <td className="whitespace-nowrap"><Link href={`/holdings/${s.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{s.symbol}</Link></td>
                      <td className="text-right mono-num">{money(s.avgCost)}</td>
                      <td className="text-right mono-num whitespace-nowrap">
                        {s.close != null ? money(s.close) : "–"}
                        {s.move != null && <div className="text-[11px]" style={{ color: tone(s.move) }}>{signedPct(s.move)}</div>}
                      </td>
                      <td className="whitespace-nowrap text-[12.5px]">
                        {s.at ? <span className="font-semibold">{signedPct(s.at.move, 0)}: {stepText(s.at)}</span> : <span className="text-muted">–</span>}
                        {told && <div className="text-[11px] text-muted">told {day(told.at)}</div>}
                      </td>
                      <td className="whitespace-nowrap text-[12.5px]">
                        {s.addsOff ? <span className="text-muted" title="This share's target in Rebalance is 0%">off: 0% target</span> : s.nextAdd ? <><span className="mono-num">{money(s.nextAdd.price)}</span> <span className="text-muted">({signedPct(s.nextAdd.step.move, 0)}, {stepText(s.nextAdd.step)})</span></> : <span className="text-muted">–</span>}
                      </td>
                      <td className="whitespace-nowrap text-[12.5px]">
                        {s.nextSell ? <><span className="mono-num">{money(s.nextSell.price)}</span> <span className="text-muted">({signedPct(s.nextSell.step.move, 0)}, {stepText(s.nextSell.step)})</span></> : <span className="text-muted">–</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex gap-1">
                          {checkFacts(s.checks).map((c) => (
                            <span key={c.label} className="pill" data-tone={c.ok ? "positive" : "amber"} title={c.text}>{c.ok ? "✓" : "⚠"} {c.label}</span>
                          ))}
                        </div>
                      </td>
                      <td><ShareToggle symbol={s.symbol} off={s.off} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-3" title="Your rules" action={<span className="text-[12px] text-muted">Move from the average price · what to do · % of the shares held</span>}>
        <RulesForm settings={settings} />
      </Card>

      <details className="mt-4 text-[12.5px] text-muted">
        <summary className="cursor-pointer select-none">How it works</summary>
        <ul className="mt-2 space-y-1 pl-4 list-disc">
          <li>Each share is measured from your average price after every close. A step is reached when a close gets to it, and Telegram tells you once, with the shares to add or sell.</li>
          <li>It is told again only after the price comes back to your average, which ends that fall or rise. Hold steps show here but send nothing.</li>
          <li>The rules hold while the company and the economy have not changed a lot, so each message checks: the last year&apos;s profit against companies&apos; usual yearly move ({usualPct != null ? `${usualPct.toFixed(0)}% now` : "worked out from the data kept"}), a dividend cut by more than half, and the policy rate and the rupee since you bought, past the limits you set. ⚠ means check first.</li>
          <li>Adds leave out a share whose Rebalance target is 0%. Steps a share had already passed when the rules began or changed are marked without a message.</li>
        </ul>
      </details>
    </div>
  );
}
