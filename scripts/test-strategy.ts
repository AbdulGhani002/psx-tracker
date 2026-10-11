// The downturn playbook (lib/strategy/plan): phase, valuation against
// T-bills, the allocation rule, the tranches, where cash waits, quality.
//
//   npx tsx scripts/test-strategy.ts

import { strategyPlan, phaseOf, type StrategyInput, type Rates } from "../lib/strategy/plan";
import { kseStepMessage, maturityMessage, researchMessage } from "../lib/strategy/alerts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-6) => a != null && Math.abs(a - b) < tol;

check("phases by the fall from the 52-week high", ["calm", "pullback", "correction", "mandi", "crash"].join() === [0, -7, -15, -22, -35].map((d) => phaseOf(d)).join());

const rates: Rates = { month: "2026-10", policyPct: 11, tbill3mPct: 10.9, tbill6mPct: 10.8, tbill12mPct: 11, sukukPct: 11.4, savingsPct: 9.5, moneyMarketPct: 10.4, inflationPct: 5, taxPct: 15 };
const base: StrategyInput = {
  today: "2026-10-11",
  profile: { risk: "balanced", horizon: "long" },
  kse: { level: 156_000, high: 200_000, highDate: "2026-06-30", ma200: 170_000 },
  market: { pe: 8.4, cape: 7.4, dividendYieldPct: 6 },
  rates,
  prevRates: { ...rates, month: "2026-09", policyPct: 11.5 },
  book: { stocks: 550_000, equityFunds: 0, cashLike: 300_000, fixedIncome: 150_000 },
  names: [
    { symbol: "MEBL", held: true, value: 400_000, grade: "A", quadrant: "premium", roeSpreadPp: 14, dividendYieldPct: 3.9 },
    { symbol: "PTL", held: true, value: 150_000, grade: "C", quadrant: "trap", roeSpreadPp: -3, dividendYieldPct: 8.2 },
    { symbol: "MARI", held: false, value: 0, grade: "B", quadrant: "compounder", roeSpreadPp: 13, dividendYieldPct: 12.5 },
    { symbol: "INDU", held: false, value: 0, grade: "A", quadrant: "compounder", roeSpreadPp: 12, dividendYieldPct: 9 },
    { symbol: "WEAK", held: false, value: 0, grade: "D", quadrant: "danger", roeSpreadPp: -9, dividendYieldPct: 14 },
  ],
};
const p = strategyPlan(base);
check("22% below the high is a mandi, under the 200-day", p.phase.key === "mandi" && near(p.phase.drawdownPct, -22) && p.phase.belowMa200 === true);
check("earnings yield over the T-bill: 11.9% against 11%, fair", near(p.valuation.earningsYieldPct, 100 / 8.4) && p.valuation.verdict === "fair" && near(p.valuation.realTbillPct, 6), p.valuation.premiumPp?.toFixed(2));
check("balanced, long: 60% in stocks, 5 more in a mandi", p.allocation.stocksTargetPct === 65 && near(p.allocation.stocksNowPct, 55));
check("the room to buy is the gap to the target on the whole", near(p.allocation.room, 0.1 * 1_000_000, 1e-3), p.allocation.room);
check("four quarters at 5, 10, 20, 30% below the high; three are due at 22% down", p.tranches.map((t) => t.due).join() === "true,true,true,false" && p.tranches[3].kseLevel === 140_000 && near(p.tranches[0].amount, 25_000, 1e-6));
check("rates fell, so the dry powder kept is locked longer (12-month T-bill)", p.parking.options.some((o) => o.key === "tbill12m" && o.best) && p.rateTrend.changePp === -0.5);
check("the next steps' money waits where it can be had in days: the better of the money market fund and savings", p.parking.options.some((o) => o.key === "mmf" && o.best) && !p.parking.options.some((o) => o.key === "tbill3m" && o.best) && near(p.parking.liquid, 25_000, 1e-6));
check("and the step splits the dry powder there is: the next steps' money liquid, the rest locked", p.steps.includes("Park: Rs 25,000 in a money market fund (8.8%), Rs 425,000 in 12-month T-bills (9.4%), after tax"), p.steps.find((s) => s.startsWith("Park")));
const allIn = strategyPlan({ ...base, book: { stocks: 2_000_000, equityFunds: 0, cashLike: 0, fixedIncome: 0 } });
check("with no dry powder at all, only where new cash should go", allIn.steps.includes("New cash: 12-month T-bills (9.4% after tax)") && !allIn.steps.some((s) => s.startsWith("Park")), allIn.steps.join(" | "));
check("quality to buy: A and B compounders, the stronger first", p.quality.add.map((n) => n.symbol).join() === "MARI,INDU");
const withMos = strategyPlan({ ...base, names: [...base.names, { symbol: "HINOON", held: true, value: 200_000, grade: "A", quadrant: "premium", roeSpreadPp: 17, dividendYieldPct: 5.4, marginOfSafetyPct: 25 }, { symbol: "LOWMOS", held: true, value: 50_000, grade: "B", quadrant: "premium", roeSpreadPp: 2, dividendYieldPct: 3, marginOfSafetyPct: 10 }] });
check("a held A or B name 20% or more below fair value is quality to add to; 10% below is not", withMos.quality.add.map((n) => n.symbol).join() === "HINOON,MARI,INDU", withMos.quality.add.map((n) => n.symbol).join());
check("to reconsider: a holding in the trap quadrant", p.quality.reconsider.map((n) => n.symbol).join() === "PTL");
check("dividends above the T-bill rate, from names that earn their keep (not the D grade's 14%)", p.quality.income.map((n) => n.symbol).join() === "MARI" && !p.quality.income.some((n) => n.symbol === "WEAK"));
check("the steps say what is due now and what is next", p.steps.includes("Due now: Rs 75,000") && p.steps.includes("Next: Rs 25,000 at KSE-100 140,000"), p.steps.join(" | "));

const cheap = strategyPlan({ ...base, market: { pe: 6, cape: 5, dividendYieldPct: 8 } });
check("a P/E of 6 against 11% T-bills is cheap: 10 more in stocks", cheap.valuation.verdict === "cheap" && cheap.allocation.stocksTargetPct === 75);
const dear = strategyPlan({ ...base, market: { pe: 12, cape: 11, dividendYieldPct: 4 }, kse: { ...base.kse!, level: 199_000 } });
check("a P/E of 12 near the high is dear: 10 less, nothing to buy, new money to dry powder", dear.valuation.verdict === "dear" && dear.phase.key === "calm" && dear.allocation.stocksTargetPct === 50 && dear.allocation.room === 0 && dear.steps.some((s) => s.includes("no buying")));
const defensiveShort = strategyPlan({ ...base, profile: { risk: "defensive", horizon: "short" }, kse: { ...base.kse!, level: 199_000 } });
check("defensive and short never goes below 20% in stocks", defensiveShort.allocation.stocksTargetPct === 20);
const rising = strategyPlan({ ...base, prevRates: { ...rates, policyPct: 10 } });
check("rates rose: keep it short", rising.parking.options.some((o) => o.key === "tbill3m" && o.best) && !rising.parking.options.some((o) => o.key === "tbill12m" && o.best));
const noRates = strategyPlan({ ...base, rates: null, prevRates: null });
check("without rates: no verdict, no parking, the steps say to enter them", noRates.valuation.verdict === null && noRates.parking.options.length === 0 && noRates.steps.some((s) => s.includes("Enter this month's rates")));

// The Telegram messages (lib/strategy/alerts).
const p0 = strategyPlan(base);
const m3 = kseStepMessage(p0, { level: 156_000, high: 200_000 }, [3]);
check("zone message: the level, the fall, the zone and why", m3.includes("KSE-100 156,000</b>, 22% below its high: in buy zone 3 of 4, 160,000 (20% under the high)."), m3.split("\n")[0]);
check("zone message: that zone's money, the buy list, the next zone", m3.includes(`Plan: invest Rs ${Math.round(p0.tranches[2].amount).toLocaleString("en-US")}.`) && m3.includes("Buy list: ") && m3.includes("Next zone: 140,000"), m3);
const m23 = kseStepMessage(p0, { level: 156_000, high: 200_000 }, [2, 3]);
check("two zones at once: both named, both zones' money", m23.includes("in buy zones 2 to 3 of 4") && m23.includes(`invest Rs ${Math.round(p0.tranches[1].amount + p0.tranches[2].amount).toLocaleString("en-US")}`));
const full = strategyPlan({ ...base, book: { stocks: 1_000_000, equityFunds: 0, cashLike: 0, fixedIncome: 0 } });
const m4 = kseStepMessage(full, { level: 139_000, high: 200_000 }, [4]);
check("above target: says no buying, with the split; no next zone after the last", m4.includes("Plan: no buying. Stocks 100%, target ") && !m4.includes("Next zone"), m4);
const mat = maturityMessage({ name: "12M T-bill", face: 1_000_000, maturityDate: "2026-10-18", daysLeft: 7 }, rates, true);
check("maturity: when, what comes back, the rates to buy again at", mat.includes("<b>12M T-bill</b> matures in 7 days (18 Oct): Rs 1,000,000 back.") && mat.includes("Rates: T-bill 3M 10.90%, 6M 10.80%, 12M 11.00%; sukuk 11.40%"), mat);
const tomorrow = maturityMessage({ name: "Sukuk <A&B>", face: 500_000, maturityDate: "2026-10-12", daysLeft: 1 }, rates, false);
check("maturity tomorrow; rates flagged when not this month's; the name escaped", tomorrow.includes("Sukuk &lt;A&amp;B&gt;</b> matures tomorrow") && tomorrow.includes("Rates (not this month's): "), tomorrow);
check("maturity without rates: no rates line", !maturityMessage({ name: "3M T-bill", face: 100_000, maturityDate: "2026-10-15", daysLeft: 4 }, null, false).includes("Rates"));

const bahl = { symbol: "BAHL", price: 164.5, pctile: 0.83, pe: 5.9, fairPe: 6.4, zone: { buyLow: 160, buyHigh: 165 } };
check("a share at its buy price: the zone, the model's score and its P/E against its usual", researchMessage(bahl, "buy") === "🟢 <b>BAHL</b> Rs 165: buy, zone 160–165 (model 9/10, P/E 5.9, usual 6.4).", researchMessage(bahl, "buy"));
check("with its expected edge", researchMessage({ ...bahl, edge: 0.0183 }, "buy") === "🟢 <b>BAHL</b> Rs 165: buy, zone 160–165 (model 9/10, +1.8% in 3m vs market, P/E 5.9, usual 6.4).", researchMessage({ ...bahl, edge: 0.0183 }, "buy"));
check("a held share to sell or take profit; a price under 100 keeps its paisa", researchMessage({ ...bahl, symbol: "PTL", price: 61.2, pctile: 0.12, fairPe: null }, "sell") === "🔴 <b>PTL</b> Rs 61.20: sell (model 2/10, P/E 5.9)." && researchMessage({ ...bahl, pctile: null, pe: null }, "take-profit") === "🟠 <b>BAHL</b> Rs 165: take profit.");
check("the zone alert names the research's buy list when given", kseStepMessage(p0, { level: 156_000, high: 200_000 }, [3], ["BAHL", "FCCL"]).includes("Buy list: BAHL, FCCL"));

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
