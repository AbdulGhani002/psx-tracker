import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PSX Portfolio",
    short_name: "PSX",
    description: "A long-horizon Pakistani equity portfolio tracker with AI market intelligence.",
    start_url: "/",
    display: "standalone",
    background_color: "#1a1814",
    theme_color: "#1a1814",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
