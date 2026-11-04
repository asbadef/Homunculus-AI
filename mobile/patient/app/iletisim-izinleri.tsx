import React, { useEffect, useState } from "react";
import { View, Switch, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { demoAlert } from "../src/ui/demo";

const STORAGE = "hm-comm-perms";
type Perms = { sms: boolean; call: boolean; email: boolean; health: boolean };
const DEFAULTS: Perms = { sms: true, call: false, email: true, health: true };

const ROWS: { key: keyof Perms; icon: string; labelKey: string }[] = [
  { key: "sms", icon: "chatbubble-outline", labelKey: "perm.sms" },
  { key: "call", icon: "call-outline", labelKey: "perm.call" },
  { key: "email", icon: "mail-outline", labelKey: "perm.email" },
  { key: "health", icon: "document-text-outline", labelKey: "perm.health" },
];

export default function CommPermissions() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [perms, setPerms] = useState<Perms>(DEFAULTS);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE)
      .then((raw) => { if (raw) setPerms({ ...DEFAULTS, ...JSON.parse(raw) }); })
      .catch(() => {});
  }, []);

  function toggle(k: keyof Perms, v: boolean) {
    const nv = { ...perms, [k]: v };
    setPerms(nv);
    AsyncStorage.setItem(STORAGE, JSON.stringify(nv)).catch(() => {});
  }

  return (
    <Screen scroll>
      <StackHeader title={tr("perm.title")} />
      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
        {ROWS.map((r, i) => (
          <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: t.border }}>
            <Ionicons name={r.icon as any} size={20} color={t.brand} />
            <AppText weight="semibold" style={{ flex: 1, minWidth: 0 }}>
              {tr(r.labelKey)}
            </AppText>
            <Switch value={perms[r.key]} onValueChange={(v) => toggle(r.key, v)} trackColor={{ true: t.brand, false: t.border }} thumbColor="#ffffff" />
          </View>
        ))}
      </Card>
      <Pressable onPress={() => demoAlert(tr)}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Ionicons name="lock-closed-outline" size={18} color={t.brand} />
          <AppText weight="semibold" color={t.brand} style={{ flex: 1, minWidth: 0 }}>
            {tr("perm.kvkk")}
          </AppText>
          <Ionicons name="open-outline" size={16} color={t.faint} />
        </Card>
      </Pressable>
    </Screen>
  );
}
