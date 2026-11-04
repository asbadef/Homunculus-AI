import React, { useEffect, useState } from "react";
import { View, Pressable, StyleSheet, Modal, Image } from "react-native";
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
import { openDirections, addToCalendar } from "../../src/appointment/apptActions";
import { useSession } from "../../src/session/SessionProvider";
import { LinearGradient } from "expo-linear-gradient";
import { doctorImages } from "../../src/demo/images";
import { Appointment } from "../../src/demo/types";

export default function StepSummary() {
  const { state, reset } = useWizard();
  const { t } = useI18n();
  const { t: th } = useTheme();
  const { user } = useSession();
  const [insurance, setInsurance] = useState("cari");
  const [confirming, setConfirming] = useState(false);
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
  async function doBook() {
    setConfirming(false);
    const res = await api.createBooking({
      patientFin: user?.fin ?? "",
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
    const appt: Appointment = {
      id: "new", doctor: names.doctor, specialty: names.dept,
      date: state.date ?? "", time: state.time ?? "",
      hospital: names.hospital === "—" ? "Mərkəzi Klinika Bakı" : names.hospital, status: "confirmed",
    };
    const row = { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingVertical: 8 };
    const actionChip = { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: th.border, borderRadius: 12, paddingVertical: 12, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6 };
    return (
      <Screen scroll>
        <LinearGradient colors={[th.brand, th.brandGrad2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, paddingVertical: 30, paddingHorizontal: 20, alignItems: "center", marginTop: 12 }}>
          <View style={{ width: 76, height: 76, borderRadius: 99, backgroundColor: "#ffffff22", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="checkmark-circle" size={56} color="#ffffff" />
          </View>
          <AppText weight="extrabold" color="#ffffff" style={{ fontSize: 20, marginTop: 14, textAlign: "center" }}>{t("wiz.booked")}</AppText>
          <AppText color="#ffffff" style={{ fontSize: 13, opacity: 0.95, marginTop: 6, textAlign: "center" }}>
            {smsSent ? t("wiz.smsSent") : t("wiz.demoBooking")}
          </AppText>
        </LinearGradient>

        <Card style={{ marginTop: 16, paddingHorizontal: 16 }}>
          <View style={row}><Ionicons name="person-outline" size={18} color={th.brand} /><AppText weight="semibold" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>{names.doctor}</AppText></View>
          <View style={row}><Ionicons name="medkit-outline" size={18} color={th.brand} /><Muted style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>{names.dept}</Muted></View>
          <View style={row}><Ionicons name="business-outline" size={18} color={th.brand} /><Muted style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>{names.hospital}</Muted></View>
          <View style={row}><Ionicons name="calendar-outline" size={18} color={th.brand} /><AppText weight="semibold" color={th.brand} style={{ flex: 1, minWidth: 0 }}>{state.date} · {state.time}</AppText></View>
        </Card>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <Pressable onPress={() => addToCalendar(appt)} style={actionChip}><Ionicons name="calendar-outline" size={16} color={th.brand} /><AppText weight="semibold" style={{ fontSize: 12 }}>{t("appt.calendar")}</AppText></Pressable>
          {names.hospital !== "—" ? (
            <Pressable onPress={() => openDirections(names.hospital)} style={actionChip}><Ionicons name="navigate-outline" size={16} color={th.brand} /><AppText weight="semibold" style={{ fontSize: 12 }}>{t("appt.directions")}</AppText></Pressable>
          ) : null}
        </View>

        <BottomButton label={t("wiz.goMyAppointments")} onPress={finish} />
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

      <BottomButton label={t("wiz.confirm")} onPress={() => setConfirming(true)} />

      <Modal visible={confirming} transparent animationType="fade" onRequestClose={() => setConfirming(false)}>
        <Pressable onPress={() => setConfirming(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: th.surface, borderRadius: 22, overflow: "hidden" }}>
            <View style={{ backgroundColor: th.surface2, alignItems: "center", paddingTop: 18, paddingBottom: 16, paddingHorizontal: 20 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", width: "100%" }}>
                <AppText weight="bold" style={{ fontSize: 16 }}>{t("wiz.summary.title")}</AppText>
                <Pressable onPress={() => setConfirming(false)} hitSlop={10} style={{ position: "absolute", right: 0 }}>
                  <Ionicons name="close" size={22} color={th.muted} />
                </Pressable>
              </View>
              {state.doctorId && doctorImages[state.doctorId] ? (
                <Image source={doctorImages[state.doctorId]} style={{ width: 92, height: 92, borderRadius: 18, marginTop: 14 }} />
              ) : (
                <View style={{ width: 92, height: 92, borderRadius: 18, backgroundColor: th.brandSoft, alignItems: "center", justifyContent: "center", marginTop: 14 }}>
                  <AppText weight="bold" color={th.brand} style={{ fontSize: 34 }}>{names.doctor.replace(/^(Dr|Dyt|Uzm\.Dr)\.\s*/, "").slice(0, 1)}</AppText>
                </View>
              )}
              <AppText weight="bold" style={{ fontSize: 17, marginTop: 12, textAlign: "center" }} numberOfLines={2}>{names.doctor}</AppText>
              <Muted style={{ marginTop: 2 }}>{names.dept}</Muted>
              <AppText weight="semibold" style={{ marginTop: 8 }}>{t("ins." + insurance)}</AppText>
            </View>
            <View style={{ alignItems: "center", paddingVertical: 18 }}>
              <AppText weight="extrabold" style={{ fontSize: 26 }}>{state.time}</AppText>
              <View style={{ width: 40, height: 3, borderRadius: 99, backgroundColor: th.brand, marginVertical: 8 }} />
              <AppText weight="semibold">{state.date}</AppText>
              <Muted style={{ marginTop: 2 }}>{names.hospital}</Muted>
            </View>
            <View style={{ paddingHorizontal: 18, paddingBottom: 18 }}>
              <Pressable onPress={doBook} style={{ backgroundColor: th.brand, borderRadius: 14, paddingVertical: 15, alignItems: "center" }}>
                <AppText weight="bold" color="#ffffff" style={{ fontSize: 15 }}>{t("wiz.confirm")}</AppText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
