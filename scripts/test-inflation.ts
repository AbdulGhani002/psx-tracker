// PBS CPI feed tests.
// Fixture values are the REAL published PBS index (base 2015/2016).
// Run: npx tsx scripts/test-inflation.ts     (LIVE=1 also hits pbs.gov.pk)

import { parseCpiSdmx, shiftMonths, realReturnPct, fetchInflation, extendCpi } from "../lib/feeds/inflation";

let pass = 0;
let fail = 0;
function near(label: string, got: number | null, want: number | null, tol = 0.01) {
  const ok = got === null || want === null ? got === want : Math.abs(got - want) <= tol;
  ok ? (pass++, console.log(`  ok   ${label} = ${got === null ? "null" : got.toFixed(4)}`))
     : (fail++, console.log(`  FAIL ${label}: got ${got}, want ${want}`));
}
function is(label: string, got: unknown, want: unknown) {
  got === want ? (pass++, console.log(`  ok   ${label} = ${JSON.stringify(got)}`))
               : (fail++, console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
}

// Real PBS shape: the headline series plus a decoy sub-index that must NOT win.
const XML = `<?xml version='1.0' encoding='UTF-8'?>
<message:StructureSpecificData xmlns:message="x" xmlns:ss="y">
<ss:Series DATA_DOMAIN="CPI" REF_AREA="PK" INDICATOR="PCPI_CP_01_IX" FREQ="M" BASE_PER="2015/2016">
  <ss:Obs TIME_PERIOD="2025-06" OBS_VALUE="300.000"/>
  <ss:Obs TIME_PERIOD="2026-06" OBS_VALUE="450.000"/>
</ss:Series>
<ss:Series DATA_DOMAIN="CPI" REF_AREA="PK" INDICATOR="PCPI_IX" COUNTERPART_AREA="_Z" FREQ="M" BASE_PER="2015/2016" UNIT_MULT="0">
  <ss:Obs TIME_PERIOD="2025-05" OBS_VALUE="263.602"/>
  <ss:Obs TIME_PERIOD="2025-06" OBS_VALUE="264.220"/>
  <ss:Obs TIME_PERIOD="2025-07" OBS_VALUE="271.941"/>
  <ss:Obs TIME_PERIOD="2025-08" OBS_VALUE="270.350"/>
  <ss:Obs TIME_PERIOD="2025-09" OBS_VALUE="276.010"/>
  <ss:Obs TIME_PERIOD="2025-10" OBS_VALUE="280.660"/>
  <ss:Obs TIME_PERIOD="2025-11" OBS_VALUE="281.780"/>
  <ss:Obs TIME_PERIOD="2025-12" OBS_VALUE="280.530"/>
  <ss:Obs TIME_PERIOD="2026-01" OBS_VALUE="281.618"/>
  <ss:Obs TIME_PERIOD="2026-02" OBS_VALUE="282.386"/>
  <ss:Obs TIME_PERIOD="2026-03" OBS_VALUE="285.728"/>
  <ss:Obs TIME_PERIOD="2026-04" OBS_VALUE="292.806"/>
  <ss:Obs TIME_PERIOD="2026-05" OBS_VALUE="294.342"/>
  <ss:Obs TIME_PERIOD="2026-06" OBS_VALUE="293.472"/>
</ss:Series>
</message:StructureSpecificData>`;

console.log("parse: real PBS index (base 2015/2016)");
const r = parseCpiSdmx(XML);
is("latest period", r.latest?.period, "2026-06");
near("latest index", r.latest?.index ?? null, 293.472);
is("base period", r.basePeriod, "2015/2016");

console.log("\nYoY is COMPUTED from the index, not read off a page");
// (293.472 / 264.220 - 1) * 100
near("headline YoY", r.yoyPct, 11.0710, 0.001);
is("compares the SAME month a year earlier", r.yearAgo?.period, "2025-06");
near("year-ago index", r.yearAgo?.index ?? null, 264.220);

console.log("\nthe headline series must win over sub-indices");
// The decoy PCPI_CP_01_IX would imply 50% — picking it would be catastrophic.
is("did not pick the food sub-index", r.yoyPct !== 50, true);

console.log("\nmonth arithmetic (YoY must compare like months — CPI is seasonal)");
is("2026-06 -12m", shiftMonths("2026-06", -12), "2025-06");
is("2026-01 -12m", shiftMonths("2026-01", -12), "2025-01");
is("2026-01 -1m crosses the year", shiftMonths("2026-01", -1), "2025-12");
is("2025-12 +1m crosses the year", shiftMonths("2025-12", 1), "2026-01");
is("junk period", shiftMonths("nope", -12), "");

console.log("\nrefuses junk rather than inventing a rate");
is("no series", parseCpiSdmx("<x/>").yoyPct, null);
is("too few points", parseCpiSdmx(`<ss:Series INDICATOR="PCPI_IX"><ss:Obs TIME_PERIOD="2026-06" OBS_VALUE="100"/></ss:Series>`).yoyPct, null);
// An absurd index jump means we grabbed the wrong series → refuse.
const absurd = `<ss:Series INDICATOR="PCPI_IX" BASE_PER="b">
  <ss:Obs TIME_PERIOD="2025-06" OBS_VALUE="1"/>${Array.from({length:11},(_,i)=>`<ss:Obs TIME_PERIOD="2025-${String(i+7).padStart(2,"0")}" OBS_VALUE="1"/>`).join("")}
  <ss:Obs TIME_PERIOD="2026-06" OBS_VALUE="900"/></ss:Series>`;
is("absurd YoY rejected", parseCpiSdmx(absurd).yoyPct, null);

console.log("\nreal return uses Fisher, not naive subtraction");
// Nominal 11.5% with inflation 11.07% is NOT 0.43% real; it's slightly less.
near("Fisher real return", realReturnPct(11.5, 11.07), 0.3872, 0.001);
near("naive would have said", 11.5 - 11.07, 0.43);
near("zero inflation → unchanged", realReturnPct(11.5, 0), 11.5);
// High inflation is where naive subtraction lies most.
near("30% nominal vs 25% inflation", realReturnPct(30, 25), 4.0, 0.001);

console.log("\nMettis CPI chart extends the kept index (PBS feed gone)");
// The server's kept PBS index to August 2026, and Mettis's chart on 27 Oct.
const kept = [["2025-07", 271.94091051384737], ["2025-08", 270.35], ["2025-09", 276.01], ["2025-10", 280.66], ["2026-03", 285.72761295053306], ["2026-04", 292.8060801511648], ["2026-05", 294.3417001804952], ["2026-06", 293.471797760731], ["2026-07", 296.97135188109877], ["2026-08", 300.49612668509224]].map(([period, index]) => ({ period: period as string, index: index as number }));
const chartRows = [{ Value: 9.2, Date: "Jul 31" }, { Value: 11.1, Date: "Aug 31" }, { Value: 10.3, Date: "Sep 30" }];
const ext = extendCpi(kept, chartRows, "2026-10-27");
is("one month added: September", ext ? ext.length - kept.length : null, 1);
near("September's index from a year before at 10.3%", ext ? ext[ext.length - 1].index : null, 276.01 * 1.103, 1e-9);
is("dated 2026-09", ext ? ext[ext.length - 1].period : null, "2026-09");
is("nothing newer: nothing added", extendCpi(ext ?? kept, chartRows, "2026-10-27"), null);
is("a month that disagrees with the kept index: refused", extendCpi(kept, [{ Value: 13.5, Date: "Aug 31" }, { Value: 10.3, Date: "Sep 30" }], "2026-10-27"), null);
is("months out of order: refused", extendCpi(kept, [{ Value: 11.1, Date: "Aug 31" }, { Value: 9.2, Date: "Jul 31" }], "2026-10-27"), null);
// Made-up figures: only the year matters here.
const january = extendCpi([{ period: "2025-12", index: 280.53 }, { period: "2026-11", index: 300 }, { period: "2025-11", index: 281.78 }], [{ Value: (300 / 281.78 - 1) * 100, Date: "Nov 30" }, { Value: 8, Date: "Dec 31" }], "2027-01-03");
is("in January, December is last year's", january ? january[january.length - 1].period : null, "2026-12");

async function main() {
  if (process.env.LIVE === "1") {
    console.log("\nlive: fetching PBS");
    const live = await fetchInflation();
    if (!live) { fail++; console.log("  FAIL live fetch returned null"); }
    else {
      is("live yoy is a number", typeof live.yoyPct, "number");
      is("live has monthly history", live.history.length >= 13, true);
      console.log(`  live: ${live.latest?.period} index ${live.latest?.index.toFixed(3)} → YoY ${live.yoyPct?.toFixed(2)}% (base ${live.basePeriod}, ${live.history.length} months)`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
