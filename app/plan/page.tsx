import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { checkDataAvailability } from "@/lib/data";
import { assemblePlan } from "@/lib/plan";
import { fmtRs } from "@/lib/format";
import { PlanBoard } from "./PlanBoard";

export const dynamic = "force-dynamic";

const pct = (v: number) => `${v.toFixed(0)}%`;
const signed = (v: number) => (v >= 0 ? `+${v}` : `${v}`);

export default async function PlanPage() {
  const avail = await checkDataAvailability();
  const plan = await assemblePlan();

  const v = plan.ladderVerdict;
  const tone = v.action === "DEPLOY" ? "positive" : v.action === "SET_UP" ? "negative" : "default";

  return (
    <>
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <PageHeader
        title="Plan"
        subtitle="What the market is doing, what money is free, and what your own rules say to do about it. Written before the market moves, so it does not get to decide."
      />

      {/* The single instruction. Everything below is the working behind it. */}
      <Card>
        <div className="label-cap mb-2">This week</div>
        <div
          className="text-[20px] leading-snug"
          style={{ color: v.action === "DEPLOY" ? "var(--positive)" : "inherit" }}
        >
          {v.line}
        </div>
        {!plan.cashCheck.ok && (
          <div className="mt-3 text-[13px]" style={{ color: "var(--negative)" }}>
            {plan.cashCheck.line}
          </div>
        )}
        {plan.cashCheck.ok && plan.regime.knownCount > 0 && (
          <div className="mt-3 text-[13px] text-muted">{plan.cashCheck.line}</div>
        )}
      </Card>

      <Section number="01" title="Money not yet in the market">
        <StatRow>
          <Stat label="Available now" value={fmtRs(plan.cash.available)} hint="Money-market fund plus broker cash" />
          <Stat label="Receivable" value={fmtRs(plan.cash.receivable)} hint="Owed to you, not landed" />
          <Stat label="Expected" value={fmtRs(plan.cash.expected)} hint="No claim on it yet" />
          <Stat
            label="Cash weight"
            value={pct(plan.cashPct)}
            hint={`Floor for this regime ${plan.regime.cashFloorPct}%`}
            tone={plan.cashCheck.ok ? "default" : "negative"}
          />
        </StatRow>
        {plan.cash.fundEarnedPerDay > 0 && (
          <p className="mt-4 text-[13px] text-muted">
            The parked balance is earning about <strong>{fmtRs(plan.cash.fundEarnedPerDay)} a day</strong>, roughly{" "}
            {fmtRs(plan.cash.fundEarnedWeek)} a week, while it waits. It keeps accruing at weekends, when the fund does
            not publish a price.
          </p>
        )}
      </Section>

      <Section
        number="02"
        title="Market regime"
        description="Fundamentals say what to buy and price says when. Regime says how much, and what to leave alone. Six signals are read automatically; three are your judgement."
      >
        <StatRow>
          <Stat label="Regime" value={plan.regime.label} tone={tone as never} />
          <Stat
            label="Score"
            value={`${signed(plan.regime.rawScore)} of ${plan.regime.maxScore}`}
            hint={`${plan.regime.knownCount} signals scored`}
          />
          <Stat label="Confidence" value={plan.regime.confidence.toLowerCase()} hint="From how many signals are set" />
          <Stat label="Cash floor" value={pct(plan.regime.cashFloorPct)} hint="What this environment argues for" />
        </StatRow>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <div className="label-cap mb-2" style={{ color: "var(--positive)" }}>
              Favour
            </div>
            <div className="text-[14px]">{plan.regime.favour.join(", ")}</div>
          </Card>
          <Card>
            <div className="label-cap mb-2" style={{ color: "var(--negative)" }}>
              Avoid
            </div>
            <div className="text-[14px]">{plan.regime.avoid.join(", ")}</div>
          </Card>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-rule text-muted label-cap">
                <th className="text-left py-2">Signal</th>
                <th className="text-left py-2">Source</th>
                <th className="text-right py-2">Score</th>
                <th className="text-left py-2 pl-4">Reading</th>
              </tr>
            </thead>
            <tbody>
              {plan.regime.signals.map((s) => (
                <tr key={s.key} className="border-b border-rule/60">
                  <td className="py-2">{s.label}</td>
                  <td className="py-2 text-muted">{s.source === "auto" ? "auto" : "yours"}</td>
                  <td className="py-2 text-right">
                    {s.known ? (
                      <span style={{ color: s.score > 0 ? "var(--positive)" : s.score < 0 ? "var(--negative)" : "inherit" }}>
                        {signed(s.score)}
                      </span>
                    ) : (
                      <span className="text-muted">not set</span>
                    )}
                  </td>
                  <td className="py-2 pl-4 text-muted">{s.reading}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {plan.regimeStale && (
          <p className="mt-3 text-[12px] text-muted">
            Market signals are being served from the last good copy — a feed did not answer on the most recent refresh.
          </p>
        )}
      </Section>

      <Section
        number="03"
        title="The buying ladder"
        description="Each rung names an index level and a slice of the pool. The level arms it, nothing else. A rung fires once, and slices are cut from the pool as it stood when you armed the ladder, so spending never shrinks the rungs below."
      >
        <StatRow>
          <Stat
            label={plan.ladder.indexName}
            value={Math.round(plan.ladder.indexLevel).toLocaleString("en-PK")}
            hint={plan.ladder.indexAsOf ? `close ${plan.ladder.indexAsOf}` : "no index data"}
          />
          <Stat label="Ladder pool" value={fmtRs(plan.ladder.ladderPool)} hint={`Armed ${plan.playbook.armedAt || "not yet"}`} />
          <Stat label="Reserve held back" value={fmtRs(plan.ladder.reserveAmount)} hint={`${plan.ladder.reservePct}% never spent`} />
          <Stat
            label="Ready to deploy"
            value={fmtRs(plan.ladder.readyAmount)}
            tone={plan.ladder.readyAmount > 0 ? "positive" : "default"}
          />
        </StatRow>
      </Section>

      {plan.ladderBuys && plan.ladderBuys.rows.length > 0 && (
        <Section
          number="04"
          title="What that money buys"
          description="The rungs decide how much goes out. This decides which names it goes into, sized by your target weights and weighted by how far each price sits from its buy band. Whole shares only."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr className="border-b border-rule text-muted label-cap">
                  <th className="text-left py-2">Name</th>
                  <th className="text-right py-2">Price</th>
                  <th className="text-right py-2">Shares</th>
                  <th className="text-right py-2">Cost</th>
                  <th className="text-right py-2">Weight after</th>
                  <th className="text-left py-2 pl-4">Why this size</th>
                </tr>
              </thead>
              <tbody>
                {plan.ladderBuys.rows.map((r) => (
                  <tr key={r.symbol} className="border-b border-rule/60">
                    <td className="py-2 font-mono font-medium">{r.symbol}</td>
                    <td className="py-2 text-right">{fmtRs(r.price, true)}</td>
                    <td className="py-2 text-right">{r.shares.toLocaleString("en-PK")}</td>
                    <td className="py-2 text-right">{fmtRs(r.rupees)}</td>
                    <td className="py-2 text-right text-muted">{r.finalPct.toFixed(1)}%</td>
                    <td className="py-2 pl-4 text-muted">{r.zoneReason}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2">Total</td>
                  <td />
                  <td />
                  <td className="py-2 text-right">{fmtRs(plan.ladderBuys.deployed)}</td>
                  <td />
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          {plan.ladderBuys.undeployed > 1 && (
            <p className="mt-3 text-[13px] text-muted">
              {fmtRs(plan.ladderBuys.undeployed)} of the armed amount buys no whole share at these prices and stays in
              the fund.
            </p>
          )}
          {plan.ladderBuys.warnings.map((w, i) => (
            <p key={i} className="mt-2 text-[13px]" style={{ color: "var(--negative)" }}>
              {w}
            </p>
          ))}
        </Section>
      )}

      {plan.ruleCheck?.ok && plan.ruleCheck.windows.length > 0 && (
        <Section
          number="05"
          title="Have these rules actually worked?"
          description="Your own rungs, restated as falls from a high and run against the KSE-100 record. Every strategy gets the same money on the same days and is judged on money-weighted return, so none can win by being funded at a luckier moment."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr className="border-b border-rule text-muted label-cap">
                  <th className="text-left py-2">Period</th>
                  <th className="text-right py-2">Index</th>
                  {plan.ruleCheck.windows[0].rows.map((r) => (
                    <th key={r.key} className="text-right py-2 pl-3">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.ruleCheck.windows.map((w) => {
                  const best = Math.max(...w.rows.map((r) => r.xirrPct ?? -999));
                  return (
                    <tr key={w.label} className="border-b border-rule/60">
                      <td className="py-2">
                        {w.label}
                        <span className="text-muted"> · {w.years.toFixed(1)}y</span>
                      </td>
                      <td className="py-2 text-right text-muted">
                        {w.indexReturnPct >= 0 ? "+" : ""}
                        {w.indexReturnPct.toFixed(0)}%
                      </td>
                      {w.rows.map((r) => (
                        <td
                          key={r.key}
                          className="py-2 text-right pl-3"
                          style={{
                            fontWeight: (r.xirrPct ?? -999) === best ? 600 : 400,
                            color: (r.xirrPct ?? 0) < 0 ? "var(--negative)" : "inherit",
                          }}
                        >
                          {r.xirrPct == null ? "n/a" : `${r.xirrPct >= 0 ? "+" : ""}${r.xirrPct.toFixed(1)}%`}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[13px]">{plan.ruleCheck.full.verdict}</p>

          <div className="mt-4 text-[12px] text-muted space-y-1">
            <p>
              Figures are money-weighted annual returns. The bold cell in each row is that period&apos;s winner.
              {plan.ruleCheck.usingSample
                ? " You have no rungs set, so a sample ladder of 4, 8, 14 and 22 per cent falls was tested. Set your own and this becomes a test of your plan."
                : ` Your rungs were ${plan.ruleCheck.referenceNote}.`}
            </p>
            <p>
              Cash is assumed to earn {plan.ruleCheck.full.config.cashYieldPct}% a year, which is what makes waiting
              affordable. The regime column here uses only the two signals a price history can reconstruct, so it is a
              floor on what the full nine-signal scorecard would do, not a measure of it.
            </p>
          </div>
        </Section>
      )}

      {/* Everything editable lives in one client island so the server page
          stays a pure read of the same view the weekly PDF is built from. */}
      <PlanBoard initial={JSON.parse(JSON.stringify(plan))} />
    </>
  );
}
