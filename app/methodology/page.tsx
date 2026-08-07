import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Card } from "@/components/ui/Card";
import { NavBarrel } from "@/components/charts/NavBarrel";
import { getAllLookThroughs } from "@/lib/data";

export const dynamic = "force-dynamic";

type Method = { title: string; formula: string; body: React.ReactNode };

const METHODS: Method[] = [
  {
    title: "Ordinary shares",
    formula: "value = live price × shares you hold",
    body: (
      <>
        Every price is scraped live from the PSX data portal. Your position value is simply that price times the
        number of shares. Whether a share is <em>cheap or expensive</em> is a separate question answered on the{" "}
        <Link href="/intrinsic" className="underline hover:text-[var(--accent-deep)]">Valuation</Link> page, which
        blends a dividend-discount model with an earnings multiple.
      </>
    ),
  },
  {
    title: "Holding companies",
    formula: "NAV = Σ(stake × live price) + unlisted − net debt",
    body: (
      <>
        A holding company (like AHCL) owns stakes in other listed companies plus some unlisted assets, minus its
        debt. Its own reported earnings are mostly the <em>change in value of the shares it owns</em>, so a P/E reads
        nonsensically. Instead we value it by what it actually holds — priced live — and divide by its shares to get
        net asset value (NAV) per share. The gap to the market price is the holding-company discount, broken down
        below.
      </>
    ),
  },
  {
    title: "Mutual funds",
    formula: "value = MUFAP NAV × units",
    body: <>Fund units are valued at the official daily NAV published by MUFAP, times the units you hold.</>,
  },
  {
    title: "Savings & cash",
    formula: "value = balance + accrued profit",
    body: (
      <>
        Savings accounts carry at their balance, accruing profit at the rate you set. Brokerage cash is tracked from
        every deposit, withdrawal, buy, sell and dividend, so the rebalance always knows exactly what's deployable.
      </>
    ),
  },
  {
    title: "Commodities (PMEX)",
    formula: "value = live price × lots × contract size",
    body: <>Gold and other PMEX positions are marked at the live quote times your lots and the contract multiplier.</>,
  },
];

export default async function MethodologyPage() {
  const lookThroughs = await getAllLookThroughs();

  return (
    <div>
      <PageHeader
        eyebrow="Methodology"
        title="How it's valued."
        subtitle="Every figure in this tracker is computed, not guessed. Here's exactly where each number comes from — and a live breakdown of your holding companies into the pieces they actually own."
      />

      <Section number="01" title="Where every number comes from" display="No black boxes.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {METHODS.map((m) => (
            <Card key={m.title}>
              <div className="font-display text-[20px] mb-1" style={{ fontVariationSettings: "'opsz' 144" }}>
                {m.title}
              </div>
              <div className="font-mono text-[12px] mb-3 px-2 py-1 inline-block" style={{ background: "var(--paper-2)", color: "var(--accent-deep)" }}>
                {m.formula}
              </div>
              <p className="text-[13px] text-muted leading-relaxed">{m.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        number="02"
        title="Holding companies, broken down"
        display="One barrel, many companies."
        description="Each holding company refined into the underlying stakes it owns — sized by how much of its net asset value each one represents, priced live. The discount to NAV is the extra value baked into the price."
      >
        {lookThroughs.length === 0 ? (
          <Card>
            <p className="text-[14px] text-muted">
              No holding companies configured yet. On a holding like AHCL, open its page and turn on look-through, then
              add the stakes it owns — they'll be refined into a live breakdown here.
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            {lookThroughs.map((lt) => (
              <NavBarrel key={lt.symbol} lt={lt} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
