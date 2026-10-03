// NEWS2 on the bed card (used from G1-09). TR is the old ClinicalDemo's wording (News2Pill and
// NEWS2_MISSING_LABEL), which existed in Turkish only — roadmap "Dalga 0'dan açık kalanlar" -> G1-06.
// noEngine's AZ/RU/EN extend clinicalI18n's pr6.news2NoEngine with the sentence they lacked; the
// rest is new and awaits review by a native-speaking clinician. missing.* keys are the engine's
// parameter names (news2.missing[]).
export default {
  tr: {
    noEngine: "Motor bu hasta için NEWS2 göndermiyor — ekran kendi hesabını yapmaz. Ölçülmeyen parametreyi 0 sayan bir skor, hastayı olduğundan iyi gösterir.",
    partialHint: "Kısmi skor — {missing} ölçülmedi; gerçek toplam daha yüksek olabilir.",
    partialMark: "kısmi skor",
    missing: { respiration_rate: "solunum hızı", spo2: "SpO2", systolic_bp: "sistolik TA", pulse: "nabız", temperature: "ateş" },
  },
  az: {
    noEngine: "Mühərrik bu xəstə üçün NEWS2 göndərmir — ekran öz hesabını aparmır. Ölçülməyən parametri 0 sayan bal xəstəni olduğundan yaxşı göstərir.",
    partialHint: "Qismən bal — {missing} ölçülməyib; həqiqi cəm daha yüksək ola bilər.",
    partialMark: "qismən bal",
    missing: { respiration_rate: "tənəffüs tezliyi", spo2: "SpO2", systolic_bp: "sistolik AT", pulse: "nəbz", temperature: "temperatur" },
  },
  ru: {
    noEngine: "Движок не передаёт NEWS2 для этого пациента — экран не считает его сам. Балл, в котором неизмеренный параметр считается нулём, показывает пациента лучше, чем он есть.",
    partialHint: "Неполный балл — не измерено: {missing}; истинная сумма может быть выше.",
    partialMark: "неполный балл",
    missing: { respiration_rate: "частота дыхания", spo2: "SpO2", systolic_bp: "систолическое АД", pulse: "пульс", temperature: "температура" },
  },
  en: {
    noEngine: "The engine sends no NEWS2 for this patient — the screen does not score it itself. A score that counts an unmeasured parameter as 0 shows the patient better than they are.",
    partialHint: "Partial score — {missing} not measured; the true total may be higher.",
    partialMark: "partial score",
    missing: { respiration_rate: "respiratory rate", spo2: "SpO2", systolic_bp: "systolic BP", pulse: "pulse", temperature: "temperature" },
  },
};
