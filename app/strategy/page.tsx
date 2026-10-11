import { getStrategy, getRatesPrefill } from "@/lib/strategy/data";
import { StrategyView } from "./StrategyView";

export const dynamic = "force-dynamic";

// The downturn playbook (lib/strategy/plan.ts): the market's phase, stocks
// against T-bills, how much in stocks and how much dry powder, buying in
// steps as the market falls, where the cash waits, and which names, worked
// out again whenever the month's rates are saved; the research on every share
// of the ticked sectors; and the model behind it.
export default async function StrategyPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await props.searchParams;
  const [s, prefill] = await Promise.all([getStrategy(), getRatesPrefill()]);
  return <StrategyView s={s} prefill={prefill} tab={tab === "research" || tab === "model" ? tab : "plan"} />;
}
