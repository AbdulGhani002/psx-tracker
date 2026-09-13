"use client";

import { useEffect } from "react";

// Registers the static-asset service worker (public/sw.js). Makes the app
// installable and repeat opens near-instant; it never caches page data.
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Development chunks are not content-hashed, so a cache-first worker
    // would serve yesterday's bundle; register it in production only.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
