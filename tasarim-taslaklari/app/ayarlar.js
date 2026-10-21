/* Homunculus prototip · Ayarlar + Profil (24.09, 3. oturum · Ozan #27, #71).
 * MedRapor'un ayar düzeni örnek alındı: solda kişi kartı + dikey sekmeler, sağda içerik (kendi içinde kayar).
 * "profile" adresi de buraya düşer (Profil sekmesi). Kişisel tercihler yalnız bu tarayıcıda saklanır.
 * Klinik güvenlik kuralı: kritik alarm bildirimi kişi tarafından kapatılamaz; ekran kilidi hastanenin üst sınırını aşamaz. */
(function () {
  const H = window.H, I = H.icon, esc = H.esc;
  H.addT({
    st_look:{ AZ:"Görünüş", TR:"Görünüm", RU:"Вид", EN:"Appearance" },
    st_profile:{ AZ:"Profil", TR:"Profil", RU:"Профиль", EN:"Profile" },
    st_security:{ AZ:"Təhlükəsizlik", TR:"Güvenlik", RU:"Безопасность", EN:"Security" },
    st_notif:{ AZ:"Bildirişlər", TR:"Bildirimler", RU:"Уведомления", EN:"Notifications" },
    st_sound:{ AZ:"Monitor səsi", TR:"Monitör sesi", RU:"Звук монитора", EN:"Monitor sound" },
    st_perms:{ AZ:"İcazələr", TR:"İzinler", RU:"Разрешения", EN:"Permissions" },
    st_keys:{ AZ:"Qısayollar", TR:"Kısayollar", RU:"Горячие клавиши", EN:"Shortcuts" },
    st_help:{ AZ:"Kömək və hüquqi", TR:"Yardım ve yasal", RU:"Помощь и правовое", EN:"Help & legal" },
    st_sub:{ AZ:"Yalnız sizin ekranınıza təsir edir.", TR:"Yalnız sizin ekranınızı etkiler.", RU:"Влияет только на ваш экран.", EN:"Affects only your screen." },
  });
  const TABS = [["look", "globe", "st_look"], ["profile", "key", "st_profile"], ["security", "lock", "st_security"], ["notif", "bell", "st_notif"], ["sound", "activity", "st_sound"], ["perms", "shield", "st_perms"], ["keys", "grid", "st_keys"], ["help", "file", "st_help"]];
  const pref = (k, d) => { try { const v = localStorage.getItem("hmc." + k); return v == null ? d : v; } catch { return d; } };
  const seg = (k, opts, cur) => `<div class="seg" data-pref="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const row = (title, sub, ctl) => `<div class="st-row"><div><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</div><div class="st-ctl">${ctl}</div></div>`;
  const sw = (k, on, dis) => `<label class="st-sw${dis ? " dis" : ""}"><input type="checkbox" data-sw="${k}"${on ? " checked" : ""}${dis ? " disabled" : ""}><span></span></label>`;
  const initials = (u) => u.name.replace(/^(Dr\.|Ecz\.)\s*/, "").split(" ").map(s => s[0]).slice(0, 2).join("");

  const PANES = {
    look(u) {
      const langLocked = H.settings && H.settings.userLangChange === "hayir";
      return `<h3>${H.t("st_look")}</h3>
        ${row("Dil", langLocked ? "Dil hastane tarafından belirlenmiş." : "Menü, düğme ve başlıklar seçilen dilde görünür.", langLocked ? `<span class="pill">${H.state.lang}</span>` :
          `<div class="st-langs">${H.LANGS.map(([k, n]) => `<button class="${H.state.lang === k ? "on" : ""}" data-lang="${k}">${H.flagBox(k)}<span><b>${k}</b><small>${n}</small></span></button>`).join("")}</div>`)}
        ${row("Tema", "Gece: karanlık yoğun bakım salonu için. Gün ışığı: aydınlık ortam için.", seg("theme", [["gece", `${I("moon")} Gece`], ["gun", `${I("sun")} Gün ışığı`]], H.state.theme))}
        ${row("Yazı boyu", "Büyük: duvar ekranı ya da uzaktan okuma için.", seg("size", [["normal", "Normal"], ["buyuk", "Büyük"]], H.state.size))}
        ${row("Yatak paneli", "Büyük serviste liste daha çok yatağı tek ekranda gösterir.", seg("bedView", [["kart", "Kart"], ["liste", "Liste"]], H.state.bedView))}
        <p class="st-note">Vardiya devrinde herkes aynı düzeni görsün diye başka yerleşim ayarı yoktur.</p>`;
    },
    profile(u) {
      const r = H.data.roles[u.role], units = (u.units || []).map(H.unit).filter(Boolean);
      return `<h3>${H.t("st_profile")}</h3>
        <div class="st-card st-me"><div class="av lg">${initials(u)}</div><div><b>${esc(u.name)}</b><small>${esc(H.roleLabel(u))} · ${esc(u.title || r.az)}</small></div></div>
        ${row("Kullanıcı adı", "", `<span class="mono">${esc(u.u)}</span>`)}
        ${row("Rol", "Rolü yalnız bilgi işlem değiştirir.", `<span>${esc(r.name)}</span>`)}
        ${row("Birimler", "", `<div class="st-chips">${units.length ? units.map(x => `<span class="pill">${esc(x.tr)}</span>`).join("") : "—"}</div>`)}
        ${row("E-posta", "Şifre sıfırlama kodu buraya gider.", `<span>${esc(u.email || u.u + "@hastane.local")}</span>`)}
        ${row("Son giriş", "", `<span class="mono">${esc(u.lastLogin || "—")}</span>`)}`;
    },
    security(u) {
      const max = (H.settings && H.settings.sessionTimeout) || 15, cur = +pref("lockMin", String(max));
      return `<h3>${H.t("st_security")}</h3>
        <div class="st-card"><h4>${I("key")} Şifre değiştir</h4><form data-pwform class="st-pw">
          <input type="password" name="c" placeholder="Mevcut şifre" autocomplete="current-password"><input type="password" name="a" placeholder="Yeni şifre" autocomplete="new-password"><input type="password" name="b" placeholder="Yeni şifre (tekrar)" autocomplete="new-password">
          <button class="btn p">${I("ok")}Şifreyi değiştir</button></form><small class="mute">En az 10 karakter · büyük ve küçük harf · rakam · özel karakter</small></div>
        ${row("İki adımlı doğrulama", u.mfa ? "Doğrulayıcı uygulama bağlı." : "Kapalı. Rolünüz için zorunluysa ilk girişte kurulur.", u.mfa ? `<span class="pill">${I("ok")}Açık</span>` : `<span class="tag w">Kapalı</span>`)}
        ${row("Ekran kilidi", `Hareketsiz kalınca ekran kilitlenir. Hastane üst sınırı: ${max} dk.`, seg("lockMin", [5, 10, max].filter((v, i, a) => v <= max && a.indexOf(v) === i).map(v => [String(v), v + " dk"]).concat([["0", "Hep açık"]]), cur === 0 ? "0" : String(Math.min(cur, max))))}
        <div class="st-card"><h4>${I("tablet")} Açık oturumlar</h4>
          <div class="st-sess"><div><b>Bu cihaz</b><small>Hemşire istasyonu · tarayıcı · şimdi</small></div><span class="pill">${I("ok")}Bu oturum</span></div>
          <div class="st-sess"><div><b>Tablet · yatak başı</b><small>Son etkinlik ${H.at("20:14")}</small></div><button class="btn sm g" data-kill>Oturumu kapat</button></div>
          <div style="margin-top:10px"><button class="btn sm" data-killall>Diğer bütün oturumları kapat</button></div></div>`;
    },
    notif(u) {
      const T = [["crit", "Kritik alarm", true], ["high", "Yüksek alarm", false], ["lab", "Kritik laboratuvar sonucu", true], ["hand", "Teslim bekleyen not", false], ["task", "Geciken iş", false]];
      return `<h3>${H.t("st_notif")}</h3>
        ${H.pwa ? H.pwa.html() : ""}
        <div class="tw"><table class="t st-nt"><thead><tr><th>Bildirim</th><th>Uygulama içi</th><th>Tarayıcı</th><th>Telefon</th></tr></thead><tbody>
        ${T.map(([k, l, locked]) => `<tr><td><b>${l}</b>${locked ? `<small class="mute"> · kapatılamaz</small>` : ""}</td><td>${sw("n_" + k + "_app", true, true)}</td><td>${sw("n_" + k + "_web", locked || pref("n_" + k + "_web", "1") === "1", locked)}</td><td>${k === "crit" ? sw("n_crit_push", true, true) : `<span class="mute">—</span>`}</td></tr>`).join("")}
        </tbody></table></div>
        <p class="st-note">Kritik alarm ve kritik laboratuvar sonucu kişi tarafından kapatılamaz; kimin ne zaman gördüğü kayıt altına alınır. Telefona yalnız kritik alarm gider ve hasta adı içermez.</p>`;
    },
    sound(u) {
      const S = H.sound ? H.sound.state : { pulse:true, alarms:true };
      return `<h3>${H.t("st_sound")}</h3>
        ${row("Nabız bipi", "Hasta monitöründe her atımda kısa ses. SpO₂ düştükçe ses kalınlaşır.", `<label class="st-sw"><input type="checkbox" data-snd-opt="pulse"${S.pulse ? " checked" : ""}><span></span></label>`)}
        ${row("Alarm tonları", "Kritik, yüksek ve orta alarm için ayrı ses deseni.", `<label class="st-sw"><input type="checkbox" data-snd-opt="alarms"${S.alarms ? " checked" : ""}><span></span></label>`)}
        ${row("Deneme", "Sesin duyulduğunu kontrol edin.", `<button class="btn sm" data-snd-test>${I("activity")}Sesi dene</button>`)}
        <p class="st-note">Bu sesler yardımcıdır; asıl alarm yatak başı monitördedir. Ses her oturumda kapalı başlar, monitördeki hoparlör düğmesiyle açılır.</p>`;
    },
    /* 24.09 (3. oturum) · Ozan #103: kamera, mikrofon, bildirim izinleri. İlke: önce anlat, sonra iste (tarayıcı penceresinden önce
     * neden gerektiği, nerede kullanıldığı ve neyin KAYDEDİLMEDİĞİ yazılır). İzin yalnız o işe başlanınca istenir; açılışta istenmez. */
    perms() {
      const P = [["microphone", "🎙", "Mikrofon", "Belgeler → sesle yazdırma. Ses yalnız yazıya çevrilir; ses kaydı saklanmaz."],
                 ["camera", "📷", "Kamera", "Yara fotoğrafı (vücut haritası) ve bileklik okutma. Fotoğraf yalnız hasta kaydına gider, cihazın galerisine düşmez."],
                 ["notifications", "🔔", "Bildirimler", "Kritik alarm için telefon ve tarayıcı bildirimi. Bildirimde hasta adı yoktur."]];
      return `<h3>${H.t("st_perms")}</h3>
        <p class="st-note" style="margin-top:0">İzin, yalnız o işe başladığınızda sorulur; önce neden gerektiği yazılır. İstediğiniz zaman tarayıcının adres çubuğundaki kilit simgesinden geri alabilirsiniz.</p>
        ${P.map(([k, ic, n, why]) => row(`${ic} ${n}`, why, `<span class="pill" data-pst="${k}">…</span><button class="btn sm" data-pask="${k}">İzin ver</button>`)).join("")}
        <p class="st-note">Konum, kişiler ve dosya sistemi izni istenmez. ${H.adminNote("Hangi izinlerin kullanılacağı hastanenin politikasına göre yönetimden kapatılabilir (ör. kişisel telefonda kamera kapalı).")}</p>`;
    },
    keys() {
      const K = [["Ctrl K · /", "Hasta / yatak ara"], ["Esc", "Pencereyi kapat"], ["Alt L", "Ekranı kilitle"], ["F11", "Tam ekran"]];
      return `<h3>${H.t("st_keys")}</h3><div class="st-card">${K.map(([k, t]) => `<div class="st-sess"><span>${t}</span><kbd class="st-kbd">${k}</kbd></div>`).join("")}</div>`;
    },
    help() {
      return `<h3>${H.t("st_help")}</h3>
        ${row("Destek", "Giriş sorunu, hata bildirimi, yetki talebi.", `<a class="btn sm" data-legal="support">${I("bell")}Destek ve iletişim</a>`)}
        ${row("Sürüm", "", `<span class="mono">Homunculus 1.0 · 24.09.2026</span>`)}
        <div class="st-links"><a data-legal="privacy">${I("shield")}Gizlilik politikası</a><a data-legal="terms">${I("file")}Kullanım koşulları</a><a data-legal="notice">${I("eye")}Aydınlatma metni</a><a data-legal="support">${I("bell")}Destek ve iletişim</a></div>`;
    },
  };

  function render(root, params = {}) {
    const u = H.state.user, tab = PANES[params.tab] ? params.tab : "look";
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_settings")}</h2><p>${H.t("st_sub")}</p></div></div>
      <div class="st-wrap"><aside class="st-side"><div class="st-who"><div class="av">${initials(u)}</div><div><b>${esc(u.name)}</b><small>${esc(H.roleLabel(u))}</small></div></div>
        ${TABS.map(([k, ic, l]) => `<a class="${tab === k ? "on" : ""}" data-st="${k}">${I(ic)}${H.t(l)}</a>`).join("")}</aside>
        <section class="st-pane">${PANES[tab](u)}</section></div>`;
    root.onclick = (e) => {
      const t = e.target.closest("[data-st]"); if (t) return H.go("settings", { tab:t.dataset.st });
      const b = e.target.closest("[data-pref] button"); if (b) { const k = b.parentNode.dataset.pref; if (k === "lockMin") { H.savePref("lockMin", b.dataset.v); H.toast(b.dataset.v === "0" ? "Ekran kilidi: hep açık" : "Ekran kilidi: " + b.dataset.v + " dk"); if (H.wake) H.wake(); return render(root, { tab }); } H.state[k] = b.dataset.v; H.savePref(k, b.dataset.v); return H.renderApp(); }
      if (e.target.closest("[data-kill]")) { e.target.closest(".st-sess").remove(); H.log("Oturum kapatıldı", "tablet"); return H.toast("Oturum kapatıldı"); }
      if (e.target.closest("[data-killall]")) { H.log("Diğer oturumlar kapatıldı"); return H.toast("Diğer bütün oturumlar kapatıldı"); }
      const pa = e.target.closest("[data-pask]"); if (pa) { const why = { microphone:"Belgelerde sesle yazdırma için mikrofonunuza erişmemiz gerekiyor.", camera:"Yara fotoğrafı ve bileklik okutma için kameranıza erişmemiz gerekiyor.", notifications:"Kritik alarmda size bildirim gönderebilmemiz için." }[pa.dataset.pask];
        return H.askPerm(pa.dataset.pask, why).then(ok => { H.toast(ok ? "İzin verildi" : "İzin verilmedi", ok ? "" : "w"); paintPerms(root); }); }
      if (e.target.closest("[data-snd-test]") && H.sound) { const was = H.sound.state.on; if (!was) H.sound.toggle(); setTimeout(() => { if (!was) H.sound.toggle(); }, 600); }
    };
    if (tab === "perms") paintPerms(root);
    root.onchange = (e) => { const c = e.target.closest("[data-sw]"); if (c) { H.savePref(c.dataset.sw, c.checked ? "1" : "0"); H.toast("Tercih saklandı"); } };
    root.onsubmit = (e) => { e.preventDefault(); const fd = new FormData(e.target), c = fd.get("c"), a = String(fd.get("a")), b2 = fd.get("b");
      if (c !== u.pw) return H.toast("Mevcut şifre hatalı.", "e"); if (a !== b2) return H.toast("Yeni şifreler aynı değil.", "e");
      if (!(a.length >= 10 && /[A-ZÇĞİÖŞÜƏ]/.test(a) && /[a-zçğıöşüə]/.test(a) && /\d/.test(a) && /[^A-Za-z0-9çğıöşüəÇĞİÖŞÜƏ]/.test(a))) return H.toast("Şifre kurallarını karşılamıyor.", "e");
      if (a === u.pw) return H.toast("Yeni şifre eskisiyle aynı olamaz.", "e");
      u.pw = a; H.log("şifre değişti", u.u); H.toast("Şifreniz değişti."); e.target.reset(); };
  }
  const PST = { granted:["İzin verildi", "ok"], denied:["Engellendi · tarayıcı ayarlarından açın", "w"], prompt:["Henüz sorulmadı", ""], unsupported:["Bu tarayıcıda yok", ""] };
  async function permState(k) {
    try { if (k === "notifications" && "Notification" in window) return Notification.permission === "default" ? "prompt" : Notification.permission;
      if (navigator.permissions) return (await navigator.permissions.query({ name:k })).state; } catch {}
    return "unsupported";
  }
  async function paintPerms(root) {
    for (const el of root.querySelectorAll("[data-pst]")) { const st = await permState(el.dataset.pst), [t, c] = PST[st] || PST.unsupported;
      el.textContent = t; el.className = "pill " + (c === "w" ? "tag w" : ""); const b = root.querySelector(`[data-pask="${el.dataset.pst}"]`); if (b) b.hidden = st === "granted" || st === "unsupported"; }
  }
  // Önce anlat, sonra iste: diğer modüller de bunu kullanır → H.askPerm("microphone", "Sesle yazdırma için").then(ok => …)
  H.askPerm = (k, why) => new Promise((res) => {
    const name = { microphone:"Mikrofon", camera:"Kamera", notifications:"Bildirim" }[k] || k;
    H.modal({ title:name + " izni", body:`<p style="margin:0 0 8px">${esc(why || "")}</p><p class="mute" style="margin:0;font-size:13px">Sonraki adımda tarayıcı izin isteyecek. Ses ya da görüntü kaydedilmez; her kullanım denetim kaydına yazılır.</p>`,
      actions:`<button class="btn" data-x>Şimdi değil</button><button class="btn p" data-x data-pgo>${I("ok")}Devam et</button>`,
      onClose:() => { if (!decided) res(false); } });
    let decided = false;
    const go = document.querySelector("[data-pgo]");
    if (go) go.addEventListener("click", async () => { decided = true;
      try { if (k === "notifications") { res((await Notification.requestPermission()) === "granted"); }
        else { const st = await navigator.mediaDevices.getUserMedia(k === "camera" ? { video:true } : { audio:true }); st.getTracks().forEach(t => t.stop()); res(true); }
        H.log(name + " izni", "verildi"); } catch { H.log(name + " izni", "verilmedi"); res(false); } });
  });
  H.register("settings", { title:() => H.t("m_settings"), perm:[], render });
  H.register("profile", { title:() => H.t("profile"), perm:[], render:(root) => render(root, { tab:"profile" }) });
})();
