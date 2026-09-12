type Props = {
  number?: string;
  title: string;
  display?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  description?: string;
};

// A titled block of the page. The number is kept for pages that count their
// sections; the heading is a plain dashboard heading now.
export function Section({ number, title, display, children, action, description }: Props) {
  return (
    <section className="mt-8">
      <div className="mb-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            {number && <span className="text-[11px] tracking-[0.14em] uppercase text-muted mr-2">{number}</span>}
            <span className="text-[16px] font-semibold">{display ?? title}</span>
            {display && display !== title && <span className="text-[12px] text-muted ml-2">{title}</span>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {description && <p className="mt-1.5 text-[13px] leading-relaxed text-muted max-w-[90ch]">{description}</p>}
      </div>
      {children}
    </section>
  );
}
