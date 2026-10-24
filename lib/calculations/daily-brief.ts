// The evening brief on Telegram: the day's dashboard row in a few lines,
// after the close, so decisions are made with the market shut. Each move is
// set against a normal day (the median absolute daily change of the last
// three years) and only a move several times that is named. Pure, so
// scripts/test-daily-brief.ts runs it.

// The median absolute daily change, in %, over the last `n` changes.
export function normalDayPct(closes: number[], n = 750): number | null {
  const tail = closes.filter((c) => c > 0).slice(-(n + 1));
  const moves: number[] = [];
  for (let i = 1; i < tail.length; i++) moves.push(Math.abs(tail[i] / tail[i - 1] - 1) * 100);
  if (moves.length < 60) return null;
  moves.sort((a, b) => a - b);
  const m = moves.length >> 1;
  return moves.length % 2 ? moves[m] : (moves[m - 1] + moves[m]) / 2;
}

export const timesNormal = (changePct: number, normal: number | null) => (normal != null && normal > 0 ? Math.abs(changePct) / normal : null);

export type BriefInput = {
  date: string; // yyyy-mm-dd
  kse: { close: number; changePct: number; normalPct: number | null } | null;
  breadth: { up: number; down: number; same: number; valueRs: number } | null;
  book: { value: number; changeRs: number; changePct: number } | null;
  movers: Array<{ symbol: string; changePct: number; times: number }>;
  rates: { policy: number | null; tbill: number | null; cpi: number | null };
  world: Array<{ label: string; changePct: number; times: number | null; level?: string }>;
  next: Array<{ date: string; title: string }>;
};

// A move several times a normal day earns a mention.
export const BIG = 2.5;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string) => {
  const t = new Date(d + "T00:00:00Z");
  return `${DOW[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`;
};
const signed = (v: number, dp = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}`;
const rs = (v: number) => `Rs ${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const big = (v: number) => (v >= 1e9 ? `Rs ${(v / 1e9).toFixed(1)}bn` : `Rs ${(v / 1e6).toFixed(0)}m`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function dailyBrief(i: BriefInput): string {
  const lines: string[] = [];
  const head = `📊 <b>${day(i.date)}</b>`;
  if (i.kse) {
    const t = timesNormal(i.kse.changePct, i.kse.normalPct);
    const note = t != null && t >= BIG ? `, ${t.toFixed(1)}× a normal day` : i.kse.normalPct != null ? `, normal ±${i.kse.normalPct.toFixed(1)}%` : "";
    lines.push(`${head} · KSE-100 ${Math.round(i.kse.close).toLocaleString("en-US")} (${signed(i.kse.changePct, 2)}%${note})`);
  } else lines.push(head);
  if (i.breadth) lines.push(`Breadth ${i.breadth.up} up, ${i.breadth.down} down · ${big(i.breadth.valueRs)} traded`);
  if (i.book) lines.push(`Your shares ${rs(i.book.value)}: ${i.book.changeRs >= 0 ? "+" : "−"}${rs(i.book.changeRs)} (${signed(i.book.changePct)}%)`);
  const movers = i.movers.filter((m) => m.times >= BIG).sort((a, b) => b.times - a.times).slice(0, 4);
  if (movers.length) lines.push(`⚠ ${movers.map((m) => `${esc(m.symbol)} ${signed(m.changePct)}% (${m.times.toFixed(1)}× its normal)`).join(", ")}`);
  const r = i.rates;
  const rate = r.tbill ?? r.policy;
  const parts = [r.policy != null ? `policy ${r.policy.toFixed(2).replace(/\.?0+$/, "")}%` : "", r.tbill != null ? `T-bill ${r.tbill.toFixed(2).replace(/\.?0+$/, "")}%` : "", r.cpi != null ? `CPI ${r.cpi.toFixed(1)}%` : ""].filter(Boolean);
  if (parts.length) lines.push(`Rates: ${parts.join(" · ")}${r.policy != null && r.cpi != null ? ` · real ${signed(r.policy - r.cpi)}` : rate != null && r.cpi != null ? ` · real ${signed(rate - r.cpi)}` : ""}`);
  if (i.world.length) lines.push(`World: ${i.world.map((w) => `${w.label}${w.level ? ` ${w.level}` : ""} ${signed(w.changePct)}%${w.times != null && w.times >= BIG ? ` (${w.times.toFixed(1)}×)` : ""}`).join(" · ")}`);
  const next = [...i.next].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  if (next.length) lines.push(`Next: ${next.map((e) => `${e.date === i.date ? "today" : day(e.date)} ${esc(e.title)}`).join(" · ")}`);
  return lines.join("\n");
}
