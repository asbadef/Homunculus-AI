import React, { useEffect, useMemo, useState } from "react";
import { View, Pressable, TextInput, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../src/ui/base";
import { StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { layout } from "../src/theme/tokens";
import { transport } from "../src/demo/transport";
import { FEATURES } from "../src/config/features";
import { searchItems, SearchItem } from "../src/search/search";
import { Branch, Doctor } from "../src/demo/types";

export default function Search() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [q, setQ] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);

  useEffect(() => {
    transport.getBranches().then(setBranches);
    transport.getDoctors().then(setDoctors);
  }, []);

  const items: SearchItem[] = useMemo(() => [
    ...FEATURES.map((f) => ({ id: "f-" + f.key, label: tr(f.titleKey), icon: f.icon, route: f.route, kind: "feature" as const })),
    ...branches.map((b) => ({ id: "b-" + b.id, label: b.name, sub: tr("wiz.dept.title"), icon: b.icon, route: "/randevu-al/tip", kind: "branch" as const })),
    ...doctors.map((d) => ({ id: "d-" + d.id, label: d.name, sub: d.specialty, icon: "person-outline", route: `/doktor/${d.id}`, kind: "doctor" as const })),
  ], [branches, doctors, tr]);

  const results = searchItems(q, items);

  return (
    <Screen scroll>
      <StackHeader title={tr("search.title")} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 13, paddingHorizontal: 13, marginBottom: 14 }}>
        <Ionicons name="search" size={17} color={t.brand} />
        <TextInput
          value={q}
          onChangeText={setQ}
          autoFocus
          placeholder={tr("home.search")}
          placeholderTextColor={t.faint}
          style={{ flex: 1, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 }}
        />
        {q ? (
          <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={t.faint} /></Pressable>
        ) : null}
      </View>

      {!q ? (
        <View style={{ alignItems: "center", paddingVertical: 50, gap: 8 }}>
          <Ionicons name="search-outline" size={38} color={t.faint} />
          <Muted style={{ textAlign: "center" }}>{tr("search.hint")}</Muted>
        </View>
      ) : results.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 50, gap: 8 }}>
          <Ionicons name="sad-outline" size={38} color={t.faint} />
          <Muted>{tr("search.empty")}</Muted>
        </View>
      ) : (
        results.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(r.route as any)} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: 13, padding: 13, marginBottom: 9 }}>
            <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={(r.icon + (r.icon.includes("-") ? "" : "-outline")) as any} size={20} color={t.brand} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText weight="semibold" numberOfLines={1}>{r.label}</AppText>
              {r.sub ? <Muted style={{ fontSize: 12 }} numberOfLines={1}>{r.sub}</Muted> : null}
            </View>
            <Ionicons name="chevron-forward" size={17} color={t.faint} />
          </Pressable>
        ))
      )}
    </Screen>
  );
}
