import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText } from "../../src/ui/base";
import { Card } from "../../src/ui/widgets";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";

export default function Consent() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: 18 }}>
        <View style={{ alignItems: "center" }}>
          <View style={{ width: 84, height: 84, borderRadius: 24, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="lock-closed" size={40} color={t.brand} />
          </View>
        </View>
        <AppText weight="bold" style={{ fontSize: 20, textAlign: "center" }}>
          {tr("consent.title")}
        </AppText>
        <Card>
          <AppText style={{ fontSize: 14, lineHeight: 21 }}>{tr("consent.body")}</AppText>
        </Card>
      </View>
      <BottomButton label={tr("consent.accept")} onPress={() => router.push("/giris/giris")} />
    </Screen>
  );
}
