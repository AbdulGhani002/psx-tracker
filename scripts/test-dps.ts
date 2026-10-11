// The gate every request to the exchange's site goes through (lib/prices/dps).
//
//   npx tsx scripts/test-dps.ts

process.env.DPS_GAP_MS = "30,60";
process.env.DPS_REST_MS = "250,300";
process.env.DPS_NO_DB = "1";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { dpsFetch, DpsRefused, DPS_UA, between } = await import("../lib/prices/dps");
  const calls: Array<{ url: string; at: number; ua: string }> = [];
  let next: () => Promise<Response> = async () => new Response("ok", { status: 200 });
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), at: Date.now(), ua: init?.headers?.["user-agent"] });
    return next();
  }) as typeof fetch;

  check("a random gap within its range", [0, 0.5, 0.999].every((r) => { const v = between([3000, 9000], () => r); return v >= 3000 && v < 9000; }) && between([3000, 9000], () => 0.5) === 6000);

  const r1 = await dpsFetch("/company/MEBL", { headers: { "user-agent": "Something else" } });
  const r2 = await dpsFetch("https://dps.psx.com.pk/indices");
  check("relative paths go to the site; full addresses are kept", calls[0].url === "https://dps.psx.com.pk/company/MEBL" && calls[1].url === "https://dps.psx.com.pk/indices" && r1.ok && r2.ok);
  check("always the app's own name, whatever the caller sets", calls.every((c) => c.ua === DPS_UA), calls.map((c) => c.ua));
  check("one at a time, at least the shortest gap apart", calls[1].at - calls[0].at >= 30, calls[1].at - calls[0].at);

  const t0 = Date.now();
  await Promise.all([dpsFetch("/a"), dpsFetch("/b"), dpsFetch("/c")]);
  const last3 = calls.slice(-3).map((c) => c.at);
  check("asked together, they still go one after another", last3[1] - last3[0] >= 30 && last3[2] - last3[1] >= 30 && Date.now() - t0 >= 60, last3.map((t) => t - t0));

  next = async () => new Response("not here", { status: 404 });
  const nf = await dpsFetch("/download/mkt_summary/2026-10-10.Z", {}, { relay: false });
  next = async () => new Response("ok", { status: 200 });
  const after404 = await dpsFetch("/x");
  check("a page that is not there does not rest the gate", nf.status === 404 && after404.ok);

  next = async () => { throw new TypeError("fetch failed"); };
  let first: unknown = null;
  try { await dpsFetch("/company/BAHL"); } catch (e) { first = e; }
  const before = calls.length;
  let second: unknown = null;
  try { await dpsFetch("/company/FCCL"); } catch (e) { second = e; }
  check("a closed connection is passed on, and the gate rests", first instanceof TypeError && second instanceof DpsRefused);
  check("while it rests, nothing is asked", calls.length === before);

  await sleep(320);
  next = async () => new Response("ok", { status: 200 });
  const back = await dpsFetch("/company/FCCL");
  check("after the rest, it asks again", back.ok && calls.length === before + 1);

  next = async () => new Response("no", { status: 403 });
  const forbidden = await dpsFetch("/indices/KSE100");
  let afterForbidden: unknown = null;
  try { await dpsFetch("/indices/KMI30"); } catch (e) { afterForbidden = e; }
  check("a 403 is returned, and rests the gate", forbidden.status === 403 && afterForbidden instanceof DpsRefused);

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
