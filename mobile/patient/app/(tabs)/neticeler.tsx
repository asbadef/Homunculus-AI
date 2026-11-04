import React, { useCallback, useState } from "react";
import { View, Pressable, ScrollView, Modal, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { Screen, AppText, Muted, Title } from "../../src/ui/base";
import { Card, StatusPill, Chip } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { layout } from "../../src/theme/tokens";
import { transport } from "../../src/demo/transport";
import { getUserDocs, addUserDoc } from "../../src/demo/userDocs";
import { Result, ResultType } from "../../src/demo/types";

const TYPE_ICON: Record<ResultType, any> = {
  lab: "flask-outline",
  radiology: "scan-outline",
  pathology: "cellular-outline",
  epicrisis: "reader-outline",
  document: "document-attach-outline",
};
type Filter = "all" | ResultType;
const FILTERS: Filter[] = ["all", "lab", "radiology", "pathology", "epicrisis", "document"];

export default function ResultsTab() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Result[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  const reload = useCallback(() => {
    Promise.all([transport.getResults(), getUserDocs()]).then(([rows, docs]) => setList([...docs, ...rows]));
  }, []);
  useFocusEffect(reload);

  const filtered = (list ?? []).filter((r) => filter === "all" || r.type === filter);

  async function saveDoc() {
    if (!title.trim()) return;
    await addUserDoc(title, note);
    setTitle("");
    setNote("");
    setAdding(false);
    reload();
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 6, paddingBottom: 12 }}>
        <Title style={{ flex: 1 }}>{tr("results.title")}</Title>
        <Pressable onPress={() => setAdding(true)} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: t.brandSoft, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99 }}>
          <Ionicons name="add" size={16} color={t.brand} />
          <AppText weight="semibold" color={t.brand} style={{ fontSize: 13 }}>{tr("doc.add")}</AppText>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
        {FILTERS.map((f) => (
          <Chip key={f} label={tr(`res.filter.${f}`)} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </ScrollView>

      {list && filtered.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 50, gap: 8 }}>
          <Ionicons name="document-text-outline" size={40} color={t.faint} />
          <Muted>{tr("results.empty")}</Muted>
        </View>
      ) : (
        filtered.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(`/netice/${r.id}`)}>
            <Card style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name={TYPE_ICON[r.type]} size={20} color={t.brand} />
                <AppText weight="semibold" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                  {r.title}
                </AppText>
                <StatusPill kind={r.status === "ready" ? "ok" : "wait"} label={r.status === "ready" ? tr("status.confirmed") : tr("status.pending")} />
              </View>
              <Muted style={{ marginTop: 8 }}>
                {r.date} · {tr("res.protocol")}: {r.protocol}
              </Muted>
            </Card>
          </Pressable>
        ))
      )}

      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <Pressable onPress={() => setAdding(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderRadius: 18, padding: 18, gap: 12 }}>
            <AppText weight="bold" style={{ fontSize: 16 }}>{tr("doc.add")}</AppText>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={tr("doc.title")}
              placeholderTextColor={t.faint}
              style={{ backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 }}
            />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={tr("doc.note")}
              placeholderTextColor={t.faint}
              multiline
              style={{ backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15, minHeight: 90, textAlignVertical: "top" }}
            />
            <Pressable onPress={saveDoc} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: "center" }}>
              <AppText weight="bold" color="#ffffff">{tr("doc.save")}</AppText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
