import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { AlertLogModel } from "@/lib/models";
import { getAppSettings, getWatchlist, getCurrentPrices, getPortfolioSummary, getAllHoldings, getUpcomingExDates } from "@/lib/data";
import { sendTelegram } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Candidate = { key: string; message: string };

// Scheduled timer hits this. Checks watchlist target hits + rebalance drift and
// pushes deduped Telegram alerts (each key fires at most once per day).
export async function POST() {
  const settings: any = await getAppSettings();
  const token = settings.telegramBotToken ?? "";
  const chatId = settings.telegramChatId ?? "";
  if (!settings.alertsEnabled || !token || !chatId) {
    return NextResponse.json({ skipped: true, reason: "alerts_disabled_or_unconfigured" });
  }

  await connectDb();
  const today = new Date().toISOString().slice(0, 10);
  const candidates: Candidate[] = [];

  // 1. Watchlist target hits
  const watch = await getWatchlist();
  const wlPrices = await getCurrentPrices(watch.map((w) => w.symbol));
  for (const w of watch) {
    const px = wlPrices.get(w.symbol) ?? 0;
    if (px <= 0) continue;
    if (w.targetBuyPrice && px <= w.targetBuyPrice) {
      candidates.push({ key: `watch-buy:${w.symbol}:${today}`, message: `🎯 <b>${w.symbol}</b> hit your BUY target — Rs ${px.toFixed(2)} ≤ Rs ${w.targetBuyPrice}` });
    }
    if (w.targetSellPrice && px >= w.targetSellPrice) {
      candidates.push({ key: `watch-sell:${w.symbol}:${today}`, message: `📈 <b>${w.symbol}</b> hit your SELL target — Rs ${px.toFixed(2)} ≥ Rs ${w.targetSellPrice}` });
    }
  }

  // 2. Rebalance drift (position beyond its band)
  const [summary, holdings] = await Promise.all([getPortfolioSummary(), getAllHoldings()]);
  const bandBySymbol = new Map(holdings.map((h) => [h.symbol, (h as any).rebalanceBand ?? 3]));
  for (const p of summary.positions) {
    if (p.shares <= 0 || p.targetPercent <= 0) continue;
    const band = bandBySymbol.get(p.symbol) ?? 3;
    if (Math.abs(p.deviation) > band) {
      const dir = p.deviation > 0 ? "over" : "under";
      candidates.push({ key: `drift:${p.symbol}:${today}`, message: `⚖️ <b>${p.symbol}</b> drifted ${dir} target — ${p.currentPercent.toFixed(1)}% vs ${p.targetPercent}% (±${band}%)` });
    }
  }

  // 3. Upcoming ex-dividend / book-closure (next 14 days). Deduped by symbol+date
  //    so each entitlement is announced once, not every day.
  try {
    const exDates = await getUpcomingExDates(14);
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

  // Insert-only dedup: a successful insert means this key is fresh today.
  const fresh: string[] = [];
  for (const c of candidates) {
    try {
      await AlertLogModel.create({ dedupeKey: c.key, kind: c.key.split(":")[0], message: c.message });
      fresh.push(c.message);
    } catch {
      /* duplicate — already alerted today */
    }
  }

  if (fresh.length === 0) {
    return NextResponse.json({ sent: 0, checked: candidates.length });
  }

  const text = `<b>PSX Portfolio alerts</b>\n${fresh.join("\n")}`;
  const result = await sendTelegram(token, chatId, text);
  return NextResponse.json({ sent: result.ok ? fresh.length : 0, ok: result.ok, detail: result.detail, checked: candidates.length });
}
