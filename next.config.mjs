/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3010"] },
    serverComponentsExternalPackages: ["unpdf"],
    outputFileTracingIncludes: {
      "/api/dividends/**/*": ["./node_modules/unpdf/**/*"],
    },
  },
};

export default nextConfig;
