import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Card } from "@/components/ui/Card";
import { GLOSSARY } from "@/lib/glossary";

export const dynamic = "force-static";

export default function GlossaryPage() {
  const entries = Object.values(GLOSSARY);
  return (
    <div>
      <PageHeader
        eyebrow="Learn"
        title="Plain-words glossary."
        subtitle="Every finance term in this app, explained simply — in English and Roman Urdu. Asaan alfaaz mein har term ki tashreeh."
      />
      <Section number="01" title="Terms" display="Saral lafz, saaf matlab.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {entries.map((e) => (
            <Card key={e.term}>
              <div className="font-display text-[18px] mb-1.5" style={{ fontVariationSettings: "'opsz' 144" }}>{e.term}</div>
              <p className="text-[13px] mb-2">{e.en}</p>
              <p className="text-[13px]" style={{ color: "var(--accent-deep)", fontStyle: "italic" }}>{e.urdu}</p>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}
