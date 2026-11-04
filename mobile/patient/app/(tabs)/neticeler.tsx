import React, { useCallback, useState } from "react";
import { View, Pressable, ScrollView, Modal, TextInput, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card, StatusPill, Chip, EmptyState, GradientHeader } from "../../src/ui/widgets";
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
const TYPE_TINT: Record<ResultType, string> = {
  lab: "#0891b2",
  radiology: "#6366f1",
  pathology: "#8b5cf6",
  epicrisis: "#10b981",
  document: "#f59e0b",
};
function hasAbnormal(r: Result): boolean {
  return r.values.some((v) => v.value < v.refLow || v.value > v.refHigh);
}
// Demo "AI" interpretation generated client-side from the result's values (no model call).
function aiComment(r: Result, tr: (k: string) => string): string {
  if (r.values.length === 0) return r.body ? r.body : tr("ai.noValues");
  const bad = r.values.filter((v) => v.value < v.refLow || v.value > v.refHigh);
  if (bad.length === 0) return tr("ai.normal");
  const lines = bad.map((v) => `• ${v.name}: ${v.value} ${v.unit} (${tr("res.ref")} ${v.refLow}–${v.refHigh})`);
  return tr("ai.abnormalPrefix") + "\n" + lines.join("\n") + "\n\n" + tr("res.consult");
}
type Filter = "all" | ResultType;
const FILTERS: Filter[] = ["all", "lab", "radiology", "pathology", "epicrisis", "document"];

export default function ResultsTab() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Result[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [aiFor, setAiFor] = useState<Result | null>(null);
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
      <GradientHeader
        title={tr("results.title")}
        right={
          <Pressable onPress={() => setAdding(true)} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#ffffff2e", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99 }}>
            <Ionicons name="add" size={16} color="#ffffff" />
            <AppText weight="semibold" color="#ffffff" style={{ fontSize: 13 }}>{tr("doc.add")}</AppText>
          </Pressable>
        }
      />

      {list ? (
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
          {([
            { n: list.length, labelKey: "res.sumTotal", color: t.brand },
            { n: list.filter((r) => r.status === "ready").length, labelKey: "res.sumReady", color: t.ok },
            { n: list.filter((r) => r.status === "pending").length, labelKey: "res.sumPending", color: t.wait },
          ]).map((s) => (
            <Card key={s.labelKey} style={{ flex: 1, alignItems: "center", paddingVertical: 12 }}>
              <AppText weight="extrabold" color={s.color} style={{ fontSize: 20 }}>{s.n}</AppText>
              <Muted style={{ fontSize: 11, marginTop: 2 }}>{tr(s.labelKey)}</Muted>
            </Card>
          ))}
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
        {FILTERS.map((f) => (
          <Chip key={f} label={tr(`res.filter.${f}`)} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </ScrollView>

      {list && filtered.length === 0 ? (
        <EmptyState icon="document-text-outline" title={tr("results.empty")} note={tr("empty.resNote")} />
      ) : (
        filtered.map((r) => {
          const tint = TYPE_TINT[r.type];
          const abnormal = hasAbnormal(r);
          return (
            <Card key={r.id} style={{ marginBottom: 10, padding: 0, overflow: "hidden" }}>
              <Pressable onPress={() => router.push(`/netice/${r.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: tint + "1f", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={TYPE_ICON[r.type]} size={22} color={tint} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText weight="semibold" numberOfLines={1}>{r.title}</AppText>
                  <Muted style={{ fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {tr(`res.filter.${r.type}`)} · {r.date}
                  </Muted>
                  {abnormal ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                      <Ionicons name="alert-circle" size={13} color={t.wait} />
                      <AppText weight="semibold" color={t.wait} style={{ fontSize: 11 }}>{tr("res.abnormal")}</AppText>
                    </View>
                  ) : null}
                </View>
                <StatusPill kind={r.status === "ready" ? "ok" : "wait"} label={r.status === "ready" ? tr("status.completed") : tr("status.pending")} />
              </Pressable>
              {r.status === "ready" ? (
                <Pressable onPress={() => setAiFor(r)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, backgroundColor: t.brandSoft }}>
                  <Ionicons name="sparkles" size={15} color={t.brand} />
                  <AppText weight="bold" color={t.brand} style={{ fontSize: 12.5 }}>{tr("ai.title")}</AppText>
                </Pressable>
              ) : null}
            </Card>
          );
        })
      )}

      <Modal visible={!!aiFor} transparent animationType="fade" onRequestClose={() => setAiFor(null)}>
        <Pressable onPress={() => setAiFor(null)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 12 }}>
              <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="sparkles" size={19} color={t.brand} />
              </View>
              <AppText weight="bold" style={{ fontSize: 16, flex: 1, minWidth: 0 }} numberOfLines={1}>{tr("ai.title")}</AppText>
            </View>
            {aiFor ? <AppText style={{ fontSize: 14, lineHeight: 21 }}>{aiComment(aiFor, tr)}</AppText> : null}
            <View style={{ flexDirection: "row", gap: 7, marginTop: 14, alignItems: "flex-start" }}>
              <Ionicons name="shield-checkmark-outline" size={14} color={t.muted} style={{ marginTop: 2 }} />
              <Muted style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 17 }}>{tr("ai.disclaimer")}</Muted>
            </View>
            <Pressable onPress={() => setAiFor(null)} style={{ marginTop: 14, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}>
              <AppText weight="bold" color="#ffffff">{tr("ai.ok")}</AppText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
