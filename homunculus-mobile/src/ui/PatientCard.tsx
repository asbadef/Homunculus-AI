import { MotiPressable } from "moti/interactions";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { MotiView } from "moti";

import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { bedNumber } from "./bed";
import { GLOW_DURATION_MS, PRESS_SCALE, SPRING } from "../theme/motion";
import { toneColor } from "../theme/tokens";
import { RiskPill } from "./RiskPill";
import { VitalSparkline } from "./VitalSparkline";

export function PatientCard({ view, onPress }: { view: PatientView; onPress: () => void }) {
  const color = toneColor(view.tone);
  const bed = t("bed.label", { bed: bedNumber(view.board.patient_id) });

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
          <Text className="text-foreground text-base font-semibold">{bed}</Text>
          <RiskPill risk={view.board.risk} />
        </View>

        {view.top ? (
          <Text className="text-clinical-stale mt-2 text-sm" numberOfLines={2}>
            {view.top.summary}
          </Text>
        ) : null}

        <View className="mt-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <Text className="text-clinical-stale text-xs">
              {`${t("vital.sofa")} ${view.board.latest.sofa ?? "—"}`}
            </Text>
            <VitalSparkline values={view.series.map} width={72} height={20} tone={view.tone} />
          </View>

          {view.escalated ? (
            <Text className="text-xs font-bold" style={{ color: toneColor("critical") }}>
              {t("alert.escalated")}
            </Text>
          ) : view.unacknowledged ? (
            <Text className="text-clinical-warning text-xs font-semibold">
              {t("alert.unacknowledged")}
            </Text>
          ) : null}
        </View>
      </MotiView>
    </MotiPressable>
  );
}
