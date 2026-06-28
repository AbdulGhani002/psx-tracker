"use client";

import { useEffect } from "react";

// Globally stop the mouse wheel from changing the value of a focused
// <input type="number">. Browsers increment/decrement by the step when you
// scroll over a focused number field — which silently corrupts amounts in forms.
// We blur the field on wheel instead: the typed value is preserved and the page
// still scrolls normally. One click re-focuses if they want to keep editing.
export function NoNumberScroll() {
  useEffect(() => {
    const onWheel = () => {
      const a = document.activeElement as HTMLInputElement | null;
      if (a && a.tagName === "INPUT" && a.type === "number") a.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}
