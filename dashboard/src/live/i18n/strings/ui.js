// Words the base components (src/live/ui/) say themselves. TR is the source. Not from the
// prototype's dictionary (its toasts have no tone words): AZ/RU/EN need a native speaker's review
// before the pilot.
//   toast.*  the visually hidden word a screen reader hears before a warning or error toast, so its
//            tone is not told by colour alone.
//   sample.* the design gallery's samples of component states (a field in error, a dialog opened
//            from a dialog); they belong with gallery.js and can move there.
export default {
  tr: {
    toast: { warn: "Uyarı:", error: "Hata:" },
    sample: { usernameTaken: "Bu kullanıcı adı zaten var.", nestedTitle: "İkinci pencere" },
  },
  az: {
    toast: { warn: "Xəbərdarlıq:", error: "Xəta:" },
    sample: { usernameTaken: "Bu istifadəçi adı artıq mövcuddur.", nestedTitle: "İkinci pəncərə" },
  },
  ru: {
    toast: { warn: "Предупреждение:", error: "Ошибка:" },
    sample: { usernameTaken: "Такое имя пользователя уже есть.", nestedTitle: "Второе окно" },
  },
  en: {
    toast: { warn: "Warning:", error: "Error:" },
    sample: { usernameTaken: "This username is already taken.", nestedTitle: "Second window" },
  },
};
