import React, { useEffect, useState } from "react";
import { View, Pressable, StyleSheet, Image, TextInput } from "react-native";
import { doctorImages } from "../../src/demo/images";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { WizardHeader, BottomButton } from "../../src/appointment/parts";
import { useWizard, canContinue } from "../../src/appointment/useWizard";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Branch, Doctor } from "../../src/demo/types";
import { layout } from "../../src/theme/tokens";

function DoctorCard({ d, selected, onSelect }: { d: Doctor; selected: boolean; onSelect: () => void }) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"cv" | "pubs">("cv");
  const initials = d.name.replace(/^Dr\.\s*/, "").slice(0, 1);
  return (
    <Pressable
      onPress={onSelect}
      style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: selected ? 2 : StyleSheet.hairlineWidth, borderColor: selected ? t.brand : t.border, padding: 14, marginBottom: 10 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {doctorImages[d.id] ? (
          <Image source={doctorImages[d.id]} style={{ width: 46, height: 46, borderRadius: 99 }} resizeMode="cover" />
        ) : (
          <View style={{ width: 46, height: 46, borderRadius: 99, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <AppText weight="bold" color={t.brand} style={{ fontSize: 18 }}>{initials}</AppText>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText weight="semibold" numberOfLines={1}>{d.name}</AppText>
          <AppText style={{ fontSize: 12, color: t.muted }}>{d.specialty}</AppText>
          <AppText style={{ fontSize: 12, color: t.brand, marginTop: 2 }}>⌚ {d.nextSlot}</AppText>
        </View>
        {d.favorite ? <Ionicons name="heart" size={18} color={t.brand} /> : <Ionicons name={selected ? "checkmark-circle" : "chevron-forward"} size={20} color={selected ? t.brand : t.faint} />}
      </View>
      <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Pressable onPress={() => setOpen((v) => !v)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <AppText weight="semibold" color={t.brand} style={{ fontSize: 12 }}>{tr("wiz.cv")}</AppText>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={t.brand} />
        </Pressable>
        <Pressable onPress={() => router.push(`/doktor/${d.id}`)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="person-circle-outline" size={15} color={t.brand} />
          <AppText weight="semibold" color={t.brand} style={{ fontSize: 12 }}>{tr("doc.viewProfile")}</AppText>
        </Pressable>
      </View>
      {open ? (
        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", gap: 16, marginBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }}>
            {(["cv", "pubs"] as const).map((k) => (
              <Pressable key={k} onPress={() => setTab(k)} style={{ paddingBottom: 6, borderBottomWidth: tab === k ? 2 : 0, borderBottomColor: t.brand }}>
                <AppText weight={tab === k ? "bold" : "regular"} color={tab === k ? t.brand : t.muted} style={{ fontSize: 12 }}>
                  {tr(k === "cv" ? "wiz.cv" : "wiz.pubs")}
                </AppText>
              </Pressable>
            ))}
          </View>
          <View style={{ gap: 4 }}>
            {(tab === "cv" ? [...d.education, ...d.experience, ...d.memberships] : d.publications ?? []).map((line, i) => (
              <AppText key={i} style={{ fontSize: 12, color: t.muted }}>• {line}</AppText>
            ))}
            {tab === "pubs" && (!d.publications || d.publications.length === 0) ? (
              <Muted style={{ fontSize: 12 }}>{tr("wiz.noPubs")}</Muted>
            ) : null}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function StepDoctor() {
  const { state, set } = useWizard();
  const { t } = useI18n();
  const { t: th } = useTheme();
  const [all, setAll] = useState<Doctor[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    transport.getDoctors().then(setAll);
    transport.getBranches().then(setBranches);
  }, []);

  // Only doctors of the chosen branch's specialty.
  const branch = branches.find((b) => b.id === state.departmentId);
  const inDept = all.filter((d) => !branch || d.specialty === branch.specialty);
  const list = q ? inDept.filter((d) => d.name.toLowerCase().includes(q.toLowerCase())) : inDept;

  return (
    <Screen scroll>
      <WizardHeader title={t("wiz.doctor.title")} step={4} total={6} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: th.surface, borderWidth: 1, borderColor: th.border, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12 }}>
        <Ionicons name="search" size={16} color={th.faint} />
        <TextInput value={q} onChangeText={setQ} placeholder={t("wiz.doctor.search")} placeholderTextColor={th.faint} style={{ flex: 1, paddingVertical: 11, color: th.fg, fontFamily: layout.fontMedium, fontSize: 14 }} />
      </View>
      {list.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
          <Ionicons name="person-outline" size={38} color={th.faint} />
          <Muted>{t("wiz.noDoctors")}</Muted>
        </View>
      ) : (
        list.map((d) => <DoctorCard key={d.id} d={d} selected={state.doctorId === d.id} onSelect={() => set({ doctorId: d.id })} />)
      )}
      <BottomButton label={t("wiz.continue")} disabled={!canContinue("doktor", state)} onPress={() => router.push("/randevu-al/tarix")} />
    </Screen>
  );
}
