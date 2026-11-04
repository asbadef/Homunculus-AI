import React, { useState } from "react";
import { View, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { AppText, Muted } from "../../src/ui/base";
import { FormScreen } from "../../src/ui/form";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { useAuthDraft } from "./_layout";
import { useSession } from "../../src/session/SessionProvider";
import { resolvePatientByFin, setCurrentPatient, maskFin } from "../../src/demo/patients";
import { layout } from "../../src/theme/tokens";

export default function Pin() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const { draft } = useAuthDraft();
  const { signIn } = useSession();
  const [pin, setPin] = useState("");

  function finish() {
    const p = resolvePatientByFin(draft.id); // registered patient (gated at login)
    if (!p) {
      router.replace("/giris/giris");
      return;
    }
    setCurrentPatient(p.id);
    signIn({ name: p.name, finMasked: maskFin(draft.id || p.fin), fin: draft.id || p.fin, phone: p.phone }, draft.remember);
    router.replace("/(tabs)");
  }

  return (
    <FormScreen>
      <View style={{ height: 40 }} />
      <View style={{ alignItems: "center", gap: 14 }}>
        <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="keypad" size={34} color={t.brand} />
        </View>
        <AppText weight="bold" style={{ fontSize: 21, textAlign: "center" }}>
          {tr("auth.pin.title")}
        </AppText>
        <Muted style={{ textAlign: "center", paddingHorizontal: 20 }}>{tr("auth.pin.hint")}</Muted>
        <TextInput
          nativeID="pin"
          value={pin}
          onChangeText={(v) => setPin(v.replace(/[^0-9]/g, "").slice(0, 4))}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          style={{ width: 180, textAlign: "center", letterSpacing: 14, fontSize: 30, color: t.fg, fontFamily: layout.fontBold, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 16, paddingVertical: 14, marginTop: 8 }}
        />
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <BottomButton label={tr("auth.finish")} disabled={pin.length !== 4} onPress={finish} />
    </FormScreen>
  );
}
