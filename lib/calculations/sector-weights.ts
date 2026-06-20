// Sector market-cap weights and a portfolio-vs-index comparison.
//
// Given each constituent's market cap and sector, we roll them up into sector
// shares of the whole index (KSE-100). Comparing those to YOUR own sector mix
// shows where you are over- or under-weight relative to the market — the same
// lens an index fund manager uses, built from free PSX data.

export type SectorMember = {
  symbol: string;
  sector: string;
  marketCap: number; // price × shares outstanding, in rupees
};

export type SectorWeight = {
  sector: string;
  marketCap: number;
  weightPct: number; // share of the priced universe
  members: number;
};

// Normalise a sector name so "Commercial Banks", "COMMERCIAL BANKS" and
// "commercial  banks" all collapse to one bucket.
export function sectorKey(name: string): string {
  return (name || "Unclassified").toUpperCase().replace(/&AMP;/g, "&").replace(/[^A-Z0-9&]+/g, " ").trim();
}

// Consistent Title Case for display ("OIL & GAS EXPLORATION COMPANIES" →
// "Oil & Gas Exploration Companies"), so index-only sectors match how holdings
// render regardless of how PSX cased the source string.
export function displaySector(name: string): string {
  const s = (name || "Unclassified").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().toLowerCase();
  return s.replace(/(^|\s|-|\/|&)([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

export function aggregateSectorWeights(members: SectorMember[]): SectorWeight[] {
  const buckets = new Map<string, { display: string; marketCap: number; members: number }>();
  for (const m of members) {
    if (!(m.marketCap > 0)) continue;
    const key = sectorKey(m.sector);
    const display = (m.sector || "Unclassified").trim();
    const b = buckets.get(key);
    if (b) {
      b.marketCap += m.marketCap;
      b.members += 1;
    } else {
      buckets.set(key, { display, marketCap: m.marketCap, members: 1 });
    }
  }
  const total = [...buckets.values()].reduce((s, b) => s + b.marketCap, 0);
  return [...buckets.values()]
    .map((b) => ({ sector: displaySector(b.display), marketCap: b.marketCap, weightPct: total > 0 ? (b.marketCap / total) * 100 : 0, members: b.members }))
    .sort((a, b) => b.weightPct - a.weightPct);
}

export type SectorComparison = {
  sector: string;
  yourPct: number;
  indexPct: number;
  diffPct: number; // yourPct − indexPct; positive = over-weight vs index
  yourValue: number;
};

// Join your sector exposure to the index's, on the normalised key. Sectors you
// hold but the index doesn't (and vice versa) still appear, with 0 on the
// missing side. Sorted by the size of your tilt.
export function compareSectors(
  yours: Array<{ sector: string; value: number }>,
  index: Array<{ sector: string; weightPct: number }>
): SectorComparison[] {
  const yourTotal = yours.reduce((s, y) => s + (y.value > 0 ? y.value : 0), 0);
  const yourByKey = new Map<string, { display: string; value: number }>();
  for (const y of yours) {
    if (!(y.value > 0)) continue;
    const k = sectorKey(y.sector);
    const cur = yourByKey.get(k);
    if (cur) cur.value += y.value;
    else yourByKey.set(k, { display: (y.sector || "Unclassified").trim(), value: y.value });
  }
  const idxByKey = new Map<string, { display: string; weightPct: number }>();
  for (const i of index) {
    const k = sectorKey(i.sector);
    const cur = idxByKey.get(k);
    if (cur) cur.weightPct += i.weightPct;
    else idxByKey.set(k, { display: (i.sector || "Unclassified").trim(), weightPct: i.weightPct });
  }

  const keys = new Set<string>([...yourByKey.keys(), ...idxByKey.keys()]);
  const out: SectorComparison[] = [];
  for (const k of keys) {
    const y = yourByKey.get(k);
    const i = idxByKey.get(k);
    const yourPct = yourTotal > 0 && y ? (y.value / yourTotal) * 100 : 0;
    const indexPct = i?.weightPct ?? 0;
    out.push({
      sector: displaySector(y?.display ?? i?.display ?? "Unclassified"),
      yourPct,
      indexPct,
      diffPct: yourPct - indexPct,
      yourValue: y?.value ?? 0,
    });
  }
  return out.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
}
