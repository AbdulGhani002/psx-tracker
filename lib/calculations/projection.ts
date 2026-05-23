export type ProjectionInputs = {
  initialShares: number;
  currentPrice: number;
  peStart: number;
  peEnd: number;
  annualGrowth: number;
  payoutRatio: number;
  horizonYears: number;
  useDRIP: boolean;
};

export type ProjectionRow = {
  year: number;
  eps: number;
  pe: number;
  price: number;
  shares: number;
  dividendPerShare: number;
  dividendIncome: number;
  divsCumulative: number;
  value: number;
};

export type ProjectionResult = {
  rows: ProjectionRow[];
  startValue: number;
  endValue: number;
  totalDivs: number;
  cagrPriceOnly: number | null;
  cagrTotalReturn: number | null;
  multiple: number;
};

export function project(inputs: ProjectionInputs): ProjectionResult {
  const { initialShares, currentPrice, peStart, peEnd, annualGrowth, payoutRatio, horizonYears, useDRIP } = inputs;

  const eps0 = peStart > 0 ? currentPrice / peStart : 0;
  const startValue = initialShares * currentPrice;

  const rows: ProjectionRow[] = [
    {
      year: 0,
      eps: eps0,
      pe: peStart,
      price: currentPrice,
      shares: initialShares,
      dividendPerShare: 0,
      dividendIncome: 0,
      divsCumulative: 0,
      value: startValue,
    },
  ];

  let shares = initialShares;
  let divsCumulative = 0;

  for (let t = 1; t <= horizonYears; t++) {
    const eps = eps0 * Math.pow(1 + annualGrowth, t);
    const peSpan = peEnd - peStart;
    const pe = peStart + peSpan * (t / horizonYears);
    const price = eps * pe;
    const dividendPerShare = eps * payoutRatio;
    const dividendIncome = dividendPerShare * shares;

    if (useDRIP && price > 0) {
      shares += dividendIncome / price;
    } else {
      divsCumulative += dividendIncome;
    }

    const value = shares * price;

    rows.push({
      year: t,
      eps,
      pe,
      price,
      shares,
      dividendPerShare,
      dividendIncome,
      divsCumulative: useDRIP ? 0 : divsCumulative,
      value,
    });
  }

  const endRow = rows[rows.length - 1];
  const endValue = endRow.value + endRow.divsCumulative;
  const totalDivs = useDRIP ? 0 : endRow.divsCumulative;
  const cagrPriceOnly = startValue > 0 && horizonYears > 0
    ? Math.pow(endRow.value / startValue, 1 / horizonYears) - 1
    : null;
  const cagrTotalReturn = startValue > 0 && horizonYears > 0
    ? Math.pow(endValue / startValue, 1 / horizonYears) - 1
    : null;
  const multiple = startValue > 0 ? endValue / startValue : 0;

  return {
    rows,
    startValue,
    endValue,
    totalDivs,
    cagrPriceOnly,
    cagrTotalReturn,
    multiple,
  };
}

export type ScenarioPreset = {
  id: string;
  label: string;
  description: string;
  annualGrowth: number;
  peEnd: number;
  payoutRatio: number;
};

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "status-quo",
    label: "Status Quo",
    description: "Earnings track recent run-rate, multiple unchanged.",
    annualGrowth: 0.10,
    peEnd: 8,
    payoutRatio: 0.40,
  },
  {
    id: "bull",
    label: "Bull Case",
    description: "Earnings re-rate, market awards a higher multiple.",
    annualGrowth: 0.18,
    peEnd: 12,
    payoutRatio: 0.35,
  },
  {
    id: "bear",
    label: "Bear Case",
    description: "Earnings stall, multiple compresses on de-rating.",
    annualGrowth: 0.04,
    peEnd: 6,
    payoutRatio: 0.45,
  },
  {
    id: "long-compounder",
    label: "Long Compounder",
    description: "Lower growth but durable, sustained over the horizon.",
    annualGrowth: 0.12,
    peEnd: 10,
    payoutRatio: 0.30,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Tune the sliders yourself.",
    annualGrowth: 0.12,
    peEnd: 10,
    payoutRatio: 0.40,
  },
];
