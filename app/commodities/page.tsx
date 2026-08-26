import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { CommoditiesView } from "./CommoditiesView";
import { FyPicker } from "./FyPicker";
import { getPmexOverview, getPmexAccount, checkDataAvailability } from "@/lib/data";
import { fmtRs, fmtSignedRs } from "@/lib/format";

export const dynamic = "force-dynamic";

function pct(n: number | null, digits = 0): string {
  return n == null ? "—" : n.toFixed(digits) + "%";
}
function days(n: number | null): string {
  return n == null ? "—" : Math.round(n) + "d";
}

export default async function CommoditiesPage({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const avail = await checkDataAvailability();
  const wanted = Number(searchParams?.fy);
  const { trades, settings, summary, years, refs } = await getPmexOverview(
    Number.isFinite(wanted) && wanted > 2000 ? wanted : undefined
  );
  const account = await getPmexAccount();

  const { realised, open, stats, byInstrument, fy } = summary;
  const total = realised.net + open.net;
  const refBySymbol = new Map(refs.map((r) => [r.symbol, r]));

  return (
    <div>
      <PageHeader
        eyebrow="Commodities, FX & index · PMEX"
        title="Every contract you hold, and what the year made."
        subtitle="Gold, oil, metals, currency pairs and the KSE-100 future. Enter a contract with its entry; mark it while it is open; the exit crystallises profit, commission and CGT. Profit is grouped by Pakistan's financial year, 1 July to 30 June, and a contract counts in the year you CLOSED it."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label={`${fy.label} realised`} value={fmtSignedRs(realised.net)} size="lg" tone={realised.net >= 0 ? "positive" : "negative"} />
        <Stat label="Open (mark)" value={fmtSignedRs(open.net)} tone={open.net >= 0 ? "positive" : "negative"} />
        <Stat label="Total" value={fmtSignedRs(total)} tone={total >= 0 ? "positive" : "negative"} />
        <Stat label="CGT on closed" value={fmtRs(realised.cgt)} tone="muted" />
        <Stat label="Commission" value={fmtRs(realised.commission)} tone="muted" />
        <Stat
          label="Open exposure"
          value={fmtRs(open.exposure)}
          tone="muted"
          hint={open.leverage != null ? `${open.leverage.toFixed(1)}x on ${fmtRs(open.marginPosted)} margin` : undefined}
        />
      </StatRow>

      {account && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="label-cap">PMEX account {account.accountNo}</div>
            <div className="text-[12px]" style={{ color: "var(--muted)" }}>
              statement {account.statementFrom} to {account.statementTo}
            </div>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Balance ${account.balanceAsOf}`} value={fmtRs(account.closingBalance)} size="lg" />
            <Stat
              label="Trading P/L"
              value={fmtSignedRs(account.tradingPl)}
              tone={account.tradingPl >= 0 ? "positive" : "negative"}
              hint={`realised ${fmtSignedRs(account.realisedPl)}, mark ${fmtSignedRs(account.unrealisedPl)}`}
            />
            <Stat
              label="Cost of trading"
              value={fmtRs(account.totalCosts)}
              tone="muted"
              hint={`comm ${fmtRs(account.commission)} · fees ${fmtRs(account.fees)} · CGT ${fmtRs(account.cgt)} + ${fmtRs(account.cgtFee)} fee`}
            />
            <Stat
              label="After costs"
              value={fmtSignedRs(account.netOfCosts)}
              tone={account.netOfCosts >= 0 ? "positive" : "negative"}
              hint={`deposited ${fmtRs(account.deposits)}`}
            />
          </div>
          {!account.reconciles && (
            <p className="mt-3 text-[13px]" style={{ color: "var(--negative)" }}>
              This ledger does not add up: opening plus movements comes to {fmtRs(account.computedClosing)} against a
              printed balance of {fmtRs(account.closingBalance)}, a gap of {fmtRs(Math.abs(account.discrepancy))}. Treat
              every figure above as unverified until the missing row is found.
            </p>
          )}
          {account.sessions.length > 0 && (
            <div className="mt-4">
              <div className="label-cap mb-2" style={{ color: "var(--muted)" }}>
                By session
              </div>
              <ul className="space-y-1 font-mono text-[13px]">
                {account.sessions.map((s, i) => (
                  <li key={`${s.date}-${i}`} className="flex flex-wrap items-baseline gap-x-3">
                    <span style={{ color: "var(--muted)" }}>{s.date}</span>
                    <span className="font-medium">{s.contract}</span>
                    <span style={{ color: s.realised >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {fmtSignedRs(s.realised)}
                    </span>
                    {s.unrealised !== 0 && (
                      <span style={{ color: "var(--muted)" }}>mark {fmtSignedRs(s.unrealised)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-4 text-[13px]" style={{ color: "var(--muted)" }}>
            PMEX reports profit per session, not per position — these statements carry no entry price, exit price, lot
            count or lot size. The account is therefore recorded exactly, and no contract rows are invented from it. Add
            a contract below by hand if you have the trade detail.
          </p>
        </Card>
      )}

      {years.length > 1 && (
        <div className="mt-6">
          <FyPicker years={years.map((y) => ({ endYear: y.endYear, label: y.label }))} active={fy.endYear} />
        </div>
      )}

      {summary.attention.length > 0 && (
        <Card className="mt-6">
          <div className="label-cap mb-3" style={{ color: "var(--negative)" }}>
            Contracts needing a decision
          </div>
          <ul className="space-y-2 font-mono text-[13px]">
            {summary.attention.map((a, i) => (
              <li key={`${a.symbol}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{a.symbol}</span>
                {a.state === "expired" ? (
                  <span style={{ color: "var(--negative)" }}>
                    expired {Math.abs(a.daysToExpiry ?? 0)} day{Math.abs(a.daysToExpiry ?? 0) === 1 ? "" : "s"} ago
                    {a.expiryDate ? ` (${a.expiryDate})` : ""}
                  </span>
                ) : (
                  <span style={{ color: "var(--amber, var(--negative))" }}>
                    expires in {a.daysToExpiry} day{a.daysToExpiry === 1 ? "" : "s"}
                    {a.expiryDate ? ` (${a.expiryDate})` : ""}
                  </span>
                )}
                {a.deliveryRisk && (
                  <span className="text-[12px]" style={{ color: "var(--negative)" }}>
                    — deliverable, so leaving it open means actually taking or giving the commodity
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 pt-3 border-t border-rule text-[12px] text-muted">
            A position still open at expiry goes to final settlement. Square it off or roll it into the next contract
            month before then.
          </div>
        </Card>
      )}

      {open.noExpiryRecorded > 0 && (
        <Card className="mt-4">
          <div className="text-[12px] text-muted">
            {open.noExpiryRecorded} open contract{open.noExpiryRecorded === 1 ? " has" : "s have"} no expiry date
            recorded, so {open.noExpiryRecorded === 1 ? "it cannot" : "they cannot"} be warned about. Add one when you
            edit the contract.
          </div>
        </Card>
      )}

      <Section
        number="01"
        title={`${fy.label} profit and loss`}
        display={`1 July ${fy.endYear - 1} to 30 June ${fy.endYear}.`}
        description="Realised is money already taken, on contracts closed inside this financial year. Open is mark-to-market on what you still hold, and it moves until you close. CGT is charged per winning contract at your PMEX rate; a losing contract is not taxed."
      >
        <Card>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 font-mono text-[13px]">
            <div>
              <div className="label-cap mb-1">Closed contracts</div>
              <div className="text-[15px]">{realised.trades}</div>
            </div>
            <div>
              <div className="label-cap mb-1">Gross profit</div>
              <div className="text-[15px]">{fmtSignedRs(realised.gross)}</div>
            </div>
            <div>
              <div className="label-cap mb-1">Less commission</div>
              <div className="text-[15px]">{fmtRs(realised.commission)}</div>
            </div>
            <div>
              <div className="label-cap mb-1">Net realised</div>
              <div className="text-[15px]">{fmtSignedRs(realised.net)}</div>
            </div>
            <div>
              <div className="label-cap mb-1">CGT @ {settings.pmexCgtPercent}%</div>
              <div className="text-[15px]">{fmtRs(realised.cgt)}</div>
            </div>
            <div>
              <div className="label-cap mb-1">Net after tax</div>
              <div className="text-[15px]">{fmtSignedRs(realised.netAfterTax)}</div>
            </div>
            <div>
              <div className="label-cap mb-1">Still open</div>
              <div className="text-[15px]">{open.trades}</div>
            </div>
            <div>
              <div className="label-cap mb-1">Open mark-to-market</div>
              <div className="text-[15px]">{fmtSignedRs(open.net)}</div>
            </div>
          </div>
          {open.unmarked > 0 && (
            <div className="mt-4 pt-4 border-t border-rule text-[12px] text-muted">
              {open.unmarked} open contract{open.unmarked === 1 ? " has" : "s have"} no current price set, so
              {open.unmarked === 1 ? " it is" : " they are"} left out of the open figure above rather than counted
              at zero profit. Set a mark on the contract to include {open.unmarked === 1 ? "it" : "them"}.
            </div>
          )}
        </Card>
      </Section>

      {byInstrument.length > 0 && (
        <Section
          number="02"
          title="Which contracts made the money"
          display="Best to worst, this financial year."
          description="Realised and open combined per instrument. This is where you find out whether gold is carrying you while the currency pairs quietly bleed."
        >
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[13px]">
                <thead>
                  <tr className="label-cap border-b border-ink">
                    <th className="text-left py-2 pr-3">Instrument</th>
                    <th className="text-right py-2 px-3">Closed</th>
                    <th className="text-right py-2 px-3">Open</th>
                    <th className="text-right py-2 px-3">Realised</th>
                    <th className="text-right py-2 px-3">Mark</th>
                    <th className="text-right py-2 pl-3">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {byInstrument.map((r) => (
                    <tr key={r.symbol} className="border-b border-rule">
                      <td className="py-2 pr-3 font-medium">{r.symbol}</td>
                      <td className="text-right py-2 px-3 text-muted">{r.closedTrades || "—"}</td>
                      <td className="text-right py-2 px-3 text-muted">{r.openTrades || "—"}</td>
                      <td className="text-right py-2 px-3">{r.realisedNet ? fmtSignedRs(r.realisedNet) : "—"}</td>
                      <td className="text-right py-2 px-3">{r.openNet ? fmtSignedRs(r.openNet) : "—"}</td>
                      <td
                        className="text-right py-2 pl-3 font-medium"
                        style={{ color: r.net >= 0 ? "var(--positive)" : "var(--negative)" }}
                      >
                        {fmtSignedRs(r.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>
      )}

      {realised.trades > 0 && (
        <Section
          number="03"
          title="How you traded"
          display="The record, not the feeling."
          description="Computed over contracts closed this financial year. Expectancy is what an average contract returned after commission — if it is negative, the size of your wins is not covering the losers."
        >
          <Card>
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 font-mono text-[13px]">
              <div>
                <div className="label-cap mb-1">Win rate</div>
                <div className="text-[15px]">{pct(stats.winRatePct)}</div>
                <div className="text-[11px] text-muted mt-0.5">{stats.wins}W / {stats.losses}L</div>
              </div>
              <div>
                <div className="label-cap mb-1">Average win</div>
                <div className="text-[15px]">{stats.avgWin == null ? "—" : fmtSignedRs(stats.avgWin)}</div>
              </div>
              <div>
                <div className="label-cap mb-1">Average loss</div>
                <div className="text-[15px]">{stats.avgLoss == null ? "—" : fmtSignedRs(stats.avgLoss)}</div>
              </div>
              <div>
                <div className="label-cap mb-1">Expectancy / contract</div>
                <div className="text-[15px]">{stats.expectancy == null ? "—" : fmtSignedRs(stats.expectancy)}</div>
              </div>
              <div>
                <div className="label-cap mb-1">Profit factor</div>
                <div className="text-[15px]">{stats.profitFactor == null ? "—" : stats.profitFactor.toFixed(2)}</div>
                <div className="text-[11px] text-muted mt-0.5">
                  {stats.profitFactor == null ? "nothing lost yet" : "won ÷ lost"}
                </div>
              </div>
              <div>
                <div className="label-cap mb-1">Best contract</div>
                <div className="text-[15px]">{stats.bestNet == null ? "—" : fmtSignedRs(stats.bestNet)}</div>
              </div>
              <div>
                <div className="label-cap mb-1">Worst contract</div>
                <div className="text-[15px]">{stats.worstNet == null ? "—" : fmtSignedRs(stats.worstNet)}</div>
              </div>
              <div>
                <div className="label-cap mb-1">Average hold</div>
                <div className="text-[15px]">{days(stats.avgHoldDays)}</div>
              </div>
            </div>
          </Card>
        </Section>
      )}

      {refs.length > 0 && (
        <Section
          number="04"
          title="Reference prices"
          display="What the world is quoting right now."
          description="International spot converted to rupees, for the instruments you currently hold. This is a sanity check on your marks only — PMEX settles on its own prices, so nothing here touches your profit figures."
        >
          <Card>
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 font-mono text-[13px]">
              {refs.map((r) => (
                <div key={r.symbol}>
                  <div className="label-cap mb-1">
                    {r.label}
                    {r.kind === "currency" ? " · FX" : ""}
                  </div>
                  <div className="text-[15px]">{r.pkr == null ? "unavailable" : fmtRs(r.pkr)}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    per {r.unit.includes("per") ? r.unit.split("per")[1].trim() : r.unit.split("/")[1] ?? "unit"}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      <Section
        number="05"
        title="Contracts"
        display="Long or short, lot by lot."
        description="Add a contract with your entry. For open positions set a current price to mark it; for closed ones the exit crystallises profit, commission and CGT. Notional exposure is lots × lot size × price, so a wrong lot size shows up immediately."
      >
        <CommoditiesView
          trades={trades}
          commissionPerLot={settings.pmexCommissionPerLot}
          cgtPercent={settings.pmexCgtPercent}
          refs={Object.fromEntries([...refBySymbol].map(([k, v]) => [k, v.pkr]))}
        />
      </Section>
    </div>
  );
}
