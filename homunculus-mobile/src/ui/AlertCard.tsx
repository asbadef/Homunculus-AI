import { BlurView } from "expo-blur";
import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";

import { lookupSource } from "../domain/citations";
import { severityTone } from "../domain/risk";
import { t } from "../i18n";
import { useTheme } from "../theme/ThemeContext";
import type { BoardAlert } from "../transport/types";
import { StalenessBadge } from "./StalenessBadge";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-3">
      <Text className="text-clinical-stale text-[11px] font-semibold uppercase tracking-wide">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function AlertCard({
  alert,
  escalated,
  onAcknowledge,
  onCite,
}: {
  alert: BoardAlert;
  escalated: boolean;
  onAcknowledge: () => void;
  onCite: (citationId: string) => void;
}) {
  const { key, toneColor } = useTheme();
  const color = escalated ? toneColor("critical") : toneColor(severityTone(alert.severity));

  return (
    <View
      accessibilityLabel={`alert-${alert.kind}`}
      className="mb-3 overflow-hidden rounded-2xl border"
      style={{ borderColor: color }}
    >
      <BlurView intensity={24} tint={key === "icu" ? "dark" : "light"} className="p-4">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="text-foreground flex-1 text-base font-semibold">{alert.summary}</Text>
          {escalated ? (
            <Text className="text-xs font-bold" style={{ color }}>
              {t("alert.escalated")}
            </Text>
          ) : null}
        </View>

        <StalenessBadge inputs={alert.stale_inputs} />

        {alert.downgraded ? (
          <Section title={t("alert.chronicContext")}>
            <Text className="text-clinical-stale mt-1 text-sm">{t("alert.downgraded")}</Text>
            <Text className="text-clinical-stale mt-1 text-sm">{alert.chronic_context}</Text>
          </Section>
        ) : null}

        <Section title={t("alert.reasoning")}>
          <Text className="text-clinical-stale mt-1 text-sm">{alert.clinical_reasoning}</Text>
        </Section>

        <Section title={t("alert.actions")}>
          {alert.recommended_actions.map((action) => (
            <Text key={action} className="text-foreground mt-1 text-sm">
              {`• ${action}`}
            </Text>
          ))}
        </Section>

        <Section title={t("alert.confidence")}>
          <Text className="text-clinical-stale mt-1 text-sm">{alert.confidence}</Text>
        </Section>

        <Section title={t("alert.sources")}>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {alert.supporting_evidence.map((id) => (
              <Pressable
                key={id}
                accessibilityLabel={`citation-${id}`}
                onPress={() => onCite(id)}
                className="rounded-lg border border-clinical-border px-2 py-1"
              >
                <Text className="text-clinical-safe text-xs">{lookupSource(id)?.title ?? id}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <View className="mt-4">
          {alert.acknowledged ? (
            <Text className="text-clinical-safe text-sm font-semibold">{t("alert.acknowledged")}</Text>
          ) : (
            <Pressable
              accessibilityLabel={`acknowledge-${alert.kind}`}
              onPress={onAcknowledge}
              className="items-center rounded-xl border px-4 py-2"
              style={{ borderColor: color }}
            >
              <Text className="text-sm font-semibold" style={{ color }}>
                {t("alert.acknowledge")}
              </Text>
            </Pressable>
          )}
        </View>
      </BlurView>
    </View>
  );
}
