import React, { useCallback, useMemo, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card, EmptyState, GradientHeader } from "../../src/ui/widgets";
import { Dropdown } from "../../src/ui/form";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Appointment } from "../../src/demo/types";

function ApptCard({ a }: { a: Appointment }) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const past = a.status === "completed" || a.status === "cancelled";
  const banner = {
    confirmed: { c: t.ok, k: "status.confirmed" },
    pending: { c: t.wait, k: "status.pending" },
    completed: { c: t.ok, k: "appt.doneBanner" },
    cancelled: { c: t.danger, k: "appt.cancelBanner" },
  }[a.status];
  const initials = a.doctor.replace(/^(Dr|Dyt|Uzm\.Dr)\.\s*/, "").slice(0, 1);

  return (
    <Card style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
      <View style={{ backgroundColor: banner.c + "1a", paddingVertical: 8, alignItems: "center" }}>
        <AppText weight="bold" color={banner.c} style={{ fontSize: 12.5 }}>{tr(banner.k)}</AppText>
      </View>
      <View style={{ padding: 13, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <LinearGradient colors={[t.brand, t.brandGrad2]} style={{ width: 44, height: 44, borderRadius: 99, alignItems: "center", justifyContent: "center" }}>
            <AppText weight="bold" color="#ffffff" style={{ fontSize: 17 }}>{initials}</AppText>
          </LinearGradient>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold" numberOfLines={1}>{a.doctor}</AppText>
            <Muted style={{ fontSize: 12 }} numberOfLines={1}>{a.specialty}</Muted>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Ionicons name="calendar-outline" size={15} color={t.muted} />
          <Muted style={{ fontSize: 13 }}>{a.date} · {a.time}</Muted>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Ionicons name="location-outline" size={15} color={t.muted} />
          <Muted style={{ fontSize: 13, flex: 1, minWidth: 0 }} numberOfLines={1}>{a.hospital}</Muted>
        </View>
        {past ? (
          <Pressable onPress={() => router.push("/randevu-al/tip")} style={{ marginTop: 4, borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingVertical: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <Ionicons name="refresh" size={16} color={t.brand} />
            <AppText weight="semibold" color={t.brand} style={{ fontSize: 13 }}>{tr("appt.rebook")}</AppText>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

export default function AppointmentsTab() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Appointment[] | null>(null);
  const [year, setYear] = useState("all");
  const [showCancelled, setShowCancelled] = useState(true);

  useFocusEffect(useCallback(() => {
    transport.getAppointments().then(setList);
  }, []));

  const years = useMemo(() => {
    const ys = Array.from(new Set((list ?? []).map((a) => a.date.trim().split(/\s+/).pop() || ""))).filter(Boolean).sort().reverse();
    return ys;
  }, [list]);

  const filtered = (list ?? [])
    .filter((a) => year === "all" || (a.date.trim().split(/\s+/).pop() === year))
    .filter((a) => showCancelled || a.status !== "cancelled");
  const upcoming = filtered.filter((a) => a.status === "confirmed" || a.status === "pending");
  const past = filtered.filter((a) => a.status === "completed" || a.status === "cancelled");
  const hasCancelled = (list ?? []).some((a) => a.status === "cancelled");

  return (
    <Screen scroll>
      <GradientHeader title={tr("appointments.title")} />

      <Dropdown
        label={tr("appt.year")}
        value={year}
        onChange={setYear}
        options={[{ key: "all", label: tr("appt.yearAll") }, ...years.map((y) => ({ key: y, label: y }))]}
      />
      {hasCancelled ? (
        <Pressable onPress={() => setShowCancelled((v) => !v)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, marginBottom: 12, marginTop: -4 }}>
          <Ionicons name={showCancelled ? "eye-off-outline" : "eye-outline"} size={16} color={t.brand} />
          <AppText weight="semibold" color={t.brand} style={{ fontSize: 12.5 }}>
            {tr("appt.cancelledLabel")}: {showCancelled ? tr("appt.hide") : tr("appt.show")}
          </AppText>
        </Pressable>
      ) : null}

      {list && filtered.length === 0 ? (
        <EmptyState icon="calendar-outline" title={tr("appointments.empty")} note={tr("empty.apptNote")} />
      ) : null}

      {upcoming.map((a) => <ApptCard key={a.id} a={a} />)}

      {past.length > 0 ? (
        <>
          <AppText weight="bold" style={{ fontSize: 13, color: t.muted, marginTop: 6, marginBottom: 10, marginLeft: 2 }}>{tr("appt.past")}</AppText>
          {past.map((a) => <ApptCard key={a.id} a={a} />)}
        </>
      ) : null}
    </Screen>
  );
}
