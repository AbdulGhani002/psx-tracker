import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { getFlows, type FlowsData, type FlowCategory } from "@/lib/analytics";

export const dynamic = "force-dynamic";

const POS = "var(--positive)";
const NEG = "var(--negative)";

function usd(v: number) {
  const s = v < 0 ? "-" : v > 0 ? "+" : "";
  return `${s}$${Math.abs(v).toFixed(1)}m`;
}
function fmtDay(iso: string) {
  const [, m, d] = iso.split("-");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1] || m;
  return `${d} ${mon}`;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? POS : tone === "neg" ? NEG : "var(--ink)";
  return (
    <div className="border border-rule p-3" style={{ background: "var(--paper-2)" }}>
      <div className="label-cap mb-1">{label}</div>
      <div className="font-display mono-num text-[22px]" style={{ fontVariationSettings: "'opsz' 144", color }}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

// Cumulative foreign-flow line over the window (the headline "are they accumulating?" chart).
function CumulativeLine({ data }: { data: { date: string; value: number }[] }) {
  if (data.length < 2) return null;
  const W = 720, H = 240, padL = 50, padR = 14, padT = 14, padB = 26;
  const vals = data.map((d) => d.value);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i: number) => padL + (i / (data.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const end = data[data.length - 1].value;
  const col = end >= 0 ? POS : NEG;
  const ticks = Math.max(2, Math.floor(data.length / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }} role="img" aria-label="Cumulative foreign flow">
      <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="var(--ink)" strokeWidth={1} />
      {[max, min].map((v) => (
        <text key={v} x={padL - 6} y={y(v) + 3} textAnchor="end" className="font-mono" fontSize={9} fill="var(--muted)">{usd(v)}</text>
      ))}
      <path d={area} fill={col} opacity={0.12} />
      <path d={path} fill="none" stroke={col} strokeWidth={1.75} />
      <circle cx={x(data.length - 1)} cy={y(end)} r={3.5} fill={col} />
      {data.filter((_, i) => i % ticks === 0).map((d) => (
        <text key={d.date} x={x(data.indexOf(d))} y={H - 8} textAnchor="middle" className="font-mono" fontSize={8} fill="var(--muted)">{fmtDay(d.date)}</text>
      ))}
    </svg>
  );
}

// Daily foreign net — diverging bars from zero (green = bought, red = sold).
function DailyBars({ series }: { series: { date: string; fipi: number }[] }) {
  const data = series.slice(-44);
  if (!data.length) return null;
  const W = 720, H = 200, padL = 50, padR = 14, padT = 12, padB = 22;
  const vals = data.map((d) => d.fipi);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const span = max - min || 1;
  const bw = (W - padL - padR) / data.length;
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 230 }} role="img" aria-label="Daily foreign net">
      <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="var(--ink)" strokeWidth={1} />
      {[max, min].map((v) => (
        <text key={v} x={padL - 6} y={y(v) + 3} textAnchor="end" className="font-mono" fontSize={9} fill="var(--muted)">{usd(v)}</text>
      ))}
      {data.map((d, i) => {
        const yy = y(Math.max(0, d.fipi)), h = Math.abs(y(d.fipi) - y(0));
        return <rect key={d.date} x={padL + i * bw + bw * 0.15} y={yy} width={bw * 0.7} height={Math.max(0.5, h)} fill={d.fipi >= 0 ? POS : NEG} opacity={0.85} />;
      })}
    </svg>
  );
}

// Latest-day breakdown — who bought / sold, diverging from a centre line.
function Breakdown({ categories }: { categories: FlowCategory[] }) {
  const max = Math.max(1, ...categories.map((c) => Math.abs(c.net_usd_mn)));
  return (
    <div className="space-y-1.5">
      {categories.map((c) => {
        const pos = c.net_usd_mn >= 0;
        const w = (Math.abs(c.net_usd_mn) / max) * 50; // % of half-width
        return (
          <div key={c.category} className="grid grid-cols-[150px_1fr_64px] items-center gap-2 text-[12px]">
            <span className="truncate flex items-center gap-1">
              {c.mtype === "Foreign" && <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} title="Foreign" />}
              {c.category}
            </span>
            <span className="relative h-3.5 block" style={{ background: "linear-gradient(var(--rule),var(--rule)) center / 1px 100% no-repeat" }}>
              <span className="absolute top-0 h-full" style={{ [pos ? "left" : "right"]: "50%", width: `${w}%`, background: pos ? POS : NEG } as React.CSSProperties} />
            </span>
            <span className="font-mono mono-num text-right" style={{ color: pos ? POS : NEG }}>{usd(c.net_usd_mn)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default async function FlowsPage() {
  const d: FlowsData | null = await getFlows(90);
  if (!d || !d.series?.length) {
    return (
      <div className="fade-in">
        <PageHeader eyebrow="Market · Flows" title="Investor flows are warming up." subtitle="Reading the latest foreign vs local activity." />
      </div>
    );
  }
  const foreignSold = d.fipi_today < 0;
  const head = d.fipi_today === 0
    ? "Foreigners were flat today."
    : `Foreigners net ${foreignSold ? "sold" : "bought"} ${usd(Math.abs(d.fipi_today))} of PSX.`;
  const cumNeg = d.cumulative_fipi < 0;

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · Flows"
        title={head}
        subtitle="FIPI/LIPI — the official NCCPL record of who is buying and selling the market: foreign investors versus local funds, banks, companies and individuals. Net figures in US-dollar millions."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
        <Stat label={`Foreign · ${d.latest ? fmtDay(d.latest) : ""}`} value={usd(d.fipi_today)} tone={d.fipi_today >= 0 ? "pos" : "neg"} sub={foreignSold ? "net seller" : "net buyer"} />
        <Stat label="Foreign streak" value={`${d.streak}d`} sub={d.streak_side} tone={d.streak_side === "buying" ? "pos" : d.streak_side === "selling" ? "neg" : undefined} />
        <Stat label="Foreign · last 5d" value={usd(d.fipi_5d)} tone={d.fipi_5d >= 0 ? "pos" : "neg"} />
        <Stat label={`Foreign · ${d.days}d total`} value={usd(d.cumulative_fipi)} tone={d.cumulative_fipi >= 0 ? "pos" : "neg"} />
      </div>

      <Section number="01" title="Cumulative foreign flow" display={`${cumNeg ? "Outflow" : "Inflow"} of ${usd(Math.abs(d.cumulative_fipi))} over ${d.days} sessions`}
        description={`Running total of foreign net buying since ${d.series[0] ? fmtDay(d.series[0].date) : ""}. A falling line means foreigners are taking money off the table; locals are on the other side of every rupee.`}>
        <CumulativeLine data={d.cumulative} />
      </Section>

      <Section number="02" title="Daily foreign net" description="Each bar is one session's foreign net buy (green) or sell (red), in USD millions.">
        <DailyBars series={d.series} />
      </Section>

      <Section number="03" title="Who was on each side" display={d.latest ? fmtDay(d.latest) : ""}
        description="The latest session split by investor type. Foreign categories are dotted. Buyers extend right, sellers left — and because every trade has two sides, the two columns mirror each other.">
        <Breakdown categories={d.categories} />
      </Section>

      <p className="text-[11px] text-muted mt-8 max-w-[68ch]">
        FIPI = Foreign Investor Portfolio Investment; LIPI = Local. Source: official NCCPL figures (via scstrade, since NCCPL’s own portal is bot-gated), in USD millions, settled basis. Published with a 1–2 session lag, refreshed daily. Foreign selling isn’t automatically bearish — sustained local absorption (mutual funds, individuals) often marks a floor.
      </p>
    </div>
  );
}
