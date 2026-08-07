"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { NumberInput } from "@/components/ui/NumberInput";
import { Section } from "@/components/layout/Section";
import { Stat } from "@/components/ui/Stat";
import { fmtRs } from "@/lib/format";
import {
  computeZakat,
  GOLD_NISAB_GRAMS,
  SILVER_NISAB_GRAMS,
  type ZakatCategory,
} from "@/lib/calculations/zakat";

type Props = {
  categories: ZakatCategory[];
  silverPkrPerGram: number | null;
  goldPkrPerGram: number | null;
  priceNote: string;
};

export function ZakatClient({ categories: initial, silverPkrPerGram, goldPkrPerGram, priceNote }: Props) {
  const [included, setIncluded] = useState<Record<string, boolean>>(
    Object.fromEntries(initial.map((c) => [c.key, c.included]))
  );
  const [liabilities, setLiabilities] = useState(0);

  const result = useMemo(
    () =>
      computeZakat({
        categories: initial.map((c) => ({ ...c, included: included[c.key] ?? true })),
        liabilitiesPkr: liabilities,
        silverPkrPerGram,
        goldPkrPerGram,
      }),
    [initial, included, liabilities, silverPkrPerGram, goldPkrPerGram]
  );

  return (
    <div>
      <Section number="01" title="What counts" display={`${initial.length} asset categories from your portfolio`} description="Untick anything your school of thought treats differently — the notes explain the common views. Values are live from this app.">
        <div className="space-y-2">
          {initial.map((c) => (
            <label key={c.key} className="flex items-start gap-3 border border-rule p-3 cursor-pointer select-none hover:bg-[var(--paper-2)]">
              <input
                type="checkbox"
                checked={included[c.key] ?? true}
                onChange={(e) => setIncluded((p) => ({ ...p, [c.key]: e.target.checked }))}
                className="w-4 h-4 mt-0.5 accent-[var(--accent-deep)]"
              />
              <span className="flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium">{c.label}</span>
                  <span className="font-mono mono-num text-[13px]">{fmtRs(c.amount)}</span>
                </span>
                {c.note && <span className="block text-[11px] text-muted mt-0.5 max-w-[70ch]">{c.note}</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 max-w-[300px]">
          <NumberInput
            label="Immediate liabilities (Rs)"
            value={liabilities}
            onChange={setLiabilities}
            min={0}
            step={1000}
            hint="Debts due now — borrowed money, bills payable. Netted off before the 2.5%."
          />
        </div>
      </Section>

      <Section number="02" title="The verdict" display="Nisab check, then 2.5%" description={priceNote}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Stat label="Zakatable assets" value={fmtRs(result.zakatableTotal)} />
          <Stat label="Net of liabilities" value={fmtRs(result.netBase)} tone="muted" />
          <Stat
            label={`Nisab (silver, ${SILVER_NISAB_GRAMS.toFixed(0)}g)`}
            value={result.nisabSilverPkr != null ? fmtRs(result.nisabSilverPkr) : "needs a feed"}
            tone="muted"
            hint={result.nisabGoldPkr != null ? `gold nisab (${GOLD_NISAB_GRAMS.toFixed(1)}g): ${fmtRs(result.nisabGoldPkr)}` : undefined}
          />
          <Stat
            label={`Zakat due @ ${result.ratePct}%`}
            value={result.duePkr != null ? fmtRs(result.duePkr) : "—"}
            tone={result.duePkr != null && result.duePkr > 0 ? "accent" : "positive"}
          />
        </div>

        {result.aboveNisab === null && (
          <Card>
            <p className="text-[13px]" style={{ color: "var(--negative)" }}>
              The live silver price is unavailable, so the nisab threshold — and therefore whether zakat is due — can&apos;t be
              determined right now. We don&apos;t guess this number. Try again shortly.
            </p>
          </Card>
        )}
        {result.aboveNisab === false && (
          <Card>
            <p className="text-[13px]">
              Your net zakatable wealth is <strong>below nisab</strong> — no zakat is due on these assets this year.
            </p>
          </Card>
        )}
        {result.aboveNisab === true && (
          <Card>
            <p className="text-[13px] max-w-[80ch]">
              Your net zakatable wealth is above nisab, so <strong>{fmtRs(result.duePkr ?? 0)}</strong> is due for the lunar year —
              provided the wealth stayed above nisab for the full year (haul). Pay on your own zakat anniversary; many in
              Pakistan use Ramadan.
            </p>
          </Card>
        )}

        <div className="mt-4 space-y-2 text-[11px] text-muted max-w-[90ch]">
          <p>
            <strong>Lunar vs solar:</strong> 2.5% is the lunar-year rate. If you anchor on a solar (calendar) date, some
            scholars use 2.577% to compensate for the ~11 extra days.
          </p>
          <p>
            <strong>Double deduction:</strong> banks (PLS savings) and AMCs deduct zakat at source on 1st Ramadan unless you
            filed a CZ-50 / affidavit — money already deducted at source should not be paid again here.
          </p>
          <p>
            <strong>PMEX / gold holdings:</strong> physical gold and silver you own are zakatable at market value but aren&apos;t
            auto-included — this page only counts what the app tracks with live values.
          </p>
          <p>This is arithmetic on the common rules, not a religious ruling. For edge cases, ask a scholar you trust.</p>
        </div>
      </Section>
    </div>
  );
}
