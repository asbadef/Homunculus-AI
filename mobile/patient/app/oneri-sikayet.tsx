import React, { useState } from "react";
import { View, TextInput, Pressable, Image, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { layout } from "../src/theme/tokens";
import { pickImage } from "../src/ui/pickImage";

export default function Feedback() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sent, setSent] = useState(false);

  async function attach() {
    const uri = await pickImage();
    if (uri) setAttachments((a) => [...a, uri]);
  }
  function send() {
    if (!subject.trim() || !message.trim()) return;
    // Backend yok (M1): gönderim demo olarak onaylanır (ekler dahil).
    setSent(true);
    setSubject("");
    setMessage("");
    setAttachments([]);
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

        {attachments.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {attachments.map((uri, i) => (
              <View key={i} style={{ position: "relative" }}>
                <Image source={{ uri }} style={{ width: 72, height: 72, borderRadius: 12 }} />
                <Pressable onPress={() => setAttachments((a) => a.filter((_, j) => j !== i))} style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 99, backgroundColor: t.danger, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: t.bg }}>
                  <Ionicons name="close" size={12} color="#ffffff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <Pressable onPress={attach} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 12, paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Ionicons name="image-outline" size={18} color={t.brand} />
          <AppText weight="semibold">{tr("fb.attach")}</AppText>
        </Pressable>

        <Pressable onPress={send} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: "center" }}>
          <AppText weight="bold" color="#ffffff">{tr("fb.send")}</AppText>
        </Pressable>
        <Muted style={{ fontSize: 12 }}>{tr("fb.note")}</Muted>
      </View>
    </Screen>
  );
}
