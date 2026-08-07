// "Where should my next rupee go?" — every parking place for cash the user
// actually has, ranked by what SURVIVES tax and inflation.
//
// Nominal yields are the number every product advertises and the least useful
// one in Pakistan: an 11% inflation economy with source-withheld taxes means
// the honest ranking is after-tax REAL. Each rung is taxed under its OWN rules
// (see pk-tax.ts) — a T-bill, a fund distribution and an equity gain are not
// the same haircut, which is exactly why nothing compared them before.
//
// Every input is live or user-owned: SBP cut-offs (fetched), MUFAP fund yields
// (fetched), the user's savings-account rates (entered by them), inflation (PBS,
// computed from the index). A rung whose input is missing is OMITTED with a
// reason — never shown with a guessed number.

import { afterTaxPct, realPct, whtPct, type TaxKind, type TaxSettings } from "./pk-tax";

export type LadderRung = {
  key: string;
  label: string;
  detail: string; // where the nominal figure comes from
  kind: TaxKind | "reference";
  held: boolean; // the user actually owns this instrument today
  nominalPct: number;
  whtAppliedPct: number | null; // null for reference rows
  afterTaxPct: number | null;
  realNominalPct: number | null; // null when inflation unknown
  realAfterTaxPct: number | null;
  taxNote: string;
};

export type LadderInput = {
  inflationPct: number | null; // PBS CPI YoY; null = feed down
  settings: TaxSettings;
  tbill12mPct: number | null; // SBP MTB 12M cut-off
  policyRatePct: number | null;
  kibor12BidPct: number | null;
  funds: Array<{ name: string; yieldPct: number }>; // user's funds, live MUFAP Year1
  savings: Array<{ name: string; ratePercent: number }>; // user's accounts, their entered rate
  equity: { label: string; earningsYieldPct: number; dividendYieldPct: number } | null;
};

export type Ladder = {
  rungs: LadderRung[]; // investable, sorted best after-tax-real first
  references: LadderRung[]; // policy rate, KIBOR — context, not investable retail products
  omitted: Array<{ label: string; reason: string }>;
  inflationPct: number | null;
};

function rung(
  key: string,
  label: string,
  detail: string,
  kind: TaxKind | "reference",
  nominalPct: number,
  held: boolean,
  s: TaxSettings,
  inflationPct: number | null,
  taxNote: string
): LadderRung {
  const taxable = kind !== "reference";
  const at = taxable ? afterTaxPct(nominalPct, kind, s) : null;
  return {
    key,
    label,
    detail,
    kind,
    held,
    nominalPct,
    whtAppliedPct: taxable ? whtPct(kind, s) : null,
    afterTaxPct: at,
    realNominalPct: inflationPct != null ? realPct(nominalPct, inflationPct) : null,
    realAfterTaxPct: inflationPct != null && at != null ? realPct(at, inflationPct) : null,
    taxNote,
  };
}

export function buildLadder(i: LadderInput): Ladder {
  const rungs: LadderRung[] = [];
  const references: LadderRung[] = [];
  const omitted: Ladder["omitted"] = [];
  const s = i.settings;
  const inf = i.inflationPct;

  if (i.tbill12mPct != null) {
    rungs.push(
      rung(
        "tbill",
        "12-month T-bill",
        "SBP auction cut-off yield (MTB 12M)",
        "profit-on-debt",
        i.tbill12mPct,
        false,
        s,
        inf,
        "Profit on debt (Sec 151) — withheld at source, final tax for most individuals."
      )
    );
  } else {
    omitted.push({ label: "12-month T-bill", reason: "SBP feed unavailable — no cut-off to show." });
  }

  for (const f of i.funds) {
    rungs.push(
      rung(
        `fund:${f.name}`,
        f.name,
        "MUFAP published 1-year return (live)",
        "dividend",
        f.yieldPct,
        true,
        s,
        inf,
        "Fund distributions are dividends (Sec 150) — WHT at payout."
      )
    );
  }

  for (const a of i.savings) {
    rungs.push(
      rung(
        `savings:${a.name}`,
        a.name,
        "Your entered account rate",
        "profit-on-debt",
        a.ratePercent,
        true,
        s,
        inf,
        "Bank profit is profit on debt (Sec 151) — WHT at source."
      )
    );
  }

  if (i.equity) {
    // Dividends are taxed now; the retained-earnings part of the earnings yield
    // compounds untaxed until you SELL, then pays CGT. So the after-tax figure
    // taxes each part under its own rule — an "if eventually realised" view.
    const dy = Math.max(0, i.equity.dividendYieldPct);
    const retained = Math.max(0, i.equity.earningsYieldPct - dy);
    const at = afterTaxPct(dy, "dividend", s) + afterTaxPct(retained, "capital-gain", s);
    const r: LadderRung = {
      key: "equity",
      label: i.equity.label,
      detail: "Earnings yield of your held stocks (value-weighted)",
      kind: "capital-gain",
      held: true,
      nominalPct: i.equity.earningsYieldPct,
      whtAppliedPct: null, // two different rates apply — spelled out in the note
      afterTaxPct: at,
      realNominalPct: inf != null ? realPct(i.equity.earningsYieldPct, inf) : null,
      realAfterTaxPct: inf != null ? realPct(at, inf) : null,
      taxNote: `Dividend part (${dy.toFixed(1)}%) taxed at ${whtPct("dividend", s)}% now; retained part (${retained.toFixed(1)}%) taxed at ${whtPct("capital-gain", s)}% only when you sell.`,
    };
    rungs.push(r);
  } else {
    omitted.push({ label: "Your equities", reason: "No earnings-yield data for your holdings yet." });
  }

  if (i.policyRatePct != null) {
    references.push(
      rung("policy", "SBP policy rate", "The central bank's rate — banks price off this", "reference", i.policyRatePct, false, s, inf, "Reference, not a retail product.")
    );
  }
  if (i.kibor12BidPct != null) {
    references.push(
      rung("kibor", "12-month KIBOR (bid)", "Interbank rate — what banks pay each other", "reference", i.kibor12BidPct, false, s, inf, "Reference, not a retail product.")
    );
  }

  // Best surviving return first; anything unrankable (no inflation) keeps its
  // nominal order at the end rather than pretending to a rank.
  rungs.sort((a, b) => {
    if (a.realAfterTaxPct == null && b.realAfterTaxPct == null) return b.nominalPct - a.nominalPct;
    if (a.realAfterTaxPct == null) return 1;
    if (b.realAfterTaxPct == null) return -1;
    return b.realAfterTaxPct - a.realAfterTaxPct;
  });

  return { rungs, references, omitted, inflationPct: inf };
}
