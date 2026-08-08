// Home-IP NAV relay: MUFAP blocks datacentre IPs (the VPS gets 403) but serves
// real browsers fine — so this script, run daily by Windows Task Scheduler on
// the user's PC, drives a throwaway headless Edge to mufap.com.pk, pulls the
// RAW fund-price HTML via a same-origin fetch inside the page (the rendered
// DOM virtualises down to ~30 cards; the server HTML carries all ~400 funds),
// gzips it (~38 KB), and POSTs it to the site's machine-only relay endpoint.
// The SERVER parses and validates — this script never computes a NAV.
//
// Config: tools/nav-relay.env (not committed) with
//   RELAY_URL=https://portfolio.apex-logic.net/api/funds/nav-relay
//   CRON_SECRET=...
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MUFAP_URL = "https://mufap.com.pk/WebPost/WebPostById?title=Open-FundScheme";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const PORT = 9377;

function loadEnv() {
  const p = join(here, "nav-relay.env");
  if (!existsSync(p)) throw new Error(`missing ${p} (RELAY_URL + CRON_SECRET)`);
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  if (!env.RELAY_URL || !env.CRON_SECRET) throw new Error("nav-relay.env needs RELAY_URL and CRON_SECRET");
  return env;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpEvaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws connect failed")); });
  try {
    const reply = new Promise((res, rej) => {
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id === 1) msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      };
    });
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true, timeout: 60000 } }));
    return await reply;
  } finally {
    ws.close();
  }
}

// One attempt: launch Edge (headless or windowed-offscreen), wait out any
// Cloudflare interstitial, extract the gzipped raw HTML.
async function extractHtmlGz(windowed) {
  const profile = mkdtempSync(join(tmpdir(), "psx-nav-relay-"));
  // Cloudflare challenges headless Chromium; a REAL window parked far
  // off-screen passes like any browser and is never seen.
  const modeArgs = windowed
    ? ["--window-position=-32000,-32000", "--window-size=400,400", "--no-startup-window-animation"]
    : ["--headless=new", "--disable-blink-features=AutomationControlled"];
  const edge = spawn(EDGE, [...modeArgs, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", MUFAP_URL], { stdio: "ignore" });
  try {
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(500);
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = list.find((t) => t.type === "page" && t.url.includes("mufap.com.pk"));
      } catch { /* devtools not up yet */ }
    }
    if (!target) throw new Error("MUFAP tab never appeared (blocked? offline?)");

    // Same-origin fetch of the raw server HTML, gzipped in-page, base64 out.
    // Retries ride out the Cloudflare interstitial (it self-clears in a real
    // browser within a few seconds).
    const expr = `(async () => {
      const t = await (await fetch(${JSON.stringify(MUFAP_URL)})).text();
      if (!t.includes("FundID=")) throw new Error("page has no fund rows: " + t.slice(0, 120));
      const buf = await new Response(new Blob([t]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    })()`;
    let lastErr = "";
    for (let i = 0; i < 14; i++) {
      try {
        const r = await cdpEvaluate(target.webSocketDebuggerUrl, expr);
        if (r.exceptionDetails) lastErr = r.exceptionDetails.exception?.description ?? "page exception";
        else return r.result.value;
      } catch (e) {
        lastErr = String(e);
      }
      await sleep(2500);
    }
    throw new Error(`could not extract HTML (${windowed ? "windowed" : "headless"}): ${lastErr}`);
  } finally {
    edge.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}

async function main() {
  if (!EDGE) throw new Error("msedge.exe not found");
  const env = loadEnv();

  let htmlGz;
  if (process.env.NAV_RELAY_WINDOWED === "1") {
    htmlGz = await extractHtmlGz(true);
  } else {
    try {
      htmlGz = await extractHtmlGz(false);
    } catch (e) {
      console.log(`${new Date().toISOString()} headless blocked (${e.message.slice(0, 90)}…) — retrying with off-screen window`);
      htmlGz = await extractHtmlGz(true);
    }
  }

  // Basic gets us past the session middleware (machine path); x-cron-secret
  // satisfies the route's own cronAuthorised gate.
  const headers = { "content-type": "application/json", "x-cron-secret": env.CRON_SECRET };
  if (env.BASIC_USER && env.BASIC_PASS) headers.authorization = `Basic ${Buffer.from(`${env.BASIC_USER}:${env.BASIC_PASS}`).toString("base64")}`;
  const res = await fetch(env.RELAY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ htmlGz, at: new Date().toISOString().slice(0, 10) }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`${new Date().toISOString()} relay: HTTP ${res.status} ${JSON.stringify(body)}`);
  if (!res.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`${new Date().toISOString()} relay FAILED: ${e.message}`);
  process.exit(1);
});
