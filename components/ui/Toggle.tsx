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
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-[11.5px] text-muted mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className="relative inline-flex items-center w-10 h-6 rounded-full transition-colors shrink-0"
        style={{ background: value ? "var(--accent)" : "var(--surface-3)", border: "1px solid var(--rule)" }}
      >
        <span
          className="absolute block w-[18px] h-[18px] rounded-full transition-transform"
          style={{ background: value ? "var(--accent-ink)" : "var(--muted)", transform: value ? "translateX(19px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}
