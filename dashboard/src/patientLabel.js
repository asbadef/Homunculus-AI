// src/patientLabel.js — hasta kabul barkod etiketi (bileklik / dosya etiketi).
//
// Neden burada: kabul ekranı bir hastayı yatağa alır, ama yatağın başında duran kişi hastayı
// ekrandan değil elindeki etiketten tanır. Pilot hastanenin HBYS'si böyle bir etiket basıyor
// (protokol no + barkod + kimlik + bölüm/doktor/yatak); Homunculus kendi kabulünü yaptığında
// aynı bilgiyi basamıyordu — kabul edilen hastanın fiziksel bir kimliği olmuyordu.
//
// İki kural bu dosyanın biçimini belirledi:
//   1. Uydurma yok. Etikette yalnızca kayıtta GERÇEKTEN olan alan basılır; olmayan alan
//      satırıyla birlikte düşer, "—" diye yazılıp doluymuş gibi durmaz.
//   2. Barkod doğrulanabilir olmalı. Code 128 kodlaması saf fonksiyon olarak yazıldı ve
//      yapısal olarak test edilir (desen sayısı, modül genişlikleri, checksum). Bir barkodun
//      sessizce yanlış olması, hiç basılmamış olmasından kötüdür.

// ---------------------------------------------------------------- Code 128
// Her desen 6 elementtir (bar, boşluk, bar, boşluk, bar, boşluk) ve toplamı 11 modüldür.
// Tek istisna STOP (106): 7 element / 13 modül. Tablo veri olduğu için elle yazılmıştır;
// patientLabel.test.js her satırın modül toplamını ve tablonun benzersizliğini denetler.
export const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
];

export const CODE128_START_B = 104;
export const CODE128_STOP = 106;

/** Code 128 B ile kodlanabilen karakterler: yazdırılabilir ASCII (32–126). */
export function code128Encodable(text) {
  return [...String(text ?? "")].every((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 32 && c <= 126;
  });
}

/**
 * Metni Code 128 B değer dizisine çevirir: [START_B, …veriler, checksum, STOP].
 *
 * Kodlanamayan karakter varsa null döner — zorla kodlanıp tarayıcıda başka bir karaktere
 * dönüşmesindense barkodun hiç basılmaması tercih edilir (bkz. dosya başı, kural 2).
 */
export function code128Values(text) {
  const s = String(text ?? "");
  if (!s || !code128Encodable(s)) return null;
  const data = [...s].map((ch) => ch.charCodeAt(0) - 32);
  let sum = CODE128_START_B;
  data.forEach((v, i) => { sum += v * (i + 1); });
  const check = sum % 103;
  return [CODE128_START_B, ...data, check, CODE128_STOP];
}

/**
 * Barkodu SVG olarak çizer. Modül genişliği ve yükseklik piksel cinsindendir; sessiz alan
 * (quiet zone) her iki yanda 10 modüldür — tarayıcıların okuması için standardın istediği
 * asgari boşluk budur ve etiket kenarına dayanmış bir barkod okunmaz.
 */
export function code128Svg(text, { module = 2, height = 56, quiet = 10 } = {}) {
  const values = code128Values(text);
  if (!values) return null;
  const widths = values.map((v) => CODE128_PATTERNS[v]).join("");
  const total = [...widths].reduce((a, c) => a + Number(c), 0) + quiet * 2;
  let x = quiet, isBar = true, bars = "";
  for (const ch of widths) {
    const w = Number(ch);
    if (isBar) bars += `<rect x="${x}" y="0" width="${w}" height="${height / module}" />`;
    x += w;
    isBar = !isBar;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height / module}" `
    + `width="${total * module}" height="${height}" shape-rendering="crispEdges" `
    + `preserveAspectRatio="none" role="img" aria-label="${escapeHtml(text)}">`
    + `<rect width="${total}" height="${height / module}" fill="#fff"/>`
    + `<g fill="#000">${bars}</g></svg>`;
}

// ---------------------------------------------------------------- etiket içeriği
export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** 1963-10-22 → 22.10.1963. Tarih ayrıştırılamıyorsa null — yanlış tarih basmaktansa boş satır. */
export function formatBirthDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** 16 Eylül 2026 15:02 — etiketin okunduğu dilin ay adıyla. */
export function formatStamp(ms, lang = "tr") {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const locale = { tr: "tr-TR", az: "az-AZ", en: "en-GB", ru: "ru-RU" }[lang] || "tr-TR";
  try {
    return d.toLocaleString(locale, { day: "numeric", month: "long", year: "numeric",
                                      hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toLocaleString();
  }
}

/**
 * Etikette basılacak satırlar — saf fonksiyon, bu yüzden testten okunabilir.
 *
 * Değeri olmayan alan listeye HİÇ girmez. Hastane etiketinde "Doktor: —" yazması, o hastanın
 * sorumlu hekimi yok demek değil; sistemin bilmediği anlamına gelir ve etikette bu ikisi
 * birbirinden ayırt edilemez. Bu yüzden bilinmeyen satır düşürülür.
 */
export function labelLines(patient, { S, unitName, attendingName, lang = "tr" } = {}) {
  if (!patient) return [];
  const P = (S && S.pr19) || {};
  const out = [];
  const push = (label, value) => { if (value != null && String(value).trim() !== "") out.push({ label, value: String(value) }); };
  push(P.labelProtocolNo || "Protokol No", patient.protocolNo);
  push(P.labelPatientNo || "Hasta No", patient.mrn);
  push(P.labelName || "Adı Soyadı", patient.display_name);
  push(P.labelStamp || "Protokol Tarihi", formatStamp(patient.admittedAtMs, lang));
  push(P.labelBirthDate || "Doğum Tarihi", formatBirthDate(patient.birthDate));
  push(P.labelDepartment || "Bölüm", unitName);
  push(P.labelPhysician || "Doktor", attendingName);
  push(P.labelBed || "Yatak", patient.bedLabel);
  return out;
}

/**
 * Etiketin alt şeridi: bileklikten okunduğunda hayat kurtaran üç şey — alerji, izolasyon ve
 * resüsitasyon durumu. Hastane etiketinde bunlar yok; bir yatak başında "DNR" bilgisinin
 * ekranın arkasında kalması bu ürünün çözdüğü türden bir sorundur.
 *
 * Yine aynı kural: yalnızca hekimin/hemşirenin GERÇEKTEN girdiği değer basılır. Alerji kutusu
 * boşsa "alerji yok" yazılmaz — boş kutu "sorulmadı" da demek olabilir.
 */
export function labelSafetyChips(patient, { S } = {}) {
  if (!patient) return [];
  const P = (S && S.pr19) || {};
  const chips = [];
  if (patient.allergies && patient.allergies.trim()) {
    chips.push({ kind: "allergy", text: `${P.allergies || "Alerji"}: ${patient.allergies.trim()}` });
  }
  if (patient.isolation && patient.isolation !== "none") {
    const map = { contact: P.isoContact, droplet: P.isoDroplet, airborne: P.isoAirborne };
    chips.push({ kind: "isolation", text: map[patient.isolation] || patient.isolation });
  }
  if (patient.codeStatus && patient.codeStatus !== "full") {
    const map = { dnr: P.codeDnr, limited: P.codeLimited };
    chips.push({ kind: "code", text: map[patient.codeStatus] || patient.codeStatus });
  }
  if (patient.bloodType && patient.bloodType.trim()) {
    chips.push({ kind: "blood", text: `${P.bloodType || "Kan Grubu"}: ${patient.bloodType}` });
  }
  return chips;
}

/**
 * Etiketi yeni bir pencerede açıp yazdırır.
 *
 * Ad her zaman TAM basılır — ekrandaki isim maskeleme tercihi PHI'nin ekranda görünmesiyle
 * ilgilidir; maskeli basılmış bir bileklik etiketi hiçbir işe yaramaz ve yanlış hasta riskini
 * azaltmaz, artırır. Ekrandaki önizleme maskeli kalır, kâğıt tamdır.
 */
export function printPatientLabel({ S, patient, unitName, attendingName, lang = "tr", win } = {}) {
  if (!patient) return false;
  const w = (win || window).open("", "_blank", "width=520,height=420");
  if (!w) return false;
  const P = (S && S.pr19) || {};
  const lines = labelLines(patient, { S, unitName, attendingName, lang })
    .map(({ label, value }) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  const chips = labelSafetyChips(patient, { S })
    .map((c) => `<span class="chip ${c.kind}">${escapeHtml(c.text)}</span>`)
    .join("");
  const svg = code128Svg(patient.protocolNo || patient.mrn || patient.patient_id || "", { module: 2, height: 62 });
  w.document.write(`<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">
<title>${escapeHtml(P.labelTitle || "Hasta Etiketi")}</title>
<style>
  @page { size: 90mm 55mm; margin: 3mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, Arial, sans-serif; color: #000; margin: 0; padding: 6px 8px; }
  .code { text-align: center; }
  .code svg { width: 100%; height: 56px; }
  .num { text-align: right; font-size: 17px; font-weight: 800; letter-spacing: .04em; margin-top: -2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 3px; }
  th, td { text-align: left; vertical-align: baseline; padding: 1px 0; font-size: 12.5px; }
  th { font-weight: 600; white-space: nowrap; padding-right: 8px; }
  th::after { content: " :"; }
  td { font-weight: 800; }
  .chips { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { border: 1.5px solid #000; border-radius: 3px; padding: 1px 5px; font-size: 10.5px; font-weight: 800; text-transform: uppercase; }
  .chip.allergy, .chip.code { background: #000; color: #fff; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="code">${svg || ""}</div>
<div class="num">${escapeHtml(patient.protocolNo || "")}</div>
<table>${lines}</table>
${chips ? `<div class="chips">${chips}</div>` : ""}
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* yazdırma iptal edilebilir */ } }, 300);
  return true;
}
