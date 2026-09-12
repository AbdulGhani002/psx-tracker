// Fetches daily end-of-day series from dps.psx.com.pk/timeseries/eod/{SYMBOL}.
// Works for both stock symbols and indices (KSE100, KMI30, etc.).
// Response: { status: 1, data: [[unix_ts_seconds, close, volume, vwap], ...] }

const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";

export type EodPoint = { date: string; close: number };

export async function fetchEodSeries(symbolOrIndex: string): Promise<EodPoint[]> {
  const url = `https://dps.psx.com.pk/timeseries/eod/${encodeURIComponent(symbolOrIndex)}`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const body = await res.json();
  if (!body || body.status !== 1 || !Array.isArray(body.data)) return [];

  const out: EodPoint[] = [];
  for (const row of body.data as unknown[]) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const ts = Number(row[0]);
    const close = Number(row[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    const d = new Date(ts * 1000);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, close });
  }
  // Sort ascending by date.
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// The same feed with the columns the price series drops: volume and VWAP.
// Charts want volume; the close-only series stays as it is because everything
// else in the app is built on it.
export type EodBar = { date: string; close: number; volume: number; vwap: number };

export async function fetchEodBars(symbolOrIndex: string): Promise<EodBar[]> {
  const url = `https://dps.psx.com.pk/timeseries/eod/${encodeURIComponent(symbolOrIndex)}`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const body = await res.json();
  if (!body || body.status !== 1 || !Array.isArray(body.data)) return [];
  const out: EodBar[] = [];
  for (const row of body.data as unknown[]) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const ts = Number(row[0]);
    const close = Number(row[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue;
    const volume = Number(row[2]);
    const vwap = Number(row[3]);
    out.push({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close,
      volume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
      vwap: Number.isFinite(vwap) && vwap > 0 ? vwap : close,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Fetch many in parallel with limited concurrency.
export async function fetchManyEod(
  symbols: string[],
  concurrency = 4
): Promise<Map<string, EodPoint[]>> {
  const out = new Map<string, EodPoint[]>();
  const queue = [...symbols];
  async function worker() {
    while (queue.length > 0) {
      const s = queue.shift();
      if (!s) return;
      try {
        out.set(s, await fetchEodSeries(s));
      } catch {
        out.set(s, []);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  return out;
}
