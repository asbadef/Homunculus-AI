// Parse an Azerbaijani appointment date ("28 Noyabr 2026") + time ("14:30") into a Date.
// Pure so it can be unit-tested; returns null if the month name is not recognised.
const AZ_MONTHS = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr",
];

// Azerbaijani "İ/i" lower-casing: map dotted-İ to i so "İyul" matches "iyul".
function norm(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

export function parseApptDate(date: string, time: string): Date | null {
  const parts = date.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const day = parseInt(parts[0], 10);
  const month = AZ_MONTHS.indexOf(norm(parts[1]));
  const year = parseInt(parts[2], 10);
  if (!day || month < 0 || !year) return null;
  const [h, m] = (time || "0:0").split(":").map((x) => parseInt(x, 10) || 0);
  return new Date(year, month, day, h, m);
}
