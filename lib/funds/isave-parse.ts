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
  activity: FundActivity | null; // parsed transaction rows, when the window had any
};

export type ActivityRow = {
  date: string; // ISO
  nature: string; // verbatim from the statement
  unitsDelta: number; // signed — direction PROVEN by the balance chain, not guessed from words
  rate: number | null;
  netAmount: number | null; // money moved (unsigned as printed)
  balance: number; // balance units after this row
  costEffect: "money_in" | "units_only" | "units_out" | "unknown";
};

export type FundActivity = {
  lastBalance: number; // opening balance units for the window
  rows: ActivityRow[];
  chainOk: boolean; // every row's delta matches its printed balance, ending at the Value line
  classified: boolean; // every unit-adding row has a known cost classification
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

// A "Value of CODE …" line that we could NOT read in full. Kept separate from
// VALUE_LINE so a fund whose closing amount is unreadable is REPORTED rather
// than skipped — silently dropping a section is how the largest holding on a
// real statement went missing.
const VALUE_LINE_LOOSE = /Value of ([A-Z]+) /;

// iSave prints the closing amount hard against the right margin, on its own
// text run. When the label ahead of it runs long the amount lands on the NEXT
// extracted line, so the section ends at "… is Rs." with nothing after it.
// Unjoined, VALUE_LINE simply does not match and the whole fund vanishes.
// Stitch the trailing bare number back on before anything tries to read it.
const BARE_AMOUNT = /^\(?[\d,]*\.?\d+\)?$/;
// When a row's description runs long — an iPayment- carries the payee's name
// and IBAN over five or six lines — iSave pushes the DATE onto a line of its
// own and starts the row on the next. The row then has no date, so it never
// matches, and the next dated line (typically the CGT* announcement that
// follows) is measured against the balance the skipped row moved. That is what
// produced "balance moved -162.5492 but row prints 58.45 units": 58.45 was the
// price, read off the wrong row entirely.
//
// Rejoin the two, but only when the join actually parses — an orphan date
// followed by anything else is left exactly as it was.
function stitchOrphanDates(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (DATE_ONLY.test(trimmed)) {
      const next = (lines[i + 1] ?? "").trim();
      const joined = `${trimmed} ${next}`;
      if (next && (ROW_LINE.test(joined) || LAST_BALANCE.test(joined))) {
        out.push(joined);
        i++;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out;
}

function stitchWrappedAmounts(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const awaitingAmount =
      /Value of [A-Z]+ .* is Rs\.?$/.test(trimmed) ||
      /Total Investment Value of Processed Transactions[^\d]*$/.test(trimmed);
    const next = (lines[i + 1] ?? "").trim();
    if (awaitingAmount && BARE_AMOUNT.test(next)) {
      out.push(`${trimmed} ${next}`);
      i++; // the bare amount belongs to the line above, not to the next fund
      continue;
    }
    out.push(line);
  }
  return out;
}

// "01-JUL-26" (row dates print 2-digit years) → ISO.
function rowDateToIso(d: string): string {
  const m = /^(\d{2})-([A-Z]{3})-(\d{2})$/.exec(d.trim());
  if (!m || !MONTHS[m[2]]) return "";
  return `20${m[3]}-${MONTHS[m[2]]}-${m[1]}`;
}

// A transaction row: date, nature words, then a run of numbers ending in the
// balance-units column. Outflows print in parentheses.
const ROW_LINE = /^(\d{2}-[A-Z]{3}-\d{2})\s+(.+?)\s+((?:\(?[\d,]*\.?\d+\)?\s*)+)$/;

// The opening-balance line; the date sometimes clusters onto it.
const LAST_BALANCE = /^(?:\d{2}-[A-Z]{3}-\d{2}\s+)?Last Balance\s+\(?([\d,]*\.?\d+)\)?$/;

const DATE_ONLY = /^\d{2}-[A-Z]{3}-\d{2}$/;

// Natures that MUST move units. A row of one of these that leaves the balance
// untouched has not been read correctly, and saying so is the only guard left
// once the printed-units cross-check is skipped for rows that carry no units
// column at all. "Dividend-Declare", "Dividend-Tax" and "CGT*" deliberately
// match nothing here: they are announcements, not unit movements.
const UNIT_MOVING_NATURE = /purchase|invest|redemption|conversion|transfer|additional-?units|bonus/i;

function classifyNature(nature: string, delta: number): ActivityRow["costEffect"] {
  if (delta < 0) return "units_out";
  // Return-of-capital natures FIRST: "Dividend Re-Invest" must not be caught
  // by the money-in "invest" pattern — reinvested dividends are return, and
  // counting them as cost would fake away the fund's whole yield.
  // "Additional-Units" are issued by the AMC at a printed rate of .0000 — free
  // units, like a bonus. Costing them would invent money that never moved; at
  // zero cost they correctly dilute the average.
  if (/dividend|bonus|re-?invest|refund|cgt|zakat|reversal|additional-?units/i.test(nature)) return "units_only";
  // Direction is settled above by the balance chain, so these need not name it.
  // The old pattern demanded the words "conversion in" / "transfer in" and so
  // failed on iSave's actual label, "App Conversion" — leaving the fund that
  // received a Rs 40,119 switch with no cost classification at all, which made
  // the whole cost walk refuse. An outflow never reaches this line.
  if (/purchase|conversion|transfer|invest/i.test(nature)) return "money_in";
  return "unknown";
}

// Walk the activity rows over a starting (units, avgCost) position. Money-in
// rows add their net amount to cost; units-only rows (reinvested dividends)
// add units at zero cost; outflows remove cost at the running average. Pure —
// the statement-apply route and the tests share it.
export function walkCost(
  activity: FundActivity,
  startAvgCost: number
): { newAvgCost: number; moneyIn: number; costOut: number; ok: boolean; reason: string } {
  if (!activity.chainOk) return { newAvgCost: startAvgCost, moneyIn: 0, costOut: 0, ok: false, reason: "unit chain does not reconcile" };
  if (!activity.classified) return { newAvgCost: startAvgCost, moneyIn: 0, costOut: 0, ok: false, reason: "a row's nature is unrecognised — cost effect unknown" };
  let units = activity.lastBalance;
  let cost = activity.lastBalance * startAvgCost;
  let moneyIn = 0;
  let costOut = 0;
  for (const r of activity.rows) {
    if (r.costEffect === "money_in") {
      if (r.netAmount == null) return { newAvgCost: startAvgCost, moneyIn, costOut, ok: false, reason: `${r.date} ${r.nature}: no net amount printed` };
      cost += r.netAmount;
      moneyIn += r.netAmount;
      units += r.unitsDelta;
    } else if (r.costEffect === "units_only") {
      units += r.unitsDelta;
    } else if (r.costEffect === "units_out") {
      const avg = units > 0 ? cost / units : 0;
      const out = avg * Math.abs(r.unitsDelta);
      cost -= out;
      costOut += out;
      units += r.unitsDelta; // delta is negative
    }
  }
  if (units <= 0) return { newAvgCost: startAvgCost, moneyIn, costOut, ok: false, reason: "position fully redeemed in window" };
  return { newAvgCost: cost / units, moneyIn, costOut, ok: true, reason: "" };
}

export function parseIsaveStatement(pages: string[][]): IsaveStatement {
  const lines = stitchOrphanDates(stitchWrappedAmounts(pages.flat()));
  const problems: string[] = [];
  const funds: StatementFund[] = [];
  let registration: string | null = null;
  let totalStated: number | null = null;

  // Rows accumulate under whichever fund section we're inside; the section's
  // "Value of CODE …" line closes it and claims the pending rows. Header lines
  // reset the bucket so stray numbers between funds can't leak across.
  let pendingLastBalance: number | null = null;
  let pendingRows: Array<{ date: string; nature: string; nums: number[]; raw: string }> = [];

  for (const line of lines) {
    const reg = /Registration #\s*[:.]?\s*(\d+)/.exec(line);
    if (reg && !registration) registration = reg[1];

    // The opening-balance line; the date sometimes clusters onto it.
    const lb = LAST_BALANCE.exec(line.trim());
    if (lb) {
      pendingLastBalance = num(lb[1]);
      pendingRows = [];
      continue;
    }

    const row = ROW_LINE.exec(line.trim());
    if (row && pendingLastBalance != null) {
      const nums = (row[3].match(/\(?[\d,]*\.?\d+\)?/g) ?? []).map((s) => {
        const neg = s.startsWith("(");
        const v = num(s.replace(/[()]/g, ""));
        return neg ? -v : v;
      });
      pendingRows.push({ date: row[1], nature: row[2].trim(), nums, raw: line.trim() });
      continue;
    }

    const v = VALUE_LINE.exec(line);
    if (v) {
      const code = v[1];
      const finalUnits = num(v[2]);
      const asOf = toIso(v[4]);
      if (!asOf) problems.push(`${code}: unreadable as-on date "${v[4]}"`);

      let activity: FundActivity | null = null;
      if (pendingLastBalance != null && pendingRows.length > 0) {
        let chainOk = true;
        let classified = true;
        let prev = pendingLastBalance;
        const rows: ActivityRow[] = [];
        for (const pr of pendingRows) {
          // Anchor from the right: last number is the balance-units column.
          const balance = pr.nums[pr.nums.length - 1];
          const date = rowDateToIso(pr.date);
          if (!date || pr.nums.length < 1) { chainOk = false; problems.push(`${code}: unreadable row "${pr.raw.slice(0, 70)}"`); continue; }
          const delta = Math.round((balance - prev) * 10000) / 10000;
          // The printed units column (first number) must agree with the balance
          // movement — that's the self-check that catches a mis-mapped column.
          //
          // Only for rows that HAVE a units column. "Dividend-Declare",
          // "Dividend-Tax" and "CGT*" announce an amount and move no units at
          // all, so their first number is money or a rate, and demanding it
          // equal a zero delta failed every one of them. Such a row is inert:
          // it adds nothing to the chain and nothing to cost, so there is
          // nothing to cross-check. What IS checked is that a nature which
          // must move units did not somehow move none.
          if (Math.abs(delta) > 0.00005) {
            const printedUnits = Math.abs(pr.nums[0]);
            if (Math.abs(Math.abs(delta) - printedUnits) > 0.002) {
              chainOk = false;
              problems.push(`${code} ${pr.date}: balance moved ${delta} but row prints ${printedUnits} units`);
            }
          } else if (UNIT_MOVING_NATURE.test(pr.nature)) {
            chainOk = false;
            problems.push(`${code} ${pr.date}: "${pr.nature}" left the balance unchanged — the row did not read correctly`);
          }
          // Net amount: second-to-last number when the row carries money columns.
          const netAmount = pr.nums.length >= 3 ? Math.abs(pr.nums[pr.nums.length - 2]) : null;
          const rate = pr.nums.length >= 4 ? Math.abs(pr.nums[1]) : null;
          const costEffect = classifyNature(pr.nature, delta);
          if (costEffect === "unknown") classified = false;
          rows.push({ date, nature: pr.nature, unitsDelta: delta, rate, netAmount, balance, costEffect });
          prev = balance;
        }
        if (Math.abs(prev - finalUnits) > 0.002) {
          chainOk = false;
          problems.push(`${code}: last row balance ${prev} ≠ closing units ${finalUnits}`);
        }
        activity = { lastBalance: pendingLastBalance, rows, chainOk, classified };
      }

      funds.push({ code, units: finalUnits, nav: num(v[3]), asOf, value: num(v[5]), activity });
      pendingLastBalance = null;
      pendingRows = [];
      continue;
    }

    // The line names a fund but did not read cleanly. Say so loudly: an
    // unreadable section must never pass as an absent one.
    const loose = VALUE_LINE_LOOSE.exec(line);
    if (loose) {
      problems.push(`${loose[1]}: value line present but unreadable "${line.trim().slice(0, 90)}"`);
      pendingLastBalance = null;
      pendingRows = [];
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
