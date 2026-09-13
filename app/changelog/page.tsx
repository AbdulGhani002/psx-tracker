import { PageHeader } from "@/components/layout/PageHeader";
import { APP_VERSION, BUILD_DATE, BUILD_SHA, CHANGELOG } from "@/lib/version";

export const dynamic = "force-static";

export default function ChangelogPage() {
  return (
    <div>
      <PageHeader
        eyebrow={`Version ${APP_VERSION}`}
        title="Changelog"
        subtitle={
          BUILD_DATE
            ? `Built ${BUILD_DATE}${BUILD_SHA ? ` · ${BUILD_SHA}` : ""}.`
            : "A running log of every release."
        }
      />

      <div className="mt-12 relative">
        {/* vertical timeline rule */}
        <div
          className="absolute top-0 bottom-0 left-[7px] w-px"
          style={{ background: "var(--rule)" }}
          aria-hidden
        />
        <div className="space-y-12">
          {CHANGELOG.map((entry, i) => (
            <article key={entry.version} className="relative pl-10">
              <div
                className="absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2"
                style={{
                  borderColor: "var(--ink)",
                  background: i === 0 ? "var(--accent)" : "var(--paper)",
                }}
                aria-hidden
              />
              <div className="flex items-baseline gap-3 flex-wrap">
                <span
                  className="font-mono text-[13px] font-medium px-2 py-0.5 border border-ink"
                  style={{ background: i === 0 ? "var(--ink)" : "transparent", color: i === 0 ? "var(--paper)" : "var(--ink)" }}
                >
                  v{entry.version}
                </span>
                <span className="label-cap">{entry.date}</span>
              </div>
              <h2
                className="font-display mt-3"
                style={{ fontSize: 22, lineHeight: 1.2 }}
              >
                {entry.title}
              </h2>
              <ul className="mt-3 space-y-2">
                {entry.changes.map((c, j) => (
                  <li key={j} className="text-[14px] leading-relaxed flex gap-2.5">
                    <span style={{ color: "var(--accent-deep)" }} aria-hidden>—</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
