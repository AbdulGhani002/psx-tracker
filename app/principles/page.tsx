import { getPrinciples, PRINCIPLE_QUESTIONS } from "@/lib/principles";
import { PrinciplesForm } from "./PrinciplesForm";

export const dynamic = "force-dynamic";

// Your own rules for how and why you invest (lib/principles).
export default async function PrinciplesPage() {
  return <PrinciplesForm questions={PRINCIPLE_QUESTIONS} saved={await getPrinciples()} />;
}
