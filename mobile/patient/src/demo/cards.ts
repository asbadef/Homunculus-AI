// Saved payment cards. No real payment (that is M1); we store ONLY the masked last 4
// digits + brand + expiry on the device — never the full card number.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hm-cards";
export type SavedCard = { id: string; last4: string; holder: string; expiry: string; brand: string };

function brandOf(digits: string): string {
  if (digits.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(digits)) return "Mastercard";
  return "Kart";
}

export async function getCards(): Promise<SavedCard[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedCard[]) : [];
  } catch {
    return [];
  }
}

// Takes the raw typed number but persists only the last 4 digits + brand.
export async function addCard(cardNumber: string, holder: string, expiry: string): Promise<SavedCard[]> {
  const digits = cardNumber.replace(/\D/g, "");
  const card: SavedCard = {
    id: "c-" + Date.now(),
    last4: digits.slice(-4),
    holder: holder.trim(),
    expiry: expiry.trim(),
    brand: brandOf(digits),
  };
  const list = await getCards();
  const next = [...list, card];
  try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  return next;
}

export async function removeCard(id: string): Promise<SavedCard[]> {
  const list = (await getCards()).filter((c) => c.id !== id);
  try { await AsyncStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  return list;
}
