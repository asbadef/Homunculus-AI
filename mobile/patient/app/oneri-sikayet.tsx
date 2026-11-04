import React, { useState } from "react";
import { View, TextInput, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { layout } from "../src/theme/tokens";

export default function Feedback() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  function send() {
    if (!subject.trim() || !message.trim()) return;
    // Backend yok (M1): gönderim demo olarak onaylanır.
    setSent(true);
    setSubject("");
    setMessage("");
  }

  const input = { backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: t.fg, fontFamily: layout.fontMedium, fontSize: 15 } as const;

  return (
    <Screen scroll>
      <StackHeader title={tr("menu.feedback")} />
      {sent ? (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: t.brandSoft, borderColor: t.brand + "55", marginTop: 6 }}>
          <Ionicons name="checkmark-circle" size={22} color={t.brand} />
          <AppText weight="semibold" color={t.brand} style={{ flex: 1, minWidth: 0 }}>{tr("fb.sent")}</AppText>
        </Card>
      ) : null}
      <View style={{ gap: 12, paddingTop: 10 }}>
        <TextInput value={subject} onChangeText={setSubject} placeholder={tr("fb.subject")} placeholderTextColor={t.faint} style={input} />
        <TextInput value={message} onChangeText={setMessage} placeholder={tr("fb.message")} placeholderTextColor={t.faint} multiline style={[input, { minHeight: 140, textAlignVertical: "top" }]} />
        <Pressable onPress={send} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: "center" }}>
          <AppText weight="bold" color="#ffffff">{tr("fb.send")}</AppText>
        </Pressable>
        <Muted style={{ fontSize: 12 }}>{tr("fb.note")}</Muted>
      </View>
    </Screen>
  );
}
