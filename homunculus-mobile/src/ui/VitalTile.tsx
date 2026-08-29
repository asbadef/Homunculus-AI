import { Text, View } from "react-native";

import { t } from "../i18n";
import { useTheme } from "../theme/ThemeContext";
import type { Tone } from "../theme/tokens";
import { StalenessBadge } from "./StalenessBadge";
import { VitalSparkline } from "./VitalSparkline";

export function VitalTile({
  label,
  value,
  unit,
  values,
  tone,
  staleInputs = [],
}: {
  label: string;
  value: number | null;
  unit: string;
  values: readonly number[];
  tone: Tone;
  staleInputs?: readonly string[];
}) {
  const { palette } = useTheme();
  return (
    <View
      accessibilityLabel={`vital-${label}`}
      className="flex-1 rounded-xl border border-clinical-border bg-card p-3"
    >
      <Text className="text-clinical-stale text-xs">{label}</Text>
      {value === null ? (
        <Text className="text-clinical-stale mt-1 text-base">{t("vital.noData")}</Text>
      ) : (
        <View className="mt-1 flex-row items-baseline gap-1">
          <Text className="text-2xl font-semibold" style={{ color: palette.foreground }}>
            {value}
          </Text>
          <Text className="text-clinical-stale text-xs">{unit}</Text>
        </View>
      )}
      <View className="mt-2">
        <VitalSparkline values={values} width={96} height={24} tone={tone} />
      </View>
      <View className="mt-2">
        <StalenessBadge inputs={staleInputs} />
      </View>
    </View>
  );
}
