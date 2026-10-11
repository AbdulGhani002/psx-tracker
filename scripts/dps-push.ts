// On this machine, which the exchange's site still serves: fetch what the
// server asked for (/api/cron/dps-relay, {plan:true}) and write one bundle
// for scripts/dps-push.sh to hand over. Every request goes through
// lib/prices/dps.ts: one at a time, 3 to 9 seconds apart at random, under the
// app's own name, and nothing more once the site refuses.
//   - each weekday's closing file after the last one the server keeps (also
//     written into the archive here, for the monthly retrain);
//   - the index pages (the KSE-100, KMI-30 and KSE-30 closes and members);
//   - the company pages, in the order the server wants them.
//
//   npx tsx scripts/dps-push.ts --plan '<json>' --out FILE [--archive DIR]

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchClosingSheet } from "../lib/timeseries/dps-sheet";
import { dpsFetch, DpsRefused } from "../lib/prices/dps";
import { weekdaysBetween, type DayRow } from "../lib/timeseries/psx-history";
import { argOf } from "./quant-cli";

type Plan = { today: string; latestKept: string | null; indices: string[]; symbols: string[] };

const nextDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

async function main() {
  const plan = JSON.parse(argOf("plan") ?? "{}") as Plan;
  const out = argOf("out") || "psx-dps-bundle.json";
  const archive = argOf("archive");
  if (!plan.today) throw new Error("no plan from the server");
  const sheets: Array<{ date: string; rows: DayRow[] }> = [];
  const pages: Record<string, { html: string; fetchedAt: string }> = {};
  let refused = false;

  // The closing files the server lacks: ten weekdays at most.
  for (const date of weekdaysBetween(plan.latestKept ? nextDay(plan.latestKept) : plan.today, plan.today).slice(-10)) {
    const r = await fetchClosingSheet(date);
    if (r.status === "ok") {
      sheets.push({ date, rows: r.rows });
      if (archive) {
        const f = join(archive, "days", `${date}.json`);
        const have = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as unknown[]).length : 0;
        if (have === 0) writeFileSync(f, JSON.stringify(r.rows));
      }
    } else if (r.status === "error") {
      console.log(`${date}: ${r.detail}`);
      if (/refused|resting/i.test(r.detail)) {
        refused = true;
        break;
      }
    }
  }

  // The index pages, then the company pages.
  for (const path of refused ? [] : [...plan.indices, ...plan.symbols.map((s) => `/company/${encodeURIComponent(s)}`)]) {
    try {
      const res = await dpsFetch(path, { headers: { accept: "text/html" } }, { relay: false });
      if (res.ok) pages[path] = { html: await res.text(), fetchedAt: new Date().toISOString() };
      else console.log(`${path}: HTTP ${res.status}`);
    } catch (e) {
      console.log(`${path}: ${String(e instanceof Error ? e.message : e).slice(0, 100)}`);
      if (e instanceof DpsRefused) break;
    }
  }

  writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString(), sheets, pages }));
  console.log(`${sheets.length} closing files (${sheets.map((s) => s.date).join(", ") || "none new"}), ${Object.keys(pages).length} pages of ${plan.indices.length + plan.symbols.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
