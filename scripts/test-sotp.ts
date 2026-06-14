import { computeSotp, deriveSharesOutstanding } from "../lib/calculations/sotp";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

const r = computeSotp({
  constituents: [
    { label: "A", symbol: "AAA", shares: 1000 },
    { label: "B", symbol: "BBB", shares: 2000 },
    { label: "C", symbol: "CCC", shares: 500 }, // no price -> excluded
  ],
  prices: { AAA: 50, BBB: 10 },
  unlistedValuePkr: 5000,
  netDebtPkr: 10000,
  sharesOutstanding: 10000,
  marketPrice: 5,
  heldShares: 100,
});

ok("listed value = 70,000", Math.abs(r.listedValue - 70000) < 1e-6, `${r.listedValue}`);
ok("NAV total = 65,000 (70k + 5k unlisted − 10k debt)", Math.abs(r.navTotal - 65000) < 1e-6, `${r.navTotal}`);
ok("NAV/share = 6.5", Math.abs(r.navPerShare - 6.5) < 1e-9, `${r.navPerShare}`);
ok("discount ≈ 23%", r.discountPct != null && Math.abs(r.discountPct - 23.0769) < 0.01, `${r.discountPct?.toFixed(2)}`);
ok("your market value = 500", Math.abs(r.yourMarketValue - 500) < 1e-6, `${r.yourMarketValue}`);
ok("your look-through value = 650", Math.abs(r.yourLookThroughValue - 650) < 1e-6, `${r.yourLookThroughValue}`);
ok("CCC flagged missing price", r.missingPrices.includes("CCC"), r.missingPrices.join(","));
ok("largest constituent first (AAA)", r.constituents[0].symbol === "AAA", r.constituents[0].symbol);

// premium case
const p = computeSotp({ constituents: [{ label: "A", symbol: "AAA", shares: 100 }], prices: { AAA: 10 }, unlistedValuePkr: 0, netDebtPkr: 0, sharesOutstanding: 1000, marketPrice: 2, heldShares: 0 });
ok("premium: NAV/share 1, price 2 -> discount −100%", p.discountPct != null && Math.abs(p.discountPct - -100) < 0.01, `${p.discountPct?.toFixed(1)}`);

ok("derive shares from profit/EPS (AHCL)", Math.abs(deriveSharesOutstanding(23775344, 5.64) - 4_215_486_524) < 1e6, `${deriveSharesOutstanding(23775344, 5.64).toFixed(0)}`);
ok("derive shares: EPS 0 -> 0", deriveSharesOutstanding(1000, 0) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
