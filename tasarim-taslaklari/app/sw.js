/* Homunculus · service worker (24.09, 3. oturum · Ozan #89: telefona bildirim web'den, PWA).
 * Şimdilik yalnız bildirim işi: sunucudan gelen "push" mesajını gösterir, tıklanınca uygulamayı öne getirir.
 * Önbellek YOK: klinik ekran bayat veri göstermesin. Bildirim içeriğinde hasta adı yoktur (yatak no + öncelik). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title:e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Homunculus", {
    body:d.body || "", tag:d.tag || "hmc", renotify:true, requireInteraction:d.sev === "crit", icon:"icon.svg", badge:"icon.svg", data:{ url:d.url || "./" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type:"window", includeUncontrolled:true }).then((cs) => {
    for (const c of cs) if ("focus" in c) return c.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./");
  }));
});
