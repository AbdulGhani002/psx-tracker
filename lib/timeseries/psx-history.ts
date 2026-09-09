// The PSX data portal's historical closing sheet: one POST per trading day
// returns OPEN HIGH LOW CLOSE and VOLUME for every listed name, back to 2002.
// This is the only public source of the market's full daily history, and it
// carries the names that were later delisted, which the live five-year EOD
// feed cannot show.

export type DayRow = [symbol: string, open: number, high: number, low: number, close: number, volume: number, ldcp: number];

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const num = (s: string | undefined) => {
  if (!s) return 0;
  const n = Number(s.replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

// Columns: SYMBOL LDCP OPEN HIGH LOW CLOSE CHANGE CHANGE% VOLUME.
export function parseHistoricalDay(html: string): DayRow[] {
  const out: DayRow[] = [];
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const tr of trs) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(strip);
    if (cells.length < 9) continue;
    const symbol = cells[0].toUpperCase();
    // Plain equities only: futures and other contract lines carry a hyphen.
    if (!/^[A-Z][A-Z0-9]{1,11}$/.test(symbol)) continue;
    const close = num(cells[5]);
    if (!(close > 0)) continue;
    out.push([symbol, num(cells[2]), num(cells[3]), num(cells[4]), close, num(cells[8]), num(cells[1])]);
  }
  return out;
}

export async function fetchHistoricalDay(date: string, attempts = 4): Promise<DayRow[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch("https://dps.psx.com.pk/historical", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (compatible; psx-tracker/0.1)" },
        body: `date=${date}`,
        cache: "no-store",
      });
      if (res.ok) return parseHistoricalDay(await res.text());
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return [];
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error("gave up on " + date);
}

export function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
