// The price rules (lib/rules): steps from the average price reached on a
// close, told once and again after the price comes back to the average,
// marked quietly when the rules start; the shares a step adds or sells; and
// the checks on whether the company or the economy changed a lot.
//
//   npx tsx scripts/test-rules.ts

import { advanceShare, cleanSteps, DEFAULT_STEPS, dividendsOn, holdingSince, ruleMessage, standing, stepShares, type Fired } from "../lib/rules/ladder";
import { checksLine, checkFacts, combine, dividendCheck, moveCheck, profitCheck, usualEpsMove } from "../lib/rules/checks";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-6) => a != null && Math.abs(a - b) < tol;

const steps = cleanSteps(DEFAULT_STEPS);
check("the user's eleven steps, falls then rises", steps.length === 11 && steps[0].move === -50 && steps[10].move === 60 && steps.find((s) => s.move === -20)?.sizePct === 10 && steps.find((s) => s.move === 60)?.sizePct === 40);
check("cleaning: no add on a rise, no sell on a fall, one step a move, hold has no size", cleanSteps([{ move: 10, action: "add", sizePct: 5 }, { move: -10, action: "sell", sizePct: 5 }, { move: -15, action: "hold", sizePct: 9 }, { move: -15, action: "add", sizePct: 9 }]).map((s) => `${s.move}${s.action}${s.sizePct}`).join() === "-15hold0");

// PTL from an average of 50.
const d = (date: string, close: number) => ({ date, close });
const a1 = advanceShare(steps, [], "PTL", 50, [d("2026-10-01", 46), d("2026-10-02", 44.9)]);
check("−10%: hold is reached and marked", a1.reached.length === 1 && a1.reached[0].steps[0].move === -10 && a1.fired.length === 1, a1.reached);
const a2 = advanceShare(steps, a1.fired, "PTL", 50, [d("2026-10-05", 39.9)]);
check("−20.2%: add 10% reached, the hold not told again", a2.reached.length === 1 && a2.reached[0].steps.map((s) => s.move).join() === "-20" && a2.fired.length === 2);
const a3 = advanceShare(steps, a2.fired, "PTL", 50, [d("2026-10-06", 41), d("2026-10-07", 39.5)]);
check("a bounce that stays under the average does not tell it again", a3.reached.length === 0);
const a4 = advanceShare(steps, a3.fired, "PTL", 50, [d("2026-10-08", 34)]);
check("a gap past two steps tells both at once", a4.reached.length === 1 && a4.reached[0].steps.map((s) => s.move).join() === "-30", a4.reached[0]?.steps);
const gap = advanceShare(steps, [], "PTL", 50, [d("2026-10-01", 34)]);
check("from nothing, a close at −32% reaches −10, −20 and −30 together", gap.reached[0].steps.map((s) => s.move).join() === "-10,-20,-30");
const a5 = advanceShare(steps, a4.fired, "PTL", 50, [d("2026-10-20", 50.5), d("2026-10-21", 39)]);
check("a close back at the average ends the fall: the steps are told again next time", a5.reached.length === 1 && a5.reached[0].steps.map((s) => s.move).join() === "-10,-20" && a5.fired.every((f) => f.move < 0));
const r1 = advanceShare(steps, a4.fired, "PTL", 50, [d("2026-11-01", 66)]);
check("a rise of 32% reaches +10, +20 and +30 and drops the fall's steps", r1.reached[0].steps.map((s) => s.move).join() === "10,20,30" && r1.fired.every((f) => f.move > 0));
const q = advanceShare(steps, [], "PTL", 50, [d("2026-10-01", 38)], true);
check("quiet: marked, not told", q.reached.length === 0 && q.fired.length === 2 && q.fired.every((f) => !f.told));
const q2 = advanceShare(steps, q.fired, "PTL", 50, [d("2026-10-02", 37)]);
check("after a quiet start only new steps are told", q2.reached.length === 0);
check("other shares' steps are left alone", advanceShare(steps, [{ symbol: "MEBL", move: 30, at: "2026-10-01", close: 1, anchor: 1, told: true } as Fired], "PTL", 50, [d("2026-10-02", 49)]).fired.length === 0);

const st = standing(steps, -23);
check("standing at −23%: at −20, next −30 down, +10 up", st.at?.move === -20 && st.down?.move === -30 && st.up?.move === 10);
check("shares a step adds or sells: a % of those held, at least one; hold none", stepShares(248, steps.find((s) => s.move === -20)!) === 24 && stepShares(3, steps.find((s) => s.move === 30)!) === 1 && stepShares(248, steps.find((s) => s.move === -10)!) === 0);

const since = holdingSince([
  { date: "2025-09-01", type: "BUY", shares: 100 },
  { date: "2025-12-01", type: "SELL", shares: -100 },
  { date: "2026-02-10", type: "BUY", shares: 50 },
  { date: "2026-05-01", type: "BUY", shares: 50 },
  { date: "2026-06-01", type: "SELL", shares: -30 },
]);
check("the shares held now began after the last time none were held", since === "2026-02-10", since);
check("nothing held, no start", holdingSince([{ date: "2025-09-01", type: "BUY", shares: 10 }, { date: "2025-10-01", type: "SELL", shares: -10 }]) === null);

// Dividends: the fall on an ex-date is not a loss.
const dv = advanceShare(steps, [], "MUREB", 100, [d("2026-10-20", 92), d("2026-10-21", 88)], false, (day) => (day >= "2026-10-21" ? 5 : 0));
check("a 12% fall that is 5 of dividend reads −7%: no −10 step", dv.reached.length === 0 && dv.fired.length === 0, dv);
const dv2 = advanceShare(steps, [], "MUREB", 100, [d("2026-10-21", 74.9)], false, () => 5);
check("past −20 with the dividend counted: told, with it", dv2.reached[0]?.steps.map((s) => s.move).join() === "-10,-20" && dv2.reached[0].div === 5 && Math.abs(dv2.reached[0].move + 20.1) < 1e-9, dv2.reached[0]);
const dmsg = ruleMessage({ symbol: "MUREB", date: "2026-10-21", close: 75, move: -20, steps: [steps.find((s) => s.move === -20)!], div: 5 }, { shares: 662, avgCost: 100 }, "");
check("the message says the dividends were counted", dmsg.includes("close 75.00 + Rs 5.00 dividends a share"), dmsg);
const buys = [{ date: "2025-11-13", type: "BUY", shares: 600 }, { date: "2026-03-02", type: "BUY", shares: 62 }];
const onLedger = dividendsOn({ shares: 662, ledger: 662 * 25.5, txs: [...buys, { date: "2026-03-10", type: "DIVIDEND", shares: 662 }], events: [{ date: "2026-03-09", cash: 30 }], taxPct: 15, today: "2026-03-20" });
check("on the ledger: the ledger's dividends a share, the exchange's record not added again", near(onLedger("2026-03-20"), 25.5), onLedger("2026-03-20"));
const owed = dividendsOn({ shares: 662, ledger: 0, txs: buys, events: [{ date: "2026-10-20", cash: 30 }], taxPct: 15, today: "2026-10-20" });
check("gone ex, not on the ledger yet: the exchange's figure after tax, from the ex-date", near(owed("2026-10-19"), 0) && near(owed("2026-10-20"), 25.5), [owed("2026-10-19"), owed("2026-10-20")]);
const boughtEx = dividendsOn({ shares: 662, ledger: 0, txs: [{ date: "2025-11-13", type: "BUY", shares: 600 }, { date: "2026-10-20", type: "BUY", shares: 62 }], events: [{ date: "2026-10-20", cash: 30 }], taxPct: 15, today: "2026-10-21" });
check("shares bought on the ex-date get none of it", near(boughtEx("2026-10-21"), (600 * 30 * 0.85) / 662), boughtEx("2026-10-21"));
const soldSince = dividendsOn({ shares: 300, ledger: 0, txs: [{ date: "2025-11-13", type: "BUY", shares: 600 }, { date: "2026-10-21", type: "SELL", shares: -300 }], events: [{ date: "2026-10-20", cash: 30 }], taxPct: 15, today: "2026-10-22" });
check("shares sold after the ex-date take their part", near(soldSince("2026-10-22"), 25.5), soldSince("2026-10-22"));
check("an old dividend missing from the ledger is not guessed", near(dividendsOn({ shares: 600, ledger: 0, txs: [{ date: "2025-01-01", type: "BUY", shares: 600 }], events: [{ date: "2026-03-09", cash: 30 }], taxPct: 15, today: "2026-10-27" })("2026-10-27"), 0));

// Checks.
const market = Array.from({ length: 30 }, (_, k) => [{ fiscalYear: 2025, eps: 10 + (k % 5) }, { fiscalYear: 2024, eps: 10 }]);
const usual = usualEpsMove(market);
check("companies' usual yearly EPS move is the median of the moves kept", near(usual, 20), usual);
check("too few companies: no usual move", usualEpsMove(market.slice(0, 5)) === null);
const steady = profitCheck([{ fiscalYear: 2026, eps: 4.1 }, { fiscalYear: 2025, eps: 4.3 }], 20);
check("profit −4.7% against a usual 20%: steady", steady != null && !steady.alot && near(steady.changePct, (4.1 / 4.3 - 1) * 100));
check("profit −52%: a lot", profitCheck([{ fiscalYear: 2026, eps: 2.05 }, { fiscalYear: 2025, eps: 4.3 }], 20)?.alot === true);
check("a loss after a profit is a lot, whatever the usual", profitCheck([{ fiscalYear: 2026, eps: -1 }, { fiscalYear: 2025, eps: 4 }], null)?.alot === true);
check("years not next to each other: no check", profitCheck([{ fiscalYear: 2026, eps: 4 }, { fiscalYear: 2024, eps: 4 }], 20) === null);
const div = [{ fyEndYear: 2026, label: "FY25-26", dps: 4, complete: true }, { fyEndYear: 2025, label: "FY24-25", dps: 4, complete: true }, { fyEndYear: 2027, label: "FY26-27", dps: 2, complete: false }];
check("dividend: the last two full years, kept", dividendCheck(div)?.alot === false && dividendCheck(div)?.label === "FY25-26");
check("dividend cut by more than half: a lot", dividendCheck([{ fyEndYear: 2026, label: "FY25-26", dps: 1.5, complete: true }, { fyEndYear: 2025, label: "FY24-25", dps: 4, complete: true }])?.alot === true);
check("rates: a move of 2 points or more is a lot", moveCheck(11, 13, 2, false)?.alot === true && moveCheck(11, 12, 2, false)?.alot === false);
check("rupee: a % move against the limit", moveCheck(280, 312, 10, true)?.alot === true && near(moveCheck(280, 284, 10, true)?.change, (284 / 280 - 1) * 100));
const calm = combine({ profit: steady, dividend: dividendCheck(div), rate: moveCheck(11, 11, 2, false), rupee: moveCheck(281, 282, 10, true) });
check("the steady line names each check", !calm.alot && checksLine(calm).startsWith("✓ Steady: profit −5% (EPS 4.10 vs 4.30), dividend kept, policy rate 11.0% → 11.0%, rupee weaker by 0.4%"), checksLine(calm));
const loud = combine({ profit: profitCheck([{ fiscalYear: 2026, eps: 2.05 }, { fiscalYear: 2025, eps: 4.3 }], 20), dividend: null, rate: moveCheck(11, 14, 2, false), rupee: null });
check("a big change comes first, with what moved", loud.alot && checksLine(loud).startsWith("⚠ Check first: profit −52% (EPS 2.05 vs 4.30), more than the usual 20%; policy rate 11.0% → 14.0%"), checksLine(loud));
check("the page's facts: label, steady or not, and the numbers", checkFacts(loud).map((c) => `${c.label}${c.ok ? "+" : "!"}`).join() === "Profit!,Rates!");

const msg = ruleMessage({ symbol: "PTL", date: "2026-10-05", close: 39.9, move: -20.2, steps: [steps.find((s) => s.move === -20)!] }, { shares: 248, avgCost: 50 }, checksLine(calm));
check("the message: the move, the rule, the shares and the checks", msg.includes("PTL</b> −20.2% from your average 50.00") && msg.includes("add 10% at −20% = add 24 shares (≈ Rs 958)") && msg.includes("✓ Steady"), msg);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
