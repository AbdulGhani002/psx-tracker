// Reading T-bill auction results from the press reports (lib/feeds/tbill-parse):
// the 2026 tables, a rejected tenor, the 2025 prose, the links that are
// auction reports, keeping one auction a day, and the auction before a date.
//
//   npx tsx scripts/test-tbill-auctions.ts

import { auctionOn, htmlText, isAuctionLink, mergeAuctions, parseAuction, type Auction } from "../lib/feeds/tbill-parse";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

const JUL26 = "Tenders for the sale of 1-Month, 3-Month, 6-Month, and 12-Month Government of Pakistan Market Treasury Bills were invited by the State Bank of Pakistan through Primary Dealers on July 8, 2026, with a settlement date of July 9, 2026. Total face value bids received stood highest in the 12-Month tenor at Rs1,547.55bn. Cut-Off Yield Comparison Tenor 08-Jul-26 23-Jun-26 Change (bps) 1-Month 11.3968% 11.7997% (40.3) 3-Month 11.3978% 11.7499% (35.2) 6-Month 11.4375% 11.7479% (31.0) 12-Month 11.4880% 11.8381% (35.0) Competitive Bids Accepted Tenor Face Value (Rs bn) Cut-off Yield Weighted Avg Yield 1-Month 35 11.3968% 11.3917% 3-Month 44.44 11.3978% 11.3716% 6-Month 135.29 11.4375% 11.3904% 12-Month 848.60 11.4880% 11.3731% Total 1,063.33";
const a = parseAuction(JUL26, "2026-07-08T21:43:24Z", "https://x/61694");
check("2026 report: its own auction from the dealers' date, every tenor", a[0]?.date === "2026-07-08" && a[0].m1 === 11.3968 && a[0].m3 === 11.3978 && a[0].m6 === 11.4375 && a[0].m12 === 11.488 && a[0].own, a[0]);
check("and the auction before, from the comparison", a[1]?.date === "2026-06-23" && a[1].m12 === 11.8381 && a[1].m1 === 11.7997 && !a[1].own, a[1]);

const SEP26 = "Cut-Off Yield Comparison Tenor 30-Sep-26 16-Sep-26 Change (bps) 1-Month 11.68% Bids Rejected 3-Month 11.99% 11.38% 60.95 6-Month 12.45% 11.70% 75 12-Month 12.49% 12.00% 49.45 Competitive Bids Accepted Tenor Face Value (Rs bn) Cut-off Yield Weighted Avg Yield 1-Month 138.4 11.68% 11.57% 3-Month 143.86 11.99% 11.73% 6-Month 88.33 12.45% 12.12% 12-Month 29.66 12.49% 12.35%";
const b = parseAuction(SEP26, "2026-09-30T22:22:57Z", "https://x/63870");
check("a tenor whose bids were rejected last time has no earlier yield", b[0]?.date === "2026-09-30" && b[0].m12 === 12.49 && b[1]?.date === "2026-09-16" && b[1].m1 === null && b[1].m12 === 12, b);

const JUN25 = "The State Bank of Pakistan (SBP) conducted the auction on Wednesday. Cut-off yields stood at 11.0003% (-9bps) for one month, 10.9977% (-5bps) for 3 months, 10.8974% (-7bps) for 6 months, and 10.9274% (-2bps) for 12 months. In the previous auction, held on June 11, 2025, sold MTBs worth Rs853.4bn. Cut-off yields for 1, 3, 6, and 12 months were 11.0905% (-1bps), 11.0498% (-10bps), 10.9698% (-22bps), and 10.9497% (-25bps), respectively.";
const c = parseAuction(JUN25, "2025-06-25T23:55:03Z", "https://x/53384");
check("2025 prose: this auction's yields, on the day it was published", c.length === 1 && c[0].date === "2025-06-25" && c[0].m1 === 11.0003 && c[0].m12 === 10.9274, c);
const d = parseAuction("Cut-off yields for 1, 3, 6, and 12 months were 11.0905% (-1bps), 11.0498% (-10bps), 10.9698% (-22bps), and 10.9497% (-25bps), respectively.", "2025-06-11T20:00:00Z", "x");
check("2025 prose listed in order", d[0]?.m1 === 11.0905 && d[0].m6 === 10.9698 && d[0].m12 === 10.9497, d[0]);
check("no yields, no auction", parseAuction("SBP targets to raise Rs5.75tr through T-bills in Oct-Dec", "2026-10-10T10:00:00Z", "x").length === 0);
check("a yield out of any sane range is left out", parseAuction("and 112.5% (-2bps) for 12 months", "2026-01-01T00:00:00Z", "x").length === 0);

check("auction reports, not calendars or bond-only auctions", isAuctionLink("SBP-raises-Rs880bn-through-MTB-auction-63870") && isAuctionLink("Auction-Result-Govt-raises-Rs3447bn-through-Tbills-53384") && isAuctionLink("SBP-raises-around-Rs778bn-through-MTBs-PIBFRB-Auction-56943") && !isAuctionLink("SBP-targets-to-raise-Rs575tr-through-Tbills-PIBs-in-OctDec-2026-64128") && !isAuctionLink("SBP-raises-Rs377bn-through-PIB-auction-3year-bonds-lead-64045") && !isAuctionLink("Govt-raises-Rs753bn-in-Hybrid-Sukuk-auction-64057"));
check("page text: tags, scripts and spaces gone", htmlText("<p>12-Month&nbsp;<b>11.4880%</b></p><script>x()</script>") === "12-Month 11.4880%");

const kept: Auction[] = [{ date: "2026-06-23", m1: null, m3: null, m6: null, m12: 11.8381, source: "seed", own: true }];
const merged = mergeAuctions(kept, [...a, ...b]);
check("one auction a day, its own report winning over a later comparison", merged.map((x) => x.date).join() === "2026-06-23,2026-07-08,2026-09-16,2026-09-30" && merged[0].source === "seed");
check("the last auction before 1 July", auctionOn(merged, "2026-07-01")?.date === "2026-06-23" && auctionOn(merged, "2026-10-14")?.date === "2026-09-30");
check("none when the last one is weeks before", auctionOn(merged, "2026-12-31") === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
