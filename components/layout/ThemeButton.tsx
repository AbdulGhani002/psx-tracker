"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icons";
import { THEME_KEY } from "./theme-key";

type Theme = "light" | "dark";

const saved = (): Theme | null => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};

function apply(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
}

// The top bar's light and dark switch. A pick is kept in this browser; until
// there is one the page follows the device (ThemeScript sets it before paint).
export function ThemeButton() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const now: Theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    setTheme(now);
    apply(now);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (saved()) return;
      const t: Theme = mq.matches ? "dark" : "light";
      setTheme(t);
      apply(t);
    };
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="text-muted hover:text-ink p-1.5 rounded"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        setTheme(next);
        apply(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {}
      }}
    >
      {theme === "dark" ? <Icon.sun className="w-[18px] h-[18px]" /> : <Icon.moon className="w-[18px] h-[18px]" />}
    </button>
  );
}
