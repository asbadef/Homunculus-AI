import React, { useEffect, useState } from "react";
import { View, Pressable, Modal, StyleSheet, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { AppText, Muted } from "../ui/base";
import { useTheme } from "../theme/ThemeProvider";
import { useI18n } from "../i18n";
import { LANGS } from "../i18n/core";
import { useSession } from "../session/SessionProvider";
import { getAvatar } from "../profile/avatar";
import { FEATURES } from "../config/features";
import { getShortcutKeys } from "../demo/shortcuts";

type Item = { icon: any; label: string; route?: string; action?: () => void };

export function MenuDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, mode, toggle } = useTheme();
  const { t: tr, lang, setLang } = useI18n();
  const { user, signOut } = useSession();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [scKeys, setScKeys] = useState<string[]>([]);

  useEffect(() => { if (visible) { getAvatar().then(setAvatar); getShortcutKeys().then(setScKeys); } }, [visible]);
  const shortcuts = FEATURES.filter((f) => scKeys.includes(f.key));

  function cycleLang() {
    const i = LANGS.indexOf(lang);
    setLang(LANGS[(i + 1) % LANGS.length]);
  }

  function go(route: string) {
    onClose();
    router.push(route as any);
  }

  const items: Item[] = [
    { icon: "megaphone-outline", label: tr("menu.campaigns"), route: "/kampanyalar" },
    { icon: "call-outline", label: tr("menu.contact"), route: "/bize-ulasin" },
    { icon: "chatbox-ellipses-outline", label: tr("menu.feedback"), route: "/oneri-sikayet" },
    { icon: "apps-outline", label: tr("menu.shortcuts"), route: "/kisa-yollar" },
    { icon: "notifications-outline", label: tr("pf.notif"), route: "/bildirisler" },
    { icon: "options-outline", label: tr("pf.perms"), route: "/iletisim-izinleri" },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "#0006", flexDirection: "row" }}>
        <Pressable onPress={() => {}} style={{ width: "82%", maxWidth: 340, backgroundColor: t.bg, paddingTop: 54, paddingHorizontal: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, marginBottom: 14 }}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={{ width: 48, height: 48, borderRadius: 99 }} />
            ) : (
              <View style={{ width: 48, height: 48, borderRadius: 99, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <AppText weight="bold" color={t.brand} style={{ fontSize: 20 }}>{(user?.name ?? "A").slice(0, 1)}</AppText>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText weight="bold" numberOfLines={1}>{user?.name ?? "—"}</AppText>
              <Muted style={{ fontSize: 12 }}>FİN: {user?.fin || user?.finMasked || "—"}</Muted>
            </View>
          </View>

          {items.map((it) => (
            <Pressable key={it.label} onPress={() => (it.route ? go(it.route) : it.action?.())} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 }}>
              <Ionicons name={it.icon} size={21} color={t.brand} />
              <AppText weight="semibold" style={{ flex: 1, minWidth: 0 }}>{it.label}</AppText>
              <Ionicons name="chevron-forward" size={17} color={t.faint} />
            </Pressable>
          ))}

          {shortcuts.length > 0 ? (
            <View style={{ paddingTop: 12, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Muted style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{tr("menu.shortcuts")}</Muted>
                <Pressable onPress={() => go("/kisa-yollar")} hitSlop={8}><Ionicons name="create-outline" size={17} color={t.brand} /></Pressable>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {shortcuts.map((f) => (
                  <Pressable key={f.key} onPress={() => go(f.route)} style={{ backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9 }}>
                    <AppText weight="semibold" style={{ fontSize: 12.5 }}>{tr(f.titleKey)}</AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 10, paddingVertical: 10, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
            <Pressable onPress={cycleLang} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: 11, paddingVertical: 11 }}>
              <Ionicons name="globe-outline" size={17} color={t.brand} />
              <AppText weight="semibold" style={{ fontSize: 13 }}>{tr("lang.code")}</AppText>
            </Pressable>
            <Pressable onPress={toggle} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: 11, paddingVertical: 11 }}>
              <Ionicons name={mode === "dark" ? "moon" : "sunny"} size={17} color={t.brand} />
              <AppText weight="semibold" style={{ fontSize: 13 }}>{mode === "dark" ? tr("pf.on") : tr("pf.off")}</AppText>
            </Pressable>
          </View>

          <Pressable onPress={() => { onClose(); signOut(); }} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
            <Ionicons name="log-out-outline" size={21} color={t.danger} />
            <AppText weight="semibold" color={t.danger}>{tr("pf.logout")}</AppText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
