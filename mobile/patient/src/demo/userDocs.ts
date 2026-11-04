// Patient-added documents. No backend yet (that is M1), so they live in AsyncStorage
// on the device and are merged into the results list alongside the demo records.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Result } from "./types";

const KEY = "hm-docs";

export async function getUserDocs(): Promise<Result[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Result[]) : [];
  } catch {
    return [];
  }
}

export async function addUserDoc(title: string, body: string): Promise<Result> {
  const docs = await getUserDocs();
  const doc: Result = {
    id: "u" + Date.now(),
    type: "document",
    title: title.trim(),
    date: new Date().toLocaleDateString("az-AZ"),
    status: "ready",
    protocol: "—",
    hospital: "—",
    doctor: "—",
    values: [],
    body: body.trim() || undefined,
    userAdded: true,
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify([doc, ...docs]));
  } catch {}
  return doc;
}
