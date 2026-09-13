import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { WatchlistManager } from "./WatchlistManager";
import { getZoneBoard, getAppSettings } from "@/lib/data";
import { fmtRs, fmtNum, fmtSignedRs } from "@/lib/format";
import { describeZone } from "@/lib/calculations/zones";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const [board, settings] = await Promise.all([getZoneBoard(), getAppSettings()]);
  const alertsLive = (settings as any).alertsEnabled === true;
  const acting = [...board.buys, ...board.sells];

  return (
    <div>
      <PageHeader
        title="The price you decided on, before the day arrives."
        subtitle="Buy and sell bands set in advance, checked every half hour, pushed to Telegram when one is reached."
      />

      {acting.length > 0 && (
        <Card>
          <div className="label-cap mb-3">Acting now</div>
          <ul className="space-y-2 text-[14px]">
            {board.buys.map((r) => (
              <li key={`b-${r.symbol}`} className="flex flex-wrap items-baseline gap-x-2">
                <Badge tone="positive">BUY</Badge>
                <Link href={`/stock/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
                  {r.symbol}
                </Link>
                <span className="font-mono mono-num">{fmtRs(r.price, true)}</span>
                <span className="text-muted">is inside your buy zone ({describeZone(r.buyZoneLow, r.buyZoneHigh, "buy")}).</span>
                {r.targetPct > 0 ? (
                  <Link href="/rebalance" className="label-cap hover:text-[var(--accent-deep)]">Size it on Rebalance →</Link>
                ) : (
                  <span className="text-[12px]" style={{ color: "var(--accent-deep)" }}>No target weight set — it cannot be sized yet.</span>
                )}
              </li>
            ))}
            {board.sells.map((r) => (
              <li key={`s-${r.symbol}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Badge tone="negative">SELL {fmtNum(r.sellableShares)}</Badge>
                  <Link href={`/holdings/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
                    {r.symbol}
                  </Link>
                  <span className="font-mono mono-num">{fmtRs(r.price, true)}</span>
                  <span className="text-muted">
                    is in your sell zone ({describeZone(r.sellZoneLow, r.sellZoneHigh, "sell")}). You hold {fmtNum(r.sharesHeld)}
                    {r.minHoldingShares > 0 ? `, keeping a core of ${fmtNum(r.minHoldingShares)}` : ""} — sell the {fmtNum(r.sellableShares)} above it.
                  </span>
                  <Link href={`/holdings/${r.symbol}`} className="label-cap hover:text-[var(--accent-deep)]">Trim it →</Link>
                </div>
                {r.sell && (
                  <div className="text-[12.5px] mt-1 ml-1 pl-3 border-l-2" style={{ borderColor: "var(--rule)" }}>
                    Proceeds <span className="font-mono mono-num">{fmtRs(r.sell.proceeds)}</span> · realised gain{" "}
                    <span className="font-mono mono-num" style={{ color: r.sell.gain >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {fmtSignedRs(r.sell.gain)}
                    </span>{" "}
                    · CGT at {r.sell.cgtRatePct}% <span className="font-mono mono-num">{fmtRs(r.sell.cgt)}</span> · fees{" "}
                    <span className="font-mono mono-num">{fmtRs(r.sell.fees)}</span> →{" "}
                    <span className="font-mono mono-num font-medium">{fmtRs(r.sell.net)}</span> in hand, keeping{" "}
                    {fmtNum(r.sell.remainingShares)} shares.
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted mt-3">
            A sale still goes through the decision gate — rationale and falsifier — and the trim simulator on the
            holding page will size it from the percentage you want to keep.
          </p>
        </Card>
      )}

      {board.heldAtCore.length > 0 && (
        <div className="mt-4 text-[13px] text-muted">
          In a sell band but already at the core you keep, so nothing is offered:{" "}
          {board.heldAtCore.map((r: { symbol: string; sharesHeld: number; minHoldingShares: number }) => `${r.symbol} (${fmtNum(r.sharesHeld)} held, core ${fmtNum(r.minHoldingShares)})`).join(", ")}.
        </div>
      )}

      <Section
        number="01"
        title="Your bands"
        display="Decide the price now. Act when it arrives."
        description="A buy zone is the band you are willing to buy in; a sell zone is the band you are willing to sell in. The keep figure is your core holding: only shares above it are ever offered for sale, and the app tells you exactly how many and what they return after fees and CGT. Leave the far bound of a band blank to leave it open-ended."
        action={
          alertsLive ? undefined : (
            <Link href="/settings" className="font-mono text-[11px] uppercase tracking-stat" style={{ color: "var(--accent-deep)" }}>
              Telegram alerts are off →
            </Link>
          )
        }
      >
        <WatchlistManager rows={board.rows} />
      </Section>
    </div>
  );
}
