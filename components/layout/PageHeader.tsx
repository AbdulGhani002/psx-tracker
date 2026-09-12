type Props = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  italic?: boolean;
  children?: React.ReactNode;
};

// The page's own heading block: a title at reading size, a line under it,
// and the page's actions. The shell's top bar already names the section.
export function PageHeader({ title, subtitle, eyebrow, children }: Props) {
  return (
    <header className="mb-6 fade-in-up">
      {eyebrow && <div className="text-[11px] tracking-[0.14em] uppercase text-muted mb-1.5">{eyebrow}</div>}
      <h1 className="text-[24px] md:text-[28px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
      {subtitle && <p className="mt-2 text-[14px] leading-relaxed text-muted max-w-[72ch]">{subtitle}</p>}
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}
