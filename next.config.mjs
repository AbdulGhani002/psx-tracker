/** @type {import('next').NextConfig} */
const nextConfig = {
  // The old /valuation page ran a second, cruder fair-value engine that could
  // disagree with /intrinsic — one stock, two "fair values". Removed; keep old
  // links working.
  async redirects() {
    return [
      // 14 Aug: the app was cut back to what Abdul actually uses — holdings,
      // PMEX contracts, decisions, transactions, wealth, funds. 20 screens were
      // removed in one pass. EVERY removed path redirects to a page that still
      // exists; nothing chains through another redirect (Next does not follow
      // its own redirects, so a hop to a deleted page would 404).
      //
      // The LIBRARIES behind these pages are deliberately KEPT: the alert cron
      // still reads intrinsic buy-zones, Shariah/KMI status and the earnings
      // calendar, and the sell-discipline engine still reads analytics ratings
      // for sector-median PE. Only the screens are gone.
      { source: "/log", destination: "/transactions", permanent: true },
      { source: "/model", destination: "/wealth", permanent: true },
      { source: "/news", destination: "/", permanent: true },
      { source: "/patterns", destination: "/holdings", permanent: true },
      { source: "/backtest", destination: "/holdings", permanent: true },
      { source: "/glossary", destination: "/", permanent: true },
      { source: "/valuation", destination: "/holdings", permanent: true },
      { source: "/intrinsic", destination: "/holdings", permanent: true },
      { source: "/ratings", destination: "/holdings", permanent: true },
      { source: "/screener", destination: "/holdings", permanent: true },
      { source: "/compare", destination: "/holdings", permanent: true },
      { source: "/shariah", destination: "/holdings", permanent: true },
      { source: "/methodology", destination: "/", permanent: true },
      { source: "/flows", destination: "/", permanent: true },
      { source: "/earnings-calendar", destination: "/", permanent: true },
      { source: "/optimize", destination: "/rebalance", permanent: true },
      { source: "/dividend-calendar", destination: "/dividends", permanent: true },
      { source: "/forecast", destination: "/dividends", permanent: true },
      { source: "/assets", destination: "/funds", permanent: true },
      { source: "/ladder", destination: "/funds", permanent: true },
      // Tax, CGT, risk, income and cash all reported on total wealth; /wealth
      // now carries the financial-year reconciliation that replaces them.
      { source: "/tax", destination: "/wealth", permanent: true },
      { source: "/cgt-simulator", destination: "/wealth", permanent: true },
      { source: "/risk", destination: "/wealth", permanent: true },
      { source: "/income", destination: "/wealth", permanent: true },
      { source: "/cash", destination: "/wealth", permanent: true },
      // Removed at the user's request (fundamentals/income investor — chart
      // pattern and backtest toys, an empty watchlist, and the glossary index;
      // the Urdu Term tooltips on other pages remain).
      { source: "/patterns", destination: "/screener", permanent: true },
      { source: "/backtest", destination: "/screener", permanent: true },
      { source: "/glossary", destination: "/", permanent: true },
      // 26 Aug: the zakat calculator is gone at the owner's request — this app
      // records what happened, and how much zakat is owed is his call to make,
      // not a number for a portfolio tracker to assert. The zakat DEDUCTED on
      // dividend warrants stays exactly where it was: that is money a payer
      // actually withheld, and it is part of what each dividend netted.
      { source: "/zakat", destination: "/wealth", permanent: true },
    ];
  },
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    // Client router cache: revisiting a page within 30s renders instantly from
    // the in-browser cache (back/forward feels native). Mutations still call
    // router.refresh(), which purges it — fresh numbers after any edit.
    staleTimes: { dynamic: 30, static: 180 },
    serverActions: { allowedOrigins: ["localhost:3010"] },
    serverComponentsExternalPackages: ["unpdf"],
    outputFileTracingIncludes: {
      "/api/dividends/**/*": ["./node_modules/unpdf/**/*"],
      // Contract-note and iSave-statement parsing use unpdf's positional
      // extraction; the standalone build must carry the package for them too.
      "/api/transactions/parse-note/**/*": ["./node_modules/unpdf/**/*"],
      "/api/funds/statement/**/*": ["./node_modules/unpdf/**/*"],
    },
  },
};

export default nextConfig;
