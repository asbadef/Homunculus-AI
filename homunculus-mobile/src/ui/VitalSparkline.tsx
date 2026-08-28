import Svg, { Path } from "react-native-svg";

import { sparklinePath } from "../domain/sparkline";
import { toneColor } from "../theme/tokens";
import type { Tone } from "../theme/tokens";

export function VitalSparkline({
  values,
  width,
  height,
  tone,
}: {
  values: readonly number[];
  width: number;
  height: number;
  tone: Tone;
}) {
  const path = sparklinePath(values, { width, height, padding: 1.5 });
  if (path === "") return null;
  return (
    <Svg accessibilityLabel="sparkline" width={width} height={height}>
      <Path d={path} stroke={toneColor(tone)} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}
