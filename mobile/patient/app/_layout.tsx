import React, { useEffect } from "react";
import { Stack, useSegments, useRouter } from "expo-router";
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
import { SessionProvider, useSession } from "../src/session/SessionProvider";

function Chrome() {
  const { t, mode } = useTheme();
  const { ready, signedIn } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === "giris";
    if (!signedIn && !inAuth) router.replace("/giris/tanitim");
    else if (signedIn && inAuth) router.replace("/(tabs)");
  }, [ready, signedIn, segments]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
    </View>
  );
}

function Gate({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { t } = useTheme();
  const { ready } = useSession();
  if (!fontsLoaded || !ready) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  return <Chrome />;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
  });

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Gate fontsLoaded={fontsLoaded} />
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
