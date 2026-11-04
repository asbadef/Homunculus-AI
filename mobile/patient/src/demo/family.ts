// Family members the patient manages. No backend yet (M1), so stored on the device.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hm-family";
export type FamilyMember = { id: string; name: string; relation: string; birthYear: string };

// Relation keys (i18n: rel.<key>).
export const RELATIONS = ["parent", "child", "spouse", "sibling", "other"] as const;

const SEED: FamilyMember[] = [{ id: "f-seed", name: "Nurlan Sunkur", relation: "child", birthYear: "2022" }];

export async function getFamily(): Promise<FamilyMember[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return SEED; // first run: show one demo member
    return JSON.parse(raw) as FamilyMember[];
  } catch {
    return SEED;
  }
}

async function save(list: FamilyMember[]): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export async function addFamily(name: string, relation: string, birthYear: string): Promise<FamilyMember[]> {
  const list = await getFamily();
  const next = [...list, { id: "f-" + Date.now(), name: name.trim(), relation, birthYear: birthYear.trim() }];
  await save(next);
  return next;
}

export async function removeFamily(id: string): Promise<FamilyMember[]> {
  const list = (await getFamily()).filter((m) => m.id !== id);
  await save(list);
  return list;
}
