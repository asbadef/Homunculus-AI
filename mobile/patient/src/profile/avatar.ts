// Patient's own profile photo. Stored locally as a file URI.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hm-avatar";

export async function getAvatar(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}
export async function setAvatar(uri: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY, uri); } catch {}
}
export async function clearAvatar(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}
