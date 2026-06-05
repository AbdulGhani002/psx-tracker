// Single source of truth for the app version + changelog.
// Bump APP_VERSION and prepend a CHANGELOG entry on every release.

export const APP_VERSION = "2.0.0";

export const BUILD_DATE =
  process.env.NEXT_PUBLIC_BUILD_DATE ?? "";
export const BUILD_SHA =
  process.env.NEXT_PUBLIC_BUILD_SHA ?? "";

export type ChangelogEntry = {
  version: string;
  date: string; // ISO yyyy-mm-dd
  title: string;
  changes: string[];
};

// Reverse-chronological. Newest first.
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2.0.0",
    date: "2026-06-05",
    title: "Custom-price rebalance, multi-benchmark, versioning",
    changes: [
      "Rebalance: set a custom order price per holding (e.g. your limit-order price) and shares are computed at that price, not the live quote.",
      "Rebalance: greedy leftover deployment — spare cash is put to work buying whole shares of the most-underweight positions until it can't buy another share.",
      "Dashboard benchmark now compares Portfolio, KSE-100, KMI-30, Portfolio-in-USD, S&P 500, USD/PKR and a risk-free (SBP policy-rate) line, each toggleable and indexed to 100.",
      "USD/PKR and S&P 500 history pulled live from Yahoo; KMI-30 from PSX.",
      "Version system: this changelog, a version tag in the footer, and semantic releases.",
    ],
  },
  {
    version: "2.0.0-beta.4",
    date: "2026-06-04",
    title: "Watchlist, editable transactions, KSE-100 benchmark",
    changes: [
      "Watchlist with live PSX prices and target buy/sell 'HIT' badges.",
      "Edit any transaction (including dividend-specific fields) with automatic recompute.",
      "Dashboard benchmark chart: portfolio vs KSE-100 over 90 days.",
      "Ghost (0-share) holdings hidden from allocation views.",
    ],
  },
  {
    version: "2.0.0-beta.3",
    date: "2026-05-23",
    title: "Dividends & cash",
    changes: [
      "Upload CDC dividend warrant PDFs — parsed into dividend transactions, deduped by warrant number.",
      "Add dividends manually too.",
      "Cash account: deposits, withdrawals, and an implied balance from all activity.",
      "Editable parsed values before import, with gross/rate/net helper math.",
    ],
  },
  {
    version: "2.0.0-beta.2",
    date: "2026-05-23",
    title: "Live data & customization",
    changes: [
      "Company name, sector, and price scraped live from dps.psx.com.pk — no hardcoded data.",
      "Auto-computed PSX brokerage fee (0.15% or Rs 0.20/share, whichever is higher).",
      "Per-holding settings: target %, rebalance band, notes, overrides, refresh-from-PSX.",
      "Bulk target-allocation editor on the rebalance page.",
    ],
  },
  {
    version: "2.0.0-beta.1",
    date: "2026-05-23",
    title: "Foundation",
    changes: [
      "Editorial design system: Fraunces display, IBM Plex Mono numerics, cream/ink/amber palette.",
      "Holdings, transactions, dashboard, decision log.",
      "Multi-scenario compounding model with DRIP and 5/10/15/20-year horizons.",
      "Money-weighted XIRR and weighted-average cost basis.",
      "Deployed on VPS behind HTTP Basic auth.",
    ],
  },
];
