import React, { useState } from "react";
import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../src/ui/base";
import { FormScreen, TextField, Dropdown, DateField, ToggleRow } from "../../src/ui/form";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { useAuthDraft } from "./_layout";
import { validateIdentity } from "../../src/session/validate";

export default function Login() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  const { draft, set } = useAuthDraft();
  const [idv, setIdv] = useState(draft.id);
  const [birth, setBirth] = useState<Date | null>(draft.birthdate ? new Date(draft.birthdate) : null);
  const [phone, setPhone] = useState(draft.phone);

  const input = {
    country: draft.country,
    fin: draft.country === "az" ? idv : undefined,
    passport: draft.country === "foreign" ? idv : undefined,
    birthdate: birth ? String(birth.getFullYear()) : "",
    phone,
  };
  const res = validateIdentity(input);

  function next() {
    set({ id: idv, birthdate: birth ? birth.toISOString() : "", phone });
    router.push("/giris/sms");
  }

  return (
    <FormScreen>
      {/* Hero */}
      <LinearGradient colors={[t.brand, t.brandGrad2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ marginHorizontal: -16, paddingHorizontal: 20, paddingTop: insets.top + 24, paddingBottom: 28, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
        <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: "#ffffff22", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
          <Ionicons name="medkit" size={28} color="#ffffff" />
        </View>
        <AppText weight="extrabold" color="#ffffff" style={{ fontSize: 24 }}>
          {tr("auth.login.title")}
        </AppText>
        <AppText color="#ffffff" style={{ opacity: 0.92, marginTop: 4, fontSize: 14 }}>
          {tr("auth.hero")}
        </AppText>
      </LinearGradient>

      <View style={{ height: 22 }} />

      <Dropdown
        label={tr("auth.country.az") + " / " + tr("auth.country.foreign")}
        options={[
          { key: "az", label: tr("auth.country.az") },
          { key: "foreign", label: tr("auth.country.foreign") },
        ]}
        value={draft.country}
        onChange={(k) => set({ country: k as "az" | "foreign" })}
      />

      <TextField id="idv" label={draft.country === "az" ? tr("auth.fin") : tr("auth.passport")} value={idv} onChange={setIdv} autoCap="characters" />
      <DateField label={tr("auth.birthdate")} value={birth} onChange={setBirth} />
      <TextField id="phone" label={tr("auth.phone")} value={phone} onChange={setPhone} keyboard="phone-pad" placeholder="+994 ..." />

      <ToggleRow label={tr("auth.remember")} value={draft.remember} onChange={(v) => set({ remember: v })} />

      {!res.ok && (idv.length > 0 || phone.length > 0 || birth) ? (
        <AppText color={t.wait} style={{ fontSize: 12, marginBottom: 6 }}>
          {res.hint}
        </AppText>
      ) : null}

      <View style={{ flex: 1 }} />
      <BottomButton label={tr("auth.continue")} disabled={!res.ok} onPress={next} />
    </FormScreen>
  );
}
