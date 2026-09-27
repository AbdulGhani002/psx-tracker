import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { CompanyMark } from "@/components/ui/CompanyMark";
import type { StoredReport } from "@/lib/quant/report";
import type { SwingBook } from "@/lib/quant/swing-book";
import { SWING_BOOK_RULE, addSessions, bookLevels, sessionsBetween, tradeReturnPct, type BookTrade, type SwingTested } from "@/lib/quant/swing";
import { sigmaOverHorizon } from "@/lib/quant/features";
import { ScoreMeter, money } from "@/app/analysis/ZoneBar";
import { RefreshAnalysis } from "@/app/analysis/RefreshAnalysis";
import { BookBar } from "./BookBar";

// The swing book: five trades at a time, each bought at a close, with a stop,
// a target twice as far away and a date to sell by, all fixed on the day it
// is bought. The evening job (lib/quant/swing-book.ts) moves it on after
// every close; this page only shows it, beside the rule's tested record.

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const tone = (v: number) => (v >= 0 ? "var(--positive)" : "var(--negative)");
// Written out by hand: the server's and the browser's locale data disagree on
// "Sep" and "Sept".
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string, withYear = false) => {
  const t = new Date(d + "T00:00:00Z");
  return withYear ? `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}` : `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
};

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="text-[18px] font-bold mono-num leading-tight" style={{ color: color ?? "var(--ink)" }}>{value}</div>
      {sub && <div className="text-[11px] text-muted mono-num">{sub}</div>}
    </div>
  );
}

function Level({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted text-[11px]">{label}</div>
      <div className="font-semibold mono-num text-[13px]" style={{ color }}>{value}</div>
      {sub && <div className="text-muted text-[11px] mono-num">{sub}</div>}
    </div>
  );
}

function Why({ t }: { t: BookTrade }) {
  const [label, color] = t.exitReason === "target" ? ["Target", "var(--positive)"] : t.exitReason === "stop" ? ["Stop", "var(--negative)"] : ["Sell-by date", "var(--muted)"];
  return <span className="text-[12px] font-semibold" style={{ color }}>{label}</span>;
}

export function SwingView({ report, book, tested }: { report: StoredReport | null; book: SwingBook | null; tested: SwingTested | null }) {
  const rule = book?.rule ?? SWING_BOOK_RULE;
  const trades = book?.trades ?? [];
  const pending = trades.filter((t) => t.status === "pending");
  const open = trades.filter((t) => t.status === "open").sort((a, b) => (a.sellBy ?? "").localeCompare(b.sellBy ?? ""));
  const closed = trades.filter((t) => t.status === "closed").sort((a, b) => (b.exitDate ?? "").localeCompare(a.exitDate ?? ""));
  const asOf = book?.asOf ?? null;
  const strong = book?.strong ?? (report?.market ? report.market.indexAbove200 : null);
  const free = Math.max(0, rule.slots - open.length - pending.length);
  const nextSession = asOf ? addSessions(asOf, 1) : null;
  const rankOf = new Map((report?.screen ?? []).map((r) => [r.symbol, r.pctile]));

  const wins = closed.filter((t) => (t.returnPct ?? 0) > 0).length;
  const avgClosed = closed.length ? closed.reduce((s, t) => s + (t.returnPct ?? 0), 0) / closed.length : 0;
  const openPl = open.map((t) => (t.lastClose && t.entryPrice ? tradeReturnPct(t.entryPrice, t.lastClose, rule.costPct) : 0));
  const avgOpen = openPl.length ? openPl.reduce((s, v) => s + v, 0) / openPl.length : 0;

  // What you hold, on the same rule: a stop one horizon-sigma under today's
  // close and a target twice as far over it.
  const yours = (report?.screen ?? [])
    .filter((r) => r.held && r.price > 0 && r.vol60Pct > 0)
    .map((r) => ({ r, lv: bookLevels(r.price, sigmaOverHorizon(r.vol60Pct / 100 / Math.sqrt(252), rule.horizon), rule) }))
    .sort((a, b) => b.r.pctile - a.r.pctile);

  const s = tested?.stats ?? null;
  const pill = strong === true ? { text: "OPEN TO NEW TRADES", color: "var(--positive)" } : strong === false ? { text: "NO NEW TRADES", color: "var(--negative)" } : { text: "WAITING FOR THE FIRST CLOSE", color: "var(--muted)" };

  return (
    <>
      <PageHeader title="Swing trades" subtitle="Five trades at a time. Each has a stop, a target twice as far away, and a date to sell by.">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
          {asOf && <span className="text-muted">Prices to {day(asOf)}</span>}
          <RefreshAnalysis />
          <Link href="/analysis" className="link-underline">Model →</Link>
        </div>
      </PageHeader>

      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.04em]"
              style={{ color: pill.color, background: `color-mix(in srgb, ${pill.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${pill.color} 35%, transparent)` }}
            >
              {pill.text}
            </span>
            <span className="text-[14px] font-medium mono-num">
              {open.length} open · {pending.length} to buy · {free} {free === 1 ? "slot" : "slots"} free
            </span>
          </div>
          <p className="text-[12.5px] text-muted mt-2">
            {!book
              ? "The book starts after the next close: the five best-ranked names, if the market is above its 200-day average."
              : strong === false
                ? "The market is under its 200-day average. Open trades run to their exits; new ones wait for it to recover."
                : free > 0
                  ? "Free slots fill after the next close with the best-ranked names not already in the book."
                  : "The book is full. A slot frees when a trade hits its stop, its target or its sell-by date."}
          </p>
        </Card>

        {pending.length > 0 && nextSession && (
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="text-[17px] font-bold">Buy at the close on {day(nextSession)}</h2>
              <span className="text-[12px] text-muted">Stop and target are set from the price you pay</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {pending.map((t) => {
                const lv = bookLevels(t.signalClose, t.sigmaH, rule);
                return (
                  <Card key={t.symbol + t.signalDate}>
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/stock/${t.symbol}`} className="flex items-center gap-2.5 min-w-0 group">
                        <CompanyMark symbol={t.symbol} size="sm" />
                        <div className="min-w-0">
                          <div className="text-[15px] font-bold leading-tight group-hover:text-[var(--accent-deep)]">{t.symbol}</div>
                          <div className="text-[12px] text-muted mono-num">Last close Rs {money(t.signalClose)}</div>
                        </div>
                      </Link>
                      <ScoreMeter pctile={t.pctile} />
                    </div>
                    <div className="mt-3">
                      <BookBar stop={lv.stop} entry={t.signalClose} target={lv.target} now={null} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <Level label="Stop about" value={money(lv.stop)} sub={pct(-lv.riskPct)} color="var(--negative)" />
                      <Level label="Target about" value={money(lv.target)} sub={pct(lv.rewardPct)} color="var(--positive)" />
                      <Level label="Sell by" value={day(addSessions(nextSession, rule.maxHold))} sub={`${rule.maxHold} sessions`} />
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-[17px] font-bold">Open trades</h2>
            {open.length > 0 && (
              <span className="text-[12px] text-muted mono-num">
                Average <span style={{ color: tone(avgOpen) }}>{pct(avgOpen)}</span> after costs
              </span>
            )}
          </div>
          {open.length === 0 ? (
            <Card><p className="text-[13px] text-muted">None yet.</p></Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {open.map((t, i) => {
                const pl = openPl[i];
                const left = asOf && t.sellBy ? sessionsBetween(asOf, t.sellBy) : null;
                const rank = rankOf.get(t.symbol) ?? null;
                return (
                  <Card key={t.symbol + t.entryDate}>
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/stock/${t.symbol}`} className="flex items-center gap-2.5 min-w-0 group">
                        <CompanyMark symbol={t.symbol} size="sm" />
                        <div className="min-w-0">
                          <div className="text-[15px] font-bold leading-tight group-hover:text-[var(--accent-deep)]">{t.symbol}</div>
                          <div className="text-[12px] text-muted mono-num">
                            Bought {day(t.entryDate!)} at {money(t.entryPrice!)}
                          </div>
                        </div>
                      </Link>
                      <div className="text-right">
                        <div className="text-[18px] font-bold mono-num leading-tight" style={{ color: tone(pl) }}>{pct(pl)}</div>
                        <div className="text-[12px] text-muted mono-num">Now {money(t.lastClose ?? t.entryPrice!)}</div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <BookBar stop={t.stop!} entry={t.entryPrice!} target={t.target!} now={t.lastClose ?? null} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <Level label="Stop" value={money(t.stop!)} sub={pct((t.stop! / t.entryPrice! - 1) * 100)} color="var(--negative)" />
                      <Level label="Target" value={money(t.target!)} sub={pct((t.target! / t.entryPrice! - 1) * 100)} color="var(--positive)" />
                      <Level
                        label="Sell by"
                        value={day(t.sellBy!)}
                        sub={left == null ? undefined : left <= 0 ? "at the next close" : `${left} ${left === 1 ? "session" : "sessions"} left`}
                        color={left != null && left <= 2 ? "var(--amber)" : undefined}
                      />
                    </div>
                    {rank != null && (
                      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted">
                        Model now <ScoreMeter pctile={rank} />
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-[17px] font-bold">Closed trades</h2>
            {closed.length > 0 && book?.startedAt && (
              <span className="text-[12px] text-muted mono-num">
                Since {day(book.startedAt, true)}: {closed.length} trades, {wins} made money, average <span style={{ color: tone(avgClosed) }}>{pct(avgClosed)}</span>
              </span>
            )}
          </div>
          {closed.length === 0 ? (
            <Card><p className="text-[13px] text-muted">None yet. Every trade ends at its stop, its target or its sell-by date, and lands here with its result.</p></Card>
          ) : (
            <Card pad={false}>
              <div className="overflow-x-auto">
                <table className="table-zar">
                  <thead>
                    <tr><th>Stock</th><th>Bought</th><th>Sold</th><th className="text-right hidden sm:table-cell">Buy</th><th className="text-right hidden sm:table-cell">Sell</th><th className="text-right">Result</th><th>Why</th></tr>
                  </thead>
                  <tbody>
                    {closed.slice(0, 40).map((t) => (
                      <tr key={t.symbol + t.entryDate}>
                        <td><Link href={`/stock/${t.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{t.symbol}</Link></td>
                        <td className="mono-num whitespace-nowrap">{day(t.entryDate!, t.entryDate!.slice(0, 4) !== (asOf ?? "").slice(0, 4))}</td>
                        <td className="mono-num whitespace-nowrap">{day(t.exitDate!, t.exitDate!.slice(0, 4) !== (asOf ?? "").slice(0, 4))}</td>
                        <td className="text-right mono-num hidden sm:table-cell">{money(t.entryPrice!)}</td>
                        <td className="text-right mono-num hidden sm:table-cell">{money(t.exitPrice!)}</td>
                        <td className="text-right mono-num font-semibold" style={{ color: tone(t.returnPct ?? 0) }}>{pct(t.returnPct ?? 0)}</td>
                        <td><Why t={t} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>

        {s && s.trades > 0 && (
          <Card>
            <div className="text-[15px] font-semibold">How this exact rule did, {s.from.slice(0, 4)} to {s.to.slice(0, 4)}</div>
            <p className="text-[12px] text-muted mt-0.5 mb-4">
              On the model&apos;s out-of-sample ranks, five trades at a time, after 0.4% costs a trade: {s.trades.toLocaleString("en-US")} trades.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <Stat label="A year" value={pct(s.cagrPct)} color={tone(s.cagrPct)} />
              <Stat label="Trades that made money" value={`${Math.round(s.winRate * 100)}%`} />
              <Stat label="Average win / loss" value={pct(s.avgWinPct)} color="var(--positive)" sub={`loss ${pct(s.avgLossPct)}`} />
              <Stat label="Worst fall" value={pct(s.maxDrawdownPct, 0)} color="var(--negative)" />
              <Stat label="Trades a year" value={s.tradesPerYear.toFixed(0)} />
              <Stat label="Average hold" value={`${s.avgDays.toFixed(0)} sessions`} />
            </div>
            <div className="mt-4 flex items-end gap-[3px] h-16" role="img" aria-label="Return by year">
              {(() => {
                const top = Math.max(...s.years.map((y) => Math.abs(y.retPct)), 1);
                return s.years.map((y) => (
                  <div key={y.year} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${y.year}: ${pct(y.retPct)}, ${y.trades} trades`}>
                    <div className="w-full rounded-[2px]" style={{ height: `${Math.max(3, (Math.abs(y.retPct) / top) * 100)}%`, background: y.trades === 0 ? "var(--surface-3)" : tone(y.retPct), opacity: 0.85 }} />
                  </div>
                ));
              })()}
            </div>
            <div className="flex justify-between text-[10.5px] text-muted mono-num mt-1">
              <span>{s.years[0]?.year}</span>
              <span>Each bar a year; grey had no trades (weak market)</span>
              <span>{s.years[s.years.length - 1]?.year}</span>
            </div>
            <p className="text-[12px] text-muted mt-3">
              The same book on random names: {pct(tested!.random.cagrPct)} a year, {Math.round(tested!.random.winRate * 100)}% of trades made money.
              {tested!.indexCagrPct != null && <> The market&apos;s average stock: {pct(tested!.indexCagrPct)} a year.</>} Losing years happen; the stop and the sell-by keep them small.
            </p>
          </Card>
        )}

        <Card>
          <div className="text-[15px] font-semibold mb-2">The rules</div>
          <ol className="list-decimal pl-5 space-y-1 text-[13px]">
            <li>Buy at the close on the day shown, as near to it as you can. Put a fifth of your swing money in each trade.</li>
            <li>Sell if a day <b>closes</b> at or under the stop.</li>
            <li>Sell if a day closes at or over the target.</li>
            <li>Otherwise sell at the close on the sell-by date, at whatever the price is.</li>
            <li>New trades only while the market is above its 200-day average. A sold name sits out two weeks.</li>
          </ol>
        </Card>

        {yours.length > 0 && (
          <section>
            <h2 className="text-[17px] font-bold mb-3">Your stocks on the same rule</h2>
            <Card pad={false}>
              <div className="overflow-x-auto">
                <table className="table-zar">
                  <thead>
                    <tr><th>Stock</th><th className="text-right">Now</th><th className="text-right">Stop</th><th className="text-right">Target</th><th className="text-center">Model</th></tr>
                  </thead>
                  <tbody>
                    {yours.map(({ r, lv }) => (
                      <tr key={r.symbol}>
                        <td><Link href={`/holdings/${r.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{r.symbol}</Link></td>
                        <td className="text-right mono-num">{money(r.price)}</td>
                        <td className="text-right mono-num" style={{ color: "var(--negative)" }}>{money(lv.stop)} <span className="text-muted text-[11px] hidden sm:inline">{pct(-lv.riskPct)}</span></td>
                        <td className="text-right mono-num" style={{ color: "var(--positive)" }}>{money(lv.target)} <span className="text-muted text-[11px] hidden sm:inline">{pct(lv.rewardPct)}</span></td>
                        <td className="text-center"><ScoreMeter pctile={r.pctile} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="w-[2px] h-3 rounded-full" style={{ background: "var(--negative)" }} />Stop: one move of the stock&apos;s usual size under the buy</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-[2px] h-3 rounded-full" style={{ background: "var(--positive)" }} />Target: twice as far over it</span>
          <span>Odds, not promises: about half of trades lose, and the stop keeps each loss small.</span>
        </div>
      </div>
    </>
  );
}
