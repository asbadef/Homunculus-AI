import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BoardProvider } from "../src/store/BoardProvider";
import { tokens } from "../src/theme/tokens";

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
        </BoardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
