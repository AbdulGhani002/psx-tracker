"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/holdings", label: "Holdings" },
  { href: "/transactions", label: "Transactions" },
  { href: "/model", label: "Model" },
  { href: "/rebalance", label: "Rebalance" },
  { href: "/log", label: "Log" },
];

export function SiteNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <header className="border-b border-ink">
      <div className="max-w-[1000px] mx-auto px-6 py-5 flex items-baseline justify-between">
        <Link href="/" className="font-display text-[20px] tracking-tight">
          PSX Portfolio
        </Link>
        <nav className="flex gap-7">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`label-cap transition-colors hover:text-ink ${
                isActive(item.href) ? "text-ink" : ""
              }`}
              style={{
                color: isActive(item.href) ? "var(--ink)" : undefined,
              }}
            >
              {item.label}
              {isActive(item.href) && (
                <span
                  aria-hidden
                  className="ml-1.5 inline-block w-1 h-1 rounded-full align-middle"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
