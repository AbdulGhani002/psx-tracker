import "server-only";
import { getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import { getCurrentUserId } from "@/lib/auth/current-user";

// Your principles: a sentence or two each on how and why you invest, kept
// next to your rules and read again every year (Telegram reminds you each
// July). The questions follow the topics a trading routine should settle.

export const PRINCIPLE_QUESTIONS: Array<{ key: string; title: string; ask: string }> = [
  { key: "odds", title: "The odds", ask: "Most people who trade often end up behind after costs. Why won't you, and what result a year from now would prove it?" },
  { key: "style", title: "Your style", ask: "Holding for years, swings of weeks, or trading within the day: which suits your time, temperament and job? How many hours a week can you really give it?" },
  { key: "edge", title: "Your edge", ask: "In one sentence: why should your way beat simply holding the index after costs, and what test shows it?" },
  { key: "watch", title: "What you watch", ask: "Which few numbers will you check every day, and which will you deliberately ignore?" },
  { key: "news", title: "News", ask: "How will you tell a real surprise from news the market had already priced in?" },
  { key: "risk", title: "Risk", ask: "The most you will lose on one idea, and in one month, in rupees. Will you ever use borrowed money?" },
  { key: "crash", title: "A crash day", ask: "The KSE-100 falls 9% and trading halts. What exactly will you do that day?" },
  { key: "price", title: "Your price", ask: "How do you set the most you'll pay for a share before you look at the screen, and what will you do if it runs away without you?" },
  { key: "stop", title: "Stopping", ask: "What result would make you drop a method, or stop picking shares and simply hold the index?" },
  { key: "checks", title: "Checks", ask: "Which broker and apps do you use, and how did you confirm they are licensed?" },
  { key: "score", title: "Keeping score", ask: "How will you compare your results, after costs and tax, with the KSE-100 (with dividends) over the same time?" },
];

export type Principles = { answers: Record<string, string>; savedAt: string | null };
const key = (uid: string) => `principles:${uid}`;

export async function getPrinciples(userId?: string): Promise<Principles> {
  const id = userId ?? (await getCurrentUserId()) ?? "";
  const s = await getFeedSnapshot<Principles>(key(id)).catch(() => null);
  return { answers: s?.data?.answers ?? {}, savedAt: s?.data?.savedAt ?? null };
}

export async function savePrinciples(userId: string, answers: Record<string, string>): Promise<void> {
  const clean = Object.fromEntries(PRINCIPLE_QUESTIONS.map((q) => [q.key, String(answers[q.key] ?? "").slice(0, 2000)]));
  await saveFeedSnapshot(key(userId), { answers: clean, savedAt: new Date().toISOString() }, "ok", "principles");
}
