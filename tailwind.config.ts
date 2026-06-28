import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        paper: "var(--paper)",
        "paper-2": "var(--paper-2)",
        muted: "var(--muted)",
        rule: "var(--rule)",
        accent: "var(--accent)",
        "accent-deep": "var(--accent-deep)",
        positive: "var(--positive)",
        negative: "var(--negative)",
        amber: "var(--amber)",
        "inverted-bg": "var(--inverted-bg)",
        "inverted-fg": "var(--inverted-fg)",
      },
      fontFamily: {
        display: ["var(--font-display)", '"Fraunces"', "Georgia", "serif"],
        sans: ["var(--font-sans)", '"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", '"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        none: "0",
      },
      letterSpacing: {
        label: "0.18em",
        button: "0.08em",
        stat: "0.12em",
      },
    },
  },
  plugins: [],
};

export default config;
