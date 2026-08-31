import { Tabs } from "expo-router";
import { Activity, BellRing, Settings2 } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useTheme } from "../../src/theme/ThemeContext";

const ICONS = { index: Activity, alerts: BellRing, settings: Settings2 } as const;

// The structural slice of @react-navigation/bottom-tabs' BottomTabBarProps this bar actually
// uses — that package lives nested inside expo-router here, so its types aren't importable.
type TabBarProps = {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  navigation: { navigate: (name: string) => void };
};

// M6: the kit's floating pill nav — a solid-accent rounded bar hovering over the content, white
// icons, the active one seated in a faint white circle. Replaces the standard edge-to-edge tab
// bar; screens pad their scroll content (pb-24) so nothing hides beneath it.
function FloatingPillBar({ state, navigation }: TabBarProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 24, right: 24, bottom: insets.bottom + 12 }}
    >
      <View
        accessibilityRole="tablist"
        className="h-[52px] flex-row items-center justify-around rounded-full"
        style={{
          backgroundColor: palette.accent,
          shadowColor: palette.accent,
          shadowOpacity: 0.35,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 8 },
          elevation: 8,
        }}
      >
        {state.routes.map((route, index) => {
          const Icon = ICONS[route.name as keyof typeof ICONS] ?? Activity;
          const focused = state.index === index;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={`tab-${route.name}`}
              onPress={() => navigation.navigate(route.name)}
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: focused ? "#ffffff2e" : "transparent" }}
            >
              <Icon color="#ffffff" size={21} strokeWidth={focused ? 2.4 : 1.8} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { palette } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <FloatingPillBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.patients") }} />
      <Tabs.Screen name="alerts" options={{ title: t("tabs.alerts") }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings") }} />
    </Tabs>
  );
}
