import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
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
  );
}
