import { forwardRef } from "react";

type Variant = "outline" | "solid" | "ghost";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  active?: boolean;
};

// Three weights of the same button: filled in the accent for the one action
// a screen is about, a hairline box for the rest, and bare text for the
// quiet ones. Callers pass sizing through className as before.
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ variant = "outline", active = false, className = "", children, ...rest }, ref) {
  const base = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  let styles = "";
  if (variant === "solid") styles = "btn-primary";
  else if (variant === "outline") styles = active ? "btn-ghost !bg-[var(--surface-2)] !text-[var(--ink)]" : "btn-ghost";
  else styles = "text-[13px] font-medium text-muted hover:text-ink px-2 py-1.5 rounded-lg hover:bg-[var(--surface-2)]";
  return (
    <button ref={ref} className={`${base} ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
});
