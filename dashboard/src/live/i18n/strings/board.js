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
// Russian-reading clinician meets a Turkish sentence and is owed an explanation of why. Since the
// G2-B1a walk (I-1) the engine writes that prose only for a blind board: the grant keys no card
// matched come as data and `scopeUnmatched` says them, each named from the structure.
//
// `ch*` are the names of the engine's own signals; `Isı` is deliberately NOT the word the
// prototype's dictionary carries for temperature (that entry resolves to "heat map" — an
// unrelated screen's title), so this file writes it out.
//
// The last six keys came here for the same reason the unit names did, and were missed when the
// units moved: `identityPending` and `news2*` were `beds.*` and `escalated`/`escalatedHelp` were
// `alarms.*`, yet the patient screen — built on its own branch — names a patient, draws the score
// and shows the escalation flag too, so on that branch each of them would have rendered the raw
// key with nothing failing (`escalated` had no test on any branch at all). `identityPending` is
// the wall board's rule ("kimlik bekleniyor", clinicalI18n.pr14): say what is missing rather than
// print the device's raw patient number as a name. `news2*` are the label of the score and the two
// facts the engine can send about it; they extend `strings/news2.js`, which is a SEPARATE
// top-level namespace (`news2.noEngine`, `news2.partialHint`, `news2.missing.*`) — see the note on
// `News2` in screens/common/BoardState.jsx. `escalatedHelp` says what the prototype pretended:
// there is no 3 / 5 / 10-minute ladder behind the live API, only the engine's own flag.
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
    // G2-B1a walk I-1: the grant keys no card matched, named from the structure (`names`).
    scopeUnmatched: "Kapsamınızdaki şu birim ve yatakların panoda kartı yok: {names} — gerçekten boş olabilirler ya da yatak eşlemesi tutmuyor olabilir.",
    silent: "Sessiz yatak: {count}",
    feedOk: "Bütün yataklardan veri geliyor",
    feedTitle: "Cihaz ve veri akışı",
    oldest: "En eski ölçüm: {time}",
    neverMeasured: "Hiç ölçülmemiş yatak: {count}",
    measuredAt: "Son ölçüm: {time}",
    notMeasured: "Ölçülmedi",
    findingUnnamed: "Motorun adlandırmadığı bulgu",
    ageS: "{count} sn",
    ageM: "{count} dk",
    ageH: "{count} sa",
    unitBpm: "/dk",
    unitPct: "%",
    unitMmhg: "mmHg",
    unitC: "°C",
    unitMmol: "mmol/L",
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
    identityPending: "kimlik bekleniyor",
    news2: "NEWS2",
    news2Partial: "kısmi",
    news2Red: "Bir parametre 3 puan aldı",
    escalated: "Eskale edildi",
    escalatedHelp: "Eskalasyonu motor yürütür; ekran yalnız motorun bildirdiği durumu gösterir.",
  },
  az: {
    connecting: "Panel yüklənir…",
    degraded: "Canlı axın kəsildi — ekrandakı məlumatlar son alınanlardır və güncəl olmaya bilər.",
    unavailable: "Serverlə bağlantı yoxdur — xəstə siyahısı göstərilmir. Bu ekran xəstə olmadığı anlamına GƏLMİR.",
    hidden: "Əhatənizdən kənarda qalan kart: {count}.",
    unresolved: "Bunlardan {count} ədədi heç bir çarpayıya uyğun gəlmir.",
    scopeNoteLang: "Bu cümləni server yazıb; dili türkcədir.",
    scopeUnmatched: "Əhatənizdəki bu şöbə və çarpayıların paneldə kartı yoxdur: {names} — həqiqətən boş ola bilərlər, ya da çarpayı uyğunlaşdırması tutmur.",
    silent: "Səssiz çarpayı: {count}",
    feedOk: "Bütün çarpayılardan məlumat gəlir",
    feedTitle: "Cihaz və məlumat axını",
    oldest: "Ən köhnə ölçmə: {time}",
    neverMeasured: "Heç ölçülməmiş çarpayı: {count}",
    measuredAt: "Son ölçmə: {time}",
    notMeasured: "Ölçülməyib",
    findingUnnamed: "Mühərrikin adlandırmadığı tapıntı",
    ageS: "{count} san",
    ageM: "{count} dəq",
    ageH: "{count} saat",
    unitBpm: "/dəq",
    unitPct: "%",
    unitMmhg: "mmHg",
    unitC: "°C",
    unitMmol: "mmol/L",
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
    identityPending: "kimlik gözlənilir",
    news2: "NEWS2",
    news2Partial: "qismən",
    news2Red: "Bir parametr 3 bal alıb",
    escalated: "Eskalasiya edilib",
    escalatedHelp: "Eskalasiyanı mühərrik yürüdür; ekran yalnız mühərrikin bildirdiyi vəziyyəti göstərir.",
  },
  ru: {
    connecting: "Панель загружается…",
    degraded: "Прямой поток прерван — на экране последние полученные данные, они могут быть неактуальны.",
    unavailable: "Нет связи с сервером — список пациентов не показывается. Этот экран НЕ ЗНАЧИТ, что пациентов нет.",
    hidden: "Карточек вне вашей области доступа: {count}.",
    unresolved: "Из них не сопоставлено ни с одной койкой: {count}.",
    scopeNoteLang: "Эту фразу написал сервер; она на турецком языке.",
    scopeUnmatched: "У этих отделений и коек из вашей области на панели нет карточек: {names} — возможно, они действительно пусты или не совпадает сопоставление коек.",
    silent: "Молчащих коек: {count}",
    feedOk: "Данные поступают со всех коек",
    feedTitle: "Устройства и поток данных",
    oldest: "Самое старое измерение: {time}",
    neverMeasured: "Коек без измерений: {count}",
    measuredAt: "Последнее измерение: {time}",
    notMeasured: "Не измерено",
    findingUnnamed: "Находка без названия от системы",
    ageS: "{count} с",
    ageM: "{count} мин",
    ageH: "{count} ч",
    unitBpm: "/мин",
    unitPct: "%",
    // Russian writes these two out rather than keeping the Latin symbol, which is what the beds
    // arm's own dictionary had before the units moved here — worth carrying over: a Russian-reading
    // clinician meets the unit they would write on a chart.
    unitMmhg: "мм рт. ст.",
    unitC: "°C",
    unitMmol: "ммоль/л",
    chHr: "Пульс",
    chSpo2: "SpO2",
    chSbp: "Систолическое АД",
    chMap: "СрАД",
    chTemp: "Температура тела",
    chRr: "Дыхание",
    chLac: "Лактат",
    srcMonitor: "монитор",
    srcVent: "вентилятор",
    srcRr: "вентилятор или монитор",
    srcLab: "лаборатория",
    chronicExpected: "Ожидаемо для собственной нормы пациента",
    engineEnglish: "Тексты системы — на английском; они не переведены.",
    identityPending: "ожидается идентификация",
    news2: "NEWS2",
    news2Partial: "неполный",
    news2Red: "Один параметр получил 3 балла",
    escalated: "Эскалировано",
    escalatedHelp: "Эскалацию ведёт система; экран показывает только то состояние, о котором она сообщила.",
  },
  en: {
    connecting: "Loading the board…",
    degraded: "The live stream was lost — what is on screen is the last data received and may be out of date.",
    unavailable: "No connection to the server — the patient list is not shown. This screen DOES NOT MEAN there are no patients.",
    hidden: "Cards outside your scope: {count}.",
    unresolved: "Of those, {count} match no bed at all.",
    scopeNoteLang: "The server wrote this sentence; it is in Turkish.",
    scopeUnmatched: "These units and beds in your scope have no card on the board: {names} — they may really be empty, or the bed mapping does not match.",
    silent: "Silent beds: {count}",
    feedOk: "Data is arriving from every bed",
    feedTitle: "Devices and the data feed",
    oldest: "Oldest measurement: {time}",
    neverMeasured: "Beds never measured: {count}",
    measuredAt: "Last measured: {time}",
    notMeasured: "Not measured",
    findingUnnamed: "A finding the engine did not name",
    ageS: "{count} s",
    ageM: "{count} min",
    ageH: "{count} h",
    unitBpm: "/min",
    unitPct: "%",
    unitMmhg: "mmHg",
    unitC: "°C",
    unitMmol: "mmol/L",
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
    identityPending: "identity pending",
    news2: "NEWS2",
    news2Partial: "partial",
    news2Red: "One parameter scored 3",
    escalated: "Escalated",
    escalatedHelp: "The engine runs the escalation; this screen shows only the state the engine reported.",
  },
};
