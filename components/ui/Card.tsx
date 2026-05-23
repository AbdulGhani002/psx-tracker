type Props = {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
  inverted?: boolean;
};

export function Card({ children, className = "", accent = true, inverted = false }: Props) {
  const bg = inverted ? "bg-[var(--inverted-bg)] text-[var(--inverted-fg)]" : "bg-[var(--paper-2)]";
  const border = accent && !inverted ? "border-l-[4px] border-l-[var(--accent)]" : "";
  return (
    <div className={`${bg} ${border} p-6 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <div className="mb-4">
      {eyebrow && <div className="label-cap mb-1.5">{eyebrow}</div>}
      <div className="font-display text-[18px]" style={{ fontVariationSettings: "'opsz' 144" }}>
        {title}
      </div>
    </div>
  );
}
