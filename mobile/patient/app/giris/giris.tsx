import React, { useState } from "react";
import { View, TextInput } from "react-native";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Chip } from "../../src/ui/widgets";
import { BottomButton } from "../../src/appointment/parts";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { useAuthDraft } from "./_layout";
import { validateIdentity } from "../../src/session/validate";
import { layout } from "../../src/theme/tokens";

function Field({ id, label, value, onChange, keyboard }: { id: string; label: string; value: string; onChange: (v: string) => void; keyboard?: "default" | "number-pad" | "phone-pad" }) {
  const { t } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <Muted style={{ fontSize: 12, marginBottom: 6 }}>{label}</Muted>
      <TextInput
        nativeID={id}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboard ?? "default"}
        style={{ backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 }}
        placeholderTextColor={t.faint}
      />
    </View>
  );
}

export default function Login() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const { draft, set } = useAuthDraft();
  const [idv, setIdv] = useState(draft.id);
  const [birth, setBirth] = useState(draft.birthdate);
  const [phone, setPhone] = useState(draft.phone);

  const input = {
    country: draft.country,
    fin: draft.country === "az" ? idv : undefined,
    passport: draft.country === "foreign" ? idv : undefined,
    birthdate: birth,
    phone,
  };
  const res = validateIdentity(input);

  function next() {
    set({ id: idv, birthdate: birth, phone });
    router.push("/giris/sms");
  }

  return (
    <Screen scroll>
      <View style={{ paddingTop: 10, paddingBottom: 18 }}>
        <AppText weight="bold" style={{ fontSize: 22 }}>
          {tr("auth.login.title")}
        </AppText>
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 18 }}>
        <Chip label={tr("auth.country.az")} selected={draft.country === "az"} onPress={() => set({ country: "az" })} />
        <Chip label={tr("auth.country.foreign")} selected={draft.country === "foreign"} onPress={() => set({ country: "foreign" })} />
      </View>

      <Field id="idv" label={draft.country === "az" ? tr("auth.fin") : tr("auth.passport")} value={idv} onChange={setIdv} />
      <Field id="birth" label={tr("auth.birthdate")} value={birth} onChange={setBirth} keyboard="number-pad" />
      <Field id="phone" label={tr("auth.phone")} value={phone} onChange={setPhone} keyboard="phone-pad" />

      {!res.ok && (idv.length > 0 || birth.length > 0 || phone.length > 0) ? (
        <AppText color={t.wait} style={{ fontSize: 12, marginBottom: 6 }}>
          {res.hint}
        </AppText>
      ) : null}

      <BottomButton label={tr("auth.continue")} disabled={!res.ok} onPress={next} />
    </Screen>
  );
}
