// Checks for the announcements board parser and the message text (lib/calculations/announcements).
//   npx tsx scripts/test-announcements.ts
// The fixture is one page of POST dps.psx.com.pk/announcements saved on 18 Sep 2026.
import { readFileSync } from "node:fs";
import { parseBoard, parseBoardTotal, parseBoardDate, fileNameFor, telegramText, emailSubject, emailHtml, fmtPkt } from "../lib/calculations/announcements";

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

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
