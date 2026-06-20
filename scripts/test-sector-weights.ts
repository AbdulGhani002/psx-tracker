import { aggregateSectorWeights, compareSectors, sectorKey } from "../lib/calculations/sector-weights";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

// --- aggregation ---
const w = aggregateSectorWeights([
  { symbol: "A", sector: "Commercial Banks", marketCap: 600 },
  { symbol: "B", sector: "COMMERCIAL BANKS", marketCap: 200 }, // same bucket, different case
  { symbol: "C", sector: "Cement", marketCap: 200 },
  { symbol: "D", sector: "Cement", marketCap: 0 }, // dropped (no cap)
]);
ok("two sectors after case-merge", w.length === 2, `${w.length}`);
const banks = w.find((s) => sectorKey(s.sector) === "COMMERCIAL BANKS")!;
ok("banks = 80%", Math.abs(banks.weightPct - 80) < 1e-9, `${banks.weightPct}`);
ok("banks count = 2", banks.members === 2, `${banks.members}`);
ok("sorted desc (banks first)", w[0].sector.toLowerCase().includes("bank"), w[0].sector);
ok("weights sum to 100", Math.abs(w.reduce((s, x) => s + x.weightPct, 0) - 100) < 1e-9);

// empty / all-zero -> no rows, no divide-by-zero
ok("empty input -> []", aggregateSectorWeights([]).length === 0);
ok("all-zero caps -> []", aggregateSectorWeights([{ symbol: "X", sector: "Y", marketCap: 0 }]).length === 0);

// --- comparison ---
const cmp = compareSectors(
  [
    { sector: "Commercial Banks", value: 5000 }, // 50% of your 10,000
    { sector: "Cement", value: 5000 }, // 50%
  ],
  [
    { sector: "COMMERCIAL BANKS", weightPct: 30 },
    { sector: "Oil & Gas Exploration", weightPct: 25 },
    { sector: "Cement", weightPct: 10 },
  ]
);
const cBanks = cmp.find((c) => sectorKey(c.sector) === "COMMERCIAL BANKS")!;
ok("your banks 50% vs index 30% -> +20", Math.abs(cBanks.yourPct - 50) < 1e-9 && Math.abs(cBanks.diffPct - 20) < 1e-9, `${cBanks.diffPct}`);
const cOil = cmp.find((c) => c.sector.toLowerCase().includes("oil"))!;
ok("index-only sector appears with yourPct 0", cOil && cOil.yourPct === 0 && Math.abs(cOil.diffPct + 25) < 1e-9, `${cOil?.diffPct}`);
ok("sorted by |diff| (biggest tilt first)", Math.abs(cmp[0].diffPct) >= Math.abs(cmp[cmp.length - 1].diffPct));
ok("cement 50% vs 10% -> +40 is top tilt", Math.abs(cmp[0].diffPct - 40) < 1e-9, `${cmp[0].sector} ${cmp[0].diffPct}`);

// no holdings -> every index sector shows as 0 − indexPct
const none = compareSectors([], [{ sector: "Cement", weightPct: 10 }]);
ok("no holdings -> diff = −indexPct", none.length === 1 && Math.abs(none[0].diffPct + 10) < 1e-9, `${none[0]?.diffPct}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
