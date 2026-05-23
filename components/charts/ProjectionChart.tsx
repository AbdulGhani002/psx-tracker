"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { AXIS_PROPS, CHART_THEME, GRID_PROPS, TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE } from "./theme";
import { fmtCompact } from "@/lib/format";

export type ProjectionPoint = {
  year: number;
  withDrip: number;
  withoutDrip: number;
  priceOnly: number;
};

type Props = {
  data: ProjectionPoint[];
  startValue: number;
  height?: number;
};

export function ProjectionChart({ data, startValue, height = 320 }: Props) {
  return (
    <div style={{ background: CHART_THEME.background, padding: 20 }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 14, right: 24, bottom: 8, left: 50 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis
            {...AXIS_PROPS}
            dataKey="year"
            tickFormatter={(v) => `Y${v}`}
          />
          <YAxis
            {...AXIS_PROPS}
            tickFormatter={(v) => fmtCompact(v)}
            width={60}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={{ color: CHART_THEME.textBright, fontFamily: "IBM Plex Mono, monospace", fontSize: 12 }}
            labelFormatter={(label) => `Year ${label}`}
            formatter={(value: number, name: string) => [fmtCompact(value), name]}
            separator=" "
          />
          <ReferenceLine
            y={startValue}
            stroke={CHART_THEME.amber}
            strokeDasharray="4 4"
            label={{
              value: "Today",
              fill: CHART_THEME.amber,
              fontSize: 10,
              fontFamily: "IBM Plex Mono, monospace",
              position: "right",
            }}
          />
          <Line
            type="monotone"
            dataKey="withDrip"
            name="With DRIP"
            stroke={CHART_THEME.accent}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="withoutDrip"
            name="No DRIP"
            stroke={CHART_THEME.cream}
            strokeWidth={1.5}
            strokeDasharray="2 3"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="priceOnly"
            name="Price only"
            stroke={CHART_THEME.muted}
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
