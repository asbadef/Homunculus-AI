import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { visibleFeatures, FEATURES } from "../src/config/features";
import { getShortcutKeys, toggleShortcut } from "../src/demo/shortcuts";

export default function Shortcuts() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const items = visibleFeatures(FEATURES);
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => { getShortcutKeys().then(setKeys); }, []);

  return (
    <Screen scroll>
      <StackHeader title={tr("menu.shortcuts")} />
      <Muted style={{ fontSize: 12, marginBottom: 12 }}>{tr("sc.hint")}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {items.map((f) => {
          const on = keys.includes(f.key);
          return (
            <View key={f.key} style={{ width: "48%" }}>
              <Pressable onPress={() => router.push(f.route as any)}>
                <Card style={{ alignItems: "center", gap: 10, paddingVertical: 20, borderColor: on ? t.brand + "55" : t.border, borderWidth: on ? 1.5 : undefined }}>
                  <Pressable onPress={async () => setKeys(await toggleShortcut(f.key))} hitSlop={8} style={{ position: "absolute", top: 8, right: 8 }}>
                    <Ionicons name={on ? "star" : "star-outline"} size={18} color={on ? t.wait : t.faint} />
                  </Pressable>
                  <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={f.icon as any} size={24} color={t.brand} />
                  </View>
                  <AppText weight="semibold" style={{ textAlign: "center" }} numberOfLines={2}>{tr(f.titleKey)}</AppText>
                </Card>
              </Pressable>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}
