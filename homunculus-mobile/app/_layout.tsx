import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Suspense, lazy } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BoardProvider } from "../src/store/BoardProvider";
import { ThemeProvider, useTheme } from "../src/theme/ThemeContext";

// Lazy: see the comment in src/ui/AlertToastConnected.tsx for why this can't be a plain
// top-of-module import here — `expo export --platform web`'s static prerender crashes on moti's
// framer-motion re-export when it sits in the root layout's eagerly-required graph.
const AlertToastConnected = lazy(() => import("../src/ui/AlertToastConnected"));

// Split out of RootLayout because StatusBar's style and the Stack's contentStyle need the active
// palette, which only exists below <ThemeProvider> — this is that "below".
function Shell() {
  const { key, palette } = useTheme();
  return (
    <>
      <StatusBar style={key === "icu" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="patient/[id]" options={{ presentation: "card" }} />
      </Stack>
      <Suspense fallback={null}>
        <AlertToastConnected />
      </Suspense>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SafeAreaProvider>
          <BoardProvider>
            <Shell />
          </BoardProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
