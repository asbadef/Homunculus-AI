import React, { useEffect, useState } from "react";
import { View, Pressable, Modal, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { layout } from "../src/theme/tokens";
import { useScreenGuard } from "../src/security/useScreenGuard";

type Field = { key: string; icon: string; labelKey: string; keyboard?: "default" | "number-pad" };
const FIELDS: Field[] = [
  { key: "blood", icon: "water-outline", labelKey: "hc.blood" },
  { key: "allergies", icon: "alert-circle-outline", labelKey: "hc.allergies" },
  { key: "chronic", icon: "fitness-outline", labelKey: "hc.chronic" },
  { key: "height", icon: "resize-outline", labelKey: "hc.height", keyboard: "number-pad" },
  { key: "weight", icon: "barbell-outline", labelKey: "hc.weight", keyboard: "number-pad" },
];
const STORAGE = "hm-healthcard";
const DEFAULTS: Record<string, string> = { blood: "A Rh+", allergies: "Penisilin", chronic: "—", height: "178", weight: "74" };

export default function HealthCard() {
  useScreenGuard();
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE)
      .then((raw) => { if (raw) setValues({ ...DEFAULTS, ...JSON.parse(raw) }); })
      .catch(() => {});
  }, []);

  function openEdit(f: Field) {
    setDraft(values[f.key] ?? "");
    setEditing(f);
  }
  function save() {
    if (!editing) return;
    const nv = { ...values, [editing.key]: draft.trim() || "—" };
    setValues(nv);
    AsyncStorage.setItem(STORAGE, JSON.stringify(nv)).catch(() => {});
    setEditing(null);
  }

  return (
    <Screen scroll>
      <StackHeader title={tr("feat.healthcard")} />
      {FIELDS.map((f) => (
        <Card key={f.key} style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={f.icon as any} size={20} color={t.brand} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Muted style={{ fontSize: 12 }}>{tr(f.labelKey)}</Muted>
            <AppText weight="semibold" style={{ marginTop: 2 }}>
              {values[f.key] || "—"}
            </AppText>
          </View>
          <Pressable onPress={() => openEdit(f)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="create-outline" size={16} color={t.brand} />
            <AppText weight="semibold" color={t.brand} style={{ fontSize: 12 }}>
              {tr("hc.edit")}
            </AppText>
          </Pressable>
        </Card>
      ))}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable onPress={() => setEditing(null)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderRadius: 18, padding: 18 }}>
            <AppText weight="bold" style={{ fontSize: 16, marginBottom: 12 }}>
              {editing ? tr(editing.labelKey) : ""}
            </AppText>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType={editing?.keyboard ?? "default"}
              autoFocus
              style={{ backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 }}
            />
            <Pressable onPress={save} style={{ marginTop: 14, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: "center" }}>
              <AppText weight="bold" color="#ffffff">{tr("hc.save")}</AppText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
