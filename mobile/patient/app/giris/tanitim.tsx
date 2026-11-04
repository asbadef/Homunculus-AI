import React, { useState } from "react";
import { View, ScrollView, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText } from "../../src/ui/base";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";

const ICONS: any[] = ["shield-checkmark", "calendar", "document-text", "medical"];

export default function Onboarding() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const slides = [tr("onb.1"), tr("onb.2"), tr("onb.3"), tr("onb.4")];

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <AppText weight="extrabold" color={t.brand} style={{ fontSize: 15, textAlign: "center", marginBottom: 12 }}>
          {tr("onb.app")}
        </AppText>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (width - 32)))}
        >
          {slides.map((s, i) => (
            <View key={i} style={{ width: width - 32, alignItems: "center", paddingHorizontal: 20, gap: 20 }}>
              <View style={{ width: 120, height: 120, borderRadius: 32, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={ICONS[i]} size={56} color={t.brand} />
              </View>
              <AppText weight="bold" style={{ fontSize: 20, textAlign: "center" }}>
                {s}
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
      <BottomButton label={tr("auth.start")} onPress={() => router.push("/giris/riza")} />
    </Screen>
  );
}
