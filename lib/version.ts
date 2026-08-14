// Single source of truth for the app version + changelog.
// Bump APP_VERSION and prepend a CHANGELOG entry on every release.

export const APP_VERSION = "8.0.0";

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
    version: "8.0.0",
    date: "2026-08-14",
    title: "Two pillars: equities and PMEX",
    changes: [
      "The app is now 16 pages instead of 34. Removed AI Ratings, Screener, Compare, Foreign flows, Portfolio optimiser, Next rupee, Dividend and Earnings calendars, CGT simulator, Tax, Dividend forecast, Intrinsic, Methodology, Shariah, Risk, Income planner, Cash, Assets, Model and News. Every old link redirects to a page that still exists, and the libraries behind them stay — the alert cron still reads intrinsic buy-zones, Shariah status and the earnings calendar.",
      "PMEX is a first-class pillar again, covering commodities, currency pairs and the KSE-100 future. Seven FX pairs added (EUR/USD, GBP/USD, AUD/USD, NZD/USD, USD/JPY, USD/CHF, USD/CAD) with the quote direction handled per pair, so USD/JPY converts to rupees per yen rather than multiplying into nonsense.",
      "Contracts are now grouped by Pakistan's financial year, 1 July to 30 June. A contract counts in the year you CLOSED it, not the year you opened it. The page shows realised versus open, per-instrument attribution, and win rate, average win and loss, expectancy and profit factor.",
      "Futures mechanics: every contract can carry an expiry date, a settlement type (cash settled or deliverable) and the margin you posted. Contracts near or past expiry are surfaced for a decision, and a deliverable contract left open past expiry is flagged as actual delivery. Margin gives you return-on-margin and leverage, which is the number a futures trader actually earns.",
      "An open contract with no mark is reported separately rather than valued at entry, because a confident zero is worse than an honest gap. Live world reference prices sit beside your own mark as a staleness check and never feed profit — PMEX settles on its own prices.",
      "New Mutual funds & savings page carries the MCB iSave holdings, the statement reconciler and cash discipline. The Wealth page gained a financial-year reconciliation across equities, funds and PMEX in one table, current year against prior year.",
      "Dropdown options were nearly invisible against the dark popup; they now paint in theme colours at 14.5:1 contrast.",
      "Dead code removed: 8 unused files, 12 unused data functions, a dead tax report builder and the ladder module, plus their unused imports.",
    ],
  },
  {
    version: "7.2.1",
    date: "2026-08-08",
    title: "You vs the world",
    changes: [
      "The benchmark now carries the famous world indices alongside KSE-100 and the S&P 500: NASDAQ 100, FTSE 100, Dow Jones, DAX 40, Nikkei 225, and India's Sensex. All seven appear as toggles on the overview chart, and the Wealth page's monthly table gains S&P, NASDAQ and FTSE columns plus a full-window world scoreboard.",
      "Honesty note built in: each index is quoted in its own currency, so the comparison measures stock-picking, not currencies — and the caption tells you how much USD/PKR moved in the same window, which is what a dollar asset would have added for a rupee investor.",
      "The Wealth page now shares the overview's 3-hour benchmark cache instead of refetching a dozen external series on every load.",
    ],
  },
  {
    version: "7.2.0",
    date: "2026-08-08",
    title: "Filing season, honest fund cost basis, and the app that reports to you",
    changes: [
      "FBR filing pack on the Tax page: pick a tax year and get every dividend payer with gross, WHT and zakat deducted at source, plus every FIFO disposal with its exact gain — exportable as one CSV to fill the return from. Defaults to the year you're actually filing (the one that just ended).",
      "iSave statements now read their own transaction rows. Every row's units are proven against the running balance chain (ending exactly at the statement's closing units), then cost basis updates itself: new money adds cost, reinvested dividends add units free, redemptions take cost out at your average. Anything unprovable — a broken chain, an unrecognised row type, a missing statement in between — leaves cost untouched and says why. The machine now reproduces July's hand-done reconciliation to the paisa.",
      "Plan-proximity pings: when a price gets within 3% of YOUR ceiling or YOUR buy level, Telegram tells you before the trigger day arrives. Only fires where a plan exists, skips week-old prices, re-arms weekly.",
      "Trim simulator on every holding: pick shares to sell and see the exact FIFO CGT this tax year (lot by lot), your new weight, the freed cash net of fees and tax, and what that cash earns parked in the MMF versus staying put. Nothing is saved — and an actual sale still goes through the decision gate.",
      "Sector peers on every holding: the same-sector names from the live 500-stock universe with P/E, earnings yield and dividend yield, medians included, your row highlighted.",
      "Corporate actions announced on shares you hold (bonus and right issues) now surface on the Transactions page with the entitlement math pre-filled — one click opens the form with shares and date set. Nothing records itself.",
      "You vs KSE-100 on the Wealth page: month-by-month relative performance (like-for-like price returns, with your true with-dividends column alongside), the window totals, and your max drawdown.",
      "A one-page PDF statement lands in your Telegram on the 1st of every month: net worth, what moved it, dividends banked, trades, decisions logged, positions. Typeset properly on the server, black and white.",
      "Fresh NAVs are back despite MUFAP's block: the datacentre is walled, but your own PC isn't — a small daily task fetches the fund-price page at home and relays the raw HTML to the server, which parses and validates it with the same code as before. Refuses tiny or garbled pages rather than overwrite a good snapshot.",
    ],
  },
  {
    version: "7.1.0",
    date: "2026-08-07",
    title: "Broker documents import themselves — and check their own arithmetic first",
    changes: [
      "BMA contract-note PDFs now import directly on the Import page. Every note is reconciled against itself before anything is written: each row's quantity × net rate, the note total, and total ± S.S.T against the grand total. If the layout ever changes or a number is off by more than 3 paisa, the note is refused and shown raw — a surprise can never import wrong numbers. Multiple fills at one price merge into one transaction; S.S.T is split across rows by commission, so fees land to the paisa.",
      "iSave statements reconcile on the Assets page. Units and repurchase NAVs are read per fund and cross-checked against the statement's own printed total; Apply moves units and the NAV anchor and refreshes the stored NAV (useful while MUFAP blocks the server). Cost basis is never touched, and funds on the statement that aren't tracked here are pointed out — including the dust.",
      "A price that's really last week's now says so: if the PSX scraper has been failing for 7+ days, the Holdings price cell gets an age badge instead of posing as live, and buy-zone alerts stop firing on stale arithmetic entirely.",
      "The dividend calendar's ≈ Rs/share now uses each company's real par value where it's on file (marked *), instead of assuming Rs 10 for everyone.",
      "New on Decisions: an opportunity ranking of every held position by after-tax return vs the best money-market fund net of WHT — the weakest justifier sits on top. Positions we can't rank are listed as unrankable, never guessed.",
      "The database now backs itself up nightly on the server (14-day rotation), and each backup is integrity-checked before older ones rotate out.",
    ],
  },
  {
    version: "7.0.2",
    date: "2026-08-06",
    title: "A fund with no live NAV is no longer valued at zero",
    changes: [
      "MUFAP began blocking our server today, and with no live NAV your money-market fund was valued at ZERO — a fabricated -100% that silently dropped Rs 55k from net worth. The last successfully published NAV is now stored durably and served when the feed is down, clearly labelled with its date. A days-old real NAV is honest; zero never is.",
    ],
  },
  {
    version: "7.0.1",
    date: "2026-07-18",
    title: "Stale tabs now heal themselves",
    changes: [
      "If the app is updated while you have a tab open, the next click used to hit files that no longer existed and the page just looked broken until a hard refresh. Now the tab detects exactly that case and reloads itself once, automatically. A friendly error screen replaces the blank one for anything else.",
      "Deploys now keep the previous builds' asset files on the server, so tabs opened before an update keep working even without the reload.",
    ],
  },
  {
    version: "7.0.0",
    date: "2026-07-18",
    title: "Version 7 — the sell side becomes first-class: triggers, guards, and an append-only decision log",
    changes: [
      "The analyzer used to validate holding and stay silent about selling. Backwards: holding is the default that needs no courage. V7 makes every sell, trim, and hold-through-a-fired-rule a logged, pre-committed decision.",
      "Selling now REQUIRES a decision: rationale and falsifier are written with the trade, frozen with a full snapshot (price, weights, your fair-value band, which triggers had fired, the thesis verbatim), into an append-only log. No rationale, no sale — enforced at the API, not politely suggested.",
      "Pre-committed sell triggers on every position: your price ceiling, falsifiable thesis invalidators, an opportunity-cost floor against your real money-market alternative (net of tax), concentration and time stops — plus the counter-intuitive cyclical rule: LOW P/E on PEAK earnings with rates rising is the sell setup, not the bargain.",
      "A new Decisions page is the inbox: fired triggers, expired cash, due re-buy reviews and due outcome-reviews land as cards that nag until cleared. Overriding your own rule is allowed — silently ignoring it is not (hold-through-trigger must be logged with reasoning).",
      "Behavioural guards watch YOU, not the stock: anchoring-to-cost detection in your own sell rationale, escalating-commitment counters when ceilings/targets get raised without logged reasons, thesis-drift warnings when the story keeps changing without decisions. None of them block — they make you look first.",
      "Cash is a position now: every fund, savings account and the brokerage balance carries a purpose and a hard review date. Purposeless or past-due cash surfaces with its inflation drag computed from the live CPI.",
      "Re-buy rules with teeth: exit a position and optionally pre-commit a ceiling, conditions and a review date. When the data lands you get the checklist — and if the price is above your ceiling, the card says do not chase.",
      "Grade yourself later: each decision can carry a review date; when it arrives you record what happened and score the REASONING 1-5 (write-once). The scorecard aggregates by action type — your trims vs your adds, in numbers.",
      "Cash-conversion (3-year OCF/PAT) flags earnings quality; reported profit comes from the scraped financials, operating cash flow is transcribed by you from the annual report — no free feed carries it, and we never invent it.",
      "Nothing auto-trades. The tool advises, records and nags; you decide.",
    ],
  },
  {
    version: "6.6.0",
    date: "2026-07-17",
    title: "The app now reports to you: weekly digest, board-meeting pings, and sharper answers",
    changes: [
      "Weekly Telegram digest, every Friday: net worth (with the dollar figure), unrealised P/L, XIRR with its REAL twin after live CPI, your best and worst holding, and the coming week's ex-dates and board meetings. Same live numbers as the site, pushed to you.",
      "Board-meeting alerts: when a company you HOLD has a board meeting in the next 7 days (results, dividend declarations), you get a ping. The ex-date alert told you about the payout — this tells you about the day it's decided.",
      "'What moved it' on the dashboard: the last 30 days' change split into per-holding rupee contributions, biggest mover first, with honest footnotes for anything measured on partial data. The headline number finally has a why.",
      "Yield-on-cost column on Holdings: all dividends a position has ever paid you against what you actually paid for it — the income investor's compounding score. (Already on each holding's page; now visible across the book.)",
      "Buy-side what-if on every holding page: shares and price in, and you get the new average cost, cash needed with real PSX brokerage, and your new weight against the concentration cap — before you place the order. The mirror of the sell-side CGT preview.",
      "Company's-own-model editor on every holding page: transcribe the audited fair-value assumptions (required return, growth, base dividend) with the citation. No source, no save — a number wearing an auditor's name must be citable. When set, it anchors the intrinsic blend.",
      "The portfolio-in-USD chart line already existed as a toggle on the dashboard benchmark chart — 'did I gain, or did the rupee just melt?' is answered there.",
    ],
  },
  {
    version: "6.5.2",
    date: "2026-07-17",
    title: "Four more pages retired — the app now matches how you invest",
    changes: [
      "Removed the Pattern scanner and Strategy backtest — chart-pattern tools for traders, not for a fundamentals and income investor. Old links redirect to the Screener.",
      "Removed the Watchlist page (never used). Buy-zone Telegram alerts continue to cover every stock you actually hold via the intrinsic valuation — that path doesn't need a watchlist.",
      "Removed the Glossary index page. The Urdu term tooltips that appear inline across the app (tax, CGT, overview) are unchanged.",
      "The navigation is now 31 pages, every one either holding your data or answering a question you actually ask.",
    ],
  },
  {
    version: "6.5.1",
    date: "2026-07-17",
    title: "Two never-used pages retired",
    changes: [
      "Removed the Decision log and Commodities (PMEX) pages. The database shows zero decision-log entries and zero commodity trades ever recorded — and PMEX blocks live prices anyway, so that page was manual-entry only. Old links redirect to Transactions and Assets. Your data models and backups are untouched, so nothing is lost if either ever comes back.",
      "The per-stock Playbook on each holding page remains the place to write down why you bought.",
    ],
  },
  {
    version: "6.5.0",
    date: "2026-07-17",
    title: "One fair value, six honest models",
    changes: [
      "Removed the old Valuation page and its separate engine. It computed a second, cruder fair value that could disagree with the Intrinsic page — one stock, two different 'fair values' is worse than none. /valuation now redirects to Intrinsic & buy zones, which is THE fair value everywhere (screener, alerts, exports).",
      "Cut the models that made no sense. The Graham number needed a book value the PSX data never provides, so it showed 'N/A' on essentially every stock — a dead row. The 'Justified P/E' was the dividend model in disguise (payout × EPS is the dividend, so it ran the same Gordon formula twice and double-counted the dividend signal). Both gone.",
      "The zero-growth floor (EPS ÷ required return) no longer drags the blend down. Its own description said 'a downside anchor, not fair value' — yet it was mixed into fair value anyway. It's now shown as context: the price at which the stock works even if it never grows again.",
      "Through-cycle earnings now include loss years. Averaging only the profitable years credited cyclicals with earning power their own cycle disproves; a company whose 3-year average is a loss now honestly shows no earnings-based value at all.",
      "What remains is one model per idea: the company's own audited model (weighted highest when it exists), look-through NAV for holding companies, sector-fair-P/E on through-cycle earnings, the dividend stream (Gordon, at your per-company CAPM required return), and a 5-year DCF. Each answers a different question, so the blend means something.",
    ],
  },
  {
    version: "6.4.0",
    date: "2026-07-17",
    title: "The Pakistan pack: real returns, the next-rupee ladder, Zakat, SIP and more",
    changes: [
      "New page — Next rupee: every place you can park money (12-month T-bill, your money-market funds, your savings accounts, your equities), ranked by what actually SURVIVES — after each instrument's own withholding tax and after live CPI inflation. Advertised yields are the least useful number in an 11% inflation economy; right now the ladder shows nothing in fixed income beats inflation after tax, which is the honest case for productive assets.",
      "New page — Zakat: 2.5% on your net zakatable wealth with the nisab threshold computed from the live silver price. Includes the CZ-50 bank-deduction note, the AAOIFI long-term-shares view, and per-category include/exclude. If the silver price is unavailable it says so — the threshold is never guessed.",
      "Real returns beside nominal, everywhere it matters: your funds and savings on Assets now show 'real after tax', the dashboard XIRR shows its inflation-adjusted twin, and the income planner defaults to live PBS inflation instead of a typed-in 10.",
      "Monthly SIP in the compounding model: add a monthly contribution and see the honest outcome — the CAGR cards go quiet with a SIP (a lump-sum CAGR would count your own contributions as growth) and a plain-language card shows end value against ALL money you put in, plus what it buys in today's rupees.",
      "Tax page: the dividend-WHT-by-tax-year table now actually renders (it was computed but never shown); a new section shows the withholding haircut on your savings profit (Sec 151) that your bank takes before you ever see it; and the headline CGT figure is now THIS tax year's exact FIFO number instead of a lifetime average-cost estimate.",
      "New Telegram alert: a held share leaving the KMI Shariah universe now pings you — the semi-annual recomposition was previously silent, exactly when a Shariah-conscious holder must act.",
      "Settings: profit-on-debt withholding rates (filer/non-filer) are now editable, and the inflation field is an OVERRIDE — leave it at 0 and the live official feed is used.",
      "Not shipped: a National Savings (Behbood/DSC) comparison rung — savings.gov.pk's rates page currently returns a server error, so there is no reliable source to build on. It'll be added if their site comes back.",
    ],
  },
  {
    version: "6.3.0",
    date: "2026-07-16",
    title: "A risk premium that fits Pakistan, and inflation that updates itself",
    changes: [
      "Every share used to clear the same hurdle: one flat risk premium for a power utility, a bank and a cement cyclical alike. Now each company is discounted using its OWN measured beta against the KSE-100 — riskier shares must clear more, defensive ones less.",
      "Betas are adjusted toward the market before use (the standard Blume method). Thinly-traded PSX shares measure an artificially LOW beta simply because they rarely trade, which would have handed them a lower hurdle — the opposite of the truth, since illiquidity is a risk.",
      "The equity risk premium is now 5.5 points over the SBP policy rate, not 10. A flat 10 put the required return at 21.5% and marked almost everything expensive. 5.5 reconciles with how Pakistani equities are actually valued: it puts a market-risk share at 17%, and Arif Habib Ltd's own measured beta lands its hurdle at 16.0% — the same rate AHCL's audited Level-3 model uses.",
      "Inflation now updates itself, from the Pakistan Bureau of Statistics CPI feed. It was previously defaulted to zero (making every 'real return' simply the nominal one) while the income planner used a hardcoded 10. Latest published: 11.07% year-on-year.",
      "Real returns now use the Fisher formula rather than subtracting inflation from the return, which overstates it — and overstates it most when inflation is high, which in Pakistan is exactly when it matters.",
    ],
  },
  {
    version: "6.2.1",
    date: "2026-07-16",
    title: "A missing price no longer looks like a total loss",
    changes: [
      "If we couldn't get a price for one of your shares, the app treated it as worth zero — showing a 100% loss on that holding and quietly dropping it out of your portfolio total and every percentage weight. A price we don't have is unknown, not zero. Such a holding now shows 'no price', reports no gain or loss, and a banner tells you your totals exclude it.",
      "The same error existed one level up: your portfolio's unrealised P/L subtracted the cost of an unpriced holding while ignoring its value, inventing a loss across the whole book. Value and cost are now always compared over the same holdings.",
      "Dividends and realised gains on such a holding are still counted — that money is banked and doesn't depend on today's quote.",
    ],
  },
  {
    version: "6.2.0",
    date: "2026-07-16",
    title: "Valuing a share as what it actually pays you",
    changes: [
      "A holding company is now also valued as an income stream, not only on what it owns. Before, any company with a look-through NAV was valued on sum-of-the-parts alone and its dividend was ignored entirely. That was wrong: a minority shareholder never receives the underlying assets, only the dividends — which is exactly why holding companies trade at a discount to NAV.",
      "You can now record a company's OWN published valuation model — the required return, growth and dividend it discloses in its audited accounts, with the source. When a company and its auditor have published the assumptions behind a fair value, that beats anything we model ourselves, so it now carries the most weight. Companies that publish nothing show 'not applicable' — we never invent one.",
      "Fixed a real error in the growth calculation: loss-making years were dropped from the year count, which squeezed the timeline and overstated growth. A company earning 5 then 10 across six years (with losses between) was reported as growing 25% a year; the truth is 14.9%. Overstated growth had been inflating fair value and creating buy signals that weren't there.",
      "Every discount rate now starts from the real SBP policy rate fetched live, plus your equity risk premium.",
    ],
  },
  {
    version: "6.1.0",
    date: "2026-07-16",
    title: "The policy rate is now real",
    changes: [
      "The SBP policy rate is now fetched live from the State Bank instead of a hand-typed table. This matters: the old table had placeholder rows marked 'illustrative', their dates passed, and a made-up 10.5% quietly became the live rate — while the real rate was 11.50%. That number sets your required return, every intrinsic value and every buy-zone alert, so those were all shifted. It reads 11.50% now.",
      "We also pull the T-bill (MTB) cut-off yields, KIBOR and the State Bank's official USD/PKR rate from the same page — so the valuation page's 'earnings yield vs the T-bill rate' comparison is now backed by an actual T-bill rate.",
      "If the State Bank feed is ever unreachable we keep the last real rate and mark it stale. We never fall back to a guess.",
      "Security: the scheduled-job endpoints are now machine-only. Previously any signed-in account could call them, which exposed the list of users and could burn other people's daily alert slots.",
      "Security: your SBP rate overrides are now private to your account. They used to be shared, so one account's edits changed everyone's numbers.",
      "Speed: the funds, savings and cash figures were each being calculated twice on every load of Assets, Wealth and Statement. Now once.",
    ],
  },
  {
    version: "6.0.2",
    date: "2026-07-16",
    title: "Signed-in users skip the login page",
    changes: [
      "If you're already signed in and open the login page, we now send you straight to your dashboard instead of showing the sign-in form again.",
      "Corrected the MCB mutual-fund holdings from the latest statement and fixed a stale cost basis that was showing a false loss on a money-market fund; fund returns now read the real MUFAP published yield.",
    ],
  },
  {
    version: "6.0.1",
    date: "2026-07-03",
    title: "Chat assistant temporarily disabled",
    changes: [
      "The AI chat assistant is paused for now and removed from the menu — it was heavy on the shared server. Everything else (news, summaries, ratings, calendars, alerts, reports) is unchanged. It can be switched back on later.",
    ],
  },
  {
    version: "6.0.0",
    date: "2026-07-03",
    title: "Version 6 — your own AI: a market chatbot and an AI news summarizer, trained locally",
    changes: [
      "Ask the market anything: a new Chat assistant grounded on this platform's own live data — ratings, prices, dividends, board meetings, foreign flows and news. It retrieves real facts with transformer embeddings, answers with a compact instruct LLM served on this server, shows the facts it used, and admits when it doesn't know. Fine-tuned on thousands of Q&A pairs generated from real PSX data on local GPU hardware.",
      "AI-written news summaries: our own summarization model — a T5 transformer fine-tuned on a purpose-built corpus of Pakistani financial articles (collected, cleaned and paired in-house) — writes the summary under each story on the News page. Summaries are precomputed in the background, so the page stays instant.",
      "Both features run as separate microservices (chatbot-service, summarizer-service) beside the existing data and analytics services — nothing monolithic.",
      "The training corpus (full article bodies) and the chat dataset keep growing daily with the collector, and both models retrain with one command.",
    ],
  },
  {
    version: "5.0.0",
    date: "2026-07-03",
    title: "Version 5 — news intelligence, smarter alerts, and the tools around the trade",
    changes: [
      "News desk: Pakistani business coverage (Business Recorder, Dawn, Tribune) refreshed daily, scored by a transparent word-list sentiment and conservatively tagged to listed companies — see /news, and each stock page shows its own latest coverage.",
      "The AI rating's News score is finally real: it now comes from the stock's tagged press coverage over the last 14 days (neutral only when there genuinely isn't enough coverage — never guessed).",
      "Earnings calendar: every company's board-meeting notices (where results and dividends get decided), upcoming with countdowns — the parser fix unblocked 2,300+ real meeting records.",
      "Telegram alerts got smarter: on top of watchlist targets, drift and ex-dividend reminders, you now get pinged when a held/watchlisted stock enters its BUY zone, and when foreigners hit a 3/5/7/10-session buying or selling streak.",
      "Portfolio statement: a print-ready report of everything you own — PKR and USD, cost vs value, each holding's AI rating, fund yields, and the foreign-flow context. One click: Print / Save as PDF.",
      "Optimizer → action: the max-Sharpe mix now turns into concrete BUY/SELL amounts (shares and rupees) against your live positions and any budget you set.",
      "CGT what-if simulator: pick a holding, drag the shares slider, and see exactly which FIFO lots a sale would consume and the tax at your filer rate — before you sell.",
    ],
  },
  {
    version: "4.8.0",
    date: "2026-07-03",
    title: "Fund yields now update themselves daily",
    changes: [
      "Every fund's annual yield is re-fetched from MUFAP once a day by the background scheduler and stored — pages read the stored figure instantly, restarts don't lose it, and nobody ever needs to type a yield again.",
      "The same refresh also keeps each fund record's fallback figure in sync with the latest published 1-year return, so even the fallback can't drift stale.",
    ],
  },
  {
    version: "4.7.0",
    date: "2026-07-03",
    title: "Real fund yields from MUFAP + install as an app (PWA)",
    changes: [
      "Mutual funds now show their REAL annual yield — the trailing-12-month return MUFAP publishes for each fund — instead of a hand-entered guess. Daily-dividend funds accrue at the live rate too; the manual figure is only a fallback, clearly marked.",
      "Fund records reconciled against the AMC account statement (units and anchors corrected).",
      "The site is now installable as an app on your phone or desktop: repeat opens are near-instant (code and fonts served from the device). Your financial data is never cached — it always comes fresh from the server.",
    ],
  },
  {
    version: "4.6.0",
    date: "2026-07-02",
    title: "Deep speed pass — streaming pages, scroll-loading, and no more analytics stalls",
    changes: [
      "The overview now streams: the header and layout paint immediately, and each section (stats, allocation, risk, activity) pops in as its data is ready — instead of a blank page until everything was computed. Shared data is computed once per visit even though sections load independently.",
      "The AI ratings board renders its top 120 stocks instantly (the page is ~4× lighter) and automatically loads the rest of the market as you scroll toward the bottom.",
      "Fixed the every-15-minutes hang: when the market analytics cache expired, the next visitor waited ~7 seconds while the whole universe recomputed. It now serves the existing data instantly and refreshes in the background — market pages answer in milliseconds, always.",
      "Going back to a page you just visited is now instant (a short-lived in-browser cache); editing anything still refreshes the numbers.",
      "The compounding model (the heaviest chart code) no longer downloads until you scroll near it on a holding's page.",
      "The server now speaks HTTP/2 and streams responses through unbuffered — both matter most on high-latency connections like Pakistan to Europe.",
    ],
  },
  {
    version: "4.5.0",
    date: "2026-06-28",
    title: "Speed — self-hosted fonts and parallel data loading",
    changes: [
      "Fonts are now self-hosted and preloaded instead of being pulled from Google on every visit. That removes three slow, render-blocking round-trips to external font servers before any text could appear — the single biggest cause of the slow first paint, especially on a Pakistani connection to the Europe server.",
      "Heavy pages (like a holding's detail) now fetch all their data in parallel instead of one query after another, cutting server response time noticeably.",
      "Compression and long-term caching of the app's code were verified already in place, so repeat visits stay fast.",
    ],
  },
  {
    version: "4.4.0",
    date: "2026-06-28",
    title: "Sliders, no more scroll-wheel surprises, and bot protection on sign-in",
    changes: [
      "The screener and the strategy backtester now have a slider under each numeric filter — drag for a quick range, or still type an exact value. Dragging a slider to its open end clears that filter.",
      "Fixed an annoyance: scrolling the mouse wheel while a number field was focused used to silently change its value (by the field's step). That's now disabled everywhere — a number is whatever you type, full stop; the page just scrolls.",
      "Login and signup are now wired for Cloudflare Turnstile bot protection. It stays invisible until the site keys are configured, then a quick human-check appears on the auth screen.",
    ],
  },
  {
    version: "4.3.0",
    date: "2026-06-28",
    title: "Dollar equivalents — see your worth in USD too",
    changes: [
      "Your portfolio worth and amount invested now show a US-dollar equivalent alongside the rupee figure — on the overview (net worth, total value, cost basis), the wealth statement, and each holding's detail page.",
      "The USD/PKR rate is pulled live from a free interbank source (refreshed every few hours) and clearly marked approximate. If the rate can't be fetched, the dollar line is simply hidden — never shown with a made-up rate.",
    ],
  },
  {
    version: "4.2.0",
    date: "2026-06-28",
    title: "Foreign flows — FIPI/LIPI, who's really buying and selling PSX",
    changes: [
      "New Foreign flows page: the official NCCPL record of foreign vs local investor activity (FIPI/LIPI), in US-dollar millions. See whether foreigners are net buyers or sellers today, their current streak, and the cumulative inflow/outflow over the last ~4 months.",
      "Three views: a cumulative foreign-flow line (are they accumulating or distributing?), daily net bars, and a same-session breakdown by investor type — foreign corporates and individuals versus local mutual funds, banks, companies and individuals — so you can see exactly who's on each side.",
      "On the data: NCCPL's own portal is bot-gated (Cloudflare Turnstile), so the collector can't scrape it from the server directly. The same official numbers are sourced from scstrade and stored daily, with a 4-month history backfilled. Foreign selling isn't automatically bearish — steady local absorption often marks a floor.",
    ],
  },
  {
    version: "4.1.0",
    date: "2026-06-28",
    title: "Strategy lab — backtester, portfolio optimiser, pattern scanner & dividend calendar",
    changes: [
      "Strategy backtest: test a simple rule (RSI oversold/overbought, SMA cross, or hold-above-SMA) on any PSX stock's full price history, and judge it honestly against buy-and-hold — return, edge, trades, win rate, max drawdown, time-in-market, and a growth-of-Rs-1 curve.",
      "Portfolio optimiser: Modern Portfolio Theory on real PSX history. For a basket of stocks it finds the max-Sharpe and minimum-volatility blends and draws the efficient frontier, so you can see diversification at work — the mix sits above its parts.",
      "Pattern scanner: a market-wide sweep for double tops/bottoms, head-and-shoulders and triangles, split into already-triggered breakouts and still-forming setups, each ranked by how clean it is. Each stock page now lists its own detected patterns too.",
      "Dividend calendar: every announced cash dividend, bonus and right issue across PSX, sorted by book-closure date with a countdown to the ex-date — so you never miss an entitlement.",
      "Under the hood: the index (KSE100) and the Shariah index (KMI30) are now collected, so beta and market-relative risk compute for the whole universe.",
    ],
  },
  {
    version: "4.0.0",
    date: "2026-06-28",
    title: "Market intelligence — AI ratings, screener & heatmap for the whole PSX",
    changes: [
      "The site is now a full market platform, not just a portfolio tracker. A new data pipeline collects the entire PSX (every listed company's prices, financials, payouts) into a database that refreshes itself daily, and a separate analytics engine turns it into live intelligence.",
      "AI Ratings: every PSX stock gets a 0–100 score, blended from a Fundamental, Technical and Risk sub-score — each one explained in plain words, no black box. Browse the whole rating board or open any stock for the full breakdown.",
      "Smart Screener: filter the entire market by P/E, dividend yield, net margin, EPS growth, RSI, volume spike, above SMA-50/200, MACD and the AI score — the list updates live as you change filters.",
      "Live Heatmap: the whole market as green/red tiles by today's move, grouped by sector (market-cap weighted). Click any tile for its rating.",
      "Sector Rotation: see which sectors money is flowing into and out of. Stock Comparison: put up to five names side by side on valuation, growth, quality and momentum.",
      "Built as independent microservices behind the scenes; the market data is shared, your portfolio stays private to you.",
    ],
  },
  {
    version: "3.5.0",
    date: "2026-06-27",
    title: "Sector-aware valuation — it now reads each business properly",
    changes: [
      "The biggest flaw was valuing every company on the same multiple. A brewery monopoly, a bank, a power utility and a cement maker are completely different businesses and the market prices them very differently. The fair P/E is now set by each stock's PSX SECTOR — defensive food/FMCG names get a big premium (~15×), banks a modest ~7×, power utilities ~5× (regulated returns + circular debt), E&P ~6×, cement ~8× — then nudged by growth, the rate, and the margin trend.",
      "This changes the calls in the right direction: Murree Brewery now reads a strong buy (a monopoly FMCG at a P/E of ~10 is genuinely cheap), Meezan reads fair, and the power/cement/auto names stay expensive because on a sector-appropriate multiple they are.",
      "Pulls in real fundamentals from PSX and shows them per stock: trailing P/E, net profit margin and its trend, revenue growth, and the through-cycle EPS. Improving margins earn a premium; falling ones a discount — so the model rewards quality.",
      "Every reason now names the business: e.g. 'valued like a commercial bank at 7×', plus its earnings yield vs the T-bill rate and whether it's cheaper or richer than its trailing P/E.",
    ],
  },
  {
    version: "3.4.0",
    date: "2026-06-27",
    title: "Realistic buy zones — calibrated to how PK stocks actually trade",
    changes: [
      "The model was so conservative that everything read 'expensive' with buy prices 40%+ below market that would never hit. Fixed by leading on a realistic Pakistani fair P/E (a blue-chip multiple that rises with growth and compresses when the SBP rate is high, bounded to the 4.5–12× band PK equities actually trade in) instead of a no-growth 'EPS ÷ rate' that caps fair value near 6× and marks everything expensive.",
      "Growth now fades: instead of extrapolating a windfall year (banks earned huge profits at 22% rates — that reverses), the model credits ~60% of the trailing trend, capped. This stops both the over-optimism and the collapse-to-zero on a single down year.",
      "Buy zones are reachable: the margin of safety starts at ~12% (a normal dip) for a steady blue chip instead of 20%+, and the 'fair' band is wider — so a fairly-priced stock reads 'fair', and a modest pullback turns it into a buy.",
      "On each stock you can now drag the required return and the growth, and the fair P/E updates with them automatically (it's derived, not a guess), with the value and zones recomputing live.",
    ],
  },
  {
    version: "3.3.0",
    date: "2026-06-27",
    title: "Valuation re-tuned for Pakistan (Graham was too US-centric)",
    changes: [
      "The Graham models assumed US norms — a 'fair P/E of 15' and a fixed 22.5 constant — which don't hold in a market with an 11%+ policy rate and single-digit P/Es. Replaced the US Graham-growth formula with a rate-aware Justified P/E (the Gordon fair multiple: payout × (1+g) / (r − g)), which falls automatically as the SBP rate rises. The Graham number is kept only as an asset floor, rebuilt from the LOCAL fair P/E instead of the US 22.5, and down-weighted.",
      "The value now leans on earnings-power (EPS ÷ the high local rate) and the justified P/E — the two reads that actually fit a high-interest market.",
      "Added the key Pakistan value check to every stock's reasons: its earnings yield versus the risk-free T-bill rate, and whether the spread compensates you for equity risk.",
    ],
  },
  {
    version: "3.2.0",
    date: "2026-06-27",
    title: "Smarter intrinsic value + live, interactive buying zones",
    changes: [
      "Fixed the valuation engine. It was letting one freak year and one broken model distort the answer (Meezan read ~Rs 225 because a single down-year zeroed out growth and a mis-estimated dividend dragged the average down). Now: earnings are normalised through the cycle (3-year average), growth is a multi-year trend not one year, the dividend model is down-weighted, and any model that disagrees with the rest by more than 50% is set aside as an outlier. The blend is the weighted middle of the models that actually agree.",
      "Every method is now shown explicitly: each stock lists all six models with their value and whether it was blended in or set aside (and why) — no more guessing which models were used.",
      "Interactive, live buying zones: drag the required return, the growth rate, or the fair P/E on any stock and the intrinsic value, the buy/strong-buy prices, the zone gauge, the method chart and the sensitivity all recompute instantly, with the headline value counting up to its new number.",
      "Reasons spelled out: the 'why this zone' panel now explains the through-cycle growth, the outliers it set aside, and exactly how the buy price was derived.",
      "More motion throughout — animated value counters, fade-in cards, and the zones update the moment any input changes.",
    ],
  },
  {
    version: "3.1.0",
    date: "2026-06-27",
    title: "Intrinsic value + buying zones for every share",
    changes: [
      "New 'Intrinsic & buy zones' page: for every holding we compute what the share is actually worth, blended from up to six independent models — a 2-stage discounted-earnings (DCF) model, the dividend-discount model, Graham's growth formula, the classic Graham number, earnings power value, and a fair P/E multiple. Holding companies are valued on their live look-through NAV instead.",
      "Concrete buying zones: each stock gets a 'buy below' and 'strong buy below' price, with the margin of safety scaled to that stock's OWN volatility (a jumpier share has to be cheaper before it's a buy) and widened further if it pays dividends out of reserves. A colour gauge shows exactly where today's price sits.",
      "Every number is explained: a 'why this zone' panel spells out the required return (SBP rate + your equity premium), the growth assumption, and how the safety margin was set — no black boxes.",
      "Four new charts per stock: a football-field plot of all the methods on one scale against the price, the buying-zone gauge, a year of price history shaded by zone (so you can see every dip into a buying zone), and a sensitivity tornado showing what moves the value most.",
      "Each holding's own page now carries a compact intrinsic-value and buying-zone block too.",
      "Pages feel instant: every analysis page now shows a shimmering skeleton the moment you click, then fades the real (cached) content in — plus subtle fade-in animations throughout.",
    ],
  },
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
