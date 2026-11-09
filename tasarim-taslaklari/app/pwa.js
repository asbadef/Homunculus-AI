/* Homunculus · PWA ve telefona bildirim (24.09, 3. oturum · Ozan #8 kararı, #89).
 * Karar: telefona bildirim AKTİF, web'den gider. Kişi uygulamayı ana ekrana ekler (PWA) ve bildirim izni verir.
 *   - Yalnız KRİTİK alarm telefona düşer. İçerik: "REA01 · kritik · uygulamayı açın" — hasta adı YOK (kilit ekranında görünür).
 *   - Bu prototipte bildirim tarayıcının kendisinden gösterilir (izin verilen cihazda gerçekten çıkar).
 *     Gerçek üründe gönderimi sunucu yapar (Web Push); sunucu tarafı bu turun dışında — yönetim notunda yazıyor.
 * Dışa: H.pwa = { status(), install(), ask(), test(), html() } — Ayarlar → Bildirimler bunu kullanır. */
(function () {
  const H = window.H;
  H.addT({
    pw_title:{ AZ:"Telefona bildiriş", TR:"Telefona bildirim", RU:"Уведомления на телефон", EN:"Phone notifications" },
    pw_sub:{ AZ:"Yalnız kritik həyəcan · xəstə adı olmadan", TR:"Yalnız kritik alarm · hasta adı olmadan", RU:"Только критические тревоги · без имени пациента", EN:"Critical alarms only · no patient name" },
    pw_s1:{ AZ:"Ana ekrana əlavə et", TR:"Ana ekrana ekle", RU:"Добавить на главный экран", EN:"Add to home screen" },
    pw_s2:{ AZ:"Bildirişə icazə ver", TR:"Bildirimlere izin ver", RU:"Разрешить уведомления", EN:"Allow notifications" },
    pw_s3:{ AZ:"Sınaq bildirişi göndər", TR:"Deneme bildirimi gönder", RU:"Отправить тестовое", EN:"Send a test" },
    pw_ok:{ AZ:"Aktiv", TR:"Aktif", RU:"Включено", EN:"On" },
    pw_denied:{ AZ:"İcazə verilməyib · brauzer ayarlarından açın", TR:"İzin verilmedi · tarayıcı ayarlarından açın", RU:"Запрещено · включите в настройках браузера", EN:"Blocked · enable it in browser settings" },
    pw_ios:{ AZ:"iPhone: Safari → Paylaş → “Ana ekrana əlavə et”", TR:"iPhone: Safari → Paylaş → “Ana Ekrana Ekle”", RU:"iPhone: Safari → Поделиться → «На экран Домой»", EN:"iPhone: Safari → Share → “Add to Home Screen”" },
    pw_android:{ AZ:"Android: Chrome → ⋮ menyu → “Ana ekrana əlavə et”", TR:"Android: Chrome → ⋮ menü → “Ana ekrana ekle”", RU:"Android: Chrome → меню ⋮ → «Добавить на главный экран»", EN:"Android: Chrome → ⋮ menu → “Add to Home screen”" },
    pw_installed:{ AZ:"Ana ekrandadır", TR:"Ana ekranda", RU:"На главном экране", EN:"On home screen" },
    pw_test_body:{ AZ:"kritik · tətbiqi açın", TR:"kritik · uygulamayı açın", RU:"критично · откройте приложение", EN:"critical · open the app" },
  });
  let deferred = null, reg = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").then(r => { reg = r; }).catch(() => {});
  const standalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const perm = () => ("Notification" in window) ? Notification.permission : "unsupported";
  async function show(title, body, tag) {
    if (perm() !== "granted") return false;
    const r = reg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
    const opt = { body, tag, renotify:true, requireInteraction:true, icon:"icon.svg", badge:"icon.svg" };
    if (r) await r.showNotification(title, opt); else new Notification(title, opt);
    return true;
  }
  H.pwa = {
    status:() => ({ installed:standalone(), perm:perm(), canInstall:!!deferred }),
    async install() { if (!deferred) return false; deferred.prompt(); const c = await deferred.userChoice; deferred = null; H.log("Ana ekrana ekleme", c.outcome); return c.outcome === "accepted"; },
    async ask() { if (perm() === "unsupported") return "unsupported"; const p = await Notification.requestPermission(); H.log("Bildirim izni", p); return p; },
    test() { const a = H.openAlarms ? H.openAlarms().find(x => x.sev === "crit") : null, bed = a ? H.bed(H.pt(a.pid).bed).no : "REA01";
      return show(`${bed} · ${H.t("pw_test_body")}`, "Homunculus", "hmc-test"); },
    // Kritik alarm açılınca (yalnız izin verilmiş ve sekme arka plandaysa) — gerçek üründe bu işi sunucu yapar.
    critical(a) { if (!document.hidden) return; const bed = H.bed(H.pt(a.pid).bed).no; return show(`${bed} · ${H.t("pw_test_body")}`, "Homunculus", "hmc-" + a.id); },
    html() {
      const s = H.pwa.status(), I = H.icon;
      const step = (n, t, done, ctl) => `<div class="pw-st${done ? " done" : ""}"><span class="n">${done ? I("ok") : n}</span><div><b>${t}</b></div><div class="pw-c">${ctl}</div></div>`;
      return `<div class="st-card pw"><h4>${I("bell")} ${H.t("pw_title")} <small class="mute" style="font-weight:600">· ${H.t("pw_sub")}</small></h4>
        ${step(1, H.t("pw_s1"), s.installed, s.installed ? `<span class="pill">${I("ok")}${H.t("pw_installed")}</span>` : s.canInstall ? `<button class="btn sm p" data-pw="install">${I("plus")}${H.t("pw_s1")}</button>` : `<small class="mute">${H.t("pw_android")}<br>${H.t("pw_ios")}</small>`)}
        ${step(2, H.t("pw_s2"), s.perm === "granted", s.perm === "granted" ? `<span class="pill">${I("ok")}${H.t("pw_ok")}</span>` : s.perm === "denied" ? `<small class="tag w">${H.t("pw_denied")}</small>` : `<button class="btn sm p" data-pw="ask">${I("bell")}${H.t("pw_s2")}</button>`)}
        ${step(3, H.t("pw_s3"), false, `<button class="btn sm" data-pw="test"${s.perm === "granted" ? "" : " disabled"}>${I("zap")}${H.t("pw_s3")}</button>`)}
        ${H.adminNote("Gerçek üründe kritik alarm bildirimini sunucu gönderir (Web Push + VAPID anahtarı). Sunucu tarafı henüz yok; bu ekran kullanıcı tarafını tamamlar.", "div")}</div>`;
    },
  };
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pw]"); if (!b) return;
    const k = b.dataset.pw;
    if (k === "install") await H.pwa.install();
    if (k === "ask") { const p = await H.pwa.ask(); H.toast(p === "granted" ? H.t("pw_ok") : H.t("pw_denied"), p === "granted" ? "" : "w"); }
    if (k === "test") { const ok = await H.pwa.test(); if (!ok) H.toast(H.t("pw_denied"), "w"); }
    if (H.state.page === "settings") H.renderApp();
  });
})();
