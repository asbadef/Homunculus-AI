import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted, Title } from "../../src/ui/base";
import { Card } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Prescription } from "../../src/demo/types";

export default function PrescriptionsList() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Prescription[] | null>(null);
  useEffect(() => {
    transport.getPrescriptions().then(setList);
  }, []);

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 14 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={t.fg} />
        </Pressable>
        <Title>{tr("rx.title")}</Title>
      </View>

      {list && list.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 50, gap: 8 }}>
          <Ionicons name="medical-outline" size={40} color={t.faint} />
          <Muted>{tr("rx.empty")}</Muted>
        </View>
      ) : (
        (list ?? []).map((p) => (
          <Pressable key={p.id} onPress={() => router.push(`/reseptler/${p.id}`)}>
            <Card style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="medical" size={20} color={t.brand} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText weight="semibold" numberOfLines={2}>
                  {p.name}
                </AppText>
                <Muted style={{ marginTop: 2 }}>{p.date}</Muted>
              </View>
              <Ionicons name="chevron-forward" size={20} color={t.faint} />
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
