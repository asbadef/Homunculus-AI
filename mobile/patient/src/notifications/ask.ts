import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hm-notif-asked";

// Ask for notification permission once (the OS shows its prompt the first time).
export async function askNotificationPermissionOnce(): Promise<void> {
  try {
    const asked = await AsyncStorage.getItem(KEY).catch(() => null);
    if (asked) return;
    const current = await Notifications.getPermissionsAsync();
    if (current.status === "undetermined") {
      await Notifications.requestPermissionsAsync();
    }
    await AsyncStorage.setItem(KEY, "1").catch(() => {});
  } catch {
    /* notifications unavailable (e.g. web) */
  }
}
