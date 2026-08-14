import { CHART_THEME } from "./theme";

export type SeriesKey =
  | "portfolio"
  | "portfolioTR"
  | "portfolioReal"
  | "netWorth"
  | "kse100"
  | "kmi30"
  | "gold"
  | "portfolioUsd"
  | "sp500"
  | "usdpkr"
  | "riskFree"
  | "ndx100"
  | "ftse100"
  | "dowjones"
  | "dax"
  | "nikkei225"
  | "sensex";

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
  portfolioTR: {
    key: "portfolioTR",
    label: "Portfolio + dividends",
    short: "Total return",
    stroke: CHART_THEME.accent,
    width: 2.5,
    defaultOn: true,
    hint: "Your real result: price moves PLUS dividends reinvested. The gap above the price line is your dividends working.",
  },
  portfolio: {
    key: "portfolio",
    label: "Portfolio (price only)",
    short: "Price only",
    stroke: "#9a8e7a",
    width: 1.5,
    dash: "3 3",
    defaultOn: true,
    hint: "Share price moves only — excludes dividends. Shown so you can see what dividends add.",
  },
  portfolioReal: {
    key: "portfolioReal",
    label: "Real (after inflation)",
    short: "Real",
    stroke: "#b5683f",
    width: 1.75,
    dash: "5 2",
    defaultOn: false,
    hint: "Your total return adjusted for Pakistan's inflation — growth in real purchasing power. Set the inflation rate in Settings.",
  },
  gold: {
    key: "gold",
    label: "Gold (PKR)",
    short: "Gold",
    stroke: "#caa53d",
    width: 1.5,
    dash: "4 2",
    defaultOn: false,
    hint: "Gold's return in rupees over the same window — the classic inflation/devaluation hedge to beat.",
  },
  netWorth: {
    key: "netWorth",
    label: "Net worth (all assets)",
    short: "Net worth",
    stroke: "#c8884a",
    width: 2,
    dash: "7 3",
    defaultOn: false,
    hint: "Total wealth — stocks + funds + savings + cash — time-weighted (external deposits neutralized).",
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
  ndx100: {
    key: "ndx100",
    label: "NASDAQ 100 (USD)",
    short: "NASDAQ",
    stroke: "#7ea6a0",
    width: 1.5,
    dash: "3 2",
    defaultOn: false,
    hint: "US big-tech benchmark, in USD.",
  },
  ftse100: {
    key: "ftse100",
    label: "FTSE 100 (GBP)",
    short: "FTSE",
    stroke: "#a695b8",
    width: 1.5,
    dash: "2 2",
    defaultOn: false,
    hint: "UK large-cap benchmark, in GBP.",
  },
  dowjones: {
    key: "dowjones",
    label: "Dow Jones (USD)",
    short: "Dow",
    stroke: "#b8a06b",
    width: 1.5,
    dash: "6 2",
    defaultOn: false,
    hint: "The 30 US industrial blue chips, in USD.",
  },
  dax: {
    key: "dax",
    label: "DAX 40 (EUR)",
    short: "DAX",
    stroke: "#88a4c0",
    width: 1.5,
    dash: "5 4",
    defaultOn: false,
    hint: "German large-cap benchmark, in EUR.",
  },
  nikkei225: {
    key: "nikkei225",
    label: "Nikkei 225 (JPY)",
    short: "Nikkei",
    stroke: "#c0888e",
    width: 1.5,
    dash: "3 4",
    defaultOn: false,
    hint: "Japan's headline index, in JPY.",
  },
  sensex: {
    key: "sensex",
    label: "Sensex (INR)",
    short: "Sensex",
    stroke: "#93b183",
    width: 1.5,
    dash: "1 2",
    defaultOn: false,
    hint: "India's BSE 30 — the neighbour to measure PSX against, in INR.",
  },
};

export const SERIES_ORDER: SeriesKey[] = [
  "portfolioTR",
  "portfolio",
  "portfolioReal",
  "netWorth",
  "kse100",
  "kmi30",
  "gold",
  "portfolioUsd",
  "sp500",
  "ndx100",
  "ftse100",
  "dowjones",
  "dax",
  "nikkei225",
  "sensex",
  "usdpkr",
  "riskFree",
];
