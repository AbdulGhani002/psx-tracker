"use client";

type Tab = { value: string; label: string };

type Props = {
  tabs: Tab[];
  value: string;
  onChange: (v: string) => void;
};

export function Tabs({ tabs, value, onChange }: Props) {
  return (
    <div className="flex border-b border-ink">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className="relative px-5 py-3 label-cap transition-colors"
            style={{
              color: active ? "var(--ink)" : "var(--muted)",
              borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
