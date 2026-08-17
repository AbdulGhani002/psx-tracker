"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { NumberInput } from "@/components/ui/NumberInput";
import { fmtRs, fmtNum, fmtSignedRs } from "@/lib/format";
import { describeZone } from "@/lib/calculations/zones";
import { planDeployment, type DeployCandidate } from "@/lib/calculations/deploy-plan";

export type SellRow = {
  symbol: string;
  price: number | null;
  sharesHeld: number;
  minHoldingShares: number;
  sellableShares: number;
  sellZoneLow: number | null;
  sellZoneHigh: number | null;
  sell: { proceeds: number; fees: number; gain: number; cgt: number; net: number; cgtRatePct: number; remainingShares: number } | null;
};

export type ZoneNote = { symbol: string; buyZoneLow: number | null; buyZoneHigh: number | null };

type Props = {
  candidates: DeployCandidate[];
  equityValue: number;
  fundsValue: number;
  brokerCash: number;
  reservePct: number;
  concentrationCap: number;
  fundsLabel: string;
  sells: SellRow[];
  heldAtCore: Array<{ symbol: string; sharesHeld: number; minHoldingShares: number }>;
  zones: ZoneNote[];
  serverWarnings: string[];
  watchedCount: number;
};

// What today's prices plus your money add up to: the orders to place, the
// redemption to request, and what deliberately stays put. Type an amount to
// plan a specific deposit; leave it at zero to deploy only what is already in
// the fund above the reserve. The arithmetic runs in the browser off the same
// pure model the server and the Telegram alerts use.
export function DeploymentPlan({
  candidates,
  equityValue,
  fundsValue,
  brokerCash,
  reservePct,
  concentrationCap,
  fundsLabel,
  sells,
  heldAtCore,
  zones,
  serverWarnings,
  watchedCount,
}: Props) {
  const [freshCash, setFreshCash] = useState(0);

  const plan = useMemo(
    () =>
      planDeployment({
        candidates,
        equityValue,
        fundsValue,
        brokerCash,
        reservePct,
        concentrationCap,
        freshCash,
      }),
    [candidates, equityValue, fundsValue, brokerCash, reservePct, concentrationCap, freshCash]
  );

  const zoneOf = (symbol: string) => zones.find((z) => z.symbol === symbol);

  if (watchedCount === 0 && candidates.length === 0) {
    return (
      <Card>
        <p className="text-[13px] text-muted">
          Nothing to plan with yet. Put the price bands you have already decided on into the{" "}
          <Link href="/watchlist" className="underline">watchlist</Link> and set target weights below — then this will
          tell you what to buy, how many shares, and how much to redeem from the fund.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 items-start">
          <NumberInput
            label="Money to deploy (Rs)"
            value={freshCash}
            onChange={(v) => setFreshCash(Math.max(0, v))}
            min={0}
            step={1000}
            large
            hint="New money you are adding. Leave at 0 to deploy only what is already in the fund above your reserve."
          />
          <div className="text-[12.5px] text-muted leading-relaxed">
            Every name with a target weight is considered. Where the price sits decides <em>how much</em>, not whether:
            inside its buy band a name is bought at full weight, above the band it is bought less the further away it
            is, and a name in its own sell band is not bought at all.
            {freshCash > 0 && (
              <>
                {" "}
                <span className="text-ink">Your {fmtRs(freshCash)} is spent first</span>, then brokerage cash, and the
                fund is redeemed last because it is the part still earning.
              </>
            )}
          </div>
        </div>
      </Card>

      <Card inverted>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="In fund + cash" value={fmtRs(plan.cashLike)} note={`${fmtRs(plan.fundsValue)} fund · ${fmtRs(plan.brokerCash)} broker`} />
          <Stat label={`Reserve (${plan.reservePct}%)`} value={fmtRs(plan.reserveRequired)} note="never leaves the fund" />
          <Stat label="Deployable" value={fmtRs(plan.deployable)} note={freshCash > 0 ? `incl. ${fmtRs(freshCash)} new` : "above the reserve"} />
          <Stat label="Buying now" value={fmtRs(plan.deployed)} note={plan.pullFromFunds > 0 ? `redeem ${fmtRs(plan.pullFromFunds)}` : "no redemption needed"} />
        </div>
      </Card>

      {plan.rows.length > 0 ? (
        <div>
          <div className="label-cap mb-2">Place these orders</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-t border-b border-ink">
                  {["Symbol", "Price", "Shares", "Cost", "Weight", "Why this size"].map((h, i) => (
                    <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i === 0 || i === 5 ? "left" : "right" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => {
                  const z = zoneOf(r.symbol);
                  const full = r.zoneFactor >= 0.999;
                  return (
                    <tr key={r.symbol} className="border-b border-rule">
                      <td className="px-2 py-2.5">
                        <Link href={`/stock/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link>
                        {z && <div className="text-[10px] text-muted font-mono">{describeZone(z.buyZoneLow, z.buyZoneHigh, "buy")}</div>}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num">{fmtRs(r.price, true)}</td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num font-medium">{fmtNum(r.shares)}</td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num">{fmtRs(r.rupees)}</td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num text-muted">
                        {r.finalPct.toFixed(1)}% <span className="text-[10px]">of {r.targetPct}%</span>
                      </td>
                      <td className="px-2 py-2.5 text-[12px]">
                        {full ? (
                          <Badge tone="positive">FULL WEIGHT</Badge>
                        ) : (
                          <span className="text-muted">
                            <span className="font-mono mono-num" style={{ color: "var(--accent-deep)" }}>{Math.round(r.zoneFactor * 100)}%</span>{" "}
                            — {r.zoneReason}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-b border-ink">
                  <td className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted" colSpan={3}>Total</td>
                  <td className="px-2 py-2 text-right font-mono mono-num font-medium">{fmtRs(plan.deployed)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted mt-3">
            {plan.pullFromFunds > 0 ? (
              <>
                Redeem <span className="font-mono mono-num font-medium">{fmtRs(plan.pullFromFunds)}</span> from {fundsLabel}
                {plan.brokerCashUsed > 0 && <> and use <span className="font-mono mono-num">{fmtRs(plan.brokerCashUsed)}</span> of brokerage cash</>}
                {plan.freshCashUsed > 0 && <>, after your <span className="font-mono mono-num">{fmtRs(plan.freshCashUsed)}</span> of new money</>}.
                That leaves <span className="font-mono mono-num font-medium">{fmtRs(plan.keptInFunds)}</span> in the fund, still above your{" "}
                {plan.reservePct}% reserve of {fmtRs(plan.reserveRequired)}.
              </>
            ) : (
              <>
                Funded without touching the fund, which stays at {fmtRs(plan.keptInFunds)}
                {plan.freshCashUsed > 0 && <> — your new money covers it</>}.
              </>
            )}
            {plan.undeployed > 0 && <> Rs {Math.round(plan.undeployed).toLocaleString("en-PK")} stays behind: not enough for another whole share.</>}
          </p>
        </div>
      ) : (
        <Card>
          <p className="text-[13px] text-muted">
            {plan.deployable <= 0
              ? "Nothing above your reserve to deploy. Enter an amount above to plan a deposit."
              : "No order could be sized from what is available. See the notes below."}
          </p>
        </Card>
      )}

      {plan.skipped.length > 0 && (
        <p className="text-[12px] text-muted">
          Not bought: {plan.skipped.map((x) => `${x.symbol} (${x.reason})`).join("; ")}.
        </p>
      )}

      {sells.length > 0 && (
        <div>
          <div className="label-cap mb-2">In a sell zone</div>
          <ul className="space-y-2.5 text-[13px]">
            {sells.map((r) => (
              <li key={r.symbol}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Badge tone="negative">SELL {fmtNum(r.sellableShares)}</Badge>
                  <Link href={`/holdings/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link>
                  <span className="font-mono mono-num">{fmtRs(r.price, true)}</span>
                  <span className="text-muted">
                    in {describeZone(r.sellZoneLow, r.sellZoneHigh, "sell")} — hold {fmtNum(r.sharesHeld)}
                    {r.minHoldingShares > 0 ? `, core ${fmtNum(r.minHoldingShares)}` : ""}
                  </span>
                </div>
                {r.sell && (
                  <div className="text-[12.5px] mt-1 ml-1 pl-3 border-l-2" style={{ borderColor: "var(--rule)" }}>
                    Proceeds <span className="font-mono mono-num">{fmtRs(r.sell.proceeds)}</span> · gain{" "}
                    <span className="font-mono mono-num" style={{ color: r.sell.gain >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {fmtSignedRs(r.sell.gain)}
                    </span>{" "}
                    · CGT {r.sell.cgtRatePct}% <span className="font-mono mono-num">{fmtRs(r.sell.cgt)}</span> · fees{" "}
                    <span className="font-mono mono-num">{fmtRs(r.sell.fees)}</span> →{" "}
                    <span className="font-mono mono-num font-medium">{fmtRs(r.sell.net)}</span> in hand
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted mt-2">
            These proceeds are deliberately NOT added to the buying budget above: a sale is not money until it has been
            through the decision gate. Sell first, then re-check this page.
          </p>
        </div>
      )}

      {heldAtCore.length > 0 && (
        <p className="text-[12px] text-muted">
          In a sell band but already at the core you keep, so nothing is offered:{" "}
          {heldAtCore.map((r) => `${r.symbol} (${fmtNum(r.sharesHeld)} held, core ${fmtNum(r.minHoldingShares)})`).join("; ")}.
        </p>
      )}

      {(plan.warnings.length > 0 || serverWarnings.length > 0) && (
        <Card>
          <div className="section-eyebrow mb-2" style={{ color: "var(--accent-deep)" }}>Notes</div>
          <ul className="space-y-1.5 text-[13px]">
            {[...plan.warnings, ...serverWarnings].map((w) => (
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
