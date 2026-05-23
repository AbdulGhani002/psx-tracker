"use client";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
};

export function Slider({ label, value, min, max, step = 1, onChange, format, hint }: Props) {
  const displayed = format ? format(value) : String(value);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label className="label-cap">{label}</label>
        <span className="font-mono mono-num text-[14px]">{displayed}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
