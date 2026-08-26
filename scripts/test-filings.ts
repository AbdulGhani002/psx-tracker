// PSX company-filings parser tests.
// Run: npx tsx scripts/test-filings.ts
//
// The fixture is the real announcements block from dps.psx.com.pk/company/HINOON
// captured 26 Aug 2026, trimmed to two rows per tab. If the portal changes its
// markup this fails here rather than quietly returning an empty page.

import { parseFilings, filingDateToIso } from "../lib/prices/filings";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  cond ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label}  ${extra}`));
}

const HTML = `
<div class="section section--padded company" id="announcements"><div class="company__payouts">
<h1 class="section__title">Announcements</h1><div id="announcementsTab"><div class="tabs">
<div class="tabs__list"><div class="tabs__list__item" data-name="Financial Results">Financial Results</div></div>
<div class="tabs__panels">
<div class="tabs__panel" data-name="Financial Results"><table class="tbl"><thead class="tbl__head"><tr><th style="width:140px;">Date</th><th>Title</th><th style="width:140px;">Document</th></tr></thead><tbody class="tbl__body">
<tr><td>Jun 4, 2026</td><td>Shariah Disclosure for the year ended December 31 2025 </td><td> <i class="icon-file-image"></i><a href="javascript:" data-images="278158-1.gif">View</a>&nbsp;&nbsp;&nbsp;<i class="icon-file-pdf"></i><a href="/download/document/278158.pdf" target="_blank">PDF</a></td></tr>
<tr><td>Apr 7, 2026</td><td>HINOON | Highnoon Laboratories Limited Financial Results &amp; Co </td><td> <i class="icon-file-pdf"></i><a href="/download/attachment/273738-1.pdf" target="_blank">PDF</a></td></tr>
</tbody></table></div>
<div class="tabs__panel" data-name="Board Meetings"><table class="tbl"><tbody class="tbl__body">
<tr><td>Aug 20, 2026</td><td>Board Meeting </td><td> <a href="/download/document/281400.pdf" target="_blank">PDF</a></td></tr>
</tbody></table></div>
<div class="tabs__panel" data-name="Others"><table class="tbl"><tbody class="tbl__body">
<tr><td>May 15, 2026</td><td>Credit of Final Cash Dividend </td><td> <a href="/download/document/276581.pdf" target="_blank">PDF</a></td></tr>
<tr><td>Not a date</td><td>Row whose date the portal printed oddly </td><td></td></tr>
</tbody></table></div>
</div></div></div></div></div>
<div class="section section--padded company" id="financials"><table class="tbl"><tbody class="tbl__body">
<tr><td>Dec 31, 2025</td><td>THIS MUST NOT BE READ AS A FILING</td><td></td></tr>
</tbody></table></div>`;

console.log("the real HINOON announcements block");
const f = parseFilings(HTML, "HINOON");
ok("five rows across three tabs", f.length === 5, String(f.length));
ok("newest first", f[0].date === "2026-08-20", f[0].date);
ok("categories kept", new Set(f.map((x) => x.category)).size === 3);
ok("symbol stamped", f.every((x) => x.symbol === "HINOON"));

const shariah = f.find((x) => x.title.startsWith("Shariah"))!;
ok("date parsed to ISO", shariah.date === "2026-06-04", shariah.date);
ok("printed date kept verbatim", shariah.dateLabel === "Jun 4, 2026");
ok("PDF made absolute", shariah.pdfUrl === "https://dps.psx.com.pk/download/document/278158.pdf", String(shariah.pdfUrl));
ok("category read", shariah.category === "Financial Results");

const attach = f.find((x) => x.title.includes("Highnoon"))!;
ok("attachment links parse too", attach.pdfUrl?.endsWith("/download/attachment/273738-1.pdf") === true, String(attach.pdfUrl));
ok("entities decoded", attach.title.includes("Results & Co"), attach.title);
ok("view-image anchor is not mistaken for a document", shariah.pdfUrl!.endsWith(".pdf"));

console.log("\nrows the portal prints badly are kept, not invented");
const odd = f.find((x) => x.title.startsWith("Row whose"))!;
ok("unreadable date → empty ISO, never a guess", odd.date === "");
ok("but the printed text survives", odd.dateLabel === "Not a date");
ok("no document → null, not an empty string", odd.pdfUrl === null);
ok("undated rows sink to the bottom", f[f.length - 1] === odd);

console.log("\nthe next section is not swept in");
ok("financials table excluded", f.every((x) => !x.title.includes("MUST NOT BE READ")), JSON.stringify(f.map((x) => x.title)));

console.log("\ndate parsing on its own");
ok("Jun 4, 2026", filingDateToIso("Jun 4, 2026") === "2026-06-04");
ok("Dec 31, 2025", filingDateToIso("Dec 31, 2025") === "2025-12-31");
ok("full month name tolerated", filingDateToIso("September 9, 2026") === "2026-09-09");
ok("junk → empty", filingDateToIso("soon") === "");
ok("empty → empty", filingDateToIso("") === "");

console.log("\na page without the block returns nothing, loudly empty");
ok("no announcements id → []", parseFilings("<html><body>nothing here</body></html>", "LUCK").length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
