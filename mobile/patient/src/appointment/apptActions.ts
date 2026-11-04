// Real, backend-free appointment actions: open maps, add to calendar, schedule a local
// reminder. These work today without M1 (phone / browser features only).
import { Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { Appointment } from "../demo/types";
import { parseApptDate } from "./apptDate";

export function openDirections(hospital: string): void {
  const q = encodeURIComponent(hospital);
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => {});
}

function stamp(d: Date): string {
  // UTC basic format YYYYMMDDTHHMMSSZ for calendar template URLs.
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function addToCalendar(appt: Appointment): void {
  const start = parseApptDate(appt.date, appt.time);
  if (!start) return;
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const text = encodeURIComponent(`${appt.doctor} — ${appt.specialty}`);
  const loc = encodeURIComponent(appt.hospital);
  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${stamp(start)}/${stamp(end)}&location=${loc}`;
  Linking.openURL(url).catch(() => {});
}

// Schedule a local notification ~24h before the appointment (or in 5s for a near/past
// demo appointment so the reminder is still demonstrable). Returns true if scheduled.
export async function scheduleReminder(appt: Appointment, title: string, body: string): Promise<boolean> {
  if (Platform.OS === "web") return false; // web has no local scheduling
  const start = parseApptDate(appt.date, appt.time);
  if (!start) return false;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      if (req.status !== "granted") return false;
    }
    const when = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const secs = Math.max(5, Math.round((when.getTime() - Date.now()) / 1000));
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { seconds: secs } as any,
    });
    return true;
  } catch {
    return false;
  }
}
