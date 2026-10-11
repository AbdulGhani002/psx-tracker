import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { CompanyMark } from "@/components/ui/CompanyMark";
import { ZoneBar, ScoreMeter, money } from "@/app/analysis/ZoneBar";
import type { StrategyView, ResearchRow, SectorResearch, Research } from "@/lib/strategy/data";
import { ROUND_TRIP } from "@/lib/macro/learn";
import { displaySector } from "@/lib/calculations/sector-weights";

// The strategy model's parts of the strategy page (lib/macro/live.ts,
// lib/strategy/picks.ts): a card for each researched share, the buy list and
// the holdings, each ticked sector's shares, sectors ranked, times like now,
// what moves each sector, what each tenth of the ranking went on to do, what
// the system has learned so far, and how well the model has done.

type Macro = NonNullable<StrategyView["macro"]>;
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

type Tone = "positive" | "negative" | "muted";

function verdictOf(r: ResearchRow): { label: string; tone: Tone } {
  if (r.sell) {
    const s = r.sell;
    if (s.verdict === "sell") return { label: "Sell", tone: "negative" };
    if (s.verdict === "take-profit") return { label: s.sellAt != null && r.price != null && s.sellAt > r.price ? `Take profit at ${money(s.sellAt)}` : "Take profit", tone: "negative" };
    if (s.verdict === "hold") return { label: r.buy.verdict === "buy" || r.buy.verdict === "buy-at" ? "Hold, add" : "Hold", tone: r.buy.verdict === "buy" || r.buy.verdict === "buy-at" ? "positive" : "muted" };
    if (s.verdict === "thin") return { label: "Thin trading: no call", tone: "muted" };
    return { label: "No score", tone: "muted" };
  }
  const b = r.buy;
  switch (b.verdict) {
    case "buy":
      return { label: "Buy now", tone: "positive" };
    case "buy-at":
      return { label: `Buy at ${money(b.buyAt!)}`, tone: "positive" };
    case "wait":
      return { label: "Wait", tone: "muted" };
    case "avoid":
      return { label: "Avoid", tone: "negative" };
    case "thin":
      return { label: "Thin trading", tone: "muted" };
    default:
      return { label: "No score", tone: "muted" };
  }
}

// P/E now in green in the bottom quarter of its own range, in red in the top.
function Pe({ r, rate }: { r: ResearchRow; rate: number | null }) {
  if (r.pe == null) return <span className="text-muted">P/E —</span>;
  const span = r.peLo != null && r.peHi != null && r.peHi > r.peLo ? (r.pe - r.peLo) / (r.peHi - r.peLo) : null;
  const color = span == null ? undefined : span <= 0.25 ? "var(--positive)" : span >= 0.75 ? "var(--negative)" : undefined;
  return (
    <span className="whitespace-nowrap" title={r.fairPe != null && rate != null ? `Usual: its median P/E when the policy rate was near ${rate}%` : undefined}>
      P/E <span className="mono-num font-semibold" style={{ color }}>{r.pe.toFixed(1)}</span>
      {r.fairPe != null && <span className="text-muted"> · usual <span className="mono-num">{r.fairPe.toFixed(1)}</span></span>}
    </span>
  );
}

// The expected edge: what the share should do against the market over the
// next three months, green over the costs of a trade, red under minus them.
function Edge({ edge }: { edge: number | null }) {
  if (edge == null) return null;
  const color = edge >= ROUND_TRIP ? "var(--positive)" : edge <= -ROUND_TRIP ? "var(--negative)" : "var(--muted)";
  return (
    <span className="block text-right text-[11.5px] mono-num" style={{ color }} title="Expected against the market over the next 3 months">
      {pct(edge)} in 3m
    </span>
  );
}

export function ShareCard({ r, rate }: { r: ResearchRow; rate: number | null }) {
  const v = verdictOf(r);
  const facts = [
    r.dividendYieldPct != null ? `Yield ${r.dividendYieldPct.toFixed(1)}%` : null,
    r.roePct != null ? `ROE ${r.roePct.toFixed(0)}%` : null,
    r.ret12 != null ? `Year ${pct(r.ret12, 0)}` : null,
    r.grade ? `Grade ${r.grade}` : null,
  ].filter(Boolean);
  return (
    <div className="card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <Link href={r.held ? `/holdings/${r.symbol}` : `/stock/${r.symbol}`} className="flex items-center gap-2.5 min-w-0 group">
          <CompanyMark symbol={r.symbol} size="sm" />
          <div className="min-w-0">
            <div className="text-[14px] font-bold leading-tight group-hover:text-[var(--accent-deep)]">
              {r.symbol}
              {r.held && <span className="pill ml-1.5 align-middle" data-tone="positive">held</span>}
            </div>
            <div className="text-[11.5px] text-muted truncate max-w-[180px]">{r.name}</div>
          </div>
        </Link>
        {r.thin ? (
          <span className="text-[11.5px] text-muted whitespace-nowrap">thin</span>
        ) : (
          <span>
            <ScoreMeter pctile={r.pctile} />
            <Edge edge={r.edge} />
          </span>
        )}
      </div>
      <div className="mt-2 text-[12.5px] flex flex-wrap gap-x-3 gap-y-0.5">
        <Pe r={r} rate={rate} />
        {facts.map((f) => (
          <span key={f} className="text-muted whitespace-nowrap">{f}</span>
        ))}
      </div>
      {r.june.length > 1 && (
        <div className="text-[11px] text-muted mt-0.5 mono-num">
          P/E 30 June: {r.june.map(([y, v]) => `’${y.slice(2)} ${v}`).join(" · ")}
        </div>
      )}
      {r.yieldJune.some(([, v]) => v > 0) && (
        <div className="text-[11px] text-muted mono-num">
          Yield 30 June: {r.yieldJune.slice(-5).map(([y, v]) => `’${y.slice(2)} ${v}%`).join(" · ")}
        </div>
      )}
      <div className="mt-2.5">
        {r.zone && r.price != null ? <ZoneBar price={r.price} buyLow={r.zone.buyLow} buyHigh={r.zone.buyHigh} sellLow={r.zone.sellLow} sellHigh={r.zone.sellHigh} stop={r.zone.fails} compact /> : <p className="text-[12px] text-muted">No zones yet.</p>}
      </div>
      <div className="mt-2">
        <span className="pill whitespace-nowrap" data-tone={v.tone}>{v.label}</span>
      </div>
    </div>
  );
}

export function BuyListCard({ r }: { r: Research }) {
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-[17px] font-bold">Buy list</h2>
        <Link href="/strategy?tab=research" className="text-[12px] link-underline">
          {r.watched.sectors > 0 ? `All ${r.watched.shares} shares of ${r.watched.sectors} sectors` : "Tick sectors"}
        </Link>
      </div>
      {r.watched.sectors === 0 ? (
        <Card><p className="text-[13px] text-muted">Tick sectors on the <Link href="/watchlist" className="link-underline">Watchlist</Link>.</p></Card>
      ) : r.buys.length === 0 ? (
        <Card><p className="text-[13px] text-muted">Nothing to buy in your sectors today.</p></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {r.buys.slice(0, 6).map((x) => (
            <ShareCard key={x.symbol} r={x} rate={r.rateNow} />
          ))}
        </div>
      )}
    </section>
  );
}

export function HoldingsCard({ r }: { r: Research }) {
  if (r.held.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-[17px] font-bold">Holdings: keep or sell</h2>
        <span className="text-[12px] text-muted">Sell calls are for held shares only</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {r.held.map((x) => (
          <ShareCard key={x.symbol} r={x} rate={r.rateNow} />
        ))}
      </div>
    </section>
  );
}

// "Gains with oil", "loses when rates rise": the factors a sector moved with,
// month by month, where the link held (|t| 2 or more).
const HINT: Record<string, [string, string]> = {
  oil: ["gains with oil", "loses with oil"],
  rupee: ["gains when the rupee falls", "loses when the rupee falls"],
  gold: ["gains with gold", "loses with gold"],
  policy: ["gains when rates rise", "loses when rates rise"],
  "US stocks": ["gains with US stocks", "loses with US stocks"],
};
export function hintsFor(m: Macro | null, sector: string): string[] {
  const row = m?.model.sensitivities.rows.find((r) => r.sector === sector);
  if (!m || !row) return [];
  return m.model.sensitivities.factors.map((f, j) => (Math.abs(row.t[j]) >= 2 ? HINT[f]?.[row.beta[j] > 0 ? 0 : 1] : null)).filter((x): x is string => !!x);
}

export function ResearchSector({ sec, m, rate, open }: { sec: SectorResearch; m: Macro | null; rate: number | null; open: boolean }) {
  const hints = hintsFor(m, sec.sector);
  const buys = sec.rows.filter((r) => !r.held && (r.buy.verdict === "buy" || r.buy.verdict === "buy-at")).length;
  return (
    <details className="card mt-3" open={open}>
      <summary className="cursor-pointer select-none px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="min-w-0">
          <span className="font-semibold text-[15px]">{sec.name}</span>
          <span className="text-[12px] text-muted ml-2">
            {sec.rows.length} shares{buys > 0 ? ` · ${buys} to buy` : ""}
            {sec.peNow != null ? ` · P/E ${sec.peNow.toFixed(1)}${sec.peFair != null ? `, usual ${sec.peFair.toFixed(1)}` : ""}` : ""}
          </span>
          {hints.length > 0 && <span className="block text-[11.5px] text-muted">{hints.join(", ")}</span>}
        </span>
        <ScoreMeter pctile={sec.pctile} />
      </summary>
      <div className="px-4 pb-4">
        {sec.rows.length === 0 ? (
          <p className="text-[13px] text-muted">No share of it has traded lately.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {sec.rows.map((r) => (
              <ShareCard key={r.symbol} r={r} rate={rate} />
            ))}
          </div>
        )}
        {sec.quiet > 0 && <p className="text-[12px] text-muted mt-3">{sec.quiet} more not traded lately.</p>}
      </div>
    </details>
  );
}

export function SectorsCard({ m }: { m: Macro }) {
  const top = m.sectors.slice(0, 8);
  const extra = m.sectors.filter((s) => s.watched && !top.includes(s));
  return (
    <Card title="Sectors" action={<span className="text-[12px] text-muted">Model, next 3 months</span>}>
      <ul className="space-y-2">
        {[...top, ...extra].map((s) => {
          const rank = m.sectors.indexOf(s) + 1;
          const hints = hintsFor(m, s.sector);
          return (
            <li key={s.sector} className="flex items-start justify-between gap-3 text-[13px]">
              <div className="min-w-0">
                <span className="text-muted mono-num mr-2">{rank}</span>
                <span className="font-semibold">{s.name}</span>
                {s.watched && <span className="pill ml-2" data-tone="positive">ticked</span>}
                {hints.length > 0 && <div className="text-[11.5px] text-muted ml-5">{hints.join(", ")}</div>}
              </div>
              <ScoreMeter pctile={s.pctile} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function AnalogsCard({ m }: { m: Macro }) {
  const names = m.model.analogNames;
  const v = (n: string) => m.state[names.indexOf(n)] ?? null;
  const ups = m.analogs.filter((a) => (a.mkt12 ?? 0) > 0).length;
  const known = m.analogs.filter((a) => a.mkt12 != null);
  const med = known.length ? [...known.map((a) => a.mkt12!)].sort((a, b) => a - b)[Math.floor(known.length / 2)] : null;
  const split = known.length > 0 && ups > 0 && ups < known.length && Math.abs(ups - known.length / 2) <= 1;
  return (
    <Card title="Times like now" action={<span className="text-[12px] text-muted">{`Policy ${v("policy")?.toFixed(1) ?? "—"}%, CPI ${v("cpi")?.toFixed(1) ?? "—"}%, oil ${pct(v("oil12"), 0)} a year`}</span>}>
      {m.analogs.length === 0 ? (
        <p className="text-[13px] text-muted">No close match in the history.</p>
      ) : (
        <>
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead>
                <tr><th>Month</th><th className="text-right">Policy</th><th className="text-right">CPI</th><th className="text-right">Market 6m</th><th className="text-right">12m</th><th>Best after</th></tr>
              </thead>
              <tbody>
                {m.analogs.map((a) => (
                  <tr key={a.date}>
                    <td className="whitespace-nowrap">{month(a.date)}</td>
                    <td className="text-right mono-num">{Number.isFinite(a.x[names.indexOf("policy")]) ? `${a.x[names.indexOf("policy")]}%` : "—"}</td>
                    <td className="text-right mono-num">{Number.isFinite(a.x[names.indexOf("cpi")]) ? `${a.x[names.indexOf("cpi")].toFixed(1)}%` : "—"}</td>
                    <td className="text-right mono-num" style={{ color: (a.mkt6 ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(a.mkt6, 0)}</td>
                    <td className="text-right mono-num" style={{ color: (a.mkt12 ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(a.mkt12, 0)}</td>
                    <td className="text-[12px] text-muted">{a.best.slice(0, 2).map(([s]) => displaySector(s)).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted mt-3">
            {split ? "History is split: " : ""}the market rose over the next year in {ups} of {known.length}, by {pct(med, 0)} at the middle.
          </p>
        </>
      )}
    </Card>
  );
}

export function SensitivityCard({ m }: { m: Macro }) {
  const { factors, rows } = m.model.sensitivities;
  const shown = rows.filter((r) => r.t.some((t) => Math.abs(t) >= 2));
  const label: Record<string, string> = { oil: "Oil +10%", rupee: "Rupee −10%", gold: "Gold +10%", policy: "Rates +1 pt", "US stocks": "US +10%" };
  const cell = (b: number, t: number, f: string) => {
    if (Math.abs(t) < 2) return <span className="text-muted">·</span>;
    const v = f === "policy" ? b : b * 0.1;
    const c = v >= 0 ? "var(--positive)" : "var(--negative)";
    return <span className="mono-num px-1.5 py-0.5 rounded" style={{ color: c, background: `color-mix(in srgb, ${c} ${Math.min(30, 8 + Math.abs(v) * 400)}%, transparent)` }}>{pct(v)}</span>;
  };
  return (
    <Card title="What moves each sector" action={<span className="text-[12px] text-muted">A month against the market, 2004 on</span>}>
      <div className="overflow-x-auto -mx-2">
        <table className="table-zar">
          <thead>
            <tr><th>Sector</th>{factors.map((f) => <th key={f} className="text-center whitespace-nowrap">{label[f] ?? f}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.sector}>
                <td className="whitespace-nowrap">{displaySector(r.sector)}</td>
                {factors.map((f, j) => <td key={f} className="text-center">{cell(r.beta[j], r.t[j], f)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted mt-3">Only links that held over the years are shown.</p>
    </Card>
  );
}

export function RecordCard({ m }: { m: Macro }) {
  const r = m.model.record;
  const best = [...m.model.baselines].sort((a, b) => b.ic - a.ic)[0];
  const t = m.model.timing;
  return (
    <Card title="How good is the model" action={<span className="text-[12px] text-muted">Tested on years it never saw, 2008 on</span>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[12.5px]">
        <div><div className="text-muted">Best fifth beat worst</div><div className="text-[16px] font-semibold mono-num">{pct(r.spread)}</div><div className="text-muted">per 3 months, {Math.round(r.hit * 100)}% of the time</div></div>
        <div><div className="text-muted">Ranking skill (IC)</div><div className="text-[16px] font-semibold mono-num">{r.ic.toFixed(2)}</div><div className="text-muted">{best ? `${best.name}: ${best.ic.toFixed(2)}` : ""}</div></div>
        <div><div className="text-muted">Sector skill (IC)</div><div className="text-[16px] font-semibold mono-num">{r.sectorIc.toFixed(2)}</div><div className="text-muted">{r.months} months</div></div>
        <div><div className="text-muted">When to be in stocks</div><div className="text-[16px] font-semibold mono-num">200-day</div><div className="text-muted">{pct(t.trend.cagr, 0)} a year, worst {pct(t.trend.maxDd, 0)}; macro {pct(t.macro.cagr, 0)}, worst {pct(t.macro.maxDd, 0)}</div></div>
      </div>
    </Card>
  );
}

// What each tenth of the ranking went on to do over the next three months
// against the market: the tested record (2008 on, years the network never
// saw), moved toward the live outcomes once there are some.
export function CalibrationCard({ m }: { m: Macro }) {
  const cal = m.learning.calibration;
  const top = Math.max(0.005, ...cal.map((c) => Math.abs(c.rel3)));
  const live = m.learning.live.outcomes;
  return (
    <Card title="What the ranks went on to do" action={<span className="text-[12px] text-muted">3 months against the market{live > 0 ? `, with ${live.toLocaleString("en-US")} live calls` : ", 2008 on"}</span>}>
      <div className="flex items-stretch gap-1.5 h-40" role="img" aria-label={`Bottom tenth ${pct(cal[0].rel3)}, top tenth ${pct(cal[cal.length - 1].rel3)}`}>
        {cal.map((c, k) => {
          const h = (Math.abs(c.rel3) / top) * 38;
          const up = c.rel3 >= 0;
          return (
            <div key={k} className="flex-1 flex flex-col items-center min-w-0">
              <div className="relative w-full flex-1">
                <div className="absolute left-0 right-0 top-1/2 h-px" style={{ background: "var(--rule-strong)" }} />
                <div
                  className="absolute left-[12%] right-[12%] rounded-sm"
                  style={{ [up ? "bottom" : "top"]: "50%", height: `${h}%`, background: up ? "var(--positive)" : "var(--negative)", opacity: 0.8 }}
                />
                <span className="absolute left-0 right-0 text-center text-[10px] mono-num" style={{ [up ? "bottom" : "top"]: `calc(50% + ${h}% + 2px)` }}>{(c.rel3 * 100).toFixed(1)}</span>
              </div>
              <span className="text-[10.5px] text-muted mono-num mt-1">{k + 1}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-muted mt-2">Tenths of the model&apos;s ranking, worst to best: the average % each went on to beat (or trail) the market by. Calls need more than {Math.round(ROUND_TRIP * 100)}% to cover a trade&apos;s costs.</p>
    </Card>
  );
}

// What the system has learned so far, and what it is collecting.
export function LearningCard({ m }: { m: Macro }) {
  const l = m.learning;
  const v = l.value;
  const since = l.live.since ? new Date(l.live.since + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;
  return (
    <Card title="Learning" action={<span className="text-[12px] text-muted">Updated after every close</span>}>
      <ul className="space-y-2 text-[13px]">
        <li>
          <span className="font-semibold">Calls kept:</span> {l.live.signals.toLocaleString("en-US")}{since ? ` since ${since}` : ""}.{" "}
          {l.live.outcomes > 0 ? `${l.live.outcomes.toLocaleString("en-US")} checked against what followed; the expected edges now lean on them.` : "Each is checked three months on, and the expected edges move toward what really happened."}
        </li>
        <li>
          <span className="font-semibold">P/E against its usual:</span>{" "}
          {v.holds
            ? `counts: ${pct(v.beta * Math.log(1.2))} in 3 months for a P/E a fifth over its usual (t ${v.t.toFixed(1)} over ${v.quarters} quarters).`
            : `no edge found yet (t ${v.t.toFixed(1)} over ${v.quarters} quarters${v.from ? `, ${v.from.slice(0, 4)}–${v.to?.slice(0, 4)}` : ""}), so it does not move the calls. Tested again every day.`}
        </li>
        <li>
          <span className="font-semibold">Dividends:</span> each one is read off the exchange&apos;s closing file the evening it goes ex, so every share&apos;s yield history keeps itself.
        </li>
      </ul>
    </Card>
  );
}
