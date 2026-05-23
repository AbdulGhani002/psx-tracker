type Props = {
  number?: string;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  description?: string;
};

export function Section({ number, title, children, action, description }: Props) {
  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="section-eyebrow">
          {number ? `${number} — ${title}` : title}
        </h2>
        {action && <div>{action}</div>}
      </div>
      {description && (
        <p className="text-sm text-muted mb-5 max-w-[64ch]">{description}</p>
      )}
      {children}
    </section>
  );
}
