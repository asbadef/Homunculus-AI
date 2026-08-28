import { Clock } from "lucide-react-native";
import { Text, View } from "react-native";

import { staleLabel } from "../domain/staleness";
import { t } from "../i18n";
import { tokens } from "../theme/tokens";

export function StalenessBadge({
  inputs,
  agesMs = {},
}: {
  inputs: readonly string[];
  agesMs?: Record<string, number>;
}) {
  const label = staleLabel(inputs, agesMs);
  if (label === null) return null;
  return (
    <View
      accessibilityLabel="staleness-badge"
      className="flex-row items-center gap-1 rounded-md border border-clinical-border px-2 py-0.5"
    >
      <Clock size={12} color={tokens.clinical.stale} />
      <Text className="text-clinical-stale text-xs">{t("stale.badge", { inputs: label })}</Text>
    </View>
  );
}
