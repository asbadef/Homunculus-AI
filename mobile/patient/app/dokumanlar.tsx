import React from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { demoAlert } from "../src/ui/demo";

const DOCS = [
  { id: "d1", name: "Epikriz — Kardiologiya", date: "24.11.2026" },
  { id: "d2", name: "Rentgen hesabatı", date: "24.11.2026" },
  { id: "d3", name: "Xarici analiz (yüklənmiş)", date: "18.11.2026" },
];

export default function Documents() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen scroll>
      <StackHeader title={tr("feat.documents")} />
      {DOCS.map((d) => (
        <Card key={d.id} style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Ionicons name="document-attach-outline" size={22} color={t.brand} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold" numberOfLines={1}>
              {d.name}
            </AppText>
            <Muted style={{ marginTop: 2 }}>{d.date}</Muted>
          </View>
          <Ionicons name="download-outline" size={20} color={t.faint} />
        </Card>
      ))}
      <Pressable onPress={() => demoAlert(tr)} style={{ marginTop: 6, borderWidth: 1, borderColor: t.border, borderRadius: 13, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Ionicons name="cloud-upload-outline" size={18} color={t.brand} />
        <AppText weight="semibold">{tr("doc.upload")}</AppText>
      </Pressable>
    </Screen>
  );
}
