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
      <div className="field relative">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg className="field-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
