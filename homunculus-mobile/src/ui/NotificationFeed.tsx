import { Pressable, ScrollView, Text, View } from "react-native";

import { flagKeyForKind } from "../domain/flags";
import { severityTone } from "../domain/risk";
import { t } from "../i18n";
import palettes from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";
import type { BoardNotification } from "../transport/types";

/** Mirrors BedCard/AlertCard's own SevTone note: a notification's severity is always a real
 *  finding, never the calm "muted" fallback risk/severity tone shares with a stable bed. */
type SevTone = "safe" | "warning" | "critical";

// M6: the kit's anatomy applied to a notification row — a pale-wash card (BedCard's own
// `bg-card rounded-[22px]`), a solid severity pill carrying the finding's own name (the same
// `flagKeyForKind` lookup AlertCard/BedCard use, so a pill means the same thing everywhere in the
// app — see the M6 spec's "Alerts & Settings & Sunucu & toast & theme picker" row), then the
// server's own title/body verbatim inside the kit's white inner panel (blue text's only legal
// surface stays reserved for headings; this text is plain foreground, same as StatPill's value).
function Row({ note, onSelect }: { note: BoardNotification; onSelect: (id: string) => void }) {
  const { palette } = useTheme();
  const sevTone: SevTone = severityTone(note.severity) as SevTone;
  const pillFill = palette.sevSolid[sevTone];
  const pillText = palettes.sevSolidText[sevTone];

  return (
    <Pressable
      accessibilityLabel={`notification-${note.patient_id}-${note.kind}-${note.ts}`}
      onPress={() => onSelect(note.patient_id)}
      className="bg-card mb-3 rounded-[22px] p-3"
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
            {t(flagKeyForKind(note.kind, note.severity))}
          </Text>
        </View>
        <Text className="text-clinical-stale text-[11px]">{note.ts.slice(11, 16)}</Text>
      </View>

      <View className="bg-panel mt-2 rounded-[14px] px-3 py-2">
        <Text className="text-foreground text-xs font-semibold">{note.title}</Text>
        <Text className="text-foreground mt-1 text-sm">{note.body}</Text>
      </View>
    </Pressable>
  );
}

export function NotificationFeed({
  notifications,
  onSelect,
}: {
  notifications: BoardNotification[];
  onSelect: (patientId: string) => void;
}) {
  if (notifications.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-8">
        <Text className="text-clinical-stale">{t("alerts.empty")}</Text>
      </View>
    );
  }

  const escalations = notifications.filter((n) => n.trigger === "escalation");
  const fresh = notifications.filter((n) => n.trigger !== "escalation");

  return (
    <ScrollView contentContainerClassName="p-4">
      {escalations.length > 0 ? (
        <>
          <Text className="text-clinical-critical mb-2 text-[11px] font-semibold uppercase tracking-wide">
            {t("alerts.escalatedSection")}
          </Text>
          {escalations.map((note) => (
            <Row key={`${note.patient_id}-${note.kind}-${note.ts}`} note={note} onSelect={onSelect} />
          ))}
        </>
      ) : null}

      {fresh.length > 0 ? (
        <>
          <Text className="text-clinical-stale mb-2 mt-2 text-[11px] font-semibold uppercase tracking-wide">
            {t("alerts.newSection")}
          </Text>
          {fresh.map((note) => (
            <Row key={`${note.patient_id}-${note.kind}-${note.ts}`} note={note} onSelect={onSelect} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
