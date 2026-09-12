import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { uid } from "@/lib/auth/uid";
import { loadQuantSnapshot } from "@/lib/quant/store";
import type { StoredReport, StoredReportItem } from "@/lib/quant/report";
import { RefreshAnalysis } from "./RefreshAnalysis";

export const dynamic = "force-dynamic";

const money = (v: number) => (v >= 10000 ? Math.round(v).toLocaleString("en-US") : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const odds = (p: number) => `${Math.round(p * 100)}%`;
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

// Captions carry Telegram's <b> and <i>, which are HTML too. They are built by
// our own code from numbers and fixed words, never from user input.
function Caption({ text }: { text: string }) {
  return <div className="text-[13px] leading-relaxed whitespace-pre-line" dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, "<br/>") }} />;
}

function Chart({ item }: { item: StoredReportItem }) {
  return (
    <div className="border border-[var(--rule)] p-3 bg-[var(--paper)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/png;base64,${item.png}`} alt={item.title} className="w-full h-auto" />
      <div className="mt-3">
        <Caption text={item.caption} />
      </div>
    </div>
  );
}

const TONE: Record<string, "positive" | "negative" | "default"> = { BUY: "positive", STAGE: "positive", SELL: "negative", EXIT: "negative", TRIM: "negative", WATCH: "default", WAIT: "default", HOLD: "default", AVOID: "negative", PASS: "default" };

export default async function AnalysisPage() {
  const userId = await uid();
  const report = await loadQuantSnapshot<StoredReport>(`quant:report:${userId}`).catch(() => null);
  const kse = report?.indices.find((i) => i.symbol === "KSE100") ?? report?.indices[0];
  const outlook = kse?.outlook ?? null;
  const market = report?.market ?? null;
  const rec = report?.record ?? null;
  // A report stored by an older build may lack the newer fields.
  const tests = market?.tests ?? [];

  return (
    <>
      <PageHeader
        title="Analysis"
        subtitle="The model's own reading: how strong the market is and what the KSE-100 did after past days like this, where each name you hold ranks among every name on the exchange and what names ranked there went on to do, and the zones read off the model's own curve of where a path stalls. Your bands are shown beside its verdicts, not underneath them."
      />

      {!report && (
        <Card>
          <div className="label-cap mb-2">No analysis stored yet</div>
          <p className="text-[15px] leading-relaxed mb-4">
            The analysis is built after each close (14:45 CEST) and kept here. Build it now; it takes a minute or two.
          </p>
          <RefreshAnalysis />
        </Card>
      )}

      {report && (
        <>
          <Card>
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <div className="label-cap">
                {report.date} · built {new Date(report.builtAt).toUTCString().slice(5, 22)} UTC
                {report.model ? ` · model trained ${report.model.trainedOn.slice(0, 10)} on ${report.model.names} names (${report.model.trainedFrom === "archive" ? "24-year archive" : "5-year feed"}), ${report.model.horizon} sessions ahead` : ""}
              </div>
              <RefreshAnalysis />
            </div>
            {market && (
              <div className="mt-4 text-[20px] leading-snug" style={{ color: market.state === "STRONG" ? "var(--positive)" : market.state === "WEAK" ? "var(--negative)" : "inherit" }}>
                {market.line}
              </div>
            )}
            {market?.outlookLine && <div className="mt-3 text-[15px] leading-relaxed">{market.outlookLine}</div>}
            {kse?.zone && (
              <div className="mt-2 text-[15px] leading-relaxed">
                KSE-100 zone from past states like this: buy <span className="font-mono">{money(kse.zone.buyHigh)}</span> down to <span className="font-mono">{money(kse.zone.buyLow)}</span> (half of past paths dipped to the top, a quarter to the bottom); the market case fails below <span className="font-mono">{money(kse.zone.fails)}</span>; rallies stall <span className="font-mono">{money(kse.zone.sellLow)}</span> to <span className="font-mono">{money(kse.zone.sellHigh)}</span>
                {kse.zone.trigger ? <> ; the market turns strong above <span className="font-mono">{money(kse.zone.trigger)}</span> (its 200-day)</> : null}.
              </div>
            )}
            {tests.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {tests.map((t) => (
                  <span key={t.name} className="text-[12px] border px-2 py-1" style={{ borderColor: "var(--rule)", color: t.pass ? "var(--positive)" : "var(--negative)" }} title={t.detail}>
                    {t.pass ? "✓" : "✗"} {t.name} <span className="text-muted">({t.detail})</span>
                  </span>
                ))}
              </div>
            )}
            {market && (
              <StatRow>
                <Stat label="Market" value={market.state} tone={market.state === "STRONG" ? "positive" : market.state === "WEAK" ? "negative" : "default"} hint="Equal-weight index vs 200-day, and breadth" />
                {tests.length > 0 && <Stat label="Strength" value={`${market.score ?? 0} of ${tests.length}`} hint="Chart tests the KSE-100 passes" />}
                <Stat label="Above 200-day" value={`${market.breadth200Pct.toFixed(0)}%`} hint="Share of names" />
                <Stat label="Above 50-day" value={`${market.breadth50Pct.toFixed(0)}%`} hint="Share of names" />
                {outlook && <Stat label="Higher in 20 sessions" value={odds(outlook.pUp)} hint={`${Math.round(outlook.periods)} past states like this; all states ${odds(outlook.base.pUp)}`} />}
                {outlook && <Stat label="KSE-100 median" value={money(outlook.levels[2])} hint={pct(outlook.medianPct)} />}
                {outlook && <Stat label="Middle range" value={`${money(outlook.levels[1])} to ${money(outlook.levels[3])}`} hint="Half of past outcomes" />}
                {outlook && <Stat label="Wide range" value={`${money(outlook.levels[0])} to ${money(outlook.levels[4])}`} hint="Four in five past outcomes" />}
                {outlook && kse?.projection && <Stat label="5% dip first" value={odds(outlook.pDip)} hint={`Odds of touching ${money(kse.projection.dipLevel)} first`} />}
                {!outlook && kse?.projection && <Stat label="KSE-100 centre" value={money(kse.projection.median)} hint={`${money(kse.projection.low)} to ${money(kse.projection.high)}`} />}
              </StatRow>
            )}
          </Card>

          <Section number="01" title="The list: your portfolio, by the model" description={`Every name you hold or have a target for, sorted by what needs doing. Target and now are weights of the book${report.book ? ` (equities Rs ${Math.round(report.book.equity).toLocaleString("en-US")} plus deployable cash Rs ${Math.round(report.book.deployable).toLocaleString("en-US")})` : ""}; a name held at a zero target is an exit. Rank is the name's place today among every name in the universe on the model's rank score (its fifth is taken over the last five sessions); edge is what names ranked there went on to do against the market per 20 sessions, out of sample since 2007. The zones are quantiles of the model's path curve: half of paths like this one reach the top of the buy zone, a quarter its bottom, a tenth the fail level; the same for the sell zone. Buy sizes are whole shares at the top of the buy zone.`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-cap border-b-2 border-ink">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Verdict</th>
                    <th className="py-2 pr-3">Last</th>
                    <th className="py-2 pr-3">Target</th>
                    <th className="py-2 pr-3">Now</th>
                    <th className="py-2 pr-3">Rank</th>
                    <th className="py-2 pr-3">Edge</th>
                    <th className="py-2 pr-3">Buy zone</th>
                    <th className="py-2 pr-3">Sell zone</th>
                    <th className="py-2 pr-3">Fails</th>
                    <th className="py-2 pr-3">Turns above</th>
                    <th className="py-2 pr-3">Your band</th>
                  </tr>
                </thead>
                <tbody>
                  {report.holdings.map((h) => (
                    <tr key={h.symbol} className="border-b border-[var(--rule)] align-top">
                      <td className="py-2 pr-3 font-mono">{h.symbol}</td>
                      <td className="py-2 pr-3 font-semibold" style={{ color: TONE[h.verdict] === "positive" ? "var(--positive)" : TONE[h.verdict] === "negative" ? "var(--negative)" : "inherit" }}>
                        {h.verdict}
                      </td>
                      <td className="py-2 pr-3 font-mono">{money(h.last)} <span className="text-muted">({pct(h.dayChangePct)})</span></td>
                      <td className="py-2 pr-3 font-mono">{h.plan ? `${h.plan.targetPct.toFixed(0)}%` : "–"}</td>
                      <td className="py-2 pr-3 font-mono">{h.plan ? `${h.plan.currentPct.toFixed(1)}%` : "–"}</td>
                      <td className="py-2 pr-3 font-mono">{h.rank ? `${h.rank.pos} of ${h.rank.of}` : "–"}</td>
                      <td className="py-2 pr-3 font-mono">{h.edge ? pct(h.edge.meanRelPct) : "–"}</td>
                      <td className="py-2 pr-3 font-mono">{h.zone ? `${money(h.zone.buyHigh)} to ${money(h.zone.buyLow)}` : "–"}</td>
                      <td className="py-2 pr-3 font-mono">{h.zone ? `${money(h.zone.sellLow)} to ${money(h.zone.sellHigh)}` : "–"}</td>
                      <td className="py-2 pr-3 font-mono">{h.zone ? money(h.zone.fails) : "–"}</td>
                      <td className="py-2 pr-3 font-mono">{h.zone?.trigger ? money(h.zone.trigger) : "–"}</td>
                      <td className="py-2 pr-3 text-muted">{h.yourZone || "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 space-y-3">
              {report.holdings.map((h) => (
                <div key={h.symbol} className="text-[14px] leading-relaxed">
                  <span className="font-mono font-semibold">{h.symbol}</span> <span className="font-semibold">{h.verdict}</span>{h.action ? <span className="font-mono text-[13px]"> [{h.action}]</span> : null}: {h.verdictLine}
                  {h.edgeLine ? <span className="text-muted"> {h.edgeLine.charAt(0).toUpperCase() + h.edgeLine.slice(1)}.</span> : null}
                </div>
              ))}
            </div>
          </Section>

          {report.screen && report.screen.length > 0 && (
            <Section number="01b" title="The whole universe, by the model" description={`Every name the model scored today (${report.screen.length}), best rank first: its edge for today's market state, its trend, and the zones it would write for it. Names you hold or target are marked. This is the model's screener; it says nothing about a business, only about how names in this state and rank went on to do.`}>
              <div className="overflow-x-auto">
                <table className="table-zar">
                  <thead>
                    <tr>
                      <th>#</th><th>Name</th><th className="text-right">Last</th><th className="text-right">Day</th><th className="text-right">Edge</th><th>Trend</th><th className="text-right">60d vs index</th><th className="text-right">Vol</th><th className="text-right">Dip odds</th><th className="text-right">Buy zone</th><th className="text-right">Sell zone</th><th className="text-right">Fails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.screen.map((r) => (
                      <tr key={r.symbol} style={r.held || r.targetPct > 0 ? { background: "color-mix(in srgb, var(--accent) 7%, transparent)" } : undefined}>
                        <td className="font-mono mono-num text-muted">{r.rank}</td>
                        <td>
                          <span className="font-medium">{r.symbol}</span>
                          {r.held && <span className="pill ml-2" data-tone="positive">held</span>}
                          {!r.held && r.targetPct > 0 && <span className="pill ml-2" data-tone="muted">target {r.targetPct}%</span>}
                        </td>
                        <td className="text-right font-mono mono-num">{money(r.price)}</td>
                        <td className="text-right font-mono mono-num" style={{ color: r.dayChangePct >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(r.dayChangePct)}</td>
                        <td className="text-right font-mono mono-num" style={{ color: (r.edgePct ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>{r.edgePct != null ? pct(r.edgePct) : "–"}</td>
                        <td className="text-muted text-[12px]">{r.trend.toLowerCase()}</td>
                        <td className="text-right font-mono mono-num" style={{ color: r.rel60Pct >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(r.rel60Pct)}</td>
                        <td className="text-right font-mono mono-num">{r.vol60Pct.toFixed(0)}%</td>
                        <td className="text-right font-mono mono-num">{odds(r.dip)}</td>
                        <td className="text-right font-mono mono-num">{money(r.buyHigh)} to {money(r.buyLow)}</td>
                        <td className="text-right font-mono mono-num">{money(r.sellLow)} to {money(r.sellHigh)}</td>
                        <td className="text-right font-mono mono-num">{money(r.fails)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section number="02" title="Charts" description="A year of closes, the 50- and 200-day averages, the model's buy and sell zones shaded, your average cost, the fail level, and the projection as a fan to the right of the last bar: for the indices the wide range of past states like today's, for your names the market's median move plus the name's edge, a deviation either side.">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {[...report.indices, ...report.holdings].map((it) => (
                <Chart key={it.symbol} item={it} />
              ))}
            </div>
          </Section>

          <Section number="03" title="What the model is, and what it is worth" description="Every number the model produces is printed beside its out-of-sample record. Read this before trusting any of the above.">
            <Card>
              <Caption text={report.modelNote} />
            </Card>
            {rec?.calibration && rec.calibration.length === 10 && (
              <div className="overflow-x-auto mt-6">
                <div className="label-cap mb-2">What each tenth of the ranking then did, out of sample {rec.from} to {rec.to}, per {report.model?.horizon ?? 20} sessions</div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left label-cap border-b-2 border-ink">
                      <th className="py-2 pr-3">Tenth</th>
                      <th className="py-2 pr-3">Against the market</th>
                      <th className="py-2 pr-3">Outright</th>
                      <th className="py-2 pr-3">Share ahead of the market</th>
                      <th className="py-2 pr-3">Name-days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rec.calibration].reverse().map((c) => (
                      <tr key={c.decile} className="border-b border-[var(--rule)]">
                        <td className="py-2 pr-3">{c.decile === 10 ? "10 (top)" : c.decile === 1 ? "1 (bottom)" : c.decile}</td>
                        <td className="py-2 pr-3 font-mono">{pct(c.meanRelPct, 2)}</td>
                        <td className="py-2 pr-3 font-mono">{pct(c.meanRetPct, 2)}</td>
                        <td className="py-2 pr-3 font-mono">{odds(c.beatRate)}</td>
                        <td className="py-2 pr-3 font-mono">{c.n.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rec?.zones && (
              <div className="overflow-x-auto mt-6">
                <div className="label-cap mb-2">The zones out of sample: share of {rec.zones.n.toLocaleString()} paths that reached each level, the model's curve against a plain random walk's</div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left label-cap border-b-2 border-ink">
                      <th className="py-2 pr-3">Level</th>
                      <th className="py-2 pr-3">Built for</th>
                      <th className="py-2 pr-3">Model</th>
                      <th className="py-2 pr-3">Plain walk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ["Top of the buy zone", 0.5, rec.zones.buyHigh, rec.zones.walk.buyHigh],
                        ["Bottom of the buy zone", 0.25, rec.zones.buyLow, rec.zones.walk.buyLow],
                        ["Fail level", 0.1, rec.zones.fails, rec.zones.walk.fails],
                        ["Bottom of the sell zone", 0.5, rec.zones.sellLow, rec.zones.walk.sellLow],
                        ["Top of the sell zone", 0.25, rec.zones.sellHigh, rec.zones.walk.sellHigh],
                      ] as Array<[string, number, number, number]>
                    ).map(([name, built, m, w]) => (
                      <tr key={name} className="border-b border-[var(--rule)]">
                        <td className="py-2 pr-3">{name}</td>
                        <td className="py-2 pr-3 font-mono">{odds(built)}</td>
                        <td className="py-2 pr-3 font-mono">{odds(m)}</td>
                        <td className="py-2 pr-3 font-mono">{odds(w)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {report.strategy && (
              <div className="overflow-x-auto mt-6">
                <div className="label-cap mb-2">
                  The rule as a rule, {report.strategy.from} to {report.strategy.to}: {report.strategy.rebalances} non-overlapping periods, after 0.3% costs per rebalance on the model legs
                </div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left label-cap border-b-2 border-ink">
                      <th className="py-2 pr-3">Leg</th>
                      <th className="py-2 pr-3">A year</th>
                      <th className="py-2 pr-3">Worst fall</th>
                      <th className="py-2 pr-3">Worst year</th>
                      <th className="py-2 pr-3">In market</th>
                      <th className="py-2 pr-3">Periods up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.strategy.legs.map((l) => (
                      <tr key={l.name} className="border-b border-[var(--rule)]">
                        <td className="py-2 pr-3">{l.name}</td>
                        <td className="py-2 pr-3 font-mono">{pct(l.cagrPct)}</td>
                        <td className="py-2 pr-3 font-mono">{pct(l.maxDrawdownPct, 0)}</td>
                        <td className="py-2 pr-3 font-mono">{pct(l.worstYearPct, 0)}</td>
                        <td className="py-2 pr-3 font-mono">{l.inMarketPct.toFixed(0)}%</td>
                        <td className="py-2 pr-3 font-mono">{(l.positiveShare * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}
