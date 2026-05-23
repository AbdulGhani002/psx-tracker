"use client";

import { forwardRef } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
};

export const TextInput = forwardRef<HTMLInputElement, Props>(function TextInput(
  { label, hint, className = "", ...rest },
  ref
) {
  return (
    <div className="space-y-1.5">
      {label && <label className="label-cap block">{label}</label>}
      <div className="border-b border-ink">
        <input
          ref={ref}
          type="text"
          className={`w-full bg-transparent text-[14px] py-1.5 focus:outline-none ${className}`}
          {...rest}
        />
      </div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
});
