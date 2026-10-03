// Words the base components (src/live/ui/) say themselves. TR is the source. Not from the
// prototype's dictionary (its toasts have no tone words): AZ/RU/EN need a native speaker's review
// before the pilot.
//   toast.*  the visually hidden word a screen reader hears before a warning or error toast, so its
//            tone is not told by colour alone.
export default {
  tr: { toast: { warn: "Uyarı:", error: "Hata:" } },
  az: { toast: { warn: "Xəbərdarlıq:", error: "Xəta:" } },
  ru: { toast: { warn: "Предупреждение:", error: "Ошибка:" } },
  en: { toast: { warn: "Warning:", error: "Error:" } },
};
