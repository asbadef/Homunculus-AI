import { Text, View } from "react-native";

import { riskTone } from "../domain/risk";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useTheme } from "../theme/ThemeContext";
import type { Risk } from "../transport/types";

export function RiskPill({ risk }: { risk: Risk }) {
  const { toneColor } = useTheme();
  const color = toneColor(riskTone(risk));
  // M3: the palette moved from HSL function-notation strings to #rrggbb hex, so the old
  // HSL-to-HSLA alpha rewrite is no longer valid here — but the usual hex-suffix trick
  // (`${hex}1A` appends an 8-digit-hex alpha channel) now is. 1A = 10% opacity, matching the
  // tint this pill has always rendered.
  const tint = `${color}1A`;
  return (
    <View
      accessibilityLabel={`risk-pill-${risk}`}
      className="flex-row items-center gap-1.5 rounded-full border px-2.5 py-0.5"
      style={{ borderColor: color, backgroundColor: tint }}
    >
      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <Text className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
        {t(`risk.${risk}` as MessageKey)}
      </Text>
    </View>
  );
}
