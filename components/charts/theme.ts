export const CHART_THEME = {
  background: "var(--inverted-bg)",
  text: "#a09484",
  textBright: "var(--inverted-fg)",
  grid: "#3a3833",
  accent: "var(--accent)",
  cream: "var(--inverted-fg)",
  amber: "var(--amber)",
  positive: "var(--positive)",
  negative: "var(--negative)",
  muted: "#a09484",
};

export const AXIS_PROPS = {
  stroke: CHART_THEME.text,
  tick: { fill: CHART_THEME.text, fontSize: 10, fontFamily: "IBM Plex Mono, monospace" },
  tickLine: false,
  axisLine: { stroke: CHART_THEME.grid },
};

export const GRID_PROPS = {
  stroke: CHART_THEME.grid,
  strokeDasharray: "2 4",
  vertical: false,
};

export const TOOLTIP_STYLE = {
  background: CHART_THEME.background,
  border: `1px solid ${CHART_THEME.textBright}`,
  borderRadius: 0,
  padding: "8px 12px",
  fontFamily: "IBM Plex Mono, monospace",
  fontSize: 12,
};

export const TOOLTIP_LABEL_STYLE = {
  color: CHART_THEME.textBright,
  fontFamily: "IBM Plex Mono, monospace",
  fontSize: 11,
  marginBottom: 4,
};
