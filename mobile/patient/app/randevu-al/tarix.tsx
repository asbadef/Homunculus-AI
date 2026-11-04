import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText } from "../../src/ui/base";
import { WizardHeader, Chip, BottomButton } from "../../src/appointment/parts";
import { Dropdown } from "../../src/ui/form";
import { CalendarModal } from "../../src/appointment/CalendarModal";
import { useWizard, canContinue } from "../../src/appointment/useWizard";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";

const DATES = ["4 Noyabr", "5 Noyabr", "6 Noyabr", "7 Noyabr", "8 Noyabr", "9 Noyabr", "10 Noyabr"];
const DEFAULT_TIMES = ["09:00", "09:30", "10:00", "10:30", "11:00", "13:10", "13:30", "14:00"];

export default function StepDate() {
  const { state, set } = useWizard();
  const { t } = useI18n();
  const { t: th } = useTheme();
  const [times, setTimes] = useState<string[]>(DEFAULT_TIMES);
  const [calOpen, setCalOpen] = useState(false);

  useEffect(() => {
    transport.getDoctors().then((ds) => {
      const d = ds.find((x) => x.id === state.doctorId);
      if (d && d.times.length) setTimes(d.times);
    });
  }, [state.doctorId]);

  return (
    <Screen scroll>
      <WizardHeader title={t("wiz.date.title")} step={5} total={6} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginBottom: 6 }}>
        <Pressable onPress={() => setCalOpen(true)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Ionicons name="calendar-outline" size={16} color={th.brand} />
          <AppText weight="semibold" color={th.brand} style={{ fontSize: 13 }}>{t("wiz.seeCalendar")}</AppText>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4, marginBottom: 6 }}>
        {DATES.map((d) => (
          <Chip key={d} label={d} selected={state.date === d} onPress={() => set({ date: d })} />
        ))}
      </ScrollView>
      {state.date && !DATES.includes(state.date) ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <Ionicons name="checkmark-circle" size={15} color={th.brand} />
          <AppText weight="semibold" color={th.brand} style={{ fontSize: 13 }}>{state.date}</AppText>
        </View>
      ) : <View style={{ height: 8 }} />}
      <CalendarModal visible={calOpen} onClose={() => setCalOpen(false)} onPick={(d) => set({ date: d })} />
      <AppText weight="semibold" color={th.fg} style={{ marginBottom: 10 }}>
        {t("wiz.time")}
      </AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {times.map((tm) => (
          <Chip key={tm} label={tm} selected={state.time === tm} onPress={() => set({ time: tm })} />
        ))}
      </View>

      <View style={{ marginTop: 20 }}>
        <Dropdown
          label={t("ins.title")}
          value={state.insurance}
          onChange={(v) => set({ insurance: v })}
          options={[
            { key: "cari", label: t("ins.cari") },
            { key: "samhi", label: t("ins.samhi") },
            { key: "private", label: t("ins.private") },
            { key: "voluntary", label: t("ins.voluntary") },
          ]}
        />
      </View>
      <BottomButton label={t("wiz.continue")} disabled={!canContinue("tarix", state)} onPress={() => router.push("/randevu-al/ozet")} />
    </Screen>
  );
}
