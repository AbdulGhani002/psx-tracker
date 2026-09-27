import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { AlertLogModel } from "@/lib/models";
import { getAppSettings, getZoneBoard, getDeploymentPlan, getStandInGroups, getPortfolioSummary, getAllHoldings, getUpcomingExDates, getAllUserIds, getIntrinsicValuations, getShariahStatus, getFeedSnapshot, saveFeedSnapshot, getNetWorth, getEffectiveInflationPct } from "@/lib/data";
import { getUsdPkr } from "@/lib/fx";
import { describeZone } from "@/lib/calculations/zones";
import { getPriceFreshness } from "@/lib/prices";
import { getFlows, getEarningsCalendar } from "@/lib/analytics";
import { realPct } from "@/lib/calculations/pk-tax";
import { getDecisionInbox, getSellDiscipline } from "@/lib/data-decisions";
import { runAsUser } from "@/lib/auth/current-user";
import { uid } from "@/lib/auth/uid";
import { sendTelegram } from "@/lib/notify/telegram";
import { cronAuthorised } from "@/lib/auth/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Candidate = { key: string; message: string };

// Which alerts this user wants. Every candidate carries a key whose prefix
// says what it is, so one filter at the end decides what goes out instead of
// nine scattered conditions.
const PRICE_KEYS = ["zone-buy", "zone-sell", "zone-conflict", "zone", "standin-swap", "drift", "near-ceiling", "near-buy", "fipi", "kmi-drop", "sellsig"];

function wanted(key: string, s: any): boolean {
  const prefix = key.split(":")[0];
  if (prefix === "board") return s.alertBoardMeetings !== false;
  if (prefix === "exdiv") return s.alertExDates !== false;
  if (prefix === "digest") return s.alertWeeklyDigest !== false;
  if (PRICE_KEYS.includes(prefix)) return s.alertPrices !== false;
  return true;
}

// Scheduled timer hits this. Runs the alert check for EVERY user (each with
// their own Telegram config, watchlist, holdings) and pushes deduped alerts.
export async function POST(req: Request) {
  // Machine-only: a logged-in session must not reach this. See lib/auth/cron.ts.
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  // Optional body {forceDigest:true} sends the weekly digest NOW (machine-only
  // endpoint, so this is an operator control, not a user surface).
  const force = await req.json().then((b) => b?.forceDigest === true).catch(() => false);
  const userIds = await getAllUserIds();
  let sent = 0;
  for (const uid of userIds) {
    const r = (await runAsUser(uid, () => runAlertsForCurrentUser(force))) as { sent?: number } | undefined;
    sent += r?.sent ?? 0;
  }
  // Deliberately aggregate-only: keying the response by user id leaked the whole
  // roster (and who has Telegram configured) to anyone who could call this.
  return NextResponse.json({ ok: true, users: userIds.length, sent });
}

// Checks watchlist target hits + rebalance drift + upcoming ex-dates for the
// CURRENT user, pushing deduped Telegram alerts (each key fires at most once
// per day, per user).
async function runAlertsForCurrentUser(forceDigest = false) {
  const settings: any = await getAppSettings();
  const token = settings.telegramBotToken ?? "";
  const chatId = settings.telegramChatId ?? "";
  if (!settings.alertsEnabled || !token || !chatId) {
    return { skipped: true, reason: "alerts_disabled_or_unconfigured" };
  }

  const today = new Date().toISOString().slice(0, 10);
  const candidates: Candidate[] = [];

  // 1. Watchlist ZONES — the bands decided in advance, on the calm day.
  //    A buy ping carries the sized order when the deployment plan could size
  //    it (target weight set, money above the fund reserve). A sell ping fires
  //    ONLY when the position is bigger than the floor set for that symbol:
  //    being told to sell 8 shares is noise the brokerage eats.
  //    Stale quotes never fire — a week-old price is not a band hit.
  //    Guarded like every other section: the watchlist now pulls prices, fund
  //    NAVs and the deployment plan, and none of that may take down the
  //    ex-dividend, board-meeting or digest alerts if a feed misbehaves.
  let board: Awaited<ReturnType<typeof getZoneBoard>> = {
    rows: [], buys: [], sells: [], heldAtCore: [], conflicts: [], unpriced: [],
  };
  try {
    board = await getZoneBoard();
  } catch {
    /* watchlist or price feed unavailable — the other alerts still run */
  }
  const monthKey = today.slice(0, 7);
  const plan = board.buys.length > 0 ? await getDeploymentPlan().catch(() => null) : null;
  for (const r of board.rows) {
    if (!r.alertsOn || r.priceStale || r.price == null) continue;
    if (r.status === "buy") {
      const sized = plan?.rows.find((x) => x.symbol === r.symbol);
      // Only say something when there is something to do. "No cash above your
      // reserve" was appended to every zone hit, four names a day, which turned
      // a useful price signal into a nightly reminder of one unchanged fact.
      // When the plan can size the buy, the order is spelled out; when it
      // cannot, the zone hit stands on its own.
      const how = sized
        ? `\n   → Plan: buy <b>${sized.shares.toLocaleString("en-PK")}</b> shares for Rs ${Math.round(sized.rupees).toLocaleString("en-PK")}` +
          (plan && plan.pullFromFunds > 0 ? ` (redeem Rs ${Math.round(plan.pullFromFunds).toLocaleString("en-PK")} from the fund)` : "")
        : r.targetPct > 0
        ? ""
        : `\n   → No target weight set, so it cannot be sized. Set one on Rebalance.`;
      candidates.push({
        key: `zone-buy:${r.symbol}:${today}`,
        message: `🟢 <b>${r.symbol}</b> is in your BUY zone — Rs ${r.price.toFixed(2)} (${describeZone(r.buyZoneLow, r.buyZoneHigh, "buy")})${how}`,
      });
    }
    if (r.sellableShares > 0) {
      const n = (v: number) => Math.round(v).toLocaleString("en-PK");
      // The instruction is a QUANTITY, not a nudge: everything above the core
      // you keep, with the money it actually returns after fees and CGT.
      const money = r.sell
        ? `\n   → Sell <b>${r.sellableShares.toLocaleString("en-PK")}</b> shares for Rs ${n(r.sell.proceeds)}. ` +
          `Gain Rs ${n(r.sell.gain)}, CGT Rs ${n(r.sell.cgt)} at ${r.sell.cgtRatePct}%, fees Rs ${n(r.sell.fees)} → ` +
          `<b>Rs ${n(r.sell.net)}</b> in hand. Keeps ${r.sell.remainingShares.toLocaleString("en-PK")}.`
        : `\n   → Sell <b>${r.sellableShares.toLocaleString("en-PK")}</b> shares, keeping ${(r.sharesHeld - r.sellableShares).toLocaleString("en-PK")}. ` +
          `The exact gain could not be matched to your lots — check the holding page.`;
      candidates.push({
        key: `zone-sell:${r.symbol}:${today}`,
        message:
          `🔴 <b>${r.symbol}</b> is in your SELL zone — Rs ${r.price.toFixed(2)} (${describeZone(r.sellZoneLow, r.sellZoneHigh, "sell")}). ` +
          `You hold ${r.sharesHeld.toLocaleString("en-PK")}` +
          (r.minHoldingShares > 0 ? `, keeping a core of ${r.minHoldingShares.toLocaleString("en-PK")}` : "") +
          `.${money}\n   The sale still needs a logged rationale.`,
      });
    }
    // Contradictory bands cannot produce an instruction, so say so — monthly,
    // not daily, because it is a config fix rather than a market event.
    if (r.status === "conflict" && r.warnings.length > 0) {
      candidates.push({
        key: `zone-conflict:${r.symbol}:${monthKey}`,
        message: `⚠️ <b>${r.symbol}</b>: ${r.warnings[0]} No buy or sell signal is given until that is fixed.`,
      });
    }
  }

  // 1.5 Stand-in swaps: a peer was bought to hold a sector while the name you
  //     actually wanted sat above its band. The moment that name comes into
  //     range the position reverses, and that is a decision worth interrupting
  //     for — sell this, buy that, here is what it leaves. Re-armed weekly so
  //     it nags until acted on, not once and forgotten.
  try {
    const { groups } = await getStandInGroups();
    const week = isoWeekKey(new Date());
    for (const g of groups) {
      if (!g.swapReady || !g.swap) continue;
      const n = (v: number) => Math.round(v).toLocaleString("en-PK");
      const tax =
        g.swap.cgt != null
          ? `less fees Rs ${n(g.swap.sellFees)} and CGT Rs ${n(g.swap.cgt)}`
          : `less fees Rs ${n(g.swap.sellFees)} (gain unmatched, no tax shown)`;
      candidates.push({
        key: `standin-swap:${g.standIn}->${g.primary}:${week}`,
        message:
          `🔄 <b>${g.primary}</b> is in its buy band — time to swap back out of <b>${g.standIn}</b>.\n` +
          `   → Sell ${g.swap.sellShares.toLocaleString("en-PK")} ${g.standIn} for Rs ${n(g.swap.proceeds)}, ${tax} → Rs ${n(g.swap.netFromSale)} in hand.\n` +
          `   → That buys <b>${g.swap.buyShares.toLocaleString("en-PK")}</b> ${g.primary} at Rs ${g.swap.buyPrice.toFixed(2)} (Rs ${n(g.swap.totalOutlay)} with fees).` +
          (g.swap.shortfall > 0 ? `\n   Still Rs ${n(g.swap.shortfall)} short of the full ${g.targetPct}% target.` : "") +
          `\n   The sale needs a logged rationale like any other.`,
      });
    }
  } catch {
    /* stand-in data unavailable — the other alerts still run */
  }

  // 2. Rebalance drift (position beyond its band)
  //    One message a week listing everything out of band, not one message per
  //    name per night. Drift is slow; seven separate pings every evening about
  //    the same seven positions was noise that trained the reader to ignore the
  //    channel, and the buy-zone hits were drowning in it.
  const [summary, holdings] = await Promise.all([getPortfolioSummary(), getAllHoldings()]);
  const bandBySymbol = new Map(holdings.map((h) => [h.symbol, (h as any).rebalanceBand ?? 3]));
  const drifted: string[] = [];
  for (const p of summary.positions) {
    if (p.shares <= 0 || p.targetPercent <= 0) continue;
    const band = bandBySymbol.get(p.symbol) ?? 3;
    if (Math.abs(p.deviation) > band) {
      const dir = p.deviation > 0 ? "over" : "under";
      drifted.push(`${p.symbol} ${dir} — ${p.currentPercent.toFixed(1)}% vs ${p.targetPercent}% (±${band}%)`);
    }
  }
  if (drifted.length > 0) {
    candidates.push({
      key: `drift:all:${isoWeekKey(new Date())}`,
      message: `⚖️ <b>Out of band this week</b> (${drifted.length}):\n` + drifted.map((d) => `   ${d}`).join("\n"),
    });
  }

  // 3. Upcoming ex-dividend / book-closure (next 14 days). Deduped by symbol+date
  //    so each entitlement is announced once, not every day.
  let exDatesAhead: Awaited<ReturnType<typeof getUpcomingExDates>> = [];
  try {
    const exDates = await getUpcomingExDates(14);
    exDatesAhead = exDates;
    for (const e of exDates) {
      const dps = (e.pctOfFace / 100) * e.faceValue;
      candidates.push({
        key: `exdiv:${e.symbol}:${e.date}`,
        message: `💰 <b>${e.symbol}</b> ex-dividend ${e.date} — ${e.pctOfFace}% (Rs ${dps.toFixed(2)}/share). Hold before book closure to qualify.`,
      });
    }
  } catch {
    /* best-effort */
  }

  // 4. Buying-zone entries: a held or watchlisted stock whose blended intrinsic
  //    valuation says it's now in a buy zone. Keyed by month so a stock that
  //    stays cheap doesn't ping every single day.
  try {
    const month = today.slice(0, 7);
    const mine = new Set([...board.rows.map((r) => r.symbol), ...summary.positions.filter((p) => p.shares > 0).map((p) => p.symbol)]);
    const iv = await getIntrinsicValuations();
    // A "buy zone" verdict is price ÷ intrinsic — if the price is a week-old
    // fallback snapshot, the verdict is stale arithmetic, not a signal. Skip.
    const freshness = await getPriceFreshness([...mine]);
    for (const it of iv.items) {
      if (!mine.has(it.symbol)) continue;
      const f = freshness.get(it.symbol);
      if (f && f.ageDays >= 7) continue;
      if (it.zone === "strong buy" || it.zone === "buy") {
        candidates.push({
          key: `zone:${it.symbol}:${it.zone}:${month}`,
          message: `🟢 <b>${it.symbol}</b> is in a ${it.zone.toUpperCase()} zone — Rs ${Number(it.price).toFixed(2)} vs intrinsic Rs ${Number(it.intrinsic).toFixed(0)}`,
        });
      }
    }
  } catch {
    /* valuations unavailable — skip */
  }

  // 4.5 Plan proximity: your OWN pre-committed levels, approaching. The price
  //     trigger fires AT the ceiling; this is the heads-up 3% out, so the
  //     decision gets thought about before the day it's due. Fires only where
  //     a plan exists (levels are never guessed), skips week-old prices, and
  //     re-arms weekly.
  try {
    const { positions } = await getSellDiscipline();
    const withPlans = positions.filter((p) => p.signal.fairValueHigh != null || p.signal.fairValueLow != null);
    if (withPlans.length > 0) {
      const fresh = await getPriceFreshness(withPlans.map((p) => p.signal.symbol));
      const week = isoWeekKey(new Date());
      for (const p of withPlans) {
        const s = p.signal;
        if (s.price <= 0) continue;
        const f = fresh.get(s.symbol);
        if (f && f.ageDays >= 7) continue;
        if (s.fairValueHigh != null && s.price < s.fairValueHigh && s.price >= s.fairValueHigh * 0.97) {
          candidates.push({
            key: `near-ceiling:${s.symbol}:${week}`,
            message: `📏 <b>${s.symbol}</b> Rs ${s.price.toFixed(2)} is within 3% of YOUR Rs ${s.fairValueHigh} ceiling. Decide the trim before the day it hits.`,
          });
        }
        if (s.fairValueLow != null && s.price > s.fairValueLow && s.price <= s.fairValueLow * 1.03) {
          candidates.push({
            key: `near-buy:${s.symbol}:${week}`,
            message: `📏 <b>${s.symbol}</b> Rs ${s.price.toFixed(2)} is within 3% of YOUR Rs ${s.fairValueLow} buy level.`,
          });
        }
      }
    }
  } catch {
    /* discipline data unavailable — skip */
  }

  // 5. Foreign-flow streaks (FIPI): sustained foreign buying/selling is a
  //    regime signal. Fires only as the streak crosses 3/5/7/10 sessions.
  try {
    const flows = await getFlows(30);
    if (flows && [3, 5, 7, 10].includes(flows.streak) && flows.streak_side !== "flat") {
      const emoji = flows.streak_side === "buying" ? "🟩" : "🟥";
      candidates.push({
        key: `fipi:${flows.streak_side}:${flows.streak}:${flows.latest}`,
        message: `${emoji} Foreigners net ${flows.streak_side} <b>${flows.streak} sessions straight</b> (latest ${flows.fipi_today >= 0 ? "+" : ""}$${Math.abs(flows.fipi_today).toFixed(1)}m)`,
      });
    }
  } catch {
    /* analytics down — skip */
  }

  // 6. KMI drop-outs: a held share leaving the Meezan-screened KMI universe is
  //    exactly the moment a Shariah-conscious holder must act (exit/purify), and
  //    the semi-annual recomposition is otherwise silent. We diff against the
  //    last KNOWN membership snapshot; when the market-watch feed is down every
  //    row reads null and we skip entirely — a data outage must never read as
  //    "everything left the index".
  try {
    const sh = await getShariahStatus();
    const known = sh.holdings.filter((h) => h.compliant !== null && h.shares > 0);
    if (known.length > 0) {
      const myKey = `kmiMembers:${await uid()}`;
      const prev = await getFeedSnapshot<string[]>(myKey);
      const cur = known.filter((h) => h.compliant === true).map((h) => h.symbol);
      const curSet = new Set(cur);
      const month = today.slice(0, 7);
      for (const sym of prev.data ?? []) {
        const stillTracked = known.some((h) => h.symbol === sym);
        if (stillTracked && !curSet.has(sym)) {
          candidates.push({
            key: `kmi-drop:${sym}:${month}`,
            message: `🕌 <b>${sym}</b> has left the KMI Shariah universe (index recomposition). Review it: exit or purify per your policy — see the Shariah page.`,
          });
        }
      }
      await saveFeedSnapshot(myKey, cur, "ok", `${cur.length} compliant holdings`).catch(() => {});
    }
  } catch {
    /* shariah data unavailable — skip, never guess membership */
  }

  // 7. Board meetings for HELD stocks in the next 7 days — the one date an
  //    investor must not miss. From the PSX announcements the analytics service
  //    already collects. Deduped per meeting, so it pings once, not daily.
  let boardAhead: Array<{ symbol: string; date: string; purpose: string }> = [];
  try {
    const cal = await getEarningsCalendar();
    const heldSet = new Set(summary.positions.filter((x) => x.shares > 0).map((x) => x.symbol));
    const weekOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    boardAhead = (cal?.upcoming ?? []).filter((e) => heldSet.has(e.symbol) && e.date >= today && e.date <= weekOut);
    for (const e of boardAhead) {
      candidates.push({
        key: `board:${e.symbol}:${e.date}`,
        message: `📋 <b>${e.symbol}</b> board meeting ${e.date} — ${String(e.purpose || "announcement").slice(0, 90)}`,
      });
    }
  } catch {
    /* calendar unavailable — skip */
  }

  // 7.5 Sell-discipline: fired triggers, expired cash, due re-buy reviews —
  //     each becomes a Telegram nag, re-armed WEEKLY until a decision is logged
  //     (the suppression window lives in the engine, the weekly re-nag here).
  let decisionCards = 0;
  try {
    const inbox = await getDecisionInbox();
    decisionCards = inbox.cards.filter((c) => c.severity === "action").length + inbox.reviewsDue.length;
    const week = isoWeekKey(new Date());
    for (const card of inbox.cards) {
      if (card.severity !== "action") continue;
      candidates.push({
        key: `sellsig:${card.type}:${card.symbol}:${week}`,
        message: `🧭 ${card.message}\n→ Clear it on the Decisions page — sell, trim, or log "hold" with your reasoning.`,
      });
    }
  } catch {
    /* discipline data unavailable — skip */
  }

  // 8. Friday weekly digest (Pakistan time) — the portfolio's week in one
  //    message. Every number is the same live figure the site shows; the real
  //    return uses the PBS CPI feed. Deduped by ISO week.
  try {
    const pktDay = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", weekday: "short" }).format(new Date());
    if (forceDigest || pktDay === "Fri") {
      const [netWorth, inf, usdPkr] = await Promise.all([
        getNetWorth().catch(() => null),
        getEffectiveInflationPct().catch(() => ({ pct: null as number | null, source: "none", period: null })),
        getUsdPkr().catch(() => null),
      ]);
      const held = summary.positions.filter((x) => x.shares > 0 && x.priceKnown);
      const best = [...held].sort((a, b) => b.unrealizedPct - a.unrealizedPct)[0];
      const worst = [...held].sort((a, b) => a.unrealizedPct - b.unrealizedPct)[0];
      const lines: string[] = ["📬 <b>Weekly digest</b>"];
      if (netWorth) {
        const usd = usdPkr ? ` (≈ $${Math.round(netWorth.total / usdPkr).toLocaleString()})` : "";
        lines.push(`Net worth <b>Rs ${Math.round(netWorth.total).toLocaleString()}</b>${usd} — equities ${Math.round(netWorth.equity).toLocaleString()}, funds ${Math.round(netWorth.funds).toLocaleString()}, savings ${Math.round(netWorth.savings).toLocaleString()}`);
      }
      const plPct = summary.totalCost > 0 ? (summary.unrealizedPL / summary.totalCost) * 100 : null;
      lines.push(`Unrealised ${summary.unrealizedPL >= 0 ? "+" : ""}Rs ${Math.round(summary.unrealizedPL).toLocaleString()}${plPct != null ? ` (${plPct >= 0 ? "+" : ""}${plPct.toFixed(1)}%)` : ""} · dividends banked Rs ${Math.round(summary.dividendsTotal).toLocaleString()}`);
      if (summary.xirr != null) {
        const realX = inf.pct != null ? realPct(summary.xirr * 100, inf.pct) : null;
        lines.push(`XIRR ${(summary.xirr * 100).toFixed(1)}%${realX != null ? ` — real ${realX >= 0 ? "+" : ""}${realX.toFixed(1)}% after ${inf.pct!.toFixed(1)}% CPI` : ""}`);
      }
      if (best && worst && best.symbol !== worst.symbol) {
        lines.push(`Best <b>${best.symbol}</b> ${best.unrealizedPct >= 0 ? "+" : ""}${(best.unrealizedPct * 100).toFixed(1)}% · worst <b>${worst.symbol}</b> ${(worst.unrealizedPct * 100).toFixed(1)}%`);
      }
      const exWeek = exDatesAhead.filter((e: any) => e.date <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
      lines.push(exWeek.length ? `Ex-dates (7d): ${exWeek.map((e: any) => `${e.symbol} ${e.date.slice(5)}`).join(", ")}` : "Ex-dates (7d): none");
      lines.push(boardAhead.length ? `Board meetings: ${boardAhead.map((e) => `${e.symbol} ${e.date.slice(5)}`).join(", ")}` : "Board meetings (7d): none");
      if (decisionCards > 0) lines.push(`⚠ <b>${decisionCards} decision${decisionCards === 1 ? "" : "s"} waiting</b> on the Decisions page — fired triggers and due reviews don't clear themselves.`);
      candidates.push({ key: `digest:${isoWeekKey(new Date())}`, message: lines.join("\n") });
    }
  } catch {
    /* digest is best-effort — a feed being down must not sink the other alerts */
  }

  // Insert-only dedup: a successful insert means this key is fresh today.
  // Scoped by userId so each user has their own daily dedupe slots.
  const myId = await uid();
  const fresh: string[] = [];
  for (const c of candidates.filter((c) => wanted(c.key, settings))) {
    try {
      await AlertLogModel.create({ userId: myId, dedupeKey: c.key, kind: c.key.split(":")[0], message: c.message });
      fresh.push(c.message);
    } catch {
      /* duplicate — already alerted today */
    }
  }

  if (fresh.length === 0) {
    return { sent: 0, checked: candidates.length };
  }

  const text = `<b>PSX Portfolio alerts</b>\n${fresh.join("\n")}`;
  const result = await sendTelegram(token, chatId, text);
  return { sent: result.ok ? fresh.length : 0, ok: result.ok, detail: result.detail, checked: candidates.length };
}

// ISO-8601 week key, e.g. "2026-W29" — dedupes the digest to once a week.
function isoWeekKey(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y = x.getUTCFullYear();
  const week = Math.ceil(((x.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}
