// On this machine, which the exchange's site still serves: fetch what the
// server asked for (/api/cron/dps-relay, {plan:true}) and write one bundle
// for scripts/dps-push.sh to hand over. Every request goes through
// lib/prices/dps.ts: one at a time, 3 to 9 seconds apart at random, under the
// app's own name, and nothing more once the site refuses.
//   - each weekday's closing file after the last one the server keeps (also
//     written into the archive here, for the monthly retrain);
//   - the index pages (the KSE-100, KMI-30 and KSE-30 closes and members);
//   - the company pages, in the order the server wants them;
//   - valuation drafts (lib/valuation/draft.ts) for every share a user holds
//     or values: a results letter on its company page newer than the
//     approved thesis is downloaded and read once by the model running on
//     this machine (lib/valuation/read-filing.ts; one read on an earlier
//     evening comes back in the plan); the page's own annual table is used
//     where it is newer than the server's; and the drafts go over with the
//     rest for the owner to review.
//
//   npx tsx scripts/dps-push.ts --plan-file PLAN.json --out FILE [--archive DIR]

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchClosingSheet } from "../lib/timeseries/dps-sheet";
import { dpsFetch, DpsRefused } from "../lib/prices/dps";
import { weekdaysBetween, type DayRow } from "../lib/timeseries/psx-history";
import { parseFilings } from "../lib/prices/filings";
import { parseFinancials } from "../lib/prices/fundamentals";
import { isResultsLetter, type ResultFigures } from "../lib/prices/results";
import { readFiling, modelReady } from "../lib/valuation/read-filing";
import { draftFrom, type DraftInput } from "../lib/valuation/draft";
import { argOf } from "./quant-cli";

type ValuationItem = { userId: string; symbol: string; lastAsOf: string | null; knownFiling?: Filed | null; input: Omit<DraftInput, "filing"> };
type Plan = { today: string; latestKept: string | null; indices: string[]; symbols: string[]; valuation?: ValuationItem[] };
type Filed = ResultFigures & { date: string; title: string; url: string };

const nextDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

async function main() {
  const planFile = argOf("plan-file");
  const plan = JSON.parse(planFile ? readFileSync(planFile, "utf8") : argOf("plan") ?? "{}") as Plan;
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

  // Valuation drafts: the newest results filing on each company page, read
  // once per share when it is newer than a user's approved thesis.
  const drafts: Array<{ userId: string; symbol: string; draft: ReturnType<typeof draftFrom> }> = [];
  const filed = new Map<string, Filed | null>();
  let read = 0;
  for (const item of plan.valuation ?? []) {
    const html = pages[`/company/${encodeURIComponent(item.symbol)}`]?.html;
    const input: Omit<DraftInput, "filing"> = { ...item.input, annual: [...item.input.annual] };
    let filing: Filed | null = null;
    if (html) {
      const fin = parseFinancials(html, item.symbol);
      for (const row of fin?.annual ?? []) {
        if (row.eps == null && row.profitAfterTax == null) continue;
        const k = input.annual.findIndex((a) => a.fiscalYear === row.fiscalYear);
        const fresh = { fiscalYear: row.fiscalYear, eps: row.eps ?? null, profitAfterTax: row.profitAfterTax ?? null };
        if (k >= 0) input.annual[k] = fresh;
        else input.annual.push(fresh);
      }
      if (fin?.sharesOutstanding) input.sharesNow = fin.sharesOutstanding;
      const newest = parseFilings(html, item.symbol)
        .filter((f) => f.category === "Financial Results" && isResultsLetter(f.title) && f.pdfUrl && f.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (newest && (!item.lastAsOf || newest.date > item.lastAsOf)) {
        // Read on an earlier evening: kept, unless only its text was read then
        // and the model is here now.
        if (item.knownFiling?.url === newest.pdfUrl && !filed.has(newest.pdfUrl!) && (item.knownFiling.source === "model" || !(await modelReady()))) filed.set(newest.pdfUrl!, item.knownFiling);
        if (!filed.has(newest.pdfUrl!) && !refused) {
          let got: Filed | null = null;
          try {
            const res = await dpsFetch(newest.pdfUrl!, {}, { relay: false, timeoutMs: 150000 });
            if (res.ok) {
              console.log(`${item.symbol}: reading ${newest.title} (${newest.date})`);
              const last = [...input.annual].filter((a) => a.eps != null).sort((a, b) => a.fiscalYear - b.fiscalYear).pop();
              const ctx = { sharesNow: input.sharesNow, lastEps: last?.eps ?? null, lastBvps: input.equity && input.sharesNow ? input.equity / input.sharesNow : null };
              got = { ...(await readFiling(new Uint8Array(await res.arrayBuffer()), ctx, console.log)), date: newest.date, title: newest.title, url: newest.pdfUrl! };
              read++;
            }
          } catch (e) {
            console.log(`${newest.pdfUrl}: ${String(e instanceof Error ? e.message : e).slice(0, 100)}`);
            if (e instanceof DpsRefused) refused = true;
          }
          filed.set(newest.pdfUrl!, got);
        }
        filing = filed.get(newest.pdfUrl!) ?? null;
      }
    }
    drafts.push({ userId: item.userId, symbol: item.symbol, draft: draftFrom({ ...input, filing }) });
  }

  writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString(), sheets, pages, drafts }));
  console.log(`${sheets.length} closing files (${sheets.map((s) => s.date).join(", ") || "none new"}), ${Object.keys(pages).length} pages of ${plan.indices.length + plan.symbols.length}, ${drafts.length} valuation drafts (${read} filings read)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
