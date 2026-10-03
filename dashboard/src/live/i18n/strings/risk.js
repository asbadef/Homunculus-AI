// Engine risk levels, as riskStyle.js labels them.
// critical/high/moderate/low/info: the prototype's dictionary (grafik.js gd_k_crit/gd_k_high,
// devices.js dev_pri_dusuk, ceviri-sozluk "ORTA", mobil.js mt_info).
// none/unmeasured/unknown are new (roadmap G1-09: "bulgu yok / ölçülmedi"); their AZ/RU/EN
// await review by a native-speaking clinician.
export default {
  tr: {
    critical: "Kritik", high: "Yüksek", moderate: "Orta", low: "Düşük", info: "Bilgi",
    none: "Bulgu yok", unmeasured: "Ölçülmedi", unknown: "Tanımsız risk: {value}",
  },
  az: {
    critical: "Kritik", high: "Yüksək", moderate: "Orta", low: "Aşağı", info: "Məlumat",
    none: "Tapıntı yoxdur", unmeasured: "Ölçülməyib", unknown: "Naməlum risk: {value}",
  },
  ru: {
    critical: "Критический", high: "Высокий", moderate: "Средний", low: "Низкий", info: "Инфо",
    none: "Нет находок", unmeasured: "Не измерено", unknown: "Неизвестный риск: {value}",
  },
  en: {
    critical: "Critical", high: "High", moderate: "Moderate", low: "Low", info: "Info",
    none: "No finding", unmeasured: "Not measured", unknown: "Unknown risk: {value}",
  },
};
