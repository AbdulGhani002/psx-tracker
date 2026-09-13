"use client";

import { useEffect } from "react";

// Route-level error boundary. Its main job: self-heal the stale-tab case.
//
// We deploy many times a day; each build has new content-hashed chunks. A tab
// opened BEFORE a deploy will, on its next navigation, request chunks that no
// longer exist — ChunkLoadError — and without this boundary the app just looks
// broken until the user thinks to hard-refresh. Here we detect that exact
// failure and reload once automatically (a sessionStorage flag stops loops).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isStaleBuild =
    /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|import\(\) failed/i.test(
      `${error?.name ?? ""} ${error?.message ?? ""}`
    );

  useEffect(() => {
    if (isStaleBuild && typeof window !== "undefined") {
      const KEY = "psx-stale-reload";
      if (sessionStorage.getItem(KEY) !== "1") {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    } else if (typeof window !== "undefined") {
      sessionStorage.removeItem("psx-stale-reload");
    }
  }, [isStaleBuild]);

  return (
    <div className="max-w-[600px] mx-auto px-6 py-16 text-center">
      <div className="font-display text-[22px] mb-2">
        {isStaleBuild ? "New version available." : "Something went wrong."}
      </div>
      <p className="text-[13px] text-muted mb-6">
        {isStaleBuild
          ? "The app was updated while this tab was open. Reloading picks up the new version — your data is untouched."
          : "The error has been contained to this page — your data is untouched. Try again, or reload the tab."}
      </p>
      <div className="flex gap-3 justify-center">
        <button
          onClick={() => window.location.reload()}
          className="btn-ghost"
        >
          Reload
        </button>
        {!isStaleBuild && (
          <button onClick={reset} className="btn-ghost">
            Try again
          </button>
        )}
      </div>
      {error?.digest && <p className="font-mono text-[10px] text-muted mt-6">ref {error.digest}</p>}
    </div>
  );
}
