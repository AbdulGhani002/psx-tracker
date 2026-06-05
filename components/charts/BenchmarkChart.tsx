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
import type { SeriesKey } from "./series-meta";
import { SERIES_META } from "./series-meta";

export type BenchmarkPoint = {
  date: string;
  portfolio: number | null;
  kse100: number | null;
  kmi30: number | null;
  portfolioUsd: number | null;
  sp500: number | null;
  usdpkr: number | null;
  riskFree: number | null;
};

type Props = {
  points: BenchmarkPoint[];
  visible: SeriesKey[];
  height?: number;
};

export function BenchmarkChart({ points, visible, height = 340 }: Props) {
  return (
    <div style={{ background: CHART_THEME.background, padding: 20 }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 14, right: 24, bottom: 8, left: 44 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis
            {...AXIS_PROPS}
            dataKey="date"
            tickFormatter={(v: string) => v.slice(5)}
            minTickGap={44}
          />
          <YAxis
            {...AXIS_PROPS}
            tickFormatter={(v: number) => v.toFixed(0)}
            width={40}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={{ color: CHART_THEME.textBright, fontFamily: "IBM Plex Mono, monospace", fontSize: 12 }}
            labelFormatter={(label) => label}
            formatter={(value: number, name: string) => [
              value == null ? "—" : value.toFixed(2),
              SERIES_META[name as SeriesKey]?.label ?? name,
            ]}
            separator=" "
          />
          <ReferenceLine
            y={100}
            stroke={CHART_THEME.amber}
            strokeDasharray="4 4"
            label={{
              value: "Start = 100",
              fill: CHART_THEME.amber,
              fontSize: 10,
              fontFamily: "IBM Plex Mono, monospace",
              position: "right",
            }}
          />
          {visible.map((key) => {
            const m = SERIES_META[key];
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stroke={m.stroke}
                strokeWidth={m.width}
                strokeDasharray={m.dash}
                dot={false}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
