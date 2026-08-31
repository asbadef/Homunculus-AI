import Svg, { Path } from "react-native-svg";

import { sparklinePath } from "../domain/sparkline";
import { useTheme } from "../theme/ThemeContext";
import type { Tone } from "../theme/tokens";

// M6: the detail screen's trend panel draws every sparkline in the kit's own blue (see the M6
// spec's Detail row: "trend sparklines ... blue") rather than the severity-tone colour M1 used —
// vital identity there now comes from the white strip + label, not the line colour. `color`
// overrides `tone` when supplied; `tone` stays for any other caller (and its own test) that still
// wants a severity-coloured line.
export function VitalSparkline({
  values,
  width,
  height,
  tone,
  color,
}: {
  values: readonly number[];
  width: number;
  height: number;
  tone?: Tone;
  color?: string;
}) {
  const { toneColor, palette } = useTheme();
  const path = sparklinePath(values, { width, height, padding: 1.5 });
  if (path === "") return null;
  const stroke = color ?? (tone !== undefined ? toneColor(tone) : palette.accent);
  return (
    <Svg accessibilityLabel="sparkline" width={width} height={height}>
      <Path d={path} stroke={stroke} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}
