import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader, StatusPill } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";

const VACCINES = [
  { id: "v1", name: "Hepatit B", date: "Doğumda", done: true },
  { id: "v2", name: "BCG", date: "1 ay", done: true },
  { id: "v3", name: "DBT-1", date: "2 ay", done: true },
  { id: "v4", name: "DBT-2", date: "4 ay", done: false },
];

export default function VaccineCard() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen scroll>
      <StackHeader title={tr("feat.vaccine")} />
      {VACCINES.map((v) => (
        <Card key={v.id} style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Ionicons name={v.done ? "checkmark-circle" : "time-outline"} size={22} color={v.done ? t.ok : t.wait} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold">{v.name}</AppText>
            <Muted style={{ marginTop: 2 }}>{v.date}</Muted>
          </View>
          <StatusPill kind={v.done ? "ok" : "wait"} label={v.done ? tr("status.confirmed") : tr("status.pending")} />
        </Card>
      ))}
    </Screen>
  );
}
