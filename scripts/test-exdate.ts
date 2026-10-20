// Ex-dividend dates (lib/calculations/exdate): with T+1 settlement the last
// day to hold is two trading days before the book closure and the ex-date the
// next, over weekends and holidays, the same day the dividend job counts
// shares on; and the Telegram line before and after the ex-date.
//
//   npx tsx scripts/test-exdate.ts

import { exDateOf, exDividendMessage } from "../lib/calculations/exdate";
import { lastEntitledTradeDate } from "../lib/calculations/corporate-actions";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

// AHCL: books closed 21 to 28 Oct 2026, transfers in by 20 Oct.
const a = exDateOf("2026-10-21");
check("AHCL: ex on Tue 20 Oct, last day to buy with it Mon 19 Oct", a.exDate === "2026-10-20" && a.lastCumDate === "2026-10-19", a);
check("a Monday book closure goes ex the Friday before", exDateOf("2026-10-26").exDate === "2026-10-23" && exDateOf("2026-10-26").lastCumDate === "2026-10-22");
check("a holiday in between is skipped", exDateOf("2026-10-21", new Set(["2026-10-20"])).lastCumDate === "2026-10-16" && exDateOf("2026-10-21", new Set(["2026-10-20"])).exDate === "2026-10-19");
check("the last day to hold is the dividend job's last entitled trade", ["2026-10-21", "2026-10-22", "2026-10-26", "2026-11-02", "2026-12-07"].every((d) => exDateOf(d).lastCumDate === lastEntitledTradeDate(d)));

const after = exDividendMessage({ symbol: "AHCL", bookClosure: "2026-10-21", pctOfFace: 125, faceValue: 1 }, 21019, 15, "2026-10-20");
check("found on the ex-date: says it went ex, the rate a share and what the shares held earn", after.includes("went ex-dividend on Tue 20 Oct: Rs 1.25 a share (125%), book closure from Wed 21 Oct") && after.includes("On your 21,019 shares: Rs 26,274, about Rs 22,333 after 15% tax."), after);
const before = exDividendMessage({ symbol: "AHCL", bookClosure: "2026-10-21", pctOfFace: 125, faceValue: 1 }, 21019, 15, "2026-10-12");
check("before it: the ex-date and the last day to hold it", before.includes("goes ex-dividend on Tue 20 Oct") && before.includes("Hold it at the close of Mon 19 Oct to be paid"), before);
check("not held: no amount line", !exDividendMessage({ symbol: "MEBL", bookClosure: "2026-11-02", pctOfFace: 70, faceValue: 10 }, 0, 15, "2026-10-20").includes("On your"));
check("a face value of ten: Rs 7 a share for 70%", exDividendMessage({ symbol: "MEBL", bookClosure: "2026-11-02", pctOfFace: 70, faceValue: 10 }, 0, 15, "2026-10-20").includes("Rs 7 a share (70%)"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
