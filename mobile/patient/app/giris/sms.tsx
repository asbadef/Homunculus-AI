import React, { useState } from "react";
import { View, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { layout } from "../../src/theme/tokens";

export default function Sms() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [code, setCode] = useState("");
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: 18 }}>
        <View style={{ alignItems: "center" }}>
          <Ionicons name="chatbox-ellipses-outline" size={48} color={t.brand} />
        </View>
        <AppText weight="bold" style={{ fontSize: 20, textAlign: "center" }}>
          {tr("auth.sms.title")}
        </AppText>
        <Muted style={{ textAlign: "center" }}>{tr("auth.sms.hint")}</Muted>
        <TextInput
          nativeID="sms"
          value={code}
          onChangeText={(v) => setCode(v.replace(/[^0-9]/g, "").slice(0, 4))}
          keyboardType="number-pad"
          style={{ alignSelf: "center", width: 160, textAlign: "center", letterSpacing: 12, fontSize: 28, color: t.fg, fontFamily: layout.fontBold, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 14, paddingVertical: 12 }}
        />
      </View>
      <BottomButton label={tr("auth.verify")} disabled={code.length !== 4} onPress={() => router.push("/giris/pin")} />
    </Screen>
  );
}
