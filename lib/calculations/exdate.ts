// Ex-dividend dates on the PSX and the Telegram line for one. Trades settle
// two working days after the deal (T+2), and the share register closes on the
// book-closure day, so the last day to buy with the dividend is two trading
// days before the book closure starts: from the next day the share trades
// ex-dividend. Pure, so scripts/test-exdate.ts runs it.

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const t = (d: string) => Date.parse(d.slice(0, 10) + "T00:00:00Z");

// Steps back over weekends and the exchange's holidays.
function tradingDaysBefore(date: string, n: number, holidays: Set<string>): string {
  let d = t(date);
  let left = n;
  while (left > 0) {
    d -= DAY;
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(iso(d))) left--;
  }
  return iso(d);
}

export function exDateOf(bookClosureStart: string, holidays: Set<string> = new Set()): { exDate: string; lastCumDate: string } {
  const exDate = tradingDaysBefore(bookClosureStart, 2, holidays);
  return { exDate, lastCumDate: tradingDaysBefore(exDate, 1, holidays) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const day = (d: string) => new Date(t(d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-US")}`;
const money = (v: number) => (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2));

// `held` is the shares you hold now; `taxPct` the tax withheld on dividends.
export function exDividendMessage(e: { symbol: string; bookClosure: string; pctOfFace: number; faceValue: number }, held: number, taxPct: number, today: string, holidays: Set<string> = new Set()): string {
  const { exDate, lastCumDate } = exDateOf(e.bookClosure, holidays);
  const dps = (e.pctOfFace * e.faceValue) / 100;
  const passed = exDate <= today;
  const head = passed
    ? `💰 <b>${esc(e.symbol)}</b> went ex-dividend on ${day(exDate)}: Rs ${money(dps)} a share (${e.pctOfFace}%), book closure from ${day(e.bookClosure)}.`
    : `💰 <b>${esc(e.symbol)}</b> goes ex-dividend on ${day(exDate)}: Rs ${money(dps)} a share (${e.pctOfFace}%). Hold it at the close of ${day(lastCumDate)} to be paid; book closure from ${day(e.bookClosure)}.`;
  if (!(held > 0)) return head;
  const gross = dps * held;
  return `${head}\n   On your ${held.toLocaleString("en-US")} shares: ${rs(gross)}, about ${rs(gross * (1 - taxPct / 100))} after ${taxPct}% tax.`;
}
