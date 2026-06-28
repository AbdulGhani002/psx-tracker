import "server-only";

// USD/PKR rate for showing dollar equivalents next to the PKR figures. Two free,
// no-key sources with a fallback; cached 6h via the fetch cache. Returns null if
// both fail or the value looks wrong — the UI then simply hides the USD line
// rather than ever showing a fabricated rate.
const PRIMARY = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";
const FALLBACK = "https://open.er-api.com/v6/latest/USD";

function sane(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 50 && v < 2000 ? v : null;
}

export async function getUsdPkr(): Promise<number | null> {
  try {
    const r = await fetch(PRIMARY, { next: { revalidate: 21600 }, signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const v = sane((await r.json())?.usd?.pkr);
      if (v) return v;
    }
  } catch {
    /* fall through */
  }
  try {
    const r = await fetch(FALLBACK, { next: { revalidate: 21600 }, signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const v = sane((await r.json())?.rates?.PKR);
      if (v) return v;
    }
  } catch {
    /* give up — caller hides the USD line */
  }
  return null;
}
