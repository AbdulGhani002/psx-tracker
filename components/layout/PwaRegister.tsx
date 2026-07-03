"use client";

import { useEffect } from "react";

// Registers the static-asset service worker (public/sw.js). Makes the app
// installable and repeat opens near-instant; it never caches page data.
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
