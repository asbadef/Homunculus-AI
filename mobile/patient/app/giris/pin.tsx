import React, { useState } from "react";
import { View, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { useAuthDraft } from "./_layout";
import { useSession } from "../../src/session/SessionProvider";
import { layout } from "../../src/theme/tokens";

function maskId(id: string): string {
  if (id.length <= 3) return id;
  return id.slice(0, 2) + "••••" + id.slice(-1);
}

export default function Pin() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const { draft } = useAuthDraft();
  const { signIn } = useSession();
  const [pin, setPin] = useState("");

  function finish() {
    signIn({ name: "Aysel Hüseynova", finMasked: maskId(draft.id), phone: draft.phone });
    router.replace("/(tabs)");
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: 18 }}>
        <View style={{ alignItems: "center" }}>
          <Ionicons name="keypad-outline" size={48} color={t.brand} />
        </View>
        <AppText weight="bold" style={{ fontSize: 20, textAlign: "center" }}>
          {tr("auth.pin.title")}
        </AppText>
        <Muted style={{ textAlign: "center" }}>{tr("auth.pin.hint")}</Muted>
        <TextInput
          nativeID="pin"
          value={pin}
          onChangeText={(v) => setPin(v.replace(/[^0-9]/g, "").slice(0, 4))}
          keyboardType="number-pad"
          secureTextEntry
          style={{ alignSelf: "center", width: 160, textAlign: "center", letterSpacing: 12, fontSize: 28, color: t.fg, fontFamily: layout.fontBold, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 14, paddingVertical: 12 }}
        />
      </View>
      <BottomButton label={tr("auth.finish")} disabled={pin.length !== 4} onPress={finish} />
    </Screen>
  );
}
