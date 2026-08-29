import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { alertKey } from "../domain/keys";
import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import type { Tone } from "../theme/tokens";
import { AlertCard } from "./AlertCard";
import { GuidelineDrawer } from "./GuidelineDrawer";
import { RiskPill } from "./RiskPill";
import { VitalSparkline } from "./VitalSparkline";
import { VitalsRow } from "./VitalsRow";
import { Waveform } from "./Waveform";
import { bedNumber } from "./bed";

// A single trend-panel row: label, sparkline (or its "no data" fallback for a series still too
// short to draw — VitalSparkline itself returns null under 2 points), latest value mono-bold.
function TrendRow({
  label,
  values,
  latest,
  tone,
}: {
  label: string;
  values: readonly number[];
  latest: number | null;
  tone: Tone;
}) {
  return (
    <View className="mt-2 flex-row items-center justify-between gap-2">
      <Text className="text-clinical-stale text-xs">{label}</Text>
      {values.length < 2 ? (
        <Text className="text-clinical-stale flex-1 text-right text-xs">{t("vital.noData")}</Text>
      ) : (
        <VitalSparkline values={values} width={200} height={28} tone={tone} />
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

        <Text className="text-clinical-stale mt-4 text-[11px] font-semibold uppercase tracking-wide">
          {t("detail.vitals")}
        </Text>

        <VitalsRow latest={board.latest} />

        {hr != null ? (
          <View className="mt-3">
            <Waveform hr={hr} />
          </View>
        ) : null}

        <View className="mt-3 rounded-xl border border-clinical-border bg-card p-3">
          <Text className="text-clinical-stale text-[11px] font-semibold uppercase tracking-wide">
            {t("vital.trend")}
          </Text>
          <TrendRow label={t("vital.map")} values={series.map} latest={board.latest.map} tone={view.tone} />
          <TrendRow
            label={t("vital.lactate")}
            values={series.lactate}
            latest={board.latest.lactate}
            tone={view.tone}
          />
          <TrendRow label={t("vital.sofa")} values={series.sofa} latest={board.latest.sofa} tone={view.tone} />
        </View>

        <Text className="text-clinical-stale mt-6 text-[11px] font-semibold uppercase tracking-wide">
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
