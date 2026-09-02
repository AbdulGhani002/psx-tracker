// Generic contract-note parser checks.
//
// Half of these exist to prove it REFUSES. A parser that imports something from
// every PDF is worse than one that imports nothing, because a wrong cost basis
// is silent and compounds through every number the app computes afterwards.

import { parseGenericNote, genericToImportRows, findDate } from "../lib/brokers/generic-note";

let pass = 0,
  fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log("PASS ", name, got ?? "");
  } else {
    fail++;
    console.log("FAIL ", name, got ?? "");
  }
}

const page = (...lines: string[]): string[][] => [lines];

// ------------------------------------------------------------- dates
check("reads dd/mm/yyyy the Pakistani way", findDate("Trade Date: 07/08/2026") === "2026-08-07", findDate("Trade Date: 07/08/2026"));
check("flips an impossible dd/mm", findDate("Date 08/23/2026") === "2026-08-23", findDate("Date 08/23/2026"));
check("reads a named month", findDate("30-Jul-2026") === "2026-07-30", findDate("30-Jul-2026"));
check("reads an ISO date", findDate("as at 2026-01-09") === "2026-01-09", findDate("as at 2026-01-09"));
check("returns empty when there is no date", findDate("no date here") === "", findDate("no date here"));

// -------------------------------------------------- a well-formed purchase
{
  const note = parseGenericNote(
    page(
      "AKD SECURITIES LIMITED",
      "PURCHASE CONFIRMATION",
      "Trade Date: 07/08/2026   Settlement: 11/08/2026",
      "Scrip      Qty      Rate       Amount",
      "ENGRO      500      285.50     142750.00",
      "HUBC       1000     142.25     142250.00",
      "Sub Total                      285000.00",
      "Commission                        712.50",
      "GRAND TOTAL                    285712.50"
    )
  );

  check("no problems on a clean note", note.problems.length === 0, note.problems);
  check("side is a purchase", note.side === "BUY", note.side);
  check("date is read", note.tradeDate === "2026-08-07", note.tradeDate);
  check("both rows found", note.rows.length === 2, note.rows.map((r) => r.symbol));
  check("symbols are right", note.rows.map((r) => r.symbol).join(",") === "ENGRO,HUBC", note.rows.map((r) => r.symbol));
  check("quantities are right", note.rows.map((r) => r.qty).join(",") === "500,1000", note.rows.map((r) => r.qty));
  check("rows sum correctly", Math.abs(note.rowSum - 285000) < 0.01, note.rowSum);
  check("the note's own total is found", note.statedTotal === 285712.5, note.statedTotal);
  check("charges come out of the gap", Math.abs(note.fees - 712.5) < 0.01, note.fees);
  check("broker name is picked up", note.broker.includes("AKD"), note.broker);

  const imported = genericToImportRows(note);
  check("two import rows", imported.length === 2, imported.length);
  check("prices survive the round trip", imported[0].price === 285.5 && imported[1].price === 142.25, imported.map((r) => r.price));
  check(
    "charges are split by value",
    Math.abs(imported[0].fees + imported[1].fees - 712.5) < 0.02,
    imported.map((r) => r.fees)
  );
  check("both rows are buys", imported.every((r) => r.type === "BUY"), imported[0].type);
}

// ------------------------------------------------------------- a sale
{
  const note = parseGenericNote(
    page(
      "Arif Habib Limited",
      "SALE CONFIRMATION",
      "Date 12-Aug-2026",
      "LUCK   200   1015.00   203000.00",
      "TOTAL              203000.00"
    )
  );
  check("side is a sale", note.side === "SELL", note.side);
  check("sale parses with no problems", note.problems.length === 0, note.problems);
  check("sale with no fee gap has none", note.fees === 0, note.fees);
  check("sale becomes a SELL row", genericToImportRows(note)[0]?.type === "SELL", genericToImportRows(note)[0]?.type);
}

// ------------------------------------------------- refusals: the important half
{
  // Rows that do not add up to the stated total must import nothing.
  const note = parseGenericNote(
    page(
      "Some Securities",
      "PURCHASE CONFIRMATION",
      "07/08/2026",
      "ENGRO   500   285.50   142750.00",
      "GRAND TOTAL           900000.00"
    )
  );
  check("a total that does not match is refused", note.problems.length > 0, note.problems[0]?.slice(0, 60));
  check("a refused note imports nothing", genericToImportRows(note).length === 0, genericToImportRows(note).length);
}

{
  // Both words on the page: the side is genuinely ambiguous and must not be guessed.
  const note = parseGenericNote(
    page("Broker Ltd", "Purchase and Sale Statement", "07/08/2026", "ENGRO 500 285.50 142750.00", "TOTAL 142750.00")
  );
  check("an ambiguous side is refused", note.side === null, note.side);
  check("ambiguity is explained", note.problems.some((p) => p.includes("purchase from a sale")), note.problems[0]?.slice(0, 40));
  check("ambiguous note imports nothing", genericToImportRows(note).length === 0, genericToImportRows(note).length);
}

{
  // Numbers that do not multiply out are not a trade row.
  const note = parseGenericNote(
    page("Broker Ltd", "PURCHASE CONFIRMATION", "07/08/2026", "ENGRO   500   285.50   999999.00", "TOTAL 999999.00")
  );
  check("a row that does not multiply out is not a row", note.rows.length === 0, note.rows.length);
  check("a note with no rows is refused", note.problems.length > 0, note.problems[0]?.slice(0, 50));
}

{
  // No total printed anywhere: the rows cannot be proven, so they are not trusted.
  const note = parseGenericNote(
    page("Broker Ltd", "PURCHASE CONFIRMATION", "07/08/2026", "ENGRO   500   285.50   142750.00")
  );
  check("a note with no total is refused", note.problems.some((p) => p.includes("no total")), note.problems);
  check("but the row was still read, for display", note.rows.length === 1, note.rows.length);
  check("nothing is imported from it", genericToImportRows(note).length === 0, genericToImportRows(note).length);
}

{
  // The raw lines always come back, so a person can see what the PDF said.
  const note = parseGenericNote(page("Nothing useful", "at all"));
  check("raw lines are always returned", note.rawLines.length === 2, note.rawLines.length);
}

// ------------------------------------------------- the traps that produce wrong data
{
  // A total line reconciles as neatly as a trade row. Counting it would double
  // the note, which is the single most expensive way this could fail.
  const note = parseGenericNote(
    page(
      "Broker Ltd",
      "PURCHASE CONFIRMATION",
      "07/08/2026",
      "ENGRO   500   285.50   142750.00",
      "TOTAL   500   285.50   142750.00"
    )
  );
  check("a total line is never counted as a trade", note.rows.length === 1, note.rows.length);
  check("so the sum is not doubled", Math.abs(note.rowSum - 142750) < 0.01, note.rowSum);
}

{
  // Fractional quantities are some other column, not a share count.
  const note = parseGenericNote(
    page("Broker Ltd", "PURCHASE CONFIRMATION", "07/08/2026", "Yield 2.5 4.0 10.0 rate line", "TOTAL 10.00")
  );
  check("a stray small-number line is not a trade", note.rows.length === 0, note.rows.length);
}

{
  // Two fills of the same name at the same price merge into one position line.
  const note = parseGenericNote(
    page(
      "Broker Ltd",
      "PURCHASE CONFIRMATION",
      "07/08/2026",
      "HUBC   100   142.25   14225.00",
      "HUBC    20   142.25    2845.00",
      "TOTAL            17070.00"
    )
  );
  const rows = genericToImportRows(note);
  check("same name at the same price merges", rows.length === 1, rows.length);
  check("merged quantity is the sum", rows[0]?.shares === 120, rows[0]?.shares);
  check("merged price is unchanged", rows[0]?.price === 142.25, rows[0]?.price);
}

{
  // A header word must never be taken for a symbol.
  const note = parseGenericNote(
    page("Broker Ltd", "PURCHASE CONFIRMATION", "07/08/2026", "TOTAL VALUE 500 285.50 142750.00", "TOTAL 142750.00")
  );
  check("a totals line is skipped whatever it contains", note.rows.length === 0, note.rows.map((r) => r.symbol));
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
