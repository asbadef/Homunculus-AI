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

// Dropdown select backed by a bottom-sheet modal, with optional search.
export function Dropdown<T extends { key: string; label: string }>({ label, options, value, onChange, search, placeholder }: { label: string; options: T[]; value: string; onChange: (key: string) => void; search?: boolean; placeholder?: string }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.key === value);
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <View style={{ marginBottom: 14 }}>
      <Muted style={{ fontSize: 12, marginBottom: 6 }}>{label}</Muted>
      <Pressable onPress={() => { setQ(""); setOpen(true); }} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 }}>
        <AppText weight="medium" color={selected ? t.fg : t.faint} style={{ fontSize: 15 }}>
          {selected?.label ?? placeholder ?? "—"}
        </AppText>
        <Ionicons name="chevron-down" size={18} color={t.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 30, paddingTop: 10, maxHeight: "72%" }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 99, backgroundColor: t.border, marginBottom: 10 }} />
            {search ? (
              <View style={{ paddingHorizontal: 16, marginBottom: 6 }}>
                <TextInput value={q} onChangeText={setQ} placeholder="Axtar…" placeholderTextColor={t.faint} autoFocus style={{ backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: t.fg, fontSize: 15 }} />
              </View>
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled">
              {filtered.map((o) => (
                <Pressable key={o.key} onPress={() => { onChange(o.key); setOpen(false); }} style={{ paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <AppText weight={o.key === value ? "bold" : "regular"} color={o.key === value ? t.brand : t.fg} style={{ fontSize: 15 }}>
                    {o.label}
                  </AppText>
                  {o.key === value ? <Ionicons name="checkmark" size={18} color={t.brand} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// Date field that opens a panel (modal) to pick, instead of an inline wheel.
export function DateField({ label, value, onChange }: { label: string; value: Date | null; onChange: (d: Date) => void }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<Date>(value ?? new Date(2000, 0, 1));

  // Web has no native date wheel — use a real HTML date input (also helps testing).
  if (Platform.OS === "web") {
    return (
      <View style={{ marginBottom: 14 }}>
        <Muted style={{ fontSize: 12, marginBottom: 6 }}>{label}</Muted>
        {React.createElement("input", {
          type: "date",
          value: value ? value.toISOString().slice(0, 10) : "",
          max: new Date().toISOString().slice(0, 10),
          onChange: (e: any) => { if (e.target.value) onChange(new Date(e.target.value)); },
          style: { backgroundColor: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: "13px 14px", color: t.fg, fontSize: 15, width: "100%", boxSizing: "border-box" },
        })}
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 14 }}>
      <Muted style={{ fontSize: 12, marginBottom: 6 }}>{label}</Muted>
      <Pressable onPress={() => { setTemp(value ?? new Date(2000, 0, 1)); setOpen(true); }} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 }}>
        <AppText weight="medium" color={value ? t.fg : t.faint} style={{ fontSize: 15 }}>
          {value ? value.toLocaleDateString() : "—"}
        </AppText>
        <Ionicons name="calendar-outline" size={18} color={t.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingBottom: 30 }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 99, backgroundColor: t.border, marginBottom: 4 }} />
            <View style={{ height: 220, justifyContent: "center" }}>
              <DateTimePicker
                value={temp}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                textColor={t.fg}
                onChange={(_e, d) => { if (d) setTemp(d); }}
                style={{ height: 220 }}
              />
            </View>
            <Pressable onPress={() => { onChange(temp); setOpen(false); }} style={{ marginHorizontal: 16, marginTop: 6, backgroundColor: t.brand, borderRadius: 13, paddingVertical: 14, alignItems: "center" }}>
              <AppText weight="bold" color="#ffffff">Hazır</AppText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
