// Single source of truth for the app version + changelog.
// Bump APP_VERSION and prepend a CHANGELOG entry on every release.

export const APP_VERSION = "2.7.0";

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
    version: "2.7.0",
    date: "2026-06-14",
    title: "Valuation suite — P/E, yields, fair value, margin of safety",
    changes: [
      "New Valuation page: P/E, earnings yield and dividend yield computed automatically from scraped EPS + live price + the dividend forecast.",
      "Fair value blends a dividend-discount model (required return = live SBP rate + your equity premium) with an earnings multiple (your fair P/E), and shows the margin of safety and a cheap / fair / expensive verdict per holding.",
      "P/B and ROE light up when you enter a book value per share on the holding page — one of several editable inputs so you can keep the analysis current as new figures come out.",
      "Equity premium, fair P/E, and a target monthly income are editable in Settings.",
    ],
  },
  {
    version: "2.6.0",
    date: "2026-06-14",
    title: "Look-through (sum-of-the-parts) value for holding companies",
    changes: [
      "New per-holding 'Look-through value' section: for a holding company (e.g. AHCL), enter the stakes it owns once (from the annual report), and the app values them at live PSX prices, subtracts net debt, and computes a net-asset-value per share.",
      "Shows the discount (or premium) of the market price to the underlying assets — the classic holding-company discount — and what your shares are worth on a look-through basis vs the market.",
      "Shares outstanding auto-derives from earnings (profit ÷ EPS) when not pinned. Constituents with no live price are flagged so the NAV isn't silently understated.",
    ],
  },
  {
    version: "2.5.0",
    date: "2026-06-14",
    title: "Income planner, per-holding overrides, dividend growth",
    changes: [
      "New Income planner (/income): a Pakistan-aware withdrawal calculator driven by your own actual return (money-weighted XIRR). Safe vs max monthly income, the portfolio you need for a target, a depletion test that shows when fast-growing withdrawals run the pot dry, and passive-income coverage from your forecast dividends.",
      "Per-holding dividend override: pin par value, cadence, payout ratio, or the expected dividend yourself on any holding when the automatic forecast gets it wrong. Overridden holdings are tagged 'set'.",
      "Dividend growth: the forecast now reads each company's EPS-growth trend (clamped) to inform forward dividend growth.",
    ],
  },
  {
    version: "2.4.1",
    date: "2026-06-13",
    title: "Real par value + upcoming dividends list",
    changes: [
      "Face (par) value is no longer assumed to be Rs 10 — it's calibrated from your recorded dividends against PSX's declared percentage (Rs 5 received on a 50% dividend means par Rs 10). Genuinely non-Rs-10 stocks are detected automatically and the source is shown (✓ = calibrated).",
      "New 'Upcoming dividends' list: the next 12 months of expected payments, soonest first, with date, rate, shares, and amount.",
      "Par value column added to the analysis, adjusted for splits.",
    ],
  },
  {
    version: "2.4.0",
    date: "2026-06-13",
    title: "Bonus shares and splits in the forecast",
    changes: [
      "Bonus issues are now read from PSX and projected forward — a new 'Bonus shares ahead' section shows the free shares expected, and dividends after a bonus are forecast on the larger share count.",
      "Share splits adjust the face value, so a post-split company's percentage dividends translate to the correct rupee amount (a 1:2 split makes a 100% dividend Rs 5/share, not Rs 10). Split holdings are tagged.",
    ],
  },
  {
    version: "2.3.0",
    date: "2026-06-13",
    title: "Authoritative dividend history from PSX",
    changes: [
      "Dividend cadence and amounts now come straight from PSX's declared payout history, not just what you've recorded — so AHCL reads as annual and quarterly payers like HUBC read as quarterly, automatically.",
      "Each holding shows its declared dividend (% of face) alongside the earnings-capped sustainable estimate, with an 'above earnings' flag where a company pays out of reserves.",
      "Payout ratio is matched to the earning year's EPS; the forward forecast still respects what profits can sustain.",
      "Payout history is cached weekly with the rest of the fundamentals.",
    ],
  },
  {
    version: "2.2.0",
    date: "2026-06-13",
    title: "Earnings-grounded dividend forecast",
    changes: [
      "Dividend forecast now reads each company's EPS and profit from PSX and caps the forward dividend at what earnings can sustain — no more projecting a payout a company can't afford.",
      "Everything is shown in percentage terms: payout ratio, dividend as % of face value, dividend yield, and dividend cover (EPS ÷ DPS).",
      "Cadence is read per fiscal year, so an annual payer (e.g. AHCL) is no longer mistaken for a quarterly one.",
      "A loss-making year forecasts no dividend, with a clear at-risk / stretched / comfortable health read.",
      "Company fundamentals are scraped from dps.psx.com.pk and cached weekly.",
    ],
  },
  {
    version: "2.1.1",
    date: "2026-06-08",
    title: "Delete a mistaken transaction from the holding page",
    changes: [
      "Each holding's transaction history now has Edit and Delete actions. Delete sends a wrong entry to Trash and shows an inline Undo, exactly like the Transactions page — no need to leave the stock's page.",
    ],
  },
  {
    version: "2.1.0",
    date: "2026-06-06",
    title: "Safety net: backup, trash, and a dividend forecast",
    changes: [
      "Backup & restore: download a full JSON snapshot of every collection from Settings, and restore it later in merge or replace mode. Your insurance against data loss.",
      "Soft-delete: deleting a transaction now moves it to a Trash instead of erasing it. Undo right after deleting, or restore later. Trash rows never affect any holding, dividend, tax, or cash figure.",
      "Dividend forecast calendar: a 12-month projection of expected dividend cash, built from each holding's own payout history and scaled by current shares, with per-holding confidence.",
      "Restoring a transaction is blocked if it would push a holding into negative shares.",
    ],
  },
  {
    version: "2.0.1",
    date: "2026-06-06",
    title: "Security & integrity audit fixes",
    changes: [
      "Price refresh no longer wipes the snapshot cache before refetching — closes a window where quotes briefly read as missing.",
      "Telegram bot token is never sent back to the browser; the Settings form keeps the saved secret unless you paste a new one.",
      "Selling more shares than you hold is now rejected (both new sales and edits that would push a holding negative).",
      "Login is throttled: too many failed password attempts from one IP are locked out for 15 minutes.",
      "Upload limits on dividend PDFs and CSV imports to prevent oversized payloads.",
      "Dark-mode dropdown arrow and native controls now follow the theme.",
      "Price auto-fills again when you switch transaction type after a manual edit.",
    ],
  },
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
