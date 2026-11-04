import React from "react";
import { View, Pressable } from "react-native";
import { Tabs, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { layout } from "../../src/theme/tokens";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: { name: string; labelKey: string; icon: IconName }[] = [
  { name: "index", labelKey: "tab.home", icon: "home-outline" },
  { name: "randevu", labelKey: "tab.appointments", icon: "calendar-outline" },
  { name: "neticeler", labelKey: "tab.results", icon: "document-text-outline" },
  { name: "saglik", labelKey: "tab.health", icon: "pulse-outline" },
  { name: "profil", labelKey: "tab.profile", icon: "person-outline" },
];

export default function TabsLayout() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: t.brand,
          tabBarInactiveTintColor: t.faint,
          tabBarStyle: {
            backgroundColor: t.surface,
            borderTopColor: t.border,
            height: 58 + insets.bottom,
            paddingBottom: 6 + insets.bottom,
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontFamily: layout.fontSemiBold, fontSize: 10 },
        }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              tabBarLabel: tr(tab.labelKey),
              tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} size={size ?? 22} color={color as string} />,
            }}
          />
        ))}
      </Tabs>

      {/* Floating "book appointment" button — reachable from every tab. */}
      <Pressable
        onPress={() => router.push("/randevu-al/tip")}
        style={{ position: "absolute", right: 18, bottom: 58 + insets.bottom + 16 }}
        accessibilityRole="button"
      >
        <LinearGradient
          colors={[t.brand, t.brandGrad2]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: 56, height: 56, borderRadius: 99, alignItems: "center", justifyContent: "center", shadowColor: t.brand, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}
        >
          <Ionicons name="add" size={30} color="#ffffff" />
        </LinearGradient>
      </Pressable>
    </View>
  );
}
