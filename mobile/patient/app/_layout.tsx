import React from "react";
import { Stack } from "expo-router";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  useFonts,
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
} from "@expo-google-fonts/figtree";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { I18nProvider } from "../src/i18n";

function Chrome() {
  const { t, mode } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
  });

  // Render once fonts are ready; the themed background shows under the splash meanwhile.
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>{fontsLoaded ? <Chrome /> : <View style={{ flex: 1, backgroundColor: "#f5f8f9" }} />}</I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
