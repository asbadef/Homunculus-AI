// Vaccine schedule the patient can edit (mark done / add / remove). Device-local (M1 later).
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hm-vaccines";
export type Vaccine = { id: string; name: string; date: string; done: boolean };

const SEED: Vaccine[] = [
  { id: "v1", name: "Hepatit B", date: "Doğumda", done: true },
  { id: "v2", name: "BCG", date: "1 ay", done: true },
  { id: "v3", name: "DBT-1", date: "2 ay", done: true },
  { id: "v4", name: "DBT-2", date: "4 ay", done: false },
];

export async function getVaccines(): Promise<Vaccine[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw === null ? SEED : (JSON.parse(raw) as Vaccine[]);
  } catch {
    return SEED;
  }
}

async function save(list: Vaccine[]): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export async function toggleVaccine(id: string): Promise<Vaccine[]> {
  const list = (await getVaccines()).map((v) => (v.id === id ? { ...v, done: !v.done } : v));
  await save(list);
  return list;
}

export async function addVaccine(name: string, date: string): Promise<Vaccine[]> {
  const list = [...(await getVaccines()), { id: "v-" + Date.now(), name: name.trim(), date: date.trim() || "—", done: false }];
  await save(list);
  return list;
}

export async function removeVaccine(id: string): Promise<Vaccine[]> {
  const list = (await getVaccines()).filter((v) => v.id !== id);
  await save(list);
  return list;
}
