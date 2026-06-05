import { CHART_THEME } from "./theme";

export type SeriesKey =
  | "portfolio"
  | "kse100"
  | "kmi30"
  | "portfolioUsd"
  | "sp500"
  | "usdpkr"
  | "riskFree";

export type SeriesMeta = {
  key: SeriesKey;
  label: string;
  short: string;
  stroke: string;
  width: number;
  dash?: string;
  defaultOn: boolean;
  hint: string;
};

// Distinct strokes/dashes so up to seven lines stay legible on the dark panel.
export const SERIES_META: Record<SeriesKey, SeriesMeta> = {
  portfolio: {
    key: "portfolio",
    label: "Your portfolio (PKR)",
    short: "Portfolio",
    stroke: CHART_THEME.accent,
    width: 2.25,
    defaultOn: true,
    hint: "Your holdings, valued at daily close, indexed to 100.",
  },
  kse100: {
    key: "kse100",
    label: "KSE-100",
    short: "KSE-100",
    stroke: CHART_THEME.cream,
    width: 1.5,
    dash: "2 3",
    defaultOn: true,
    hint: "The benchmark PSX index.",
  },
  kmi30: {
    key: "kmi30",
    label: "KMI-30 (Sharia)",
    short: "KMI-30",
    stroke: "#8aa17a",
    width: 1.5,
    dash: "5 3",
    defaultOn: false,
    hint: "Sharia-compliant PSX index.",
  },
  portfolioUsd: {
    key: "portfolioUsd",
    label: "Your portfolio (USD)",
    short: "Portfolio $",
    stroke: "#d4a574",
    width: 1.75,
    dash: "6 3",
    defaultOn: false,
    hint: "Your PKR portfolio converted to USD daily — real return after rupee depreciation.",
  },
  sp500: {
    key: "sp500",
    label: "S&P 500 (USD)",
    short: "S&P 500",
    stroke: "#9fb6c4",
    width: 1.5,
    dash: "2 3",
    defaultOn: false,
    hint: "US large-cap benchmark, in USD.",
  },
  usdpkr: {
    key: "usdpkr",
    label: "USD / PKR",
    short: "USD/PKR",
    stroke: "#c98b6b",
    width: 1.25,
    dash: "1 3",
    defaultOn: false,
    hint: "Rupee vs dollar — rising = rupee weakening.",
  },
  riskFree: {
    key: "riskFree",
    label: "Risk-free (SBP rate)",
    short: "Risk-free",
    stroke: "#7d8a93",
    width: 1.25,
    dash: "4 4",
    defaultOn: false,
    hint: "What cash would earn compounding at the SBP policy rate.",
  },
};

export const SERIES_ORDER: SeriesKey[] = [
  "portfolio",
  "kse100",
  "kmi30",
  "portfolioUsd",
  "sp500",
  "usdpkr",
  "riskFree",
];
