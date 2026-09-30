/* Homunculus prototip v1 — çekirdek.
 * Bütün modüller window.H üzerinden konuşur. Veri tamamen SENTETİKTİR; gerçek kişi, hasta ya da personel adı yoktur.
 * Sayfa yenilenince demo verisi başa döner (tercihler hariç). */
(function () {
  const H = (window.H = {});

  /* ================= simgeler ================= */
  const P = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    clip:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
    userPlus:'<circle cx="9" cy="7" r="4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M19 8v6M22 11h-6"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    pill:'<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    cpu:'<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
    chart:'<path d="M3 3v18h18"/><path d="M7 16V9M12 16V5M17 16v-4"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    tv:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    gear:'<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    flask:'<path d="M9 3h6M10 3v6L4 20h16L14 9V3"/>', plug:'<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    bed:'<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>', clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    ok:'<path d="M20 6 9 17l-5-5"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>', plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', key:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    building:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    tree:'<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-3h14v3"/>',
    heart:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', drop:'<path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0Z"/>',
    thermo:'<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0Z"/>', syringe:'<path d="m18 2 4 4M17 7l3-3M19 9 8.7 19.3a2.4 2.4 0 0 1-3.4 0l-.6-.6a2.4 2.4 0 0 1 0-3.4L15 5M9 11l4 4M5 19l-3 3M14 4l6 6"/>',
    food:'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    body:'<circle cx="12" cy="4" r="2"/><path d="M12 6v8M8 9h8M9 22l3-8 3 8"/>', qr:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
    tablet:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/>', wifi:'<path d="M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"/>',
    edit:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', print:'<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    chevR:'<path d="m9 18 6-6-6-6"/>', chevL:'<path d="m15 18-6-6 6-6"/>', chevD:'<path d="m6 9 6 6 6-6"/>', globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
    zap:'<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>', eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>', swap:'<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    star:'<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>', link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  };
  H.icon = (k, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[k] || P.grid}</svg>`;

  /* ================= bayraklar ================= */
  const star8 = (cx, cy, r) => { let d = ""; for (let i = 0; i < 16; i++) { const a = Math.PI / 8 * i - Math.PI / 2, rr = i % 2 ? r * .45 : r; d += (i ? "L" : "M") + (cx + rr * Math.cos(a)).toFixed(2) + " " + (cy + rr * Math.sin(a)).toFixed(2); } return d + "Z"; };
  const star5 = (cx, cy, r, rot = 0) => { let d = ""; for (let i = 0; i < 10; i++) { const a = Math.PI / 5 * i + rot, rr = i % 2 ? r * .38 : r; d += (i ? "L" : "M") + (cx + rr * Math.cos(a)).toFixed(2) + " " + (cy + rr * Math.sin(a)).toFixed(2); } return d + "Z"; };
  /* 24.09 (2. oturum): bayraklar yeniden çizildi. Hepsi 3:2 kutuda, SVG kutuyu doldurur (slice),
   * çerçeve .flagbox sınıfında. Eski sürümde .ib svg kuralı bayrağı 19×19 kareye eziyordu. */
  let flagSeq = 0;
  const FLAG = {
    AZ:() => `<svg viewBox="0 0 30 20"><rect width="30" height="6.67" fill="#00B5E2"/><rect y="6.67" width="30" height="6.67" fill="#EF3340"/><rect y="13.33" width="30" height="6.67" fill="#509E2F"/><circle cx="14.1" cy="10" r="2.5" fill="#fff"/><circle cx="14.72" cy="10" r="2.05" fill="#EF3340"/><path d="${star8(16.95, 10, 1.15)}" fill="#fff"/></svg>`,
    TR:() => `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#E30A17"/><circle cx="10" cy="10" r="5" fill="#fff"/><circle cx="11.25" cy="10" r="4" fill="#E30A17"/><path d="${star5(14.58, 10, 2.5, Math.PI)}" fill="#fff"/></svg>`,
    RU:() => `<svg viewBox="0 0 30 20"><rect width="30" height="6.67" fill="#fff"/><rect y="6.67" width="30" height="6.67" fill="#0039A6"/><rect y="13.33" width="30" height="6.67" fill="#D52B1E"/></svg>`,
    EN:() => { const i = ++flagSeq; return `<svg viewBox="0 0 60 30"><clipPath id="ukS${i}"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="ukT${i}"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><g clip-path="url(#ukS${i})"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#ukT${i})" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g></svg>`; },
  };
  H.flag = (l) => FLAG[l] ? FLAG[l]().replace("<svg ", `<svg preserveAspectRatio="xMidYMid slice" `) : "";
  H.flagBox = (l, cls = "") => `<span class="flagbox ${cls}">${H.flag(l)}</span>`;
  H.LANGS = [["AZ", "Azərbaycan"], ["TR", "Türkçe"], ["RU", "Русский"], ["EN", "English"]];

  /* ================= dil (arayüz iskeleti) =================
   * Not: AZ/RU/EN karşılıkları taslaktır, yerel kontrol gerekir. Form içerikleri şimdilik Türkçe. */
  const T = {
    login_title:{ AZ:"Daxil olun", TR:"Oturum açın", RU:"Вход в систему", EN:"Sign in" },
    login_sub:{ AZ:"Kurumsal istifadəçi adınız və şifrənizlə", TR:"Kurumsal kullanıcı adınız ve şifrenizle", RU:"С корпоративным логином и паролем", EN:"With your hospital username and password" },
    username:{ AZ:"İstifadəçi adı", TR:"Kullanıcı adı", RU:"Имя пользователя", EN:"Username" },
    password:{ AZ:"Şifrə", TR:"Şifre", RU:"Пароль", EN:"Password" },
    remember:{ AZ:"İstifadəçi adını xatırla", TR:"Kullanıcı adımı hatırla", RU:"Запомнить имя", EN:"Remember username" },
    signin:{ AZ:"Daxil ol", TR:"Giriş yap", RU:"Войти", EN:"Sign in" },
    forgot:{ AZ:"Şifrəni unutmusunuz?", TR:"Şifremi unuttum", RU:"Забыли пароль?", EN:"Forgot password?" },
    hero_title:{ AZ:"Hər çarpayı, hər növbə — bir baxışda.", TR:"Her yatak, her nöbet — tek bakışta.", RU:"Каждая койка, каждая смена — на одном экране.", EN:"Every bed, every shift — at a glance." },
    hero_sub:{ AZ:"Cihazlardan gələn məlumatı toplayır, pisləşməni erkən göstərir, doğru komandanı çağırır. Qərarı həkim verir.", TR:"Cihazlardan gelen veriyi toplar, kötüleşmeyi erken gösterir, doğru ekibi çağırır. Kararı hekim verir.", RU:"Собирает данные с приборов, рано показывает ухудшение, вызывает нужную команду. Решение за врачом.", EN:"Collects device data, surfaces deterioration early and calls the right team. The physician decides." },
    m_beds:{ AZ:"Çarpayılar", TR:"Yataklar", RU:"Койки", EN:"Beds" },
    m_tasks:{ AZ:"Tapşırıqlar", TR:"Görevlerim", RU:"Задачи", EN:"My tasks" },
    m_bedside:{ AZ:"Ölçmə", TR:"Yatak başı", RU:"У койки", EN:"Bedside" },
    m_alarms:{ AZ:"Siqnallar", TR:"Alarmlar", RU:"Тревоги", EN:"Alarms" },
    m_hand:{ AZ:"Təhvil", TR:"Devir", RU:"Передача", EN:"Handover" },
    m_patient:{ AZ:"Xəstə", TR:"Hasta", RU:"Пациент", EN:"Patient" },
    m_admission:{ AZ:"Qəbul", TR:"Kabul", RU:"Приём", EN:"Admission" },
    m_rrt:{ AZ:"Təcili", TR:"Hızlı yanıt", RU:"Бригада", EN:"Rapid resp." },
    m_pharmacy:{ AZ:"Aptek", TR:"Eczane", RU:"Аптека", EN:"Pharmacy" },
    m_devices:{ AZ:"Cihazlar", TR:"Cihazlar", RU:"Приборы", EN:"Devices" },
    m_summary:{ AZ:"İcmal", TR:"Özet", RU:"Сводка", EN:"Summary" },
    m_admin:{ AZ:"İdarə", TR:"Yönetim", RU:"Управление", EN:"Admin" },
    m_occupancy:{ AZ:"Doluluq", TR:"Doluluk", RU:"Занятость", EN:"Occupancy" },
    m_camera:{ AZ:"Kameralar", TR:"Kameralar", RU:"Камеры", EN:"Cameras" },
    m_quality:{ AZ:"Keyfiyyət", TR:"Kalite", RU:"Качество", EN:"Quality" },
    m_audit:{ AZ:"Audit jurnalı", TR:"Denetim kaydı", RU:"Журнал аудита", EN:"Audit log" },
    notifs:{ AZ:"Bildirişlər", TR:"Bildirimler", RU:"Уведомления", EN:"Notifications" },
    shift_eve:{ AZ:"Axşam növbəsi", TR:"Akşam nöbeti", RU:"Вечерняя смена", EN:"Evening shift" },
    m_settings:{ AZ:"Ayarlar", TR:"Ayarlar", RU:"Настройки", EN:"Settings" },
    logout:{ AZ:"Çıxış", TR:"Çıkış", RU:"Выход", EN:"Sign out" },
    lock:{ AZ:"Ekranı kilidlə", TR:"Ekranı kilitle", RU:"Заблокировать", EN:"Lock screen" },
    profile:{ AZ:"Profil və şifrə", TR:"Profil ve şifre", RU:"Профиль и пароль", EN:"Profile & password" },
    search_ph:{ AZ:"Xəstə, çarpayı, protokol axtar", TR:"Hasta, yatak, protokol ara", RU:"Поиск пациента, койки", EN:"Search patient, bed" },
    shift_left_lbl:{ AZ:"Növbənin sonuna", TR:"Nöbet bitimine", RU:"До конца смены", EN:"Shift ends in" },
    view_as:{ AZ:"Rol baxışı", TR:"Rol gözüyle bak", RU:"Просмотр как роль", EN:"View as role" },
    view_own:{ AZ:"Öz görünüşüm", TR:"Kendi görünümüm", RU:"Мой вид", EN:"My own view" },
    to_top:{ AZ:"Yuxarı qayıt", TR:"Başa dön", RU:"Наверх", EN:"Back to top" },
    shift_left:{ AZ:"növbənin sonuna", TR:"nöbetin bitmesine", RU:"до конца смены", EN:"left in shift" },
    save:{ AZ:"Yadda saxla", TR:"Kaydet", RU:"Сохранить", EN:"Save" },
    save_sign:{ AZ:"Möhürlə", TR:"Mühürle", RU:"Скрепить", EN:"Seal" },
    save_draft:{ AZ:"Qaralamanı saxla", TR:"Taslağı sakla", RU:"Сохранить черновик", EN:"Keep draft" },
    cancel:{ AZ:"İmtina", TR:"Vazgeç", RU:"Отмена", EN:"Cancel" },
    close:{ AZ:"Bağla", TR:"Kapat", RU:"Закрыть", EN:"Close" },
    lang_note:{ AZ:"Menyu və başlıqlar seçilmiş dildədir; forma məzmunu hazırda türkcədir.", TR:"Menü ve başlıklar seçili dilde; form içerikleri şimdilik Türkçe.", RU:"Меню на выбранном языке; содержимое форм пока на турецком.", EN:"Menus follow your language; form content is Turkish for now." },
  };
  H.t = (k) => (T[k] && (T[k][H.state.lang] || T[k].TR)) || k;
  // 24.09 (2. oturum): modüller kendi ekran sözlüklerini ekler → H.addT({ anahtar:{ AZ, TR, RU, EN } }). Aynı anahtar iki kez eklenirse ilki kalır.
  H.addT = (dict) => { Object.keys(dict).forEach(k => { if (!T[k]) T[k] = dict[k]; }); };

  /* ================= durum ve tercihler ================= */
  const pref = (k, d) => { try { return localStorage.getItem("hmc." + k) ?? d; } catch { return d; } };
  H.savePref = (k, v) => { try { localStorage.setItem("hmc." + k, v); } catch {} };
  H.state = { user:null, lang:pref("lang", "AZ"), theme:pref("theme", "gece"), size:pref("size", "normal"), bedView:pref("bedView", "kart"),
              page:null, params:{}, unitId:null, rememberUser:pref("rememberUser2", "") };

  /* ================= hastane yapısı: Blok > Mərtəbə (kat) > Birim > Oda > Yatak =================
   * 24.09: Ozan'ın paylaştığı birim ağacı örnek alındı (Blok/Mərtəbə, kodlu odalar, yatak tipi, kullanım dışı).
   * Birim katmanları (Eleştirmen, konsey 24.09):
   *   tam  → skor + eskalasyon + öneri (yalnız erişkin ve yenidoğan yoğun bakım)
   *   ara  → vital izleme + erken uyarı skoru, hastanenin onayıyla (servisler, PICU, KVC YB, kemik iliği)
   *   op   → yalnız operasyonel: yatak/doluluk, kabul/taburcu, cihaz. Klinik öneri YOK. */
  // rooms: oda sayısı ya da oda adları dizisi; opt: { per, iso:[oda no], bedType, prefix }
  const beds = (unit, rooms, per = 1, opt = {}) => { const out = []; let n = 1, list = Array.isArray(rooms) ? rooms : Array.from({ length:rooms }, (_, i) => String(i + 1));
    list.forEach((r, ri) => { for (let b = 1; b <= per; b++) out.push({ id:`${unit}-${n}`, no:`${(opt.prefix || unit).toUpperCase()}${String(n).padStart(2, "0")}`, room:r, status:"bos", type:opt.bedType || "Yatak", iso:(opt.iso || []).includes(ri + 1), oos:false, clean:"temiz" }), n++; });
    return out; };
  const U = (id, name, tr, type, kind, tier, ageGroup, rule, bedList, code) => ({ id, name, tr, type, kind, tier, ageGroup, rule, beds:bedList, code });
  H.data = {};
  H.data.hospital = { name:"Klinik Xəstəxana", short:"KX", city:"Bakı",
    buildings:[{ id:"A", name:"1. Blok · Əsas bina", floors:[
      { id:"A0", no:0, units:[U("aci", "Təcili Yardım", "Acil Servis", "op", "er", "op", "adult", "—", [...beds("aci", ["Resus-1", "Resus-2"], 1, { bedType:"Resüsitasyon sedyesi" }), ...beds("aci", ["Müşahidə"], 6, { bedType:"Gözlem sedyesi" }).map((b, i) => Object.assign(b, { id:"aci-" + (i + 3), no:"ACI" + String(i + 3).padStart(2, "0") }))], "1101")] },
      { id:"A2", no:2, units:[U("dax", "Daxili Xəstəliklər Servisi", "Dahiliye Servisi", "ward", "ward", "ara", "adult", "NEWS2", beds("dax", 6, 2, { bedType:"Servis yatağı", iso:[6] }), "2201")] },
      { id:"A3", no:3, units:[U("cer", "Cərrahiyyə Servisi", "Genel Cerrahi Servisi", "ward", "ward", "ara", "adult", "NEWS2", beds("cer", 5, 2, { bedType:"Servis yatağı" }), "2301")] },
      { id:"A4", no:4, units:[
        U("rea", "Reanimasiya (Böyüklər)", "Erişkin Yoğun Bakım", "icu", "icu", "tam", "adult", "SOFA + NEWS2", beds("rea", ["ICU-01", "ICU-02", "ICU-03", "ICU-04", "ICU-05", "ICU-06", "ICU-07", "ICU-08"], 1, { bedType:"GYBÜ yatağı", iso:[1, 2] }), "2411"),
        U("kvc", "KVC Reanimasiyası", "Kalp-Damar Cerrahisi Yoğun Bakım", "icu", "cvicu", "ara", "adult", "SOFA + NEWS2", beds("kvc", ["KVC-01", "KVC-02", "KVC-03", "KVC-04"], 1, { bedType:"KVC YB yatağı" }), "2431")] },
      { id:"A5", no:5, units:[U("anj", "Anjio Xidməti", "Anjiyografi Ünitesi", "op", "cath", "op", "adult", "—", beds("anj", ["Hazırlıq / müşahidə"], 3, { bedType:"İşlem sonrası sedye" }), "2501")] },
    ]}, { id:"B", name:"2. Blok · Uşaq, Ana və Onkologiya", floors:[
      { id:"B1", no:1, units:[
        U("usq", "Uşaq Servisi", "Çocuk Servisi", "ward", "ward", "ara", "child", "PEWS", beds("usq", 4, 2, { bedType:"Çocuk yatağı" }), "3101"),
        U("bbk", "Körpə Otağı", "Bebek Odası (sağlıklı yenidoğan)", "op", "nursery", "op", "neonate", "—", beds("bbk", ["Körpə otağı"], 6, { bedType:"Beşik" }), "3102")] },
      { id:"B2", no:2, units:[
        U("nic", "Yenidoğulmuş Reanimasiyası", "Yenidoğan Yoğun Bakım", "nicu", "nicu", "tam", "neonate", "nSOFA", beds("nic", ["NICU-01", "NICU-02", "NICU-03", "NICU-04", "NICU-05", "NICU-06"], 1, { bedType:"Küvöz", iso:[6] }), "3201"),
        U("pic", "Uşaq Reanimasiyası", "Çocuk Yoğun Bakım (PICU)", "icu", "picu", "ara", "child", "PEWS", beds("pic", ["PICU-01", "PICU-02", "PICU-03", "PICU-04"], 1, { bedType:"Çocuk YB yatağı", iso:[4] }), "3211")] },
      { id:"B3", no:3, units:[
        U("kem", "Kimya Terapiyası", "Kemoterapi Günübirlik", "op", "chemo", "op", "adult", "—", beds("kem", ["Otaq 1", "Otaq 2"], 4, { bedType:"Kemoterapi koltuğu" }), "3301"),
        U("gun", "Günübirlik Xidmət", "Günübirlik Hizmet", "op", "day", "op", "adult", "—", beds("gun", ["Otaq 1", "Otaq 2"], 3, { bedType:"Günübirlik yatak" }), "3302")] },
      { id:"B4", no:4, units:[U("bmt", "Sümük İliyi Köçürülməsi", "Kemik İliği Nakli", "ward", "bmt", "ara", "adult", "NEWS2", beds("bmt", ["BMT-01", "BMT-02", "BMT-03", "BMT-04"], 1, { bedType:"İzolasyon yatağı", iso:[1, 2, 3, 4] }), "3401")] },
      { id:"B6", no:6, units:[U("ivf", "IVF Günübirlik Xidmət", "Tüp Bebek (IVF) Günübirlik", "op", "ivf", "op", "adult", "—", beds("ivf", ["IVF otağı"], 3, { bedType:"Günübirlik yatak" }), "3601")] },
    ]}]};
  /* 24.09 · birim, bina ve kat adları dile göre değişir (Ozan: "dil değişince bölüm isimleri değişmiyor").
   * u.names = {AZ,TR,RU,EN}. u.name → AZ adı (resmî ad), u.tr → SEÇİLİ DİLDEKİ ad (ekranlarda kullanılan). Çeviriler taslaktır, yerel okuma gerekir. */
  const UN = {
    aci:["Təcili Yardım", "Acil Servis", "Приёмное отделение", "Emergency Department"],
    dax:["Daxili Xəstəliklər Servisi", "Dahiliye Servisi", "Терапевтическое отделение", "Internal Medicine Ward"],
    cer:["Cərrahiyyə Servisi", "Genel Cerrahi Servisi", "Хирургическое отделение", "General Surgery Ward"],
    rea:["Reanimasiya (Böyüklər)", "Erişkin Yoğun Bakım", "Реанимация (взрослые)", "Adult ICU"],
    kvc:["KVC Reanimasiyası", "Kalp-Damar Cerrahisi Yoğun Bakım", "Кардиохирургическая реанимация", "Cardiovascular Surgery ICU"],
    anj:["Anjio Xidməti", "Anjiyografi Ünitesi", "Ангиография", "Angiography Unit"],
    usq:["Uşaq Servisi", "Çocuk Servisi", "Детское отделение", "Paediatric Ward"],
    bbk:["Körpə Otağı", "Bebek Odası", "Палата новорождённых", "Newborn Nursery"],
    nic:["Yenidoğulmuş Reanimasiyası", "Yenidoğan Yoğun Bakım", "Реанимация новорождённых", "Neonatal ICU"],
    pic:["Uşaq Reanimasiyası", "Çocuk Yoğun Bakım", "Детская реанимация", "Paediatric ICU"],
    kem:["Kimya Terapiyası", "Kemoterapi Günübirlik", "Химиотерапия (дневной стационар)", "Chemotherapy Day Unit"],
    gun:["Günübirlik Xidmət", "Günübirlik Hizmet", "Дневной стационар", "Day Care Unit"],
    bmt:["Sümük İliyi Köçürülməsi", "Kemik İliği Nakli", "Трансплантация костного мозга", "Bone Marrow Transplant"],
    ivf:["IVF Günübirlik Xidmət", "Tüp Bebek (IVF) Günübirlik", "ЭКО (дневной стационар)", "IVF Day Unit"],
  };
  const BN = { A:["1. Blok · Əsas bina", "1. Blok · Ana bina", "Корпус 1 · Главный", "Block 1 · Main building"], B:["2. Blok · Uşaq, Ana və Onkologiya", "2. Blok · Çocuk, Anne ve Onkoloji", "Корпус 2 · Детство, материнство, онкология", "Block 2 · Children, Maternity and Oncology"] };
  const LI = { AZ:0, TR:1, RU:2, EN:3 };
  H.lname = (names) => names ? (names[H.state.lang] || names.TR || names.AZ || "") : "";
  const localize = (u) => { if (Object.getOwnPropertyDescriptor(u, "tr") && Object.getOwnPropertyDescriptor(u, "tr").get) return u;
    const arr = UN[u.id]; u.names = u.names || (arr ? { AZ:arr[0], TR:arr[1], RU:arr[2], EN:arr[3] } : { AZ:u.name, TR:u.tr });
    delete u.name; delete u.tr; if (u.active === undefined) u.active = true;
    Object.defineProperty(u, "name", { get() { return this.names.AZ; }, set(v) { this.names.AZ = v; }, enumerable:true, configurable:true });
    Object.defineProperty(u, "tr", { get() { return H.lname(this.names); }, set(v) { this.names.TR = v; }, enumerable:true, configurable:true });
    return u; };
  H.localizeUnit = localize;
  H.data.hospital.buildings.forEach(b => { const a = BN[b.id]; b.names = b.names || (a ? { AZ:a[0], TR:a[1], RU:a[2], EN:a[3] } : { AZ:b.name, TR:b.name }); delete b.name; if (b.active === undefined) b.active = true;
    Object.defineProperty(b, "name", { get() { return H.lname(this.names); }, set(v) { this.names.AZ = v; this.names.TR = v; }, enumerable:true, configurable:true });
    b.floors.forEach(f => { if (f.active === undefined) f.active = true; f.units.forEach(localize); }); });
  // Birim türü etiketi ve katman açıklaması (ekranlarda tek kaynak)
  H.KIND = { icu:"Yoğun bakım", cvicu:"KVC yoğun bakım", picu:"Çocuk yoğun bakım", nicu:"Yenidoğan yoğun bakım", ward:"Servis", bmt:"Kemik iliği nakli", er:"Acil servis",
    cath:"Anjiyografi", chemo:"Kemoterapi günübirlik", day:"Günübirlik", ivf:"IVF günübirlik", nursery:"Bebek odası" };
  const KN = { icu:["Reanimasiya", "Реанимация", "ICU"], cvicu:["KVC reanimasiyası", "Кардиореанимация", "CV ICU"], picu:["Uşaq reanimasiyası", "Детская реанимация", "PICU"], nicu:["Yenidoğulmuş reanimasiyası", "Реанимация новорождённых", "NICU"],
    ward:["Servis", "Отделение", "Ward"], bmt:["Sümük iliyi köçürülməsi", "Трансплантация КМ", "BMT"], er:["Təcili yardım", "Приёмное", "Emergency"], cath:["Anjioqrafiya", "Ангиография", "Cath lab"],
    chemo:["Kimya terapiyası", "Химиотерапия", "Chemotherapy"], day:["Günübirlik", "Дневной стационар", "Day care"], ivf:["IVF", "ЭКО", "IVF"], nursery:["Körpə otağı", "Палата новорождённых", "Nursery"] };
  H.kindName = (k) => { const i = { AZ:0, RU:1, EN:2 }[H.state.lang]; return i === undefined || !KN[k] ? H.KIND[k] || k : KN[k][i]; };
  H.TIER = { tam:["Tam izlem", "Skor, eskalasyon ve öneri"], ara:["Vital izlem", "Vital + erken uyarı skoru; eşikler hastanenin onayıyla"], op:["Operasyonel", "Yatak, kabul/taburcu, cihaz. Klinik öneri yok"] };
  H.isClinical = (u) => u && u.tier !== "op";
  // Pasif bina/kat/birim klinik ekranlarda görünmez; yönetim ağacı H.allUnits() ile hepsini görür.
  H.allUnits = () => H.data.hospital.buildings.flatMap(b => b.floors.flatMap(f => f.units.map(u => { localize(u); u.building = b.id; u.floor = f.no; u.live = b.active !== false && f.active !== false && u.active !== false; return u; })));
  H.units = () => H.allUnits().filter(u => u.live);
  H.unit = (id) => H.allUnits().find(u => u.id === id);
  H.bed = (id) => { for (const u of H.allUnits()) { const b = u.beds.find(x => x.id === id); if (b) return Object.assign(b, { unitId:u.id }); } return null; };

  /* ================= roller ve yetkiler ================= */
  /* 24.09 · rol modeli sadeleşti (öneri, Ozan'ın onayını bekliyor):
   *   rol = kişinin İŞİ (8 rol) · "sorumlu" = hemşireye eklenen işaret · "hızlı yanıt" = hekim/hemşireye verilen NÖBET GÖREVİ.
   *   names:false → bu rol hasta adını hiçbir ekranda görmez (yalnız yatak no). En az yetki: kimse işi olmayan ekranı görmez.
   *   engine → gerçek üründeki karşılığı (homunculus-engine auth/models.py UserRole). "—" = motorda yok, eklenmesi gerekir. */
  H.data.roles = {
    hekim:    { group:"Klinik", name:"Hekim", az:"Həkim", names:true, engine:"ATTENDING · ASSOCIATE · ONCALL · UNIT_PHYSICIAN",
                perms:["beds","patient","alarms","hand","results","orders","scores_sign","admission_view","camera"], home:"beds" },
    hemsire:  { group:"Klinik", name:"Hemşire", az:"Tibb bacısı", names:true, engine:"NURSE (sorumlu işaretliyse CHARGE_NURSE)",
                perms:["beds","patient","tasks","bedside","alarms","hand","forms"], home:"tasks" },
    eczaci:   { group:"Destek", name:"Eczacı", az:"Əczaçı", names:true, engine:"PHARMACIST",
                perms:["pharmacy","patient"], home:"pharmacy" },
    biyomed:  { group:"Destek", name:"Biyomedikal", az:"Biotibbi mühəndis", names:false, engine:"BIOMEDICAL",
                perms:["devices","maintenance"], home:"devices" },
    kabul:    { group:"Destek", name:"Hasta kabul", az:"Qəbul əməkdaşı", names:true, engine:"— (motorda yok)",
                perms:["admission","occupancy"], home:"admission" },
    yonetici: { group:"Yönetim", name:"Başhekim / yönetici", az:"Baş həkim / rəhbər", names:false, engine:"— (HOSPITAL_ADMIN'in bir kısmı)",
                perms:["summary","quality","occupancy","audit"], home:"summary" },
    kalite:   { group:"Yönetim", name:"Kalite", az:"Keyfiyyət", names:false, engine:"AUDITOR",
                perms:["quality","audit"], home:"quality" },
    sistem:   { group:"Yönetim", name:"Sistem yöneticisi (BT)", az:"Sistem inzibatçısı (İT)", names:false, engine:"HOSPITAL_ADMIN",
                perms:["admin_users","admin_structure","admin_roles","admin_system","admin_integrations","admin_camera","audit","occupancy"], home:"admin" },
  };
  // Role eklenen işaret ve görevler: kendi başına rol değildir, kişinin rolüne yetki ekler.
  H.EXTRA = {
    charge: { name:"Sorumlu hemşire", az:"Baş tibb bacısı", for:["hemsire"], perms:["admission","staff_view","camera","occupancy"], engine:"CHARGE_NURSE" },
    rrt:    { name:"Hızlı yanıt ekibi", az:"Təcili cavab komandası", for:["hekim","hemsire"], perms:["rrt"], engine:"RAPID_RESPONSE", duty:true },
  };
  /* 24.09 · modül erişimi: her yetki üç düzeyli — yok / görür / düzenler.
   *   role.perms = görebildikleri · role.ro = bunlardan yalnız GÖREBİLDİKLERİ (düzenleyemez)
   *   hasta ekranı sekmeleri de ayrı yetki: pt_ozet, pt_trend … (eczacı yalnız özet/ilaç/sonuç görür gibi)
   *   kişiye özel istisna: user.grant[] (ek yetki), user.deny[] (kısıt) — rolün üstüne uygulanır, denetim kaydına yazılır. */
  H.PT_TABS = [["ozet", "Özet"], ["trend", "Trendler"], ["skor", "Skorlar"], ["takip", "Takip"], ["bakim", "Bakım planı"], ["ilac", "İlaç"], ["sivi", "Sıvı"], ["sonuc", "Sonuçlar"], ["kamera", "Kamera"], ["devir", "Teslim notu"], ["belge", "Belgeler"]];
  const PT_ALL = H.PT_TABS.map(t => "pt_" + t[0]).filter(k => k !== "pt_kamera");
  H.data.roles.hekim.perms.push(...PT_ALL, "pt_kamera"); H.data.roles.hekim.ro = ["pt_bakim", "pt_takip"];
  H.data.roles.hemsire.perms.push(...PT_ALL); H.data.roles.hemsire.ro = ["pt_skor", "pt_ilac", "pt_sonuc"];
  H.data.roles.eczaci.perms.push("pt_ozet", "pt_ilac", "pt_sonuc"); H.data.roles.eczaci.ro = ["pt_ozet", "pt_sonuc"];
  H.EXTRA.charge.perms.push("pt_kamera");
  Object.values(H.data.roles).forEach(r => { r.ro = r.ro || []; });
  H.perms = (u = H.state.user) => { if (!u) return []; const r = H.data.roles[u.role]; const s = new Set(r ? r.perms : []);
    (u.extras || []).forEach(k => (H.EXTRA[k] ? H.EXTRA[k].perms : []).forEach(p => s.add(p)));
    (u.grant || []).forEach(p => s.add(p)); (u.deny || []).forEach(p => s.delete(p)); return [...s]; };
  H.can = (perm) => !!H.state.user && H.perms().includes(perm);
  H.canEdit = (perm) => { const u = H.state.user; if (!H.can(perm)) return false; if ((u.grant || []).includes(perm)) return true;
    const r = H.data.roles[u.role]; const fromExtra = (u.extras || []).some(k => H.EXTRA[k] && H.EXTRA[k].perms.includes(perm));
    return fromExtra || !(r.ro || []).includes(perm); };
  H.showNames = () => !!H.state.user && !!(H.data.roles[H.state.user.role] || {}).names;
  /* 24.09 (3. oturum) · Ozan #62: "hastanenin onayı gerekir / hasta izni gerekir" gibi kurulum notları yalnız yönetime görünür.
   * Klinik kullanıcı ekranında bu notlar yer kaplar ve "sistem bitmemiş" izlenimi verir. Metin kaçışlanır. */
  H.isAdminish = () => !!H.state.user && ["admin_users", "admin_roles", "admin_structure", "admin_system", "admin_integrations"].some(p => H.perms().includes(p));
  H.adminNote = (txt, tag = "span") => H.isAdminish() ? `<${tag} class="adm-note" title="Yalnız yönetim hesaplarına görünür">${H.esc(txt)}</${tag}>` : "";
  H.roleLabel = (u) => { const r = H.data.roles[u.role] || { name:u.role }; const ex = (u.extras || []).map(k => H.EXTRA[k] && H.EXTRA[k].name).filter(Boolean); return ex.includes("Sorumlu hemşire") ? "Sorumlu hemşire" + (ex.length > 1 ? " · " + ex.filter(x => x !== "Sorumlu hemşire").join(" · ") : "") : r.name + (ex.length ? " · " + ex.join(" · ") : ""); };
  H.floorText = (n) => ({ AZ:n === 0 ? "Zirzəmi mərtəbə" : n + ". mərtəbə", RU:n === 0 ? "Цокольный этаж" : n + "-й этаж", EN:n === 0 ? "Ground floor" : "Floor " + n })[H.state.lang] || (n === 0 ? "Zemin kat" : n + ". kat");

  /* ================= kullanıcılar (hepsi uydurma) =================
   * Demo şifreleri ekranda gösterilir; gerçek sistemde şifreler hiçbir yerde düz yazılmaz. */
  H.data.users = [
    { u:"dr.kamran",   pw:"Demo123!", name:"Dr. Kamran Rzayev",     role:"hekim",    units:["rea","kvc","dax","cer"], mfa:true,  title:"Anesteziyoloq-reanimatoloq" },
    { u:"hs.sevda",    pw:"Demo123!", name:"Sevda Quliyeva",         role:"hemsire",  extras:["charge"], units:["rea","kvc"], title:"Baş tibb bacısı" },
    { u:"hs.gulnar",   pw:"Demo123!", name:"Gülnar İsmayılova",      role:"hemsire",  units:["dax"], title:"Tibb bacısı" },
    { u:"hs.nuray",    pw:"Demo123!", name:"Nuray Ələkbərova",       role:"hemsire",  units:["usq","nic","pic"], title:"Uşaq tibb bacısı" },
    { u:"rrt.emil",    pw:"Demo123!", name:"Dr. Emil Nəsirov",       role:"hekim",    extras:["rrt"], units:["aci","dax","cer","usq","bmt"], title:"Təcili tibb həkimi · bu növbə hızlı yanıt" },
    { u:"ecz.lale",    pw:"Demo123!", name:"Ecz. Lalə Həsənova",     role:"eczaci",   units:"*", title:"Kliniki əczaçı" },
    { u:"bio.orxan",   pw:"Demo123!", name:"Orxan Kərimov",          role:"biyomed",  units:"*", title:"Biotibbi mühəndis" },
    { u:"kabul.ulviyye", pw:"Demo123!", name:"Ülviyyə Səfərova",     role:"kabul",    units:"*", title:"Qəbul şöbəsi" },
    { u:"mudur.rauf",  pw:"Demo123!", name:"Dr. Rauf Abbasov",       role:"yonetici", units:"*", title:"Baş həkim" },
    { u:"admin",       pw:"Admin123!", name:"Sistem İnzibatçısı",    role:"sistem",   units:"*", title:"İT şöbəsi" },
    { u:"kalite.tural", pw:"Demo123!", name:"Tural Mikayılov",       role:"kalite",   units:"*", title:"Keyfiyyət şöbəsi" },
    { u:"yeni.hekim",  pw:"Gecici1!", name:"Dr. Aynur Cəfərli",      role:"hekim",    units:["dax"], mustChange:true, title:"Yeni hesab · ilk giriş" },
  ].map(x => Object.assign({ active:true, fails:0, lockedUntil:0, lastLogin:"—", extras:[] }, x, x.units === "*" ? { units:H.units().map(u => u.id) } : {}));
  H.MFA_CODE = "123456"; H.RESET_CODE = "482913";

  /* ================= hastalar (SENTETİK) ================= */
  const P0 = (o) => Object.assign({ allergies:[], chronic:[], isolation:null, codeStatus:"Tam", antibioticDay:null, monitored:false, flags:{}, notes:[] }, o);
  H.data.patients = [
    P0({ id:"p1", name:"Elvin Hüseynov", sex:"E", age:61, ageGroup:"adult", bed:"rea-1", dx:"Pnevmoniya, sepsis şübhəsi", icd:"J18.9", admitDays:2, attending:"dr.kamran", nurse:"hs.sevda", blood:"A Rh(+)", weight:82, height:176, allergies:["Penisilin"], monitored:true, antibioticDay:2, risk:"crit", news2:14, sofa:11, v:{ hr:131, sbp:78, dbp:40, map:51, spo2:91, rr:30, temp:39.2, o2:"Ek oksijen", loc:"Ağrıya yanıt" }, flags:{ fall:"yüksek", braden:"orta", pain:6 } }),
    P0({ id:"p2", name:"Nərgiz Əliyeva", sex:"K", age:67, ageGroup:"adult", bed:"rea-2", dx:"KOAH alevlenmesi, solunum yetmezliği", icd:"J44.1", admitDays:4, attending:"dr.kamran", nurse:"hs.sevda", blood:"0 Rh(+)", weight:64, height:158, chronic:["KOAH","Diabetes mellitus"], monitored:true, antibioticDay:4, risk:"high", news2:10, sofa:6, v:{ hr:119, sbp:112, dbp:66, map:81, spo2:86, rr:27, temp:38.4, o2:"Ek oksijen", loc:"Uyanık" }, flags:{ fall:"yüksek", braden:"yüksek", pain:3 } }),
    P0({ id:"p3", name:"Rəşad Məmmədov", sex:"E", age:72, ageGroup:"adult", bed:"rea-3", dx:"Akut böbrek hasarı", icd:"N17.9", admitDays:3, attending:"dr.kamran", nurse:"hs.sevda", blood:"B Rh(-)", weight:90, height:180, chronic:["Hipertansiyon"], monitored:true, risk:"mid", news2:4, sofa:4, v:{ hr:102, sbp:128, dbp:72, map:91, spo2:96, rr:20, temp:37.1, o2:"Oda havası", loc:"Uyanık" }, flags:{ fall:"orta", braden:"düşük" } }),
    P0({ id:"p4", name:"Səbinə Vəliyeva", sex:"K", age:54, ageGroup:"adult", bed:"rea-4", dx:"Postoperatif takip · kolektomi", icd:"Z48.8", admitDays:1, attending:"dr.kamran", nurse:"hs.sevda", blood:"A Rh(-)", weight:70, height:165, monitored:true, risk:"stable", news2:1, sofa:1, v:{ hr:82, sbp:124, dbp:70, map:88, spo2:97, rr:16, temp:36.8, o2:"Oda havası", loc:"Uyanık" }, flags:{ fall:"düşük", braden:"düşük", pain:2 } }),
    P0({ id:"p5", name:"Kamal Səmədov", sex:"E", age:58, ageGroup:"adult", bed:"rea-6", dx:"NSTEMI", icd:"I21.4", admitDays:2, attending:"dr.kamran", nurse:"hs.sevda", blood:"AB Rh(+)", weight:88, height:174, monitored:true, risk:"low", news2:2, sofa:2, v:{ hr:88, sbp:118, dbp:70, map:86, spo2:96, rr:18, temp:36.7, o2:"Oda havası", loc:"Uyanık" }, flags:{ fall:"düşük" } }),
    P0({ id:"p6", name:"Zərifə Həşimova", sex:"K", age:79, ageGroup:"adult", bed:"dax-1", dx:"İdrar yolu enfeksiyonu", icd:"N39.0", admitDays:3, attending:"dr.kamran", nurse:"hs.gulnar", blood:"0 Rh(-)", weight:58, height:155, chronic:["Demans"], risk:"high", news2:6, v:{ hr:108, sbp:98, dbp:60, map:73, spo2:94, rr:23, temp:38.3, o2:"Oda havası", loc:"Konfüze" }, flags:{ fall:"yüksek", braden:"yüksek" }, isolation:null }),
    P0({ id:"p7", name:"Tofiq Babaşov", sex:"E", age:66, ageGroup:"adult", bed:"dax-2", dx:"Kalp yetmezliği", icd:"I50.9", admitDays:5, attending:"dr.kamran", nurse:"hs.gulnar", blood:"A Rh(+)", weight:95, height:172, chronic:["Kalp yetmezliği"], risk:"mid", news2:3, v:{ hr:96, sbp:142, dbp:84, map:103, spo2:93, rr:21, temp:36.9, o2:"Ek oksijen", loc:"Uyanık" }, flags:{ fall:"orta" } }),
    P0({ id:"p8", name:"Leyli Nağıyeva", sex:"K", age:45, ageGroup:"adult", bed:"dax-4", dx:"Diabetes mellitus, hiperglisemi", icd:"E11.6", admitDays:2, attending:"dr.kamran", nurse:"hs.gulnar", blood:"B Rh(+)", weight:76, height:163, chronic:["Diabetes mellitus"], risk:"stable", news2:0, v:{ hr:78, sbp:122, dbp:78, map:93, spo2:98, rr:15, temp:36.6, o2:"Oda havası", loc:"Uyanık" }, flags:{} }),
    P0({ id:"p9", name:"Fuad Orucov", sex:"E", age:71, ageGroup:"adult", bed:"dax-5", dx:"Pnömoni", icd:"J18.9", admitDays:1, attending:"dr.kamran", nurse:"hs.gulnar", blood:"0 Rh(+)", weight:69, height:170, risk:"mid", news2:5, antibioticDay:1, v:{ hr:101, sbp:116, dbp:70, map:85, spo2:93, rr:22, temp:38.0, o2:"Oda havası", loc:"Uyanık" }, flags:{ fall:"orta" }, isolation:"Damlacık" }),
    P0({ id:"p10", name:"Aysu Rəhimova", sex:"K", age:38, ageGroup:"adult", bed:"cer-1", dx:"Laparoskopik kolesistektomi sonrası", icd:"K80.2", admitDays:1, attending:"dr.kamran", nurse:"hs.gulnar", blood:"A Rh(+)", weight:62, height:168, risk:"stable", news2:1, v:{ hr:84, sbp:118, dbp:74, map:89, spo2:98, rr:16, temp:37.2, o2:"Oda havası", loc:"Uyanık" }, flags:{ pain:4 } }),
    P0({ id:"p11", name:"Nicat Qasımov", sex:"E", age:8, ageGroup:"child", bed:"usq-1", dx:"Akut bronşiolit", icd:"J21.9", admitDays:2, attending:"dr.kamran", nurse:"hs.nuray", blood:"0 Rh(+)", weight:26, height:128, risk:"mid", pews:4, v:{ hr:124, sbp:98, dbp:60, map:73, spo2:93, rr:32, temp:38.1, o2:"Ek oksijen", loc:"Uyanık" }, flags:{ fall:"orta", pain:3 } }),
    P0({ id:"p12", name:"Məryəm Abdullayeva", sex:"K", age:5, ageGroup:"child", bed:"usq-3", dx:"Gastroenterit, dehidratasyon", icd:"A09", admitDays:1, attending:"dr.kamran", nurse:"hs.nuray", blood:"A Rh(+)", weight:18, height:108, risk:"low", pews:2, v:{ hr:118, sbp:94, dbp:58, map:70, spo2:98, rr:24, temp:37.6, o2:"Oda havası", loc:"Uyanık" }, flags:{} }),
    P0({ id:"p13", name:"Bebek Hüseynova (K)", sex:"K", age:0, ageDays:9, ageGroup:"neonate", bed:"nic-1", dx:"Prematürite, 32 hf · RDS", icd:"P07.3", admitDays:9, attending:"dr.kamran", nurse:"hs.nuray", blood:"0 Rh(+)", weight:1.72, height:42, gestWeeks:32, birthWeight:1650, monitored:true, risk:"high", nsofa:3, v:{ hr:168, sbp:52, dbp:30, map:37, spo2:89, rr:62, temp:36.3, o2:"CPAP", loc:"—" }, flags:{ pain:3 } }),
    P0({ id:"p14", name:"Bebek Əliyev (E)", sex:"E", age:0, ageDays:3, ageGroup:"neonate", bed:"nic-2", dx:"Yenidoğan sarılığı", icd:"P59.9", admitDays:3, attending:"dr.kamran", nurse:"hs.nuray", blood:"A Rh(+)", weight:3.1, height:50, gestWeeks:38, birthWeight:3200, monitored:true, risk:"stable", nsofa:0, v:{ hr:138, sbp:66, dbp:40, map:48, spo2:98, rr:44, temp:36.8, o2:"Oda havası", loc:"—" }, flags:{} }),
    // 24.09 · yeni birimler (hepsi uydurma)
    P0({ id:"p15", name:"Ayan Hümbətova", sex:"K", age:4, ageGroup:"child", bed:"pic-1", dx:"Ağır pnömoni, yüksek akım oksijen", icd:"J18.9", admitDays:2, attending:"dr.kamran", nurse:"hs.nuray", blood:"B Rh(+)", weight:16, height:102, monitored:true, antibioticDay:2, risk:"high", pews:6, v:{ hr:148, sbp:92, dbp:54, map:67, spo2:91, rr:42, temp:38.6, o2:"Yüksek akım", loc:"Huzursuz" }, flags:{ pain:3 } }),
    P0({ id:"p16", name:"Səməd Allahverdiyev", sex:"E", age:63, ageGroup:"adult", bed:"kvc-1", dx:"Koroner bypass sonrası 1. gün", icd:"Z95.1", admitDays:1, attending:"dr.kamran", nurse:"hs.sevda", blood:"0 Rh(+)", weight:84, height:175, chronic:["Hipertansiyon", "Diabetes mellitus"], monitored:true, risk:"mid", news2:4, sofa:3, v:{ hr:96, sbp:108, dbp:62, map:77, spo2:95, rr:19, temp:37.4, o2:"Ek oksijen", loc:"Uyanık" }, flags:{ fall:"orta", braden:"orta", pain:4 } }),
    P0({ id:"p17", name:"Vüqar Nəbiyev", sex:"E", age:52, ageGroup:"adult", bed:"aci-3", dx:"Göğüs ağrısı · gözlem", icd:"R07.4", admitDays:0, attending:"rrt.emil", nurse:null, blood:"Bilinmiyor", weight:88, height:178, risk:"low", v:{ hr:92, sbp:146, dbp:88, map:107, spo2:97, rr:18, temp:36.7, o2:"Oda havası", loc:"Uyanık" }, flags:{} }),
    P0({ id:"p18", name:"Könül Rəsulova", sex:"K", age:49, ageGroup:"adult", bed:"kem-1", dx:"Planlı kemoterapi kürü", icd:"Z51.1", admitDays:0, attending:"dr.kamran", nurse:null, blood:"A Rh(+)", weight:59, height:162, risk:"stable", v:{ hr:78, sbp:118, dbp:72, map:87, spo2:98, rr:15, temp:36.6, o2:"Oda havası", loc:"Uyanık" }, flags:{} }),
    P0({ id:"p19", name:"İlqar Sadıqov", sex:"E", age:41, ageGroup:"adult", bed:"bmt-2", dx:"Kemik iliği nakli sonrası 8. gün · nötropeni", icd:"Z94.8", admitDays:12, attending:"dr.kamran", nurse:null, blood:"AB Rh(+)", weight:71, height:177, risk:"mid", news2:3, antibioticDay:3, isolation:"Koruyucu", v:{ hr:104, sbp:112, dbp:68, map:83, spo2:96, rr:18, temp:37.9, o2:"Oda havası", loc:"Uyanık" }, flags:{ pain:2 } }),
  ];
  // yatak durumlarını hastalardan doldur, birkaçını temizlik / bloke / kullanım dışı yap
  H.data.patients.forEach(p => { const b = H.bed(p.bed); if (b) { b.status = "dolu"; b.pid = p.id; } });
  [["rea-5", "temizlik"], ["dax-8", "bloke"], ["cer-4", "temizlik"], ["rea-8", "rezerve"], ["kvc-3", "temizlik"], ["gun-2", "rezerve"]].forEach(([id, s]) => { const b = H.bed(id); if (b) b.status = s; });
  [["dax-12", "Tavan tamiri"], ["pic-4", "Monitör arızası"]].forEach(([id, why]) => { const b = H.bed(id); if (b) Object.assign(b, { status:"bloke", oos:true, oosWhy:why }); });
  H.pt = (id) => H.data.patients.find(p => p.id === id);
  H.ptByBed = (bedId) => H.data.patients.find(p => p.bed === bedId);
  H.userBy = (u) => H.data.users.find(x => x.u === u);

  /* ================= ciddiyet ================= */
  H.SEV = { crit:{ c:"var(--crit)", l:"KRİTİK", i:"alert" }, high:{ c:"var(--high)", l:"YÜKSEK", i:"alert" }, mid:{ c:"var(--mid)", l:"ORTA", i:"clock" }, low:{ c:"var(--low)", l:"DÜŞÜK", i:"clock" }, stable:{ c:"var(--ok)", l:"STABİL", i:"ok" } };
  H.sevPill = (lvl) => { const s = H.SEV[lvl] || H.SEV.stable; return `<span class="sv" style="--r:${s.c}">${H.icon(s.i)}${s.l}</span>`; };
  H.scoreLabel = (p) => { const u = H.unit(H.bed(p.bed).unitId); if (!H.isClinical(u)) return "Klinik skor yok · " + H.TIER.op[0].toLowerCase();
    return p.ageGroup === "neonate" ? `nSOFA ${p.nsofa}` : p.ageGroup === "child" ? `PEWS ${p.pews}` : u.type === "icu" ? `NEWS2 ${p.news2} · SOFA ${p.sofa}` : `NEWS2 ${p.news2}`; };
  H.ageText = (p) => p.ageGroup === "neonate" ? `${p.ageDays} günlük` : `${p.age}y`;

  /* ================= alarmlar ================= */
  H.data.alarms = [
    { id:1, pid:"p1", txt:"Kötüleşme kriterleri karşılanıyor · MAP 51 · laktat 4.1", sev:"crit", ageMin:7.7, step:2, state:"open" },
    { id:2, pid:"p2", txt:"SpO₂ 86 · 3 dakikadır", sev:"high", ageMin:2.7, step:0, state:"open" },
    { id:3, pid:"p6", txt:"NEWS2 6 · değerlendirme zamanı", sev:"high", ageMin:4.2, step:1, state:"open" },
    { id:4, pid:"p13", txt:"SpO₂ 89 · desatürasyon epizodu", sev:"high", ageMin:1.1, step:0, state:"open" },
    { id:5, pid:"p3", txt:"Potasyum 5.8 · Sevda Q. gördü 21:30", sev:"mid", ageMin:12.2, step:0, state:"seen" },
    { id:6, pid:"p15", txt:"PEWS 6 · değerlendirme zamanı", sev:"high", ageMin:3.4, step:1, state:"open" },
  ];
  H.openAlarms = () => H.data.alarms.filter(a => a.state === "open" && H.inScope(a.pid));

  /* ================= devir ================= */
  H.data.handovers = [
    { id:1, pid:"p4", from:"Mələk A. (gündüz)", to:null, state:"waiting" },
    { id:2, pid:"p5", from:"Mələk A. (gündüz)", to:null, state:"waiting" },
    { id:3, pid:"p8", from:"Aygün M. (gündüz)", to:null, state:"waiting" },
  ];

  /* ================= bildirim merkezi =================
   * Her bildirim bir role (ya da işarete/göreve) gider; hasta bildirimleri ayrıca kullanıcının birim kapsamına bakar.
   * Kanal gerçeği (gerçek üründe bugün): uygulama içi ✓ (engine api/notify.py, SSE) · tarayıcı bildirimi + ses ✓ (dashboard notifications.js)
   * · telefona push ✗ · SMS ✗. Ekranda böyle yazılır; prototip olmayanı varmış gibi göstermez. */
  H.CHANNELS = [["app", "Uygulama içi", true], ["browser", "Tarayıcı bildirimi + ses", true], ["push", "Telefona bildirim", false], ["sms", "SMS", false]];
  const N0 = (id, at, to, sev, title, body, go, extra = {}) => Object.assign({ id, at, to, sev, title, body, go, read:false }, extra);
  H.data.notifs = [
    N0(1, "21:35", ["hekim"], "crit", "Eskalasyon · 5. dakika", "REA01 · kötüleşme kriterleri karşılanıyor, hemşire yanıtı yok", ["alarms"], { pid:"p1" }),
    N0(2, "21:31", ["hekim"], "", "Yeni sonuç", "REA01 · laktat 4.1 mmol/L (kritik)", ["patient", { pid:"p1", tab:"sonuc" }], { pid:"p1" }),
    N0(3, "21:20", ["hekim"], "", "İmza bekliyor", "REA01 · SOFA 11 · sistem doldurdu, onayınız bekleniyor", ["patient", { pid:"p1", tab:"skor" }], { pid:"p1" }),
    N0(4, "21:39", ["hemsire"], "high", "Yeni alarm", "REA02 · SpO₂ 86, 3 dakikadır", ["alarms"], { pid:"p2" }),
    N0(5, "21:30", ["hemsire"], "", "İş zamanı geldi", "Vital bulgular · 22:00 turu yaklaşıyor", ["tasks"]),
    N0(6, "21:12", ["charge"], "", "Yeni yatış yolda", "Erişkin yoğun bakıma bir yatış bekleniyor · yatak atanmadı", ["admission"]),
    N0(7, "20:55", ["hemsire"], "", "Devir imzası", "3 hastanın devri karşı imzanızı bekliyor", ["hand"]),
    N0(8, "21:38", ["rrt"], "crit", "Size eskale edildi", "REA01 · 4. kat · Oda ICU-01 · 7:40 dk", ["rrt"], { pid:"p1" }),
    N0(9, "16:40", ["eczaci"], "", "Antibiyotik 3. gün", "2 hastada gözden geçirme zamanı", ["pharmacy"]),
    N0(10, "21:36", ["biyomed"], "crit", "Monitör sessiz", "REA07 · 6 dakikadır veri yok", ["devices"]),
    N0(11, "09:00", ["biyomed"], "", "Bakım zamanı", "Bu hafta 4 cihazın periyodik bakımı var", ["devices", { tab:"takvim" }]),
    N0(12, "21:12", ["kabul"], "", "Yeni yatış", "Ön kabul kaydı geldi · Erişkin yoğun bakım", ["admission"]),
    N0(13, "21:10", ["kabul"], "", "Yatak hazır", "REA05 temizliği bitti, hasta atanabilir", ["occupancy"]),
    N0(14, "08:00", ["yonetici", "kalite"], "", "Günlük özet hazır", "Dünün alarm yanıt süreleri ve geciken işler", ["quality"]),
    N0(15, "20:44", ["sistem"], "high", "Hesap kilitlendi", "hs.melek · 5 hatalı deneme", ["admin", { tab:"users" }]),
    N0(16, "19:02", ["sistem"], "", "Bağlantı gecikmesi", "Hastane kaydı bağlantısı 3 dk yanıt vermedi, sonra düzeldi", ["admin", { tab:"integrations" }]),
  ];
  // Kullanıcıya düşenler: rol, işaret ya da görev eşleşmeli; hasta bildiriminde hasta kapsamda olmalı.
  H.myNotifs = () => { const u = H.state.user; if (!u) return []; const keys = [u.role, ...(u.extras || [])];
    return H.data.notifs.filter(n => n.to.some(k => keys.includes(k)) && (!n.pid || H.inScope(n.pid) || (u.extras || []).includes("rrt"))).sort((a, b) => b.id - a.id); };
  H.pushNotif = (n) => { n.id = Math.max(0, ...H.data.notifs.map(x => x.id)) + 1; n.read = false; H.data.notifs.push(n); return n; };

  /* ================= hemşirelik form kataloğu (formları nursing.js açar) ================= */
  H.FORMS = [
    { key:"vitals",  name:"Vital bulgular",           icon:"heart",   freq:"4 saatte bir",  ages:["adult","child","neonate"] },
    { key:"pain",    name:"Ağrı değerlendirmesi",     icon:"body",    freq:"4 saatte bir",  ages:["adult","child","neonate"] },
    { key:"wound",   name:"Bası yarası / yara",       icon:"drop",    freq:"günde 1",       ages:["adult","child","neonate"] },
    { key:"fall",    name:"Düşme riski",              icon:"alert",   freq:"8 saatte bir",  ages:["adult","child"] },
    { key:"braden",  name:"Bası yarası riski",        icon:"shield",  freq:"günde 1",       ages:["adult","child","neonate"] },
    { key:"gcs",     name:"Glasgow Koma Skalası",     icon:"eye",     freq:"4 saatte bir",  ages:["adult","child"] },
    { key:"io",      name:"Aldığı–çıkardığı",         icon:"drop",    freq:"saatlik",       ages:["adult","child","neonate"] },
    { key:"glucose", name:"Kan şekeri",               icon:"syringe", freq:"order'a göre",  ages:["adult","child","neonate"] },
    { key:"activity",name:"Faaliyet / olay / bakım",  icon:"activity",freq:"gerektikçe",    ages:["adult","child","neonate"] },
  ];
  H.forms = { open:(key, pid) => H.toast("Bu form henüz yüklenmedi: " + key, "w") }; // nursing.js üzerine yazar

  /* ================= görevler (hemşire saatli planı) =================
   * t: saat (0-23, nöbet 08:00'de başlar), kind: form | med | care | lab, state: done | due | late | plan */
  const T0 = (pid, t, kind, label, extra = {}) => Object.assign({ pid, t, kind, label, state: t < 21 ? "done" : t < 22 ? "late" : t < 23 ? "due" : "plan" }, extra);
  H.data.tasks = [];
  H.data.patients.forEach((p, i) => {
    if (!H.isClinical(H.unit(H.bed(p.bed).unitId))) return;   // operasyonel birimlerde hemşirelik planı üretilmez
    const L = [T0(p.id, 8, "form", "Vital bulgular", { form:"vitals" }), T0(p.id, 12, "form", "Vital bulgular", { form:"vitals" }), T0(p.id, 16, "form", "Vital bulgular", { form:"vitals" }), T0(p.id, 20, "form", "Vital bulgular", { form:"vitals" }), T0(p.id, 24, "form", "Vital bulgular", { form:"vitals" }),
      T0(p.id, 9, "form", "Ağrı değerlendirmesi", { form:"pain" }), T0(p.id, 21, "form", "Ağrı değerlendirmesi", { form:"pain" }),
      T0(p.id, 8, "form", "Bası yarası riski", { form:"braden" })];
    if (p.ageGroup !== "neonate") L.push(T0(p.id, 16, "form", "Düşme riski", { form:"fall" }), T0(p.id, 24, "form", "Düşme riski", { form:"fall" }));
    if (p.flags.braden === "yüksek" || p.flags.braden === "orta") [10, 12, 14, 16, 18, 20, 22, 24].forEach(h => L.push(T0(p.id, h, "care", "Pozisyon ver")));
    if (p.chronic.includes("Diabetes mellitus")) [8, 12, 17, 22].forEach(h => L.push(T0(p.id, h, "form", "Kan şekeri", { form:"glucose" })));
    if (p.antibioticDay) [14, 22, 30].forEach(h => L.push(T0(p.id, h, "med", p.allergies.includes("Penisilin") ? "Seftriakson 2 g IV" : "Piperasilin-tazobaktam 4.5 g IV")));
    if (i % 3 === 0) L.push(T0(p.id, 22.5, "lab", "Numune: laktat / kan gazı"));
    H.data.tasks.push(...L);
  });

  /* ================= zaman serileri (trend, lab) ================= */
  const rnd = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  H.series = (pid, key, hours = 24, stepMin = 15) => {
    const p = H.pt(pid), r = rnd(pid.length * 97 + key.length * 13 + pid.charCodeAt(1) * 7), n = Math.round(hours * 60 / stepMin);
    const now = p.v[key] ?? 0, start = { crit:.72, high:.84, mid:.95, low:1, stable:1 }[p.risk] || 1;
    const base = key === "spo2" ? Math.min(98, now / start * (start < 1 ? 1.06 : 1)) : key === "map" || key === "sbp" ? now / Math.max(.55, start) * (p.risk === "crit" ? 1.35 : 1) : key === "temp" ? now - (1 - start) * 3 : now * start;   // 24.09: ısı katsayıyla ÇARPILMAZ (36.9×0.95 = 35.1 sahte hipotermi üretiyordu)
    const noise = { hr:3, map:2.5, sbp:4, spo2:.7, rr:1.1, temp:.08 }[key] || 1;
    return Array.from({ length:n + 1 }, (_, i) => { const f = i / n, trendF = p.risk === "stable" || p.risk === "low" ? 0 : Math.max(0, (f - .55) / .45);
      const v = base + (now - base) * trendF + (i === n ? 0 : (r() - .5) * noise * 2); return { t:-hours + f * hours, v: i === n ? now : +v.toFixed(key === "temp" ? 1 : 0) }; });
  };
  H.VITAL = { hr:{ n:"Kalp hızı", s:"HR", u:"/dk", c:"--v-hr", lo:40, hi:180, al:[50,120], nb:[70,95] }, map:{ n:"Ort. tansiyon", s:"MAP", u:"mmHg", c:"--v-map", lo:30, hi:130, al:[65,110], nb:[75,95] },
    spo2:{ n:"SpO₂", s:"SpO₂", u:"%", c:"--v-spo", lo:80, hi:100, al:[92,101], nb:[95,99] }, rr:{ n:"Solunum", s:"RR", u:"/dk", c:"--v-rr", lo:5, hi:45, al:[10,24], nb:[14,20] },
    temp:{ n:"Ateş", s:"Isı", u:"°C", c:"--v-t", lo:35, hi:41, al:[36,38.3], nb:[36.4,37.4] } };

  /* ================= grafik yardımcısı =================
   * H.lineChart(svg, { series:[{pts:[{t,v}], color}], lo, hi, bands:[[a,b,color]], hours, height, xLabels:true, events:[{t,label,kind:'tx'|'al'}], onHover(t) }) */
  H.cssVar = (n) => getComputedStyle(document.body).getPropertyValue(n).trim() || n;
  H.lineChart = (svg, o) => {
    const W = svg.clientWidth || 600, h = o.height || 120, pl = o.padL ?? 34, pr = 8, pt = 8, pb = o.xLabels ? 20 : 4, t0 = o.t0 ?? -(o.hours || 24), t1 = o.t1 ?? 0;
    const x = t => pl + (t - t0) / (t1 - t0) * (W - pl - pr), y = v => pt + (1 - (v - o.lo) / (o.hi - o.lo)) * (h - pt - pb);
    let s = "";
    (o.bands || []).forEach(([a, b, c]) => { const ya = y(Math.min(o.hi, b)), yb = y(Math.max(o.lo, a)); if (yb > ya) s += `<rect x="${pl}" y="${ya}" width="${W - pl - pr}" height="${yb - ya}" fill="${c}"/>`; });
    let last = -99; (o.ticks || [o.hi, o.lo]).slice().sort((a, b) => b - a).forEach(v => { if (Math.abs(y(v) - last) < 11) return; last = y(v); s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="${H.cssVar("--grid")}"/><text x="${pl - 5}" y="${y(v) + 3.5}" text-anchor="end" font-size="9.5" fill="${H.cssVar("--mute")}">${v}</text>`; });
    (o.series || []).forEach((sr, k) => { let d = ""; sr.pts.forEach((q, i) => { if (q.v == null) return; const pv = sr.pts[i - 1]; d += `${!pv || pv.v == null ? "M" : "L"}${x(q.t).toFixed(1)},${y(q.v).toFixed(1)}`; });
      s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="${sr.width || 2}" stroke-linejoin="round" opacity="${k ? .75 : 1}"/>`;
      if (sr.dots) sr.pts.forEach(q => { if (q.v != null) s += `<circle cx="${x(q.t)}" cy="${y(q.v)}" r="3" fill="${sr.color}"/>`; }); });
    if (o.xLabels) (o.xTicks || []).forEach(([t, l]) => s += `<text x="${x(t)}" y="${h - 5}" text-anchor="middle" font-size="10" fill="${H.cssVar("--mute")}">${l}</text>`);
    (o.events || []).forEach(e => { const X = x(e.t), c = e.kind === "al" ? H.cssVar("--crit") : "#8b7cff"; s += `<line x1="${X}" x2="${X}" y1="${pt}" y2="${h - pb}" stroke="${c}" stroke-dasharray="3 3" opacity=".7"/>` + (e.kind === "al" ? `<path d="M${X - 6} ${pt + 12} L${X} ${pt + 2} L${X + 6} ${pt + 12}Z" fill="${c}"/>` : `<rect x="${X - 5}" y="${pt + 2}" width="10" height="10" transform="rotate(45 ${X} ${pt + 7})" fill="${c}"/>`); });
    s += `<line class="cur" y1="${pt}" y2="${h - pb}" stroke="${H.cssVar("--ink")}" opacity="0"/>`;
    svg.setAttribute("viewBox", `0 0 ${W} ${h}`); svg.setAttribute("height", h); svg.innerHTML = s;
    if (o.onHover) { svg.onmousemove = e => { const r = svg.getBoundingClientRect(), mx = e.clientX - r.left; if (mx < pl) return; const t = t0 + (mx - pl) / (W - pl - pr) * (t1 - t0), c = svg.querySelector(".cur"); c.setAttribute("x1", x(t)); c.setAttribute("x2", x(t)); c.setAttribute("opacity", .5); o.onHover(t, e); };
      svg.onmouseleave = () => { svg.querySelector(".cur").setAttribute("opacity", 0); o.onHover(null); }; }
  };
  H.spark = (vals, color) => { const mn = Math.min(...vals) - 2, mx = Math.max(...vals) + 2; return `<svg class="spark" viewBox="0 0 200 28" preserveAspectRatio="none"><polyline points="${vals.map((v, i) => `${(i / (vals.length - 1) * 200).toFixed(1)},${(28 - (v - mn) / (mx - mn) * 28).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`; };

  /* ================= kapsam: kullanıcı yalnız kendi birimlerini görür ================= */
  H.inScope = (pid) => { const p = H.pt(pid); if (!p || !H.state.user) return false; return H.state.user.units.includes(H.bed(p.bed).unitId); };
  H.myPatients = () => H.data.patients.filter(p => H.inScope(p.id));

  /* ================= sayfa kaydı ve yönlendirme ================= */
  H.pages = {};
  H.register = (key, def) => { H.pages[key] = def; };   // def: { title:()=>string, perm, render(root, params) }
  H.go = (page, params = {}) => { H.state.page = page; H.state.params = params; H.renderApp(); };   // shell.js tanımlar

  /* ================= modal, toast, menü ================= */
  H.modal = ({ title, body, wide, actions = "", onMount, onClose }) => {
    H.closeModal();
    const bg = document.createElement("div"); bg.className = "modalBg"; bg.id = "modalBg";
    bg.innerHTML = `<div class="modal ${wide ? "wide" : ""}"><div class="mh"><b>${title}</b><button class="ib x" data-x>${H.icon("x")}</button></div><div class="mb">${body}</div>${actions ? `<div class="mf">${actions}</div>` : ""}</div>`;
    document.body.appendChild(bg);
    bg.addEventListener("click", e => { if (e.target === bg || e.target.closest("[data-x]")) { H.closeModal(); onClose && onClose(); } });
    onMount && onMount(bg.querySelector(".modal"));
    return bg.querySelector(".modal");
  };
  H.closeModal = () => { const m = document.getElementById("modalBg"); if (m) m.remove(); };
  H.toast = (msg, kind = "") => { let box = document.querySelector(".toasts"); if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg; box.appendChild(t); setTimeout(() => t.remove(), 3600); };
  H.audit = []; H.log = (action, detail = "") => H.audit.unshift({ at:new Date(), user:H.state.user ? H.state.user.u : "—", action, detail });
  H.esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[c]);
  H.now = () => "21:42";   // demo saati: nöbetin içinde sabit
  /* 24.09 (2. oturum) · tarih her yerde görünür (Ozan: "sistemin çoğu yerinde tarih yok").
   * Demo günü 24.09.2026 Perşembe. Nöbet 24.09 08:00 → 25.09 08:00; gece yarısından sonrası ERTESİ GÜN.
   * Kural: aynı gün içinde yalnız saat yeterli; gün değişen her yerde "25.09 · 02:00" yazılır. */
  const WD = { AZ:["B.", "B.e.", "Ç.a.", "Ç.", "C.a.", "C.", "Ş."], TR:["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"], RU:["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"], EN:["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
  H.DAY0 = new Date(2026, 8, 24);
  const dayAt = (off) => { const d = new Date(H.DAY0); d.setDate(d.getDate() + off); return d; };
  const p2 = (n) => String(n).padStart(2, "0");
  H.dm = (off = 0) => { const d = dayAt(off); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`; };
  H.dmy = (off = 0) => H.dm(off) + "." + dayAt(off).getFullYear();
  H.wd = (off = 0) => (WD[H.state.lang] || WD.TR)[dayAt(off).getDay()];
  H.today = () => `${H.wd(0)} ${H.dmy(0)}`;
  H.nowFull = () => `${H.dm(0)} · ${H.now()}`;
  // Nöbet ızgarasındaki saat (0-23) hangi güne düşer: 08-23 bugün, 00-07 yarın.
  H.shiftDayOff = (h) => (h < 8 ? 1 : 0);
  H.when = (h, m = 0) => { const off = H.shiftDayOff(h); return `${off ? H.dm(off) + " · " : ""}${p2(h)}:${p2(m)}`; };
  H.SHIFT = { start:`${H.dm(0)} 08:00`, end:`${H.dm(1)} 08:00`, left:"10:18" };

  /* 30.09 · son GERÇEK kayıt (kontrol-2026-09-30 §4-6): ekranlardaki sabit "20:00 / 21:00" yazıları yerine.
   * Önce hemşirelik form kaydı (H.data.nursing.records, nursing.js), yoksa Görevlerim'de tamamlanmış aynı formun işi.
   * Döner: { at:"HH:MM", day:"bugün"|"dd.mm", t:saat (0-30 nöbet saati), by, src:"form"|"task" } ya da null. */
  const hOfClock = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return m ? +m[1] + +m[2] / 60 : null; };
  H.lastEntry = (pid, key) => {
    const R = ((H.data.nursing || {}).records || []).filter(r => r.pid === pid && r.key === key);
    const r = R[R.length - 1], today = H.dmy(0);
    if (r) { const u = H.userBy(r.user); return { at:r.at, today:r.date === today, day:r.date === today ? "" : String(r.date).slice(0, 5), t:r.date === today ? hOfClock(r.at) : null, by:u ? u.name : r.user, src:"form" }; }
    const T = (H.data.tasks || []).filter(x => x.pid === pid && x.form === key && x.state === "done").sort((a, b) => a.t - b.t).pop();
    if (!T) return null;
    const at = T.doneAt || `${p2(Math.floor(T.t) % 24)}:${p2(Math.round((T.t % 1) * 60))}`;
    return { at, today:true, day:"", t:T.doneAt ? hOfClock(T.doneAt) : T.t, by:T.by || null, src:"task" };
  };
  H.entryText = (e) => e ? (e.today ? e.at : `${e.day} ${e.at}`) : "—";
  // "1 sa 42 dk önce" — yalnız bugünün kaydı için; H.now() demo saatine göre
  H.agoText = (e) => { if (!e || !e.today) return ""; const n = hOfClock(H.now()), a = hOfClock(e.at); if (n == null || a == null) return "";
    const m = Math.max(0, Math.round((n - a) * 60)), h = Math.floor(m / 60), mm = m % 60; return h ? `${h} sa ${mm} dk önce` : `${mm} dk önce`; };

  /* 30.09 · NEWS2 bandı → hasta risk düzeyi (kontrol §4-1: vital girilince risk ve alarm değişmiyordu).
   * Bant, nursing.js'teki NEWS2 (RCP 2017) formunun kullandığı eşiklerin AYNISI: lvl 3 = toplam ≥7, lvl 2 = 5–6 ya da tek parametrede 3,
   * lvl 1 = 1–4, lvl 0 = 0. Renk eşlemesi de o formdaki gibi (ok · orta · yüksek · kritik). Yeni eşik uydurulmaz.
   * Düşüşte sistem riski kendiliğinden İNDİRMEZ (yüksek/kritik kalır; değerlendirme hekimin): yalnız yükselişte günceller. */
  const RISK_RANK = { stable:0, low:1, mid:2, high:3, crit:4 };
  H.riskFromNews2 = (lvl, cur) => {
    const band = ["stable", "mid", "high", "crit"][lvl];
    if (!band) return cur;
    if (RISK_RANK[cur] >= RISK_RANK.high && RISK_RANK[band] < RISK_RANK[cur]) return cur;   // indirme yok
    if (lvl === 1 && ["stable", "low", "mid"].includes(cur)) return cur;                    // 1–4 bandı: kayıttaki alt ayrım korunur
    if (lvl === 0 && RISK_RANK[cur] < RISK_RANK.high) return "stable";
    return RISK_RANK[band] > RISK_RANK[cur] ? band : cur;
  };

})();
