// The screens' names: in the rail, the breadcrumb and the page title. The prototype's dictionary
// (core.js m_beds, m_alarms, m_admin, m_settings). `*Short` is the rail's word on a phone (62 px):
// never an icon alone (roadmap: "Daraltılmış sol menüde her madde kısa adıyla görünür").
// patient, *Short: written for this plan; AZ/RU/EN need a native speaker's review before the pilot.
export default {
  tr: {
    beds: "Yataklar", bedsShort: "Yatak",
    alarms: "Alarmlar", alarmsShort: "Alarm",
    patient: "Hasta",
    admin: "Yönetim", adminShort: "Yönetim",
    settings: "Ayarlar", settingsShort: "Ayarlar",
  },
  az: {
    beds: "Çarpayılar", bedsShort: "Çarpayı",
    alarms: "Siqnallar", alarmsShort: "Siqnal",
    patient: "Xəstə",
    admin: "İdarə", adminShort: "İdarə",
    settings: "Ayarlar", settingsShort: "Ayarlar",
  },
  ru: {
    beds: "Койки", bedsShort: "Койки",
    alarms: "Тревоги", alarmsShort: "Тревоги",
    patient: "Пациент",
    admin: "Управление", adminShort: "Управл.",
    settings: "Настройки", settingsShort: "Настр.",
  },
  en: {
    beds: "Beds", bedsShort: "Beds",
    alarms: "Alarms", alarmsShort: "Alarms",
    patient: "Patient",
    admin: "Admin", adminShort: "Admin",
    settings: "Settings", settingsShort: "Settings",
  },
};
