// Face values read from the closing files (lib/calculations/face-value): the
// cash taken off the price on the ex-date over the dividend's % of face.
//
//   npx tsx scripts/test-face-value.ts

import { currentFace, eventFor, faceOf, snapFace } from "../lib/calculations/face-value";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

check("the usual face values, within 3%", snapFace(2.02) === 2 && snapFace(9.8) === 10 && snapFace(1) === 1 && snapFace(2.5) === 2.5);
check("anything else is no face value", snapFace(7) === null && snapFace(3.3) === null && snapFace(0) === null);

const cash = (pctOfFace: number, bookClosure: string) => ({ bookClosure, pctOfFace, payoutType: "cash" });
// LUCK, September 2026: 250% final, books from Fri 18 Sep, ex on Thu 17 Sep at Rs 5.
const luck = [{ date: "2026-09-17", cash: 5 }, { date: "2025-09-18", cash: 4 }];
check("the ex-date's cash in the ten days before the book closure", eventFor(cash(250, "2026-09-18"), luck)?.date === "2026-09-17");
check("none after the book closure or over ten days before", eventFor(cash(250, "2026-09-30"), luck) === null && eventFor(cash(250, "2026-09-16"), luck) === null);
check("LUCK: Rs 5 for 250% is a Rs 2 face value", faceOf(cash(250, "2026-09-18"), luck)?.face === 2);
check("MUREB: Rs 14.5 for 145% is Rs 10", faceOf(cash(145, "2026-10-16"), [{ date: "2026-10-15", cash: 14.5 }])?.face === 10);
check("AHCL: Rs 1.25 for 125% is Re 1", faceOf(cash(125, "2026-10-21"), [{ date: "2026-10-20", cash: 1.25 }])?.face === 1);
check("a drop that also took a bonus proves nothing", faceOf(cash(50, "2026-10-21"), [{ date: "2026-10-20", cash: 12 }]) === null);
check("a bonus is no cash dividend", faceOf({ bookClosure: "2026-09-18", pctOfFace: 10, payoutType: "bonus" }, luck) === null);

// A 5-for-1 split between two dividends: the newest shows the face value now.
const payouts = [cash(200, "2024-09-20"), cash(250, "2026-09-18"), cash(300, "2026-12-01")];
const events = [{ date: "2024-09-19", cash: 20 }, { date: "2026-09-17", cash: 5 }];
const now = currentFace(payouts, events, "2026-10-21");
check("the newest dividend the closing files show sets the face value", now?.face === 2 && now.bookClosure === "2026-09-18", now);
check("before the split, the older one", currentFace(payouts, events, "2025-01-01")?.face === 10);
check("no dividend shown: no face value", currentFace(payouts, [], "2026-10-21") === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
