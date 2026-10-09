// Engine risk levels, as riskStyle.js labels them.
// critical/high/moderate/low/info: the prototype's dictionary (grafik.js gd_k_crit/gd_k_high,
// devices.js dev_pri_dusuk, ceviri-sozluk "ORTA", mobil.js mt_info).
// none/unmeasured/unknown/unreported are new (roadmap G1-09: "bulgu yok / ölçülmedi"; unreported:
// the engine sent no risk at all); their AZ/RU/EN await review by a native-speaking clinician.
// RU none says "no deviations found", not "Без отклонений" ("within normal limits"): "none" means
// the engine raised no alert, which is not a claim that every value is normal.
export default {
  tr: {
    prefix: "Risk",
    critical: "Kritik", high: "Yüksek", moderate: "Orta", low: "Düşük", info: "Bilgi",
    none: "Bulgu yok", unmeasured: "Ölçülmedi", unknown: "Tanımsız risk: {value}",
    unreported: "Risk bildirilmedi",
  },
  az: {
    prefix: "Risk",
    critical: "Kritik", high: "Yüksək", moderate: "Orta", low: "Aşağı", info: "Məlumat",
    none: "Tapıntı yoxdur", unmeasured: "Ölçülməyib", unknown: "Naməlum risk: {value}",
    unreported: "Risk bildirilməyib",
  },
  ru: {
    prefix: "Риск",
    critical: "Критический", high: "Высокий", moderate: "Средний", low: "Низкий", info: "Инфо",
    none: "Отклонений не выявлено", unmeasured: "Не измерено", unknown: "Неизвестный риск: {value}",
    unreported: "Риск не передан",
  },
  en: {
    prefix: "Risk",
    critical: "Critical", high: "High", moderate: "Moderate", low: "Low", info: "Info",
    none: "No finding", unmeasured: "Not measured", unknown: "Unknown risk: {value}",
    unreported: "Risk not reported",
  },
};
