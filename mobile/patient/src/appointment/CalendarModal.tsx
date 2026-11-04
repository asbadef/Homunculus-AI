import React, { useState } from "react";
import { View, Pressable, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Muted } from "../ui/base";
import { useTheme } from "../theme/ThemeProvider";
import { useI18n } from "../i18n";

const AZ_MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
const WD = ["B.e", "Ç.a", "Ç", "C.a", "C", "Ş", "B"]; // Monday-first

// Month-grid date picker. onPick returns "<d> <AZ month> <year>" (parse-friendly).
export function CalendarModal({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (date: string) => void }) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const first = new Date(ym.y, ym.m, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first leading blanks
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const minMonth = today.getFullYear() * 12 + today.getMonth();
  const curMonth = ym.y * 12 + ym.m;

  function shift(d: number) {
    const n = curMonth + d;
    if (n < minMonth) return; // no past months
    setYm({ y: Math.floor(n / 12), m: n % 12 });
  }
  function isPast(day: number) {
    const dt = new Date(ym.y, ym.m, day);
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return dt < t0;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30 }}>
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 99, backgroundColor: t.border, marginBottom: 14 }} />
          <AppText weight="bold" style={{ fontSize: 18, textAlign: "center", marginBottom: 14 }}>{tr("cal.title")}</AppText>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Pressable onPress={() => shift(-1)} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 99, alignItems: "center", justifyContent: "center", backgroundColor: curMonth > minMonth ? t.surface2 : "transparent" }}>
              <Ionicons name="chevron-back" size={20} color={curMonth > minMonth ? t.fg : t.faint} />
            </Pressable>
            <AppText weight="bold" style={{ fontSize: 15 }}>{AZ_MONTHS[ym.m]} {ym.y}</AppText>
            <Pressable onPress={() => shift(1)} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 99, alignItems: "center", justifyContent: "center", backgroundColor: t.surface2 }}>
              <Ionicons name="chevron-forward" size={20} color={t.fg} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", marginBottom: 6 }}>
            {WD.map((w) => (
              <View key={w} style={{ flex: 1, alignItems: "center" }}><Muted style={{ fontSize: 11 }}>{w}</Muted></View>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {cells.map((d, i) => {
              if (d === null) return <View key={i} style={{ width: `${100 / 7}%`, height: 46 }} />;
              const past = isPast(d);
              return (
                <View key={i} style={{ width: `${100 / 7}%`, height: 46, padding: 3 }}>
                  <Pressable
                    disabled={past}
                    onPress={() => { onPick(`${d} ${AZ_MONTHS[ym.m]} ${ym.y}`); onClose(); }}
                    style={{ flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: past ? 0 : 1, borderColor: t.brand + "55", backgroundColor: past ? t.surface2 : t.surface }}
                  >
                    <AppText weight={past ? "regular" : "semibold"} color={past ? t.faint : t.fg}>{d}</AppText>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
