import { Pressable, ScrollView, Text, View } from "react-native";

import { severityTone } from "../domain/risk";
import { t } from "../i18n";
import { useTheme } from "../theme/ThemeContext";
import type { BoardNotification } from "../transport/types";

function Row({ note, onSelect }: { note: BoardNotification; onSelect: (id: string) => void }) {
  const { toneColor } = useTheme();
  const color = toneColor(severityTone(note.severity));
  return (
    <Pressable
      accessibilityLabel={`notification-${note.patient_id}-${note.kind}-${note.ts}`}
      onPress={() => onSelect(note.patient_id)}
      className="mb-2 rounded-xl border border-clinical-border bg-card p-3"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold" style={{ color }}>
          {note.title}
        </Text>
        <Text className="text-clinical-stale text-[11px]">{note.ts.slice(11, 16)}</Text>
      </View>
      <Text className="text-foreground mt-1 text-sm">{note.body}</Text>
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
