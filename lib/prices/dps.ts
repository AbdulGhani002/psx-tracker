import { connectDb } from "@/lib/db";
import { FeedSnapshotModel } from "@/lib/models/FeedSnapshot";

// Every request to the exchange's site (dps.psx.com.pk) goes through here, on
// the server and on the home machine alike, so the site is asked as little
// and as gently as possible:
//   the server asks the site itself first; only when the site refuses it, or
//   while the gate rests, is a page the home machine fetched and pushed
//   (scripts/dps-push.ts, through /api/cron/dps-relay) within the last 26
//   hours used instead (on the server, where the database is);
//   requests go one at a time, 3 to 9 seconds apart, chosen at random each
//   time;
//   once the site refuses (the connection closed on us, 403, 429), nothing is
//   asked of it for 2 to 4 hours, chosen at random and remembered across
//   restarts.
// Every request carries the app's own name (DPS_UA): it is never dressed up
// as a browser or as someone else.

export const DPS_ORIGIN = "https://dps.psx.com.pk";
export const DPS_UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";
export const RELAY_PREFIX = "dps:page:";
const REFUSED_KEY = "dps:refused";
const RELAY_MAX_AGE_MS = 26 * 3600_000;

const range = (env: string | undefined, dflt: [number, number]): [number, number] => {
  const v = (env ?? "").split(",").map(Number);
  return v.length === 2 && v.every((x) => Number.isFinite(x) && x >= 0) ? [v[0], v[1]] : dflt;
};
const GAP_MS = range(process.env.DPS_GAP_MS, [3000, 9000]);
const REST_MS = range(process.env.DPS_REST_MS, [2 * 3600_000, 4 * 3600_000]);
export const between = ([lo, hi]: [number, number], rnd: () => number = Math.random) => lo + rnd() * (hi - lo);
const withDb = () => !!process.env.MONGODB_URI && process.env.DPS_NO_DB !== "1";

export class DpsRefused extends Error {
  constructor(until: number) {
    super(`the exchange refused us; resting until ${new Date(until).toISOString()}`);
    this.name = "DpsRefused";
  }
}

let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;
let restUntil = 0;
let restRead = false;

async function readRest(): Promise<void> {
  if (restRead || !withDb()) return;
  restRead = true;
  try {
    await connectDb();
    const d: any = await FeedSnapshotModel.findOne({ key: REFUSED_KEY }).lean();
    const t = d?.data?.until ? Date.parse(d.data.until) : 0;
    if (t > restUntil) restUntil = t;
  } catch {
    /* in memory only */
  }
}

async function rest(reason: string): Promise<void> {
  restUntil = Date.now() + between(REST_MS);
  if (!withDb()) return;
  try {
    await connectDb();
    await FeedSnapshotModel.findOneAndUpdate(
      { key: REFUSED_KEY },
      { key: REFUSED_KEY, data: { until: new Date(restUntil).toISOString(), reason, at: new Date().toISOString() }, status: "refused", note: reason.slice(0, 160), updatedAt: new Date() },
      { upsert: true }
    );
  } catch {
    /* in memory only */
  }
}

// Whether the gate is resting, and until when.
export async function dpsResting(): Promise<{ until: string } | null> {
  await readRest();
  return Date.now() < restUntil ? { until: new Date(restUntil).toISOString() } : null;
}

// A page the home machine pushed, while it is under `maxAgeMs` old.
export async function relayedPage(path: string, maxAgeMs = RELAY_MAX_AGE_MS): Promise<string | null> {
  if (!withDb()) return null;
  try {
    await connectDb();
    const d: any = await FeedSnapshotModel.findOne({ key: RELAY_PREFIX + path }, { data: 1 }).lean();
    const at = d?.data?.fetchedAt ? Date.parse(d.data.fetchedAt) : 0;
    return d?.data?.html && Date.now() - at < maxAgeMs ? String(d.data.html) : null;
  } catch {
    return null;
  }
}

// Pages the home machine fetched, by path ("/company/MEBL", "/indices").
export async function keepRelayedPages(pages: Record<string, { html: string; fetchedAt: string }>): Promise<number> {
  await connectDb();
  let n = 0;
  for (const [path, p] of Object.entries(pages)) {
    if (!path.startsWith("/") || typeof p?.html !== "string" || !p.html) continue;
    await FeedSnapshotModel.findOneAndUpdate(
      { key: RELAY_PREFIX + path },
      { key: RELAY_PREFIX + path, data: { html: p.html, fetchedAt: p.fetchedAt }, status: "ok", note: `relayed, ${Math.round(p.html.length / 1024)} KB`, updatedAt: new Date() },
      { upsert: true }
    );
    n++;
  }
  return n;
}

// One request to the site, in turn: the site itself first, and the home
// machine's copy of the page when the site refuses, fails or the gate rests.
// A refusal rests the gate; a page that is not there (404) or a slow answer
// does not. `relay: false` for what the home machine never pushes (posts,
// files).
export async function dpsFetch(url: string, init: RequestInit = {}, o: { relay?: boolean; timeoutMs?: number } = {}): Promise<Response> {
  const full = url.startsWith("http") ? url : DPS_ORIGIN + url;
  const path = full.startsWith(DPS_ORIGIN) ? full.slice(DPS_ORIGIN.length) : full;
  const method = (init.method ?? "GET").toUpperCase();
  const relayed = async (): Promise<Response | null> => {
    if (o.relay === false || method !== "GET") return null;
    const html = await relayedPage(path);
    return html != null ? new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-dps-relay": "1" } }) : null;
  };
  await readRest();
  if (Date.now() < restUntil) {
    const r = await relayed();
    if (r) return r;
    throw new DpsRefused(restUntil);
  }
  try {
    const res = await direct(full, path, init, o.timeoutMs);
    if (res.status === 403 || res.status === 429) return (await relayed()) ?? res;
    return res;
  } catch (e) {
    const r = await relayed();
    if (r) return r;
    throw e;
  }
}

function direct(full: string, path: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  const run = chain.then(async () => {
    const wait = lastAt + between(GAP_MS) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (Date.now() < restUntil) throw new DpsRefused(restUntil);
    try {
      const { signal: _ignored, ...rest0 } = init;
      const res = await fetch(full, {
        ...rest0,
        headers: { ...(init.headers as Record<string, string> | undefined), "user-agent": DPS_UA },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs ?? 20000),
      });
      if (res.status === 403 || res.status === 429) await rest(`HTTP ${res.status} on ${path}`);
      return res;
    } catch (e) {
      if (!(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))) await rest(`${String(e instanceof Error ? e.message : e).slice(0, 80)} on ${path}`);
      throw e;
    } finally {
      lastAt = Date.now();
    }
  });
  chain = run.catch(() => undefined);
  return run;
}
