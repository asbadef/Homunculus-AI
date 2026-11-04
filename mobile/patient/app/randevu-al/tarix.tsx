import React, { useEffect, useState } from "react";
import { View, ScrollView } from "react-native";
import { router } from "expo-router";
import { Screen, AppText } from "../../src/ui/base";
import { WizardHeader, Chip, BottomButton } from "../../src/appointment/parts";
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

  useEffect(() => {
    transport.getDoctors().then((ds) => {
      const d = ds.find((x) => x.id === state.doctorId);
      if (d && d.times.length) setTimes(d.times);
    });
  }, [state.doctorId]);

  return (
    <Screen scroll>
      <WizardHeader title={t("wiz.date.title")} step={5} total={6} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4, marginBottom: 14 }}>
        {DATES.map((d) => (
          <Chip key={d} label={d} selected={state.date === d} onPress={() => set({ date: d })} />
        ))}
      </ScrollView>
      <AppText weight="semibold" color={th.fg} style={{ marginBottom: 10 }}>
        {t("wiz.time")}
      </AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {times.map((tm) => (
          <Chip key={tm} label={tm} selected={state.time === tm} onPress={() => set({ time: tm })} />
        ))}
      </View>
      <BottomButton label={t("wiz.continue")} disabled={!canContinue("tarix", state)} onPress={() => router.push("/randevu-al/ozet")} />
    </Screen>
  );
}
