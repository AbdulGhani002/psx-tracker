import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum, fmtSignedRs } from "@/lib/format";
import { describeZone } from "@/lib/calculations/zones";

type Swap = {
  sellShares: number;
  proceeds: number;
  sellFees: number;
  gain: number | null;
  cgt: number | null;
  netFromSale: number;
  buyShares: number;
  buyCost: number;
  buyFees: number;
  totalOutlay: number;
  leftover: number;
  shortfall: number;
};

export type StandInRow = {
  primary: string;
  standIn: string;
  primaryName: string;
  standInName: string;
  sectorMatches: boolean;
  primaryValue: number;
  standInValue: number;
  combinedValue: number;
  targetPct: number;
  targetValue: number;
  gapToTarget: number;
  swapReady: boolean;
  swap: Swap | null;
  primaryPrice: number | null;
  standInPrice: number | null;
  primaryShares: number;
  standInShares: number;
  primaryBuyZoneLow: number | null;
  primaryBuyZoneHigh: number | null;
  warnings: string[];
};

// A stand-in holds a place in a sector so the money is not sitting in cash
// waiting. The pair is shown as one allocation, and the moment the name you
// actually wanted comes into its band, the reversal is spelled out with the
// arithmetic — sell this, buy that, here is what it leaves.
export function StandInPanel({ rows }: { rows: StandInRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-5">
      {rows.map((r) => {
        const filledPct = r.targetValue > 0 ? (r.combinedValue / r.targetValue) * 100 : 0;
        return (
          <Card key={`${r.standIn}-${r.primary}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 mb-3">
              {r.swapReady ? <Badge tone="accent">SWAP READY</Badge> : <Badge tone="default">HOLDING THE PLACE</Badge>}
              <Link href={`/holdings/${r.standIn}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
                {r.standIn}
              </Link>
              <span className="text-muted">is standing in for</span>
              <Link href={`/holdings/${r.primary}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
                {r.primary}
              </Link>
              {!r.sectorMatches && <Badge tone="amber">DIFFERENT SECTORS</Badge>}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
              <div>
                <div className="label-cap mb-1">{r.standIn} held</div>
                <div className="font-mono mono-num text-[16px]">{fmtNum(r.standInShares)}</div>
                <div className="text-[10px] text-muted">{fmtRs(r.standInValue)}</div>
              </div>
              <div>
                <div className="label-cap mb-1">{r.primary} held</div>
                <div className="font-mono mono-num text-[16px]">{fmtNum(r.primaryShares)}</div>
                <div className="text-[10px] text-muted">{fmtRs(r.primaryValue)}</div>
              </div>
              <div>
                <div className="label-cap mb-1">Pair vs target</div>
                <div className="font-mono mono-num text-[16px]">{filledPct.toFixed(0)}%</div>
                <div className="text-[10px] text-muted">
                  {fmtRs(r.combinedValue)} of {fmtRs(r.targetValue)} ({r.targetPct}%)
                </div>
              </div>
              <div>
                <div className="label-cap mb-1">Still to fill</div>
                <div className="font-mono mono-num text-[16px]">{r.gapToTarget > 0 ? fmtRs(r.gapToTarget) : "—"}</div>
                <div className="text-[10px] text-muted">across the pair</div>
              </div>
            </div>

            {r.swapReady && r.swap ? (
              <div className="mt-4 pt-3 border-t border-rule">
                <div className="label-cap mb-2" style={{ color: "var(--accent-deep)" }}>
                  {r.primary} is in its buy band ({describeZone(r.primaryBuyZoneLow, r.primaryBuyZoneHigh, "buy")}) — reverse the position
                </div>
                <p className="text-[13.5px] leading-relaxed">
                  Sell all <span className="font-mono mono-num font-medium">{fmtNum(r.swap.sellShares)}</span> {r.standIn} at{" "}
                  {fmtRs(r.standInPrice, true)} → <span className="font-mono mono-num">{fmtRs(r.swap.proceeds)}</span>, less fees{" "}
                  <span className="font-mono mono-num">{fmtRs(r.swap.sellFees)}</span>
                  {r.swap.cgt != null ? (
                    <>
                      {" "}and CGT <span className="font-mono mono-num">{fmtRs(r.swap.cgt)}</span> on a realised{" "}
                      <span className="font-mono mono-num" style={{ color: (r.swap.gain ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>
                        {fmtSignedRs(r.swap.gain ?? 0)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted"> (the gain could not be matched to your lots, so no tax is shown rather than a guessed one)</span>
                  )}{" "}
                  → <span className="font-mono mono-num font-medium">{fmtRs(r.swap.netFromSale)}</span> in hand.
                </p>
                <p className="text-[13.5px] leading-relaxed mt-1.5">
                  That buys <span className="font-mono mono-num font-medium">{fmtNum(r.swap.buyShares)}</span> {r.primary} at{" "}
                  {fmtRs(r.primaryPrice, true)} — <span className="font-mono mono-num">{fmtRs(r.swap.buyCost)}</span> plus fees{" "}
                  <span className="font-mono mono-num">{fmtRs(r.swap.buyFees)}</span>, leaving{" "}
                  <span className="font-mono mono-num">{fmtRs(r.swap.leftover)}</span>.
                  {r.swap.shortfall > 0 && (
                    <>
                      {" "}
                      <span className="text-muted">
                        Still {fmtRs(r.swap.shortfall)} short of the full {r.targetPct}% target — top up from the fund if you want the
                        whole position.
                      </span>
                    </>
                  )}
                </p>
                <p className="text-[11px] text-muted mt-2">
                  Selling {r.standIn} goes through the decision gate like any other sale — rationale and falsifier. Nothing here places an
                  order.
                </p>
              </div>
            ) : (
              <p className="text-[12.5px] text-muted mt-3 pt-3 border-t border-rule">
                {r.primary} is not in its buy band
                {r.primaryBuyZoneHigh != null ? ` (${describeZone(r.primaryBuyZoneLow, r.primaryBuyZoneHigh, "buy")})` : " — no buy band set"}
                , so {r.standIn} keeps the sector exposure and any new money for this allocation goes to it rather than to cash. When{" "}
                {r.primary} comes into range this card turns into the swap.
              </p>
            )}

            {r.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-[12px]" style={{ color: "var(--negative)" }}>
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
