import React, { useEffect, useState } from "react";
import { View, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader, EmptyState } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { layout } from "../src/theme/tokens";
import { getCards, addCard, removeCard, SavedCard } from "../src/demo/cards";

export default function AddCard() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<SavedCard[]>([]);
  const [num, setNum] = useState("");
  const [holder, setHolder] = useState("");
  const [exp, setExp] = useState("");

  useEffect(() => { getCards().then(setList); }, []);

  const valid = num.replace(/\D/g, "").length >= 12 && holder.trim() && /^\d{2}\/\d{2}$/.test(exp.trim());

  async function save() {
    if (!valid) return;
    setList(await addCard(num, holder, exp));
    setNum(""); setHolder(""); setExp("");
  }
  async function remove(id: string) { setList(await removeCard(id)); }

  const input = { backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 } as const;

  return (
    <Screen scroll>
      <StackHeader title={tr("inv.addCard")} />

      {list.length === 0 ? (
        <EmptyState icon="card-outline" title={tr("card.empty")} />
      ) : (
        list.map((c) => (
          <Card key={c.id} style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 11, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="card" size={22} color={t.brand} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText weight="semibold">{c.brand} ···· {c.last4}</AppText>
              <Muted style={{ fontSize: 12 }}>{c.holder} · {c.expiry}</Muted>
            </View>
            <Pressable onPress={() => remove(c.id)} hitSlop={8}><Ionicons name="trash-outline" size={19} color={t.danger} /></Pressable>
          </Card>
        ))
      )}

      <Card style={{ gap: 12, marginTop: 6 }}>
        <TextInput value={num} onChangeText={setNum} keyboardType="number-pad" placeholder={tr("card.number")} placeholderTextColor={t.faint} style={input} />
        <TextInput value={holder} onChangeText={setHolder} autoCapitalize="characters" placeholder={tr("card.holder")} placeholderTextColor={t.faint} style={input} />
        <TextInput value={exp} onChangeText={setExp} placeholder={tr("card.expiry")} placeholderTextColor={t.faint} style={input} />
        <Pressable onPress={save} disabled={!valid} style={{ backgroundColor: valid ? t.brand : t.border, borderRadius: 12, paddingVertical: 13, alignItems: "center" }}>
          <AppText weight="bold" color={valid ? "#ffffff" : t.muted}>{tr("doc.save")}</AppText>
        </Pressable>
      </Card>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 14, paddingHorizontal: 2 }}>
        <Ionicons name="lock-closed-outline" size={15} color={t.muted} />
        <Muted style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 }}>{tr("card.note")}</Muted>
      </View>
      <View style={{ height: 16 }} />
    </Screen>
  );
}
