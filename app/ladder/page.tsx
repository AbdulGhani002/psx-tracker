import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Badge } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { getLadderData } from "@/lib/data";
import type { LadderRung } from "@/lib/calculations/ladder";

export const dynamic = "force-dynamic";

function pct(v: number | null, dp = 2): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}
function tone(v: number | null): string {
  if (v == null) return "var(--muted)";
  return v >= 0 ? "var(--positive)" : "var(--negative)";
}

export default async function LadderPage() {
  const { ladder, inflationSource, inflationPeriod, filer, sbpAsOf } = await getLadderData();
  const inf = ladder.inflationPct;
  const best = ladder.rungs[0];
  const nothingBeatsInflation = inf != null && ladder.rungs.every((r) => (r.realAfterTaxPct ?? -99) < 0);

  const columns: Column<LadderRung>[] = [
    {
      key: "label",
      header: "Instrument",
      render: (r) => (
        <div>
          <div className="font-medium text-[13px] flex items-center gap-2">
            {r.label}
            {r.held && <Badge tone="accent">you hold this</Badge>}
          </div>
          <div className="text-[11px] text-muted">{r.detail}</div>
          <div className="text-[10px] text-muted mt-0.5 max-w-[46ch]">{r.taxNote}</div>
        </div>
      ),
    },
    { key: "nominal", header: "Advertised", align: "right", mono: true, render: (r) => `${r.nominalPct.toFixed(2)}%` },
    {
      key: "wht",
      header: "WHT",
      align: "right",
      mono: true,
      render: (r) => (r.whtAppliedPct != null ? `${r.whtAppliedPct}%` : <span className="text-muted text-[11px]">mixed</span>),
    },
    { key: "at", header: "After tax", align: "right", mono: true, render: (r) => (r.afterTaxPct != null ? `${r.afterTaxPct.toFixed(2)}%` : "—") },
    {
      key: "real",
      header: "Real, after tax",
      align: "right",
      mono: true,
      render: (r) => (
        <span className="font-medium" style={{ color: tone(r.realAfterTaxPct) }}>{pct(r.realAfterTaxPct)}</span>
      ),
    },
  ];

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Portfolio · Allocation"
        title="Where should the next rupee go?"
        subtitle={`Every place you can park money, ranked by what actually survives — after each instrument's own withholding tax (${filer ? "filer" : "NON-FILER"} rates) and after inflation. Advertised yields are the least useful number in an ${inf != null ? inf.toFixed(1) : "~11"}% inflation economy.`}
      />

      {best && inf != null && (
        <div className="border-l-[3px] p-4 mb-6" style={{ borderColor: tone(best.realAfterTaxPct), background: "var(--paper-2)" }}>
          <div className="label-cap mb-1">Best surviving return right now</div>
          <div className="text-[15px]">
            <span className="font-medium">{best.label}</span>
            <span className="font-mono mono-num ml-3" style={{ color: tone(best.realAfterTaxPct) }}>
              {pct(best.realAfterTaxPct)}/yr real, after tax
            </span>
          </div>
          {nothingBeatsInflation && (
            <p className="text-[13px] text-muted mt-2 max-w-[80ch]">
              Nothing on this ladder currently beats {inf.toFixed(2)}% inflation after tax — every rupee parked in fixed income
              is losing purchasing power. That is the whole case for owning productive assets (equities) for the long horizon,
              and for not holding more cash than you need.
            </p>
          )}
        </div>
      )}

      <Section
        number="01"
        title="The ladder"
        display={`${ladder.rungs.length} places for your money, best first`}
        description="Each row is taxed under its own rules — bank/T-bill profit is 'profit on debt', fund payouts are dividends, equities split between dividend WHT now and CGT on sale. Rates come from Settings."
      >
        <Table columns={columns} rows={ladder.rungs} rowKey={(r) => r.key} empty="No instruments to rank yet — add funds, savings or holdings." />
      </Section>

      {ladder.references.length > 0 && (
        <Section number="02" title="Reference rates" display="Context, not products" description="You can't buy these directly — they anchor what everything else should pay.">
          <div className="flex flex-wrap gap-3">
            {ladder.references.map((r) => (
              <div key={r.key} className="border border-rule px-3 py-2">
                <div className="label-cap">{r.label}</div>
                <div className="font-mono mono-num text-[15px]">{r.nominalPct.toFixed(2)}%</div>
                <div className="text-[10px] text-muted">real {pct(r.realNominalPct)}</div>
              </div>
            ))}
            {inf != null && (
              <div className="border border-rule px-3 py-2" style={{ borderColor: "var(--accent)" }}>
                <div className="label-cap" style={{ color: "var(--accent-deep)" }}>Inflation (CPI YoY)</div>
                <div className="font-mono mono-num text-[15px]">{inf.toFixed(2)}%</div>
                <div className="text-[10px] text-muted">
                  {inflationSource === "manual" ? "your manual override (Settings)" : `PBS official index, ${inflationPeriod ?? ""}`}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {ladder.omitted.length > 0 && (
        <p className="text-[11px] text-muted mt-6">
          Not shown: {ladder.omitted.map((o) => `${o.label} (${o.reason.toLowerCase().replace(/\.$/, "")})`).join("; ")}.
        </p>
      )}

      <p className="text-[11px] text-muted mt-2 max-w-[90ch]">
        Sources: SBP auction cut-offs and policy rate (sbp.org.pk{sbpAsOf ? `, ${sbpAsOf}` : ""}), MUFAP published fund returns,
        PBS consumer price index, your own account rates. Withholding rates are editable in{" "}
        <Link href="/settings" className="underline hover:text-[var(--accent-deep)]">Settings</Link> — verify against the current
        FBR schedule. Equity earnings retained by companies compound untaxed until you sell; the ladder shows an
        &quot;if eventually realised&quot; view, not a promise.
      </p>
    </div>
  );
}
