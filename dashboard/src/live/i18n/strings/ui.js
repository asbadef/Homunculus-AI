// Words the base components (src/live/ui/) say themselves. TR is the source. Not from the
// prototype's dictionary (its toasts have no tone words): AZ/RU/EN need a native speaker's review
// before the pilot.
//   toast.*  the visually hidden word a screen reader hears before a warning or error toast, so its
//            tone is not told by colour alone.
//   sample.* the design gallery's samples of component states (a field in error, a dialog opened
//            from a dialog); they belong with gallery.js and can move there.
//   capsLock the warning every password field shows (ui/CapsLock.jsx); it was the same sentence in
//            the sign-in and the lock-screen dictionaries, and is one here.
export default {
  tr: {
    capsLock: "Caps Lock açık",
    toast: { warn: "Uyarı:", error: "Hata:" },
    sample: { usernameTaken: "Bu kullanıcı adı zaten var.", nestedTitle: "İkinci pencere" },
  },
  az: {
    capsLock: "Caps Lock açıqdır",
    toast: { warn: "Xəbərdarlıq:", error: "Xəta:" },
    sample: { usernameTaken: "Bu istifadəçi adı artıq mövcuddur.", nestedTitle: "İkinci pəncərə" },
  },
  ru: {
    capsLock: "Включён Caps Lock",
    toast: { warn: "Предупреждение:", error: "Ошибка:" },
    sample: { usernameTaken: "Такое имя пользователя уже есть.", nestedTitle: "Второе окно" },
  },
  en: {
    capsLock: "Caps Lock is on",
    toast: { warn: "Warning:", error: "Error:" },
    sample: { usernameTaken: "This username is already taken.", nestedTitle: "Second window" },
  },
};
