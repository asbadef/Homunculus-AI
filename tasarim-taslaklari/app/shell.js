/* Homunculus prototip v1 — kabuk: giriş, 2FA, şifre sıfırlama, ilk giriş şifre değişimi, kilit ekranı, menü, üst çubuk. */
(function () {
  const H = window.H, I = H.icon;
  const V = { view:"login", pending:null, err:"", info:"", resetUser:null, locked:false, lastPage:null };

  /* ---------- şifre kuralları ---------- */
  const RULES = [["10+ karakter", s => s.length >= 10], ["Büyük harf", s => /[A-ZÇĞİÖŞÜƏ]/.test(s)], ["Küçük harf", s => /[a-zçğıöşüə]/.test(s)], ["Rakam", s => /\d/.test(s)], ["Özel karakter (!?.*…)", s => /[^A-Za-z0-9çğıöşüəÇĞİÖŞÜƏ]/.test(s)]];
  const rulesHtml = (s) => `<div class="pwRules">${RULES.map(([l, f]) => `<span class="${f(s) ? "ok" : ""}">${f(s) ? "✓" : "○"} ${l}</span>`).join("")}</div>`;
  const pwOk = (s) => RULES.every(([, f]) => f(s));

  /* ---------- dil seçici ---------- */
  const langBar = () => `<div class="langs">${H.LANGS.map(([k, n]) => `<span class="lang ${H.state.lang === k ? "on" : ""}" data-lang="${k}" title="${n}">${H.flagBox(k)}${k}</span>`).join("")}</div>`;

  /* ================= giriş ekranları ================= */
  /* 24.09 (3. oturum) · Ozan #57: "giriş sayfalarında çok eksiğimiz var, animasyon hareket yok".
   * Eklenenler: canlı arka plan, hareketli monitör önizlemesi, sırayla akan olay kartları (uydurma, adsız),
   * açılış hareketi, hatada sarsılma, Caps Lock uyarısı, tema düğmesi, adım göstergesi, LDAP "yakında", alt bağlantılar.
   * Hareket, işletim sisteminde "hareketi azalt" açıksa kapanır (ek.css). */
  H.addT({
    lg_p1:{ AZ:"Monitor və portativ cihaz məlumatı bir yerdə, mənbəyi ilə.", TR:"Monitör ve portatif cihaz verisi tek yerde, kaynağıyla.", RU:"Данные мониторов и портативных устройств в одном месте, с источником.", EN:"Monitor and portable-device data in one place, with its source." },
    lg_p2:{ AZ:"Pisləşmə meyarları ödəniləndə doğru şəxsə, doğru ardıcıllıqla xəbər.", TR:"Kötüleşme kriterleri karşılanınca doğru kişiye, doğru sırayla haber.", RU:"При признаках ухудшения — нужному человеку, в нужном порядке.", EN:"When deterioration criteria are met, the right person is told, in the right order." },
    lg_p3:{ AZ:"Şkalalar özü dolur, həkim təsdiqləyir. Qərarı həkim verir.", TR:"Skorlar kendiliğinden dolar, hekim onaylar. Kararı hekim verir.", RU:"Шкалы заполняются сами, врач подтверждает. Решение за врачом.", EN:"Scores fill themselves; the physician confirms. The physician decides." },
    lg_p4:{ AZ:"Məlumat xəstəxananın içində qalır. Hər əməliyyat qeydə alınır.", TR:"Veri hastanenin içinde kalır. Her işlem kayıt altında.", RU:"Данные остаются в больнице. Каждое действие записывается.", EN:"Data stays inside the hospital. Every action is logged." },
    lg_live:{ AZ:"Canlı", TR:"Canlı", RU:"В эфире", EN:"Live" },
    lg_f1t:{ AZ:"REA03 · NEWS2 5 → 7", TR:"REA03 · NEWS2 5 → 7", RU:"REA03 · NEWS2 5 → 7", EN:"REA03 · NEWS2 5 → 7" },
    lg_f1s:{ AZ:"Baş tibb bacısına xəbər verildi · 21:38", TR:"Sorumlu hemşireye haber verildi · 21:38", RU:"Старшая медсестра уведомлена · 21:38", EN:"Charge nurse notified · 21:38" },
    lg_f2t:{ AZ:"Günlük SOFA hazırdır", TR:"Günlük SOFA hazır", RU:"Суточная SOFA готова", EN:"Daily SOFA ready" },
    lg_f2s:{ AZ:"Sistem doldurdu · həkim təsdiqi gözlənilir", TR:"Sistem doldurdu · hekim onayı bekliyor", RU:"Заполнено системой · ждёт подтверждения врача", EN:"System-filled · awaiting physician sign-off" },
    lg_f3t:{ AZ:"SpO₂ 86 · 3 dəqiqədir", TR:"SpO₂ 86 · 3 dakikadır", RU:"SpO₂ 86 · 3 минуты", EN:"SpO₂ 86 · for 3 minutes" },
    lg_f3s:{ AZ:"REA02 · tibb bacısı gördü · 21:41", TR:"REA02 · hemşire gördü · 21:41", RU:"REA02 · медсестра увидела · 21:41", EN:"REA02 · nurse acknowledged · 21:41" },
    lg_f4t:{ AZ:"Təhvil qeydi möhürləndi", TR:"Teslim notu mühürlendi", RU:"Передача скреплена", EN:"Handover sealed" },
    lg_f4s:{ AZ:"Gecə komandasına keçdi · 08:02", TR:"Gece ekibine geçti · 08:02", RU:"Передано ночной смене · 08:02", EN:"Passed to the night team · 08:02" },
    lg_caps:{ AZ:"Caps Lock açıqdır", TR:"Caps Lock açık", RU:"Включён Caps Lock", EN:"Caps Lock is on" },
    lg_busy:{ AZ:"Yoxlanılır…", TR:"Kontrol ediliyor…", RU:"Проверка…", EN:"Checking…" },
    lg_ldap:{ AZ:"Xəstəxana hesabı ilə giriş (LDAP)", TR:"Hastane hesabıyla giriş (LDAP)", RU:"Вход через учётную запись больницы (LDAP)", EN:"Sign in with hospital account (LDAP)" },
    lg_soon:{ AZ:"tezliklə", TR:"yakında", RU:"скоро", EN:"soon" },
    lg_or:{ AZ:"və ya", TR:"ya da", RU:"или", EN:"or" },
    lg_help:{ AZ:"Giriş problemi? İT: daxili 4410", TR:"Giriş sorunu mu? Bilgi işlem: dahili 4410", RU:"Проблема со входом? ИТ: внутр. 4410", EN:"Can't sign in? IT: ext. 4410" },
    lg_pill:{ AZ:"Reanimasiya üçün klinik qərar dəstəyi", TR:"Yoğun bakım için klinik karar desteği", RU:"Клиническая поддержка решений для реанимации", EN:"Clinical decision support for critical care" },
    lg_h1:{ AZ:"Hər çarpayı, hər növbə —", TR:"Her yatak, her nöbet —", RU:"Каждая койка, каждая смена —", EN:"Every bed, every shift —" },
    lg_r1:{ AZ:"bir baxışda.", TR:"tek bakışta.", RU:"с одного взгляда.", EN:"at a glance." },
    lg_r2:{ AZ:"vaxtında xəbərdar.", TR:"zamanında haberdar.", RU:"вовремя в курсе.", EN:"alerted in time." },
    lg_r3:{ AZ:"qeydə alınmış.", TR:"kayıt altında.", RU:"под записью.", EN:"on the record." },
    lg_mods:{ AZ:"modul", TR:"modül", RU:"модулей", EN:"modules" },
    lg_active:{ AZ:"Aktiv", TR:"Aktif", RU:"Активно", EN:"Active" },
    lg_c1:{ AZ:"Çarpayı paneli və divar monitoru", TR:"Yatak paneli ve duvar monitörü", RU:"Панель коек и центральный монитор", EN:"Bed board and wall monitor" },
    lg_c1s:{ AZ:"Monitor və portativ cihaz məlumatı, mənbəyi ilə", TR:"Monitör ve portatif cihaz verisi, kaynağıyla", RU:"Данные мониторов и портативных устройств", EN:"Monitor and portable-device data, with source" },
    lg_c2:{ AZ:"Erkən xəbərdarlıq və eskalasiya", TR:"Erken uyarı ve eskalasyon", RU:"Раннее предупреждение и эскалация", EN:"Early warning and escalation" },
    lg_c2s:{ AZ:"Doğru şəxsə, doğru ardıcıllıqla", TR:"Doğru kişiye, doğru sırayla", RU:"Нужному человеку, в нужном порядке", EN:"The right person, in the right order" },
    lg_c3:{ AZ:"Şkalalar və qulluq planı", TR:"Skorlar ve bakım planı", RU:"Шкалы и план ухода", EN:"Scores and care plan" },
    lg_c3s:{ AZ:"Sistem doldurur, həkim təsdiqləyir", TR:"Sistem doldurur, hekim onaylar", RU:"Система заполняет, врач подтверждает", EN:"System fills, physician confirms" },
    lg_c4:{ AZ:"Tibb bacısı işləri", TR:"Hemşirelik işleri", RU:"Сестринские задачи", EN:"Nursing tasks" },
    lg_c4s:{ AZ:"24 saatlıq cədvəl, gecikən iş xəbərdarlığı", TR:"24 saatlik çizelge, geciken iş uyarısı", RU:"24-часовой график, просроченные задачи", EN:"24-hour grid, overdue alerts" },
    lg_c5:{ AZ:"Təhvil", TR:"Teslim", RU:"Передача смены", EN:"Handover" },
    lg_c5s:{ AZ:"Möhürlənmiş, dəyişdirilə bilməyən qeyd", TR:"Mühürlü, değiştirilemez kayıt", RU:"Скреплённая, неизменяемая запись", EN:"Sealed, tamper-proof record" },
    lg_t1:{ AZ:"Qərarı həkim verir", TR:"Kararı hekim verir", RU:"Решает врач", EN:"The physician decides" },
    lg_sc_unit:{ AZ:"Reanimasiya · 8 çarpayı · canlı", TR:"Erişkin yoğun bakım · 8 yatak · canlı", RU:"Реанимация · 8 коек · в эфире", EN:"Adult ICU · 8 beds · live" },
    lg_sc_n:{ AZ:"Tibb bacısı", TR:"Hemşire", RU:"Медсестра", EN:"Nurse" },
    lg_sc_c:{ AZ:"Baş tibb bacısı", TR:"Sorumlu hemşire", RU:"Старшая медсестра", EN:"Charge nurse" },
    lg_sc_d:{ AZ:"Həkim", TR:"Hekim", RU:"Врач", EN:"Physician" },
    lg_sc0:{ AZ:"8 çarpayı izlənilir · hamısı sabit", TR:"8 yatak izleniyor · hepsi sakin", RU:"8 коек под наблюдением · всё стабильно", EN:"8 beds monitored · all calm" },
    lg_sc1:{ AZ:"REA03 · SpO₂ düşür", TR:"REA03 · SpO₂ düşüyor", RU:"REA03 · SpO₂ снижается", EN:"REA03 · SpO₂ falling" },
    lg_sc2:{ AZ:"Tibb bacısına xəbər verildi", TR:"Hemşireye haber verildi", RU:"Медсестра уведомлена", EN:"Nurse notified" },
    lg_sc3:{ AZ:"3 dəq cavab yoxdur → baş tibb bacısı", TR:"3 dk yanıt yok → sorumlu hemşire", RU:"3 мин без ответа → старшая медсестра", EN:"No response in 3 min → charge nurse" },
    lg_sc4:{ AZ:"5 dəq → həkim", TR:"5 dk → hekim", RU:"5 мин → врач", EN:"5 min → physician" },
    lg_sc5:{ AZ:"Həkim gördü · qərar həkimindir", TR:"Hekim gördü · karar hekimin", RU:"Врач увидел · решение за врачом", EN:"Physician acknowledged · the decision is theirs" },
    lg_back:{ AZ:"Ana səhifəyə qayıt", TR:"Ana sayfaya dön", RU:"На главную", EN:"Back to home" },
    lg_contact:{ AZ:"Bizimlə əlaqə", TR:"Bize ulaşın", RU:"Связаться", EN:"Contact" },
    lg_quick_s:{ AZ:"Klikləyin, birbaşa daxil olun", TR:"Tıklayın, doğrudan girin", RU:"Нажмите — вход сразу", EN:"Click to sign in directly" },
    lg_ok:{ AZ:"Giriş uğurludur, yönləndirilir…", TR:"Giriş başarılı, yönlendiriliyor…", RU:"Вход выполнен, переход…", EN:"Signed in, redirecting…" },
    lg_notice:{ AZ:"Məlumatlandırma", TR:"Aydınlatma metni", RU:"Уведомление о данных", EN:"Data notice" },
    lg_priv:{ AZ:"Məxfilik", TR:"Gizlilik", RU:"Конфиденциальность", EN:"Privacy" },
    lg_terms:{ AZ:"İstifadə qaydaları", TR:"Kullanım koşulları", RU:"Условия", EN:"Terms" },
    lg_secure:{ AZ:"Şifrəli bağlantı", TR:"Şifreli bağlantı", RU:"Защищённое соединение", EN:"Encrypted connection" },
    lg_inside:{ AZ:"Məlumat xəstəxanada", TR:"Veri hastanede", RU:"Данные в больнице", EN:"Data on-site" },
    lg_step:{ AZ:"Addım", TR:"Adım", RU:"Шаг", EN:"Step" },
    lg_day:{ AZ:"Gündüz görünüşü", TR:"Gündüz görünümü", RU:"Светлая тема", EN:"Light theme" },
    lg_night:{ AZ:"Gecə görünüşü", TR:"Gece görünümü", RU:"Тёмная тема", EN:"Dark theme" },
    lg_demo:{ AZ:"Hesab seçin", TR:"Hesap seçin", RU:"Выберите аккаунт", EN:"Pick an account" },
    lg_quick:{ AZ:"Sürətli giriş", TR:"Hızlı giriş", RU:"Быстрый вход", EN:"Quick sign-in" },
  });
  const ECG = "M0 30 L18 30 L22 26 L26 30 L34 30 L37 34 L40 6 L43 40 L46 30 L58 30 L64 23 L72 30 L100 30";   // bir atım, 100 birim
  const ecgPath = () => Array.from({ length:8 }, (_, i) => ECG.replace(/(\d+(?:\.\d+)?) (\d+)/g, (m, x, y) => `${+x + i * 100} ${y}`).replace(/^M/, i ? "L" : "M")).join(" ");
  const STEPS = { mfa:[2, 2], force:[2, 2], forgot1:[1, 3], forgot2:[2, 3], forgot3:[3, 3] };
  // Yetenek kartı (MedRapor'un 5 modül kartı gibi): satırlar sırayla vurgulanır, üzerine gelince durur.
  // Sahne verisi: 8 yatak (uydurma, adsız), eskalasyon basamakları motordaki 3 / 5 dk ile aynı.
  const SC_BEDS = [["REA01", 96], ["REA02", 94], ["REA03", 97], ["REA04", 98], ["REA05", 95], ["REA06", 97], ["REA07", 99], ["REA08", 96]].map(([no, v], k) =>
    [no, v, Array.from({ length:12 }, (_, x) => `${(x / 11 * 100).toFixed(1)},${(12 + Math.sin(x * 1.3 + k) * 4 + ((k * 7 + x * 3) % 5) - 2).toFixed(1)}`).join(" ")]);
  const SC_STEPS = [["bell", "lg_sc_n", "00:00"], ["userPlus", "lg_sc_c", "+3 dk"], ["heart", "lg_sc_d", "+5 dk"]];
  const ROT = ["lg_r1", "lg_r2", "lg_r3"];
  const langPill = () => `<button type="button" class="lsel" data-lgmenu="lang" title="Dil / Language">${H.flagBox(H.state.lang)}<b>${H.state.lang}</b>${I("chevD")}</button>`;
  function authScreen(inner) {
    const st = STEPS[V.view];
    return `<div class="login lg2${V.shake ? " shake" : ""}">
      <div class="hero">
        <div class="lg-bg" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="lg-brand"><div class="mk">h</div><div><b>homunculus</b><div>${H.esc(H.data.hospital.name)}</div></div></div>
        <div class="lg-body">
          <span class="lg-pill"><i></i>${H.t("lg_pill")}</span>
          <h1>${H.t("lg_h1")}<br><span class="lg-rot" data-rot>${H.t(ROT[0])}</span></h1>
          <p class="lead">${H.t("hero_sub")}</p>
          <div class="lg-scene" data-scene aria-hidden="true">
            <div class="sc-head"><span><span class="lg-dot"></span>${H.t("lg_sc_unit")}</span><span class="mono" data-scclock>21:38</span></div>
            <div class="sc-grid">${SC_BEDS.map(([no, v, pts], k) => `<div class="sc-bed" data-scb="${k}"><div class="sc-no"><b class="mono">${no}</b><i></i></div>
              <svg viewBox="0 0 100 24" preserveAspectRatio="none"><polyline points="${pts}"/></svg><div class="sc-v"><small>SpO₂</small><b class="mono">${v}</b></div></div>`).join("")}</div>
            <div class="sc-chain">${SC_STEPS.map(([ic, t, m], k) => `<div class="sc-st" data-scs="${k}"><span class="ic">${I(ic)}</span><b>${H.t(t)}</b><small class="mono">${m}</small></div>`).join('<i class="sc-ln"></i>')}</div>
            <div class="sc-cap" data-sccap>${H.t("lg_sc0")}</div>
          </div>
        </div>
        <div class="lg-trustrow"><span>${I("shield")}${H.t("lg_t1")}</span><span>${I("lock")}${H.t("lg_secure")}</span><span>${I("building")}${H.t("lg_inside")}</span></div>
      </div>
      <div class="side">
        <a class="lg-back" href="../anasayfa/index.html">${I("chevL")}${H.t("lg_back")}</a>
        <div class="lg-corner">${langPill()}<button type="button" class="ib lg-theme" data-lg-theme title="${H.t(H.state.theme === "gece" ? "lg_day" : "lg_night")}">${I(H.state.theme === "gece" ? "sun" : "moon")}</button></div>
        <div class="form">
          <div class="lg-mbrand"><div class="mk">h</div><div><b>homunculus</b><small>${H.esc(H.data.hospital.name)}</small></div></div>
          ${st ? `<div class="lg-tools"><span class="lg-step">${H.t("lg_step")} ${st[0]}/${st[1]}<i>${Array.from({ length:st[1] }, (_, i2) => `<em class="${i2 < st[0] ? "on" : ""}"></em>`).join("")}</i></span></div>` : ""}
          <div class="lg-in">${inner}</div>
          <div class="lg-links"><a data-legal="privacy">${H.t("lg_priv")}</a><i>·</i><a data-legal="terms">${H.t("lg_terms")}</a><i>·</i><a data-legal="notice">${H.t("lg_notice")}</a><i>·</i><a data-legal="cookies">${H.t("lgl_tab_cookies")}</a><i>·</i><a data-legal="support">${H.t("lg_contact")}</a></div>
          ${H.social ? H.social.iconsHtml("lg-soc") : ""}
        </div>
      </div>
      <details class="lg-acc"${V.accOpen ? " open" : ""}><summary title="${H.t("lg_demo")}">${I("userPlus")}<span>${H.t("lg_quick")}</span></summary>
        <div class="lg-acc-p"><h6>${H.t("lg_demo")}</h6><div class="list">${H.data.users.filter(u => u.active !== false).map(u => `<button class="a" data-demo="${u.u}"><b>${H.esc(H.roleLabel(u))}</b><span>${u.u}</span></button>`).join("")}</div>
        <div class="mute" style="font-size:12px;margin-top:8px">${H.t("lg_quick_s")} · Demo123! · admin: Admin123! · 2FA: <b class="mono">${H.MFA_CODE}</b> · ${H.t("forgot")}: <b class="mono">${H.RESET_CODE}</b></div></div></details>
      </div>`;
  }

  const errBox = () => V.err ? `<div class="note" style="background:var(--critSoft);border-color:color-mix(in srgb,var(--crit) 45%,transparent);color:var(--crit);margin-bottom:12px">${V.err}</div>` : V.info ? `<div class="note i" style="margin-bottom:12px">${V.info}</div>` : "";

  const VIEWS = {
    login: () => authScreen(`<h2>${H.t("login_title")}</h2><p class="sub">${H.t("login_sub")}</p>${errBox()}
      <form data-f="login"><div class="fld"><label>${H.t("username")}</label><input name="u" autocomplete="username" value="${H.esc(V.prefill?.u ?? H.state.rememberUser)}" required></div>
      <div class="fld"><label style="display:flex;justify-content:space-between">${H.t("password")}<a data-go="forgot1" style="font-weight:600;font-size:12.5px;cursor:pointer">${H.t("forgot")}</a></label>
        <div style="position:relative"><input name="p" type="password" autocomplete="current-password" value="${H.esc(V.prefill?.p ?? "")}" required data-caps><button type="button" class="ib" data-eye style="position:absolute;right:2px;top:2px">${I("eye")}</button></div>
        <div class="lg-caps" hidden>${I("alert")}${H.t("lg_caps")}</div></div>
      <label class="lg-rem"><input type="checkbox" name="r" ${H.state.rememberUser ? "checked" : ""}><span class="sw"></span>${H.t("remember")}</label>
      <button class="btn p lg lg-go" style="width:100%;justify-content:center"><span>${H.t("signin")}</span> ${I("chevR")}</button></form>
`),

    mfa: () => authScreen(`<h2>İki adımlı doğrulama</h2><p class="sub">${H.esc(V.pending.name)} · doğrulayıcı uygulamadaki 6 haneli kodu girin.</p>${errBox()}
      <form data-f="mfa"><div class="code">${[0,1,2,3,4,5].map(i => `<input inputmode="numeric" maxlength="1" data-ci="${i}">`).join("")}</div>
      <button class="btn p lg" style="width:100%;justify-content:center;margin-top:18px">Doğrula</button></form>
      <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:13px"><a data-go="login" style="cursor:pointer">← Girişe dön</a></div>`),

    force: () => authScreen(`<h2>Yeni şifre belirleyin</h2><p class="sub">Bu hesabın ilk girişi ya da şifresi yönetici tarafından sıfırlandı. Devam etmek için kendi şifrenizi belirleyin.</p>${errBox()}
      <form data-f="force"><div class="fld"><label>Yeni şifre</label><input name="a" type="password" data-pw></div><div data-rules>${rulesHtml("")}</div>
      <div class="fld"><label>Yeni şifre (tekrar)</label><input name="b" type="password"></div>
      <button class="btn p lg" style="width:100%;justify-content:center">Şifreyi kaydet ve devam et</button></form>`),

    forgot1: () => authScreen(`<h2>Şifre sıfırlama</h2><p class="sub">Kullanıcı adınızı ya da kurumsal e-postanızı yazın. Kayıtlı telefonunuza ve e-postanıza bir kod gönderilecek.</p>${errBox()}
      <form data-f="forgot1"><div class="fld"><label>Kullanıcı adı veya e-posta</label><input name="u" required></div>
      <button class="btn p lg" style="width:100%;justify-content:center">Kod gönder</button></form>
      <p style="font-size:13px;margin-top:14px"><a data-go="login" style="cursor:pointer">← Girişe dön</a></p>
      <div class="note i" style="margin-top:16px">Kod gönderilemiyorsa bölüm sorumlunuz ya da bilgi işlem, Yönetim → Kullanıcılar ekranından geçici şifre verebilir.</div>`),

    forgot2: () => authScreen(`<h2>Kodu girin</h2><p class="sub">Kod gönderildi: <b>+994 •• ••• •• 34</b> ve e-posta. 10 dakika geçerlidir.</p>${errBox()}
      <form data-f="forgot2"><div class="code">${[0,1,2,3,4,5].map(i => `<input inputmode="numeric" maxlength="1" data-ci="${i}">`).join("")}</div>
      <button class="btn p lg" style="width:100%;justify-content:center;margin-top:18px">Devam</button></form>
      <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:13px"><a data-go="forgot1" style="cursor:pointer">← Geri</a></div>`),

    forgot3: () => authScreen(`<h2>Yeni şifre</h2><p class="sub">${H.esc(V.resetUser?.name || "")} için yeni şifre belirleyin.</p>${errBox()}
      <form data-f="forgot3"><div class="fld"><label>Yeni şifre</label><input name="a" type="password" data-pw></div><div data-rules>${rulesHtml("")}</div>
      <div class="fld"><label>Yeni şifre (tekrar)</label><input name="b" type="password"></div>
      <button class="btn p lg" style="width:100%;justify-content:center">Şifreyi kaydet</button></form>`),
  };

  function renderAuth() {
    const root = document.getElementById("root");
    root.innerHTML = VIEWS[V.view]();
    clearInterval(V.rotT); clearInterval(V.capT);
    const rot = root.querySelector("[data-rot]"); if (rot && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) { let k = 0; V.rotT = setInterval(() => { if (!rot.isConnected) return clearInterval(V.rotT); k = (k + 1) % ROT.length; rot.classList.remove("in"); void rot.offsetWidth; rot.textContent = H.t(ROT[k]); rot.classList.add("in"); }, 3200); }
    const sc = root.querySelector("[data-scene]"); if (sc) { let ph = 0; const bed = sc.querySelector('[data-scb="2"]'), val = bed.querySelector(".sc-v b"), cap = sc.querySelector("[data-sccap]"), clk = sc.querySelector("[data-scclock]");
      const steps = [...sc.querySelectorAll("[data-scs]")], SPO = [97, 91, 88, 87, 86, 93], CL = ["21:38", "21:39", "21:40", "21:43", "21:45", "21:46"];
      const paint = () => { bed.className = "sc-bed" + (ph === 1 ? " warn" : ph >= 2 && ph <= 4 ? " crit" : ph === 5 ? " ok" : ""); val.textContent = SPO[ph]; clk.textContent = CL[ph];
        steps.forEach((x, n) => { x.classList.toggle("on", ph >= 2 && ph <= 4 && n === ph - 2); x.classList.toggle("done", ph === 5 || (ph >= 3 && n < ph - 2)); });
        cap.classList.remove("in"); void cap.offsetWidth; cap.textContent = H.t("lg_sc" + ph); cap.classList.add("in"); cap.classList.toggle("c", ph >= 2 && ph <= 4); cap.classList.toggle("g", ph === 5); };
      paint(); if (!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) V.capT = setInterval(() => { if (!sc.isConnected) return clearInterval(V.capT); ph = (ph + 1) % 6; paint(); }, 2300); }
    const lg = root.querySelector(".login"); if (lg && V.lastView !== V.view) lg.classList.add("enter"); V.lastView = V.view; V.shake = false;
    const cp = root.querySelector("[data-caps]"), capsBox = root.querySelector(".lg-caps");
    if (cp && capsBox) ["keydown", "keyup"].forEach(ev => cp.addEventListener(ev, e => { capsBox.hidden = !(e.getModifierState && e.getModifierState("CapsLock")); }));
    const dm = root.querySelector("details.lg-acc"); if (dm) dm.addEventListener("toggle", () => { V.accOpen = dm.open; });
    const first = root.querySelector("input:not([type=checkbox])"); if (first && !first.value) first.focus();
    root.querySelectorAll("[data-ci]").forEach((inp, i, all) => {
      inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(-1); if (inp.value && all[i + 1]) all[i + 1].focus(); });
      inp.addEventListener("keydown", e => { if (e.key === "Backspace" && !inp.value && all[i - 1]) all[i - 1].focus(); });
      inp.addEventListener("paste", e => { const d = (e.clipboardData.getData("text") || "").replace(/\D/g, ""); if (d.length >= 6) { e.preventDefault(); all.forEach((x, j) => x.value = d[j] || ""); all[5].focus(); } });
    });
    const pw = root.querySelector("[data-pw]"); if (pw) pw.addEventListener("input", () => root.querySelector("[data-rules]").innerHTML = rulesHtml(pw.value));
  }
  const code = (f) => [...f.querySelectorAll("[data-ci]")].map(x => x.value).join("");
  const setView = (v, err = "", info = "") => { V.view = v; V.err = err; V.info = info; V.shake = !!err; renderAuth(); };

  function signIn(user) {
    user.fails = 0; user.lastLogin = "23.09.2026 " + H.now(); V.view = "login"; V.err = ""; V.info = ""; V.prefill = null;
    H.state.user = user; V.locked = false; H.log("giriş", "başarılı");
    const home = H.data.roles[user.role].home; H.state.page = H.pages[home] ? home : "beds"; H.state.params = {};
    H.renderApp(true);
    H.toast(`Hoş geldiniz, ${user.name}`); startLive();
  }

  document.addEventListener("submit", e => {
    const f = e.target.closest("form[data-f]"); if (!f) return; e.preventDefault();
    const k = f.dataset.f, fd = new FormData(f);
    // Giriş düğmesi kısa bir "kontrol ediliyor" hâline geçer; sonra form ikinci kez gönderilir ve asıl denetim çalışır.
    if (k === "login" && !f.dataset.ok && f.requestSubmit) { const b = f.querySelector(".lg-go"); if (b) { b.classList.add("busy"); b.querySelector("span").textContent = H.t("lg_busy"); }
      f.dataset.ok = "1"; setTimeout(() => f.isConnected && f.requestSubmit(), 420); return; }
    if (k === "login") {
      const u = String(fd.get("u")).trim(), p = String(fd.get("p")), user = H.data.users.find(x => x.u.toLowerCase() === u.toLowerCase());
      // Hızlı girişle doldurulan hesap hatırlanmaz; yalnız elle yazılan kullanıcı adı saklanır.
      const quick = !!V.prefill; V.prefill = null;
      if (fd.get("r") && !quick) { H.state.rememberUser = u; H.savePref("rememberUser2", u); } else if (!fd.get("r")) { H.state.rememberUser = ""; H.savePref("rememberUser2", ""); }
      if (!user) { H.log("giriş", "bilinmeyen kullanıcı: " + u); return setView("login", "Kullanıcı adı veya şifre hatalı."); }
      if (!user.active) return setView("login", "Bu hesap pasif. Bölüm sorumlunuza ya da bilgi işleme başvurun.");
      if (user.lockedUntil > Date.now()) return setView("login", `Çok fazla hatalı deneme. Hesap ${Math.ceil((user.lockedUntil - Date.now()) / 60000)} dakika kilitli. Bilgi işlem kilidi hemen açabilir.`);
      if (user.pw !== p) { user.fails++; H.state.user = null; H.log("giriş", "başarısız: " + u);
        if (user.fails >= 5) { user.lockedUntil = Date.now() + 15 * 60000; return setView("login", "5 hatalı deneme. Hesap 15 dakika kilitlendi."); }
        return setView("login", `Kullanıcı adı veya şifre hatalı. Kalan deneme: ${5 - user.fails}`); }
      V.pending = user;
      if (user.mustChange) return setView("force", "", "Geçici şifreyle giriş yaptınız.");
      if (user.mfa) return setView("mfa");
      return signIn(user);
    }
    if (k === "mfa") { if (code(f) !== H.MFA_CODE) return setView("mfa", "Kod doğru değil ya da süresi doldu."); return signIn(V.pending); }
    if (k === "force" || k === "forgot3") {
      const a = String(fd.get("a")), b = String(fd.get("b")), user = k === "force" ? V.pending : V.resetUser;
      if (!pwOk(a)) return setView(k, "Şifre kurallarını karşılamıyor.");
      if (a !== b) return setView(k, "İki şifre aynı değil.");
      if (a === user.pw) return setView(k, "Yeni şifre eskisiyle aynı olamaz.");
      user.pw = a; user.mustChange = false; user.fails = 0; user.lockedUntil = 0; H.log("şifre değişti", user.u);
      if (k === "force") return user.mfa ? setView("mfa", "", "Şifreniz değişti. Şimdi doğrulama kodunu girin.") : signIn(user);
      V.prefill = { u:user.u, p:"" }; return setView("login", "", "Şifreniz değişti. Yeni şifrenizle giriş yapın.");
    }
    if (k === "forgot1") { const u = String(fd.get("u")).trim().toLowerCase(), user = H.data.users.find(x => x.u.toLowerCase() === u || (x.u + "@nkx.az") === u);
      // Kullanıcı yoksa da aynı mesaj: hesap var mı yok mu dışarıya sızmasın.
      V.resetUser = user || null; H.log("şifre sıfırlama istendi", u); return setView("forgot2", "", "Böyle bir hesap varsa kod gönderildi."); }
    if (k === "forgot2") { if (code(f) !== H.RESET_CODE || !V.resetUser) return setView("forgot2", "Kod doğru değil."); return setView("forgot3"); }
    if (k === "unlock") { const p = String(fd.get("p")); if (p !== H.state.user.pw) { V.err = H.t("lk_err"); return H.renderApp(); } V.locked = false; V.err = ""; H.log("kilit açıldı"); return H.renderApp(); }
  });

  document.addEventListener("click", e => {
    const lg = e.target.closest("[data-lang]"); if (lg) { H.state.lang = lg.dataset.lang; H.savePref("lang", H.state.lang); document.documentElement.lang = H.state.lang.toLowerCase(); closeMenus(); return H.state.user && !V.locked ? H.renderApp() : renderAuth(); }
    if (!H.state.user || V.locked) {
      const g = e.target.closest("[data-go]"); if (g && VIEWS[g.dataset.go]) { e.preventDefault(); return setView(g.dataset.go); }
      const d = e.target.closest("[data-demo]"); if (d) { const u = H.userBy(d.dataset.demo); V.accOpen = false; if (!u || u.active === false) return;
        H.log("hızlı giriş", u.u); u.lockedUntil = 0; u.fails = 0; u.mustChange = false; return signIn(u); }
      const lm = e.target.closest("[data-lgmenu]"); if (lm) { e.stopPropagation(); return openMenu(lm, H.LANGS.map(([l, n]) => `<a data-lang="${l}" class="lopt${H.state.lang === l ? " on" : ""}">${H.flagBox(l)}<span class="lt">${n}<small>${l}</small></span>${H.state.lang === l ? I("ok") : ""}</a>`).join(""), "lmenu"); }
      if (e.target.closest("[data-lg-theme]")) { H.state.theme = H.state.theme === "gece" ? "gun" : "gece"; H.savePref("theme", H.state.theme); document.body.dataset.theme = H.state.theme; return renderAuth(); }
      const ey = e.target.closest("[data-eye]"); if (ey) { const i = ey.parentNode.querySelector("input"); i.type = i.type === "password" ? "text" : "password"; }
      if (e.target.closest("[data-other]")) { H.state.user = null; V.locked = false; return setView("login"); }
    }
  });

  /* ================= uygulama kabuğu ================= */
  const NAV = [
    ["beds", "grid", "m_beds", "beds"], ["wall", "activity", "m_wall", "beds"], ["unitdash", "chart", "m_unitdash", "beds"], ["tasks", "list", "m_tasks", "tasks"], ["bedside", "tablet", "m_bedside", "bedside"],
    ["alarms", "bell", "m_alarms", "alarms", () => H.openAlarms().length],
    ["hand", "clip", "m_hand", "hand", () => H.data.handovers.filter(h => h.state === "waiting" && H.inScope(h.pid)).length, "y"],
    ["admission", "userPlus", "m_admission", ["admission", "admission_view"]], ["occupancy", "bed", "m_occupancy", "occupancy"], ["camera", "tv", "m_camera", "camera"],
    ["rrt", "zap", "m_rrt", "rrt"], ["pharmacy", "pill", "m_pharmacy", "pharmacy"],
    ["devices", "cpu", "m_devices", "devices", null, null, [["ozet", "Özet", "devices"], ["envanter", "Envanter", "devices"], ["takvim", "Bakım takvimi", "maintenance"], ["ariza", "Arıza kayıtları", "devices"], ["odalar", "Yataklar ve odalar", "devices"]]],
    ["workload", "users", "m_workload", ["staff_view", "occupancy"]], ["infection", "shield", "m_infection", ["quality", "beds"]],
    ["summary", "chart", "m_summary", "summary"], ["quality", "star", "m_quality", "quality"], ["pilot", "file", "m_pilot", ["summary", "quality"]],
    // Kalite ve başhekim yalnız "audit" yetkisiyle girer: onlara menüde "Denetim kaydı" olarak görünür, yönetim sekmeleri görünmez.
    ["admin", "shield", "m_admin", ["admin_users", "admin_roles", "admin_structure", "admin_integrations", "admin_system", "admin_camera", "audit"], null, null,
      [["users", "Kullanıcılar", "admin_users"], ["roles", "Roller ve yetkiler", "admin_roles"], ["structure", "Hastane yapısı", "admin_structure"], ["integrations", "Entegrasyonlar", "admin_integrations"], ["camera", "Kamera bağlantısı", "admin_camera"], ["notify", "Bildirim kuralları", "admin_system"], ["careCat", "Bakım kataloğu", "admin_system"], ["system", "Sistem ayarları", "admin_system"], ["health", "Sistem durumu", "admin_system"], ["audit", "Denetim kaydı", "audit"]]],
  ];
  const adminOnlyAudit = () => !["admin_users", "admin_roles", "admin_structure", "admin_integrations", "admin_system", "admin_camera"].some(p => H.can(p));
  const allowed = (perm) => { const a = [].concat(perm); return !a.length || a.some(p => H.can(p)); };
  function railHtml() {
    const items = NAV.filter(n => allowed(n[3]) && H.pages[n[0]]).map(([k, ic, lab, , badge, bc, fly]) => {
      if (k === "admin" && adminOnlyAudit()) { ic = "file"; lab = "m_audit"; fly = null; }
      const n = badge ? badge() : 0, subs = fly ? fly.filter(s => H.can(s[2])) : null;
      return `<div class="ri ${H.state.page === k || (k === "patient" && H.state.page === "patient") ? "on" : ""}" data-nav="${k}" ${subs ? `data-fly="${k}"` : ""}>${I(ic)}${H.t(lab)}${n ? `<span class="b ${bc || ""}">${n}</span>` : ""}</div>
        ${subs ? `<div class="fly" data-flyfor="${k}"><h6>${H.t(lab)}</h6>${subs.map(([t, l]) => `<a data-nav="${k}" data-tab="${t}">${l}</a>`).join("")}</div>` : ""}`; }).join("");
    return `<div class="brand" data-nav="${H.data.roles[H.state.user.role].home}"><div class="mk">h</div><small>homunculus</small></div>${items}<div class="spacer"></div>
      <div class="ri ${H.state.page === "settings" ? "on" : ""}" data-nav="settings">${I("gear")}${H.t("m_settings")}</div>`;
  }
  /* 24.09 (2. oturum) · Ozan: "admin'de tüm roller açık gelsin".
   * Karar (konsey): BT hesabı kendi başına hasta verisi GÖRMEZ (gerçek üründe de öyle olmalı). Bunun yerine
   * sistem yöneticisi her rolün ekranını "rol gözüyle bak" ile açar. Prototipte veri zaten uydurma; gerçek üründe
   * bu mod yalnız sentetik demo verisiyle çalışır ve her geçiş denetim kaydına yazılır. */
  const PREVIEW_EXTRAS = { hekim:["rrt"], hemsire:["charge"] };
  const realUser = () => H.state.realUser || H.state.user;
  const canPreview = () => realUser() && realUser().role === "sistem";
  function previewChip() {
    if (!canPreview()) return "";
    const u = H.state.user, on = !!H.state.realUser, r = H.data.roles[u.role];
    return `<div class="chip pv ${on ? "on" : ""}" data-menu="preview" title="${H.t("view_as")}">${I("eye")}<span>${on ? H.esc(r.name) : H.t("view_as")}</span>${I("chevD")}</div>`;
  }
  H.previewAs = (role) => {
    const me = realUser();
    if (!role || role === me.role) { H.state.user = me; H.state.realUser = null; H.log("rol önizleme kapandı"); }
    else { H.state.realUser = me;
      H.state.user = Object.assign({}, me, { role, extras:PREVIEW_EXTRAS[role] || [], units:H.units().map(x => x.id), preview:true });
      H.log("rol önizleme", H.data.roles[role].name + " gözüyle"); }
    H.state.unitId = null; const home = H.data.roles[H.state.user.role].home;
    H.go(H.pages[home] ? home : "settings", {});
  };
  /* 24.09 (3. oturum) · Ozan #63: üst çubuk MedRapor düzeninde — başlık solda, arama ortada, sağda tek sıra araç:
   * dil (bayrak + kod + ok, açılır liste) · tema · tam ekran · klavye kısayolları · bildirim · kişi. */
  const FS_IC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
  const KB_IC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>`;
  H.addT({
    tb_full:{ AZ:"Tam ekran", TR:"Tam ekran", RU:"Во весь экран", EN:"Full screen" },
    tb_keys:{ AZ:"Klaviatura qısayolları", TR:"Klavye kısayolları", RU:"Горячие клавиши", EN:"Keyboard shortcuts" },
    tb_k_search:{ AZ:"Xəstə / çarpayı axtar", TR:"Hasta / yatak ara", RU:"Поиск пациента / койки", EN:"Search patient / bed" },
    tb_k_close:{ AZ:"Pəncərəni bağla", TR:"Pencereyi kapat", RU:"Закрыть окно", EN:"Close window" },
    tb_k_lock:{ AZ:"Ekranı kilidlə", TR:"Ekranı kilitle", RU:"Заблокировать экран", EN:"Lock screen" },
    tb_k_full:{ AZ:"Tam ekran", TR:"Tam ekran", RU:"Во весь экран", EN:"Full screen" },
  });
  function topHtml() {
    const pg = H.pages[H.state.page], u = H.state.user, units = u.units.map(H.unit).filter(Boolean), cur = H.state.unitId ? H.unit(H.state.unitId) : null;
    const clinical = H.can("patient") || H.can("admission") || H.can("occupancy"), unread = H.myNotifs().filter(n => !n.read).length;
    // Birim seçici yalnız birden çok birimi olan ve hasta gören kullanıcıda; tüm hastaneyi gören roller (BT, kalite, biyomedikal) için anlamsız.
    const showUnits = units.length > 1 && units.length < H.units().length && (H.can("beds") || H.can("camera"));
    // 24.09 (3. oturum) · Ozan #92: üst çubuk sayfa başlığını tekrar etmesin → yol gösterici: hastane › sayfa › sekme.
    const nav = NAV.find(n => n[0] === H.state.page), tabL = nav && nav[6] && H.state.params && H.state.params.tab ? (nav[6].find(x => x[0] === H.state.params.tab) || [])[1] : null;
    const crumb = `<span class="cr-h">${H.esc(H.data.hospital.name)}</span>${I("chevR")}<span class="cr-p">${pg ? pg.title(H.state.params) : ""}</span>${tabL ? `${I("chevR")}<b>${H.esc(tabL)}</b>` : ""}`;
    return `<div class="title crumb">${crumb}</div>
      ${showUnits ? `<div class="chip" data-menu="unit">${I("building")}${cur ? H.esc(cur.tr) : "Birimlerim · " + units.length} ${I("chevD")}</div>` : ""}
      ${clinical ? `<label class="search">${I("search")}<input data-search placeholder="${H.t("search_ph")}"><kbd>Ctrl K</kbd></label>` : `<span style="margin-left:auto"></span>`}
      ${previewChip()}
      <div class="today" title="${H.esc(H.today())}">${I("clock")}<span>${H.esc(H.wd(0))} ${H.dm(0)}</span><b>${H.now()}</b></div>
      ${H.can("beds") || H.can("tasks") ? `<div class="shift" title="Nöbet ${H.SHIFT.start} → ${H.SHIFT.end}"><i></i>${H.t("shift_left_lbl")} <b>${H.SHIFT.left}</b></div>` : ""}
      <div class="tools">
        <button class="lsel" data-menu="lang" title="Dil / Language">${H.flagBox(H.state.lang)}<b>${H.state.lang}</b>${I("chevD")}</button>
        <button class="ib" data-theme-toggle title="${H.t(H.state.theme === "gece" ? "lg_day" : "lg_night")}">${I(H.state.theme === "gece" ? "sun" : "moon")}</button>
        <button class="ib" data-fullscreen title="${H.t("tb_full")}">${FS_IC}</button>
        <button class="ib" data-menu="keys" title="${H.t("tb_keys")}">${KB_IC}</button>
        <button class="ib" data-menu="notif" title="${H.t("notifs")}">${I("bell")}${unread ? `<span class="cnt">${unread}</span>` : ""}</button>
      </div>
      <div class="av" data-menu="user" title="${H.esc(u.name)}">${u.name.replace(/^(Dr\.|Ecz\.)\s*/, "").split(" ").map(s => s[0]).slice(0, 2).join("")}</div>`;
  }

  /* ---------- bildirim merkezi ---------- */
  const SEVN = { crit:"var(--crit)", high:"var(--high)", "":"var(--pri)" };
  function notifHtml() {
    const list = H.myNotifs(), unread = list.filter(n => !n.read).length;
    return `<div class="nh"><b>${H.t("notifs")}</b>${unread ? `<span class="pill">${unread} okunmadı</span>` : ""}<span class="r">${unread ? `<button class="btn g sm" data-nread>Tümünü okundu say</button>` : ""}</span></div>
      <div class="nl">${list.map(n => `<div class="ni ${n.read ? "" : "unread"}" data-nid="${n.id}" style="--c:${SEVN[n.sev] || SEVN[""]}"><i></i><div><b>${H.esc(n.title)}</b><span>${H.esc(n.body)}</span></div><time>${n.at}</time></div>`).join("") || `<div class="empty" style="margin:14px;border:0">Bildirim yok.</div>`}</div>
`;
  }
  // Canlı akış benzetimi: oturum açıkken arada bir rolüne uygun yeni bildirim düşer (prototip).
  const LIVE = { hekim:["Yeni sonuç", "REA02 · arter kan gazı sonuçlandı", ["patient", { pid:"p2", tab:"sonuc" }], "p2"], hemsire:["İş zamanı geldi", "Pozisyon verme · 22:00", ["tasks"], null],
    biyomed:["Arıza kaydı açıldı", "hs.sevda · REA03 infüzyon pompası tıkanma uyarısı veriyor", ["devices", { tab:"ariza" }], null], kabul:["Yeni yatış", "Ön kabul kaydı geldi · Genel Cerrahi Servisi", ["admission"], null],
    eczaci:["Yeni order", "REA01 · antibiyotik değişikliği", ["pharmacy"], null], yonetici:["Uzun yanıtsız alarm", "Bir alarm 10 dakikayı geçti · Erişkin Yoğun Bakım", ["quality"], null],
    kalite:["Uzun yanıtsız alarm", "Bir alarm 10 dakikayı geçti · Erişkin Yoğun Bakım", ["quality"], null], sistem:["Bağlantı düzeldi", "Hastane kaydı bağlantısı yeniden yanıt veriyor", ["admin", { tab:"integrations" }], null] };
  let liveTimer = null;
  function startLive() { clearTimeout(liveTimer); const u = H.state.user; if (!u) return; const d = LIVE[u.role]; if (!d) return;
    liveTimer = setTimeout(() => { if (H.state.user !== u) return;
      const n = H.pushNotif({ at:H.now(), to:[u.role], sev:"", title:d[0], body:d[1], go:d[2], pid:d[3] });
      H.toast(`${n.title} · ${n.body}`); H.renderApp(); }, 45000); }
  /* 24.09 · kilit ekranı (Ozan: "bize uygun olsun"). Giriş ekranının dili: koyu zemin, canlı saat, marka.
     Kilitliyken hasta verisi yok; yalnız birimdeki AÇIK alarmların SAYISI görünür (ad, yatak, değer yok) —
     paylaşılan istasyona bakan hemşire bir şey olup olmadığını kilidi açmadan anlar. Metinler 4 dilde. */
  H.addT({
    lk_title:{ AZ:"Ekran kilidlənib", TR:"Ekran kilitlendi", RU:"Экран заблокирован", EN:"Screen locked" },
    lk_idle:{ AZ:"Hərəkətsizlik səbəbilə · {t}-dan bəri", TR:"Hareketsizlik nedeniyle · {t}'den beri", RU:"Из-за бездействия · с {t}", EN:"Locked after inactivity · since {t}" },
    lk_manual:{ AZ:"Ekranı siz kilidlədiniz · {t}-dan bəri", TR:"Ekranı siz kilitlediniz · {t}'den beri", RU:"Вы заблокировали экран · с {t}", EN:"You locked the screen · since {t}" },
    lk_hidden:{ AZ:"Xəstə məlumatları gizlədilib", TR:"Hasta bilgileri gizlendi", RU:"Данные пациентов скрыты", EN:"Patient data is hidden" },
    lk_pw:{ AZ:"Şifrə", TR:"Şifre", RU:"Пароль", EN:"Password" },
    lk_open:{ AZ:"Kilidi aç", TR:"Kilidi aç", RU:"Разблокировать", EN:"Unlock" },
    lk_other:{ AZ:"Başqa istifadəçi ilə giriş", TR:"Başka kullanıcıyla giriş", RU:"Войти под другим пользователем", EN:"Sign in as someone else" },
    lk_err:{ AZ:"Şifrə yanlışdır.", TR:"Şifre hatalı.", RU:"Неверный пароль.", EN:"Wrong password." },
    lk_caps:{ AZ:"Caps Lock açıqdır", TR:"Caps Lock açık", RU:"Включён Caps Lock", EN:"Caps Lock is on" },
    lk_unit:{ AZ:"Bölmədə açıq siqnal", TR:"Birimde açık alarm", RU:"Открытые тревоги в отделении", EN:"Open alarms in the unit" },
    lk_none:{ AZ:"Açıq siqnal yoxdur", TR:"Açık alarm yok", RU:"Открытых тревог нет", EN:"No open alarms" },
    lk_seeing:{ AZ:"Təfərrüat üçün kilidi açın", TR:"Ayrıntı için kilidi açın", RU:"Подробности — после разблокировки", EN:"Unlock to see details" },
    lk_crit:{ AZ:"kritik", TR:"kritik", RU:"критич.", EN:"critical" }, lk_high:{ AZ:"yüksək", TR:"yüksek", RU:"высокие", EN:"high" }, lk_mid:{ AZ:"orta", TR:"orta", RU:"средние", EN:"medium" },
  });
  const hhmm = (d) => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const LOC = { AZ:"az-AZ", TR:"tr-TR", RU:"ru-RU", EN:"en-GB" };
  let lockTick = null;
  function lockHtml() {
    const u = H.state.user, now = new Date(), at = new Date(V.lockAt || Date.now());
    const ini = u.name.replace(/^(Dr\.|Ecz\.)\s*/, "").split(" ").map(s => s[0]).slice(0, 2).join("");
    const al = H.openAlarms(), cnt = (k) => al.filter(a => a.sev === k).length;
    const pills = [["crit", "var(--crit)"], ["high", "var(--high)"], ["mid", "var(--mid)"]].filter(([k]) => cnt(k)).map(([k, c]) => `<span class="lk-pill" style="--c:${c}"><i></i><b>${cnt(k)}</b> ${H.t("lk_" + k)}</span>`).join("");
    const date = now.toLocaleDateString(LOC[H.state.lang] || "tr-TR", { weekday:"long", day:"numeric", month:"long" });
    return `<div class="lock lk"><div class="lk-bg" aria-hidden="true"><i></i><i></i></div>
      <div class="lk-top"><div class="lk-brand"><span class="mk">h</span><div><b>homunculus</b><small>${H.esc(H.data.hospital.name)}</small></div></div><div class="lk-date">${H.esc(date)}</div></div>
      <div class="lk-mid">
        <div class="lk-clock mono" data-lk-clock>${hhmm(now)}</div>
        <div class="lk-card">
          <div class="lk-who"><span class="lk-av">${H.esc(ini)}</span><div><b>${H.esc(u.name)}</b><small>${H.esc(H.roleLabel(u))}</small></div></div>
          <div class="lk-state">${H.icon("lock")}<div><b>${H.t("lk_title")}</b><small>${H.t(V.lockWhy === "idle" ? "lk_idle" : "lk_manual").replace("{t}", hhmm(at))} · ${H.t("lk_hidden")}</small></div></div>
          ${V.err ? `<div class="lk-err" role="alert">${H.esc(V.err)}</div>` : ""}
          <form data-f="unlock" class="lk-form"><label class="lk-in">${H.icon("key")}<input name="p" type="password" placeholder="${H.t("lk_pw")}" autocomplete="current-password" autofocus aria-label="${H.t("lk_pw")}"></label>
            <div class="lk-caps" data-lk-caps hidden>${H.t("lk_caps")}</div>
            <button class="btn p lk-go">${H.icon("lock")}<span>${H.t("lk_open")}</span></button></form>
          <button class="lk-other" data-other>${H.t("lk_other")}</button>
        </div>
        <div class="lk-unit${al.length ? "" : " calm"}" aria-live="polite"><span class="lk-dot"></span><b>${al.length ? H.t("lk_unit") : H.t("lk_none")}</b>${pills}${al.length ? `<small>${H.t("lk_seeing")}</small>` : ""}</div>
      </div></div>`;
  }
  function lockLive() {
    clearInterval(lockTick);
    lockTick = setInterval(() => { const c = document.querySelector("[data-lk-clock]"); if (!V.locked || !c) return clearInterval(lockTick); c.textContent = hhmm(new Date()); }, 15000);
    const inp = document.querySelector('.lk input[name="p"]'), caps = document.querySelector("[data-lk-caps]");
    if (inp && caps) { const f = (e) => { caps.hidden = !(e.getModifierState && e.getModifierState("CapsLock")); }; inp.addEventListener("keydown", f); inp.addEventListener("keyup", f); }
  }

  let lastPage = null, lastBase = null;
  H.renderApp = (anim) => {
    document.body.dataset.theme = H.state.theme; document.body.dataset.size = H.state.size;
    const root = document.getElementById("root");
    if (!H.state.user) return renderAuth();
    if (V.locked) { root.innerHTML = lockHtml(); lockLive(); return; }
    // 24.09 (3. oturum) · yetkisiz sayfa sessizce ana sayfaya atmaz; açık bir ekran gösterir (MedRapor "YetkiYok" deseni).
    let denied = null;
    if (H.pages[H.state.page] && !allowed(H.pages[H.state.page].perm || [])) { denied = H.state.page; H.log("Yetkisiz sayfa denemesi", denied); }
    if (!H.pages[H.state.page] || denied) H.state.page = H.pages[H.data.roles[H.state.user.role].home] ? H.data.roles[H.state.user.role].home : "settings";
    let shell = root.querySelector(".shell");
    const scroll = shell ? shell.querySelector(".content").scrollTop : 0;
    if (!shell) { root.innerHTML = `<div class="shell"><nav class="rail"></nav><div class="main"><header class="top"></header><section class="content"></section></div></div>`; shell = root.querySelector(".shell"); }
    shell.querySelector(".rail").innerHTML = railHtml();
    shell.querySelector(".top").innerHTML = topHtml();
    if (H.announceBar) H.announceBar(shell.querySelector(".main"));   // 30.09 · Yönetim › Duyuru: hedefe uyan yayındaki duyuru şeridi (admin.js)
    const c = shell.querySelector(".content"), changed = lastPage !== H.state.page + JSON.stringify(H.state.params);
    const fresh = c.cloneNode(false); c.replaceWith(fresh);   // eski olay dinleyicilerini temizler
    if (denied) { fresh.innerHTML = `<div class="deny"><div class="ic">${I("shield")}</div><h3>${H.t("deny_t")}</h3><p>${H.t("deny_s")}</p><button class="btn p" data-nav="${H.state.page}">${H.t("deny_b")}</button></div>`; lastPage = null; return; }
    try { H.pages[H.state.page].render(fresh, H.state.params || {}); }
    catch (err) { console.error(err); fresh.innerHTML = `<div class="empty">Bu ekran yüklenirken bir hata oluştu: ${H.esc(err.message)}</div>`; }
    // 27.09 · #197 · aynı sayfada yalnız sekme değişince (hasta: Özet → Skorlar) en üste atma: sekme şeridinin hizasında kal.
    const noTab = (pg, pr) => pg + JSON.stringify(Object.assign({}, pr || {}, { tab:null }));
    const tabOnly = changed && lastPage && lastBase === noTab(H.state.page, H.state.params);
    const tbar = tabOnly && fresh.querySelector(".tabs");
    if (tbar) fresh.scrollTop = Math.min(scroll, Math.max(0, tbar.getBoundingClientRect().top - fresh.getBoundingClientRect().top));
    else if (changed || anim) { fresh.classList.add("swap"); fresh.scrollTop = 0; } else fresh.scrollTop = scroll;
    lastBase = noTab(H.state.page, H.state.params);
    // Başa dön: içerik 600 px'ten fazla kaydırılınca sağ altta belirir.
    let tt = shell.querySelector(".toTop");
    if (!tt) { tt = document.createElement("button"); tt.className = "toTop"; tt.innerHTML = I("chevD"); shell.querySelector(".main").appendChild(tt);
      tt.addEventListener("click", () => { const c2 = shell.querySelector(".content"); c2.scrollTo({ top:0, behavior:"smooth" }); }); }
    tt.title = H.t("to_top"); tt.setAttribute("aria-label", H.t("to_top"));
    const syncTop = () => tt.classList.toggle("show", fresh.scrollTop > 600); fresh.addEventListener("scroll", syncTop, { passive:true }); syncTop();
    lastPage = H.state.page + JSON.stringify(H.state.params);
  };
  /* 24.09 (3. oturum) · hareketsizlikte kilit: süre = kişinin seçtiği (Ayarlar → Güvenlik) ile hastane üst sınırının küçüğü.
   * Kilitlenmeden 60 sn önce geri sayımlı uyarı çıkar (MedRapor'da yoktu). Duvar monitörü sayfası istasyon ekranıdır, kilitlenmez. */
  H.addT({
    deny_t:{ AZ:"Bu səhifəyə icazəniz yoxdur", TR:"Bu sayfaya erişim yetkiniz yok", RU:"Нет доступа к этой странице", EN:"You don't have access to this page" },
    deny_s:{ AZ:"Lazımdırsa şöbə rəhbərinizdən və ya İT-dən icazə istəyin. Cəhd qeydə alındı.", TR:"Gerekiyorsa bölüm sorumlunuzdan ya da bilgi işlemden yetki isteyin. Deneme kayda geçti.", RU:"При необходимости запросите доступ у руководителя или ИТ. Попытка записана.", EN:"Ask your unit lead or IT for access if you need it. The attempt was logged." },
    deny_b:{ AZ:"Ana səhifəyə qayıt", TR:"Ana sayfaya dön", RU:"На главную", EN:"Back to home" },
    idle_t:{ AZ:"Ekran kilidlənəcək", TR:"Ekran kilitlenecek", RU:"Экран будет заблокирован", EN:"Screen will lock" },
    idle_s:{ AZ:"Hərəkət olmadığı üçün", TR:"Hareket olmadığı için", RU:"Из-за бездействия", EN:"Due to inactivity" },
    idle_b:{ AZ:"Davam et", TR:"Devam et", RU:"Продолжить", EN:"Stay signed in" },
  });
  let lastAct = Date.now();
  ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach(ev => document.addEventListener(ev, () => { lastAct = Date.now(); const w = document.querySelector(".idlewarn"); if (w && ev !== "mousemove") w.remove(); }, { passive:true, capture:true }));
  setInterval(() => {
    if (!H.state.user || V.locked || H.state.page === "wall") { const w = document.querySelector(".idlewarn"); if (w) w.remove(); return; }
    const max = (H.settings && +H.settings.sessionTimeout) || 15; let mine = max; try { mine = +(localStorage.getItem("hmc.lockMin") || max); } catch {}
    if (mine === 0) { const w0 = document.querySelector(".idlewarn"); if (w0) w0.remove(); return; }   // 25.09 · "hep açık": kişi kendi seçti
    const lim = Math.min(max, mine) * 60000, left = Math.ceil((lim - (Date.now() - lastAct)) / 1000);
    let w = document.querySelector(".idlewarn");
    if (left <= 0) { if (w) w.remove(); return H.lockScreen("idle"); }
    if (left <= 60) { if (!w) { w = document.createElement("div"); w.className = "idlewarn"; document.body.appendChild(w); }
      w.innerHTML = `${I("lock")}<div><b>${H.t("idle_t")} · <span class="mono">${left}</span> sn</b><small>${H.t("idle_s")}</small></div><button class="btn p sm" data-idle-ok>${H.t("idle_b")}</button>`; }
    else if (w) w.remove();
  }, 1000);
  document.addEventListener("click", e => { if (e.target.closest("[data-idle-ok]")) { lastAct = Date.now(); const w = document.querySelector(".idlewarn"); if (w) w.remove(); } });
  H.lockScreen = (why) => { V.locked = true; V.err = ""; V.lockAt = Date.now(); V.lockWhy = why === "idle" ? "idle" : "manual"; H.log("ekran kilitlendi"); H.renderApp(); };
  H.logout = () => { H.log("çıkış"); H.state.realUser = null; H.state.user = null; H.state.unitId = null; V.locked = false; closeMenus(); setView("login", "", "Güvenli çıkış yapıldı."); };

  /* ---------- menüler ---------- */
  function closeMenus() { document.querySelectorAll(".menu[data-shellmenu], .fly.open").forEach(m => m.classList.contains("menu") ? m.remove() : (m.classList.remove("open"), m.style.display = "none")); }
  function openMenu(anchor, html, cls = "") { closeMenus(); const m = document.createElement("div"); m.className = "menu " + cls; m.dataset.shellmenu = "1"; m.innerHTML = html; document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + 6) + "px"; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + "px"; }
  document.addEventListener("click", e => {
    if (!H.state.user || V.locked) return;
    const mn = e.target.closest("[data-menu]");
    if (mn) { e.stopPropagation(); const k = mn.dataset.menu, u = H.state.user;
      if (k === "notif") return openMenu(mn, notifHtml(), "ncenter");
      if (k === "preview") return openMenu(mn, `<div class="who"><b>${H.t("view_as")}</b><small>Her rolün menüsü ve ekranları, o rolün yetkisiyle. Her geçiş denetim kaydına yazılır.</small></div><hr>
        <a data-preview="">${I("shield")}${H.t("view_own")}${H.state.realUser ? "" : " ✓"}</a><hr>` +
        Object.entries(H.data.roles).filter(([k2]) => k2 !== "sistem").map(([k2, r]) => `<a data-preview="${k2}">${I(r.names ? "user" : "eye")}<span>${H.esc(r.name)}${PREVIEW_EXTRAS[k2] ? `<br><small class="mute">${PREVIEW_EXTRAS[k2].map(x => H.EXTRA[x].name).join(" · ")} dahil</small>` : ""}</span>${H.state.user.role === k2 && H.state.realUser ? " ✓" : ""}</a>`).join(""), "pvmenu");
      if (k === "user") return openMenu(mn, `<div class="who"><b>${H.esc(u.name)}</b><small>${H.esc(H.roleLabel(u))} · ${H.esc(u.title || "")}</small></div><hr>
        <a data-nav="profile">${I("key")}${H.t("profile")}</a><a data-nav="settings">${I("gear")}${H.t("m_settings")}</a><hr><a data-do="lock">${I("lock")}${H.t("lock")}</a><a data-do="logout">${I("out")}${H.t("logout")}</a>`);
      if (k === "lang") return openMenu(mn, H.LANGS.map(([l, n]) => `<a data-lang="${l}" class="lopt${H.state.lang === l ? " on" : ""}">${H.flagBox(l)}<span class="lt">${n}<small>${l}</small></span>${H.state.lang === l ? I("ok") : ""}</a>`).join(""), "lmenu");
      if (k === "keys") return openMenu(mn, `<div class="who"><b>${H.t("tb_keys")}</b></div><hr>` + [["Ctrl K · /", "tb_k_search"], ["Esc", "tb_k_close"], ["F11", "tb_k_full"], ["Alt L", "tb_k_lock"]].map(([k2, t]) => `<div class="krow"><span>${H.t(t)}</span><kbd>${k2}</kbd></div>`).join(""), "kmenu");
      if (k === "unit") return openMenu(mn, `<a data-unit="">Tüm birimlerim</a><hr>` + u.units.map(H.unit).filter(Boolean).map(x => `<a data-unit="${x.id}">${I("building")}<span>${H.esc(x.tr)}<br><small class="mute">${H.kindName(x.kind)} · ${H.floorText(x.floor)}</small></span></a>`).join(""));
    }
    const ni = e.target.closest("[data-nid]"); if (ni) { const n = H.data.notifs.find(x => x.id == ni.dataset.nid); closeMenus(); if (n) { n.read = true; H.log("bildirim açıldı", n.title); return n.go ? H.go(n.go[0], n.go[1] || {}) : H.renderApp(); } }
    if (e.target.closest("[data-nread]")) { H.myNotifs().forEach(n => n.read = true); closeMenus(); return H.renderApp(); }
    const pv = e.target.closest("[data-preview]"); if (pv) { closeMenus(); return H.previewAs(pv.dataset.preview); }
    const un = e.target.closest("[data-unit]"); if (un) { H.state.unitId = un.dataset.unit || null; closeMenus(); return H.renderApp(); }
    const dz = e.target.closest("[data-do]"); if (dz) { closeMenus(); return dz.dataset.do === "lock" ? H.lockScreen() : H.logout(); }
    if (e.target.closest("[data-fullscreen]")) { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); return; }
    if (e.target.closest("[data-theme-toggle]")) { H.state.theme = H.state.theme === "gece" ? "gun" : "gece"; H.savePref("theme", H.state.theme); return H.renderApp(); }
    const nv = e.target.closest("[data-nav]");
    if (nv && !nv.closest(".content")) { e.preventDefault(); closeMenus(); const params = nv.dataset.tab ? { tab:nv.dataset.tab } : {}; return H.go(nv.dataset.nav, params); }
    if (!e.target.closest(".menu")) closeMenus();
  });
  // alt menü: üzerine gelince aç (fixed konum, ray kaydırılsa da kırpılmasın)
  document.addEventListener("mouseover", e => {
    const ri = e.target.closest("[data-fly]"); const fly = e.target.closest(".fly");
    document.querySelectorAll(".fly").forEach(f => { if (f !== fly && (!ri || f.dataset.flyfor !== ri.dataset.fly)) f.style.display = "none"; });
    if (ri) { const f = document.querySelector(`.fly[data-flyfor="${ri.dataset.fly}"]`); if (f) { const r = ri.getBoundingClientRect(); f.style.display = "block"; f.style.left = (r.right - 4) + "px"; f.style.top = Math.min(innerHeight - f.offsetHeight - 8, r.top - 4) + "px"; } }
  });
  // arama: yatak no ya da ad
  document.addEventListener("keydown", e => {
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === "l" && H.state.user) { e.preventDefault(); return H.lockScreen(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && H.state.user) { e.preventDefault(); const s = document.querySelector("[data-search]"); if (s) s.focus(); }
    // 24.09 (2. oturum) · kısayollar: Esc açık pencereyi/menüyü kapatır, "/" aramaya gider (yazı alanında değilken)
    if (e.key === "Escape" && H.state.user) { if (document.getElementById("modalBg")) H.closeModal(); closeMenus(); }
    if (e.key === "/" && H.state.user && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || "")) && !e.target.isContentEditable) { const s = document.querySelector("[data-search]"); if (s) { e.preventDefault(); s.focus(); } }
    const s = e.target.closest && e.target.closest("[data-search]");
    if (s && e.key === "Enter") { const q = s.value.trim().toLowerCase(); if (!q) return;
      const p = H.myPatients().find(x => x.name.toLowerCase().includes(q) || H.bed(x.bed).no.toLowerCase() === q);
      if (p && H.can("patient")) H.go("patient", { pid:p.id, tab:"ozet" }); else H.toast(p ? "Hasta ekranına erişim yetkiniz yok." : "Birimlerinizde eşleşen hasta yok.", "w"); }
  });

  /* ---------- açılış ---------- */
  document.documentElement.lang = H.state.lang.toLowerCase();
  H.renderApp();
})();
