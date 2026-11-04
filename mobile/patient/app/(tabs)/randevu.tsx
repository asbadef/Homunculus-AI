import React, { useCallback, useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card, EmptyState, GradientHeader } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Appointment } from "../../src/demo/types";

function StatusChip({ status }: { status: Appointment["status"] }) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const map = {
    confirmed: { c: t.ok, k: "status.confirmed" },
    pending: { c: t.wait, k: "status.pending" },
    completed: { c: t.ok, k: "status.completed" },
    cancelled: { c: t.danger, k: "status.cancelled" },
  }[status];
  return (
    <View style={{ backgroundColor: map.c + "26", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99 }}>
      <AppText weight="bold" color={map.c} style={{ fontSize: 11 }}>
        {tr(map.k)}
      </AppText>
    </View>
  );
}

function ApptCard({ a, past }: { a: Appointment; past?: boolean }) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Card style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText weight="semibold" numberOfLines={1}>
            {a.doctor}
          </AppText>
          <Muted style={{ marginTop: 2 }}>
            {a.specialty} · {a.date}, {a.time}
          </Muted>
        </View>
        <StatusChip status={a.status} />
      </View>
      {past ? (
        <Pressable onPress={() => router.push("/randevu-al/tip")} style={{ marginTop: 12, borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingVertical: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }}>
          <Ionicons name="refresh" size={16} color={t.brand} />
          <AppText weight="semibold" color={t.brand} style={{ fontSize: 13 }}>
            {tr("appt.rebook")}
          </AppText>
        </Pressable>
      ) : null}
    </Card>
  );
}

export default function AppointmentsTab() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Appointment[] | null>(null);
  useFocusEffect(useCallback(() => {
    transport.getAppointments().then(setList);
  }, []));

  const upcoming = (list ?? []).filter((a) => a.status === "confirmed" || a.status === "pending");
  const past = (list ?? []).filter((a) => a.status === "completed" || a.status === "cancelled");

  return (
    <Screen scroll>
      <GradientHeader title={tr("appointments.title")} />

      {list && upcoming.length === 0 && past.length === 0 ? (
        <EmptyState icon="calendar-outline" title={tr("appointments.empty")} note={tr("empty.apptNote")} />
      ) : null}

      {upcoming.map((a) => (
        <ApptCard key={a.id} a={a} />
      ))}

      {past.length > 0 ? (
        <>
          <AppText weight="bold" style={{ fontSize: 13, color: t.muted, marginTop: 8, marginBottom: 10, marginLeft: 2 }}>
            {tr("appt.past")}
          </AppText>
          {past.map((a) => (
            <ApptCard key={a.id} a={a} past />
          ))}
        </>
      ) : null}
    </Screen>
  );
}
