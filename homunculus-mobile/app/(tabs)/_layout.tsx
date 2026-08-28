import { Tabs } from "expo-router";
import { Activity, BellRing, Settings2 } from "lucide-react-native";

import { t } from "../../src/i18n";
import { tokens } from "../../src/theme/tokens";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.clinical.safe,
        tabBarInactiveTintColor: tokens.clinical.stale,
        tabBarStyle: {
          backgroundColor: tokens.card,
          borderTopColor: tokens.clinical.border,
        },
        sceneStyle: { backgroundColor: tokens.background },
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
