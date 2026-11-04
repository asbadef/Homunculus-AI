import React from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { visibleFeatures, FEATURES } from "../src/config/features";

export default function Shortcuts() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const items = visibleFeatures(FEATURES);

  return (
    <Screen scroll>
      <StackHeader title={tr("menu.shortcuts")} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingTop: 6 }}>
        {items.map((f) => (
          <Pressable key={f.key} onPress={() => router.push(f.route as any)} style={{ width: "48%" }}>
            <Card style={{ alignItems: "center", gap: 10, paddingVertical: 20 }}>
              <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={f.icon as any} size={24} color={t.brand} />
              </View>
              <AppText weight="semibold" style={{ textAlign: "center" }} numberOfLines={2}>{tr(f.titleKey)}</AppText>
            </Card>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
