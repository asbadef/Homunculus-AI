import React, { useState } from "react";
import { View, ScrollView, Image, Pressable, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen, AppText } from "../../src/ui/base";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { LANGS } from "../../src/i18n/core";
import { onboardingImages, logo } from "../../src/demo/images";

export default function Onboarding() {
  const { t } = useTheme();
  const { t: tr, lang, setLang } = useI18n();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const slides = [
    { title: tr("onb.1"), sub: tr("onb.1sub") },
    { title: tr("onb.2"), sub: tr("onb.2sub") },
    { title: tr("onb.3"), sub: tr("onb.3sub") },
    { title: tr("onb.4"), sub: tr("onb.4sub") },
  ];

  function cycleLang() {
    const i = LANGS.indexOf(lang);
    setLang(LANGS[(i + 1) % LANGS.length]);
  }

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Image source={logo} style={{ width: 26, height: 26 }} resizeMode="contain" />
          </View>
          <AppText weight="extrabold" color={t.brand} style={{ fontSize: 15 }}>
            {tr("onb.app")}
          </AppText>
        </View>
        <Pressable onPress={cycleLang} style={{ flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: t.border, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 6 }}>
          <Ionicons name="globe-outline" size={14} color={t.fg} />
          <AppText weight="semibold" style={{ fontSize: 12 }}>
            {tr("lang.code")}
          </AppText>
        </Pressable>
      </View>

      <View style={{ flex: 1, justifyContent: "center" }}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (width - 32)))}
        >
          {slides.map((s, i) => (
            <View key={i} style={{ width: width - 32, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, gap: 20 }}>
              <Image source={onboardingImages[i]} style={{ width: width - 72, height: width - 72, maxWidth: 340, maxHeight: 340, borderRadius: 32 }} resizeMode="cover" />
              <AppText weight="extrabold" style={{ fontSize: 24, textAlign: "center" }}>
                {s.title}
              </AppText>
              <AppText style={{ fontSize: 15, textAlign: "center", color: t.muted, lineHeight: 22, paddingHorizontal: 8 }}>
                {s.sub}
              </AppText>
            </View>
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 24 }}>
          {slides.map((_, i) => (
            <View key={i} style={{ width: i === page ? 20 : 7, height: 7, borderRadius: 99, backgroundColor: i === page ? t.brand : t.border }} />
          ))}
        </View>
      </View>
      <View style={{ paddingBottom: insets.bottom }}>
        <BottomButton label={tr("auth.start")} onPress={() => router.push("/giris/riza")} />
      </View>
    </Screen>
  );
}
