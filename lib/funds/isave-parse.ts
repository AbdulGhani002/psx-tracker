// MCB iSave statement-of-account parser.
//
// Anchors on the per-fund summary line the statement prints after each fund's
// activity block:
//   "Value of MCBCMO 536.4755 Units based on Repurchase price of Rs. 103.682
//    as on 06 AUG 2026 is Rs. 55,622.85"
// and cross-checks the statement's own grand total:
//   "Total Investment Value of Processed Transactions Based on Repurchase Price. 55,643.37"
//
// Gates: units × NAV must reproduce each printed value (tolerance covers the
// statement's 4-dp unit display truncation — dust rows like ".0044 Units" print
// values up to ~2 paisa off their own arithmetic), and the printed values must
// sum to the printed total. Any miss → problems[], and apply is refused.

export type StatementFund = {
  code: string; // iSave fund code, e.g. MCBCMO
  units: number;
  nav: number; // repurchase price
  asOf: string; // ISO date of the repurchase price
  value: number; // printed Rs value
};

export type IsaveStatement = {
  registration: string | null;
  funds: StatementFund[];
  totalStated: number | null;
  totalComputed: number;
  problems: string[]; // non-empty = do NOT apply
};

// iSave code → exact MUFAP fund name (the key both MutualFund.mufapName and the
// mufapNavs snapshot use). All four verified against the live statement and the
// MUFAP feed on 2026-08-07. Unknown codes are surfaced, never guessed.
export const ISAVE_CODE_TO_MUFAP: Record<string, string> = {
  MCBCMO: "MCB Cash Management Optimizer",
  MCBPSM: "MCB Pakistan Stock Market Fund",
  MCBPSF: "MCB Pakistan Sovereign Fund",
  ALHDDF: "Alhamra Daily Dividend Fund",
};

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

const num = (s: string): number => Number(s.replace(/,/g, ""));

// "06 AUG 2026" → "2026-08-06"
function toIso(d: string): string {
  const m = /^(\d{1,2}) ([A-Z]{3}) (\d{4})$/.exec(d.trim());
  if (!m || !MONTHS[m[2]]) return "";
  return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
}

const VALUE_LINE =
  /Value of ([A-Z]+) ([\d,]*\.?\d+) Units based on Repurchase price of Rs\.? ?([\d,]*\.?\d+) as on (\d{1,2} [A-Z]{3} \d{4}) is Rs\.? ?([\d,]*\.?\d+)/;

export function parseIsaveStatement(pages: string[][]): IsaveStatement {
  const lines = pages.flat();
  const problems: string[] = [];
  const funds: StatementFund[] = [];
  let registration: string | null = null;
  let totalStated: number | null = null;

  for (const line of lines) {
    const reg = /Registration #\s*[:.]?\s*(\d+)/.exec(line);
    if (reg && !registration) registration = reg[1];

    const v = VALUE_LINE.exec(line);
    if (v) {
      const asOf = toIso(v[4]);
      if (!asOf) problems.push(`${v[1]}: unreadable as-on date "${v[4]}"`);
      funds.push({ code: v[1], units: num(v[2]), nav: num(v[3]), asOf, value: num(v[5]) });
      continue;
    }

    const t = /Total Investment Value of Processed Transactions[^\d]*([\d,]+\.\d{2})/.exec(line);
    if (t) totalStated = num(t[1]);
  }

  if (funds.length === 0) problems.push("no fund value lines found — not an iSave statement or layout changed");

  const seen = new Set<string>();
  for (const f of funds) {
    if (seen.has(f.code)) problems.push(`${f.code}: appears twice`);
    seen.add(f.code);
    // Units print at 4 dp (dust rows even drop the leading zero), so the true
    // unit count can differ by up to ~0.00005–0.006 from what's shown; allow
    // that truncation times NAV, plus a paisa of value rounding.
    const tol = 0.011 + f.nav * 0.0002;
    if (Math.abs(f.units * f.nav - f.value) > tol) {
      problems.push(`${f.code}: ${f.units} × ${f.nav} = ${(f.units * f.nav).toFixed(2)} ≠ printed ${f.value.toFixed(2)}`);
    }
  }

  const totalComputed = Math.round(funds.reduce((s, f) => s + f.value, 0) * 100) / 100;
  if (totalStated == null) {
    if (funds.length > 0) problems.push("statement total line not found — cross-check impossible");
  } else if (Math.abs(totalComputed - totalStated) > 0.02 + 0.005 * funds.length) {
    problems.push(`fund values sum to ${totalComputed.toFixed(2)} ≠ statement total ${totalStated.toFixed(2)}`);
  }

  return { registration, funds, totalStated, totalComputed, problems };
}
