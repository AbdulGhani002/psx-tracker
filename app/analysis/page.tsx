import { getIndexForecasts } from "@/lib/index-week/data";
import { getMarketStudies } from "@/lib/market-history";
import { AnalysisView } from "./AnalysisView";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  const [f, studies] = await Promise.all([getIndexForecasts().catch(() => null), getMarketStudies().catch(() => null)]);
  return <AnalysisView f={f} studies={studies} />;
}
