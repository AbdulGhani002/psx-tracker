"use client";

type Option = { value: string; label: string };

type Props = {
  label?: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  hint?: string;
};

export function Select({ label, value, options, onChange, hint }: Props) {
  return (
    <div className="space-y-1.5">
      {label && <label className="label-cap block">{label}</label>}
      <div className="border-b border-ink relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-[14px] py-1.5 pr-5 focus:outline-none appearance-none"
          style={{ color: "var(--ink)" }}
        >
          {/* The dropdown popup is painted by the OS, not by this box. A
              transparent select left the options inheriting a colour that
              disappeared against the dark popup, so paint each one explicitly
              in theme tokens. */}
          {options.map((o) => (
            <option key={o.value} value={o.value} style={{ background: "var(--paper)", color: "var(--ink)" }}>
              {o.label}
            </option>
          ))}
        </select>
        {/* Theme-aware arrow (currentColor follows --ink in light/dark). */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[10px]"
          style={{ color: "var(--muted)" }}
        >
          ▾
        </span>
      </div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
