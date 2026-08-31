import { ClipboardList, Droplets, Gauge, Heart, TestTube, Thermometer } from "lucide-react-native";
import type { ComponentType } from "react";
import { Text, View } from "react-native";

import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useTheme } from "../theme/ThemeContext";
import type { LatestVitals } from "../transport/types";

interface VitalCellSpec {
  key: "heart_rate" | "map" | "lactate" | "spo2" | "temperature" | "sofa";
  Icon: ComponentType<{ size?: number; color?: string }>;
  labelKey: MessageKey;
  unit: string;
}

// M6: the detail screen's "VİTAL BULGULAR" wash panel holds six white slots — see the M6 spec's
// Detail row (NABIZ/OAB/LAKTAT/SpO2/ATEŞ/SOFA). Distinct from BedCard's pill-shaped stat row: this
// is the kit's white-inner-panel cell anatomy. `channel.*` supplies the NABIZ/OAB/LAKTAT labels —
// those keys were the per-vital chip labels M5 paired with a now-retired per-vital colour; the
// text survives here even though the colour override didn't.
const VITALS: VitalCellSpec[] = [
  { key: "heart_rate", Icon: Heart, labelKey: "channel.hr", unit: "/dk" },
  { key: "map", Icon: Gauge, labelKey: "channel.map", unit: "mmHg" },
  { key: "lactate", Icon: TestTube, labelKey: "channel.lactate", unit: "mmol/L" },
  { key: "spo2", Icon: Droplets, labelKey: "vital.spo2", unit: "%" },
  { key: "temperature", Icon: Thermometer, labelKey: "vital.tempShort", unit: "°C" },
  { key: "sofa", Icon: ClipboardList, labelKey: "vital.sofa", unit: "" },
];

/** The detail screen's vitals grid, living inside the wash panel — six white slots, "—" for
 *  whatever hasn't arrived yet. */
export function VitalsRow({ latest }: { latest: LatestVitals }) {
  const { palette } = useTheme();
  return (
    <View className="mt-3 flex-row flex-wrap gap-2">
      {VITALS.map(({ key, Icon, labelKey, unit }) => {
        const value = latest[key];
        return (
          <View
            key={key}
            className="bg-panel items-center rounded-[14px] px-1 py-2"
            style={{ width: "31%", borderWidth: 1, borderColor: palette.clinical.border }}
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
            {unit.length > 0 ? <Text className="text-clinical-stale text-[9px]">{unit}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}
