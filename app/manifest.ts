import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PSX Portfolio",
    short_name: "PSX",
    description: "A wealth desk for a PSX portfolio: holdings, payouts, analytics and a learned model.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
