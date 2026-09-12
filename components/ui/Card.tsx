type Props = {
  children: React.ReactNode;
  className?: string;
  accent?: boolean; // kept for callers; a card is a card either way
  inverted?: boolean;
  title?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  pad?: boolean;
};

// A panel on the dashboard: a raised surface with a hairline border and a
// soft shadow, the same on every page so the eye learns one shape.
export function Card({ children, className = "", inverted = false, title, eyebrow, action, pad = true }: Props) {
  const head =
    title || eyebrow || action ? (
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          {eyebrow && <div className="label-cap mb-1">{eyebrow}</div>}
          {title && <div className="text-[15px] font-semibold leading-tight">{title}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    ) : null;
  if (inverted) {
    return (
      <div className={`card ${pad ? "card-pad" : ""} bg-[var(--inverted-bg)] text-[var(--inverted-fg)] ${className}`}>
        {head}
        {children}
      </div>
    );
  }
  return (
    <div className={`card ${pad ? "card-pad" : ""} ${className}`}>
      {head}
      {children}
    </div>
  );
}

export function CardHeader({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <div className="mb-4">
      {eyebrow && <div className="label-cap mb-1.5">{eyebrow}</div>}
      <div className="text-[18px] font-semibold leading-tight">{title}</div>
    </div>
  );
}
