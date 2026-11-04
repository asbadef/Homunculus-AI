import React, { useEffect, useState } from "react";
import { router } from "expo-router";
import { Screen } from "../../src/ui/base";
import { WizardHeader, Row, BottomButton } from "../../src/appointment/parts";
import { useWizard, canContinue } from "../../src/appointment/useWizard";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Hospital } from "../../src/demo/types";

export default function StepHospital() {
  const { state, set } = useWizard();
  const { t } = useI18n();
  const [list, setList] = useState<Hospital[]>([]);
  useEffect(() => {
    transport.getHospitals().then(setList);
  }, []);
  return (
    <Screen scroll>
      <WizardHeader title={t("wiz.hospital.title")} step={2} total={6} />
      <Row icon="arrow-forward-circle-outline" label={t("wiz.hospital.skip")} selected={state.hospitalId === "skip"} onPress={() => set({ hospitalId: "skip" })} />
      {list.map((h) => (
        <Row
          key={h.id}
          icon="business-outline"
          label={h.name}
          meta={`${h.distanceKm} ${t("wiz.km")}`}
          selected={state.hospitalId === h.id}
          onPress={() => set({ hospitalId: h.id })}
        />
      ))}
      <BottomButton label={t("wiz.continue")} disabled={!canContinue("hastane", state)} onPress={() => router.push("/randevu-al/bolum")} />
    </Screen>
  );
}
