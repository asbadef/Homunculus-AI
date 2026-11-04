// Demo notifications with a persisted read-state so the unread badge actually drops
// once the user opens the notifications screen.
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Notif = { id: string; icon: string; titleKey: string; bodyKey: string; timeKey: string };

export const NOTIFS: Notif[] = [
  { id: "ntf1", icon: "calendar", titleKey: "ntf.appt.t", bodyKey: "ntf.appt.b", timeKey: "ntf.t.hour" },
  { id: "ntf2", icon: "document-text", titleKey: "ntf.res.t", bodyKey: "ntf.res.b", timeKey: "ntf.t.yest" },
  { id: "ntf3", icon: "medical", titleKey: "ntf.med.t", bodyKey: "ntf.med.b", timeKey: "ntf.t.yest" },
];

const KEY = "hm-notif-read";

export async function getReadIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function unreadCount(): Promise<number> {
  const read = await getReadIds();
  return NOTIFS.filter((n) => !read.includes(n.id)).length;
}

export async function markAllRead(): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(NOTIFS.map((n) => n.id))); } catch {}
}
