import { getRuleBoard } from "@/lib/rules/data";
import { RulesView } from "./RulesView";

export const dynamic = "force-dynamic";

// The price rules (lib/rules): the user's steps on every share held.
export default async function RulesPage() {
  const board = await getRuleBoard();
  return <RulesView settings={board.settings} shares={board.shares} usualPct={board.usualPct} asOf={board.asOf} />;
}
