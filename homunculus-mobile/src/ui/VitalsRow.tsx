import { Droplets, Gauge, Heart, Thermometer, Wind } from "lucide-react-native";
import type { ComponentType } from "react";
import { Text, View } from "react-native";

import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useTheme } from "../theme/ThemeContext";
import type { LatestVitals } from "../transport/types";

interface VitalCellSpec {
  key: "heart_rate" | "map" | "spo2" | "temperature" | "resp_rate";
  Icon: ComponentType<{ size?: number; color?: string }>;
  labelKey: MessageKey;
  unit: string;
}

// The cockpit's five-cell row (dashboard/src/ClinicalDemo.jsx `VITALS`/`VitalsGrid`,
// ~line 930) — same cells, same order, our i18n labels.
const VITALS: VitalCellSpec[] = [
  { key: "heart_rate", Icon: Heart, labelKey: "vital.hr", unit: "/dk" },
  { key: "map", Icon: Gauge, labelKey: "vital.map", unit: "mmHg" },
  { key: "spo2", Icon: Droplets, labelKey: "vital.spo2", unit: "%" },
  { key: "temperature", Icon: Thermometer, labelKey: "vital.tempShort", unit: "°C" },
  { key: "resp_rate", Icon: Wind, labelKey: "vital.rr", unit: "/dk" },
];

/** The bed card's vitals grid — one row, five cells, "—" for whatever hasn't arrived yet. */
export function VitalsRow({ latest }: { latest: LatestVitals }) {
  const { palette } = useTheme();
  return (
    <View className="mt-3 flex-row gap-1.5">
      {VITALS.map(({ key, Icon, labelKey, unit }) => {
        const value = latest[key];
        return (
          <View
            key={key}
            className="bg-background border-clinical-border flex-1 items-center rounded-lg border px-1 py-1.5"
          >
            <View className="flex-row items-center gap-1">
              <Icon size={11} color={palette.clinical.stale} />
              <Text className="text-clinical-stale text-[10px] font-semibold uppercase tracking-wide">
                {t(labelKey)}
              </Text>
            </View>
            <Text className="text-foreground text-xl font-bold leading-tight tabular-nums">
              {value ?? "—"}
            </Text>
            <Text className="text-clinical-stale text-[9px]">{unit}</Text>
          </View>
        );
      })}
    </View>
  );
}
