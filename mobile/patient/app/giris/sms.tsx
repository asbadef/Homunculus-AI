import React, { useState } from "react";
import { View, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { AppText, Muted } from "../../src/ui/base";
import { FormScreen } from "../../src/ui/form";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { layout } from "../../src/theme/tokens";

export default function Sms() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [code, setCode] = useState("");
  return (
    <FormScreen>
      <View style={{ height: 40 }} />
      <View style={{ alignItems: "center", gap: 14 }}>
        <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chatbox-ellipses" size={34} color={t.brand} />
        </View>
        <AppText weight="bold" style={{ fontSize: 21, textAlign: "center" }}>
          {tr("auth.sms.title")}
        </AppText>
        <Muted style={{ textAlign: "center", paddingHorizontal: 20 }}>{tr("auth.sms.hint")}</Muted>
        <TextInput
          nativeID="sms"
          value={code}
          onChangeText={(v) => setCode(v.replace(/[^0-9]/g, "").slice(0, 4))}
          keyboardType="number-pad"
          autoFocus
          style={{ width: 180, textAlign: "center", letterSpacing: 14, fontSize: 30, color: t.fg, fontFamily: layout.fontBold, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 16, paddingVertical: 14, marginTop: 8 }}
        />
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <BottomButton label={tr("auth.verify")} disabled={code.length !== 4} onPress={() => router.push("/giris/pin")} />
    </FormScreen>
  );
}
