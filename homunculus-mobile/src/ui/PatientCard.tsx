import { MotiPressable } from "moti/interactions";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { MotiView } from "moti";

import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { bedNumber } from "./bed";
import { GLOW_DURATION_MS, PRESS_SCALE, SPRING } from "../theme/motion";
import { useTheme } from "../theme/ThemeContext";
import { RiskPill } from "./RiskPill";
import { VitalsRow } from "./VitalsRow";
import { Waveform } from "./Waveform";

// M4: rebuilt as the web cockpit's bed card (dashboard/src/ClinicalDemo.jsx `BedBoard`,
// ~line 1010) — bed chip + dotted risk pill, summary line, the five-cell vitals row, a waveform
// strip when a heart rate exists, a chip row, and a faint footer. The MAP sparkline that used to
// sit here moved out (trends stay on the detail screen); no name/age/MRN — bed identity only.
export function PatientCard({ view, onPress }: { view: PatientView; onPress: () => void }) {
  const { toneColor } = useTheme();
  const color = toneColor(view.tone);
  const bed = t("bed.label", { bed: bedNumber(view.board.patient_id) });
  const hr = view.board.latest.heart_rate;

  const animate = useMemo(
    () =>
      ({ pressed }: { pressed: boolean }) => {
        "worklet";
        return { scale: pressed ? PRESS_SCALE : 1 };
      },
    [],
  );

  return (
    <MotiPressable
      accessibilityLabel={`patient-card-${view.board.patient_id}`}
      onPress={onPress}
      animate={animate}
      transition={{ type: "spring", ...SPRING }}
    >
      <MotiView
        from={{ opacity: view.escalated ? 0.55 : 1 }}
        animate={{ opacity: 1 }}
        transition={
          view.escalated
            ? { type: "timing", duration: GLOW_DURATION_MS, loop: true }
            : { type: "spring", ...SPRING }
        }
        style={{
          borderColor: color,
          shadowColor: color,
          shadowOpacity: view.tone === "critical" ? 0.45 : 0,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
          elevation: view.tone === "critical" ? 6 : 0,
        }}
        className="mb-3 rounded-2xl border bg-card p-4"
      >
        <View className="flex-row items-center justify-between">
          <View className="bg-background rounded-md px-2 py-0.5">
            <Text className="text-foreground text-xs font-bold">{bed}</Text>
          </View>
          <RiskPill risk={view.board.risk} />
        </View>

        {view.top ? (
          <Text className="text-clinical-stale mt-2 text-sm" numberOfLines={2}>
            {view.top.summary}
          </Text>
        ) : null}

        <VitalsRow latest={view.board.latest} />

        {hr != null ? (
          <View className="mt-2">
            <Waveform hr={hr} height={30} />
          </View>
        ) : null}

        <View className="mt-2 flex-row flex-wrap items-center gap-2">
          <View className="border-clinical-border rounded-full border px-2 py-0.5">
            <Text className="text-clinical-stale text-xs font-semibold">
              {`${t("vital.sofa")} ${view.board.latest.sofa ?? "—"}`}
            </Text>
          </View>

          {view.escalated ? (
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: `${toneColor("critical")}1A` }}
            >
              <Text className="text-xs font-bold" style={{ color: toneColor("critical") }}>
                {t("alert.escalated")}
              </Text>
            </View>
          ) : view.unacknowledged ? (
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: `${toneColor("warning")}1A` }}
            >
              <Text className="text-clinical-warning text-xs font-semibold">
                {t("alert.unacknowledged")}
              </Text>
            </View>
          ) : null}
        </View>

        <Text className="text-clinical-stale mt-3 text-xs">
          {t(`risk.${view.board.risk}` as MessageKey)}
        </Text>
      </MotiView>
    </MotiPressable>
  );
}
