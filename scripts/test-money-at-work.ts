// Returns and yields when shares are bought and sold over time
// (lib/calculations/holding.ts moneyAtWork and heldAndSold, portfolio.ts
// buildPositionRows).
//
//   npx tsx scripts/test-money-at-work.ts

import { moneyAtWork, heldAndSold } from "../lib/calculations/holding";
import { buildPositionRows } from "../lib/calculations/portfolio";
import type { Transaction, Holding } from "../lib/types";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 0.01) => a != null && Math.abs(a - b) <= tol;

let id = 0;
const tx = (date: string, type: Transaction["type"], shares: number, netAmount: number, pricePerShare = 0): Transaction =>
  ({ _id: String(++id), symbol: "PTL", type, date: date + "T00:00:00Z", shares, pricePerShare, totalAmount: netAmount, fees: 0, netAmount, notes: "", ratio: "", createdAt: date, updatedAt: date } as Transaction);
const at = (d: string) => new Date(d + "T00:00:00Z");

// 3,248 bought on 15 Jan, a Rs 2 dividend on them in March, 3,000 sold at a
// loss on 14 Oct: 248 left.
const ptl = [tx("2026-01-15", "BUY", 3248, 163_862), tx("2026-03-11", "DIVIDEND", 0, 5_522, 2), tx("2026-10-14", "SELL", -3000, 140_000)];
const w = moneyAtWork(ptl, at("2026-10-14"));
check("days held: from the buy to today; the sale's own day holds nothing more", w.daysHeld === 272, w);
check("money at work: the cost held through those days", near(w.average, 163_862), w.average);
check("over the last year, the days before the buy count as nothing", near(w.average12m, (163_862 * 272) / 365), w.average12m);
check("the year's dividends", w.dividends12m === 5_522);

const holding = { symbol: "PTL", name: "Panther Tyres", sector: "Auto", shariaCompliant: false, targetAllocationPercent: 1 } as Holding;
const [row] = buildPositionRows({ holdings: [holding], transactions: ptl, prices: new Map([["PTL", 46.8]]), asOf: at("2026-10-14") });
const realized = 140_000 - 163_862 * (3000 / 3248);
const open = 248 * 46.8 - 163_862 * (248 / 3248);
check("all told: booked on the sale, open and dividends, on the money at work", near(row.totalReturn, realized + open + 5_522, 0.5) && near(row.totalReturnPct, (realized + open + 5_522) / 163_862, 0.0001), row);

// Dividends follow the shares that earned them.
const left = 248 / 3248;
const split = heldAndSold(ptl, at("2026-10-14"));
check("the 248 shares left keep only their part of the dividend", near(split.held.dividends, 5_522 * left) && near(split.held.cost, 163_862 * left) && split.held.shares === 248, split.held);
check("the 3,000 sold take theirs with them, set against the sale", split.sold.shares === 3000 && near(split.sold.dividends, 5_522 * (1 - left)) && near(split.sold.cost, 163_862 * (1 - left)) && split.sold.proceeds === 140_000, split.sold);
check("nothing lost or counted twice: dividends and cost add up", near(split.held.dividends + split.sold.dividends, 5_522) && near(split.held.cost + split.sold.cost, 163_862));
check("the position row carries what was sold", row.sold.shares === 3000 && near(row.sold.dividends, 5_522 * (1 - left)));

// The next dividend: book closure on 10 Oct while 3,248 were held, recorded
// then by the exchange's announcement, or later from the warrant on its pay
// day after the sale. Either way the 248 left get 248 shares' worth.
const autoRow = [...ptl.slice(0, 2), tx("2026-10-10", "DIVIDEND", 3248, 5_522, 2), ptl[2]];
const warrant = [...ptl, tx("2026-11-05", "DIVIDEND", 3248, 5_522, 2)];
const a = heldAndSold(autoRow, at("2026-11-30"));
const b = heldAndSold(warrant, at("2026-11-30"));
check("recorded at book closure or on the pay day after the sale: the same split", near(a.held.dividends, 2 * 5_522 * left) && near(b.held.dividends, 2 * 5_522 * left) && near(a.sold.dividends, b.sold.dividends), { a, b });
const bookedNet = b.sold.proceeds - b.sold.cost + b.sold.dividends;
check("what the 3,000 sold booked: the sale's loss less the dividends they earned", near(bookedNet, 140_000 - 163_862 * (1 - left) + 2 * 5_522 * (1 - left)) && bookedNet < 0, bookedNet);
check("sold out before a dividend is paid: all of it goes with the sale", heldAndSold([tx("2026-01-01", "BUY", 100, 5_000), tx("2026-02-01", "SELL", -100, 5_200), tx("2026-03-01", "DIVIDEND", 100, 170, 2)], at("2026-04-01")).sold.dividends === 170);
check("a dividend on fewer shares than held (bought after book closure) all goes to the shares held", heldAndSold([tx("2026-01-01", "BUY", 100, 5_000), tx("2026-02-01", "BUY", 100, 5_000), tx("2026-02-10", "DIVIDEND", 100, 170, 2)], at("2026-04-01")).held.dividends === 170);

// Kept the same over the years: the % is the plain one on the cost.
const steady = [tx("2024-01-01", "BUY", 100, 10_000), tx("2025-06-01", "DIVIDEND", 0, 800, 8)];
const [s] = buildPositionRows({ holdings: [holding], transactions: steady, prices: new Map([["PTL", 110]]), asOf: at("2026-01-01") });
check("a position held unchanged: money at work is its cost", near(s.moneyAtWork, 10_000) && near(s.totalReturnPct, (1_000 + 800) / 10_000, 0.0001), s);

// Sold out and bought again: the months with nothing held do not count.
const gap = moneyAtWork([tx("2025-01-01", "BUY", 100, 10_000), tx("2025-04-01", "SELL", -100, 10_500), tx("2025-10-01", "BUY", 100, 20_000)], at("2025-12-31"));
check("a gap with nothing held is not counted as days at work", gap.daysHeld === 90 + 91 && near(gap.average, (10_000 * 90 + 20_000 * 91) / 181), gap);

// Bought today: no days yet, so the % falls back to the cost.
const [fresh] = buildPositionRows({ holdings: [holding], transactions: [tx("2026-10-14", "BUY", 10, 500)], prices: new Map([["PTL", 52]]), asOf: at("2026-10-14") });
check("bought today: the % is on the cost", near(fresh.moneyAtWork, 500) && near(fresh.totalReturnPct, 20 / 500, 0.0001), fresh);
const bought = heldAndSold([tx("2026-01-01", "BUY", 100, 5_000), tx("2026-03-01", "DIVIDEND", 100, 170, 2), tx("2026-06-01", "BUY", 900, 45_000)], at("2026-10-01"));
check("shares bought after a dividend: the dividend stays with the shares held, nothing sold", near(bought.held.dividends, 170) && bought.sold.dividends === 0);

check("trades after the date asked about are left out", moneyAtWork([...ptl, tx("2027-01-01", "BUY", 1000, 50_000)], at("2026-10-14")).daysHeld === 272);

// PTL as it really went, Aug 2025 to 14 Oct 2026: bought and sold in rounds,
// three payouts. Yield on cost is everything on the capital employed.
const ptlReal: Array<[string, Transaction["type"], number, number]> = [
  ["2025-08-27", "BUY", 400, 21603], ["2025-11-07", "DIVIDEND", 400, 680], ["2025-11-14", "BUY", 290, 15001], ["2025-11-17", "BUY", 60, 3160], ["2026-01-26", "BUY", 15, 947], ["2026-02-10", "BUY", 10, 628],
  ["2026-03-25", "DIVIDEND", 25, 36.5], ["2026-03-25", "DIVIDEND", 750, 1275], ["2026-03-25", "SELL", -25, 1244], ["2026-03-26", "SELL", -500, 25621], ["2026-05-11", "BUY", 500, 27638], ["2026-05-29", "BUY", 84, 4500],
  ["2026-06-08", "BUY", 781, 40799], ["2026-06-09", "BUY", 13, 679], ["2026-06-17", "BUY", 80, 4382], ["2026-06-19", "BUY", 61, 3310], ["2026-06-23", "BUY", 90, 5011], ["2026-07-03", "BUY", 20, 1161], ["2026-07-20", "SELL", -1300, 71902],
  ["2026-07-21", "BUY", 7, 396], ["2026-07-21", "BUY", 23, 1226], ["2026-07-27", "BUY", 20, 1066], ["2026-08-13", "BUY", 14, 760], ["2026-08-17", "BUY", 24, 1290], ["2026-09-07", "BUY", 89, 4787], ["2026-09-07", "BUY", 1, 54],
  ["2026-09-09", "BUY", 40, 2079], ["2026-09-09", "BUY", 70, 3639], ["2026-09-11", "BUY", 200, 9617], ["2026-09-15", "BUY", 300, 14575], ["2026-09-21", "BUY", 5, 254], ["2026-09-21", "BUY", 1, 51], ["2026-09-26", "BUY", 30, 1503],
  ["2026-09-28", "BUY", 845, 41900], ["2026-09-29", "BUY", 1000, 49585], ["2026-10-14", "DIVIDEND", 3248, 5522], ["2026-10-14", "SELL", -500, 23085], ["2026-10-14", "SELL", -2450, 112628], ["2026-10-14", "SELL", -50, 2309],
];
const [real1] = buildPositionRows({ holdings: [holding], transactions: ptlReal.map(([d, t, n, a]) => tx(d, t, n, a, t === "DIVIDEND" ? 2 : 0)), prices: new Map([["PTL", 46.8]]), asOf: at("2026-10-14") });
const everything = real1.dividendsReceived + real1.realizedPL + real1.unrealizedPL;
check("PTL: everything is dividends +7,514, trades -12,301 and open -904", near(real1.dividendsReceived, 7_513.5, 1) && near(real1.realizedPL, -12_301, 1) && near(real1.unrealizedPL, -904, 1) && near(real1.totalReturn, everything, 0.01), { d: real1.dividendsReceived, t: real1.realizedPL, o: real1.unrealizedPL });
check("PTL: on Rs 44,723 employed on average over 413 days, yield on cost -12.7%", near(real1.moneyAtWork, 44_723, 1) && real1.daysHeld === 413 && near(real1.totalReturnPct, -0.127, 0.001), { atWork: real1.moneyAtWork, days: real1.daysHeld, pct: real1.totalReturnPct });

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
