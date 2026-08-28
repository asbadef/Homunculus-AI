import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { alertKey } from "../domain/keys";
import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { AlertCard } from "./AlertCard";
import { GuidelineDrawer } from "./GuidelineDrawer";
import { RiskPill } from "./RiskPill";
import { VitalTile } from "./VitalTile";
import { bedNumber } from "./bed";

export function PatientDetail({
  view,
  onAcknowledge,
}: {
  view: PatientView;
  onAcknowledge: (kind: string) => void;
}) {
  const [citation, setCitation] = useState<{ id: string; confidence: string } | null>(null);
  const { board, series } = view;

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
        <Text className="text-clinical-stale mt-0.5 text-[11px]">{t("vital.trend")}</Text>

        <View className="mt-2 flex-row gap-3">
          <VitalTile
            label={t("vital.heartRate")}
            value={board.latest.heart_rate}
            unit="/dk"
            values={series.heart_rate}
            tone={view.tone}
          />
          <VitalTile
            label={t("vital.map")}
            value={board.latest.map}
            unit="mmHg"
            values={series.map}
            tone={view.tone}
          />
        </View>
        <View className="mt-3 flex-row gap-3">
          <VitalTile
            label={t("vital.lactate")}
            value={board.latest.lactate}
            unit="mmol/L"
            values={series.lactate}
            tone={view.tone}
          />
          <VitalTile
            label={t("vital.sofa")}
            value={board.latest.sofa}
            unit=""
            values={series.sofa}
            tone={view.tone}
          />
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
