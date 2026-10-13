// The alarm sound and the critical-alarm notification (G1-16: ported from the previous workspace
// before it was deleted). The previous workspace's own texts were the source — clinicalI18n.js
// pr7.soundOn/notifyTitle/notifyBody, pr8.notifyBanner*/testPush* (readable at e4cdf15) — reworded
// in this UI's vocabulary ("siqnal", "cavab gözləyən"), and with two of its claims dropped because
// they were not true: notifications do NOT arrive "when the tab is closed" (there is no push
// service; the page itself raises them), and they are not "with sound and vibration" on a PC.
// A notification raised while the screen is LOCKED names no bed (`notifyBodyLocked`): the lock
// screen shows numbers only, and the operating system's notification is outside it.
// AZ/RU/EN await a native-speaking clinician's review before the pilot.
export default {
  tr: {
    notifyTitle: "Kritik alarm",
    notifyBody: "{bed} — yanıt bekleyen kritik alarm",
    notifyBodyLocked: "Yanıt bekleyen kritik alarm var. Ayrıntı için ekranın kilidini açın.",
    testTitle: "Homunculus · deneme",
    testBody: "Bildirimler çalışıyor. Kritik bir alarm böyle gelir.",
    soundWaiting: "Alarm sesi beklemede — açmak için tıklayın",
  },
  az: {
    notifyTitle: "Kritik siqnal",
    notifyBody: "{bed} — cavab gözləyən kritik siqnal",
    notifyBodyLocked: "Cavab gözləyən kritik siqnal var. Ətraflı məlumat üçün ekranın kilidini açın.",
    testTitle: "Homunculus · yoxlama",
    testBody: "Bildirişlər işləyir. Kritik siqnal belə gəlir.",
    soundWaiting: "Siqnal səsi gözləmədədir — açmaq üçün klikləyin",
  },
  ru: {
    notifyTitle: "Критическая тревога",
    notifyBody: "Койка {bed}: критическая тревога ждёт ответа",
    notifyBodyLocked: "Критическая тревога ждёт ответа. Разблокируйте экран, чтобы увидеть подробности.",
    testTitle: "Homunculus · проверка",
    testBody: "Уведомления работают. Так придёт критическая тревога.",
    soundWaiting: "Звук тревоги ожидает — нажмите, чтобы включить",
  },
  en: {
    notifyTitle: "Critical alarm",
    notifyBody: "{bed} — critical alarm awaiting a response",
    notifyBodyLocked: "A critical alarm is awaiting a response. Unlock the screen for details.",
    testTitle: "Homunculus · test",
    testBody: "Notifications are working. A critical alarm will arrive like this.",
    soundWaiting: "Alarm sound is waiting — click to turn it on",
  },
};
