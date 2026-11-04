import React, { useEffect, useState } from "react";
import { router } from "expo-router";
import { Screen } from "../../src/ui/base";
import { WizardHeader, Row, BottomButton } from "../../src/appointment/parts";
import { useWizard, canContinue } from "../../src/appointment/useWizard";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Branch } from "../../src/demo/types";

export default function StepDepartment() {
  const { state, set } = useWizard();
  const { t } = useI18n();
  const [list, setList] = useState<Branch[]>([]);
  useEffect(() => {
    transport.getBranches().then(setList);
  }, []);
  return (
    <Screen scroll>
      <WizardHeader title={t("wiz.dept.title")} step={3} total={6} />
      {list.map((b) => (
        <Row key={b.id} icon={b.icon as any} label={b.name} selected={state.departmentId === b.id} onPress={() => set({ departmentId: b.id })} />
      ))}
      <BottomButton label={t("wiz.continue")} disabled={!canContinue("bolum", state)} onPress={() => router.push("/randevu-al/doktor")} />
    </Screen>
  );
}
