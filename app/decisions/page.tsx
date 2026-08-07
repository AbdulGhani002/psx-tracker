import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getDecisionInbox, getRecentDecisions, getScorecard, getSellDiscipline } from "@/lib/data-decisions";
import { equityAfterTaxReturnPct } from "@/lib/calculations/sell-engine";
import { fmtRs } from "@/lib/format";
import { HoldThroughCard, OutcomeReviewForm } from "./DecisionForms";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  buy: "Buy", add: "Add", trim: "Trim", sell_all: "Sell all",
  hold_through_trigger: "Held through trigger", rebuy: "Re-buy", park_cash: "Parked cash",
};

export default async function DecisionsPage({ searchParams }: { searchParams: { symbol?: string; action?: string } }) {
  const [inbox, scorecard, discipline] = await Promise.all([getDecisionInbox(), getScorecard(), getSellDiscipline()]);
  // Every rupee has an alternative. Rank held positions by how much their
  // after-tax return clears (or trails) the best MMF net of WHT — weakest first,
  // because that's where the next trim conversation lives.
  const ranked = discipline.positions
    .filter((p) => p.spreadPct != null)
    .sort((a, b) => (a.spreadPct ?? 0) - (b.spreadPct ?? 0));
  const unrankable = discipline.positions.filter((p) => p.spreadPct == null);
  let feed = await getRecentDecisions(200);
  if (searchParams.symbol) feed = feed.filter((d) => d.symbol === searchParams.symbol!.toUpperCase());
  if (searchParams.action) feed = feed.filter((d) => d.action === searchParams.action);
  const actionCards = inbox.cards.filter((c) => c.severity === "action");
  const warnCards = inbox.cards.filter((c) => c.severity === "warn");
  const symbols = [...new Set((await getRecentDecisions(200)).map((d) => d.symbol))];

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Portfolio · Discipline"
        title="Decisions, not vibes."
        subtitle="Holding is the default that needs no courage — selling is the decision that needs discipline. Fired triggers, due reviews and expired cash land here and stay here until you clear them by logging a decision. Silence is the one option this page refuses to offer."
      />

      <Section
        number="01"
        title="Decision required"
        display={actionCards.length === 0 ? "Nothing is waiting on you." : `${actionCards.length} item${actionCards.length === 1 ? "" : "s"} waiting`}
        description="Each card is one of YOUR pre-committed rules, fired. Clear it by trimming, selling, fixing the cash plan — or by consciously logging a hold with your reasoning. Overriding is allowed; overriding silently is not."
      >
        {actionCards.length === 0 ? (
          <Card><p className="text-sm text-muted">No fired triggers, no expired cash, no due re-buy reviews. The discipline is holding.</p></Card>
        ) : (
          <div className="space-y-3">
            {actionCards.map((c, i) => (
              <HoldThroughCard key={`${c.type}:${c.symbol}:${i}`} card={c} />
            ))}
          </div>
        )}
        {warnCards.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {warnCards.map((c, i) => (
              <p key={i} className="text-[12px] text-muted border-l-2 pl-3" style={{ borderColor: "var(--rule)" }}>
                {c.message}
              </p>
            ))}
          </div>
        )}
      </Section>

      {inbox.guardWarnings.length > 0 && (
        <Section number="02" title="The mirror" display="Your own patterns, flagged" description="These watch the investor, not the stock. None of them block anything — they make you look at the thing you're avoiding.">
          <div className="space-y-2">
            {inbox.guardWarnings.map((g, i) => (
              <Card key={i}>
                <span className="font-mono text-[12px] font-medium mr-2">{g.symbol}</span>
                <span className="text-[13px]">{g.message}</span>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section
        number="03"
        title="Reviews due"
        display={inbox.reviewsDue.length === 0 ? "Loop closed." : `${inbox.reviewsDue.length} decision${inbox.reviewsDue.length === 1 ? "" : "s"} to grade`}
        description="Past decisions whose review date has arrived. Grade the REASONING (1–5), not the outcome — a good decision can have a bad outcome, and vice versa. This is how the scorecard learns."
      >
        {inbox.reviewsDue.length === 0 ? (
          <Card><p className="text-sm text-muted">Nothing due. Decisions you log with a review date will resurface here when it's time to check whether the thing you said would happen, happened.</p></Card>
        ) : (
          <div className="space-y-4">
            {inbox.reviewsDue.map((d) => (
              <OutcomeReviewForm key={String(d._id)} decision={JSON.parse(JSON.stringify(d))} />
            ))}
          </div>
        )}
      </Section>

      <Section number="04" title="Self-scorecard" display={scorecard.total === 0 ? "No decisions logged yet" : `${scorecard.total} decisions logged`} description="Average decision quality by action type — the feedback that actually changes behaviour. Low 'add' scores and high 'trim' scores tell you something no chart does.">
        {scorecard.byAction.length === 0 ? (
          <Card><p className="text-sm text-muted">Your first sell or trim will start the log.</p></Card>
        ) : (
          <div className="flex flex-wrap gap-3">
            {scorecard.byAction.map((a) => (
              <div key={a.action} className="border border-rule px-3 py-2">
                <div className="label-cap">{ACTION_LABEL[a.action] ?? a.action}</div>
                <div className="font-mono mono-num text-[15px]">
                  {a.avgQuality != null ? `${a.avgQuality.toFixed(1)} / 5` : "—"}
                </div>
                <div className="text-[10px] text-muted">{a.count} logged · {a.reviewed} graded</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {(ranked.length > 0 || unrankable.length > 0) && (
        <Section
          number="05"
          title="Opportunity ranking"
          display="Which rupee is working hardest?"
          description={`Each position's after-tax return (earnings yield taxed as dividends + retained earnings as capital gain) against the real alternative — ${discipline.netRiskFree.label || "the best money-market fund net of WHT"}. The weakest justifier sits on top: that's the position that must argue hardest for its place.`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-t border-b border-ink text-left">
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Symbol</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">Weight</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">After-tax return</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">MMF net</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">Spread</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Reading</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((p) => {
                  const s = p.signal;
                  const at = equityAfterTaxReturnPct(s.earningsYieldPct ?? 0, s.dividendYieldPct ?? 0, discipline.config.settings);
                  const spread = p.spreadPct ?? 0;
                  const weakest = ranked.length > 1 && p === ranked[0];
                  return (
                    <tr key={s.symbol} className="border-b border-rule hover:bg-[var(--paper-2)]">
                      <td className="px-2 py-1.5">
                        <Link href={`/holdings/${s.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{s.symbol}</Link>
                        {weakest && <span className="ml-2 font-mono text-[9px] uppercase tracking-stat" style={{ color: "var(--accent-deep)" }}>weakest</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{s.weightPct.toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{at.toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{discipline.netRiskFree.pct != null ? `${discipline.netRiskFree.pct.toFixed(1)}%` : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: spread >= 0 ? "var(--positive)" : "var(--negative)" }}>
                        {spread >= 0 ? "+" : ""}{spread.toFixed(1)} pp
                      </td>
                      <td className="px-2 py-1.5 text-[12px] text-muted max-w-[36ch]">
                        {spread < 0
                          ? `The MMF beats this by ${Math.abs(spread).toFixed(1)} pp after tax — it must earn its place on growth you can name.`
                          : spread < 2
                            ? "Barely clears cash. Thin margin for error."
                            : "Clears the alternative on today's earnings alone."}
                        {s.dividendYieldPct == null || s.dividendYieldPct === 0 ? " Pays no dividend — the whole case is retention." : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {unrankable.length > 0 && (
            <p className="text-[12px] text-muted mt-3">
              Not rankable (no earnings-yield data{discipline.netRiskFree.pct == null ? " or no MMF benchmark" : ""}):{" "}
              {unrankable.map((p) => p.signal.symbol).join(", ")} — missing data is shown as missing, never scored.
            </p>
          )}
        </Section>
      )}

      <Section
        number="06"
        title="The log"
        display={`${feed.length} entr${feed.length === 1 ? "y" : "ies"}${searchParams.symbol ? ` · ${searchParams.symbol.toUpperCase()}` : ""}`}
        description="Append-only. Entries are never edited or deleted — corrections are new entries referencing the old. Each one froze the state of the world as you saw it."
      >
        <div className="flex flex-wrap gap-1.5 mb-4">
          <Link href="/decisions" className="label-cap border px-2 py-1" style={{ borderColor: searchParams.symbol || searchParams.action ? "var(--rule)" : "var(--ink)" }}>All</Link>
          {symbols.slice(0, 10).map((s) => (
            <Link key={s} href={`/decisions?symbol=${s}`} className="label-cap border px-2 py-1 font-mono" style={{ borderColor: searchParams.symbol === s ? "var(--ink)" : "var(--rule)" }}>{s}</Link>
          ))}
        </div>
        {feed.length === 0 ? (
          <Card><p className="text-sm text-muted">Empty. The next sell or trim will write the first entry — it can't not.</p></Card>
        ) : (
          <div className="space-y-4">
            {feed.map((d) => (
              <article key={String(d._id)} className="border-b border-rule pb-4">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <Link href={`/holdings/${d.symbol}`} className="font-mono text-[13px] font-medium hover:text-[var(--accent-deep)]">{d.symbol}</Link>
                  <Badge tone={d.action === "sell_all" || d.action === "trim" ? "negative" : d.action === "hold_through_trigger" ? "amber" as any : "default"}>
                    {ACTION_LABEL[d.action] ?? d.action}
                  </Badge>
                  <span className="font-mono text-[11px] text-muted">{String(d.timestamp).slice(0, 10)}</span>
                  <span className="font-mono text-[11px] text-muted">@ {fmtRs(d.priceAtDecision, true)}</span>
                  <span className="font-mono text-[11px] text-muted">{d.weightBeforePct.toFixed(1)}% → {d.weightAfterPct.toFixed(1)}%</span>
                  {d.firedTriggers.length > 0 && <span className="font-mono text-[10px] uppercase tracking-stat" style={{ color: "var(--accent-deep)" }}>{d.firedTriggers.join(", ")}</span>}
                </div>
                <p className="text-[13px] mt-1.5 max-w-[90ch]">{d.rationale}</p>
                <p className="text-[11px] text-muted mt-1 max-w-[90ch]"><strong>Falsifier:</strong> {d.falsifier}</p>
                {d.expectedOutcome && <p className="text-[11px] text-muted max-w-[90ch]"><strong>Expected:</strong> {d.expectedOutcome}</p>}
                {d.outcomeReview ? (
                  <p className="text-[11px] mt-1.5 border-l-2 pl-2" style={{ borderColor: "var(--positive)" }}>
                    <strong>Graded {d.outcomeReview.decisionQuality}/5</strong> ({String(d.outcomeReview.reviewedAt).slice(0, 10)}): {d.outcomeReview.whatHappened}
                    {d.outcomeReview.lesson && <> — <em>{d.outcomeReview.lesson}</em></>}
                  </p>
                ) : d.reviewDate ? (
                  <p className="text-[10px] text-muted mt-1">Review due {d.reviewDate}</p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
