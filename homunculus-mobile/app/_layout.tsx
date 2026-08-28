import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Suspense, lazy } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BoardProvider } from "../src/store/BoardProvider";
import { tokens } from "../src/theme/tokens";

// Lazy: see the comment in src/ui/AlertToastConnected.tsx for why this can't be a plain
// top-of-module import here — `expo export --platform web`'s static prerender crashes on moti's
// framer-motion re-export when it sits in the root layout's eagerly-required graph.
const AlertToastConnected = lazy(() => import("../src/ui/AlertToastConnected"));

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: tokens.background }}>
      <SafeAreaProvider>
        <BoardProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: tokens.background },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="patient/[id]" options={{ presentation: "card" }} />
          </Stack>
          <Suspense fallback={null}>
            <AlertToastConnected />
          </Suspense>
        </BoardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
