import "../global.css";
import {
  LeagueSpartan_500Medium,
  LeagueSpartan_600SemiBold,
  LeagueSpartan_700Bold,
  LeagueSpartan_800ExtraBold,
} from "@expo-google-fonts/league-spartan";
import { useFonts } from "expo-font";
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
  // M6: League Spartan is the kit's face (see tailwind.config.js's fontFamily.sans and
  // palette.js's header comment). The splash gate is deliberately simple — render nothing until
  // the weights are in — rather than a manual expo-splash-screen hide/prevent dance; the app has
  // no other slow startup work competing for that screen. Under jest, expo-font is mocked to
  // report "already loaded" synchronously (see jest.setup.js), so no test ever sits behind this.
  const [fontsLoaded] = useFonts({
    LeagueSpartan_500Medium,
    LeagueSpartan_600SemiBold,
    LeagueSpartan_700Bold,
    LeagueSpartan_800ExtraBold,
  });

  if (!fontsLoaded) return null;

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
