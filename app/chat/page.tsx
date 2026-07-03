import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { ChatClient } from "./ChatClient";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · Assistant"
        title="Ask the market anything."
        subtitle="An AI assistant grounded on this platform's own data — live prices, AI ratings, dividends, board meetings, foreign flows and news. It answers from retrieved facts (shown under each reply) and says so when it doesn't know. Not financial advice."
      />
      <Section number="01" title="Chat" description="Powered by a transformer-embedding retrieval index over the market database and a compact instruct LLM served on this server — fine-tuned on Pakistani market Q&A generated from real PSX data.">
        <ChatClient />
      </Section>
    </div>
  );
}
