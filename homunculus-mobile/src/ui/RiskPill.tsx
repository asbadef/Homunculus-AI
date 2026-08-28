import { Text, View } from "react-native";

import { riskTone } from "../domain/risk";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { toneColor } from "../theme/tokens";
import type { Risk } from "../transport/types";

export function RiskPill({ risk }: { risk: Risk }) {
  const color = toneColor(riskTone(risk));
  // Our palette stores colours as hsl(...) strings, not hex, so the usual `${hex}1A` alpha trick
  // is invalid here. Convert the tone colour to an hsla(...) string with the same hue/sat/light
  // and a 10% alpha instead, so the pill keeps its tone-tinted fill honestly.
  const tint = color.replace("hsl(", "hsla(").replace(")", ", 0.1)");
  return (
    <View
      accessibilityLabel={`risk-pill-${risk}`}
      className="rounded-full border px-2.5 py-0.5"
      style={{ borderColor: color, backgroundColor: tint }}
    >
      <Text className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
        {t(`risk.${risk}` as MessageKey)}
      </Text>
    </View>
  );
}
