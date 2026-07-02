/** @type {import('next').NextConfig} */
const nextConfig = {
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
    },
  },
};

export default nextConfig;
