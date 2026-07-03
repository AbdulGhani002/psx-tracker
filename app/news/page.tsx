import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { getNews, type NewsArticle } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function tone(s: number) {
  if (s > 0.15) return { label: "positive", color: "var(--positive)" };
  if (s < -0.15) return { label: "negative", color: "var(--negative)" };
  return { label: "neutral", color: "var(--muted)" };
}

function ago(iso: string | null) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Article({ a }: { a: NewsArticle }) {
  const t = tone(a.sentiment);
  return (
    <article className="border-b border-rule py-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-[15px] font-medium leading-snug hover:text-[var(--accent-deep)]">
          {a.title}
        </a>
      </div>
      {a.summary && <p className="text-[13px] text-muted mt-1 max-w-[80ch] line-clamp-2">{a.summary}</p>}
      <div className="flex items-center gap-x-4 gap-y-1 mt-2 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-stat text-muted">{a.source}</span>
        <span className="font-mono text-[10px] text-muted">{ago(a.published_at)}</span>
        <span className="font-mono text-[10px] uppercase tracking-stat" style={{ color: t.color }}>{t.label}</span>
        {a.symbols.map((s) => (
          <Link key={s} href={`/stock/${s}`} className="font-mono text-[11px] px-1.5 border border-rule hover:border-ink">{s}</Link>
        ))}
      </div>
    </article>
  );
}

export default async function NewsPage() {
  const data = await getNews(undefined, 80);
  if (!data || !data.articles?.length) {
    return (
      <div className="fade-in">
        <PageHeader eyebrow="Market · News" title="The news desk is warming up." subtitle="Fetching the latest Pakistani business coverage." />
      </div>
    );
  }
  const tagged = data.articles.filter((a) => a.symbols.length > 0);

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · News"
        title="What Pakistan's business press is saying."
        subtitle="Business Recorder, Dawn Business and Tribune, refreshed daily. Each story is scored by a transparent word-list sentiment (no black box) and conservatively tagged to listed companies — those tags feed each stock's AI news score."
      />

      {tagged.length > 0 && (
        <Section number="01" title="Company coverage" display={`${tagged.length} stories tagged to listed companies`} description="Stories our matcher confidently linked to a PSX symbol. Click the tag for the stock's full AI breakdown.">
          <div>{tagged.map((a) => <Article key={a.url} a={a} />)}</div>
        </Section>
      )}

      <Section number="02" title="All coverage" display={`${data.articles.length} latest stories`} description="Everything from the three feeds, newest first. Macro stories stay untagged on purpose — a missed tag is better than a wrong one.">
        <div>{data.articles.map((a) => <Article key={a.url} a={a} />)}</div>
      </Section>
    </div>
  );
}
