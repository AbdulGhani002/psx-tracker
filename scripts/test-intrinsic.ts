import { computeIntrinsic, compositeIntrinsic, requiredMarginOfSafety, intrinsicSensitivity, normalizedEps, robustGrowthPct, pkFairPE, type IntrinsicInputs } from "../lib/calculations/intrinsic";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };
const near = (a: number | null, b: number, tol = 0.5) => a != null && Math.abs(a - b) < tol;

const base: IntrinsicInputs = {
  symbol: "TEST",
  price: 100,
  eps: 10,
  epsGrowthPct: 8,
  bvps: 50,
  forwardDps: 5,
  dividendGrowthPct: 5,
  sbpRatePct: 11,
  equityRiskPremiumPct: 6, // required return 17
  fairPE: 8,
  aboveEarnings: false,
  annualVolPct: 30,
  navPerShare: null,
};

const c = compositeIntrinsic(base);
const m = (k: string) => c.methods.find((x) => x.key === k)?.value ?? null;
ok("Graham number (local) ≈ 69.28", near(m("graham"), 69.28), `${m("graham")?.toFixed(2)}`); // √(8×1.2 × 10 × 50), local fair P/E not US 22.5
ok("Justified P/E value ≈ 60", near(m("justifiedPE"), 60), `${m("justifiedPE")?.toFixed(2)}`); // payout 0.5 × 1.08 / (0.17−0.08) = 6.0× × EPS 10
ok("DDM ≈ 43.75", near(m("ddm"), 43.75), `${m("ddm")?.toFixed(2)}`);
ok("EPV ≈ 58.82", near(m("epv"), 58.82), `${m("epv")?.toFixed(2)}`);
ok("DCF ≈ 93.2", near(m("dcf"), 93.2, 1.0), `${m("dcf")?.toFixed(2)}`);
ok("Earnings × fair P/E = 80", m("earnings") === 80, `${m("earnings")}`);
ok("intrinsic sits inside [low, high]", c.intrinsic != null && c.low != null && c.high != null && c.intrinsic >= c.low && c.intrinsic <= c.high, `${c.low?.toFixed(1)}..${c.intrinsic?.toFixed(1)}..${c.high?.toFixed(1)}`);

const r = computeIntrinsic(base);
ok("required MoS = 12% (vol 30 baseline)", r.requiredMosPct === 12, `${r.requiredMosPct}`);
ok("buy line = intrinsic × (1 − MoS)", r.buyBelow != null && r.intrinsic != null && near(r.buyBelow, r.intrinsic * 0.88, 0.01), `${r.buyBelow?.toFixed(2)}`);
ok("strong-buy line is 10pp below buy line", r.strongBuyBelow != null && r.buyBelow != null && r.strongBuyBelow < r.buyBelow);
ok("price 100 >> intrinsic ~74 → expensive", r.zone === "expensive", r.zone);
ok("negative margin of safety when overpriced", r.marginOfSafetyPct != null && r.marginOfSafetyPct < 0, `${r.marginOfSafetyPct?.toFixed(1)}`);
ok("drivers explain the required return", r.drivers.some((d) => d.includes("Required return")));

// A cheap price lands in a buy zone.
const cheap = computeIntrinsic({ ...base, price: 40 });
ok("price 40 → strong buy", cheap.zone === "strong buy", cheap.zone);
ok("positive margin of safety when cheap", cheap.marginOfSafetyPct != null && cheap.marginOfSafetyPct > 0);

// Risk scaling of the margin of safety.
ok("MoS base 12% (calm blue chip)", requiredMarginOfSafety(10, false, true) === 12);
ok("MoS widens with volatility", requiredMarginOfSafety(45, false, true) === 18); // 12 + (45−30)×0.4
ok("MoS +4 when dividend > earnings", requiredMarginOfSafety(25, true, true) === 16);
ok("MoS capped at 35%", requiredMarginOfSafety(80, true, false) === 35);

// Holding company → NAV dominates, P/E methods become reference-only.
const holdco = computeIntrinsic({ ...base, navPerShare: 120 });
ok("holdco basis = nav", holdco.basis === "nav");
ok("holdco intrinsic = NAV 120", near(holdco.intrinsic, 120, 0.01), `${holdco.intrinsic?.toFixed(2)}`);
ok("holdco non-NAV methods carry weight 0", holdco.methods.filter((x) => x.key !== "nav").every((x) => x.weight === 0));

// Sensitivity: a higher discount rate lowers value; faster growth raises it.
// (In production the fair P/E is always pkFairPE(growth, rate), so use that here
// too — otherwise base and the growth ± rows would use mismatched multiples.)
const sens = intrinsicSensitivity({ ...base, fairPE: pkFairPE(base.epsGrowthPct ?? 0, base.sbpRatePct) });
const rr = sens.find((s) => s.label.startsWith("Required return"))!;
ok("higher required return → lower value", rr.low < rr.base, `${rr.low.toFixed(1)} < ${rr.base.toFixed(1)}`);
ok("lower required return → higher value", rr.high > rr.base, `${rr.high.toFixed(1)} > ${rr.base.toFixed(1)}`);
const gr = sens.find((s) => s.label.startsWith("Growth"))!;
ok("faster growth → higher value", gr.high > gr.base && gr.low < gr.base);

// No EPS and no NAV → no earnings methods; only dividend model can fire.
const noEps = computeIntrinsic({ ...base, eps: null, bvps: 0 });
ok("no EPS → earnings methods all N/A", ["graham", "epv", "dcf", "justifiedPE", "earnings"].every((k) => (noEps.methods.find((x) => x.key === k)?.value ?? null) === null));
ok("no EPS → DDM still values it", (noEps.methods.find((x) => x.key === "ddm")?.value ?? null) != null);

// Normalisation helpers (take EPS in ascending year order).
ok("normalizedEps = 3-yr avg", near(normalizedEps([47.18, 56.62, 49.54]), 51.11, 0.1), `${normalizedEps([47.18, 56.62, 49.54])?.toFixed(2)}`);
ok("normalizedEps ignores non-positive", normalizedEps([-5, 0, 30, 40]) === 35);
ok("normalizedEps null when no positive years", normalizedEps([-1, 0]) === null);
ok("robustGrowth = 2-yr CAGR ≈ 10%", near(robustGrowthPct([100, 110, 121]), 10, 0.1), `${robustGrowthPct([100, 110, 121]).toFixed(2)}`);
ok("robustGrowth needs 2+ years", robustGrowthPct([100]) === 0);
ok("robustGrowth clamps a crash to −10%", robustGrowthPct([100, 50]) === -10);
ok("robustGrowth clamps a spike to +25%", robustGrowthPct([100, 400]) === 25);

// Outlier rejection: a broken dividend model (tiny DDM) must NOT drag the blend.
const outlier = computeIntrinsic({ ...base, eps: 50, normalizedEps: 50, bvps: 0, forwardDps: 2, epsGrowthPct: 8, dividendGrowthPct: 8 });
const ddm = outlier.methods.find((m) => m.key === "ddm")!;
ok("broken DDM is computed but tiny", ddm.value != null && ddm.value < 40, `${ddm.value?.toFixed(1)}`);
ok("broken DDM is excluded as an outlier", ddm.included === false);
ok("the agreeing methods stay included", outlier.methods.filter((m) => ["dcf", "epv", "earnings"].includes(m.key)).every((m) => m.included));
ok("intrinsic isn't dragged down by the outlier (>300)", outlier.intrinsic != null && outlier.intrinsic > 300, `${outlier.intrinsic?.toFixed(0)}`);
ok("drivers name the excluded method", outlier.drivers.some((d) => /outlier/i.test(d)));

// Normalised EPS smooths a freak year (MEBL-like: a peak then a dip).
const lumpy = computeIntrinsic({ ...base, eps: 49.5, normalizedEps: 51.1, epsGrowthPct: 7, dividendGrowthPct: 7, bvps: 0, forwardDps: 28 });
ok("lumpy earner gets a sane intrinsic (not collapsed)", lumpy.intrinsic != null && lumpy.intrinsic > 200, `${lumpy.intrinsic?.toFixed(0)}`);

// Pakistan tuning: the Graham number tracks the LOCAL fair P/E (not a fixed US
// 22.5), and the justified P/E (and the whole value) falls as the SBP rate rises.
const gLow = compositeIntrinsic({ ...base, fairPE: 6 }).methods.find((m) => m.key === "graham")!.value!;
const gHigh = compositeIntrinsic({ ...base, fairPE: 11 }).methods.find((m) => m.key === "graham")!.value!;
ok("Graham number scales with the local fair P/E", gHigh > gLow, `${gLow.toFixed(0)} < ${gHigh.toFixed(0)}`);
const jpLowRate = compositeIntrinsic({ ...base, sbpRatePct: 7 }).methods.find((m) => m.key === "justifiedPE")!.value!;
const jpHighRate = compositeIntrinsic({ ...base, sbpRatePct: 18 }).methods.find((m) => m.key === "justifiedPE")!.value!;
ok("justified P/E falls as the SBP rate rises", jpHighRate < jpLowRate, `${jpHighRate.toFixed(0)} < ${jpLowRate.toFixed(0)}`);
const ivLowRate = computeIntrinsic({ ...base, sbpRatePct: 7 }).intrinsic!;
const ivHighRate = computeIntrinsic({ ...base, sbpRatePct: 18 }).intrinsic!;
ok("intrinsic value is lower in a high-rate world", ivHighRate < ivLowRate, `${ivHighRate.toFixed(0)} < ${ivLowRate.toFixed(0)}`);

// PK fair P/E: realistic blue-chip band, rises with growth, compresses at high rates.
ok("pkFairPE baseline ~8 at 11% rate, 0 growth", near(pkFairPE(0, 11), 8, 0.01), `${pkFairPE(0, 11).toFixed(2)}`);
ok("pkFairPE rises with growth", pkFairPE(15, 11) > pkFairPE(0, 11));
ok("pkFairPE compresses at high rates", pkFairPE(0, 20) < pkFairPE(0, 11));
ok("pkFairPE lifts when the SBP cuts", pkFairPE(0, 7) > pkFairPE(0, 11));
ok("pkFairPE stays in the realistic 4.5–12 band", pkFairPE(40, 5) <= 12 && pkFairPE(-20, 25) >= 4.5, `${pkFairPE(40,5).toFixed(1)} / ${pkFairPE(-20,25).toFixed(1)}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
