import React, { useEffect, useState } from "react";
import { View, Pressable, StyleSheet, Modal, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card, GradientHeader } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { LANGS } from "../../src/i18n/core";
import { useSession } from "../../src/session/SessionProvider";
import { getEmail, setEmail as persistEmail } from "../../src/profile/email";
import { layout } from "../../src/theme/tokens";

function Row({ icon, label, value, onPress }: { icon: any; label: string; value?: string; onPress?: () => void }) {
  const { t } = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: 13, padding: 14, marginBottom: 10 }}>
      <Ionicons name={icon} size={20} color={t.brand} />
      <AppText weight="semibold" style={{ flex: 1, minWidth: 0 }}>
        {label}
      </AppText>
      {value ? <Muted>{value}</Muted> : <Ionicons name="chevron-forward" size={18} color={t.faint} />}
    </Pressable>
  );
}

export default function ProfileTab() {
  const { t, mode, toggle, bigText, contrast, toggleBigText, toggleContrast } = useTheme();
  const { t: tr, lang, setLang } = useI18n();
  const { user, signOut } = useSession();
  const [email, setEmailState] = useState("");
  const [editEmail, setEditEmail] = useState(false);
  const [draftEmail, setDraftEmail] = useState("");

  useEffect(() => {
    getEmail().then(setEmailState);
  }, []);

  function cycleLang() {
    const i = LANGS.indexOf(lang);
    setLang(LANGS[(i + 1) % LANGS.length]);
  }
  function saveEmail() {
    const v = draftEmail.trim();
    setEmailState(v);
    persistEmail(v);
    setEditEmail(false);
  }

  return (
    <Screen scroll>
      <GradientHeader title={tr("profile.title")} />

      <Card style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <View style={{ width: 58, height: 58, borderRadius: 99, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <AppText weight="bold" color={t.brand} style={{ fontSize: 24 }}>
            {(user?.name ?? "A").slice(0, 1)}
          </AppText>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText weight="bold" style={{ fontSize: 16 }}>
            {user?.name ?? "—"}
          </AppText>
          <Muted style={{ marginTop: 2 }}>
            FİN: {user?.finMasked ?? "—"}
          </Muted>
        </View>
      </Card>

      <Muted style={{ marginLeft: 2, marginBottom: 8, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{tr("pf.family")}</Muted>
      <Row icon="people-outline" label={tr("pf.family")} onPress={() => router.push("/aile")} />

      <View style={{ height: 10 }} />
      <Row icon="mail-outline" label={tr("pf.email")} value={email || tr("pf.emailAdd")} onPress={() => { setDraftEmail(email); setEditEmail(true); }} />
      <Row icon="globe-outline" label={tr("pf.lang")} value={tr("lang.code")} onPress={cycleLang} />
      <Row icon="moon-outline" label={tr("pf.theme")} value={mode === "dark" ? tr("pf.on") : tr("pf.off")} onPress={toggle} />
      <Row icon="text-outline" label={tr("pf.bigText")} value={bigText ? tr("pf.on") : tr("pf.off")} onPress={toggleBigText} />
      <Row icon="contrast-outline" label={tr("pf.contrast")} value={contrast ? tr("pf.on") : tr("pf.off")} onPress={toggleContrast} />
      <Row icon="notifications-outline" label={tr("pf.notif")} onPress={() => router.push("/bildirisler")} />
      <Row icon="options-outline" label={tr("pf.perms")} onPress={() => router.push("/iletisim-izinleri")} />

      <View style={{ height: 8 }} />
      <Pressable onPress={signOut} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 13, paddingVertical: 14, alignItems: "center" }}>
        <AppText weight="semibold" color={t.danger}>
          {tr("pf.logout")}
        </AppText>
      </Pressable>
      <View style={{ height: 16 }} />

      <Modal visible={editEmail} transparent animationType="fade" onRequestClose={() => setEditEmail(false)}>
        <Pressable onPress={() => setEditEmail(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderRadius: 18, padding: 18 }}>
            <AppText weight="bold" style={{ fontSize: 16, marginBottom: 12 }}>{tr("pf.email")}</AppText>
            <TextInput
              value={draftEmail}
              onChangeText={setDraftEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
              placeholder="ad@example.com"
              placeholderTextColor={t.faint}
              style={{ backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 }}
            />
            <Pressable onPress={saveEmail} style={{ marginTop: 14, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: "center" }}>
              <AppText weight="bold" color="#ffffff">{tr("pf.save")}</AppText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
