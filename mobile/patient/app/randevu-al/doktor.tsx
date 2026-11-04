import React, { useEffect, useState } from "react";
import { View, Pressable, StyleSheet, Image } from "react-native";
import { doctorImages } from "../../src/demo/images";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText } from "../../src/ui/base";
import { WizardHeader, BottomButton } from "../../src/appointment/parts";
import { useWizard, canContinue } from "../../src/appointment/useWizard";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Doctor } from "../../src/demo/types";

function DoctorCard({ d, selected, onSelect }: { d: Doctor; selected: boolean; onSelect: () => void }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
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
            <AppText weight="bold" color={t.brand} style={{ fontSize: 18 }}>
              {initials}
            </AppText>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText weight="semibold" numberOfLines={1}>
            {d.name}
          </AppText>
          <AppText style={{ fontSize: 12, color: t.muted }}>{d.specialty}</AppText>
          <AppText style={{ fontSize: 12, color: t.brand, marginTop: 2 }}>⌚ {d.nextSlot}</AppText>
        </View>
        {d.favorite ? <Ionicons name="heart" size={18} color={t.brand} /> : <Ionicons name={selected ? "checkmark-circle" : "chevron-forward"} size={20} color={selected ? t.brand : t.faint} />}
      </View>
      <Pressable onPress={() => setOpen((v) => !v)} hitSlop={8} style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <AppText weight="semibold" color={t.brand} style={{ fontSize: 12 }}>
          Özgeçmiş
        </AppText>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={t.brand} />
      </Pressable>
      {open ? (
        <View style={{ marginTop: 8, gap: 4 }}>
          {[...d.education, ...d.experience, ...d.memberships].map((line, i) => (
            <AppText key={i} style={{ fontSize: 12, color: t.muted }}>
              • {line}
            </AppText>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

export default function StepDoctor() {
  const { state, set } = useWizard();
  const { t } = useI18n();
  const [list, setList] = useState<Doctor[]>([]);
  useEffect(() => {
    transport.getDoctors().then(setList);
  }, []);
  return (
    <Screen scroll>
      <WizardHeader title={t("wiz.doctor.title")} step={4} total={6} />
      {list.map((d) => (
        <DoctorCard key={d.id} d={d} selected={state.doctorId === d.id} onSelect={() => set({ doctorId: d.id })} />
      ))}
      <BottomButton label={t("wiz.continue")} disabled={!canContinue("doktor", state)} onPress={() => router.push("/randevu-al/tarix")} />
    </Screen>
  );
}
