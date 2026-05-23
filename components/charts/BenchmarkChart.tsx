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

export type BenchmarkPoint = {
  date: string;
  portfolioIndex: number;
  kse100Index: number;
};

type Props = {
  points: BenchmarkPoint[];
  height?: number;
};

export function BenchmarkChart({ points, height = 320 }: Props) {
  return (
    <div style={{ background: CHART_THEME.background, padding: 20 }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 14, right: 24, bottom: 8, left: 50 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis
            {...AXIS_PROPS}
            dataKey="date"
            tickFormatter={(v: string) => v.slice(5)}
            minTickGap={40}
          />
          <YAxis
            {...AXIS_PROPS}
            tickFormatter={(v: number) => v.toFixed(0)}
            width={42}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={{ color: CHART_THEME.textBright, fontFamily: "IBM Plex Mono, monospace", fontSize: 12 }}
            labelFormatter={(label) => label}
            formatter={(value: number, name: string) => [
              `${value.toFixed(2)}`,
              name === "portfolioIndex" ? "Portfolio" : "KSE-100",
            ]}
            separator=" "
          />
          <ReferenceLine
            y={100}
            stroke={CHART_THEME.amber}
            strokeDasharray="4 4"
            label={{
              value: "Start",
              fill: CHART_THEME.amber,
              fontSize: 10,
              fontFamily: "IBM Plex Mono, monospace",
              position: "right",
            }}
          />
          <Line
            type="monotone"
            dataKey="portfolioIndex"
            name="portfolioIndex"
            stroke={CHART_THEME.accent}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="kse100Index"
            name="kse100Index"
            stroke={CHART_THEME.cream}
            strokeWidth={1.5}
            strokeDasharray="2 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
