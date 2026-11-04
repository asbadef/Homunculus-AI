import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../theme/ThemeProvider";
import { layout } from "../theme/tokens";
import { AppText } from "../ui/base";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function WizardHeader({ title, step, total }: { title: string; step: number; total: number }) {
  const { t } = useTheme();
  return (
    <View style={{ paddingBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <AppText weight="bold" style={{ fontSize: 18 }}>
          {title}
        </AppText>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={10}>
          <Ionicons name="close" size={24} color={t.muted} />
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
        <View style={{ flex: 1, height: 5, borderRadius: 99, backgroundColor: t.border }}>
          <View style={{ width: `${(step / total) * 100}%`, height: 5, borderRadius: 99, backgroundColor: t.brand }} />
        </View>
        <AppText style={{ fontSize: 12, color: t.muted }}>
          {step}/{total}
        </AppText>
      </View>
    </View>
  );
}

// Pressable list row with leading icon, label, optional meta, selected ring.
export function Row({ icon, label, meta, selected, onPress }: { icon?: IconName; label: string; meta?: string; selected?: boolean; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: t.surface,
        borderRadius: 14,
        borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
        borderColor: selected ? t.brand : t.border,
        padding: 14,
        marginBottom: 10,
      }}
    >
      {icon ? (
        <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={20} color={t.brand} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText weight="semibold" numberOfLines={2} style={{ fontSize: 14 }}>
          {label}
        </AppText>
        {meta ? <AppText style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>{meta}</AppText> : null}
      </View>
      <Ionicons name={selected ? "checkmark-circle" : "chevron-forward"} size={20} color={selected ? t.brand : t.faint} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 12,
        backgroundColor: selected ? t.brand : t.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? t.brand : t.border,
      }}
    >
      <AppText weight="semibold" color={selected ? "#ffffff" : t.fg} style={{ fontSize: 13 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function BottomButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{
        backgroundColor: disabled ? t.border : t.brand,
        borderRadius: 14,
        paddingVertical: 15,
        alignItems: "center",
        marginTop: 8,
        marginBottom: 6,
      }}
    >
      <AppText weight="bold" color={disabled ? t.muted : "#ffffff"} style={{ fontSize: 15, fontFamily: layout.fontBold }}>
        {label}
      </AppText>
    </Pressable>
  );
}
