// src/rrtQueue.js — hızlı yanıt ekibinin (RRT) iş listesi.
//
// RRT bugüne kadar herkesle aynı alarm ekranına bakıyordu: koğuşun bütün alarmları tek listede,
// ve kendisini ilgilendireni aramak zorundaydı. Oysa RRT'nin işi dar ve nettir — **kendisine
// eskale edilmiş** alarm. Bir alarm ona ulaştığında iki kademe geçilmiş, hemşire ve hekim cevap
// verememiş demektir; onu bir listenin içinde aratmak, eskalasyonun kazandırdığı dakikaları
// geri vermektir.
//
// İki bölüm var ve ikincisi asıl fark: **bana gelenler** ve **yolda olanlar.** Yolda olanlar,
// 10. dakikayı henüz doldurmamış ama cevapsız duran alarmlar. RRT için bu, "iki dakika sonra
// beni arayacaklar" demektir — hazırlanabileceği tek yer burası.
//
// ⚠️ Pilotta üçüncü kademe bilerek kapalı ([[Pilotta Eskalasyon İki Kademe]]): pilot hastanede
// fiilen bir hızlı yanıt ekibi yok, ve gidecek yeri olmayan bir eskalasyon eskalasyon değil,
// sessiz bir arızadır. Kademe kapatılırken kodu silinmedi — bu ekran, RRT'si olan bir kurulumda
// zincirin son durağının nereye düştüğünü gösterir. Ekranın kendisi bunu gizlemez.

import { ESCALATION_STEP, ESCALATION_THRESHOLDS_SEC, TIER } from "./clinicalDemo.js";

const RRT = ESCALATION_STEP.TIER_3_RRT;

/** Yalnız CRITICAL ve HIGH eskale olur; diğerleri hiçbir zaman RRT'ye ulaşmaz. */
const escalates = (alert) => alert?.tier === TIER.CRITICAL || alert?.tier === TIER.HIGH;

/** Alarm RRT'ye ulaştı mı: ya süre dolduğu için, ya elle çağrıldığı için. */
export function reachedRrt(alert) {
  if (!alert) return false;
  if (alert.currentStep === RRT) return true;
  return (alert.events || []).some((e) => e.step === RRT);
}

/** RRT'ye elle mi çağrıldı (hekim/hemşire "RRT'ye eskale et" dedi) yoksa süreyle mi ulaştı. */
export function wasManual(alert) {
  return (alert?.events || []).some((e) => e.step === RRT && e.manual);
}

/**
 * RRT kuyruğu.
 *
 * `open` **en uzun bekleyen önce** sıralıdır: RRT için "en yeni" diye bir öncelik yoktur,
 * cevapsız geçen süre tek ölçüdür. Cevaplanan alarm listeden düşmez, `handled` içinde durur —
 * ekibin bu vardiyada neye baktığı da kayıttır.
 *
 * `incoming` henüz RRT'ye düşmemiş ama cevapsız duran alarmlardır; `etaSec`, 3. kademeye kalan
 * süredir. Tahmin değil, motorun eşiğinden çıkan sayıdır.
 */
export function rrtQueue(state) {
  const alerts = state?.alerts || [];
  const clockSec = state?.clockSec ?? 0;
  const mine = alerts.filter((a) => a.status !== "CLOSED" && reachedRrt(a));

  const decorate = (a) => ({
    alert: a,
    elapsed: Math.max(0, clockSec - (a.firedAtSec ?? clockSec)),
    manual: wasManual(a),
    atRrtSec: (a.events || []).find((e) => e.step === RRT)?.atSec ?? null,
  });

  const open = mine.filter((a) => a.status === "FIRED").map(decorate)
    .sort((x, y) => y.elapsed - x.elapsed);
  const handled = mine.filter((a) => a.status !== "FIRED").map(decorate)
    .sort((x, y) => (y.atRrtSec ?? 0) - (x.atRrtSec ?? 0));

  const incoming = alerts
    .filter((a) => a.status === "FIRED" && escalates(a) && !reachedRrt(a))
    .map((a) => {
      const elapsed = Math.max(0, clockSec - (a.firedAtSec ?? clockSec));
      return { alert: a, elapsed, etaSec: ESCALATION_THRESHOLDS_SEC.TIER_3_RRT - elapsed };
    })
    .filter((x) => x.etaSec > 0)
    .sort((x, y) => x.etaSec - y.etaSec);

  return { open, handled, incoming, total: mine.length };
}
