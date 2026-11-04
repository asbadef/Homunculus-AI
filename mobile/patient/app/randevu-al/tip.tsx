import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Screen } from "../../src/ui/base";
import { WizardHeader, Row, Chip, BottomButton } from "../../src/appointment/parts";
import { useWizard, canContinue, ApptType } from "../../src/appointment/useWizard";
import { useI18n } from "../../src/i18n";

export default function StepType() {
  const { state, set } = useWizard();
  const { t } = useI18n();
  const types: { key: ApptType; icon: any; label: string; sub: string }[] = [
    { key: "inperson", icon: "person-outline", label: t("wiz.type.inperson"), sub: t("wiz.type.inperson.sub") },
    { key: "online", icon: "videocam-outline", label: t("wiz.type.online"), sub: t("wiz.type.online.sub") },
    { key: "assistant", icon: "sparkles-outline", label: t("wiz.type.assistant"), sub: t("wiz.type.assistant.sub") },
  ];
  return (
    <Screen scroll>
      <WizardHeader title={t("wiz.type.title")} step={1} total={6} />
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
        <Chip label={t("wiz.forWhom.self")} selected={state.forWhom === "self"} onPress={() => set({ forWhom: "self" })} />
        <Chip label={t("wiz.forWhom.other")} selected={state.forWhom === "other"} onPress={() => set({ forWhom: "other" })} />
      </View>
      {types.map((ty) => (
        <Row key={ty.key} icon={ty.icon} label={ty.label} meta={ty.sub} selected={state.type === ty.key} onPress={() => set({ type: ty.key })} />
      ))}
      <BottomButton label={t("wiz.continue")} disabled={!canContinue("tip", state)} onPress={() => router.push("/randevu-al/hastane")} />
    </Screen>
  );
}
