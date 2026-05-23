"use client";

type Props = {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
};

export function Toggle({ label, value, onChange, hint }: Props) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="label-cap">{label}</div>
        {hint && <div className="text-[11px] text-muted mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className="relative inline-flex items-center w-10 h-5 border border-ink transition-colors"
        style={{
          background: value ? "var(--ink)" : "transparent",
        }}
      >
        <span
          className="absolute top-[1px] block w-[16px] h-[16px] transition-transform"
          style={{
            background: value ? "var(--paper)" : "var(--ink)",
            transform: value ? "translateX(20px)" : "translateX(2px)",
          }}
        />
      </button>
    </div>
  );
}
