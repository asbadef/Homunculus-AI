import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card } from "../../src/ui/widgets";
import { WizardHeader, BottomButton } from "../../src/appointment/parts";
import { Dropdown } from "../../src/ui/form";
import { useWizard } from "../../src/appointment/useWizard";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { api } from "../../src/api/client";
import { useSession } from "../../src/session/SessionProvider";

export default function StepSummary() {
  const { state, reset } = useWizard();
  const { t } = useI18n();
  const { t: th } = useTheme();
  const { user } = useSession();
  const [insurance, setInsurance] = useState("cari");
  const [done, setDone] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [names, setNames] = useState({ doctor: "", dept: "", hospital: "" });
  const unitId = React.useRef("");

  useEffect(() => {
    Promise.all([transport.getDoctors(), transport.getBranches(), transport.getHospitals()]).then(([ds, brs, hs]) => {
      const br = brs.find((x) => x.id === state.departmentId);
      unitId.current = br?.unitId ?? "";
      setNames({
        doctor: ds.find((x) => x.id === state.doctorId)?.name ?? "",
        dept: br?.name ?? "",
        hospital: state.hospitalId === "skip" ? "—" : hs.find((x) => x.id === state.hospitalId)?.name ?? "",
      });
    });
  }, []);

  // Randevu onayı M1 köprüsünden geçer (demo modda yerelde onaylanır, SMS yok).
  async function confirm() {
    const res = await api.createBooking({
      patientFin: user?.finMasked ?? "",
      branchId: state.departmentId ?? "",
      unitId: unitId.current,
      doctorId: state.doctorId ?? "",
      hospitalId: state.hospitalId === "skip" ? null : state.hospitalId,
      date: state.date ?? "",
      time: state.time ?? "",
      insurance,
    }).catch(() => ({ ok: true, confirmSms: false }));
    setSmsSent(!!res.confirmSms);
    setDone(true);
  }
  function finish() {
    reset();
    router.dismissAll();
    router.replace("/randevu");
  }

  if (done) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 }}>
          <Ionicons name="checkmark-circle" size={64} color={th.ok} />
          <AppText weight="bold" style={{ fontSize: 18, textAlign: "center" }}>
            {t("wiz.booked")}
          </AppText>
          <Muted style={{ textAlign: "center" }}>
            {names.doctor} · {state.date} · {state.time}
          </Muted>
          <Muted style={{ textAlign: "center", fontSize: 12 }}>
            {smsSent ? t("wiz.smsSent") : t("wiz.demoBooking")}
          </Muted>
          <View style={{ height: 8 }} />
          <BottomButton label="Tamam" onPress={finish} />
        </View>
      </Screen>
    );
  }

  const Line = ({ icon, label, value }: { icon: any; label: string; value: string }) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
      <Ionicons name={icon} size={18} color={th.brand} />
      <Muted style={{ width: 90 }}>{label}</Muted>
      <AppText weight="semibold" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );

  return (
    <Screen scroll>
      <WizardHeader title={t("wiz.summary.title")} step={6} total={6} />
      <Card style={{ padding: 6, paddingHorizontal: 14 }}>
        <Line icon="person-outline" label={t("wiz.doctor.title")} value={names.doctor} />
        <Line icon="medkit-outline" label={t("wiz.dept.title")} value={names.dept} />
        <Line icon="business-outline" label={t("wiz.hospital.title")} value={names.hospital} />
        <Line icon="calendar-outline" label={t("wiz.date.title")} value={`${state.date ?? ""} · ${state.time ?? ""}`} />
      </Card>

      <View style={{ marginTop: 18 }}>
        <Dropdown
          label={t("ins.title")}
          value={insurance}
          onChange={setInsurance}
          options={[
            { key: "cari", label: t("ins.cari") },
            { key: "samhi", label: t("ins.samhi") },
            { key: "private", label: t("ins.private") },
            { key: "voluntary", label: t("ins.voluntary") },
          ]}
        />
      </View>

      <BottomButton label={t("wiz.confirm")} onPress={confirm} />
    </Screen>
  );
}
