import { getStrategy, getRatesPrefill } from "@/lib/strategy/data";
import { StrategyView } from "./StrategyView";
import { marketEvents } from "@/lib/market-calendar";

export const dynamic = "force-dynamic";

// The downturn playbook (lib/strategy/plan.ts): the market's phase, stocks
// against T-bills, how much in stocks and how much dry powder, buying the
// index in steps as it falls, and where the cash waits, worked out again
// whenever the month's rates are saved.
export default async function StrategyPage() {
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const until = new Date(Date.parse(today + "T00:00:00Z") + 90 * 86400000).toISOString().slice(0, 10);
  const [s, prefill, events] = await Promise.all([getStrategy(), getRatesPrefill(), marketEvents(today, until).catch(() => [])]);
  return <StrategyView s={s} prefill={prefill} events={events} />;
}
