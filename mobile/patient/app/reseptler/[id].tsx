import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { addReminder } from "../../src/reminder/reminders";
import { Prescription } from "../../src/demo/types";

function Field({ label, value }: { label: string; value: string }) {
  const { t } = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Muted style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Muted>
      <AppText weight="semibold" style={{ marginTop: 2 }}>
        {value}
      </AppText>
    </View>
  );
}

export default function DrugDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [p, setP] = useState<Prescription | null>(null);
  const [reminded, setReminded] = useState(false);

  useEffect(() => {
    transport.getPrescriptions().then((rows) => setP(rows.find((x) => x.id === id) ?? null));
  }, [id]);

  if (!p) return <Screen />;

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 14 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={t.fg} />
        </Pressable>
        <AppText weight="bold" style={{ fontSize: 17, flex: 1, minWidth: 0 }} numberOfLines={2}>
          {p.name}
        </AppText>
      </View>

      <Card>
        <Field label={tr("rx.barcode")} value={p.drug.barcode} />
        <Field label={tr("rx.usage")} value={p.drug.usage} />
        <Field label={tr("rx.withFood")} value={p.drug.withFood} />
        <Muted style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{tr("rx.warnings")}</Muted>
        {p.drug.warnings.map((w, i) => (
          <AppText key={i} style={{ fontSize: 13, marginBottom: 4 }}>
            • {w}
          </AppText>
        ))}
      </Card>

      <Pressable onPress={() => { addReminder(p.id, "20:00"); setReminded(true); }} style={{ marginTop: 14, backgroundColor: reminded ? t.ok : t.brand, borderRadius: 13, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Ionicons name={reminded ? "checkmark" : "alarm-outline"} size={18} color="#ffffff" />
        <AppText weight="bold" color="#ffffff">
          {reminded ? tr("rx.reminded") : tr("rx.remind")}
        </AppText>
      </Pressable>

      <Pressable style={{ marginTop: 10, borderWidth: 1, borderColor: t.border, borderRadius: 13, paddingVertical: 14, alignItems: "center" }}>
        <AppText weight="semibold">{tr("rx.prospectus")}</AppText>
      </Pressable>
      <View style={{ height: 16 }} />
    </Screen>
  );
}
