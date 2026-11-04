import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";

const NOTIFS = [
  { id: "n1", icon: "calendar", title: "Randevun sabah", body: "Dr. Elçin Əliyev · 14:30", time: "1 saat əvvəl" },
  { id: "n2", icon: "document-text", title: "Nəticən hazırdır", body: "Tam qan sayımı", time: "Dünən" },
  { id: "n3", icon: "medical", title: "Dərman vaxtı", body: "Amoksisilin · 20:00", time: "Dünən" },
];

export default function Notifications() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen scroll>
      <StackHeader title={tr("notif.title")} />
      {NOTIFS.map((n) => (
        <Card key={n.id} style={{ marginBottom: 10, flexDirection: "row", gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={n.icon as any} size={20} color={t.brand} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold">{n.title}</AppText>
            <Muted style={{ marginTop: 2 }}>{n.body}</Muted>
            <Muted style={{ marginTop: 2, fontSize: 11 }}>{n.time}</Muted>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
