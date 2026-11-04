import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, Switch, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { layout } from "../theme/tokens";
import { AppText, Muted } from "./base";

// Keyboard-safe screen: content scrolls and the bottom action stays reachable.
export function FormScreen({ children }: { children: React.ReactNode }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 20,
          paddingLeft: Math.max(layout.pad, insets.left),
          paddingRight: Math.max(layout.pad, insets.right),
        }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function TextField({ id, label, value, onChange, keyboard, placeholder, autoCap }: { id: string; label: string; value: string; onChange: (v: string) => void; keyboard?: "default" | "number-pad" | "phone-pad"; placeholder?: string; autoCap?: "none" | "characters" }) {
  const { t } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <Muted style={{ fontSize: 12, marginBottom: 6 }}>{label}</Muted>
      <TextInput
        nativeID={id}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboard ?? "default"}
        placeholder={placeholder}
        placeholderTextColor={t.faint}
        autoCapitalize={autoCap ?? "none"}
        style={{ backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 }}
      />
    </View>
  );
}

// Dropdown select backed by a bottom-sheet-style modal.
export function Dropdown<T extends { key: string; label: string }>({ label, options, value, onChange }: { label: string; options: T[]; value: string; onChange: (key: string) => void }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.key === value);
  return (
    <View style={{ marginBottom: 14 }}>
      <Muted style={{ fontSize: 12, marginBottom: 6 }}>{label}</Muted>
      <Pressable onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 }}>
        <AppText weight="medium" style={{ fontSize: 15 }}>
          {selected?.label ?? "—"}
        </AppText>
        <Ionicons name="chevron-down" size={18} color={t.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 30, paddingTop: 10 }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 99, backgroundColor: t.border, marginBottom: 8 }} />
            <ScrollView style={{ maxHeight: 320 }}>
              {options.map((o) => (
                <Pressable key={o.key} onPress={() => { onChange(o.key); setOpen(false); }} style={{ paddingHorizontal: 20, paddingVertical: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <AppText weight={o.key === value ? "bold" : "regular"} color={o.key === value ? t.brand : t.fg} style={{ fontSize: 15 }}>
                    {o.label}
                  </AppText>
                  {o.key === value ? <Ionicons name="checkmark" size={18} color={t.brand} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// Date picker field (native spinner/dialog).
export function DateField({ label, value, onChange }: { label: string; value: Date | null; onChange: (d: Date) => void }) {
  const { t } = useTheme();
  const [show, setShow] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Muted style={{ fontSize: 12, marginBottom: 6 }}>{label}</Muted>
      <Pressable onPress={() => setShow(true)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 }}>
        <AppText weight="medium" color={value ? t.fg : t.faint} style={{ fontSize: 15 }}>
          {value ? value.toLocaleDateString() : "—"}
        </AppText>
        <Ionicons name="calendar-outline" size={18} color={t.muted} />
      </Pressable>
      {show ? (
        <DateTimePicker
          value={value ?? new Date(1990, 0, 1)}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          maximumDate={new Date()}
          onChange={(_e, d) => {
            setShow(Platform.OS === "ios");
            if (d) onChange(d);
          }}
        />
      ) : null}
    </View>
  );
}

export function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <AppText weight="medium">{label}</AppText>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.brand, false: t.border }} thumbColor="#ffffff" />
    </View>
  );
}
