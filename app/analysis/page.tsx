import { getIndexForecasts } from "@/lib/index-week/data";
import { AnalysisView } from "./AnalysisView";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  return <AnalysisView f={await getIndexForecasts().catch(() => null)} />;
}
