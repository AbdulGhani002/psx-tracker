// PSX market-watch: one request lists every symbol with its sector code and the
// indices it's listed in ("LISTED IN" column). We use it to derive index
// membership per holding — no paid feed needed. Cached in-process (market-wide,
// changes slowly).

const URL = "https://dps.psx.com.pk/market-watch";
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";

export type MarketRow = { symbol: string; sectorCode: string; listedIn: string[] };

function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMarketWatch(html: string): Map<string, MarketRow> {
  const out = new Map<string, MarketRow>();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const tr of rows) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(strip);
    if (cells.length < 3) continue;
    const symbol = cells[0].toUpperCase();
    if (!/^[A-Z0-9.&-]{1,12}$/.test(symbol)) continue; // skip header/pager rows
    out.set(symbol, {
      symbol,
      sectorCode: cells[1],
      listedIn: cells[2].split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  return out;
}

let cache: { at: number; data: Map<string, MarketRow> } | null = null;
const TTL = 6 * 60 * 60 * 1000; // 6h

export async function fetchMarketWatch(): Promise<Map<string, MarketRow> | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  try {
    const res = await fetch(URL, { headers: { "user-agent": UA, accept: "text/html" }, cache: "no-store" });
    if (!res.ok) return cache?.data ?? null;
    const data = parseMarketWatch(await res.text());
    if (data.size > 0) cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? null;
  }
}

// Friendly names for the common PSX index codes.
const INDEX_NAMES: Record<string, string> = {
  KSE100: "KSE-100",
  KSE30: "KSE-30",
  KMI30: "KMI-30",
  KMIALLSHR: "KMI All-Share",
  ALLSHR: "KSE All-Share",
  ACI: "All-Cap",
  BKTi: "Banking",
  JSMFI: "JS Momentum",
  NITPGI: "NIT-Pakistan Gateway",
  UPP9: "UPP-9",
  NBPPGI: "NBP-Pakistan Growth",
};

export function indexLabel(code: string): string {
  return INDEX_NAMES[code] ?? INDEX_NAMES[code.toUpperCase()] ?? code;
}
