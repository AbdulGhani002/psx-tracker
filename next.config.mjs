/** @type {import('next').NextConfig} */
const nextConfig = {
  // The old /valuation page ran a second, cruder fair-value engine that could
  // disagree with /intrinsic — one stock, two "fair values". Removed; keep old
  // links working.
  async redirects() {
    return [
      { source: "/valuation", destination: "/intrinsic", permanent: true },
      // Removed pages with ZERO recorded use (verified in the database):
      // the decision log (0 entries ever; the per-stock Playbook covers the
      // "why did I buy" job) and PMEX commodities (0 trades ever, and PMEX
      // blocks live prices anyway). Models and backups remain intact.
      { source: "/log", destination: "/transactions", permanent: true },
      { source: "/commodities", destination: "/assets", permanent: true },
      // Removed at the user's request (fundamentals/income investor — chart
      // pattern and backtest toys, an empty watchlist, and the glossary index;
      // the Urdu Term tooltips on other pages remain).
      { source: "/patterns", destination: "/screener", permanent: true },
      { source: "/backtest", destination: "/screener", permanent: true },
      { source: "/watchlist", destination: "/holdings", permanent: true },
      { source: "/glossary", destination: "/", permanent: true },
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
