"use client";

import { forwardRef } from "react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  label?: string;
  value: number | string;
  onChange: (v: number) => void;
  suffix?: string;
  hint?: string;
  large?: boolean;
};

export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput({ label, value, onChange, suffix, hint, large = false, className = "", ...rest }, ref) {
  return (
    <div className="space-y-1.5">
      {label && <label className="label-cap block">{label}</label>}
      <div className="field" data-size={large ? "lg" : undefined}>
        <input
          ref={ref}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          className={`font-mono mono-num ${className}`}
          {...rest}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
});
