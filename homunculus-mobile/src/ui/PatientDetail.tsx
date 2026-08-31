import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { alertKey } from "../domain/keys";
import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { useTheme } from "../theme/ThemeContext";
import { AlertCard } from "./AlertCard";
import { GuidelineDrawer } from "./GuidelineDrawer";
import { RiskPill } from "./RiskPill";
import { VitalSparkline } from "./VitalSparkline";
import { VitalsRow } from "./VitalsRow";
import { Waveform } from "./Waveform";
import { bedNumber } from "./bed";

// A single trend-panel row, on its own white strip inside the wash panel — label, sparkline (or
// its "no data" fallback for a series still too short to draw — VitalSparkline itself returns
// null under 2 points), latest value mono-bold. M6: always drawn in the kit's blue (see the M6
// spec's Detail row — the sparkline no longer carries severity colour, the six vital slots and
// this strip do the same job the old channel colours did).
function TrendRow({ label, values, latest }: { label: string; values: readonly number[]; latest: number | null }) {
  const { palette } = useTheme();
  return (
    <View
      className="bg-panel mt-2 flex-row items-center justify-between gap-2 rounded-[14px] px-3 py-2"
      style={{ borderWidth: 1, borderColor: palette.clinical.border }}
    >
      <Text className="text-clinical-stale text-xs">{label}</Text>
      {values.length < 2 ? (
        <Text className="text-clinical-stale flex-1 text-right text-xs">{t("vital.noData")}</Text>
      ) : (
        <VitalSparkline values={values} width={170} height={28} color={palette.accent} />
      )}
      <Text className="text-foreground text-sm font-bold tabular-nums">{latest ?? "—"}</Text>
    </View>
  );
}

export function PatientDetail({
  view,
  onAcknowledge,
}: {
  view: PatientView;
  onAcknowledge: (kind: string) => void;
}) {
  const [citation, setCitation] = useState<{ id: string; confidence: string } | null>(null);
  const { board, series } = view;
  const hr = board.latest.heart_rate;

  return (
    <>
      <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-foreground text-2xl font-semibold">
            {t("bed.label", { bed: bedNumber(board.patient_id) })}
          </Text>
          <RiskPill risk={board.risk} />
        </View>

        {/* M6: the kit's wash panel — dark-on-wash heading (never blue; the layering law reserves
            blue text for `panel`, see src/theme/palette.js), six white vital slots, the ECG strip
            (already its own white panel, gated on HR the same way it always was), then the trend
            sparklines on their own white strips. See the M6 spec's Detail row. */}
        <View className="bg-card mt-4 rounded-[22px] p-3">
          <Text className="text-clinical-stale text-[11px] font-semibold uppercase tracking-wide">
            {t("detail.vitals")}
          </Text>

          <VitalsRow latest={board.latest} />

          {hr != null ? (
            <View className="mt-3">
              <Waveform hr={hr} />
            </View>
          ) : null}

          <Text className="text-clinical-stale mt-4 text-[11px] font-semibold uppercase tracking-wide">
            {t("vital.trend")}
          </Text>
          <TrendRow label={t("vital.map")} values={series.map} latest={board.latest.map} />
          <TrendRow label={t("vital.lactate")} values={series.lactate} latest={board.latest.lactate} />
          <TrendRow label={t("vital.sofa")} values={series.sofa} latest={board.latest.sofa} />
        </View>

        {/* Blue heading directly on the screen ground: palette.js's own header comment declares
            accent-on-background a validated TEXT pairing in both skins (light 5.02:1, icu
            5.22:1 — see its accent-colour comment), so this clears the layering law without
            needing a panel wrapper. */}
        <Text className="text-accent mt-6 text-sm font-extrabold uppercase tracking-wide">
          {t("detail.alerts")}
        </Text>

        {board.alerts.length === 0 ? (
          <Text className="text-clinical-stale mt-2 text-sm">{t("detail.noAlerts")}</Text>
        ) : (
          <View className="mt-2">
            {board.alerts.map((alert) => (
              <AlertCard
                key={alert.kind}
                alert={{
                  ...alert,
                  acknowledged:
                    alert.acknowledged ||
                    view.acknowledgedKeys.has(alertKey(board.patient_id, alert.kind)),
                }}
                escalated={
                  alert.escalated || view.escalatedKeys.has(alertKey(board.patient_id, alert.kind))
                }
                onAcknowledge={() => onAcknowledge(alert.kind)}
                onCite={(id) => setCitation({ id, confidence: alert.confidence })}
              />
            ))}
          </View>
        )}
        <View className="h-8" />
      </ScrollView>

      <GuidelineDrawer
        citationId={citation?.id ?? null}
        confidence={citation?.confidence ?? ""}
        onClose={() => setCitation(null)}
      />
    </>
  );
}
