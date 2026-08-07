// Parser tests for the live SBP rates feed.
//
// The fixture below is the real published block from
// https://www.sbp.org.pk/ecodata/rates/tbill/tbill.asp (16-Jul-2026), reduced to
// the data region. Run: npx tsx scripts/test-sbp.ts
// Pass LIVE=1 to additionally hit the real endpoint and assert it still parses.

import { parseSbpRates, corridorAgrees, tbill12mPct, fetchSbpRates } from "../lib/feeds/sbp";

let pass = 0;
let fail = 0;

function eq(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (ok) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    return;
  }
  console.log(`  ok   ${label} = ${JSON.stringify(got)}`);
}

// Real SBP output, tags already stripped by their page structure. We wrap it in a
// tag so the parser's tag-stripper runs over it exactly as it would in production.
const FIXTURE = `<html><body>
SBP Policy Rate &amp; Interest Rate Corridor Facilities
SBP Policy Rate 11.50% p.a.
SBP Overnight Reverse (Repo) Ceiling Rate 12.50% p.a.
SBP Overnight Reverse (Floor) Rate 10.50% p.a.
Liquid Foreign Exchange Reserves (USD million) As on 03- July - 2026
SBP's Reserves 18,471.0 Bank's Reserves 5,517.7 Total Reserves 23,988.7
Money Market Interest Rates Weighted - average overnight repo rate As on 15-Jul-26 11.33% p.a.
KIBOR As on 16- Jul - 26 Tenor BID Offer 3-M 11.37 11.62 6-M 11.39 11.64 12-M 11.4 11.9
Upcoming Auction PIB Auction (Fixed Rate) 04-Aug-26 MTB 13-May-26
USD/ PKR Rates As on 16- Jul - 2026 M2M Revaluation Rate 277.9732
Weighted Average Rate BID 277.6816 Offer 278.1067
Cut-off Rates in the Latest Auctions
MTBs Tenor Cut-off Yield 1-M 11.3968% 3-M 11.3978% 6-M 11.4375% 12-M 11.4880%
Fixed - Rate PIB Tenor Cut-off Yield 2-Y 11.4450% 3-Y 11.4900% 5-Y 11.6260% 10-Y 12.1400% 15-Y 12.2850%
Floating - Rate PIBs (Quarterly Coupon) Tenor Cut-off Yield 2-Y Bids Rejected 3-Y Bids Rejected
</body></html>`;

console.log("parse: real SBP fixture");
const r = parseSbpRates(FIXTURE);

// The whole point of this feed: the policy rate must be the POLICY rate (11.50),
// never the corridor floor (10.50) — that exact confusion was the live bug.
eq("policyRatePct", r.policyRatePct, 11.5);
eq("repoCeilingPct", r.repoCeilingPct, 12.5);
eq("repoFloorPct", r.repoFloorPct, 10.5);
eq("policy != floor", r.policyRatePct !== r.repoFloorPct, true);
eq("overnightRepoPct", r.overnightRepoPct, 11.33);
eq("usdPkrM2M", r.usdPkrM2M, 277.9732);
eq("corridorAgrees", corridorAgrees(r), true);

console.log("kibor");
eq("kibor count", r.kibor.length, 3);
eq("kibor 3M bid", r.kibor[0]?.bid, 11.37);
eq("kibor 12M offer", r.kibor[2]?.offer, 11.9);

console.log("cut-offs (MTB must not absorb PIB tenors)");
eq("mtb count", r.mtbCutoffs.length, 4);
eq("mtb 12M", tbill12mPct(r), 11.488);
eq("pib count", r.pibCutoffs.length, 5);
eq("pib 10Y", r.pibCutoffs.find((c) => c.tenor === "10Y")?.yieldPct, 12.14);

console.log("refuses junk rather than inventing a number");
const empty = parseSbpRates("<html><body>nothing here</body></html>");
eq("no policy rate", empty.policyRatePct, null);
eq("no usd", empty.usdPkrM2M, null);
eq("corridor disagrees", corridorAgrees(empty), false);
eq("tbill null", tbill12mPct(empty), null);
eq("tbill null on null", tbill12mPct(null), null);

// Out-of-bound values must be rejected, not passed through.
const absurd = parseSbpRates("<html>SBP Policy Rate 999.00% p.a. M2M Revaluation Rate 3.00</html>");
eq("absurd rate rejected", absurd.policyRatePct, null);
eq("absurd fx rejected", absurd.usdPkrM2M, null);

async function main() {
  if (process.env.LIVE === "1") {
    console.log("live: fetching SBP");
    const live = await fetchSbpRates();
    if (!live) {
      fail++;
      console.log("  FAIL live fetch returned null");
    } else {
      eq("live policy rate is a number", typeof live.policyRatePct, "number");
      eq("live corridor agrees", corridorAgrees(live), true);
      console.log(`  live policy=${live.policyRatePct}% tbill12m=${tbill12mPct(live)}% usdpkr=${live.usdPkrM2M}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
