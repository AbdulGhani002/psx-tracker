type Props = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  italic?: boolean;
  children?: React.ReactNode;
};

export function PageHeader({ title, subtitle, eyebrow, italic, children }: Props) {
  return (
    <header className="mb-10">
      {eyebrow && <div className="section-eyebrow mb-3">{eyebrow}</div>}
      <h1
        className={italic ? "font-display-italic" : "font-display"}
        style={{ fontSize: "clamp(36px, 6vw, 52px)", lineHeight: 1.05, letterSpacing: "-0.01em" }}
      >
        {title}
      </h1>
      {subtitle && (
        <p className="mt-3 text-[15px] text-muted max-w-[60ch]">{subtitle}</p>
      )}
      {children && <div className="mt-6">{children}</div>}
    </header>
  );
}
