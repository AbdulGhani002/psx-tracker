type Props = {
  number?: string;
  title: string;
  display?: string; // optional bigger serif headline
  children: React.ReactNode;
  action?: React.ReactNode;
  description?: string;
};

export function Section({ number, title, display, children, action, description }: Props) {
  return (
    <section className="mt-14">
      <div className="border-t-2 border-ink pt-4 mb-5">
        <div className="flex items-baseline justify-between">
          <div className="section-eyebrow">
            {number ? `${number} — ${title}` : title}
          </div>
          {action && <div>{action}</div>}
        </div>
        {display && (
          <h2
            className="font-display mt-2"
            style={{
              fontSize: "clamp(22px, 3vw, 30px)",
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
            }}
          >
            {display}
          </h2>
        )}
        {description && (
          <p className="text-[13px] text-muted mt-2 max-w-[64ch]">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
