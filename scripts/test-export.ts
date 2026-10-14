// The export of trades and dividends (lib/export/records): choosing by period,
// kind and share, the totals, the CSV and the LaTeX for the PDF.
//
//   npx tsx scripts/test-export.ts

import { cashOf, recordsCsv, recordsTex, selectRecords, totalsOf, type RecordTx } from "../lib/export/records";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const tx = (date: string, type: string, symbol: string, shares: number, price: number, extra: Partial<RecordTx> = {}): RecordTx => ({
  date, type, symbol, shares, pricePerShare: price, totalAmount: Math.abs(shares) * price, fees: 0, netAmount: Math.abs(shares) * price, taxDeducted: 0, zakatDeducted: 0, warrantNo: "", notes: "", ratio: "", ...extra,
});
const all = [
  tx("2025-08-12", "BUY", "MEBL", 545, 290, { fees: 300, netAmount: 158_350 }),
  tx("2025-11-07", "DIVIDEND", "PTL", 400, 2, { taxDeducted: 120, netAmount: 680, warrantNo: "W-1" }),
  tx("2026-01-10", "BONUS", "AHCL", 100, 0, { totalAmount: 0, netAmount: 0 }),
  tx("2026-02-11", "SELL", "NBP", -300, 160, { fees: 250, netAmount: 47_750, notes: 'Took profit, "early"' }),
  tx("2026-03-25", "DIVIDEND", "MEBL", 545, 7, { taxDeducted: 572.25, zakatDeducted: 10, netAmount: 3_232.75 }),
  tx("2026-10-13", "SELL", "PTL", -3000, 48, { fees: 500, netAmount: 143_500 }),
];

const every = selectRecords(all, { from: null, to: null, kind: "all", symbol: null, actions: true });
check("all time, both kinds, with bonus: everything, oldest first", every.length === 6 && every[0].date === "2025-08-12");
check("trades only leave the dividends out", selectRecords(all, { from: null, to: null, kind: "trades", symbol: null, actions: true }).every((r) => r.type !== "DIVIDEND"));
check("trades without bonus, rights and splits: buys and sales", selectRecords(all, { from: null, to: null, kind: "trades", symbol: null, actions: false }).map((r) => r.type).join() === "BUY,SELL,SELL");
check("dividends only", selectRecords(all, { from: null, to: null, kind: "dividends", symbol: null, actions: true }).map((r) => r.symbol).join() === "PTL,MEBL");
const fy = selectRecords(all, { from: "2025-07-01", to: "2026-06-30", kind: "all", symbol: null, actions: false });
check("a period: both ends count, outside it nothing", fy.length === 4 && fy[fy.length - 1].date === "2026-03-25");
check("one share", selectRecords(all, { from: null, to: null, kind: "all", symbol: "PTL", actions: true }).map((r) => r.type).join() === "DIVIDEND,SELL");

const t = totalsOf(every);
check("totals: bought and sold after fees, fees, dividends gross, tax, zakat and net", near(t.bought, 158_350) && near(t.sold, 191_250) && near(t.fees, 1_050) && near(t.divGross, 800 + 3_815) && near(t.divTax, 692.25) && near(t.divZakat, 10) && near(t.divNet, 3_912.75) && t.buys === 1 && t.sells === 2 && t.dividends === 2, t);
check("cash: a buy out, a sale and a dividend in, a bonus nothing", cashOf(all[0]) === -158_350 && cashOf(all[3]) === 47_750 && cashOf(all[1]) === 680 && cashOf(all[2]) === 0);

const csv = recordsCsv(every, t, "Trades and dividends, All time");
const lines = csv.trim().split("\n");
check("CSV: title, header, a row a record, then the totals", lines[0] === '"Trades and dividends, All time"' && lines[2].startsWith("Date,Type,Symbol,Shares,Price / DPS,Gross,Fees,Tax withheld,Zakat,Net,Cash in/out") && lines.length === 3 + 6 + 1 + 3 + 4 + 1, lines.length);
check("CSV: shares sold shown as a count, quotes and commas escaped", csv.includes('2026-02-11,SELL,NBP,300,160.00,48000.00,250.00,0.00,0.00,47750.00,47750.00,,"Took profit, ""early"""'));
check("CSV: the dividend's tax, zakat and warrant", csv.includes("2026-03-25,DIVIDEND,MEBL,545,7.00,3815.00,0.00,572.25,10.00,3232.75,3232.75,,") && csv.includes(",W-1,"));

const tex = recordsTex(every, t, { title: "Trades & dividends", period: "All time", generatedOn: "2026-10-14" });
check("PDF source: escaped title, longtable rows and the totals", tex.includes("Trades \\& dividends") && tex.includes("\\begin{longtable}") && tex.includes("2026-10-13 & Sell & PTL & 3,000 & 48.00 & 144,000.00 & 500.00 & 143,500.00 \\\\") && tex.includes("Dividends, net & 3,912.75"));
check("PDF source: a dividend's fees column is its tax and zakat", tex.includes("2026-03-25 & Dividend & MEBL & 545 & 7.00 & 3,815.00 & 582.25 & 3,232.75"));
check("an empty choice says so", recordsTex([], totalsOf([]), { title: "x", period: "y", generatedOn: "z" }).includes("Nothing in this period"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
