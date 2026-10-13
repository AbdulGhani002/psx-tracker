import { notFound } from "next/navigation";
import { AnalysisView } from "@/app/analysis/AnalysisView";
import { levelsNow, walkForward, summarise, isoWeek, type Close } from "@/lib/index-week/forecast";
import type { IndexForecasts, IndexView } from "@/lib/index-week/message";

// The Model page on made-up index closes, worked out by the real forecaster,
// for looking at the design on a machine with no database. Development only.
export const dynamic = "force-dynamic";

function walk(start: number, seed: number, n = 1250): Close[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const out: Close[] = [];
  let level = start, t = Date.parse("2021-09-24T00:00:00Z");
  while (out.length < n) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) {
      level *= Math.exp(0.0009 + 0.012 * gauss());
      out.push({ date: new Date(t).toISOString().slice(0, 10), close: Math.round(level * 100) / 100 });
    }
    t += 86400000;
  }
  return out;
}

function view(code: string, label: string, closes: Close[]): IndexView {
  const last = closes[closes.length - 1];
  const weekRows = walkForward(closes, 5);
  const prev = [...closes].reverse().find((c) => isoWeek(c.date) !== isoWeek(last.date));
  return {
    code,
    label,
    date: last.date,
    close: last.close,
    weekChangePct: prev ? Math.round((last.close / prev.close - 1) * 1000) / 10 : null,
    week: levelsNow(closes, 5),
    month: levelsNow(closes, 20),
    tested: { week: summarise(weekRows), weekLastYear: summarise(weekRows.slice(-52)), month: summarise(walkForward(closes, 20)) },
    live: summarise(weekRows.slice(-3)),
    weeks: weekRows.slice(-10).reverse(),
  };
}

export default function AnalysisPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const indexes = [view("KSE100", "KSE-100", walk(45_000, 11)), view("KMI30", "KMI-30", walk(72_000, 23)), view("KSE30", "KSE-30", walk(17_700, 37))];
  const f: IndexForecasts = { asOf: indexes[0].date, computedAt: new Date().toISOString(), indexes };
  return <AnalysisView f={f} />;
}
