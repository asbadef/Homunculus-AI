import { Text, View } from "react-native";

import { riskTone } from "../domain/risk";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { tintFor } from "../theme/tint";
import { useTheme } from "../theme/ThemeContext";
import type { Risk } from "../transport/types";

export function RiskPill({ risk }: { risk: Risk }) {
  const { key, toneColor } = useTheme();
  const color = toneColor(riskTone(risk));
  // The tinted-chip idiom — see src/theme/tint.ts for why the two skins need different alphas.
  const tint = tintFor(color, key);
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
