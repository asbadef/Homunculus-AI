import React, { useEffect, useState } from "react";
import { View, Pressable, Modal, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppText, Muted } from "../ui/base";
import { Card } from "../ui/widgets";
import { useTheme } from "../theme/ThemeProvider";
import { useI18n } from "../i18n";
import { layout } from "../theme/tokens";

const STORAGE = "hm-health";
type Metrics = { height: string; weight: string; bp: string; pulse: string; glucose: string; steps: string; sleep: string; water: string };
const EMPTY: Metrics = { height: "", weight: "", bp: "", pulse: "", glucose: "", steps: "", sleep: "", water: "" };

type Item = { key: keyof Metrics; labelKey: string; unit: string; icon: string; keyboard?: "default" | "number-pad" };
const ITEMS: Item[] = [
  { key: "height", labelKey: "m.height", unit: "cm", icon: "resize-outline", keyboard: "number-pad" },
  { key: "weight", labelKey: "m.weight", unit: "kg", icon: "barbell-outline", keyboard: "number-pad" },
  { key: "bp", labelKey: "m.bp", unit: "mmHg", icon: "pulse-outline" },
  { key: "pulse", labelKey: "m.pulse", unit: "bpm", icon: "heart-outline", keyboard: "number-pad" },
  { key: "glucose", labelKey: "m.glucose", unit: "mg/dL", icon: "water-outline", keyboard: "number-pad" },
  { key: "steps", labelKey: "m.steps", unit: "", icon: "walk-outline", keyboard: "number-pad" },
  { key: "sleep", labelKey: "m.sleep", unit: "saat", icon: "bed-outline", keyboard: "number-pad" },
  { key: "water", labelKey: "m.water", unit: "stəkan", icon: "cafe-outline", keyboard: "number-pad" },
];

function bmi(m: Metrics): string {
  const h = parseFloat(m.height), w = parseFloat(m.weight);
  if (!h || !w) return "";
  return (w / Math.pow(h / 100, 2)).toFixed(1);
}

export function HealthMetrics() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [m, setM] = useState<Metrics>(EMPTY);
  const [editing, setEditing] = useState<Item | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE)
      .then((raw) => { if (raw) setM({ ...EMPTY, ...JSON.parse(raw) }); })
      .catch(() => {});
  }, []);

  function openEdit(it: Item) { setDraft(m[it.key]); setEditing(it); }
  function save() {
    if (!editing) return;
    const nv = { ...m, [editing.key]: draft.trim() };
    setM(nv);
    AsyncStorage.setItem(STORAGE, JSON.stringify(nv)).catch(() => {});
    setEditing(null);
  }

  const cells: { label: string; value: string; unit: string; icon: string; item?: Item }[] = [
    ...ITEMS.map((it) => ({ label: tr(it.labelKey), value: m[it.key], unit: it.unit, icon: it.icon, item: it })),
  ];
  // Insert computed BMI after weight.
  cells.splice(2, 0, { label: tr("m.bmi"), value: bmi(m), unit: "", icon: "speedometer-outline" });

  return (
    <View>
      <Muted style={{ fontSize: 12, marginBottom: 10 }}>{tr("saglik.note")}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: layout.gap }}>
        {cells.map((c, i) => (
          <Pressable key={i} disabled={!c.item} onPress={() => c.item && openEdit(c.item)} style={{ width: "48%" }}>
            <Card style={{ padding: 14, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={c.icon as any} size={18} color={t.brand} />
                </View>
                {c.item ? <Ionicons name="create-outline" size={15} color={t.faint} /> : null}
              </View>
              <Muted style={{ fontSize: 12 }}>{c.label}</Muted>
              <AppText weight="bold" style={{ fontSize: 18 }}>
                {c.value || "—"}{c.value && c.unit ? <AppText style={{ fontSize: 12, color: t.muted }}> {c.unit}</AppText> : null}
              </AppText>
              <Muted style={{ fontSize: 10.5 }}>{tr("m.source")}: {c.value ? tr("m.manual") : "—"}</Muted>
            </Card>
          </Pressable>
        ))}
      </View>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable onPress={() => setEditing(null)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderRadius: 18, padding: 18 }}>
            <AppText weight="bold" style={{ fontSize: 16, marginBottom: 12 }}>
              {editing ? tr(editing.labelKey) : ""} {editing?.unit ? `(${editing.unit})` : ""}
            </AppText>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType={editing?.keyboard ?? "default"}
              autoFocus
              placeholder={editing?.key === "bp" ? "120/80" : ""}
              placeholderTextColor={t.faint}
              style={{ backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 }}
            />
            <Pressable onPress={save} style={{ marginTop: 14, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: "center" }}>
              <AppText weight="bold" color="#ffffff">{tr("m.save")}</AppText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
