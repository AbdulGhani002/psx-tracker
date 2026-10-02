// Checks for the announcements board parser and the message text (lib/calculations/announcements).
//   npx tsx scripts/test-announcements.ts
// The fixtures are one page of POST dps.psx.com.pk/announcements saved on 18 Sep 2026,
// and PTL's company page (GET dps.psx.com.pk/company/PTL) saved on 2 Oct 2026.
import { readFileSync } from "node:fs";
import { filingHours, nextPagesAt, nextBoardAt, shuffled } from "../lib/calculations/announcements";
import { parseBoard, parseBoardTotal, parseBoardDate, parseCompanyAnnouncements, fileNameFor, telegramText, emailSubject, emailHtml, fmtPkt, classifyAnnouncement, announcementPasses } from "../lib/calculations/announcements";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL ${name} ${detail}`);
  }
}
const eq = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const html = readFileSync(new URL("./fixtures/announcements-board.html", import.meta.url), "utf8");
const rows = parseBoard(html);

eq("every table row parsed", rows.length, 100);
eq("the total is read from the header", parseBoardTotal(html), 223639);
eq("first row id", rows[0].annId, "282941");
eq("first row symbol and company", [rows[0].symbol, rows[0].company], ["IPAK", "International Packaging Films Limited"]);
check("first row title", rows[0].title.startsWith("Disclosure of Interest by a Director"), rows[0].title);
eq("a row with only an image has no pdf and the image path", [rows[0].pdfPath, rows[0].images], ["", ["/download/image/282941-1.gif"]]);
const akgl = rows.find((r) => r.annId === "282940")!;
eq("a row with a pdf", [akgl.symbol, akgl.pdfPath, akgl.images], ["AKGL", "/download/document/282940.pdf", ["/download/image/282940-1.gif"]]);
eq("the pdf row's time is PKT (UTC+5)", akgl.announcedAt.toISOString(), "2026-09-18T05:51:00.000Z");
const attach = rows.find((r) => r.pdfPath.includes("/attachment/"))!;
eq("an attachment counts as the document", [attach.symbol, attach.annId, attach.pdfPath], ["LEUL", "282829", "/download/attachment/282829-1.pdf"]);
eq("ids are unique", new Set(rows.map((r) => r.annId)).size, rows.length);
check("rows are newest first", rows.every((r, i) => i === 0 || r.announcedAt <= rows[i - 1].announcedAt));
check("every row has a date", rows.every((r) => !Number.isNaN(r.announcedAt.getTime())));

eq("board date, morning", parseBoardDate("Sep 18, 2026", "10:51 AM")?.toISOString(), "2026-09-18T05:51:00.000Z");
eq("board date, afternoon", parseBoardDate("Sep 17, 2026", "3:09 PM")?.toISOString(), "2026-09-17T10:09:00.000Z");
eq("board date, noon", parseBoardDate("Jan 5, 2026", "12:00 PM")?.toISOString(), "2026-01-05T07:00:00.000Z");
eq("board date, midnight", parseBoardDate("Jan 5, 2026", "12:05 AM")?.toISOString(), "2026-01-04T19:05:00.000Z");
eq("board date, garbage", parseBoardDate("Sometime", "10:51 AM"), null);
eq("PKT formatting", fmtPkt(new Date("2026-09-18T05:51:00.000Z")), "18 Sep 2026, 10:51 AM PKT");

const mari = { annId: "282421", symbol: "MARI", company: "Mari Energies Limited", title: "Material Information", announcedAt: new Date("2026-09-09T04:27:00.000Z"), pdfPath: "/download/document/282421.pdf", images: ["/download/image/282421-1.gif"] };
eq("file name", fileNameFor(mari, "pdf"), "MARI 2026-09-09 Material Information.pdf");
eq("file name strips characters a file system refuses", fileNameFor({ ...mari, title: 'Notice: "AGM" / EOGM <2026>?' }, "pdf"), "MARI 2026-09-09 Notice AGM EOGM 2026.pdf");
const text = telegramText(mari);
check("telegram caption carries the symbol, title, time and links", ["<b>MARI</b>", "<b>Material Information</b>", "9 Sep 2026, 9:27 AM PKT", 'href="https://dps.psx.com.pk/download/document/282421.pdf"', 'href="https://dps.psx.com.pk/company/MARI"'].every((s) => text.includes(s)), text);
check("telegram caption fits the Bot API limit", telegramText({ ...mari, title: "x".repeat(2000) }).length <= 1024);
check("the link-only message says the file could not go", telegramText(mari, true).includes("could not be attached"));
check("html in a title is escaped", telegramText({ ...mari, title: "A & B <script>" }).includes("A &amp; B &lt;script&gt;"));
eq("email subject", emailSubject(mari), "MARI: Material Information");
const mail = emailHtml(mari, { attached: true, appOrigin: "https://portfolio.apex-logic.net" });
check("email carries the document link, the company page and the settings link", ["https://dps.psx.com.pk/download/document/282421.pdf", "https://dps.psx.com.pk/company/MARI", "https://portfolio.apex-logic.net/settings", "The document is attached."].every((s) => mail.includes(s)));
check("email says when the document was too large", emailHtml(mari, { attached: false, appOrigin: "" }).includes("too large to attach"));

// What each announcement is about, and which channel level carries it.
const KINDS: Array<[string, string]> = [
  ["Board Meeting", "board"],
  ["BOARD MEETING AND CLOSED PERIOD", "board"],
  ["Board Meeting Other Than Financial Results", "board"],
  ["Board Meeting Annual Financials 2026", "board"],
  ["Financial Results for the Year Ended June 30, 2026", "results"],
  ["Transmission of Annual Financial Statements for the Year Ended 2026-06-30", "results"],
  ["Credit of Interim Cash Dividend Q2 2026", "payout"],
  ["PUBLICATION OF NOTICES FOR THE CREDIT OF INTERIM CASH DIVIDEND (D-46)", "payout"],
  ["Notice of 42nd Annual General Meeting", "agm"],
  ["Material Information", "material"],
  ["Disclosure of Material Information", "material"],
  ["Disclosure of Interest by a Director CEO, or Executive of a listed company", "other"],
  ["Resignation of Chief Financial Officer", "other"],
  ["Video Recording of the Corporate Briefing Session", "other"],
  ["UNUSUAL MOVEMENT IN VOLUME OF THE SHARES", "other"],
  ["", "other"],
];
for (const [title, want] of KINDS) eq(`kind of "${title.slice(0, 40)}"`, classifyAnnouncement(title), want);
check("a board meeting about results is still a board meeting", classifyAnnouncement("Board Meeting Annual Financials 2026") === "board");
eq("off carries nothing", ["board", "results", "other"].map((k) => announcementPasses(k as any, "off")), [false, false, false]);
eq("board carries board meetings only", ["board", "results", "payout", "other"].map((k) => announcementPasses(k as any, "board")), [true, false, false, false]);
eq("key carries everything but the noise", ["board", "results", "payout", "agm", "material", "other"].map((k) => announcementPasses(k as any, "key")), [true, true, true, true, true, false]);
eq("all carries everything", ["board", "other"].map((k) => announcementPasses(k as any, "all")), [true, true]);

// A company's own page: the same filings, read while the board refuses.
const page = readFileSync(new URL("./fixtures/company-PTL.html", import.meta.url), "utf8");
const own = parseCompanyAnnouncements(page, "ptl");
check("the company page lists its latest filings, five to a tab", own.length === 15, String(own.length));
const ar = own.find((r) => r.annId === "283789")!;
eq("a row carries the board's document id, files, title and the company", ar && { symbol: ar.symbol, company: ar.company, title: ar.title, pdfPath: ar.pdfPath, images: ar.images }, { symbol: "PTL", company: "Panther Tyres Ltd.", title: "Transmission of Annual Report for the Year Ended 30-06-2026", pdfPath: "/download/document/283789.pdf", images: ["/download/image/283789-1.gif"] });
check("the page prints the date only: that day, midnight in Karachi", ar.dateOnly === true && ar.announcedAt.toISOString() === "2026-09-28T19:00:00.000Z", ar.announcedAt.toISOString());
check("each filing once", new Set(own.map((r) => r.annId)).size === own.length);
check("every row is the company's and dated", own.every((r) => r.symbol === "PTL" && !Number.isNaN(r.announcedAt.getTime()) && r.dateOnly));
check("a page without the block gives nothing", parseCompanyAnnouncements("<html><body>Not found</body></html>", "PTL").length === 0);
check("a dated-only row shows the day, no time", fmtPkt(ar.announcedAt, true) === "29 Sep 2026" && telegramText(ar).includes("29 Sep 2026") && !telegramText(ar).includes("AM PKT"));

// While the board refuses: when the pages and the board are asked again.
const at = (iso: string) => new Date(iso);
const mins = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;
const thu11 = at("2026-10-01T06:00:00Z"); // Thursday, 11:00 in Karachi
const thu23 = at("2026-10-01T18:30:00Z"); // Thursday, 23:30 in Karachi
const sat11 = at("2026-10-03T06:00:00Z"); // Saturday, 11:00 in Karachi
check("filing hours: weekdays 08:00 to 23:00 in Karachi", filingHours(thu11) && !filingHours(thu23) && !filingHours(sat11) && filingHours(at("2026-10-01T03:00:00Z")) && !filingHours(at("2026-10-01T02:59:00Z")));
check("in filing hours the pages are read 15 to 30 minutes apart", mins(thu11, nextPagesAt(thu11, true, () => 0)) === 15 && mins(thu11, nextPagesAt(thu11, true, () => 0.999)) < 30);
check("at night and at weekends one to two hours apart", mins(thu23, nextPagesAt(thu23, true, () => 0)) === 60 && mins(sat11, nextPagesAt(sat11, true, () => 0.5)) === 90);
check("after a failed read, two hours", mins(thu11, nextPagesAt(thu11, false, () => 0)) === 120 && mins(thu11, nextPagesAt(thu11, false, () => 0.9)) === 120);
check("the refused board is asked again in five to seven hours", mins(thu11, nextBoardAt(thu11, () => 0)) === 300 && mins(thu11, nextBoardAt(thu11, () => 0.999)) < 420);
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const names = ["AHCL", "HINOON", "HUBC", "LUCK", "MARI", "MEBL", "MUREB", "PTL"];
const mixed = shuffled(names, rnd);
check("the names are read in a random order, each once", mixed.join() !== names.join() && [...mixed].sort().join() === names.join() && names.join() === "AHCL,HINOON,HUBC,LUCK,MARI,MEBL,MUREB,PTL");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
