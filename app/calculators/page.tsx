import { Calculators } from "./Calculators";
import { getAppSettings } from "@/lib/data";
import { whtPct } from "@/lib/calculations/pk-tax";

export const dynamic = "force-dynamic";

export default async function CalculatorsPage() {
  const settings = (await getAppSettings().catch(() => ({}))) as any;
  return (
    <div>
      <h1 className="text-[22px] font-semibold leading-tight">Calculators</h1>
      <div className="text-[12px] text-muted mt-0.5 mb-5">The arithmetic behind the decisions, with your own tax rates filled in. Nothing here touches your records.</div>
      <Calculators cgtRate={whtPct("capital-gain", settings)} divWht={whtPct("dividend", settings)} brokeragePct={Number(settings.brokeragePct ?? 0.15)} />
    </div>
  );
}
