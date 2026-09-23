import Link from "next/link";
import { CompanyMark } from "@/components/ui/CompanyMark";
import { fmtPkt, companyUrl } from "@/lib/calculations/announcements";
import type { RecentAnnouncement } from "@/lib/announcements";

// Rows of the exchange's announcements for held names: the mark, the title
// as a link to the document, the company and time, and whether it was sent.
export function AnnouncementsList({ rows, compact = false }: { rows: RecentAnnouncement[]; compact?: boolean }) {
  if (rows.length === 0) return <div className="text-[12px] text-muted">Nothing posted for your names lately. The board is read every five minutes.</div>;
  return (
    <div className="hairline-list">
      {rows.map((a) => {
        const href = a.pdfUrl || a.imageUrl || companyUrl(a.symbol);
        return (
          <div key={a.annId} className="flex items-start gap-3">
            <CompanyMark symbol={a.symbol} size={compact ? "sm" : "md"} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <Link href={`/holdings/${a.symbol}`} className="font-semibold text-[13px] hover:text-[var(--accent-deep)] shrink-0">{a.symbol}</Link>
                {!compact && <span className="text-[12px] text-muted truncate">{a.company}</span>}
              </div>
              <a href={href} target="_blank" rel="noreferrer" className={`block ${compact ? "text-[12.5px]" : "text-[13.5px]"} leading-snug hover:text-[var(--accent-deep)] ${compact ? "truncate" : ""}`} title={a.title}>
                {a.title || "Announcement"}
              </a>
              <div className="text-[11px] text-muted mt-0.5 flex flex-wrap items-center gap-x-2">
                <span>{fmtPkt(new Date(a.announcedAt))}</span>
                {a.kind === "board" && <span className="pill" data-tone="muted">Board meeting</span>}
                {a.pdfUrl && <a href={a.pdfUrl} target="_blank" rel="noreferrer" className="link-underline">PDF</a>}
                {!a.pdfUrl && a.imageUrl && <a href={a.imageUrl} target="_blank" rel="noreferrer" className="link-underline">Notice</a>}
                {a.sent === "sent" && <span className="pill" data-tone="positive">Sent</span>}
                {a.sent === "partial" && <span className="pill" data-tone="muted">Partly sent</span>}
                {a.sent === "failed" && <span className="pill" data-tone="negative">Not sent</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
