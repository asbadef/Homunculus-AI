// src/alarmDensity.js — alarm yoğunluğu: hangi yatak, hangi saat.
//
// Eski ısı haritası "şu an kim kötü" diyordu; yatak paneli bunu zaten söylüyor ve daha fazlasını
// söylüyordu. Yönetici için değerli olan soru başka: **alarm nerede birikiyor.** Sürekli öten bir
// yatak iki şeyden birini anlatır — ya eşik o hastaya göre yanlış (bkz. hastanın kendi normali),
// ya da hasta gerçekten kötüleşiyor ve kimse yeterince müdahale etmiyor. İkisi de yöneticinin
// işidir ve ikisi de anlık bir renkte görünmez, yalnız zaman içinde görünür.
//
// Kaynak **denetim kaydıdır**, canlı durum değil: yeniden başlatma yoğunluğu sıfırlamaz, ve
// alarmın doğduğu an kalıcı olarak kayıtlıdır. Canlı kurulumda kayıt motordan gelir
// (`liveStore.refreshAudit`), simülasyonda kendi kaydından.
//
// ⚠️ Denetim kaydında alarm doğuşu yoksa bu panel **boş grafik çizmez**: "bu kurulumda alarm
// geçmişi okunamıyor" der. Sıfır dolu bir ısı haritası, sakin bir koğuş gibi görünür.

/** Denetim kaydında bir alarmın doğduğunu gösteren eylemler. */
export const FIRE_ACTIONS = ["ALERT_AUTO_FIRE", "ALERT_FIRE"];

/**
 * Kaydın hangi yatağa ait olduğu.
 *
 * Yeni kayıtlar `bedLabel` alanını taşır. Eskilerde yalnız serbest metin var ("101 · CRITICAL ·
 * SpO2"); ilk parça yatak etiketidir. Ayrıştırılamayan kayıt **atılmaz**, "—" kovasına düşer:
 * sayılmayan bir alarm, olmamış bir alarm gibi görünür.
 */
export function bedOf(entry) {
  if (entry?.bedLabel) return String(entry.bedLabel);
  const first = String(entry?.detail || "").split("·")[0].trim();
  return first || "—";
}

/**
 * Son `hours` saatin yatak × saat yoğunluğu.
 *
 * Dönen `hoursAxis` en eskiden en yeniye sıralıdır ve her biri bir saat dilimini temsil eder;
 * `cells[i]` o dilimde o yatakta doğan alarm sayısıdır.
 */
export function alarmDensity(auditLog = [], { hours = 24, now = Date.now() } = {}) {
  const fires = (auditLog || []).filter((e) => FIRE_ACTIONS.includes(e?.action) && typeof e?.atMs === "number");
  const since = now - hours * 3600_000;
  const inWindow = fires.filter((e) => e.atMs >= since);

  const hourStart = (ms) => Math.floor(ms / 3600_000);
  const lastHour = hourStart(now);
  const hoursAxis = Array.from({ length: hours }, (_, i) => lastHour - (hours - 1 - i));

  const byBed = new Map();
  for (const e of inWindow) {
    const bed = bedOf(e);
    if (!byBed.has(bed)) byBed.set(bed, Array(hours).fill(0));
    const ix = hoursAxis.indexOf(hourStart(e.atMs));
    if (ix >= 0) byBed.get(bed)[ix] += 1;
  }

  const beds = [...byBed.entries()]
    .map(([bed, cells]) => ({ bed, cells, total: cells.reduce((a, c) => a + c, 0) }))
    .sort((a, b) => b.total - a.total || a.bed.localeCompare(b.bed, "tr"));

  const maxCell = beds.reduce((m, b) => Math.max(m, ...b.cells), 0);
  const totalAlarms = beds.reduce((a, b) => a + b.total, 0);

  // En yoğun saat — vardiya tartışmasının sayısal tarafı.
  const perHour = Array(hours).fill(0);
  beds.forEach((b) => b.cells.forEach((c, i) => { perHour[i] += c; }));
  const busiestHourIx = perHour.reduce((best, v, i, arr) => (v > arr[best] ? i : best), 0);

  return {
    hours, hoursAxis, beds, maxCell, totalAlarms,
    busiestBed: beds[0] || null,
    busiestHourIx: totalAlarms > 0 ? busiestHourIx : null,
    hasHistory: fires.length > 0,
  };
}

/** Saat dilimi indeksinden "14:00" etiketi. */
export function hourLabel(hourIndex) {
  const d = new Date(hourIndex * 3600_000);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

/**
 * Yoğunluk → renk yoğunluğu (0…1).
 *
 * Doğrusal değil karekök: bir yatakta 8, diğerlerinde 1 alarm varken doğrusal ölçek diğer her
 * şeyi görünmez yapar, oysa "bir kez ötmüş" ile "hiç ötmemiş" arasındaki fark da bilgidir.
 */
export function intensity(count, maxCell) {
  if (!count || !maxCell) return 0;
  return Math.sqrt(count / maxCell);
}
