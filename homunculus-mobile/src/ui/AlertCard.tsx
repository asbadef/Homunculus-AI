import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";

import { flagKeyFor } from "../domain/flags";
import { severityTone } from "../domain/risk";
import { t } from "../i18n";
import palettes from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";
import type { BoardAlert } from "../transport/types";
import { StalenessBadge } from "./StalenessBadge";

/** An alert's severity is always a real finding — never the calm "muted" fallback risk/severity
 *  tone shares with a stable bed. Mirrors BedCard's own SevTone note. */
type SevTone = "safe" | "warning" | "critical";

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

// M6: the kit's anatomy applied to an alert — a `soft`-tinted wash card (see palette.js), a solid
// severity pill at the head (BedCard's own sevSolid/sevSolidText pairing, reused so a pill means
// the same thing everywhere in the app), the engine's summary/reasoning shown verbatim, and a
// bottom pill row: a solid "Onayla" acknowledge action plus one ghost "Kılavuz" pill per citation
// (never collapsed to one — an alert can carry two sources, see assets/demo/icu-ward.json, and
// dropping the second would quietly hide a real reference). Ghost pills get their own `bg-panel`
// so accent text still only ever sits on the one surface the layering law allows (see
// src/theme/palette.js's header comment) even though the card itself sits on `soft`, which is not
// a legal surface for blue text (measured: accent-on-soft is under 4.5:1 in both skins).
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
  const { palette } = useTheme();
  const sevTone: SevTone = escalated ? "critical" : (severityTone(alert.severity) as SevTone);
  const pillFill = palette.sevSolid[sevTone];
  const pillText = palettes.sevSolidText[sevTone];

  return (
    <View
      accessibilityLabel={`alert-${alert.kind}`}
      className="mb-3 rounded-[22px] p-4"
      style={{ backgroundColor: palette.soft }}
    >
      <View className="flex-row items-center justify-between gap-2">
        <View
          className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
          style={{ backgroundColor: pillFill }}
        >
          <Text
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: pillText }}
          >
            {t(flagKeyFor(alert))}
          </Text>
        </View>
        {escalated ? (
          <Text className="text-clinical-critical text-xs font-bold">{t("alert.escalated")}</Text>
        ) : null}
      </View>

      <Text className="text-foreground mt-3 text-base font-semibold">{alert.summary}</Text>

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

      <View className="mt-4 flex-row flex-wrap items-center gap-2">
        {alert.acknowledged ? (
          <Text className="text-clinical-safe text-sm font-semibold">{t("alert.acknowledged")}</Text>
        ) : (
          <Pressable
            accessibilityLabel={`acknowledge-${alert.kind}`}
            onPress={onAcknowledge}
            className="rounded-full px-4 py-2"
            style={{ backgroundColor: palette.accent }}
          >
            <Text className="text-sm font-semibold" style={{ color: "#ffffff" }}>
              {t("alert.acknowledge")}
            </Text>
          </Pressable>
        )}

        {alert.supporting_evidence.map((id) => (
          <Pressable
            key={id}
            accessibilityLabel={`citation-${id}`}
            onPress={() => onCite(id)}
            className="bg-panel flex-row items-center rounded-full px-4 py-2"
            style={{ borderWidth: 1, borderColor: palette.accent }}
          >
            <Text className="text-accent text-sm font-semibold">{t("alert.guideline")}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
