import { Modal, Pressable, Text, View } from "react-native";

import { lookupSource } from "../domain/citations";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";

export function GuidelineDrawer({
  citationId,
  confidence,
  onClose,
}: {
  citationId: string | null;
  confidence: string;
  onClose: () => void;
}) {
  if (citationId === null) return null;
  const note = lookupSource(citationId);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View
          accessibilityLabel="guideline-drawer"
          className="rounded-t-3xl border-t border-clinical-border bg-card p-5"
        >
          <Text className="text-clinical-stale text-[11px] font-semibold uppercase tracking-wide">
            {t("drawer.title")}
          </Text>

          {note === null ? (
            <Text className="text-clinical-warning mt-2 text-base">
              {t("drawer.unknown", { id: citationId })}
            </Text>
          ) : (
            <>
              <Text className="text-foreground mt-2 text-lg font-semibold">{note.title}</Text>
              <Text className="text-clinical-stale mt-1 text-sm">
                {`${t("drawer.authority")}: ${t(`drawer.authority.${note.authority}` as MessageKey)}`}
              </Text>
              {note.superseded ? (
                <Text className="text-clinical-warning mt-2 text-sm">{t("drawer.superseded")}</Text>
              ) : null}
            </>
          )}

          {confidence.length > 0 ? (
            <Text className="text-clinical-stale mt-3 text-sm">{confidence}</Text>
          ) : null}

          <Text className="text-clinical-stale mt-3 text-[11px]">{t("drawer.note")}</Text>

          <Pressable
            onPress={onClose}
            className="mt-5 items-center rounded-xl border border-clinical-border py-2"
          >
            <Text className="text-foreground text-sm font-semibold">{t("drawer.close")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
