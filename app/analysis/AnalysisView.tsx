import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { CompanyMark } from "@/components/ui/CompanyMark";
import type { StoredReport, StoredReportItem, ScreenRow } from "@/lib/quant/report";
import { RefreshAnalysis } from "./RefreshAnalysis";
import { ZoneBar, ScoreMeter, money } from "./ZoneBar";

// The model at a glance: the market's state, then every name you hold or
// target as one card with its buy and sell zones on a price line, then the
// strongest names in the market. The long-form reading, the charts and the
// model's full record live on /analysis/details.

type Tone = "buy" | "sell" | "wait" | "hold";
const CHIP: Record<string, { label: string; tone: Tone }> = {
  BUY: { label: "BUY", tone: "buy" },
  STAGE: { label: "BUY IN ZONE", tone: "buy" },
  WATCH: { label: "WATCH", tone: "wait" },
  WAIT: { label: "WAIT", tone: "wait" },
  HOLD: { label: "HOLD", tone: "hold" },
  TRIM: { label: "TRIM", tone: "sell" },
  SELL: { label: "SELL", tone: "sell" },
  EXIT: { label: "SELL ALL", tone: "sell" },
  AVOID: { label: "AVOID", tone: "sell" },
  PASS: { label: "PASS", tone: "hold" },
};
const TONE_COLOR: Record<Tone, string> = { buy: "var(--positive)", sell: "var(--negative)", wait: "var(--amber)", hold: "var(--muted)" };

function Chip({ label, tone }: { label: string; tone: Tone }) {
  const c = TONE_COLOR[tone];
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.04em] whitespace-nowrap" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)` }}>
      {label}
    </span>
  );
}

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const n = (k: number) => k.toLocaleString("en-US");

// What to do, in one short line.
function todo(h: StoredReportItem): string {
  const buy = h.plan?.buyShares ? ` ${n(h.plan.buyShares)} shares` : "";
  const sell = h.plan?.sellShares ? ` ${n(h.plan.sellShares)} shares` : "";
  switch (h.verdict) {
    case "BUY": return `Buy${buy}: half now, half in the green zone`;
    case "STAGE": return `Buy${buy} in the green zone`;
    case "WATCH": return h.zone?.trigger ? `Buy on a close above ${money(h.zone.trigger)}, or in the green zone` : "Buy in the green zone";
    case "WAIT": return "Buy in the green zone once the market turns";
    case "HOLD": return "Hold. Take profit in the red zone";
    case "TRIM": return `Trim${sell} in the red zone`;
    case "SELL": return "Sell into the red zone";
    case "EXIT": return `Sell all${sell}`;
    case "AVOID": return "Don't buy while it ranks this low";
    case "PASS": return "Stronger names are available";
    default: return "";
  }
}

const MARKET = {
  STRONG: { tone: "buy" as Tone, line: "Broad rally. The model is fully invested." },
  MIXED: { tone: "wait" as Tone, line: "Index up, but few stocks are joining. Buy only the strongest." },
  WEAK: { tone: "sell" as Tone, line: "Index below its 200-day average. Hold cash, add nothing new." },
};

function NameCard({ h, showDip }: { h: StoredReportItem; showDip: boolean }) {
  const chip = CHIP[h.verdict] ?? { label: h.verdict, tone: "hold" as Tone };
  const z = h.zone;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <Link href={`/holdings/${h.symbol}`} className="flex items-center gap-3 min-w-0 group">
          <CompanyMark symbol={h.symbol} size="md" />
          <div className="min-w-0">
            <div className="text-[16px] font-bold leading-tight group-hover:text-[var(--accent-deep)]">{h.symbol}</div>
            <div className="text-[13px] mono-num">
              Rs {money(h.last)} <span style={{ color: h.dayChangePct >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(h.dayChangePct)}</span>
            </div>
          </div>
        </Link>
        <Chip {...chip} />
      </div>
      {z ? (
        <div className="mt-4">
          <ZoneBar price={h.last} buyLow={z.buyLow} buyHigh={z.buyHigh} sellLow={z.sellLow} sellHigh={z.sellHigh} stop={z.fails} />
        </div>
      ) : (
        <p className="mt-4 text-[12.5px] text-muted">No zones today: not enough history for this name.</p>
      )}
      <div className="mt-3 text-[13px] font-medium">{todo(h)}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        <ScoreMeter pctile={h.pctile} />
        {z && <span>Stop <span className="mono-num font-semibold" style={{ color: "var(--negative)" }}>{money(z.fails)}</span></span>}
        {showDip && h.forecast && <span>Dip odds <span className="mono-num font-semibold" style={{ color: "var(--ink)" }}>{Math.round(h.forecast.dip * 100)}%</span></span>}
        {h.plan && <span>Weight <span className="mono-num font-semibold" style={{ color: "var(--ink)" }}>{h.plan.currentPct.toFixed(1)}%</span>{h.plan.targetPct > 0 ? ` / ${h.plan.targetPct.toFixed(0)}%` : ""}</span>}
      </div>
    </Card>
  );
}

function PickCard({ r }: { r: ScreenRow }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <Link href={`/stock/${r.symbol}`} className="flex items-center gap-2.5 min-w-0 group">
          <CompanyMark symbol={r.symbol} size="sm" />
          <div className="min-w-0">
            <div className="text-[14px] font-bold leading-tight group-hover:text-[var(--accent-deep)]">{r.symbol}</div>
            <div className="text-[12px] mono-num">
              Rs {money(r.price)} <span style={{ color: r.dayChangePct >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(r.dayChangePct)}</span>
            </div>
          </div>
        </Link>
        <ScoreMeter pctile={r.pctile} />
      </div>
      <div className="mt-3">
        <ZoneBar price={r.price} buyLow={r.buyLow} buyHigh={r.buyHigh} sellLow={r.sellLow} sellHigh={r.sellHigh} stop={r.fails} compact />
      </div>
    </Card>
  );
}

export function AnalysisView({ report }: { report: StoredReport | null }) {
  const kse = report?.indices.find((i) => i.symbol === "KSE100") ?? report?.indices[0] ?? null;
  const market = report?.market ?? null;
  const m = market ? MARKET[market.state] : null;
  const picks = (report?.screen ?? []).filter((r) => !r.held && r.targetPct <= 0).slice(0, 6);
  const cal = report?.record?.calibration ?? null;
  const top = cal?.find((c) => c.decile === 10), bottom = cal?.find((c) => c.decile === 1);
  const zones = report?.record?.zones ?? null;
  // Dip odds are shown only when their out-of-sample record clears the same
  // bar the report uses before it lets them decide anything (AUC 0.58).
  const showDip = (report?.record?.dip?.auc ?? 0) >= 0.58;

  return (
    <>
      <PageHeader title="Model" subtitle="Where to buy and where to sell over the next 20 trading days.">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
          {report && <span className="text-muted">As of {report.date}</span>}
          <RefreshAnalysis />
          {report && <Link href="/swing" className="link-underline">Swing trades →</Link>}
          {report && <Link href="/analysis/details" className="link-underline">Full report →</Link>}
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
              {market && m && <Chip label={`MARKET ${market.state}`} tone={m.tone} />}
              {m && <span className="text-[14px] font-medium">{m.line}</span>}
            </div>
            {market && (
              <div className="mt-2 text-[12.5px] text-muted">
                {market.breadth200Pct.toFixed(0)}% of stocks above their 200-day average
                {kse?.outlook ? ` · KSE-100 higher in 20 days ${Math.round(kse.outlook.pUp * 100)}% of the time after days like this` : ""}
              </div>
            )}
            {kse?.zone && (
              <div className="mt-4">
                <div className="text-[12px] font-semibold mb-1.5">KSE-100</div>
                <ZoneBar price={kse.last} buyLow={kse.zone.buyLow} buyHigh={kse.zone.buyHigh} sellLow={kse.zone.sellLow} sellHigh={kse.zone.sellHigh} stop={kse.zone.fails} />
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-rule flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px] text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-2.5 rounded-sm" style={{ background: "color-mix(in srgb, var(--positive) 24%, transparent)", border: "1px solid color-mix(in srgb, var(--positive) 60%, transparent)" }} />Buy zone: dips usually stall here</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-2.5 rounded-sm" style={{ background: "color-mix(in srgb, var(--negative) 20%, transparent)", border: "1px solid color-mix(in srgb, var(--negative) 55%, transparent)" }} />Sell zone: rallies usually stall here</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-[2px] h-3 rounded-full" style={{ background: "var(--negative)" }} />Stop: below it the idea failed</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--ink)" }} />Today</span>
            </div>
          </Card>

          <section>
            <h2 className="text-[17px] font-bold mb-3">Your stocks</h2>
            {report.holdings.length === 0 ? (
              <Card><p className="text-[13px] text-muted">Nothing held or targeted yet.</p></Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {report.holdings.map((h) => <NameCard key={h.symbol} h={h} showDip={showDip} />)}
              </div>
            )}
          </section>

          {picks.length > 0 && (
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <h2 className="text-[17px] font-bold">Strongest in the market</h2>
                <span className="text-[12px] text-muted">{market?.state === "WEAK" ? "Buy only once the market turns" : "Ranked by the model"}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {picks.map((r) => <PickCard key={r.symbol} r={r} />)}
              </div>
            </section>
          )}

          {(top || zones) && (
            <Card>
              <div className="text-[13px] font-semibold mb-2">How good is it</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12.5px]">
                {top && bottom && (
                  <div>
                    <div className="text-muted">Score 10 vs score 1, per 20 days vs the market</div>
                    <div className="mt-0.5 text-[15px] font-semibold mono-num">
                      <span style={{ color: "var(--positive)" }}>{pct(top.meanRelPct, 2)}</span> vs <span style={{ color: "var(--negative)" }}>{pct(bottom.meanRelPct, 2)}</span>
                    </div>
                  </div>
                )}
                {zones && (
                  <div>
                    <div className="text-muted">Price reached the buy zone</div>
                    <div className="mt-0.5 text-[15px] font-semibold mono-num">{Math.round(zones.buyHigh * 100)}% <span className="text-[12px] font-normal text-muted">of the time (built for 50%)</span></div>
                  </div>
                )}
                {report.record && (
                  <div>
                    <div className="text-muted">Tested out of sample</div>
                    <div className="mt-0.5 text-[15px] font-semibold mono-num">{report.record.from.slice(0, 4)}–{report.record.to.slice(0, 4)} <span className="text-[12px] font-normal text-muted">{report.record.names} stocks</span></div>
                  </div>
                )}
              </div>
              {report.model?.net && (
                <div className="mt-3 text-[12px] text-muted">
                  Ranking: boosted trees {Math.round((1 - report.model.net.blend) * 100)}% + PSX-Net neural network {Math.round(report.model.net.blend * 100)}%
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
