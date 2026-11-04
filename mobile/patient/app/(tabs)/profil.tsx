import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted, Title } from "../../src/ui/base";
import { Card } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { LANGS } from "../../src/i18n/core";
import { useSession } from "../../src/session/SessionProvider";

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
  const { t, mode, toggle } = useTheme();
  const { t: tr, lang, setLang } = useI18n();
  const { user, signOut } = useSession();

  function cycleLang() {
    const i = LANGS.indexOf(lang);
    setLang(LANGS[(i + 1) % LANGS.length]);
  }

  return (
    <Screen scroll>
      <View style={{ paddingTop: 6, paddingBottom: 14 }}>
        <Title>{tr("profile.title")}</Title>
      </View>

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
      <Row icon="people-outline" label="Nurlan (4 yaş)" value={tr("auth.continue")} />
      <Row icon="person-add-outline" label={tr("pf.addFamily")} />

      <View style={{ height: 10 }} />
      <Row icon="globe-outline" label={tr("pf.lang")} value={tr("lang.code")} onPress={cycleLang} />
      <Row icon="moon-outline" label={tr("pf.theme")} value={mode === "dark" ? tr("pf.on") : tr("pf.off")} onPress={toggle} />
      <Row icon="notifications-outline" label={tr("pf.notif")} value={tr("pf.on")} />

      <View style={{ height: 8 }} />
      <Pressable onPress={signOut} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 13, paddingVertical: 14, alignItems: "center" }}>
        <AppText weight="semibold" color={t.danger}>
          {tr("pf.logout")}
        </AppText>
      </Pressable>
      <View style={{ height: 16 }} />
    </Screen>
  );
}
