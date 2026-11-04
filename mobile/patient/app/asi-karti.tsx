import React, { useEffect, useState } from "react";
import { View, Pressable, Modal, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader, StatusPill } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { layout } from "../src/theme/tokens";
import { getVaccines, toggleVaccine, addVaccine, removeVaccine, Vaccine } from "../src/demo/vaccines";

export default function VaccineCard() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Vaccine[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");

  useEffect(() => { getVaccines().then(setList); }, []);

  async function save() {
    if (!name.trim()) return;
    setList(await addVaccine(name, when));
    setName(""); setWhen(""); setAdding(false);
  }

  const input = { backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 } as const;

  return (
    <Screen scroll>
      <StackHeader title={tr("feat.vaccine")} />
      <Muted style={{ fontSize: 12, marginBottom: 12 }}>{tr("vac.hint")}</Muted>

      {list.map((v) => (
        <Card key={v.id} style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable onPress={async () => setList(await toggleVaccine(v.id))} hitSlop={8}>
            <Ionicons name={v.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={v.done ? t.ok : t.faint} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold">{v.name}</AppText>
            <Muted style={{ marginTop: 2 }}>{v.date}</Muted>
          </View>
          <StatusPill kind={v.done ? "ok" : "wait"} label={v.done ? tr("status.completed") : tr("status.pending")} />
          <Pressable onPress={async () => setList(await removeVaccine(v.id))} hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={t.danger} />
          </Pressable>
        </Card>
      ))}

      <Pressable onPress={() => setAdding(true)} style={{ marginTop: 6, borderWidth: 1, borderColor: t.border, borderRadius: 13, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Ionicons name="add" size={18} color={t.brand} />
        <AppText weight="semibold">{tr("vac.add")}</AppText>
      </Pressable>

      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <Pressable onPress={() => setAdding(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderRadius: 18, padding: 18, gap: 12 }}>
            <AppText weight="bold" style={{ fontSize: 16 }}>{tr("vac.add")}</AppText>
            <TextInput value={name} onChangeText={setName} placeholder={tr("vac.name")} placeholderTextColor={t.faint} style={input} />
            <TextInput value={when} onChangeText={setWhen} placeholder={tr("vac.when")} placeholderTextColor={t.faint} style={input} />
            <Pressable onPress={save} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: "center" }}>
              <AppText weight="bold" color="#ffffff">{tr("doc.save")}</AppText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <View style={{ height: 16 }} />
    </Screen>
  );
}
