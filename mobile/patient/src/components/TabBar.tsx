import React from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { useI18n } from "../i18n";
import { layout } from "../theme/tokens";
import { AppText } from "../ui/base";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

// Tabs shown in the bar (saglik is reachable from Home, not the bar) + the centered
// "book appointment" FAB between randevu and neticeler.
const META: Record<string, { icon: IconName; labelKey: string; path: string }> = {
  index: { icon: "home", labelKey: "tab.home", path: "/" },
  randevu: { icon: "calendar", labelKey: "tab.appointments", path: "/randevu" },
  neticeler: { icon: "document-text", labelKey: "tab.results", path: "/neticeler" },
  profil: { icon: "person", labelKey: "tab.profile", path: "/profil" },
};
const LEFT = ["index", "randevu"];
const RIGHT = ["neticeler", "profil"];

export function TabBar({ state }: any) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();

  const routeByName: Record<string, { route: any; index: number }> = Object.fromEntries(
    state.routes.map((r: any, i: number) => [r.name, { route: r, index: i }])
  );

  function Item({ name }: { name: string }) {
    const entry = routeByName[name];
    const meta = META[name];
    if (!entry || !meta) return <View style={{ flex: 1 }} />;
    const focused = state.index === entry.index;
    return (
      <Pressable
        onPress={() => { if (!focused) router.navigate(meta.path as any); }}
        style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingTop: 2 }}
        accessibilityRole="button"
      >
        <Ionicons name={(focused ? meta.icon : (meta.icon + "-outline")) as IconName} size={23} color={focused ? t.brand : t.faint} />
        <AppText weight={focused ? "semibold" : "regular"} style={{ fontSize: 10 }} color={focused ? t.brand : t.faint}>
          {tr(meta.labelKey)}
        </AppText>
      </Pressable>
    );
  }

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.border, height: 60 + insets.bottom, paddingBottom: insets.bottom, paddingTop: 7 }}>
      {LEFT.map((n) => <Item key={n} name={n} />)}

      {/* Centered raised "Randevu al" button */}
      <View style={{ width: 72, alignItems: "center" }}>
        <Pressable onPress={() => router.push("/randevu-al/tip")} style={{ marginTop: -22 }} accessibilityRole="button" accessibilityLabel={tr("appointments.new")}>
          <LinearGradient
            colors={[t.brand, t.brandGrad2]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: 58, height: 58, borderRadius: 99, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: t.surface, shadowColor: t.brand, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 6 }}
          >
            <Ionicons name="add" size={30} color="#ffffff" />
          </LinearGradient>
        </Pressable>
      </View>

      {RIGHT.map((n) => <Item key={n} name={n} />)}
    </View>
  );
}
