// The indexes' levels for the week and the month ahead (lib/index-week).
//
//   npx tsx scripts/test-index-week.ts

import { ewmaSigma, weightedQuantile, levelsNow, walkForward, summarise, isoWeek, weekEnds, hitsOf, outcomeAfter, type Close } from "../lib/index-week/forecast";
import { weekMessage, weekMessageDue, type IndexForecasts } from "../lib/index-week/message";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

// A seeded random walk on weekdays, its volatility changing in spells.
function walk(n: number, seed = 7): Close[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const out: Close[] = [];
  let level = 40_000, t = Date.parse("2010-01-04T00:00:00Z");
  for (let k = 0; out.length < n; k++, t += 86400000) {
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) continue;
    const vol = 0.009 + 0.008 * (Math.floor(out.length / 250) % 2);
    level *= Math.exp(vol * gauss());
    out.push({ date: new Date(t).toISOString().slice(0, 10), close: Math.round(level * 100) / 100 });
  }
  return out;
}

check("ISO weeks: mid-October, the year's first, a 53rd", isoWeek("2026-10-12") === "2026-W42" && isoWeek("2026-10-16") === "2026-W42" && isoWeek("2026-01-01") === "2026-W01" && isoWeek("2027-01-01") === "2026-W53");
check("a weighted quantile", weightedQuantile([1, 2, 3, 4], [1, 1, 1, 1], 0.5) === 2 && weightedQuantile([1, 2, 3, 4], [0, 0, 1, 3], 0.5) === 4 && weightedQuantile([5, 1, 3], [1, 1, 1], 0.1) === 1);

const flat: Close[] = Array.from({ length: 60 }, (_, k) => ({ date: `2026-01-${String(k + 1).padStart(2, "0")}`, close: k % 2 ? 101 : 100 }));
const sig = ewmaSigma(flat, 0.94);
check("volatility: none before 20 days, then about the day's move", Number.isNaN(sig[10]) && Math.abs(sig[40] - Math.log(101 / 100)) < 0.001, sig[40]);

const w = walk(1500);
const ends = weekEnds(w);
check("week ends: the last session before a new week", ends.length > 250 && ends.every((k) => isoWeek(w[k].date) !== isoWeek(w[k + 1].date) && isoWeek(w[k].date) === isoWeek(w[k - 1]?.date ?? w[k].date)));
const now = levelsNow(w, 5)!;
check("levels in order: deep buy, usual buy, close, usual sell, high sell; the range around the middle", now.buy[0] <= now.buy[1] && now.buy[1] <= now.close && now.close <= now.sell[0] && now.sell[0] <= now.sell[1] && now.range[0] < now.mid && now.mid < now.range[1], now);
const month = levelsNow(w, 20)!;
check("a month's range is wider than a week's", month.range[1] - month.range[0] > now.range[1] - now.range[0]);
check("not enough history: no levels", levelsNow(w.slice(0, 200), 5) === null);

const rows = walkForward(w, 5);
const s = summarise(rows);
check("walk-forward on a random walk: the close inside the range about 8 times in 10", Math.abs(s.range - 0.8) <= 0.06, s);
check("the low reaches the usual buy level about half the time, the deep one about 1 in 5", Math.abs(s.buy - 0.5) <= 0.08 && Math.abs(s.deep - 0.2) <= 0.06, s);
check("the high reaches the usual sell level about half the time", Math.abs(s.sell - 0.5) <= 0.08 && Math.abs(s.high - 0.2) <= 0.06, s);
check("each week's levels use only the days before it", rows.every((r) => r.levels.asOf < r.outcome.date));

const o = outcomeAfter(w, 100, 5)!;
check("what followed: the close h sessions on, the lowest and highest close on the way", o.date === w[105].date && o.close === w[105].close && o.low === Math.min(...w.slice(101, 106).map((c) => c.close)) && o.high === Math.max(...w.slice(101, 106).map((c) => c.close)));
const h = hitsOf({ asOf: "x", close: 100, sessions: 5, sigmaPct: 2, range: [96, 104], mid: 100, buy: [95, 98], sell: [102, 105] }, { date: "y", close: 103, low: 97.5, high: 104 });
check("hits: inside, buy reached, deep not, sell reached, high not, the miss", h.range && h.buy && !h.deep && h.sell && !h.high && h.missPct === 3);

const view = {
  code: "KSE100", label: "KSE-100", date: "2026-10-16", close: 165_124.41, weekChangePct: 1.2,
  week: { ...now, range: [161_801, 170_197] as [number, number], buy: [162_301, 164_363] as [number, number], sell: [166_605, 168_907] as [number, number] },
  month: null,
  tested: { week: { ...s, n: 210, range: 0.78 }, weekLastYear: s, month: s },
  live: summarise([]),
  weeks: [{ levels: { ...now, range: [158_900, 167_400] as [number, number] }, outcome: { date: "2026-10-16", close: 165_124.41, low: 161_000, high: 166_000 }, hits: { ...h, range: true } }],
};
const f: IndexForecasts = { asOf: "2026-10-16", computedAt: "", indexes: [view, { ...view, code: "KMI30", label: "KMI-30", close: 237_814, week: { ...view.week, range: [232_395, 245_294] } }] };
const msg = weekMessage(f, "https://example.test")!;
check("the Friday message: the week, how its range did, next week's levels, the others, the record", msg.includes("closes of Fri 16 Oct") && msg.includes("<b>KSE-100 165,124</b> (+1.2% on the week)") && msg.includes("Week to Fri 16 Oct: range 158,900–167,400, closed 165,124: inside ✓") && msg.includes("Next week: likely 161,801–170,197 · buy 162,301–164,363 · sell 166,605–168,907") && msg.includes("KMI-30 237,814 · next week 232,395–245,294") && msg.includes("Inside the range 78% of 210 weeks tested (aim 80%) · https://example.test/analysis"), msg);
const at = (iso: string) => Date.parse(iso) - 5 * 3600_000; // a Karachi time
check("due on Friday once Friday's close is in", weekMessageDue(f, at("2026-10-16T20:00:00Z")) === "index-week:2026-W42");
check("due on the weekend whatever the week's last close was", weekMessageDue({ ...f, asOf: "2026-10-15" }, at("2026-10-17T09:00:00Z")) === "index-week:2026-W42");
check("not due midweek, nor on Friday before Friday's close, nor for last week", weekMessageDue({ ...f, asOf: "2026-10-14" }, at("2026-10-14T20:00:00Z")) === null && weekMessageDue({ ...f, asOf: "2026-10-15" }, at("2026-10-16T12:00:00Z")) === null && weekMessageDue({ ...f, asOf: "2026-10-09" }, at("2026-10-13T20:00:00Z")) === null);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
