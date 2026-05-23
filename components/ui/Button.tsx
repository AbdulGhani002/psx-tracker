import { forwardRef } from "react";

type Variant = "outline" | "solid" | "ghost";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  active?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "outline", active = false, className = "", children, ...rest },
  ref
) {
  const base =
    "inline-flex items-center justify-center px-4 py-2 text-[12px] font-medium uppercase tracking-button transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  let styles = "";
  if (variant === "outline") {
    styles = active
      ? "bg-ink text-paper border border-ink"
      : "bg-transparent text-ink border border-ink hover:bg-ink hover:text-paper";
  } else if (variant === "solid") {
    styles = "bg-ink text-paper border border-ink hover:bg-[var(--accent-deep)] hover:border-[var(--accent-deep)]";
  } else {
    styles = "bg-transparent text-ink border border-transparent hover:underline";
  }

  return (
    <button ref={ref} className={`${base} ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
});
