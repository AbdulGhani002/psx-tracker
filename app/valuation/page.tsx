import { getValuationBoard } from "@/lib/valuation/board";
import { ValuationView } from "./ValuationView";

export const dynamic = "force-dynamic";

// Fair values and buy zones from your approved assumptions (lib/valuation),
// valued on every close: the shares in rank order, and what waits for review.
export default async function ValuationPage() {
  return <ValuationView b={await getValuationBoard()} />;
}
