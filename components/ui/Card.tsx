type Props = {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
  inverted?: boolean;
};

// A section of the page, not a box on it.
//
// This used to be a tinted panel with a 4px accent bar down the left, repeated
// down every page — the one shape that makes a layout look assembled rather
// than set. A newspaper does not box its sections; it rules them off and lets
// the type carry the hierarchy. So the default is a heavy rule above and open
// paper below, `accent={false}` gives the lighter hairline for a subordinate
// block, and the inverted panel survives for the one or two places that really
// do need to sit apart from the page.
export function Card({ children, className = "", accent = true, inverted = false }: Props) {
  if (inverted) {
    return (
      <div className={`bg-[var(--inverted-bg)] text-[var(--inverted-fg)] p-6 ${className}`}>
        {children}
      </div>
    );
  }
  const rule = accent ? "border-t-2 border-t-[var(--ink)]" : "border-t border-t-[var(--rule)]";
  return <div className={`${rule} pt-4 ${className}`}>{children}</div>;
}

export function CardHeader({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <div className="mb-4">
      {eyebrow && <div className="label-cap mb-1.5">{eyebrow}</div>}
      <div className="font-display text-[22px] leading-tight">{title}</div>
    </div>
  );
}
