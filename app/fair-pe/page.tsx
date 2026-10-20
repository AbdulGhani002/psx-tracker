import { getFairPeBoard } from "@/lib/fair-pe/data";
import { FairPeView } from "./FairPeView";

export const dynamic = "force-dynamic";

// Sector P/E and dividend yields by year, and fair at the rates you enter
// (lib/fair-pe).
export default async function FairPePage() {
  return <FairPeView board={await getFairPeBoard()} />;
}
