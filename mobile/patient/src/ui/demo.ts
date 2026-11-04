import { Alert } from "react-native";

// Gentle feedback for buttons whose real action lands in a later phase, so nothing
// feels like a dead tap during the demo.
export function demoAlert(t: (k: string) => string) {
  Alert.alert(t("demo.title"), t("demo.msg"));
}
