// What every board-reading screen says about its own data before it says anything about a patient:
// the connection, the engine's scope, and whether readings are still arriving.
//
// Sources. `degraded`/`unavailable`/`connecting` carry the sentences of the old workspace's
// `liveConnection.boardView()` — written, never rendered — including its capitalised "DOES NOT
// MEAN": an empty board is the most reassuring screen this system can draw, and it must say when
// it is empty for the wrong reason. The channel names and `silent`/`feedOk` come from the old
// `feedHealth.js` and `clinicalI18n.top` (`feedSilent`, "yatak sessiz"), which existed in four
// languages and was never shown. `measuredAt`/`notMeasured` are new.
//
// `chronicExpected`, `engineEnglish` and `scopeNoteLang` live here, in the shared namespace, and
// not in `beds.js` or `alarms.js`, because the bed card and the alarms row both say them — and
// those two screens are built on separate branches. A string one arm owns and the other reads is a
// merge conflict waiting in a dictionary. `engineEnglish` is the short form, for a row that shows
// only the engine's summary; the patient screen, which shows reasoning, evidence and confidence
// together, says the longer `patient.recoLanguage` instead. `scopeNoteLang` labels the one piece of
// server prose this UI prints verbatim: `scope_note` is written in Turkish by `api/board.py`, so a
// Russian-reading clinician meets a Turkish sentence and is owed an explanation of why.
//
// `ch*` are the names of the engine's own signals; `Isı` is deliberately NOT the word the
// prototype's dictionary carries for temperature (that entry resolves to "heat map" — an
// unrelated screen's title), so this file writes it out.
// AZ/RU/EN await a native-speaking clinician's review before the pilot, except where a line is
// quoted from a four-language source above.
export default {
  tr: {
    connecting: "Pano yükleniyor…",
    degraded: "Canlı akış koptu — ekrandaki veriler son alınanlar ve güncel olmayabilir.",
    unavailable: "Sunucuya bağlantı yok — hasta listesi gösterilmiyor. Bu ekran hasta olmadığı anlamına GELMEZ.",
    hidden: "Kapsamınız dışında kalan kart: {count}.",
    unresolved: "Bunların {count} tanesi hiçbir yatağa eşleşmiyor.",
    scopeNoteLang: "Bu cümleyi sunucu yazdı; dili Türkçedir.",
    silent: "Sessiz yatak: {count}",
    feedOk: "Bütün yataklardan veri geliyor",
    feedTitle: "Cihaz ve veri akışı",
    oldest: "En eski ölçüm: {time}",
    neverMeasured: "Hiç ölçülmemiş yatak: {count}",
    measuredAt: "Son ölçüm: {time}",
    notMeasured: "Ölçülmedi",
    ageS: "{count} sn",
    ageM: "{count} dk",
    ageH: "{count} sa",
    chHr: "Nabız",
    chSpo2: "SpO2",
    chSbp: "Sistolik TA",
    chMap: "MAP",
    chTemp: "Vücut sıcaklığı",
    chRr: "Solunum",
    chLac: "Laktat",
    srcMonitor: "monitör",
    srcVent: "ventilatör",
    srcRr: "ventilatör veya monitör",
    srcLab: "laboratuvar",
    chronicExpected: "Hastanın kendi normaline göre beklenen",
    engineEnglish: "Motorun metinleri İngilizcedir; çevrilmemiştir.",
  },
  az: {
    connecting: "Panel yüklənir…",
    degraded: "Canlı axın kəsildi — ekrandakı məlumatlar son alınanlardır və güncəl olmaya bilər.",
    unavailable: "Serverlə bağlantı yoxdur — xəstə siyahısı göstərilmir. Bu ekran xəstə olmadığı anlamına GƏLMİR.",
    hidden: "Əhatənizdən kənarda qalan kart: {count}.",
    unresolved: "Bunlardan {count} ədədi heç bir çarpayıya uyğun gəlmir.",
    scopeNoteLang: "Bu cümləni server yazıb; dili türkcədir.",
    silent: "Səssiz çarpayı: {count}",
    feedOk: "Bütün çarpayılardan məlumat gəlir",
    feedTitle: "Cihaz və məlumat axını",
    oldest: "Ən köhnə ölçmə: {time}",
    neverMeasured: "Heç ölçülməmiş çarpayı: {count}",
    measuredAt: "Son ölçmə: {time}",
    notMeasured: "Ölçülməyib",
    ageS: "{count} san",
    ageM: "{count} dəq",
    ageH: "{count} saat",
    chHr: "Nəbz",
    chSpo2: "SpO2",
    chSbp: "Sistolik AT",
    chMap: "MAP",
    chTemp: "Bədən hərarəti",
    chRr: "Tənəffüs",
    chLac: "Laktat",
    srcMonitor: "monitor",
    srcVent: "ventilyator",
    srcRr: "ventilyator və ya monitor",
    srcLab: "laboratoriya",
    chronicExpected: "Xəstənin öz normasına görə gözlənilən",
    engineEnglish: "Mühərrikin mətnləri İngiliscədir; tərcümə olunmayıb.",
  },
  ru: {
    connecting: "Панель загружается…",
    degraded: "Прямой поток прерван — на экране последние полученные данные, они могут быть неактуальны.",
    unavailable: "Нет связи с сервером — список пациентов не показывается. Этот экран НЕ ЗНАЧИТ, что пациентов нет.",
    hidden: "Карточек вне вашей области доступа: {count}.",
    unresolved: "Из них не сопоставлено ни с одной койкой: {count}.",
    scopeNoteLang: "Эту фразу написал сервер; она на турецком языке.",
    silent: "Молчащих коек: {count}",
    feedOk: "Данные поступают со всех коек",
    feedTitle: "Устройства и поток данных",
    oldest: "Самое старое измерение: {time}",
    neverMeasured: "Коек без измерений: {count}",
    measuredAt: "Последнее измерение: {time}",
    notMeasured: "Не измерено",
    ageS: "{count} с",
    ageM: "{count} мин",
    ageH: "{count} ч",
    chHr: "Пульс",
    chSpo2: "SpO2",
    chSbp: "Систолическое АД",
    chMap: "САД",
    chTemp: "Температура тела",
    chRr: "Дыхание",
    chLac: "Лактат",
    srcMonitor: "монитор",
    srcVent: "вентилятор",
    srcRr: "вентилятор или монитор",
    srcLab: "лаборатория",
    chronicExpected: "Ожидаемо для собственной нормы пациента",
    engineEnglish: "Тексты системы — на английском; они не переведены.",
  },
  en: {
    connecting: "Loading the board…",
    degraded: "The live stream was lost — what is on screen is the last data received and may be out of date.",
    unavailable: "No connection to the server — the patient list is not shown. This screen DOES NOT MEAN there are no patients.",
    hidden: "Cards outside your scope: {count}.",
    unresolved: "Of those, {count} match no bed at all.",
    scopeNoteLang: "The server wrote this sentence; it is in Turkish.",
    silent: "Silent beds: {count}",
    feedOk: "Data is arriving from every bed",
    feedTitle: "Devices and the data feed",
    oldest: "Oldest measurement: {time}",
    neverMeasured: "Beds never measured: {count}",
    measuredAt: "Last measured: {time}",
    notMeasured: "Not measured",
    ageS: "{count} s",
    ageM: "{count} min",
    ageH: "{count} h",
    chHr: "Pulse",
    chSpo2: "SpO2",
    chSbp: "Systolic BP",
    chMap: "MAP",
    chTemp: "Body temperature",
    chRr: "Respiration",
    chLac: "Lactate",
    srcMonitor: "monitor",
    srcVent: "ventilator",
    srcRr: "ventilator or monitor",
    srcLab: "laboratory",
    chronicExpected: "Expected for this patient's own normal",
    engineEnglish: "The engine's texts are in English; they are not translated.",
  },
};
