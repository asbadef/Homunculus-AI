import { Modal, Pressable, Text, View } from "react-native";

import { lookupSource } from "../domain/citations";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useTheme } from "../theme/ThemeContext";

// M6/Task 4: the kit's bottom sheet — a large-radius wash card (double BedCard's own 22px, since
// this sheet spans the full width and reads better with a bigger curve) instead of M5's bordered
// `rounded-t-3xl` panel; the close action becomes a ghost pill (`bg-panel` + border), matching
// every other secondary action in the app (see SettingsPanel's `Chip`).
export function GuidelineDrawer({
  citationId,
  confidence,
  onClose,
}: {
  citationId: string | null;
  confidence: string;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  if (citationId === null) return null;
  const note = lookupSource(citationId);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View
          accessibilityLabel="guideline-drawer"
          className="bg-card rounded-t-[32px] p-5"
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
            className="bg-panel mt-5 items-center rounded-full py-2.5"
            style={{ borderWidth: 1, borderColor: palette.clinical.border }}
          >
            <Text className="text-foreground text-sm font-semibold">{t("drawer.close")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
