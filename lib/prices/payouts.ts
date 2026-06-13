// Authoritative dividend / payout history from the PSX data portal.
//
// The company page loads payouts client-side via POST https://dps.psx.com.pk/payouts
// with form body `symbol=XXXX`, returning an HTML table fragment:
//   Symbol | Company | Sector | Dividend Announcement | Date/Time of Announcement | Book Closure Date
//   AHCL   | ...      | ...    | 100%(F) (D)           | September 23, 2025 3:48 PM | 17/10/2025 - 24/10/2025
//
// The "Dividend Announcement" cell encodes the rate as a % of face value plus
// markers: (F)=Final, (i)/(ii)/(iii)=interim quarters; (D)=cash Dividend,
// (B)=Bonus, (R)=Right. We keep cash dividends for income forecasting.

const URL = "https://dps.psx.com.pk/payouts";
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";

export type PsxPayout = {
  pctOfFace: number; // e.g. 100 means 100% of face value
  cycle: string; // F | i | ii | iii | "" (final vs interim)
  payoutType: "cash" | "bonus" | "right" | "other";
  announceDate: string | null; // ISO date
  bookClosureStart: string | null; // ISO date
};

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function ddmmyyyyToIso(s: string): string | null {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function announceToIso(s: string): string | null {
  // "September 23, 2025 3:48 PM" -> ISO date (time dropped)
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };
  const mm = months[m[1].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${String(Number(m[2])).padStart(2, "0")}`;
}

function parseAnnouncement(raw: string): { pctOfFace: number; cycle: string; payoutType: PsxPayout["payoutType"] } | null {
  const text = decode(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const pctM = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!pctM) return null;
  const pctOfFace = Number(pctM[1]);
  const tokens = [...text.matchAll(/\(([^)]+)\)/g)].map((t) => t[1].trim());
  let cycle = "";
  let payoutType: PsxPayout["payoutType"] = "other";
  for (const t of tokens) {
    const u = t.toUpperCase();
    if (/^(F|I{1,3})$/.test(u)) cycle = u === "F" ? "F" : u.toLowerCase();
    else if (u === "D") payoutType = "cash";
    else if (u === "B") payoutType = "bonus";
    else if (u === "R") payoutType = "right";
  }
  // Many cash dividends only carry the cycle marker; default to cash unless
  // explicitly bonus/right.
  if (payoutType === "other" && (cycle || /div/i.test(text))) payoutType = "cash";
  return { pctOfFace, cycle, payoutType };
}

export function parsePayouts(html: string): PsxPayout[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const out: PsxPayout[] = [];
  for (const tr of rows) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map((c) => c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (cells.length < 6) continue; // header / pager rows
    const ann = parseAnnouncement(cells[3]);
    if (!ann) continue;
    out.push({
      pctOfFace: ann.pctOfFace,
      cycle: ann.cycle,
      payoutType: ann.payoutType,
      announceDate: announceToIso(cells[4]),
      bookClosureStart: ddmmyyyyToIso(cells[5]),
    });
  }
  return out;
}

export async function fetchPayouts(symbol: string): Promise<PsxPayout[] | null> {
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
        accept: "text/html, */*",
      },
      body: `symbol=${encodeURIComponent(symbol.toUpperCase())}`,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parsePayouts(await res.text());
  } catch {
    return null;
  }
}
