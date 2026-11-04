import React, { useEffect, useState } from "react";
import { View, Image, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader, EmptyState } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { transport } from "../src/demo/transport";
import { getFavIds, toggleFav } from "../src/demo/favorites";
import { doctorImages } from "../src/demo/images";
import { Doctor } from "../src/demo/types";

export default function FavoriteDoctors() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [all, setAll] = useState<Doctor[]>([]);
  const [favIds, setFavIds] = useState<string[]>([]);

  useEffect(() => {
    transport.getDoctors().then(setAll);
    getFavIds().then(setFavIds);
  }, []);

  const favs = all.filter((d) => favIds.includes(d.id));

  return (
    <Screen scroll>
      <StackHeader title={tr("feat.favdocs")} />
      {all.length > 0 && favs.length === 0 ? (
        <EmptyState icon="star-outline" title={tr("fav.empty")} note={tr("fav.note")} />
      ) : (
        favs.map((d) => (
          <Pressable key={d.id} onPress={() => router.push(`/doktor/${d.id}`)}>
            <Card style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
              {doctorImages[d.id] ? (
                <Image source={doctorImages[d.id]} style={{ width: 46, height: 46, borderRadius: 99 }} />
              ) : (
                <View style={{ width: 46, height: 46, borderRadius: 99, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                  <AppText weight="bold" color={t.brand} style={{ fontSize: 18 }}>{d.name.replace(/^Dr\.\s*/, "").slice(0, 1)}</AppText>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText weight="semibold" numberOfLines={1}>{d.name}</AppText>
                <Muted style={{ fontSize: 12 }}>{d.specialty}</Muted>
                <AppText color={t.brand} style={{ fontSize: 12, marginTop: 2 }}>⌚ {d.nextSlot}</AppText>
              </View>
              <Pressable onPress={async () => setFavIds(await toggleFav(d.id))} hitSlop={8}>
                <Ionicons name="heart" size={22} color={t.brand} />
              </Pressable>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
