import React, { useState } from "react";
import { View, Image, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../src/ui/base";
import { FormScreen, TextField, Dropdown, DateField, ToggleRow } from "../../src/ui/form";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { LANGS } from "../../src/i18n/core";
import { useAuthDraft } from "./_layout";
import { validateIdentity } from "../../src/session/validate";
import { COUNTRIES, isLocal } from "../../src/data/countries";
import { logo } from "../../src/demo/images";

export default function Login() {
  const { t } = useTheme();
  const { t: tr, lang, setLang } = useI18n();
  const insets = useSafeAreaInsets();
  const { draft, set } = useAuthDraft();
  const [idv, setIdv] = useState(draft.id);
  const [birth, setBirth] = useState<Date | null>(draft.birthdate ? new Date(draft.birthdate) : null);
  const local = isLocal(draft.country);

  const res = validateIdentity({
    country: local ? "az" : "foreign",
    fin: local ? idv : undefined,
    passport: local ? undefined : idv,
    birthdate: birth ? String(birth.getFullYear()) : "",
  });

  function cycleLang() {
    const i = LANGS.indexOf(lang);
    setLang(LANGS[(i + 1) % LANGS.length]);
  }
  function next() {
    set({ id: idv, birthdate: birth ? birth.toISOString() : "" });
    router.push("/giris/sms");
  }

  return (
    <FormScreen>
      {/* Hero with logo, language switch, own tagline */}
      <LinearGradient colors={[t.brand, t.brandGrad2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ marginHorizontal: -16, paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: 26, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, alignItems: "center" }}>
        <Pressable onPress={cycleLang} style={{ position: "absolute", top: insets.top + 12, right: 18, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#ffffff2e", borderRadius: 99, paddingHorizontal: 11, paddingVertical: 6 }}>
          <Ionicons name="globe-outline" size={14} color="#ffffff" />
          <AppText weight="semibold" color="#ffffff" style={{ fontSize: 12 }}>
            {tr("lang.code")}
          </AppText>
        </Pressable>
        <View style={{ width: 76, height: 76, borderRadius: 22, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", marginTop: 10, marginBottom: 12 }}>
          <Image source={logo} style={{ width: 62, height: 62 }} resizeMode="contain" />
        </View>
        <AppText weight="extrabold" color="#ffffff" style={{ fontSize: 23 }}>
          {tr("auth.login.title")}
        </AppText>
        <AppText color="#ffffff" style={{ opacity: 0.92, marginTop: 4, fontSize: 14 }}>
          {tr("auth.hero")}
        </AppText>
      </LinearGradient>

      <View style={{ height: 22 }} />

      <Dropdown label={tr("auth.country")} options={COUNTRIES} value={draft.country} onChange={(k) => set({ country: k })} search />
      <TextField id="idv" label={local ? tr("auth.fin") : tr("auth.passport")} value={idv} onChange={setIdv} autoCap="characters" />
      <DateField label={tr("auth.birthdate")} value={birth} onChange={setBirth} />

      <AppText style={{ fontSize: 12, color: t.muted, marginBottom: 14, marginTop: -4 }}>
        {tr("auth.smsAuto")}
      </AppText>

      <ToggleRow label={tr("auth.remember")} value={draft.remember} onChange={(v) => set({ remember: v })} />

      {!res.ok && (idv.length > 0 || birth) ? (
        <AppText color={t.wait} style={{ fontSize: 12, marginBottom: 6 }}>
          {res.hint}
        </AppText>
      ) : null}

      <View style={{ flex: 1, minHeight: 16 }} />
      <BottomButton label={tr("auth.continue")} disabled={!res.ok} onPress={next} />
    </FormScreen>
  );
}
