// Favourite doctors (ids). Seeded from the db's `favorite` flag on first run, then
// toggled by the user. Device-local.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doctors } from "./db";

const KEY = "hm-fav-docs";

export async function getFavIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return doctors.filter((d) => d.favorite).map((d) => d.id);
    return JSON.parse(raw) as string[];
  } catch {
    return doctors.filter((d) => d.favorite).map((d) => d.id);
  }
}

export async function toggleFav(id: string): Promise<string[]> {
  const ids = await getFavIds();
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  return next;
}
