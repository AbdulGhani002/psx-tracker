// Live money-market rates published by the State Bank of Pakistan.
//
// Source: https://www.sbp.org.pk/ecodata/rates/tbill/tbill.asp
// Public HTML, no auth and no captcha. Every field here is a number SBP PRINTS —
// nothing is derived, assumed or back-filled. If a field can't be parsed or fails
// its sanity bound we return null so callers can say "needs a feed" rather than
// show a made-up number.
//
// Why this exists: the policy rate used to be a hand-curated table with future
// entries marked "illustrative". Those placeholders went live and silently drove
// required return, intrinsic value and buy-zone alerts. Now the current rate is
// fetched, and the corridor (floor/ceiling sit 100bp either side of the policy
// rate) gives us a free cross-check that we parsed the right cell.

const SBP_URL = "https://www.sbp.org.pk/ecodata/rates/tbill/tbill.asp";

export type Kibor = { tenor: string; bid: number; offer: number };
export type Cutoff = { tenor: string; yieldPct: number };

export type SbpRates = {
  policyRatePct: number | null;
  repoCeilingPct: number | null; // policy +100bp
  repoFloorPct: number | null; // policy -100bp
  overnightRepoPct: number | null;
  kibor: Kibor[];
  mtbCutoffs: Cutoff[]; // Market Treasury Bills — the real "T-bill rate"
  pibCutoffs: Cutoff[]; // Pakistan Investment Bonds
  usdPkrM2M: number | null; // SBP's official mark-to-market revaluation rate
  fetchedAt: string; // ISO datetime we fetched
  sourceUrl: string;
};

// Strip tags/entities down to one normalised line of text.
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A published percentage, or null. Pakistan's policy rate has ranged ~7-22%,
// so anything outside 0-50 means we grabbed the wrong cell — refuse it.
function pct(m: RegExpMatchArray | null, idx = 1, lo = 0, hi = 50): number | null {
  if (!m) return null;
  const v = Number(m[idx]);
  return Number.isFinite(v) && v > lo && v < hi ? v : null;
}

export function parseSbpRates(html: string): SbpRates {
  const t = toText(html);

  const policyRatePct = pct(t.match(/SBP\s+Policy\s+Rate\s+([\d.]+)\s*%/i));
  const repoCeilingPct = pct(t.match(/Ceiling\)?\s*Rate\s+([\d.]+)\s*%/i));
  const repoFloorPct = pct(t.match(/\(?\s*Floor\s*\)?\s*Rate\s+([\d.]+)\s*%/i));
  const overnightRepoPct = pct(t.match(/overnight\s+repo\s+rate[^%]*?([\d.]+)\s*%/i));
  const usdRaw = t.match(/M2M\s+Revaluation\s+Rate\s+([\d.]+)/i);
  const usd = usdRaw ? Number(usdRaw[1]) : NaN;
  // PKR has never been stronger than ~50/USD; bound it so a mis-parse can't
  // silently rescale every USD figure in the app.
  const usdPkrM2M = Number.isFinite(usd) && usd > 50 && usd < 2000 ? usd : null;

  // KIBOR block: "Tenor BID Offer 3-M 11.37 11.62 6-M 11.39 11.64 12-M 11.4 11.9"
  const kibor: Kibor[] = [];
  const kiborBlock = t.match(/KIBOR[\s\S]{0,400}?(?=Upcoming|USD|Cut-off|$)/i);
  if (kiborBlock) {
    const re = /(\d{1,2})-M\s+([\d.]+)\s+([\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(kiborBlock[0]))) {
      const bid = Number(m[2]);
      const offer = Number(m[3]);
      if (bid > 0 && bid < 50 && offer > 0 && offer < 50) {
        kibor.push({ tenor: `${m[1]}M`, bid, offer });
      }
    }
  }

  // Cut-off yields come in labelled blocks; scope each regex to its own block so
  // MTB tenors can't bleed into the PIB list.
  function cutoffs(block: RegExpMatchArray | null, unit: "M" | "Y"): Cutoff[] {
    if (!block) return [];
    const out: Cutoff[] = [];
    const re = unit === "M" ? /(\d{1,2})-M\s+([\d.]+)\s*%/g : /(\d{1,2})-Y\s+([\d.]+)\s*%/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block[0]))) {
      const v = Number(m[2]);
      if (v > 0 && v < 50) out.push({ tenor: `${m[1]}${unit}`, yieldPct: v });
    }
    return out;
  }

  const mtbCutoffs = cutoffs(t.match(/MTBs[\s\S]{0,300}?(?=Fixed|Floating|GIS|$)/i), "M");
  const pibCutoffs = cutoffs(t.match(/Fixed\s*-\s*Rate\s+PIB[\s\S]{0,320}?(?=Floating|GIS|$)/i), "Y");

  return {
    policyRatePct,
    repoCeilingPct,
    repoFloorPct,
    overnightRepoPct,
    kibor,
    mtbCutoffs,
    pibCutoffs,
    usdPkrM2M,
    fetchedAt: new Date().toISOString(),
    sourceUrl: SBP_URL,
  };
}

// SBP prints the corridor 100bp either side of the policy rate. If that identity
// doesn't hold we parsed something wrong — better to admit it than to publish a
// confidently wrong rate into required-return and buy-zone maths.
export function corridorAgrees(r: SbpRates): boolean {
  if (r.policyRatePct == null || r.repoCeilingPct == null || r.repoFloorPct == null) return false;
  return (
    Math.abs(r.repoCeilingPct - (r.policyRatePct + 1)) < 0.26 &&
    Math.abs(r.repoFloorPct - (r.policyRatePct - 1)) < 0.26
  );
}

export async function fetchSbpRates(): Promise<SbpRates | null> {
  try {
    const res = await fetch(SBP_URL, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const parsed = parseSbpRates(await res.text());
    // The policy rate is the one field the app cannot fake. No rate → no data.
    if (parsed.policyRatePct == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

// The T-bill rate a saver actually earns: the 12-month MTB cut-off, else the
// longest published MTB tenor. Returns null when SBP published none.
export function tbill12mPct(r: SbpRates | null): number | null {
  if (!r || r.mtbCutoffs.length === 0) return null;
  const m12 = r.mtbCutoffs.find((c) => c.tenor === "12M");
  if (m12) return m12.yieldPct;
  return r.mtbCutoffs.reduce((a, b) => (Number(a.tenor.replace(/\D/g, "")) > Number(b.tenor.replace(/\D/g, "")) ? a : b)).yieldPct;
}
