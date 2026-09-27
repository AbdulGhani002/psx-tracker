import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { CompanyMark } from "@/components/ui/CompanyMark";
import type { StoredReport } from "@/lib/quant/report";
import { swingPlan, type SwingStats } from "@/lib/quant/swing";
import { ScoreMeter, money } from "@/app/analysis/ZoneBar";
import { RefreshAnalysis } from "@/app/analysis/RefreshAnalysis";
import { TradeLadder } from "./TradeLadder";

// Swing trades of one to four weeks: the model's top-ranked names with a buy
// level, a stop and two profit levels each, beside the record of trading the
// same rule on 24 years of out-of-sample predictions. The pick rule is the one
// the record was measured on: the top fifth by the model's rank, taken only
// while the market index is above its 200-day average.

const TESTED_RULE = "Top fifth, strong market, buy in the zone, sell at T1";
const NO_MODEL_RULE = "Every name, any market";

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="text-[18px] font-bold mono-num" style={{ color: tone === "positive" ? "var(--positive)" : tone === "negative" ? "var(--negative)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

export function SwingView({ report }: { report: StoredReport | null }) {
  const market = report?.market ?? null;
  const gateOpen = market ? market.state !== "WEAK" : false;
  const stats: SwingStats[] = report?.swing ?? [];
  const tested = stats.find((s) => s.rule.startsWith(TESTED_RULE)) ?? null;
  const noModel = stats.find((s) => s.rule.startsWith(NO_MODEL_RULE)) ?? null;

  const setups = (report?.screen ?? [])
    .filter((r) => r.pctile >= 0.8)
    .map((r) => ({ r, plan: swingPlan(r.price, r) }))
    .filter((x): x is { r: (typeof x)["r"]; plan: NonNullable<(typeof x)["plan"]> } => x.plan != null)
    .sort((a, b) => b.r.pctile - a.r.pctile)
    .slice(0, 12);
  const yours = (report?.holdings ?? [])
    .filter((h) => h.zone && (h.plan?.shares ?? 0) > 0)
    .map((h) => ({ h, plan: swingPlan(h.last, h.zone!) }));

  return (
    <>
      <PageHeader title="Swing trades" subtitle="Buy level, stop-loss and profit targets for trades of one to four weeks.">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
          {report && <span className="text-muted">As of {report.date}</span>}
          <RefreshAnalysis />
          <Link href="/analysis" className="link-underline">Model →</Link>
        </div>
      </PageHeader>

      {!report && (
        <Card>
          <div className="text-[15px] font-semibold mb-1">No reading yet</div>
          <p className="text-[13px] text-muted mb-4">It is built after every close. Build it now; it takes a minute or two.</p>
          <RefreshAnalysis />
        </Card>
      )}

      {report && (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.04em]"
                style={{
                  color: gateOpen ? "var(--positive)" : "var(--negative)",
                  background: `color-mix(in srgb, ${gateOpen ? "var(--positive)" : "var(--negative)"} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${gateOpen ? "var(--positive)" : "var(--negative)"} 35%, transparent)`,
                }}
              >
                {gateOpen ? "SWING TRADES ON" : "NO NEW SWING TRADES"}
              </span>
              <span className="text-[14px] font-medium">
                {gateOpen
                  ? market?.state === "STRONG"
                    ? "Market above its 200-day and broad. The rule is trading."
                    : "Market above its 200-day but narrow. Top names only, smaller size."
                  : "Market below its 200-day. The tested rule waits; the setups below are a watchlist."}
              </span>
            </div>
            {tested && tested.trades > 0 && (
              <div className="mt-4 pt-4 border-t border-rule">
                <div className="text-[12px] text-muted mb-2">
                  This rule on {tested.from.slice(0, 4)}–{tested.to.slice(0, 4)}, out of sample, after 0.4% costs: {tested.trades.toLocaleString("en-US")} trades
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="Trades that made money" value={`${Math.round(tested.winRate * 100)}%`} tone={tested.winRate >= 0.5 ? "positive" : "negative"} />
                  <Stat label="Average per trade" value={pct(tested.avgRetPct, 2)} tone={tested.avgRetPct >= 0 ? "positive" : "negative"} />
                  <Stat label="Reached target 1" value={`${Math.round(tested.hitTarget * 100)}%`} />
                  <Stat label="Average hold" value={`${tested.avgDays.toFixed(0)} days`} />
                </div>
                {noModel && noModel.trades > 0 && (
                  <div className="mt-2 text-[12px] text-muted">
                    The same levels on every name, without the model: {Math.round(noModel.winRate * 100)}% made money, {pct(noModel.avgRetPct, 2)} a trade.
                  </div>
                )}
              </div>
            )}
          </Card>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="text-[17px] font-bold">{gateOpen ? "Setups" : "Watchlist"}</h2>
              <span className="text-[12px] text-muted">The model&apos;s top fifth, strongest first</span>
            </div>
            {setups.length === 0 ? (
              <Card><p className="text-[13px] text-muted">No setups today.</p></Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {setups.map(({ r, plan }) => (
                  <Card key={r.symbol}>
                    <div className="flex items-start justify-between gap-3">
                      <Link href={r.held ? `/holdings/${r.symbol}` : `/stock/${r.symbol}`} className="flex items-center gap-2.5 min-w-0 group">
                        <CompanyMark symbol={r.symbol} size="sm" />
                        <div className="min-w-0">
                          <div className="text-[15px] font-bold leading-tight group-hover:text-[var(--accent-deep)]">
                            {r.symbol} {r.held && <span className="pill ml-1" data-tone="positive">held</span>}
                          </div>
                          <div className="text-[12px] mono-num">
                            Rs {money(r.price)} <span style={{ color: r.dayChangePct >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(r.dayChangePct)}</span>
                          </div>
                        </div>
                      </Link>
                      <div className="text-right">
                        <ScoreMeter pctile={r.pctile} />
                        <div className="text-[11.5px] text-muted mt-1">Reward/risk <span className="font-semibold mono-num" style={{ color: "var(--ink)" }}>{plan.rr.toFixed(1)}</span></div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <TradeLadder plan={plan} />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {yours.length > 0 && (
            <section>
              <h2 className="text-[17px] font-bold mb-3">Your stocks: where to stop and where to take profit</h2>
              <Card pad={false}>
                <div className="overflow-x-auto">
                  <table className="table-zar">
                    <thead>
                      <tr><th>Stock</th><th className="text-right">Now</th><th className="text-right">Stop</th><th className="text-right">Target 1</th><th className="text-right">Target 2</th></tr>
                    </thead>
                    <tbody>
                      {yours.map(({ h, plan }) => (
                        <tr key={h.symbol}>
                          <td><Link href={`/holdings/${h.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{h.symbol}</Link></td>
                          <td className="text-right mono-num">{money(h.last)}</td>
                          <td className="text-right mono-num" style={{ color: "var(--negative)" }}>{plan ? money(plan.stop) : "broken"}</td>
                          <td className="text-right mono-num" style={{ color: "var(--blue)" }}>{money(h.zone!.sellLow)}</td>
                          <td className="text-right mono-num" style={{ color: "var(--blue)" }}>{money(h.zone!.sellHigh)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          )}

          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="w-[2px] h-3 rounded-full" style={{ background: "var(--positive)" }} />Buy: the top of the buy zone</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-[2px] h-3 rounded-full" style={{ background: "var(--negative)" }} />Stop: only a tenth of paths like this close below it</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-[2px] h-3 rounded-full" style={{ background: "var(--blue)" }} />Targets: half of paths reach T1, a quarter T2</span>
            <span>Odds, not promises: a stop is part of every trade.</span>
          </div>
        </div>
      )}
    </>
  );
}
