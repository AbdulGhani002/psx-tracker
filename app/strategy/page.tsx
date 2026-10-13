import { getStrategy, getRatesPrefill } from "@/lib/strategy/data";
import { StrategyView } from "./StrategyView";

export const dynamic = "force-dynamic";

// The downturn playbook (lib/strategy/plan.ts): the market's phase, stocks
// against T-bills, how much in stocks and how much dry powder, buying the
// index in steps as it falls, and where the cash waits, worked out again
// whenever the month's rates are saved.
export default async function StrategyPage() {
  const [s, prefill] = await Promise.all([getStrategy(), getRatesPrefill()]);
  return <StrategyView s={s} prefill={prefill} />;
}
