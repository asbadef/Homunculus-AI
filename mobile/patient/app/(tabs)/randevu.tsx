import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted, Title } from "../../src/ui/base";
import { Card, StatusPill } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Appointment } from "../../src/demo/types";

export default function AppointmentsTab() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Appointment[] | null>(null);
  useEffect(() => {
    transport.getAppointments().then(setList);
  }, []);

  return (
    <Screen scroll>
      <View style={{ paddingTop: 6, paddingBottom: 12 }}>
        <Title>{tr("appointments.title")}</Title>
      </View>

      <Pressable onPress={() => router.push("/randevu-al/tip")} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 16 }}>
        <Ionicons name="add" size={20} color="#ffffff" />
        <AppText weight="bold" color="#ffffff" style={{ fontSize: 15 }}>
          {tr("appointments.new")}
        </AppText>
      </Pressable>

      {list && list.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 50, gap: 8 }}>
          <Ionicons name="calendar-outline" size={40} color={t.faint} />
          <Muted>{tr("appointments.empty")}</Muted>
        </View>
      ) : (
        (list ?? []).map((a) => (
          <Card key={a.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText weight="semibold" numberOfLines={1}>
                {a.doctor}
              </AppText>
              <Muted style={{ marginTop: 2 }}>
                {a.specialty} · {a.date}, {a.time}
              </Muted>
            </View>
            <StatusPill kind={a.status === "confirmed" ? "ok" : "wait"} label={a.status === "confirmed" ? tr("status.confirmed") : tr("status.pending")} />
          </Card>
        ))
      )}
    </Screen>
  );
}
