// The user's price rules (lib/models/PriceRules): steps away from a share's
// average price, each with what to do there: hold, add a % of the shares
// held, or sell a % of them. Pure, so scripts/test-rules.ts runs it.
//   A step is reached on a close at or past it. It is told once, and again
//   only after a close back at the average price, which ends that fall or
//   rise. Steps a share is already past when the rules start (or change) are
//   marked without a message.
//   A share is measured with the dividends its shares have been paid added
//   back (dividendsOn), so the fall on an ex-date is not taken for a loss.
//   The average price stays what was paid: the dividend is already counted
//   once, as cash.

export type RuleAction = "hold" | "add" | "sell";
export type Step = { move: number; action: RuleAction; sizePct: number };
export type Fired = { symbol: string; move: number; at: string; close: number; anchor: number; told: boolean; div?: number };
export type Reached = { symbol: string; date: string; close: number; move: number; steps: Step[]; div?: number };

// The user's own rules, as they gave them.
export const DEFAULT_STEPS: Step[] = [
  { move: -10, action: "hold", sizePct: 0 },
  { move: -20, action: "add", sizePct: 10 },
  { move: -30, action: "add", sizePct: 20 },
  { move: -40, action: "add", sizePct: 30 },
  { move: -50, action: "add", sizePct: 50 },
  { move: 10, action: "hold", sizePct: 0 },
  { move: 20, action: "hold", sizePct: 0 },
  { move: 30, action: "sell", sizePct: 10 },
  { move: 40, action: "sell", sizePct: 20 },
  { move: 50, action: "sell", sizePct: 30 },
  { move: 60, action: "sell", sizePct: 40 },
];

// Falls from the deepest up, then rises from the nearest out; one step per
// move; adds only on falls and sells only on rises.
export function cleanSteps(raw: Array<{ move: number; action: string; sizePct?: number }>): Step[] {
  const seen = new Set<number>();
  return raw
    .map((s) => ({ move: Math.round(Number(s.move) * 10) / 10, action: (["hold", "add", "sell"].includes(s.action) ? s.action : "hold") as RuleAction, sizePct: Math.max(0, Math.min(100, Number(s.sizePct) || 0)) }))
    .filter((s) => Number.isFinite(s.move) && s.move !== 0 && s.move > -100 && s.move <= 1000)
    .filter((s) => !(s.action === "add" && s.move > 0) && !(s.action === "sell" && s.move < 0))
    .map((s) => (s.action === "hold" ? { ...s, sizePct: 0 } : s))
    .filter((s) => (seen.has(s.move) ? false : (seen.add(s.move), true)))
    .sort((a, b) => a.move - b.move)
    .slice(0, 20);
}

export const movePct = (close: number, anchor: number) => (close / anchor - 1) * 100;
const past = (s: Step, m: number) => (s.move < 0 ? m <= s.move : m >= s.move);

// Moves one share's told steps on through the days. `quiet` marks what is
// reached without telling it (the first run, or after the rules change).
export function advanceShare(steps: Step[], fired: Fired[], symbol: string, anchor: number, days: Array<{ date: string; close: number }>, quiet = false, divOn: (date: string) => number = () => 0): { fired: Fired[]; reached: Reached[] } {
  let mine = fired.filter((f) => f.symbol === symbol);
  const reached: Reached[] = [];
  if (!(anchor > 0)) return { fired: mine, reached };
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!(d.close > 0)) continue;
    const div = divOn(d.date);
    const m = movePct(d.close + div, anchor);
    if (m >= 0) mine = mine.filter((f) => f.move > 0);
    if (m <= 0) mine = mine.filter((f) => f.move < 0);
    const told = new Set(mine.map((f) => f.move));
    const newly = steps.filter((s) => !told.has(s.move) && past(s, m)).sort((a, b) => Math.abs(a.move) - Math.abs(b.move));
    if (newly.length === 0) continue;
    for (const s of newly) mine.push({ symbol, move: s.move, at: d.date, close: d.close, anchor, told: !quiet, ...(div > 0 ? { div } : {}) });
    if (!quiet) reached.push({ symbol, date: d.date, close: d.close, move: m, steps: newly, ...(div > 0 ? { div } : {}) });
  }
  return { fired: mine, reached };
}

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// The dividends the shares held have been paid, a share, after tax, as of a
// day: the ledger's (as the holdings table counts them), and any the
// exchange shows went ex by then that is not on the ledger yet (the price
// falls on the ex-date; the dividend is recorded at the book closure, or
// when it is paid; so only the last 45 days' are looked for). A dividend
// follows the shares that earned it: shares sold since take their part.
export function dividendsOn(i: {
  shares: number;
  ledger: number;
  txs: Array<{ date: string; type: string; shares: number; ratio?: string }>;
  events: Array<{ date: string; cash: number }>;
  taxPct: number;
  today: string;
}): (date: string) => number {
  if (!(i.shares > 0)) return () => 0;
  const txs = [...i.txs].sort((a, b) => a.date.localeCompare(b.date));
  const recorded = txs.filter((t) => t.type === "DIVIDEND").map((t) => t.date);
  const owed = i.events
    .filter((e) => e.cash > 0 && e.date > addDays(i.today, -45) && e.date <= i.today && !recorded.some((d) => d >= addDays(e.date, -3) && d <= addDays(e.date, 45)))
    .map((e) => {
      let n = 0, pot: number | null = null;
      for (const t of txs) {
        if (pot == null && t.date >= e.date) pot = e.cash * n * (1 - i.taxPct / 100);
        const k = Math.abs(t.shares);
        if (t.type === "BUY" || t.type === "RIGHT" || t.type === "BONUS") n += k;
        else if (t.type === "SELL") {
          if (pot != null && n > 0) pot *= Math.max(0, 1 - k / n);
          n = Math.max(0, n - k);
        } else if (t.type === "SPLIT") {
          const [a, b] = String(t.ratio ?? "").split(":").map(Number);
          if (a > 0 && b > 0) n = (n * b) / a;
        }
      }
      return { date: e.date, amount: pot ?? e.cash * n * (1 - i.taxPct / 100) };
    })
    .filter((x) => x.amount > 0);
  return (date: string) => (i.ledger + owed.filter((x) => x.date <= date).reduce((s, x) => s + x.amount, 0)) / i.shares;
}

// The step a share stands at now, and the next one each way.
export function standing(steps: Step[], m: number): { at: Step | null; down: Step | null; up: Step | null } {
  const falls = steps.filter((s) => s.move < 0).sort((a, b) => b.move - a.move);
  const rises = steps.filter((s) => s.move > 0).sort((a, b) => a.move - b.move);
  const at = m < 0 ? [...falls].reverse().find((s) => m <= s.move) ?? null : m > 0 ? [...rises].reverse().find((s) => m >= s.move) ?? null : null;
  return { at, down: falls.find((s) => m > s.move) ?? null, up: rises.find((s) => m < s.move) ?? null };
}

// The shares a step adds or sells: its % of those held, at least one.
export const stepShares = (held: number, s: Step) => (s.action === "hold" || held <= 0 || s.sizePct <= 0 ? 0 : s.action === "sell" ? Math.min(held, Math.max(1, Math.floor((held * s.sizePct) / 100))) : Math.max(1, Math.floor((held * s.sizePct) / 100)));

export const stepText = (s: Step) => (s.action === "hold" ? "hold" : `${s.action} ${s.sizePct}%`);
export const signedPct = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`;
const money = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dayLabel = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// The date the shares held now began: after the last time none were held.
export function holdingSince(txs: Array<{ date: string; type: string; shares: number; ratio?: string }>): string | null {
  let n = 0, since: string | null = null;
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    const before = n;
    if (t.type === "BUY" || t.type === "RIGHT" || t.type === "BONUS") n += Math.abs(t.shares);
    else if (t.type === "SELL") n -= Math.abs(t.shares);
    else if (t.type === "SPLIT") {
      const [a, b] = String(t.ratio ?? "").split(":").map(Number);
      if (a > 0 && b > 0) n = (n * b) / a;
    }
    if (n < 1e-9) n = 0;
    if (before <= 0 && n > 0) since = t.date;
    if (n <= 0) since = null;
  }
  return since;
}

// What Telegram says for a share's steps reached on a day, with the checks
// on what changed since the shares were bought.
export function ruleMessage(r: Reached, held: { shares: number; avgCost: number }, checks: string): string {
  const acts = r.steps.filter((s) => s.action !== "hold");
  const fall = r.move < 0;
  const lines = [`${fall ? "📉" : "📈"} <b>${esc(r.symbol)}</b> ${signedPct(r.move)} ${fall ? "from" : "over"} your average ${money(held.avgCost)} (close ${money(r.close)}${r.div ? ` + Rs ${money(r.div)} dividends a share` : ""}, ${dayLabel(r.date)}).`];
  const n = acts.reduce((s, x) => s + stepShares(held.shares, x), 0);
  const verb = acts[0]?.action === "sell" ? "sell" : "add";
  lines.push(`   Your rule${acts.length > 1 ? "s" : ""}: ${acts.map((s) => `${stepText(s)} at ${signedPct(s.move, 0)}`).join(", ")} = ${verb} ${n.toLocaleString("en-US")} shares (≈ Rs ${Math.round(n * r.close).toLocaleString("en-US")}).`);
  if (checks) lines.push(`   ${checks}`);
  return lines.join("\n");
}
