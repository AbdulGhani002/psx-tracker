import { uid } from "@/lib/auth/uid";
import { loadQuantSnapshot } from "@/lib/quant/store";
import type { StoredReport } from "@/lib/quant/report";
import { SwingView } from "./SwingView";

export const dynamic = "force-dynamic";

export default async function SwingPage() {
  const userId = await uid();
  const report = await loadQuantSnapshot<StoredReport>(`quant:report:${userId}`).catch(() => null);
  return <SwingView report={report} />;
}
