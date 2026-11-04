import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card } from "../../src/ui/widgets";
import { TrendSparkline } from "../../src/components/TrendSparkline";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Result } from "../../src/demo/types";
import { useScreenGuard } from "../../src/security/useScreenGuard";

export default function ResultDetail() {
  useScreenGuard();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [r, setR] = useState<Result | null>(null);
  const [explain, setExplain] = useState(false);

  useEffect(() => {
    transport.getResults().then((rows) => setR(rows.find((x) => x.id === id) ?? null));
  }, [id]);

  if (!r) return <Screen />;

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={t.fg} />
        </Pressable>
        <AppText weight="bold" style={{ fontSize: 18, flex: 1, minWidth: 0 }} numberOfLines={1}>
          {r.title}
        </AppText>
      </View>
      <Muted style={{ marginBottom: 14 }}>
        {r.date} · {tr("res.protocol")}: {r.protocol} · {r.hospital}
      </Muted>

      {r.values.length === 0 ? (
        <Card>
          <Muted>{r.status === "pending" ? tr("results.empty") : r.doctor}</Muted>
        </Card>
      ) : (
        r.values.map((v, i) => {
          const abnormal = v.value < v.refLow || v.value > v.refHigh;
          return (
            <Card key={i} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <AppText weight="semibold">{v.name}</AppText>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <AppText weight="bold" style={{ fontSize: 16 }}>
                    {v.value} {v.unit}
                  </AppText>
                  <View style={{ backgroundColor: (abnormal ? t.wait : t.ok) + "28", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 }}>
                    <AppText weight="bold" color={abnormal ? t.wait : t.ok} style={{ fontSize: 11 }}>
                      {abnormal ? tr("res.abnormal") : tr("res.normal")}
                    </AppText>
                  </View>
                </View>
              </View>
              <Muted style={{ marginTop: 4 }}>
                {tr("res.ref")}: {v.refLow}–{v.refHigh} {v.unit}
              </Muted>
              {v.series && v.series.length > 1 ? (
                <View style={{ marginTop: 10 }}>
                  <Muted style={{ fontSize: 11, marginBottom: 4 }}>{tr("res.trend")}</Muted>
                  <TrendSparkline series={v.series} />
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      <Pressable onPress={() => setExplain((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, marginBottom: 8 }}>
        <Ionicons name="sparkles" size={16} color={t.brand} />
        <AppText weight="bold" color={t.brand}>
          {tr("results.explain")}
        </AppText>
      </Pressable>
      {explain ? (
        <Card style={{ backgroundColor: t.brandSoft, borderColor: t.brand + "55" }}>
          <AppText weight="semibold" color={t.brand} style={{ marginBottom: 6 }}>
            {tr("res.explainTitle")}
          </AppText>
          <AppText style={{ fontSize: 13, lineHeight: 19 }}>{tr("res.explainBody")}</AppText>
          <AppText weight="semibold" style={{ fontSize: 13, marginTop: 8 }}>
            ⚠️ {tr("res.consult")}
          </AppText>
        </Card>
      ) : null}
      <View style={{ height: 16 }} />
    </Screen>
  );
}
