# Changelog

All notable changes to PSX Portfolio Tracker. This project follows
[Semantic Versioning](https://semver.org/).

## [2.0.0] — 2026-06-05 — Custom-price rebalance, multi-benchmark, versioning

- **Rebalance**: set a custom order price per holding (e.g. your limit-order
  price) and shares are computed at that price, not the live quote.
- **Rebalance**: greedy leftover deployment — spare cash is put to work buying
  whole shares of the most-underweight positions until it can't buy another.
- **Benchmark**: dashboard now compares Portfolio, KSE-100, KMI-30,
  Portfolio-in-USD, S&P 500, USD/PKR and a risk-free (SBP policy-rate) line —
  each toggleable and indexed to 100.
- USD/PKR and S&P 500 history from Yahoo; KMI-30 from PSX.
- **Versioning**: this changelog, a version tag in the footer, semantic releases.

## [2.0.0-beta.4] — 2026-06-04 — Watchlist, editable transactions, KSE-100 benchmark

- Watchlist with live PSX prices and target buy/sell "HIT" badges.
- Edit any transaction (including dividend-specific fields), auto-recompute.
- Dashboard benchmark chart: portfolio vs KSE-100 over 90 days.
- Ghost (0-share) holdings hidden from allocation views.

## [2.0.0-beta.3] — 2026-05-23 — Dividends & cash

- Upload CDC dividend warrant PDFs — parsed and deduped by warrant number.
- Add dividends manually.
- Cash account with an implied balance from all activity.
- Editable parsed values before import with helper math.

## [2.0.0-beta.2] — 2026-05-23 — Live data & customization

- Company name, sector, price scraped live from dps.psx.com.pk.
- Auto-computed PSX brokerage fee (0.15% or Rs 0.20/share, whichever higher).
- Per-holding settings; bulk target-allocation editor.

## [2.0.0-beta.1] — 2026-05-23 — Foundation

- Editorial design system; holdings, transactions, dashboard, decision log.
- Multi-scenario compounding model with DRIP.
- Money-weighted XIRR; weighted-average cost basis.
- Deployed on VPS behind HTTP Basic auth.
