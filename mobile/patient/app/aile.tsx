import React, { useEffect, useState } from "react";
import { View, Pressable, Modal, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader, EmptyState } from "../src/ui/widgets";
import { Dropdown } from "../src/ui/form";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { layout } from "../src/theme/tokens";
import { router } from "expo-router";
import { getFamily, addFamily, removeFamily, RELATIONS, FamilyMember } from "../src/demo/family";
import { viewAs } from "../src/demo/viewing";
import { demoAlert } from "../src/ui/demo";

export default function Family() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<FamilyMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<string>("child");
  const [year, setYear] = useState("");

  useEffect(() => { getFamily().then(setList); }, []);

  const age = (y: string) => { const n = parseInt(y, 10); return n ? ` (${new Date().getFullYear() - n} ${tr("fam.age")})` : ""; };

  async function save() {
    if (!name.trim()) return;
    setList(await addFamily(name, relation, year));
    setName(""); setYear(""); setRelation("child"); setAdding(false);
  }
  async function remove(id: string) { setList(await removeFamily(id)); }
  function open(m: FamilyMember) {
    if (m.patientId) { viewAs(m.patientId, m.name); router.replace("/"); }
    else demoAlert(tr); // record not linked yet (M1)
  }

  const input = { backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 } as const;

  return (
    <Screen scroll>
      <StackHeader title={tr("pf.family")} />

      {list.length === 0 ? (
        <EmptyState icon="people-outline" title={tr("fam.empty")} />
      ) : (
        list.map((m) => (
          <Pressable key={m.id} onPress={() => open(m)}>
            <Card style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 99, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <AppText weight="bold" color={t.brand} style={{ fontSize: 18 }}>{m.name.slice(0, 1)}</AppText>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText weight="semibold" numberOfLines={1}>{m.name}{age(m.birthYear)}</AppText>
                <Muted style={{ fontSize: 12 }}>{tr("rel." + m.relation)}{m.patientId ? " · " + tr("fam.view") : ""}</Muted>
              </View>
              <Pressable onPress={() => remove(m.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={19} color={t.danger} />
              </Pressable>
            </Card>
          </Pressable>
        ))
      )}

      <Pressable onPress={() => setAdding(true)} style={{ marginTop: 6, borderWidth: 1, borderColor: t.border, borderRadius: 13, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Ionicons name="person-add-outline" size={18} color={t.brand} />
        <AppText weight="semibold">{tr("pf.addFamily")}</AppText>
      </Pressable>

      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <Pressable onPress={() => setAdding(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderRadius: 18, padding: 18, gap: 12 }}>
            <AppText weight="bold" style={{ fontSize: 16 }}>{tr("pf.addFamily")}</AppText>
            <TextInput value={name} onChangeText={setName} placeholder={tr("fam.name")} placeholderTextColor={t.faint} style={input} />
            <Dropdown label={tr("fam.relation")} value={relation} onChange={setRelation} options={RELATIONS.map((r) => ({ key: r, label: tr("rel." + r) }))} />
            <TextInput value={year} onChangeText={setYear} keyboardType="number-pad" placeholder={tr("fam.birthYear")} placeholderTextColor={t.faint} style={input} />
            <Pressable onPress={save} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: "center" }}>
              <AppText weight="bold" color="#ffffff">{tr("doc.save")}</AppText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
