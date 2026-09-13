type Props = {
  number?: string;
  title: string;
  display?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  description?: string;
};

// A titled block of the page. Pages still pass their old section numbers;
// the heading no longer prints them.
export function Section({ title, display, children, action, description }: Props) {
  return (
    <section className="mt-7">
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <span className="text-[15px] font-semibold tracking-[-0.01em]">{display ?? title}</span>
            {display && display !== title && <span className="text-[12px] text-muted ml-2">{title}</span>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {description && <p className="mt-1 text-[12.5px] leading-relaxed text-muted max-w-[90ch]">{description}</p>}
      </div>
      {children}
    </section>
  );
}
