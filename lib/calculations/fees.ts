// PSX retail brokerage: per share, the HIGHER of 3 paisa (Rs 0.03) or 0.20% of
// the share price. Across the trade that is max(0.20% of value, Rs 0.03/share).
// Applies to BUY, SELL, and RIGHT. Dividends, bonuses, and splits incur no fee.
// User can always override the computed value.

export const PSX_BROKERAGE_RATE = 0.002; // 0.20%
export const PSX_PER_SHARE_MIN = 0.03;   // Rs 0.03 (3 paisa) per share

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
}: {
  shares: number;
  price: number;
  type: "BUY" | "SELL" | "DIVIDEND" | "BONUS" | "RIGHT" | "SPLIT";
}): FeeBreakdown {
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
  const percentComponent = value * PSX_BROKERAGE_RATE;
  const perShareComponent = s * PSX_PER_SHARE_MIN;
  const fee = Math.max(percentComponent, perShareComponent);
  const rule: "percent" | "per-share" =
    percentComponent >= perShareComponent ? "percent" : "per-share";

  // Round to 2 dp once at the end so the form value matches what we display.
  const rounded = Math.round(fee * 100) / 100;

  const explanation =
    rule === "percent"
      ? `0.20% × Rs ${value.toFixed(2)} = Rs ${percentComponent.toFixed(2)}`
      : `Rs 0.03 × ${s.toLocaleString()} shares = Rs ${perShareComponent.toFixed(2)}`;

  return {
    fee: rounded,
    rule,
    percentComponent: Math.round(percentComponent * 100) / 100,
    perShareComponent: Math.round(perShareComponent * 100) / 100,
    explanation,
  };
}
