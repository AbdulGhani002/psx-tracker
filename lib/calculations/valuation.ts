// Valuation suite — turns the EPS / payouts / price we already have into the
// standard value metrics, plus an intrinsic "fair value" and margin of safety.
//
// What's automatic (from scraped EPS + live price + forecast dividend):
//   P/E, earnings yield, dividend yield, a dividend-discount fair value, an
//   earnings-based fair value, margin of safety.
// What needs a one-line input you maintain (PSX's free feed doesn't publish it):
//   book value per share -> unlocks P/B and ROE. Fair P/E and the required
//   return are editable assumptions.

export type ValuationInputs = {
  price: number;
  eps: number | null; // latest annual EPS
  forwardDps: number; // forward annual dividend (from the forecast)
  dividendGrowthPct: number; // expected dividend growth %
  bookValuePerShare: number; // 0 = unknown (you enter it)
  requiredReturnPct: number; // discount rate for the DDM (risk-free + equity premium)
  fairPE: number; // assumed fair P/E for the earnings-based value
};

export type Valuation = {
  pe: number | null;
  earningsYieldPct: number | null;
  dividendYieldPct: number | null;
  pb: number | null;
  roePct: number | null;
  fairValueDDM: number | null; // Gordon growth
  fairValueEarnings: number | null; // EPS × fair P/E
  fairValue: number | null; // blend of what's available
  marginOfSafetyPct: number | null; // (fair − price) / fair; positive = undervalued
  verdict: "cheap" | "fair" | "expensive" | "unknown";
};

export function computeValuation(i: ValuationInputs): Valuation {
  const price = i.price;
  const eps = i.eps;
  const bvps = i.bookValuePerShare;

  const pe = eps != null && eps > 0 && price > 0 ? price / eps : null;
  const earningsYieldPct = eps != null && price > 0 ? (eps / price) * 100 : null;
  const dividendYieldPct = price > 0 ? (i.forwardDps / price) * 100 : null;
  const pb = bvps > 0 && price > 0 ? price / bvps : null;
  const roePct = bvps > 0 && eps != null ? (eps / bvps) * 100 : null;

  // Gordon growth: V = D1 / (r − g). Only valid when the required return exceeds
  // the growth rate; otherwise the model blows up and we skip it.
  const r = i.requiredReturnPct / 100;
  const g = i.dividendGrowthPct / 100;
  const fairValueDDM = i.forwardDps > 0 && r - g > 0.005 ? (i.forwardDps * (1 + g)) / (r - g) : null;
  const fairValueEarnings = eps != null && eps > 0 && i.fairPE > 0 ? eps * i.fairPE : null;

  const fairCandidates = [fairValueDDM, fairValueEarnings].filter((x): x is number => x != null && x > 0);
  const fairValue = fairCandidates.length ? fairCandidates.reduce((s, x) => s + x, 0) / fairCandidates.length : null;

  const marginOfSafetyPct = fairValue != null && fairValue > 0 && price > 0 ? ((fairValue - price) / fairValue) * 100 : null;

  let verdict: Valuation["verdict"];
  if (marginOfSafetyPct == null) verdict = "unknown";
  else if (marginOfSafetyPct >= 20) verdict = "cheap";
  else if (marginOfSafetyPct <= -20) verdict = "expensive";
  else verdict = "fair";

  return { pe, earningsYieldPct, dividendYieldPct, pb, roePct, fairValueDDM, fairValueEarnings, fairValue, marginOfSafetyPct, verdict };
}
