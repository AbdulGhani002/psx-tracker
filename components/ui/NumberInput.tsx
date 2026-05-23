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

export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput(
  { label, value, onChange, suffix, hint, large = false, className = "", ...rest },
  ref
) {
  return (
    <div className="space-y-1.5">
      {label && <label className="label-cap block">{label}</label>}
      <div className="relative flex items-center border-b border-ink">
        <input
          ref={ref}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          className={`flex-1 bg-transparent font-mono mono-num ${
            large ? "text-[22px] py-2" : "text-[15px] py-1.5"
          } focus:outline-none ${className}`}
          {...rest}
        />
        {suffix && (
          <span className="font-mono text-[12px] text-muted ml-1">{suffix}</span>
        )}
      </div>
      {hint && <div className="text-[11px] text-muted font-mono">{hint}</div>}
    </div>
  );
});
