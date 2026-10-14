// Reading SBP's Market Treasury Bill auction results from the press report of
// each auction (Mettis Global posts SBP's figures the same evening: each
// tenor's cut-off yield and, since 2026, a table against the auction
// before). SBP's own pages refuse our machines. Pure, so
// scripts/test-tbill-auctions.ts runs it.

export type Auction = {
  date: string; // the auction, yyyy-mm-dd
  m1: number | null;
  m3: number | null;
  m6: number | null;
  m12: number | null;
  source: string; // the report it was read from
  own: boolean; // read from the auction's own report, not a later one's comparison
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

export function htmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A report of an auction of T-bills (MTBs), alone or with bonds; not a
// calendar of auctions to come, and not a bond- or sukuk-only auction.
export function isAuctionLink(slug: string): boolean {
  return /(^|-)(mtbs?|t-?bills?)(-|$)/i.test(slug) && /(^|-)auctions?(-|$)/i.test(slug);
}

// "08-Jul-26" or "8-Jul-2026".
function shortDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(Number(m[1]))}`;
}

// "July 8, 2026".
function longDate(s: string): string | null {
  const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
  const mo = m ? MONTHS[m[1].slice(0, 3).toLowerCase()] : undefined;
  return m && mo ? `${m[3]}-${pad(mo)}-${pad(Number(m[2]))}` : null;
}

const ok = (v: number | null) => (v != null && v >= 3 && v <= 40 ? v : null);
const TENORS = [
  ["m1", "1-Month"],
  ["m3", "3-Month"],
  ["m6", "6-Month"],
  ["m12", "12-Month"],
] as const;

// The auctions a report gives: its own, and the one before where it shows
// the comparison. `published` is the report's time (ISO); `source` its URL.
export function parseAuction(text: string, published: string | null, source: string): Auction[] {
  // Mettis stamps Karachi time with a Z, so the date part is the local day.
  const pub = published && /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : null;
  const own: Auction = { date: "", m1: null, m3: null, m6: null, m12: null, source, own: true };
  let previous: Auction | null = null;

  // The comparison table: "Tenor 08-Jul-26 23-Jun-26 Change (bps) 1-Month 11.3968% 11.7997% ...".
  const cmp = text.match(/Tenor\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+Change/i);
  if (cmp && cmp.index != null) {
    const block = text.slice(cmp.index, cmp.index + 600);
    previous = { date: shortDate(cmp[2]) ?? "", m1: null, m3: null, m6: null, m12: null, source, own: false };
    own.date = shortDate(cmp[1]) ?? "";
    for (const [k, label] of TENORS) {
      const m = block.match(new RegExp(`${label}\\s+(\\d+(?:\\.\\d+)?)%\\s+(?:(\\d+(?:\\.\\d+)?)%)?`, "i"));
      if (!m) continue;
      own[k] = ok(Number(m[1]));
      previous[k] = m[2] != null ? ok(Number(m[2])) : null;
    }
  }
  // The accepted bids' table: "Cut-off Yield Weighted Avg Yield 1-Month 35 11.3968% 11.3917% ...".
  if (own.m12 == null) {
    const acc = text.match(/Cut-?off Yield\s+Weighted Avg(?:\.|erage)? Yield/i);
    if (acc && acc.index != null) {
      const block = text.slice(acc.index, acc.index + 600);
      for (const [k, label] of TENORS) {
        const m = block.match(new RegExp(`${label}\\s+[\\d,.]+\\s+(\\d+(?:\\.\\d+)?)%`, "i"));
        if (m) own[k] = ok(Number(m[1]));
      }
    }
  }
  // Prose: "... and 10.9274% (-2bps) for 12 months."
  if (own.m12 == null) {
    const words: Record<string, string> = { m1: "(?:one|1)[- ]months?", m3: "(?:three|3)[- ]months?", m6: "(?:six|6)[- ]months?", m12: "(?:twelve|12)[- ]months?" };
    for (const [k] of TENORS) {
      const m = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)%\\s*(?:\\([^)]{0,20}\\))?\\s*for\\s+(?:the\\s+)?${words[k]}`, "i"));
      if (m) own[k] = ok(Number(m[1]));
    }
  }
  // Prose: "Cut-off yields for 1, 3, 6, and 12 months were 11.09% (-1bps), 11.05% (-10bps), 10.97% (-22bps), and 10.95% (-25bps)".
  if (own.m12 == null) {
    const m = text.match(/yields?\s+for\s+((?:\d+,?\s*(?:and\s+)?)+)months?\s+(?:were|stood at)\s+((?:\d+(?:\.\d+)?%\s*(?:\([^)]{0,20}\))?,?\s*(?:and\s+)?){2,4})/i);
    if (m) {
      const tenors = (m[1].match(/\d+/g) ?? []).map(Number);
      const vals = (m[2].match(/\d+(?:\.\d+)?(?=%)/g) ?? []).map(Number);
      tenors.forEach((t, i) => {
        const k = t === 1 ? "m1" : t === 3 ? "m3" : t === 6 ? "m6" : t === 12 ? "m12" : null;
        if (k && vals[i] != null) own[k] = ok(vals[i]);
      });
    }
  }
  if (own.m12 == null && own.m3 == null && own.m6 == null) return [];

  // The day: as the report gives it, else the comparison's, else the day it
  // was published (they go out the evening of the auction).
  const dealers = text.match(/Primary Dealers on\s+([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/i);
  own.date = (dealers ? longDate(dealers[1]) : null) ?? (own.date || pub || "");
  if (!own.date || (pub && (own.date > pub || Date.parse(pub) - Date.parse(own.date) > 10 * 86400000))) {
    if (!pub) return [];
    own.date = pub;
  }
  const out = [own];
  if (previous && previous.date && previous.date < own.date && (previous.m12 != null || previous.m3 != null)) out.push(previous);
  return out;
}

// Keeps one auction a day: its own report wins over a later one's comparison.
export function mergeAuctions(kept: Auction[], found: Auction[]): Auction[] {
  const byDate = new Map(kept.map((a) => [a.date, a]));
  for (const a of found) {
    const cur = byDate.get(a.date);
    if (!cur || (a.own && !cur.own)) byDate.set(a.date, a);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// The last auction on or before a day, within `maxDays` of it.
export function auctionOn(auctions: Auction[], date: string, maxDays = 21): Auction | null {
  let best: Auction | null = null;
  for (const a of auctions) if (a.date <= date && a.m12 != null && (!best || a.date > best.date)) best = a;
  return best && Date.parse(date) - Date.parse(best.date) <= maxDays * 86400000 ? best : null;
}
