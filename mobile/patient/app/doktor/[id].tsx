import React, { useEffect, useState } from "react";
import { View, Image, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card, StackHeader } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { doctorImages } from "../../src/demo/images";
import { getFavIds, toggleFav } from "../../src/demo/favorites";
import { Doctor } from "../../src/demo/types";

function Section({ title, items }: { title: string; items: string[] }) {
  const { t } = useTheme();
  if (!items || items.length === 0) return null;
  return (
    <View style={{ marginTop: 16 }}>
      <AppText weight="bold" style={{ fontSize: 14, marginBottom: 8 }}>{title}</AppText>
      <Card style={{ gap: 8 }}>
        {items.map((line, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 8 }}>
            <Ionicons name="ellipse" size={6} color={t.brand} style={{ marginTop: 6 }} />
            <AppText style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19, color: t.fg }}>{line}</AppText>
          </View>
        ))}
      </Card>
    </View>
  );
}

export default function DoctorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [d, setD] = useState<Doctor | null>(null);
  const [fav, setFav] = useState(false);

  useEffect(() => {
    transport.getDoctors().then((rows) => setD(rows.find((x) => x.id === id) ?? null));
    getFavIds().then((ids) => setFav(ids.includes(String(id))));
  }, [id]);

  if (!d) return <Screen />;
  const initials = d.name.replace(/^Dr\.\s*/, "").slice(0, 1);

  return (
    <Screen scroll>
      <StackHeader title={tr("wiz.doctor.title")} />

      <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        {doctorImages[d.id] ? (
          <Image source={doctorImages[d.id]} style={{ width: 64, height: 64, borderRadius: 99, borderWidth: 2, borderColor: t.brandSoft }} resizeMode="cover" />
        ) : (
          <View style={{ width: 64, height: 64, borderRadius: 99, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <AppText weight="bold" color={t.brand} style={{ fontSize: 26 }}>{initials}</AppText>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText weight="extrabold" style={{ fontSize: 17 }} numberOfLines={1}>{d.name}</AppText>
          <AppText style={{ fontSize: 13, color: t.muted, marginTop: 2 }}>{d.specialty}</AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 }}>
            <Ionicons name="time-outline" size={14} color={t.brand} />
            <AppText weight="semibold" color={t.brand} style={{ fontSize: 12 }}>{d.nextSlot}</AppText>
          </View>
        </View>
        <Pressable onPress={async () => setFav((await toggleFav(d.id)).includes(d.id))} hitSlop={8}>
          <Ionicons name={fav ? "heart" : "heart-outline"} size={24} color={t.brand} />
        </Pressable>
      </Card>

      <Section title={tr("doc.education")} items={d.education} />
      <Section title={tr("doc.experience")} items={d.experience} />
      <Section title={tr("doc.memberships")} items={d.memberships} />
      <Section title={tr("wiz.pubs")} items={d.publications ?? []} />

      <Pressable onPress={() => router.push("/randevu-al/tip")} style={{ marginTop: 20, backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Ionicons name="calendar" size={18} color="#ffffff" />
        <AppText weight="bold" color="#ffffff" style={{ fontSize: 15 }}>{tr("appointments.new")}</AppText>
      </Pressable>
      <View style={{ height: 16 }} />
    </Screen>
  );
}
