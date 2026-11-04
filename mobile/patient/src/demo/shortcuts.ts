// User's customizable "my shortcuts" (feature keys). Seeded on first run, edited on the
// Kısa Yollar screen, shown in the drawer.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hm-shortcuts";
const SEED = ["results", "prescriptions", "favdocs", "addfamily"];

export async function getShortcutKeys(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw === null ? SEED : (JSON.parse(raw) as string[]);
  } catch {
    return SEED;
  }
}

export async function toggleShortcut(key: string): Promise<string[]> {
  const keys = await getShortcutKeys();
  const next = keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
  try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  return next;
}
