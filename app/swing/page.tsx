import { uid } from "@/lib/auth/uid";
import { loadQuantSnapshot } from "@/lib/quant/store";
import { loadSwingBook } from "@/lib/quant/swing-book";
import type { StoredReport } from "@/lib/quant/report";
import type { SwingTested } from "@/lib/quant/swing";
import { SwingView } from "./SwingView";

export const dynamic = "force-dynamic";

export default async function SwingPage() {
  const userId = await uid();
  const [report, book, tested] = await Promise.all([
    loadQuantSnapshot<StoredReport>(`quant:report:${userId}`).catch(() => null),
    loadSwingBook(userId).catch(() => null),
    loadQuantSnapshot<SwingTested>("quant:swing:tested").catch(() => null),
  ]);
  return <SwingView report={report} book={book} tested={tested} />;
}
