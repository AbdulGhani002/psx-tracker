"use client";

import { useEffect, useState } from "react";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("theme")) as
      | "light"
      | "dark"
      | null;
    if (saved === "dark" || saved === "light") setTheme(saved);
    else {
      const current = document.documentElement.getAttribute("data-theme");
      setTheme(current === "dark" ? "dark" : "light");
    }
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className={`label-cap transition-colors hover:text-ink ${compact ? "" : "border border-ink px-3 py-1.5"}`}
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
    >
      {theme === "dark" ? "☾ Dark" : "☀ Light"}
    </button>
  );
}

// Inline script (runs before paint) to apply the saved theme and avoid a flash.
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
