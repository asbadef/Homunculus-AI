import React from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen, AppText } from "../../src/ui/base";
import { Card } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";

export default function Consent() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  const points = [tr("consent.p1"), tr("consent.p2"), tr("consent.p3"), tr("consent.p4")];

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: 16 }}>
        <View style={{ alignItems: "center" }}>
          <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="shield-checkmark" size={38} color={t.brand} />
          </View>
        </View>
        <AppText weight="bold" style={{ fontSize: 21, textAlign: "center" }}>
          {tr("consent.title")}
        </AppText>
        <AppText style={{ fontSize: 14, lineHeight: 21, textAlign: "center", color: t.muted, paddingHorizontal: 6 }}>
          {tr("consent.body")}
        </AppText>
        <Card style={{ gap: 12 }}>
          {points.map((p, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <Ionicons name="checkmark-circle" size={18} color={t.brand} style={{ marginTop: 1 }} />
              <AppText style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 }}>{p}</AppText>
            </View>
          ))}
        </Card>
      </View>

      <View style={{ paddingBottom: insets.bottom + 6, gap: 10 }}>
        <Pressable
          onPress={() => router.push("/giris/giris")}
          style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: "center" }}
        >
          <AppText weight="bold" color="#ffffff" style={{ fontSize: 15 }}>
            {tr("consent.accept")}
          </AppText>
        </Pressable>
        <Pressable
          onPress={() => router.back()}
          style={{ borderWidth: 1, borderColor: t.border, borderRadius: 14, paddingVertical: 15, alignItems: "center" }}
        >
          <AppText weight="semibold" color={t.muted} style={{ fontSize: 15 }}>
            {tr("consent.reject")}
          </AppText>
        </Pressable>
      </View>
    </Screen>
  );
}
