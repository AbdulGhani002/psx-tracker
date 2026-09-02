// PSX market-watch: one request lists every symbol with its sector code and the
// indices it's listed in ("LISTED IN" column). We use it to derive index
// membership per holding — no paid feed needed. Cached in-process (market-wide,
// changes slowly).

const URL = "https://dps.psx.com.pk/market-watch";
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";

// Columns (observed live): SYMBOL | SECTOR(code) | LISTED IN | LDCP | OPEN |
// HIGH | LOW | CURRENT | CHANGE | CHANGE% | VOLUME. We keep the membership +
// the CURRENT price (LDCP as fallback) so sector market-cap weights can be
// computed without a second request per symbol.
export type MarketRow = {
  symbol: string;
  sectorCode: string;
  listedIn: string[];
  price: number; // CURRENT, falling back to LDCP; 0 when unavailable
  // The day's move, kept so market breadth can be counted without a second
  // request. changePct is null when the row gave no usable close, which is not
  // the same as a flat day and must not be counted as one.
  changePct: number | null;
  volume: number;
};

function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function parseMarketWatch(html: string): Map<string, MarketRow> {
  const out = new Map<string, MarketRow>();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const tr of rows) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(strip);
    if (cells.length < 3) continue;
    const symbol = cells[0].toUpperCase();
    if (!/^[A-Z0-9.&-]{1,12}$/.test(symbol)) continue; // skip header/pager rows
    const current = num(cells[7]);
    const ldcp = num(cells[3]);
    // Derived from LDCP rather than read from the CHANGE% column, because that
    // column arrives with stray signs and percent marks and a symbol that has
    // not traded shows a change against nothing.
    const changePct = current > 0 && ldcp > 0 ? ((current - ldcp) / ldcp) * 100 : null;
    out.set(symbol, {
      symbol,
      sectorCode: cells[1],
      listedIn: cells[2].split(",").map((s) => s.trim()).filter(Boolean),
      price: current > 0 ? current : ldcp,
      changePct,
      volume: num(cells[10]),
    });
  }
  return out;
}

// Whether a market-watch row belongs to a given index, tolerant of the token's
// punctuation/casing ("KSE100", "kse-100", ...).
export function isInIndex(row: MarketRow, indexCode: string): boolean {
  const want = indexCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return row.listedIn.some((t) => t.toUpperCase().replace(/[^A-Z0-9]/g, "") === want);
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
