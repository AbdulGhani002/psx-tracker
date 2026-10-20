// Dividends read from companies' letters (lib/calculations/payout-letter):
// which letters are read, a scanned results letter as OCR reads it, the usual
// wordings, a nil dividend, an interim, a meeting notice with the book
// closure alone, what is not taken (a dividend only mentioned, an
// extraordinary meeting's books, another year's dates), and merging into the
// payout list.
//
//   npx tsx scripts/test-payout-letter.ts

import { isDividendLetter, mergeLetterPayout, normalizeLetter, parseLetterDate, parsePayoutLetter, withLetterRows } from "../lib/calculations/payout-letter";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

// The letters read, by title: the ones the server saw in October 2026.
const readTitles = [
  "Financial Results for the Quarter Ended 31 March 2026",
  "Announcement - Financial Results for the Year Ended 30 June 2026",
  "NOTICES OF BOOK CLOSURE FOR THE ENTITLEMENT OF 80% INTERIM CASH DIVIDEND",
  "Notice of Annual General Meeting",
  "Publication of Notice of AGM",
  "Newspaper Advertisement for the Notice of the 35th Annual General Meeting",
];
const leftTitles = [
  "Transmission of Quarterly Report for the Period Ended 31 Mar",
  "AHCL - Credit of Final Cash Dividend",
  "PUBLICATION OF NOTICES FOR THE CREDIT OF INTERIM CASH DIVIDEND OF MEEZAN BANK LIMITED",
  "Notice of Extraordinary General Meeting",
  "Disclosure of interest by a director",
  "Corporate Briefing Session",
  "CERTIFIED TRUE COPY OF THE RESOLUTIONS PASSED IN THE 33rd ANNUAL GENERAL MEETING",
  "Addendum to Notice of 42nd Annual General Meeting (Change of Venue)",
];
check("results, dividend, book-closure and AGM letters are read", readTitles.every(isDividendLetter), readTitles.filter((t) => !isDividendLetter(t)));
check("reports, paid-dividend notices and EGM letters are not", !leftTitles.some(isDividendLetter), leftTitles.filter(isDividendLetter));

// AHCL's results letter of 30 Sep 2026, as tesseract read the scan.
const AHCL = `Subject: Announcement - Financial Results for the Year Ended 30 June 2026
We have to inform you that Board of Directors of our company, Arif Habib Corporation
Limited (AHCL), in their meeting held today, i.e. on Wednesday, 30" September 2026 at
11:00 a.m. at Arif Habib Centre, M. T. Khan Road, Karachi, recommended the following:
i) CASH DIVIDEND
A final Cash Dividend for the year ended 30 June 2026 at 125% of the face value of
Re.i/- per share i.e. Rs.1.25 This is in addition to Interim Dividend already paid at NIL
% i.e. Rs._Nil_ per share.
(ii) BONUS SHARES NIL
(iii) RIGHT SHARES NIL
The Annual General Meeting of the Company will be held on Wednesday, 28 October
2026 at 12:00 p.m. at Karachi.
The Share Transfer Books of the Company will be closed from 21% October 2026 to 28
October 2026 (both days inclusive).`;
const a = parsePayoutLetter(AHCL);
check("AHCL: final, 125% of a Re 1 face, Rs 1.25 a share", a != null && a.cycle === "F" && a.pctOfFace === 125 && a.rsPerShare === 1.25 && a.faceValue === 1 && !a.nil, a);
check("AHCL: books closed 21 to 28 October, read past OCR's 21%", a?.bookClosure === "2026-10-21" && a?.bookClosureEnd === "2026-10-28", a);

const typical = parsePayoutLetter("The Board of Directors in their meeting held on October 15, 2026 recommended final cash dividend for the year ended June 30, 2026 at Rs. 7.50 per share i.e. 75%. The Share Transfer Books of the Company will remain closed from 03-11-2026 to 10-11-2026 (both days inclusive).");
check("rupees first, then the %; day-first numeric dates", typical?.rsPerShare === 7.5 && typical?.pctOfFace === 75 && typical?.faceValue === 10 && typical?.bookClosure === "2026-11-03" && typical?.cycle === "F", typical);

const nil = parsePayoutLetter("(i) CASH DIVIDEND NIL (ii) BONUS SHARES NIL (iii) RIGHT SHARES NIL");
check("no dividend says so", nil?.nil === true && nil.pctOfFace == null);

const interim = parsePayoutLetter("The Board of Directors of the Company in its meeting held on October 20, 2026 has declared the following: (i) CASH DIVIDEND An interim Cash Dividend for the quarter ended September 30, 2026 at Rs. 3.00 per share i.e. 30%. This is in addition to Interim Dividend(s) already paid at Rs. Nil per share i.e. Nil%. The Share Transfer Books of the Company will be closed from October 28, 2026 to October 30, 2026 (both days inclusive).");
check("an interim, the month-first dates", interim?.cycle === "i" && interim?.pctOfFace === 30 && interim?.bookClosure === "2026-10-28", interim);
check("a second interim", parsePayoutLetter("The Board of Directors has approved a Second Interim Cash Dividend @ 40% i.e. Rs. 4/- per share")?.cycle === "ii");
check("a dividend only mentioned, not declared: nothing", parsePayoutLetter("Final cash dividend for the year ended June 30, 2025 at Rs. 7 per share was paid to the shareholders.") === null);
check("an extraordinary meeting's books: nothing", parsePayoutLetter("NOTICE is hereby given that an Extraordinary General Meeting of the shareholders will be held on 10 April 2026. The Share Transfer Books of the Company will remain closed from 3 April 2026 to 10 April 2026 (both days inclusive).") === null);
const weekday = parsePayoutLetter("The Share Transfer Books of the Bank will remain closed from Tuesday, August 19, 2026 to Thursday, August 21, 2026 (both days inclusive) for the purpose of entitlement of the Interim Cash Dividend.");
check("dates with the day's name", weekday?.bookClosure === "2026-08-19" && weekday?.bookClosureEnd === "2026-08-21", weekday);
check("\"21st of October\"", parsePayoutLetter("The Share Transfer Books will remain closed from 21st of October, 2026 to 28th of October, 2026 for the entitlement of final dividend.")?.bookClosure === "2026-10-21");
// As MARI's and PTL's meeting notices of September 2026 put it.
check("a comma after the year: \"September 22, 2026, to\"", parsePayoutLetter("NOTES: 1. Book Closure The Share Transfer Books of the Company shall remain closed from September 22, 2026, to September 25, 2026 (Both days inclusive).")?.bookClosure === "2026-09-22");
check("the register of members closed", parsePayoutLetter("Notes: 1. Closure of the Register of Members The Register of Members of the Company will remain closed from October 14, 2026, to October 20, 2026 (both days inclusive).")?.bookClosureEnd === "2026-10-20");
check("the year once, at the end of the range", parsePayoutLetter("The Share Transfer Books will remain closed from October 21 to October 28, 2026 (both days inclusive).")?.bookClosure === "2026-10-21");
const later = parsePayoutLetter("NOTICE OF 33rd ANNUAL GENERAL MEETING. To approve the final cash dividend @ 250% i.e. Rs. 5 per share as recommended by the Board of Directors.", "2026-09-03", "NOTES: 1. Closure of Share Transfer Books The Share Transfer Books of the Company will remain closed from September 18, 2026 to September 25, 2026 (both days inclusive).");
check("a meeting notice's book closure in its notes, pages on", later?.pctOfFace === 250 && later?.bookClosure === "2026-09-18", later);
check("a dividend on the later pages is not read", parsePayoutLetter("Notice of Annual General Meeting", undefined, "The Board of Directors has declared a final cash dividend of Rs. 7 per share i.e. 70%.") === null);

const notice = parsePayoutLetter("NOTICE is hereby given that the Annual General Meeting ... The Share Transfer Books of the Company will remain closed from 21st October, 2026 to 28th October, 2026 (both days inclusive) for the purpose of entitlement of final dividend.");
check("a meeting notice: the book closure alone", notice?.bookClosure === "2026-10-21" && notice?.pctOfFace == null && !notice?.nil, notice);
const NOTICE = "The Share Transfer Books of the Company will remain closed from 21st October, 2026 to 28th October, 2026 (both days inclusive) for the purpose of entitlement of final dividend.";
check("books that follow the letter are taken, posted a few days late too", parsePayoutLetter(NOTICE, "2026-10-06")?.bookClosure === "2026-10-21" && parsePayoutLetter(NOTICE, "2026-10-25")?.bookClosure === "2026-10-21");
check("another year's books are not", parsePayoutLetter(NOTICE, "2026-04-20") === null && parsePayoutLetter(NOTICE, "2026-10-30") === null);
check("AHCL's letter on its own date keeps its books", parsePayoutLetter(AHCL, "2026-09-30")?.bookClosure === "2026-10-21");
check("a letter about something else: nothing", parsePayoutLetter("Disclosure of interest by a director") === null);
check("50% of the face value is not a date", normalizeLetter("at 50% of the face value").includes("50%") && normalizeLetter("21st October 2026").startsWith("21 October"));
check("dates in the three ways letters write them", parseLetterDate("21 October 2026") === "2026-10-21" && parseLetterDate("October 21, 2026") === "2026-10-21" && parseLetterDate("21/10/2026") === "2026-10-21" && parseLetterDate("31 February 2026") === "2026-02-31");

// Merging.
const old = [{ date: "2025-09-23", bookClosure: "2025-10-17", pctOfFace: 100, cycle: "F", payoutType: "cash" }];
const m1 = mergeLetterPayout(old, a!, "2026-09-30", 1);
check("a new dividend with its dates is added, marked as from a letter", m1.length === 2 && m1[1].bookClosure === "2026-10-21" && m1[1].pctOfFace === 125 && m1[1].source === "letter");
check("read again: no second copy", mergeLetterPayout(m1, a!, "2026-09-30", 1).length === 2);
const pendingOnly = mergeLetterPayout(old, { ...a!, bookClosure: null, bookClosureEnd: null }, "2026-09-30", 1);
check("a dividend without dates waits for them", pendingOnly.length === 2 && pendingOnly[1].bookClosure === null);
const completed = mergeLetterPayout(pendingOnly, notice!, "2026-10-06", 1);
check("the meeting notice completes it", completed.length === 2 && completed[1].bookClosure === "2026-10-21" && completed[1].date === "2026-09-30");
const byRupees = mergeLetterPayout([], { nil: false, cycle: "F", pctOfFace: null, rsPerShare: 2.5, faceValue: null, bookClosure: "2026-11-02", bookClosureEnd: null }, "2026-10-10", 10);
check("rupees only: the % from the face value", byRupees[0]?.pctOfFace === 25);
const letterOf = (cycle: "F" | "i" | "", pctOfFace: number, bookClosure: string | null) => ({ nil: false, cycle, pctOfFace, rsPerShare: null, faceValue: null, bookClosure, bookClosureEnd: null });
const luck = [{ date: "2026-08-20", bookClosure: "2026-09-18", pctOfFace: 250, cycle: "F", payoutType: "cash" }];
check("a meeting notice of a dividend already listed adds nothing", mergeLetterPayout(luck, letterOf("F", 250, null), "2026-09-03", 2).length === 1);
check("nor one that leaves out the cycle", mergeLetterPayout([{ date: "2026-09-10", bookClosure: "2026-10-14", pctOfFace: 20, cycle: "F", payoutType: "cash" }], letterOf("", 20, null), "2026-09-29", 10).length === 1);
const mureb = mergeLetterPayout([{ date: "2026-09-18", bookClosure: "2026-10-16", pctOfFace: 145, cycle: "F", payoutType: "cash" }], letterOf("F", 415, "2026-10-16"), "2026-09-18", 10);
check("the exchange's row is not overwritten by a letter", mureb.length === 1 && mureb[0].pctOfFace === 145);
check("an interim the exchange calls a second one: the same book closure, nothing added", mergeLetterPayout([{ date: "2026-08-06", bookClosure: "2026-08-19", pctOfFace: 80, cycle: "ii", payoutType: "cash" }], letterOf("i", 80, "2026-08-19"), "2026-08-10", 10).length === 1);
const fixed = mergeLetterPayout([{ date: "2026-09-30", bookClosure: "2026-10-21", pctOfFace: 120, cycle: "F", payoutType: "cash", source: "letter" }], letterOf("F", 125, "2026-10-21"), "2026-10-06", 1);
check("a letter's row takes a later letter's figure", fixed.length === 1 && fixed[0].pctOfFace === 125);
const nextQuarter = mergeLetterPayout([{ date: "2026-04-22", bookClosure: "2026-05-06", pctOfFace: 75, cycle: "i", payoutType: "cash" }], letterOf("i", 80, "2026-08-19"), "2026-08-06", 10);
check("the next quarter's interim is a new one", nextQuarter.length === 2 && nextQuarter[1].bookClosure === "2026-08-19");

// The exchange's list back: it replaces the kept rows, letters it lacks stay.
const board = [
  { date: "2025-09-23", bookClosure: "2025-10-17", pctOfFace: 100, cycle: "F", payoutType: "cash" },
  { date: "2026-08-05", bookClosure: "2026-08-19", pctOfFace: 80, cycle: "i", payoutType: "cash" },
];
const kept = [
  { date: "2025-09-23", bookClosure: "2025-10-17", pctOfFace: 100, cycle: "F", payoutType: "cash" },
  { date: "2026-08-04", bookClosure: null, pctOfFace: 80, cycle: "i", payoutType: "cash", source: "letter" },
  { date: "2026-09-30", bookClosure: "2026-10-21", pctOfFace: 125, cycle: "F", payoutType: "cash", source: "letter" },
];
const merged = withLetterRows(board, kept);
check("the list back: a letter's dividend it lacks stays, one it shows goes", merged.length === 3 && merged[2].bookClosure === "2026-10-21" && !merged.some((p) => p.bookClosure === null), merged.map((p) => p.bookClosure));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
