"use client";

// Last-resort boundary: catches errors thrown in the root layout itself, where
// app/error.tsx can't reach. Must render its own <html>/<body>. Same
// self-healing rule as error.tsx: a stale-build chunk failure reloads once.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const isStaleBuild =
    typeof error !== "undefined" &&
    /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(
      `${error?.name ?? ""} ${error?.message ?? ""}`
    );
  if (isStaleBuild && typeof window !== "undefined" && sessionStorage.getItem("psx-stale-reload") !== "1") {
    sessionStorage.setItem("psx-stale-reload", "1");
    window.location.reload();
  }
  return (
    <html>
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "80px 24px" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>{isStaleBuild ? "New version available." : "Something went wrong."}</h1>
        <p style={{ fontSize: 13, color: "#777", marginBottom: 24 }}>
          {isStaleBuild ? "The app was updated while this tab was open." : "Your data is untouched."}
        </p>
        <button onClick={() => window.location.reload()} style={{ padding: "8px 16px", border: "1px solid #222", background: "none", cursor: "pointer" }}>
          Reload
        </button>
        {error?.digest && <p style={{ fontFamily: "monospace", fontSize: 10, color: "#999", marginTop: 24 }}>ref {error.digest}</p>}
      </body>
    </html>
  );
}
