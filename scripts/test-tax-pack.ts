// Tax pack template checks: it must escape LaTeX metacharacters, it must handle
// an empty year without emitting a broken table, and what it produces must
// actually typeset.

import { buildTaxPackTex, type TaxPackData } from "../lib/statement/tax-pack-template";

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

const BS = String.fromCharCode(92); // a backslash, kept out of string literals

const base: TaxPackData = {
  yearLabel: "TY2026",
  fbrName: "Tax Year 2026",
  periodLine: "1 July 2025 to 30 June 2026",
  generatedOn: "2 September 2026",
  filerStatus: "a filer",
  dividends: [
    { symbol: "MEBL", count: 4, gross: 48000, wht: 7200, zakat: 0, net: 40800 },
    { symbol: "OGDC & CO", count: 2, gross: 15000, wht: 2250, zakat: 375, net: 12375 },
  ],
  divTotals: { gross: 63000, wht: 9450, zakat: 375, net: 53175 },
  disposals: [
    {
      soldDate: "2026-02-11",
      symbol: "HUBC",
      shares: 500,
      acquired: "2024-09-02",
      holdingDays: 527,
      longTerm: true,
      cost: 61000,
      proceeds: 74500,
      gain: 13500,
    },
    {
      soldDate: "2026-05-20",
      symbol: "ENGRO",
      shares: 100,
      acquired: "2025-11-14",
      holdingDays: 187,
      longTerm: false,
      cost: 28500,
      proceeds: 26100,
      gain: -2400,
    },
  ],
  cgt: { netGain: 11100, longTermGain: 13500, shortTermGain: -2400, cgt: 1665, rate: 15 },
  yearEndDate: "30 June 2026",
  holdings: [
    { symbol: "MEBL", shares: 1200, cost: 186000, lots: 3, oldest: "2023-04-11" },
    { symbol: "100% & co_x", shares: 50, cost: 0, lots: 1, oldest: "2025-06-30" },
  ],
  holdingsCost: 186000,
  notes: ["Bank profit is not here.", "Salary and rent are not here."],
  warnings: ["OGDC: half the dividends have no withholding recorded."],
};

const tex = buildTaxPackTex(base);

check("emits a document", tex.includes(BS + "begin{document}") && tex.includes(BS + "end{document}"));
check("escapes an ampersand in a symbol", tex.includes("OGDC " + BS + "& CO"));
check("escapes percent, ampersand and underscore together", tex.includes("100" + BS + "% " + BS + "& co" + BS + "_x"));
check("carries the year end date", tex.includes("30 June 2026"));
check("carries the warnings section", tex.includes("Check these before filing"));
check("renders the long-term flag", tex.includes("527 & yes"));
check("keeps a loss negative", tex.includes("-2,400.00"));
check("totals the dividends", tex.includes("63,000.00"));
check("totals the holding cost", tex.includes("186,000.00"));

const empty = buildTaxPackTex({
  ...base,
  dividends: [],
  divTotals: { gross: 0, wht: 0, zakat: 0, net: 0 },
  disposals: [],
  holdings: [],
  holdingsCost: 0,
  warnings: [],
});

check("an empty year says so for dividends", empty.includes("No dividend warrants are recorded"));
check("an empty year says so for disposals", empty.includes("No shares were sold"));
check("an empty year says so for holdings", empty.includes("No open positions"));
check("no warnings section when there are none", !empty.includes("Check these before filing"));
check("an empty year still emits a whole document", empty.includes(BS + "end{document}"));
check(
  "an empty year opens no table it does not close",
  (empty.match(new RegExp(BS + BS + "begin\\{longtable\\}", "g")) ?? []).length ===
    (empty.match(new RegExp(BS + BS + "end\\{longtable\\}", "g")) ?? []).length
);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
