// NEWS2 on the bed card (used from G1-09). TR is the old ClinicalDemo's wording (News2Pill and
// NEWS2_MISSING_LABEL), which existed in Turkish only — roadmap "Dalga 0'dan açık kalanlar" -> G1-06.
// noEngine's AZ/RU/EN extend clinicalI18n's pr6.news2NoEngine with the sentence they lacked (RU
// says "Система" where the old text said "Движок": jargon a clinician reads as a car engine); the
// rest is new and awaits review by a native-speaking clinician. missing.* keys are the engine's
// parameter names (news2.missing[]).
// G2-A2 (D10): staleMark … assumed.* say what the engine left out of the total (news2.stale[],
// named with missing.*) and what it scored as room air and Alert (news2.assumed[]). TR is the
// owner's wording («varsayıldı», "son kayıt {age}"); AZ/RU/EN await a native reading.
// G2-A2 X11: assumedLastValue and chartedOxygen.* name what an expired chart last read
// (news2.last_charted: oxygen 1/0, consciousness its ACVPU letter, printed as sent) —
// «varsayıldı: oda havası (son kayıt: oksijende, 8 sa önce)». TR as the review wrote it.
export default {
  tr: {
    noEngine: "Motor bu hasta için NEWS2 göndermiyor — ekran kendi hesabını yapmaz. Ölçülmeyen parametreyi 0 sayan bir skor, hastayı olduğundan iyi gösterir.",
    partialHint: "Kısmi skor — {missing} ölçülmedi; gerçek toplam daha yüksek olabilir.",
    partialMark: "kısmi skor",
    missing: { respiration_rate: "solunum hızı", spo2: "SpO2", systolic_bp: "sistolik TA", pulse: "nabız", temperature: "ateş" },
    staleMark: "eski veri",
    staleHint: "Penceresini aşan ölçüm skora girmez; gerçek toplam daha yüksek olabilir.",
    assumedMark: "varsayıldı",
    assumedHint: "Güncel kayıt yok; skor bu girdiyi varsayılan değerle hesapladı ve bunu kısmi saymaz.",
    assumedNever: "hiç kaydedilmedi",
    assumedLast: "son kayıt {age}",
    assumedLastValue: "son kayıt: {value}, {age}",
    assumed: { air_or_oxygen: "oda havası", consciousness: "uyanık" },
    chartedOxygen: { air: "oda havası", oxygen: "oksijende" },
  },
  az: {
    noEngine: "Mühərrik bu xəstə üçün NEWS2 göndərmir — ekran öz hesabını aparmır. Ölçülməyən parametri 0 sayan bal xəstəni olduğundan yaxşı göstərir.",
    partialHint: "Qismən bal — {missing} ölçülməyib; həqiqi cəm daha yüksək ola bilər.",
    partialMark: "qismən bal",
    missing: { respiration_rate: "tənəffüs tezliyi", spo2: "SpO2", systolic_bp: "sistolik AT", pulse: "nəbz", temperature: "temperatur" },
    staleMark: "köhnə məlumat",
    staleHint: "Pəncərəsini keçmiş ölçmə bala daxil edilmir; həqiqi cəm daha yüksək ola bilər.",
    assumedMark: "fərz edildi",
    assumedHint: "Cari qeyd yoxdur; bal bu girişi standart dəyərlə hesabladı və bunu qismən saymır.",
    assumedNever: "heç qeyd edilməyib",
    assumedLast: "son qeyd {age}",
    assumedLastValue: "son qeyd: {value}, {age}",
    assumed: { air_or_oxygen: "otaq havası", consciousness: "oyaq" },
    chartedOxygen: { air: "otaq havası", oxygen: "oksigendə" },
  },
  ru: {
    noEngine: "Система не передаёт NEWS2 для этого пациента — экран не считает его сам. Балл, в котором неизмеренный параметр считается нулём, показывает пациента лучше, чем он есть.",
    partialHint: "Неполный балл — не измерено: {missing}; истинная сумма может быть выше.",
    partialMark: "неполный балл",
    missing: { respiration_rate: "частота дыхания", spo2: "SpO2", systolic_bp: "систолическое АД", pulse: "пульс", temperature: "температура" },
    staleMark: "устаревшие данные",
    staleHint: "Измерение старше своего окна в балл не входит; истинная сумма может быть выше.",
    assumedMark: "по умолчанию",
    assumedHint: "Текущей записи нет; балл учёл значение по умолчанию и не считает себя из-за этого неполным.",
    assumedNever: "не записывалось",
    assumedLast: "последняя запись {age}",
    assumedLastValue: "последняя запись: {value}, {age}",
    assumed: { air_or_oxygen: "комнатный воздух", consciousness: "в сознании" },
    chartedOxygen: { air: "комнатный воздух", oxygen: "на кислороде" },
  },
  en: {
    noEngine: "The engine sends no NEWS2 for this patient — the screen does not score it itself. A score that counts an unmeasured parameter as 0 shows the patient better than they are.",
    partialHint: "Partial score — {missing} not measured; the true total may be higher.",
    partialMark: "partial score",
    missing: { respiration_rate: "respiratory rate", spo2: "SpO2", systolic_bp: "systolic BP", pulse: "pulse", temperature: "temperature" },
    staleMark: "stale",
    staleHint: "A reading older than its window is left out of the score; the true total may be higher.",
    assumedMark: "assumed",
    assumedHint: "Nothing current is charted; the score used the default and does not count that as partial.",
    assumedNever: "never charted",
    assumedLast: "last charted {age}",
    assumedLastValue: "last charted: {value}, {age}",
    assumed: { air_or_oxygen: "room air", consciousness: "alert" },
    chartedOxygen: { air: "room air", oxygen: "on oxygen" },
  },
};
