// PSX retail brokerage: per share, the HIGHER of 3 paisa (Rs 0.03) or the
// broker's rate on the share price (BMA: 0.15%; the old default here was
// 0.20%), plus 15% sales tax on the commission. Applies to BUY, SELL, and
// RIGHT. Dividends, bonuses, and splits incur no fee. The user can always
// override the computed value.

export const PSX_BROKERAGE_RATE = 0.0015; // 0.15%, BMA's rate
export const PSX_PER_SHARE_MIN = 0.03;   // Rs 0.03 (3 paisa) per share
export const SST_ON_COMMISSION = 0.15;

export type FeeBreakdown = {
  fee: number;
  rule: "percent" | "per-share" | "none";
  percentComponent: number;
  perShareComponent: number;
  explanation: string;
};

export function computePSXFees({
  shares,
  price,
  type,
  ratePct,
}: {
  shares: number;
  price: number;
  type: "BUY" | "SELL" | "DIVIDEND" | "BONUS" | "RIGHT" | "SPLIT";
  ratePct?: number; // the broker's commission in percent; the module default otherwise
}): FeeBreakdown {
  const rate = ratePct != null && ratePct >= 0 ? ratePct / 100 : PSX_BROKERAGE_RATE;
  const s = Math.abs(shares);
  if (s <= 0 || price <= 0 || (type !== "BUY" && type !== "SELL" && type !== "RIGHT")) {
    return {
      fee: 0,
      rule: "none",
      percentComponent: 0,
      perShareComponent: 0,
      explanation: "",
    };
  }

  const value = s * price;
  const percentComponent = value * rate;
  const perShareComponent = s * PSX_PER_SHARE_MIN;
  const commission = Math.max(percentComponent, perShareComponent);
  const sst = commission * SST_ON_COMMISSION;
  const fee = commission + sst;
  const rule: "percent" | "per-share" =
    percentComponent >= perShareComponent ? "percent" : "per-share";

  // Round to 2 dp once at the end so the form value matches what we display.
  const rounded = Math.round(fee * 100 + 1e-9) / 100;

  const explanation =
    (rule === "percent"
      ? `${(rate * 100).toFixed(2)}% × Rs ${value.toFixed(2)} = Rs ${percentComponent.toFixed(2)}`
      : `Rs 0.03 × ${s.toLocaleString()} shares = Rs ${perShareComponent.toFixed(2)}`) + ` + 15% SST Rs ${sst.toFixed(2)}`;

  return {
    fee: rounded,
    rule,
    percentComponent: Math.round(percentComponent * 100) / 100,
    perShareComponent: Math.round(perShareComponent * 100) / 100,
    explanation,
  };
}
