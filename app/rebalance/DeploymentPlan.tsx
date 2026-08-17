import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum } from "@/lib/format";
import { describeZone } from "@/lib/calculations/zones";
import type { DeploymentPlan as Plan } from "@/lib/data";

// What today's buy zones plus the money in the fund actually add up to: the
// orders to place, the redemption to request, and what deliberately stays put.
export function DeploymentPlan({ plan }: { plan: Plan }) {
  const { board } = plan;
  const nothingWatched = board.rows.length === 0;

  if (nothingWatched) {
    return (
      <Card>
        <p className="text-[13px] text-muted">
          No buy or sell zones set yet. Put the price bands you have already decided on into the{" "}
          <Link href="/watchlist" className="underline">watchlist</Link> and this plan will tell you what to buy,
          how many shares, and how much to redeem from the fund the moment a band is reached.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card inverted>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="In fund + cash" value={fmtRs(plan.cashLike)} note={`${fmtRs(plan.fundsValue)} fund · ${fmtRs(plan.brokerCash)} broker`} />
          <Stat label={`Reserve (${plan.reservePct}%)`} value={fmtRs(plan.reserveRequired)} note="never leaves the fund" />
          <Stat label="Deployable today" value={fmtRs(plan.deployable)} note="above the reserve" />
          <Stat label="Buying now" value={fmtRs(plan.deployed)} note={plan.pullFromFunds > 0 ? `redeem ${fmtRs(plan.pullFromFunds)}` : "from brokerage cash"} />
        </div>
      </Card>

      {plan.rows.length > 0 ? (
        <div>
          <div className="label-cap mb-2">Place these orders</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-t border-b border-ink">
                  {["Symbol", "Buy zone", "Price", "Shares", "Cost", "Weight after"].map((h, i) => (
                    <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i === 0 ? "left" : "right" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => {
                  const z = board.rows.find((b) => b.symbol === r.symbol);
                  return (
                    <tr key={r.symbol} className="border-b border-rule">
                      <td className="px-2 py-2.5">
                        <Link href={`/stock/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link>
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num text-muted">
                        {z ? describeZone(z.buyZoneLow, z.buyZoneHigh, "buy") : "—"}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num">{fmtRs(r.price, true)}</td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num font-medium">{fmtNum(r.shares)}</td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num">{fmtRs(r.rupees)}</td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num text-muted">
                        {r.finalPct.toFixed(1)}% <span className="text-[10px]">of {r.targetPct}%</span>
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-b border-ink">
                  <td className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted" colSpan={4}>Total</td>
                  <td className="px-2 py-2 text-right font-mono mono-num font-medium">{fmtRs(plan.deployed)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted mt-3">
            {plan.pullFromFunds > 0 ? (
              <>
                Redeem <span className="font-mono mono-num font-medium">{fmtRs(plan.pullFromFunds)}</span> from {plan.fundsLabel}
                {plan.brokerCashUsed > 0 && <> and use <span className="font-mono mono-num">{fmtRs(plan.brokerCashUsed)}</span> of brokerage cash</>}.
                That leaves <span className="font-mono mono-num font-medium">{fmtRs(plan.keptInFunds)}</span> in the fund, still above your{" "}
                {plan.reservePct}% reserve of {fmtRs(plan.reserveRequired)}.
              </>
            ) : (
              <>Funded entirely from brokerage cash — the fund is untouched at {fmtRs(plan.keptInFunds)}.</>
            )}
            {plan.undeployed > 0 && <> Rs {Math.round(plan.undeployed).toLocaleString("en-PK")} stays behind: not enough for another whole share.</>}
          </p>
        </div>
      ) : (
        <Card>
          <p className="text-[13px] text-muted">
            {board.buys.length === 0
              ? "Nothing is in a buy zone right now. The money stays in the fund — that is the plan working, not the plan failing."
              : "Something is in a buy zone but no order could be sized. See the notes below."}
          </p>
        </Card>
      )}

      {board.sells.length > 0 && (
        <div>
          <div className="label-cap mb-2">In a sell zone</div>
          <ul className="space-y-2 text-[13px]">
            {board.sells.map((r) => (
              <li key={r.symbol} className="flex flex-wrap items-baseline gap-x-2">
                <Badge tone="negative">SELL</Badge>
                <Link href={`/holdings/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link>
                <span className="font-mono mono-num">{fmtRs(r.price, true)}</span>
                <span className="text-muted">
                  in {describeZone(r.sellZoneLow, r.sellZoneHigh, "sell")} — {fmtNum(r.sharesHeld)} shares worth {fmtRs(r.positionValue)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted mt-2">
            Proceeds are deliberately NOT added to the buying budget above: a sale is not money until it has gone
            through the decision gate. Sell first, then re-check this page.
          </p>
        </div>
      )}

      {board.heldBelowFloor.length > 0 && (
        <p className="text-[12px] text-muted">
          Silent by your own rule (position at or under its minimum):{" "}
          {board.heldBelowFloor.map((r) => `${r.symbol} — ${fmtNum(r.sharesHeld)} held, floor ${fmtNum(r.minSellShares)}`).join("; ")}.
        </p>
      )}

      {plan.warnings.length > 0 && (
        <Card>
          <div className="section-eyebrow mb-2" style={{ color: "var(--accent-deep)" }}>Notes</div>
          <ul className="space-y-1.5 text-[13px]">
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-stat uppercase font-mono" style={{ color: "rgba(245,241,232,0.65)" }}>{label}</div>
      <div className="font-display mono-num text-[22px]" style={{ fontVariationSettings: "'opsz' 144" }}>{value}</div>
      {note && <div className="text-[10px] font-mono mt-0.5" style={{ color: "rgba(245,241,232,0.5)" }}>{note}</div>}
    </div>
  );
}
