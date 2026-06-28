import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SectorHeatmap } from "@/components/charts/SectorHeatmap";
import { getHeatmap } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  const data = await getHeatmap();
  if (!data || !data.sectors?.length) {
    return (
      <div className="fade-in">
        <PageHeader eyebrow="Market" title="Heatmap is warming up." subtitle="The analytics engine is computing today's moves across the market." />
      </div>
    );
  }
  const up = data.sectors.filter((s) => s.change_pct > 0).length;
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market"
        title="The whole market, at a glance."
        subtitle="Every sector and stock, green when up and red when down today, by how much. Sector headers are market-cap weighted. Click any tile for its AI rating."
      />
      <Section number="01" title="Live sector heatmap" display={`${up} of ${data.sectors.length} sectors green`} description="Tile colour = today's % change. Brighter = bigger move.">
        <SectorHeatmap sectors={data.sectors} />
      </Section>
    </div>
  );
}
