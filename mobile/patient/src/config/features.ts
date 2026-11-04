// Single source for home shortcuts + quick services. Add/remove/reorder a feature
// by editing one entry here — Home renders only `enabled`, sorted by `order`.

export type FeatureGroup = "shortcut" | "service";

export type Feature = {
  key: string;
  titleKey: string; // i18n key
  icon: string; // Ionicons name
  route: string;
  group: FeatureGroup;
  enabled: boolean;
  order: number;
};

export const FEATURES: Feature[] = [
  { key: "appointments", titleKey: "feat.appointments", icon: "calendar", route: "/randevu", group: "shortcut", enabled: true, order: 1 },
  { key: "results", titleKey: "feat.results", icon: "document-text", route: "/neticeler", group: "shortcut", enabled: true, order: 2 },
  { key: "prescriptions", titleKey: "feat.prescriptions", icon: "medical", route: "/reseptler", group: "shortcut", enabled: true, order: 3 },
  { key: "invoices", titleKey: "feat.invoices", icon: "card", route: "/faturalar", group: "shortcut", enabled: true, order: 4 },

  { key: "myhealth", titleKey: "saglik.my", icon: "pulse", route: "/saglik", group: "service", enabled: true, order: 0 },
  { key: "healthcard", titleKey: "feat.healthcard", icon: "shield-checkmark", route: "/saglik-karti", group: "service", enabled: true, order: 1 },
  { key: "followup", titleKey: "feat.followup", icon: "heart-circle", route: "/yakin-takip", group: "service", enabled: true, order: 2 },
  { key: "vaccine", titleKey: "feat.vaccine", icon: "bandage", route: "/asi-karti", group: "service", enabled: true, order: 3 },
  { key: "checkup", titleKey: "feat.checkup", icon: "fitness", route: "/check-up", group: "service", enabled: true, order: 4 },
  { key: "documents", titleKey: "feat.documents", icon: "folder", route: "/dokumanlar", group: "service", enabled: true, order: 5 },
  { key: "favdocs", titleKey: "feat.favdocs", icon: "star", route: "/favori-doktorlar", group: "service", enabled: true, order: 6 },
  { key: "cards", titleKey: "feat.cards", icon: "wallet", route: "/kart-ekle", group: "service", enabled: true, order: 7 },
  { key: "pharmacy", titleKey: "feat.pharmacy", icon: "medkit", route: "/nobetci-eczane", group: "service", enabled: true, order: 8 },
  { key: "nearby", titleKey: "feat.nearby", icon: "location", route: "/yakin-hastaneler", group: "service", enabled: true, order: 9 },
  { key: "addfamily", titleKey: "pf.addFamily", icon: "person-add", route: "/aile", group: "service", enabled: true, order: 10 },
];

export function visibleFeatures(list: Feature[], group?: FeatureGroup): Feature[] {
  return list
    .filter((f) => f.enabled && (group ? f.group === group : true))
    .sort((a, b) => a.order - b.order);
}
