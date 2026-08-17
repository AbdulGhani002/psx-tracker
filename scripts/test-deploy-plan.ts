import { planDeployment, type DeployCandidate } from "../lib/calculations/deploy-plan";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

const base = { equityValue: 1_000_000, fundsValue: 500_000, brokerCash: 0, reservePct: 5, concentrationCap: 25 };

console.log("=== the 5% reserve is carved out first ===");
{
  const p = planDeployment({ ...base, candidates: [] });
  // Total investable 1.5m; 5% = 75,000 stays in the fund. 500k − 75k = 425k deployable.
  ok("total investable 1.5m", near(p.totalInvestable, 1_500_000), `${p.totalInvestable}`);
  ok("reserve is 75,000", near(p.reserveRequired, 75_000), `${p.reserveRequired}`);
  ok("deployable is 425,000", near(p.deployable, 425_000), `${p.deployable}`);
  ok("nothing bought with no candidates", p.rows.length === 0 && p.deployed === 0);
  ok("the fund keeps everything", near(p.keptInFunds, 500_000));
}
{
  // Reserve bigger than the cash pile: deploy nothing, and say why.
  const p = planDeployment({ equityValue: 2_000_000, fundsValue: 50_000, brokerCash: 0, reservePct: 5, concentrationCap: 25, candidates: [{ symbol: "A", price: 100, targetPct: 10, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" }] });
  ok("reserve exceeds cash -> nothing deployable", p.deployable === 0, `deployable=${p.deployable}`);
  ok("no shares bought", p.rows.length === 0);
  ok("it explains the reserve", p.warnings.some((w) => w.includes("reserve")), p.warnings[0] ?? "(none)");
}

console.log("\n=== whole shares only, and the fund is the source ===");
{
  const candidates: DeployCandidate[] = [{ symbol: "AHCL", price: 15.5, targetPct: 30, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" }];
  const p = planDeployment({ ...base, candidates });
  const row = p.rows[0];
  ok("one row", p.rows.length === 1);
  ok("shares are a whole number", Number.isInteger(row.shares), `shares=${row.shares}`);
  ok("spend = shares x price", near(row.rupees, row.shares * 15.5));
  ok("never spends more than deployable", p.deployed <= p.deployable + 1e-9, `deployed=${p.deployed} of ${p.deployable}`);
  ok("no brokerage cash was available, so it all comes from the fund", near(p.pullFromFunds, p.deployed) && p.brokerCashUsed === 0);
  ok("fund keeps the rest", near(p.keptInFunds, 500_000 - p.deployed), `kept=${p.keptInFunds}`);
  ok("reserve survives the buy", p.keptInFunds >= p.reserveRequired - 1e-6, `kept=${p.keptInFunds} reserve=${p.reserveRequired}`);
}

console.log("\n=== brokerage cash is spent before the fund is touched ===");
{
  const p = planDeployment({ equityValue: 1_000_000, fundsValue: 400_000, brokerCash: 100_000, reservePct: 5, concentrationCap: 90, candidates: [{ symbol: "A", price: 100, targetPct: 50, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" }] });
  ok("cash used first", p.brokerCashUsed === Math.min(100_000, p.deployed), `used=${p.brokerCashUsed}`);
  ok("only the shortfall is redeemed", near(p.pullFromFunds, Math.max(0, p.deployed - 100_000)), `pull=${p.pullFromFunds}`);
  ok("cash + fund pull equals the spend", near(p.brokerCashUsed + p.pullFromFunds, p.deployed));
}

console.log("\n=== sizing follows target weights, not the price tag ===");
{
  // Two names in their buy zones. A is far from target, B is close.
  const candidates: DeployCandidate[] = [
    { symbol: "FAR", price: 100, targetPct: 20, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" },
    { symbol: "NEAR", price: 100, targetPct: 20, currentValue: 250_000, zoneFactor: 1, zoneReason: "in your buy zone" },
  ];
  const p = planDeployment({ ...base, candidates, concentrationCap: 90 });
  const far = p.rows.find((r) => r.symbol === "FAR");
  const nearRow = p.rows.find((r) => r.symbol === "NEAR");
  ok("the underweight name gets the money", (far?.rupees ?? 0) > (nearRow?.rupees ?? 0), `far=${far?.rupees} near=${nearRow?.rupees}`);
  // NEAR is already at 250k against a target of 20% of (1m + 425k) = 285k.
  ok("the near-target name is topped up only to its target", (nearRow?.finalValue ?? 0) <= 285_000 + 1e-6, `final=${nearRow?.finalValue}`);
}
{
  // Nothing is bought on price alone: at target already means no buy.
  const p = planDeployment({ ...base, candidates: [{ symbol: "FULL", price: 100, targetPct: 10, currentValue: 500_000, zoneFactor: 1, zoneReason: "in your buy zone" }] });
  ok("already past target -> no buy", p.rows.length === 0, `rows=${p.rows.length}`);
  ok("and it says why", p.warnings.some((w) => w.includes("at or above the weight its price justifies")));
}

console.log("\n=== a name with no target is reported, never guessed ===");
{
  const p = planDeployment({ ...base, candidates: [{ symbol: "NEW", price: 100, targetPct: 0, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" }] });
  ok("no target -> not sized", p.rows.length === 0);
  ok("listed as unsized", p.unsized.includes("NEW"));
  ok("warning tells you to set a target", p.warnings.some((w) => w.includes("Set a target weight")));
  ok("the money stays in the fund", near(p.keptInFunds, 500_000));
}

console.log("\n=== an unpriced name never becomes a buy ===");
{
  const p = planDeployment({ ...base, candidates: [{ symbol: "STALE", price: 0, targetPct: 10, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" }], unpriced: ["STALE"] });
  ok("price 0 buys nothing", p.rows.length === 0);
  ok("carried through as unpriced", p.unpriced.includes("STALE"));
  ok("not silently counted as unsized", p.unsized.length === 0);
}

console.log("\n=== the concentration cap holds ===");
{
  const p = planDeployment({ equityValue: 1_000_000, fundsValue: 1_000_000, brokerCash: 0, reservePct: 5, concentrationCap: 25, candidates: [{ symbol: "BIG", price: 100, targetPct: 90, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" }] });
  const row = p.rows[0];
  ok("bought something", !!row, `rows=${p.rows.length}`);
  ok("final weight respects the 25% cap", (row?.finalPct ?? 0) <= 25 + 1e-6, `finalPct=${row?.finalPct}`);
  ok("no cap warning is raised", !p.warnings.some((w) => w.includes("above your 25% cap")), p.warnings.join(" | "));
}

console.log("\n=== conservation: money is neither created nor lost ===");
{
  const candidates: DeployCandidate[] = [
    { symbol: "A", price: 137.5, targetPct: 15, currentValue: 20_000, zoneFactor: 1, zoneReason: "in your buy zone" },
    { symbol: "B", price: 62.25, targetPct: 25, currentValue: 100_000, zoneFactor: 1, zoneReason: "in your buy zone" },
    { symbol: "C", price: 1939.9, targetPct: 20, currentValue: 44_617, zoneFactor: 1, zoneReason: "in your buy zone" },
  ];
  const p = planDeployment({ equityValue: 1_200_000, fundsValue: 800_000, brokerCash: 50_000, reservePct: 5, concentrationCap: 30, candidates });
  ok("deployed + undeployed = deployable", near(p.deployed + p.undeployed, p.deployable), `${p.deployed}+${p.undeployed} vs ${p.deployable}`);
  ok("sources equal the spend", near(p.brokerCashUsed + p.pullFromFunds, p.deployed));
  ok("fund kept = fund − pull", near(p.keptInFunds, 800_000 - p.pullFromFunds));
  ok("reserve is still intact afterwards", p.keptInFunds + Math.max(0, 50_000 - p.brokerCashUsed) >= p.reserveRequired - 1e-6, `kept=${p.keptInFunds} reserve=${p.reserveRequired}`);
  ok("every row is whole shares", p.rows.every((r) => Number.isInteger(r.shares) && r.shares > 0));
  ok("undeployed is smaller than the cheapest share", p.undeployed < Math.min(...candidates.map((c) => c.price)) + 1e-6 || p.rows.length === 0, `undeployed=${p.undeployed}`);
}

console.log("\n=== degenerate inputs stay sane ===");
{
  const zero = planDeployment({ equityValue: 0, fundsValue: 0, brokerCash: 0, reservePct: 5, concentrationCap: 25, candidates: [] });
  ok("all zeros -> no plan, no crash", zero.deployed === 0 && zero.deployable === 0 && zero.warnings.length === 0);
  const nan = planDeployment({ equityValue: NaN, fundsValue: NaN, brokerCash: NaN, reservePct: NaN, concentrationCap: NaN, candidates: [{ symbol: "A", price: NaN, targetPct: NaN, currentValue: NaN, zoneFactor: NaN, zoneReason: "" }] });
  ok("NaN inputs produce zeros, not NaN", Number.isFinite(nan.deployable) && Number.isFinite(nan.deployed) && nan.rows.length === 0, `deployable=${nan.deployable}`);
  const negCash = planDeployment({ equityValue: 100_000, fundsValue: 10_000, brokerCash: -5_000, reservePct: 5, concentrationCap: 25, candidates: [] });
  ok("an overdrawn brokerage balance counts as zero, not a credit", negCash.brokerCash === 0 && negCash.cashLike === 10_000);
  const noReserve = planDeployment({ ...base, reservePct: 0, candidates: [] });
  ok("0% reserve deploys the whole pile", near(noReserve.deployable, 500_000));
  const allReserve = planDeployment({ ...base, reservePct: 100, candidates: [] });
  ok("100% reserve deploys nothing", allReserve.deployable === 0);
}

console.log("\n=== zone weight decides HOW MUCH, not whether ===");
{
  // Identical names, identical targets, identical distance from target. The
  // only difference is where the price sits against the band.
  const mk = (symbol: string, zoneFactor: number): DeployCandidate =>
    ({ symbol, price: 100, targetPct: 25, currentValue: 0, zoneFactor, zoneReason: "test" });
  const p = planDeployment({ ...base, concentrationCap: 90, candidates: [mk("INZONE", 1), mk("NEAR", 0.5), mk("FAR", 0.15)] });
  const got = (s: string) => p.rows.find((r) => r.symbol === s)?.rupees ?? 0;
  ok("all three are bought — none is skipped for being out of zone", p.rows.length === 3, `rows=${p.rows.length}`);
  ok("in-zone gets the most", got("INZONE") > got("NEAR") && got("NEAR") > got("FAR"), `${got("INZONE")} > ${got("NEAR")} > ${got("FAR")}`);
  ok("roughly in the ratio of the weights", Math.abs(got("NEAR") / got("INZONE") - 0.5) < 0.05, `ratio=${(got("NEAR") / got("INZONE")).toFixed(3)}`);
  ok("the reason travels to the row", p.rows.every((r) => r.zoneReason === "test"));
}
{
  // Zero weight means do not buy — a name in its own sell band, for instance.
  const p = planDeployment({ ...base, candidates: [
    { symbol: "SELLING", price: 100, targetPct: 25, currentValue: 0, zoneFactor: 0, zoneReason: "in your sell zone — not a buy" },
    { symbol: "OK", price: 100, targetPct: 25, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" },
  ]});
  ok("a zero-weight name is not bought", !p.rows.some((r) => r.symbol === "SELLING"));
  ok("it is reported as skipped, with the reason", p.skipped.some((x) => x.symbol === "SELLING" && x.reason.includes("sell zone")));
  ok("the other name still buys", p.rows.some((r) => r.symbol === "OK"));
  const clamped = planDeployment({ ...base, concentrationCap: 90, candidates: [{ symbol: "X", price: 100, targetPct: 25, currentValue: 0, zoneFactor: 5, zoneReason: "" }] });
  ok("a factor above 1 is clamped, never a multiplier", clamped.rows[0]?.zoneFactor === 1, `${clamped.rows[0]?.zoneFactor}`);
}

console.log("\n=== money you type in ===");
{
  const cands: DeployCandidate[] = [{ symbol: "A", price: 100, targetPct: 40, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" }];
  const withoutCash = planDeployment({ equityValue: 1_000_000, fundsValue: 0, brokerCash: 0, reservePct: 5, concentrationCap: 90, candidates: cands });
  ok("no fund, no cash, no fresh money -> nothing to deploy", withoutCash.deployable === 0 && withoutCash.rows.length === 0);
  const withFresh = planDeployment({ equityValue: 1_000_000, fundsValue: 0, brokerCash: 0, reservePct: 5, concentrationCap: 90, candidates: cands, freshCash: 50_000 });
  ok("typing in 50,000 makes it deployable", near(withFresh.deployable, 50_000), `${withFresh.deployable}`);
  ok("and it gets spent on whole shares", withFresh.rows[0]?.shares === 500, `shares=${withFresh.rows[0]?.shares}`);
  ok("fresh money is spent before the fund", withFresh.freshCashUsed === withFresh.deployed && withFresh.pullFromFunds === 0);
  // The reserve is a share of what you ALREADY hold; new money is not taxed by it.
  ok("the reserve is not charged against money you just added", near(withFresh.reserveRequired, 50_000), `reserve=${withFresh.reserveRequired}`);
}
{
  // Fresh money on top of a fund: spend the new money first, then the fund.
  const p = planDeployment({ equityValue: 1_000_000, fundsValue: 500_000, brokerCash: 0, reservePct: 5, concentrationCap: 90, freshCash: 100_000,
    candidates: [{ symbol: "A", price: 100, targetPct: 60, currentValue: 0, zoneFactor: 1, zoneReason: "in your buy zone" }] });
  ok("deployable = fund above reserve + fresh", near(p.deployable, 425_000 + 100_000), `${p.deployable}`);
  ok("fresh money is exhausted first", near(p.freshCashUsed, 100_000), `fresh used=${p.freshCashUsed}`);
  ok("every rupee is sourced", near(p.freshCashUsed + p.brokerCashUsed + p.pullFromFunds, p.deployed));
  ok("the reserve survives", p.keptInFunds >= p.reserveRequired - 1e-6, `kept=${p.keptInFunds} reserve=${p.reserveRequired}`);
  ok("negative fresh money is treated as none", planDeployment({ ...base, freshCash: -5000, candidates: [] }).freshCash === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
