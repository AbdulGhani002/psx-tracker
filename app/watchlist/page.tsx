import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { WatchlistManager } from "./WatchlistManager";
import { getZoneBoard, getAppSettings } from "@/lib/data";
import { fmtRs, fmtNum } from "@/lib/format";
import { describeZone } from "@/lib/calculations/zones";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const [board, settings] = await Promise.all([getZoneBoard(), getAppSettings()]);
  const alertsLive = (settings as any).alertsEnabled === true;
  const acting = [...board.buys, ...board.sells];

  return (
    <div>
      <PageHeader
        eyebrow="Watchlist"
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
              <li key={`s-${r.symbol}`} className="flex flex-wrap items-baseline gap-x-2">
                <Badge tone="negative">SELL</Badge>
                <Link href={`/holdings/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
                  {r.symbol}
                </Link>
                <span className="font-mono mono-num">{fmtRs(r.price, true)}</span>
                <span className="text-muted">
                  is inside your sell zone ({describeZone(r.sellZoneLow, r.sellZoneHigh, "sell")}) and you hold{" "}
                  {fmtNum(r.sharesHeld)} shares worth {fmtRs(r.positionValue)}.
                </span>
                <Link href={`/holdings/${r.symbol}`} className="label-cap hover:text-[var(--accent-deep)]">Trim it →</Link>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted mt-3">
            A sale still goes through the decision gate — rationale and falsifier — and the trim simulator on the
            holding page will size it from the percentage you want to keep.
          </p>
        </Card>
      )}

      {board.heldBelowFloor.length > 0 && (
        <div className="mt-4 text-[13px] text-muted">
          In a sell band but deliberately silent (position at or under your minimum):{" "}
          {board.heldBelowFloor.map((r) => `${r.symbol} (${fmtNum(r.sharesHeld)} held, floor ${fmtNum(r.minSellShares)})`).join(", ")}.
        </div>
      )}

      <Section
        number="01"
        title="Your bands"
        display="Decide the price now. Act when it arrives."
        description="A buy zone is the band you are willing to buy in; a sell zone is the band you are willing to sell in. The minimum share count stops the app nagging you about positions too small to be worth the brokerage — set it per stock. Leave the far bound of a band blank to leave it open-ended."
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
