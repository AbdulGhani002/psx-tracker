// Daily mutual-fund NAVs from MUFAP (Mutual Funds Association of Pakistan).
// Verified source: https://mufap.com.pk/WebPost/WebPostById?title=Open-FundScheme
// Each fund renders as a card:
//   <h3 class="card-title">Alhamra Cash Management Optimizer</h3>
//   <span>MCB Investment Management Limited</span>   (the AMC)
//   <p id="netval" ...>109.82</p> <p>NAV</p>
// We parse those into { name, amc, nav }.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const MUFAP_URL = "https://mufap.com.pk/WebPost/WebPostById?title=Open-FundScheme";

export type FundNav = { name: string; amc: string; nav: number };

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMufap(html: string): FundNav[] {
  const out: FundNav[] = [];
  // Split on each fund card title; everything up to the next card-title is one fund.
  const parts = html.split(/<h3[^>]*class="card-title"[^>]*>/i);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const nameMatch = block.match(/^([^<]+)</);
    if (!nameMatch) continue;
    const name = decode(nameMatch[1]);
    if (!name) continue;

    // AMC: first <span> after the title.
    const amcMatch = block.match(/<span[^>]*>([^<]+)<\/span>/i);
    const amc = amcMatch ? decode(amcMatch[1]) : "";

    // NAV: first <p id="netval" ...>NUMBER</p> in this block.
    const navMatch = block.match(/id="netval"[^>]*>\s*([\d,]+\.?\d*)\s*</i);
    if (!navMatch) continue;
    const nav = Number(navMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(nav) || nav <= 0) continue;

    out.push({ name, amc, nav });
  }
  return out;
}

let cache: { at: number; data: FundNav[] } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // NAVs update once per business day

export async function fetchAllNavs(force = false): Promise<FundNav[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetch(MUFAP_URL, {
      headers: { "user-agent": UA, accept: "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return cache?.data ?? [];
    const html = await res.text();
    const data = parseMufap(html);
    if (data.length > 0) cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? [];
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Find a fund by (fuzzy) name. Returns the best contains/word-overlap match.
export async function findNav(query: string): Promise<FundNav | null> {
  const all = await fetchAllNavs();
  if (all.length === 0) return null;
  const q = norm(query);
  if (!q) return null;

  // Exact normalised match first.
  const exact = all.find((f) => norm(f.name) === q);
  if (exact) return exact;

  // Otherwise best word-overlap score.
  const qWords = q.split(" ").filter((w) => w.length > 2);
  let best: { f: FundNav; score: number } | null = null;
  for (const f of all) {
    const fn = norm(f.name);
    let score = 0;
    for (const w of qWords) if (fn.includes(w)) score += w.length;
    if (fn.includes(q) || q.includes(fn)) score += 10;
    if (!best || score > best.score) best = { f, score };
  }
  return best && best.score >= 6 ? best.f : null;
}

export async function searchNavs(query: string, limit = 12): Promise<FundNav[]> {
  const all = await fetchAllNavs();
  const q = norm(query);
  if (!q) return all.slice(0, limit);
  const qWords = q.split(" ").filter((w) => w.length > 1);
  return all
    .map((f) => {
      const fn = norm(f.name);
      let score = 0;
      for (const w of qWords) if (fn.includes(w)) score += w.length;
      if (fn.includes(q)) score += 5;
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f);
}
