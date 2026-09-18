import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { AnnouncementsList } from "@/components/dashboard/AnnouncementsList";
import { getRecentAnnouncements, BOARD_PAGE } from "@/lib/announcements";
import { getAppSettings, getPortfolioSummary } from "@/lib/data";

export const dynamic = "force-dynamic";

// Every announcement the exchange has posted for a held name in the last six
// months, newest first, with a filter per name; the delivery pill on each
// row says whether it went out to Telegram and email.
export default async function AnnouncementsPage({ searchParams }: { searchParams: { symbol?: string } }) {
  const symbol = (searchParams.symbol ?? "").toUpperCase();
  const [rows, settings, summary] = await Promise.all([getRecentAnnouncements({ limit: 150, days: 180, symbol: symbol || undefined }), getAppSettings(), getPortfolioSummary()]);
  const held = summary.positions.filter((p) => p.shares > 0).map((p) => p.symbol).sort();
  const s: any = settings;
  const telegramOn = s.announceTelegram !== false && !!s.telegramBotToken && !!s.telegramChatId;
  const emailOn = s.announceEmail !== false;

  return (
    <div>
      <PageHeader
        title="What your companies have told the exchange."
        subtitle={`The company-announcements board is read every five minutes. Anything posted for a name you hold is sent ${telegramOn && emailOn ? "to Telegram and by email" : telegramOn ? "to Telegram" : emailOn ? "by email" : "nowhere yet: turn a channel on under Settings"}, with the document itself.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/announcements" className="pill" data-tone={symbol ? "muted" : "positive"}>All names</Link>
          {held.map((h) => (
            <Link key={h} href={`/announcements?symbol=${h}`} className="pill" data-tone={symbol === h ? "positive" : "muted"}>{h}</Link>
          ))}
          <a href={BOARD_PAGE} target="_blank" rel="noreferrer" className="text-[12px] link-underline ml-auto">The board on the exchange</a>
          <Link href="/settings" className="text-[12px] link-underline">Settings</Link>
        </div>
      </PageHeader>
      <Card title={symbol ? `${symbol} announcements` : "Announcements for your holdings"} eyebrow="Last six months" action={<span className="text-[12px] text-muted">{rows.length} {rows.length === 1 ? "item" : "items"}</span>}>
        <AnnouncementsList rows={rows} />
      </Card>
    </div>
  );
}
