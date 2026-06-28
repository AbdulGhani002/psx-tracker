import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { getRotation } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function Bar({ pct, max }: { pct: number; max: number }) {
  const w = Math.min(100, (Math.abs(pct) / max) * 100);
  const pos = pct >= 0;
  return (
    <div className="flex items-center gap-2" style={{ flexDirection: pos ? "row" : "row-reverse" }}>
      <span className="font-mono mono-num text-[12px]" style={{ color: pos ? "var(--positive)" : "var(--negative)" }}>{pos ? "+" : ""}{pct.toFixed(1)}%</span>
      <span className="inline-block h-2 rounded-sm" style={{ width: `${w}%`, minWidth: 4, background: pos ? "var(--positive)" : "var(--negative)" }} />
    </div>
  );
}

export default async function RotationPage() {
  const data = await getRotation();
  if (!data || !data.all?.length) {
    return (
      <div className="fade-in">
        <PageHeader eyebrow="Market" title="Sector rotation is warming up." subtitle="Computing money flow across sectors." />
      </div>
    );
  }
  const max = Math.max(1, ...data.all.map((s) => Math.abs(s.ret_1m)));
  return (
    <div className="fade-in">
      <PageHeader eyebrow="Market" title="Where the money is moving." subtitle="Sectors ranked by their average 1-month momentum — a read on what's being accumulated and what's being sold." />
      <Section number="01" title="Money entering" display="Strongest sectors (1-month)" description="Highest average 1-month return — money is rotating in.">
        <div className="space-y-2.5">
          {data.entering.map((s: any) => (
            <div key={s.sector} className="grid grid-cols-[180px_1fr] items-center gap-3">
              <span className="font-mono text-[13px] truncate">{s.sector} <span className="text-muted text-[11px]">({s.count})</span></span>
              <Bar pct={s.ret_1m} max={max} />
            </div>
          ))}
        </div>
      </Section>
      <Section number="02" title="Money leaving" display="Weakest sectors (1-month)" description="Lowest average 1-month return — money is rotating out.">
        <div className="space-y-2.5">
          {data.leaving.map((s: any) => (
            <div key={s.sector} className="grid grid-cols-[180px_1fr] items-center gap-3">
              <span className="font-mono text-[13px] truncate">{s.sector} <span className="text-muted text-[11px]">({s.count})</span></span>
              <Bar pct={s.ret_1m} max={max} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
