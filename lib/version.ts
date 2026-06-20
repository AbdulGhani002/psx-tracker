// Single source of truth for the app version + changelog.
// Bump APP_VERSION and prepend a CHANGELOG entry on every release.

export const APP_VERSION = "3.0.0";

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
    version: "3.0.0",
    date: "2026-06-20",
    title: "Multi-tenant accounts — real sign-up, your data is now private to you",
    changes: [
      "The tracker is now a proper multi-account app. Sign up with an email and password, verify the email, and you get your own private portfolio — separate from everyone else's. Forgot-password and email-verification flows are built in.",
      "Complete data isolation: every holding, transaction, fund, savings account, cash entry, commodity trade, watchlist item, decision log, target, and setting is tied to your account. Every page and every query only ever reads or writes your own data — no one else can see it, and you can't see theirs.",
      "Backup & restore is now per-account: your export contains only your data, and importing can never touch another account's records.",
      "Alerts run per account: each user's Telegram config, watchlist targets, drift, and ex-dividend reminders are checked and deduplicated independently.",
      "Background data warming runs for every account on schedule, so each person's dashboard, valuation, and benchmark stay instant.",
    ],
  },
  {
    version: "2.25.0",
    date: "2026-06-20",
    title: "Tax timing, Shariah, gold/inflation, Urdu glossary",
    changes: [
      "Tax: a new 'If you sold today' view shows each open position's holding period and the CGT you'd owe right now, plus a 30-June deadline banner telling you how much CGT you could cut by harvesting losses before the tax year closes.",
      "Shariah: a new page tags every holding by KMI index membership (Meezan-screened) and computes the purification (charity) due from your dividends once you enter each company's non-permissible income %.",
      "Benchmark chart: two new toggle lines — 'Gold (PKR)' to compare against the classic inflation hedge, and 'Real (after inflation)' which adjusts your return for Pakistan's CPI (set it in Settings).",
      "Learn: a plain-words glossary in English + Roman Urdu, with hover tooltips on key terms (Sharpe, Beta, Alpha…).",
    ],
  },
  {
    version: "2.24.0",
    date: "2026-06-20",
    title: "Much faster pages (dashboard + valuation)",
    changes: [
      "The dashboard and valuation pages were slow on a cold load (9–16s) because they recomputed heavy data — risk metrics, today's movers, valuations, the look-through — live on every visit. These are now computed in the background, cached, and served instantly (~0.2s), refreshed hourly and on a short cycle.",
      "Today's movers now fetch all symbols in parallel (was one-by-one), and the valuation page no longer re-runs the deep look-through drill-down it didn't need.",
    ],
  },
  {
    version: "2.23.0",
    date: "2026-06-15",
    title: "Daily-dividend funds: NAV ticks up daily",
    changes: [
      "Daily-dividend funds now show an effective NAV that rises every day at the fund's yield — with the daily % next to it — so the fund's daily income shows as a growing NAV and is counted in your return (instead of a flat 0%).",
      "Set the fund's yield and your purchase (anchor) date on Edit; the published par NAV is still shown for reference.",
    ],
  },
  {
    version: "2.22.1",
    date: "2026-06-15",
    title: "Benchmark chart: instant + never blank",
    changes: [
      "The benchmark chart was recomputed live on every load (2–6s of external PSX/Yahoo fetches), and if one of those blipped it showed 'unavailable'. It's now cached and served instantly, refreshed in the background, and if a refresh fails it keeps showing the last good chart instead of going blank.",
    ],
  },
  {
    version: "2.22.0",
    date: "2026-06-15",
    title: "Benchmark now shows your dividends working",
    changes: [
      "The benchmark chart used to plot only share-price moves — so for a high-dividend portfolio it understated your real result. Added a 'Portfolio + dividends' total-return line that reinvests every dividend you received; the faint 'price only' line is still there, and the gap between them is exactly what your dividends add.",
      "Since KSE-100 is itself a price index, the fairest comparison is your total-return line against it. Your Total Return and XIRR figures already counted dividends — now the chart does too.",
    ],
  },
  {
    version: "2.21.0",
    date: "2026-06-15",
    title: "Daily-dividend funds: units grow, not NAV",
    changes: [
      "Money-market / daily-dividend funds (like Alhamra Daily Dividend) now model the return correctly. Their NAV stays pinned at par and the income comes as daily dividends reinvested into MORE units — so the app now grows your units over time instead of showing a flat 0% return.",
      "Mark any fund as daily-dividend (Edit → tick the box), set its annual yield and an anchor date, and units accrue daily just like a savings account. The table shows the reinvested units and a real return.",
      "Ordinary growth funds (valued at units × live NAV) are unchanged.",
    ],
  },
  {
    version: "2.20.0",
    date: "2026-06-15",
    title: "Drill into Fatima — deeper look-through tree",
    changes: [
      "AHCL's look-through now drills into Fatima Fertilizer, listing the ~19 companies Fatima itself owns (Pakarab, Fatimafert, Fatima Cement, National Resources, the REITs, etc.) from Fatima's FY2025 report.",
      "Honest framing: Fatima is an operating fertilizer business, not a pure holding company, so its stakes are shown as a portfolio inside it (book values), not as a misleading NAV/discount.",
      "The engine can now drill into any company in the known-companies library, even ones you don't hold — no phantom positions needed.",
    ],
  },
  {
    version: "2.19.0",
    date: "2026-06-15",
    title: "Deeper look-through: unlisted holdings, drill-down, HUBCO",
    changes: [
      "Look-through now lists named private/unlisted holdings (e.g. AHCL's Sachal Energy, Black Gold, PIA) each with its own value — entered from the annual report, never a fake price. They show in the table and the composition bar.",
      "Recursive drill-down: any listed stake that is itself a holding company is expanded to show what it owns underneath.",
      "AHCL updated from its FY2024/FY2025 annual reports: added Safe Mix Concrete (32.4%), corrected the AHL stake to 74.32%, pinned the post-split 4.22bn shares, and added the unlisted holdings (Sachal 85.83%, Black Gold 100%, PIA consortium). Note: AHL is a brokerage with no strategic listed stakes, so it has no deeper tree.",
      "HUBCO added to the known-companies library. All its assets (CPHGC, Thar Energy, ThalNova, etc.) are unlisted, so its look-through is a book-value sum-of-the-parts — open HUBC, click \"Load known stakes\", then add its net debt for a true NAV.",
    ],
  },
  {
    version: "2.18.0",
    date: "2026-06-15",
    title: "Look-through: what one share actually owns",
    changes: [
      "On a holding company's look-through, two new columns: how many shares of each underlying company a single share owns (e.g. one AHCL share owns ~0.076 of Fatima), and the rupees-per-share each stake contributes — which add up to the NAV per share.",
      "Added an asset-composition bar so you can see the mix at a glance.",
    ],
  },
  {
    version: "2.17.2",
    date: "2026-06-15",
    title: "Fix login redirect bouncing to localhost",
    changes: [
      "Visiting the site while signed out redirected to localhost instead of the real address (a reverse-proxy quirk). The login redirect now always stays on your domain.",
    ],
  },
  {
    version: "2.17.1",
    date: "2026-06-15",
    title: "More visualizations",
    changes: [
      "Dividend forecast: a bar chart of expected income month by month, so you can see your income calendar at a glance.",
      "Assets: a net-worth composition donut (equities, funds, savings, cash).",
    ],
  },
  {
    version: "2.17.0",
    date: "2026-06-15",
    title: "Add-to-rebalance, valuation methodology, more charts",
    changes: [
      "Rebalance: you can now add a company you don't own yet. Type the symbol and a target weight — it's verified on PSX, priced live, and shows up in the plan as a BUY sized to hit your target.",
      "New \"How it's valued\" page: explains exactly where every number comes from, and breaks each holding company down — barrel-style — into the underlying companies it owns, with the live discount to net asset value.",
      "Dashboard: added an allocation donut showing your equity mix at a glance.",
      "Faster: the portfolio price lookup now reads all symbols in one database query instead of one per stock, so every page loads quicker.",
    ],
  },
  {
    version: "2.16.0",
    date: "2026-06-15",
    title: "Secure login + HTTPS",
    changes: [
      "Replaced the browser username/password popup with a proper login page. Sign in once and a secure encrypted session keeps you logged in for 30 days — no more re-entering credentials every visit.",
      "The site now runs over HTTPS on its own address. The old plain-HTTP port is closed.",
      "Added a Sign out option in the menu.",
    ],
  },
  {
    version: "2.15.1",
    date: "2026-06-15",
    title: "Timestamps now shown in Pakistan time (PKT)",
    changes: [
      "All dates and times now display in Pakistan Standard Time and are labelled PKT. The server runs in a European timezone, so timestamps were showing ~3 hours behind your wall clock and made fresh prices look hours old — they weren't. Prices refresh on the same schedule as before; only the displayed time was off.",
    ],
  },
  {
    version: "2.15.0",
    date: "2026-06-15",
    title: "Holding companies valued on NAV, not P/E",
    changes: [
      "Holding companies (anything with a look-through configured, e.g. AHCL) are now valued on net asset value — the live sum-of-the-parts of what they own — instead of P/E. Their reported EPS is mostly the change in value of the shares they hold, so a P/E reads misleadingly cheap (AHCL was showing +66% 'cheap' on a P/E of 2.7×; on NAV it trades near fair value).",
      "On the Valuation page these rows are tagged NAV: fair value is NAV per share, margin of safety is the discount to NAV, and the P/E / EPS / earnings-yield are dimmed as reference-only.",
      "Regular operating companies are unchanged — still valued on the blended dividend-discount + earnings multiple.",
    ],
  },
  {
    version: "2.14.0",
    date: "2026-06-15",
    title: "Sector tilt vs KSE-100 — precomputed in the background, served instantly",
    changes: [
      "The Risk page now shows your sector mix next to the KSE-100's own market-cap weighting, so you can see exactly where you're over- or under-weight versus the index.",
      "The index weighting is built from free PSX data (market-watch prices + each member's shares derived from its financials) by a scheduled background job and stored as a single snapshot — the page reads it instantly and never recomputes on load, so it stays fast.",
      "New snapshot store (FeedSnapshot) + a refresh-snapshots cron; a failed refresh keeps showing the last good data rather than going blank.",
      "Note: PSX announcements and NCCPL FIPI/LIPI remain bot-protected and aren't scraped; corporate actions (cash dividends/book-closure) are still tracked via the payouts feed and ex-dividend alerts.",
    ],
  },
  {
    version: "2.13.0",
    date: "2026-06-15",
    title: "Holding-company library — one-click stakes for AHCL & others",
    changes: [
      "A known-holding-company library: on any recognized holding company, one click loads its stakes into the look-through (all editable). AHCL pre-filled with its 5 listed strategic stakes; its unlisted subsidiaries (Sachal Energy, Black Gold, Rayaan, PIA) are listed as a note to value under 'unlisted / other'.",
      "Engro Holdings (ENGROH, ex-Dawood Hercules/DAWH) is recognized too, so the look-through works for it the moment you hold it.",
    ],
  },
  {
    version: "2.12.0",
    date: "2026-06-15",
    title: "52-week range + index membership (from PSX data)",
    changes: [
      "Each holding now shows its 52-week high/low and where the price sits in that range — computed from the EOD history, no paid feed.",
      "Index membership (KSE-100, KMI-30, All-Share, etc.) is read live from PSX market-watch and shown on the holding page.",
    ],
  },
  {
    version: "2.11.0",
    date: "2026-06-15",
    title: "Look-through by stake %, AHCL pre-seeded",
    changes: [
      "Look-through constituents can be entered as a stake % (from the annual report) instead of a raw share count — the app derives the shares from that company's own shares outstanding (live).",
      "AHCL is pre-seeded with its real listed stakes (Fatima Fertilizer 15.19%, Javedan 19.84%, Aisha Steel 13.8%, Power Cement 6.5%, Arif Habib Ltd 72.92%) so its look-through NAV vs market discount works out of the box — all editable, add unlisted assets (PIA, Sachal) and net debt yourself.",
    ],
  },
  {
    version: "2.10.0",
    date: "2026-06-15",
    title: "Ex-dividend alerts + CSV export",
    changes: [
      "Telegram alert when a holding is about to go ex-dividend (within 14 days of book closure), so you hold long enough to qualify. Fires once per entitlement.",
      "Download CSV of the valuation, dividend forecast, or holdings tables (opens in Excel) — links on the Valuation and Forecast pages, plus /api/export.",
    ],
  },
  {
    version: "2.9.0",
    date: "2026-06-14",
    title: "Total net-worth benchmark line",
    changes: [
      "The dashboard benchmark chart now has a 'Net worth (all assets)' line — total wealth (stocks + funds + savings + cash) tracked over time and compared to KSE-100, not just your stocks.",
      "It's a true time-weighted return: external cash deposits/withdrawals are neutralized so the line shows performance, not money you added. Savings compound; cash is rebuilt from your ledger; funds are held at current value (no daily NAV history).",
    ],
  },
  {
    version: "2.8.1",
    date: "2026-06-14",
    title: "Weekly auto-refresh of fundamentals & payouts",
    changes: [
      "A scheduled job now refreshes every holding's EPS, financials, and dividend payouts from PSX once a week, so the forecast and valuation always use current data without waiting for a page to lazily fetch it.",
    ],
  },
  {
    version: "2.8.0",
    date: "2026-06-14",
    title: "Risk analysis — concentration, correlation, stress test",
    changes: [
      "New Risk page: concentration (single-name and sector weights vs your cap, plus a Herfindahl-based 'effective holdings' diversification read).",
      "Correlation matrix of daily returns between your holdings — shows which names move together and the average pairwise correlation.",
      "Interactive stress test: drag a market drop and see the hit to net worth and to your safe monthly income (equities + funds fall, savings + cash hold).",
    ],
  },
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
