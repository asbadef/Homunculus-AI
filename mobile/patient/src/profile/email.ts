import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hm-email";

export async function getEmail(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEY)) ?? "";
  } catch {
    return "";
  }
}
export async function setEmail(v: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, v.trim());
  } catch {
    /* ignore */
  }
}
