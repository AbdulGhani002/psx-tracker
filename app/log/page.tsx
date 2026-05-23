import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { LogView } from "./LogView";
import { getDecisionLog, getAllHoldings, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  const avail = await checkDataAvailability();
  const [entries, holdings] = await Promise.all([
    getDecisionLog(),
    getAllHoldings(),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Decision log"
        title="Why you did what you did."
        subtitle="A quiet quarterly journal of triggers, interpretations, and the actions you took. Future-you will thank present-you."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}
      <LogView entries={entries} symbols={holdings.map((h) => h.symbol)} />
    </div>
  );
}
