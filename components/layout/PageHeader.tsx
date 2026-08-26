type Props = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  italic?: boolean;
  children?: React.ReactNode;
};

// The headline block. Scale contrast is the whole point: the title is set far
// larger than anything under it, the standfirst sits at reading size in a
// measured column, and a hairline closes the block off the way a paper rules
// beneath a headline before the story starts.
export function PageHeader({ title, subtitle, eyebrow, italic, children }: Props) {
  return (
    <header className="mb-9 fade-in-up">
      {eyebrow && <div className="section-eyebrow mb-3">{eyebrow}</div>}
      <h1
        className={italic ? "font-display-italic" : "font-display"}
        style={{ fontSize: "clamp(40px, 7vw, 68px)", lineHeight: 0.98, letterSpacing: "-0.02em" }}
      >
        {title}
      </h1>
      {subtitle && (
        // 62ch is a measure, not a guess — much past that and the eye loses the
        // line return on a page this wide.
        <p className="mt-4 text-[15px] leading-relaxed text-muted max-w-[62ch]">{subtitle}</p>
      )}
      <hr className="divider mt-6 rule-draw" />
      {children && <div className="mt-6">{children}</div>}
    </header>
  );
}
