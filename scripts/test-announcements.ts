// Checks for the announcements board parser and the message text (lib/calculations/announcements).
//   npx tsx scripts/test-announcements.ts
// The fixture is one page of POST dps.psx.com.pk/announcements saved on 18 Sep 2026.
import { readFileSync } from "node:fs";
import { parseBoard, parseBoardTotal, parseBoardDate, fileNameFor, telegramText, emailSubject, emailHtml, fmtPkt, classifyAnnouncement, announcementPasses } from "../lib/calculations/announcements";

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

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
