import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { PatientDetail } from "../../src/ui/PatientDetail";

export default function PatientScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
  const { patient, acknowledge } = useBoard();
  const view = patient(id);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: true, title: "", headerTransparent: true }} />
      {view ? (
        <PatientDetail view={view} onAcknowledge={(kind) => acknowledge(id, kind)} />
      ) : (
        <View className="flex-1 items-center justify-center p-8">
          <Text className="text-clinical-stale">{t("detail.missing")}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}
