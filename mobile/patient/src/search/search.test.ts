import { searchItems, SearchItem } from "./search";

const items: SearchItem[] = [
  { id: "f1", label: "Randevu", icon: "calendar", route: "/randevu", kind: "feature" },
  { id: "b1", label: "Kardiologiya", sub: "Kardiologiya", icon: "heart", route: "/randevu-al/tip", kind: "branch" },
  { id: "d1", label: "Dr. Elçin Əliyev", sub: "Kardiologiya", icon: "person", route: "/randevu-al/tip", kind: "doctor" },
];

test("empty query returns nothing", () => {
  expect(searchItems("", items)).toHaveLength(0);
});

test("matches label and sub, case-insensitive", () => {
  expect(searchItems("kardio", items).map((x) => x.id)).toEqual(["b1", "d1"]);
  expect(searchItems("elçin", items).map((x) => x.id)).toEqual(["d1"]);
  expect(searchItems("RANDEVU", items).map((x) => x.id)).toEqual(["f1"]);
});
