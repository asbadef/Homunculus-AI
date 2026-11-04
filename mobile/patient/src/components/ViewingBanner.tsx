import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { AppText } from "../ui/base";
import { useTheme } from "../theme/ThemeProvider";
import { useI18n } from "../i18n";
import { subscribeViewing, getViewingName, returnToSelf } from "../demo/viewing";

// Floating pill above the tab bar, shown while viewing a family member's account,
// with a one-tap return. Absolute so it never disturbs screen layout.
export function ViewingBanner() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState<string | null>(getViewingName());

  useEffect(() => subscribeViewing(() => setName(getViewingName())), []);

  if (!name) return null;
  return (
    <View style={{ position: "absolute", left: 14, right: 14, bottom: 60 + insets.bottom + 12 }} pointerEvents="box-none">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: t.wait, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 }}>
        <Ionicons name="eye-outline" size={17} color="#ffffff" />
        <AppText weight="semibold" color="#ffffff" style={{ flex: 1, minWidth: 0, fontSize: 12.5 }} numberOfLines={1}>
          {name} {tr("view.viewing")}
        </AppText>
        <Pressable
          onPress={() => { returnToSelf(); router.replace("/"); }}
          style={{ backgroundColor: "#ffffff30", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 }}
        >
          <AppText weight="bold" color="#ffffff" style={{ fontSize: 12 }}>{tr("view.returnSelf")}</AppText>
        </Pressable>
      </View>
    </View>
  );
}
