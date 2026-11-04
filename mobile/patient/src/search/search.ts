// In-app search over features, branches and doctors. Pure + case-insensitive so it can
// be unit-tested; empty query returns nothing (search screen shows a hint instead).
export type SearchKind = "feature" | "branch" | "doctor";
export type SearchItem = { id: string; label: string; sub?: string; icon: string; route: string; kind: SearchKind };

export function searchItems(q: string, items: SearchItem[]): SearchItem[] {
  const n = q.trim().toLowerCase();
  if (!n) return [];
  return items.filter((it) => (it.label + " " + (it.sub ?? "")).toLowerCase().includes(n));
}
