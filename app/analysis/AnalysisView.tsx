import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import type { IndexForecasts, IndexView } from "@/lib/index-week/data";
import type { Levels, RecordSummary } from "@/lib/index-week/forecast";
import { ZoneBar, money } from "./ZoneBar";
import { MarketStudiesCards } from "./MarketStudiesCards";
import type { MarketStudies } from "@/lib/market-history";

// The model: where each index is likely to be a week and a month on, and how
// often those levels have held (lib/index-week). Nothing about single shares.

const pct = (v: number) => `${Math.round(v * 100)}%`;
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const Tick = ({ ok }: { ok: boolean }) => <span style={{ color: ok ? "var(--positive)" : "var(--negative)" }}>{ok ? "✓" : "✗"}</span>;

function Horizon({ title, l }: { title: string; l: Levels | null }) {
  if (!l) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-[12px] text-muted">
          Likely <span className="mono-num font-semibold" style={{ color: "var(--ink)" }}>{money(l.range[0])}–{money(l.range[1])}</span>
        </div>
      </div>
      <div className="mt-2">
        <ZoneBar price={l.close} buyLow={l.buy[0]} buyHigh={l.buy[1]} sellLow={l.sell[0]} sellHigh={l.sell[1]} />
      </div>
    </div>
  );
}

function Record({ t, last, live, label }: { t: RecordSummary; last: RecordSummary; live: RecordSummary; label: string }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12.5px]">
      <div>
        <div className="text-muted">Inside the range</div>
        <div className="text-[16px] font-semibold mono-num">{pct(t.range)} <span className="text-[11.5px] font-normal text-muted">aim 80%</span></div>
      </div>
      <div>
        <div className="text-muted">Low reached buy</div>
        <div className="text-[16px] font-semibold mono-num">{pct(t.buy)} <span className="text-[11.5px] font-normal text-muted">aim 50%</span></div>
      </div>
      <div>
        <div className="text-muted">High reached sell</div>
        <div className="text-[16px] font-semibold mono-num">{pct(t.sell)} <span className="text-[11.5px] font-normal text-muted">aim 50%</span></div>
      </div>
      <div>
        <div className="text-muted">Typical miss</div>
        <div className="text-[16px] font-semibold mono-num">{t.missPct.toFixed(1)}%</div>
      </div>
      <div className="col-span-2 sm:col-span-4 text-[11.5px] text-muted">
        {label}: {t.n} weeks from {t.from ? short(t.from) : "—"}, each set only from the days before it. Last 52 weeks: inside {pct(last.range)}, buy {pct(last.buy)}, sell {pct(last.sell)}.
        {live.n > 0 ? ` Live since publishing: ${live.n} week${live.n === 1 ? "" : "s"}, inside ${pct(live.range)}.` : " Live record starts this week."}
      </div>
    </div>
  );
}

function MainIndex({ i }: { i: IndexView }) {
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-[18px] font-bold">{i.label}</span>{" "}
          <span className="text-[18px] font-semibold mono-num">{money(i.close)}</span>
          {i.weekChangePct != null && (
            <span className="ml-2 text-[13px] mono-num" style={{ color: i.weekChangePct >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {i.weekChangePct >= 0 ? "+" : ""}{i.weekChangePct.toFixed(1)}% this week
            </span>
          )}
        </div>
        <span className="text-[12px] text-muted">close of {day(i.date)}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
        <Horizon title="Next week" l={i.week} />
        <Horizon title="Next month" l={i.month} />
      </div>
      <div className="mt-5 pt-4 border-t border-rule">
        <Record t={i.tested.week} last={i.tested.weekLastYear} live={i.live} label="Tested" />
      </div>
    </Card>
  );
}

function OtherIndex({ i }: { i: IndexView }) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className="text-[15px] font-bold">{i.label}</span> <span className="mono-num font-semibold">{money(i.close)}</span>
        </div>
        {i.weekChangePct != null && (
          <span className="text-[12px] mono-num" style={{ color: i.weekChangePct >= 0 ? "var(--positive)" : "var(--negative)" }}>{i.weekChangePct >= 0 ? "+" : ""}{i.weekChangePct.toFixed(1)}%</span>
        )}
      </div>
      <div className="mt-3">
        <Horizon title="Next week" l={i.week} />
      </div>
      <div className="mt-3 text-[12px] text-muted">
        Next month likely <span className="mono-num">{i.month ? `${money(i.month.range[0])}–${money(i.month.range[1])}` : "—"}</span> · inside the weekly range {pct(i.tested.week.range)} of {i.tested.week.n} weeks
      </div>
    </Card>
  );
}

export function AnalysisView({ f, studies = null }: { f: IndexForecasts | null; studies?: MarketStudies | null }) {
  const main = f?.indexes.find((i) => i.code === "KSE100") ?? f?.indexes[0] ?? null;
  const others = (f?.indexes ?? []).filter((i) => i !== main);
  return (
    <div className="fade-in">
      <PageHeader title="Model" subtitle="Where the indexes are likely to be next week and next month, and how often it has been right." />
      {!main ? (
        <Card><p className="text-[13px] text-muted">Not enough index history yet: it needs a year of closes.</p></Card>
      ) : (
        <div className="space-y-3">
          <MainIndex i={main} />
          {others.length > 0 && <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{others.map((i) => <OtherIndex key={i.code} i={i} />)}</div>}

          <Card title={`${main.label}, week by week`}>
            <div className="overflow-x-auto -mx-2">
              <table className="table-zar">
                <thead>
                  <tr><th>Week from</th><th className="text-right">Close</th><th className="text-right">Likely range</th><th className="text-right">Closed at</th><th className="text-center">Inside</th><th className="text-center">Buy</th><th className="text-center">Sell</th></tr>
                </thead>
                <tbody>
                  {main.weeks.map((w) => (
                    <tr key={w.levels.asOf}>
                      <td>{short(w.levels.asOf)}</td>
                      <td className="text-right mono-num">{money(w.levels.close)}</td>
                      <td className="text-right mono-num whitespace-nowrap">{money(w.levels.range[0])}–{money(w.levels.range[1])}</td>
                      <td className="text-right mono-num">{money(w.outcome.close)}</td>
                      <td className="text-center"><Tick ok={w.hits.range} /></td>
                      <td className="text-center"><Tick ok={w.hits.buy} /></td>
                      <td className="text-center"><Tick ok={w.hits.sell} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-muted mt-2">Buy: the week&apos;s lowest close got to the buy level. Sell: its highest close got to the sell level. Each should happen about half the time.</p>
          </Card>

          <details className="text-[12.5px] text-muted">
            <summary className="cursor-pointer select-none">How it works</summary>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li>From each index&apos;s own closes: how far it moved over every past week and month, measured against how jumpy it was at the time, recent years weighted more.</li>
              <li>Likely range: the close lands inside 8 times in 10. Buy zone: the lowest close reaches its top half the time, its bottom 1 time in 5. Sell zone the same way up.</li>
              <li>It does not say which way the index will go; nothing does reliably. It says how far it usually travels, and the record shows how often that held.</li>
              <li>Worked out again after every close. Telegram sends the week ahead each Friday evening.</li>
            </ul>
          </details>
        </div>
      )}
      {studies && studies.patterns.months.length > 0 && (
        <div className="space-y-3 mt-3">
          <MarketStudiesCards s={studies} />
        </div>
      )}
    </div>
  );
}
