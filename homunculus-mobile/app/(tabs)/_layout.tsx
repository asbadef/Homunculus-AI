import { Tabs } from "expo-router";
import { Activity, BellRing, Settings2 } from "lucide-react-native";

import { t } from "../../src/i18n";
import { useTheme } from "../../src/theme/ThemeContext";

export default function TabsLayout() {
  const { palette } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Active tab tint is the teal accent (branding), not clinical.safe (severity) — the
        // same fix as SettingsPanel's Chip.
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.clinical.stale,
        tabBarStyle: {
          backgroundColor: palette.card,
          borderTopColor: palette.clinical.border,
        },
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.patients"),
          tabBarIcon: ({ color, size }) => <Activity color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: t("tabs.alerts"),
          tabBarIcon: ({ color, size }) => <BellRing color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: ({ color, size }) => <Settings2 color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
