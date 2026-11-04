import React from "react";
import Svg, { Polyline, Circle, Line } from "react-native-svg";
import { useTheme } from "../theme/ThemeProvider";
import { scalePoints } from "./trendMath";

// Small line chart for a result value's history. Drawn inside a fixed box via scalePoints.
export function TrendSparkline({ series, width = 260, height = 64 }: { series: number[]; width?: number; height?: number }) {
  const { t } = useTheme();
  if (!series || series.length < 2) return null;
  const pad = 8;
  const pts = scalePoints(series, width - pad * 2, height - pad * 2).map((p) => ({ x: p.x + pad, y: p.y + pad }));
  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={height}>
      <Line x1={0} y1={height - pad} x2={width} y2={height - pad} stroke={t.border} strokeWidth={1} />
      <Polyline points={poly} fill="none" stroke={t.brand} strokeWidth={2.5} />
      {pts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={t.brand} />
      ))}
      <Circle cx={last.x} cy={last.y} r={4.5} fill={t.brand} />
    </Svg>
  );
}
