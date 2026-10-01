/*
  parca/neler.js — "Neler var": hekim / hemşire / kurum için bugün uygulamada olan ekranlar (24.09.2026).
  Eski ikon + tek satır kartlarının yerine: rol seçici + beş madde + uygulamanın GERÇEK ekran görüntüsü.
  Kendi kendine yeten parça: kendi CSS'ini (#neler-css) basar, #neler-mount içine çizer; bütün sınıflar ne- önekli.
  Renkler sayfanın değişkenlerinden (--page --card --ink --pri ...); tema html[data-theme] (gun|gece) ile, görseller de temaya göre değişir.
  Dil: localStorage "hmc.lang" (AZ açılış) + document "hmc:lang" olayı (detail: AZ|TR|RU|EN). Metinlerin ana dili TR.

  Görseller anasayfa/gorsel/<ekran>-<dil>-<tema>.webp — elle çizilmez, prototipten çekilir:
      cd C:\Dev\Homunculus\tasarim-taslaklari\anasayfa\gorsel
      node cek.cjs
  Ekran anahtarları (unitdash, skor …) cek.cjs'teki SHOTS listesiyle birebir aynıdır.
  Dil kuralı: sistem bilgi verir, karar hekimindir. Sonuç vaadi, tanı ya da doz dili yok.
*/
(function () {
  "use strict";
  var host = document.getElementById("neler");
  var mount = document.getElementById("neler-mount");
  if (!host || !mount) return;

  var IDX = { AZ:0, TR:1, RU:2, EN:3 };
  var lang = "AZ";
  try { var sv = localStorage.getItem("hmc.lang"); if (sv && sv in IDX) lang = sv; } catch (e) {}
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var canHover = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  var IMG_W = 1344, IMG_H = 900, STEP_MS = 7000, BASE = "gorsel/";

  /* ---------- metinler: [AZ, TR, RU, EN] ---------- */
  var T = {
    pick:    ["Rol seçin", "Rol seçin", "Выберите роль", "Choose a role"],
    hint:    ["Bir maddəyə toxunun — həmin ekran açılır. Şəklə toxunanda böyüyür.", "Bir maddeye dokunun — o ekran açılır. Resme dokununca büyür.", "Нажмите на пункт — откроется его экран. Нажатие на снимок увеличивает его.", "Tap an item to open its screen. Tap the picture to enlarge it."],
    cap:     ["Tətbiqin öz ekranı · şərti məlumatlar, real xəstə yoxdur", "Uygulamanın kendi ekranı · kurgusal veri, gerçek hasta yok", "Экран самого приложения · вымышленные данные, реальных пациентов нет", "The app's own screen · fictional data, no real patients"],
    zoom:    ["Böyüt", "Büyüt", "Увеличить", "Enlarge"],
    close:   ["Bağla", "Kapat", "Закрыть", "Close"],
    pause:   ["Dayandır", "Duraklat", "Пауза", "Pause"],
    play:    ["Davam et", "Sürdür", "Продолжить", "Play"],
    alt:     ["Ekran görüntüsü: ", "Ekran görüntüsü: ", "Снимок экрана: ", "Screenshot: "],
    doc:     ["Həkim üçün", "Hekim için", "Для врача", "For physicians"],
    doc_s:   ["Qiymətləndirmə və təsdiq", "Değerlendirme ve onay", "Оценка и подтверждение", "Assessment and sign-off"],
    nur:     ["Tibb bacısı üçün", "Hemşire için", "Для медсестры", "For nurses"],
    nur_s:   ["Çarpayı başında iş", "Yatak başındaki iş", "Работа у койки", "Work at the bedside"],
    org:     ["Xəstəxana üçün", "Kurum için", "Для больницы", "For the hospital"],
    org_s:   ["İdarə, keyfiyyət, texnika", "Yönetim, kalite, teknik", "Управление, качество, техника", "Management, quality, technical"],

    unitdash_t: ["Bölmə paneli", "Birim panosu", "Панель отделения", "Unit dashboard"],
    unitdash_d: ["Bölmədəki bütün xəstələri bir səhifədə görürsünüz: son 24 saatda kimin göstəriciləri həyəcan həddindən çıxıb, kimin şkalası dünəndən bu günə yüksəlib. Panel yalnız növbəliliyi görünən edir; hansı çarpayıya əvvəl baxacağınıza siz qərar verirsiniz.",
                 "Birimdeki bütün hastaları tek sayfada görürsünüz: son 24 saatte kimin vitalleri alarm eşiğinin dışına çıktı, kimin skoru dünden bugüne yükseldi. Pano yalnız sıralamayı görünür kılar; hangi yatağa önce bakacağınıza siz karar verirsiniz.",
                 "Все пациенты отделения на одной странице: у кого за последние 24 часа показатели выходили за пороги тревоги, у кого шкала выросла со вчерашнего дня. Панель лишь делает очерёдность видимой; к какой койке подойти первым, решаете вы.",
                 "Every patient in the unit on one page: whose vitals left the alarm range in the last 24 hours, whose score has risen since yesterday. The board only makes the order visible; which bed you see first is your call."],
    skor_t: ["Şkala təsdiqi", "Skor onayı", "Подтверждение шкал", "Score sign-off"],
    skor_d: ["SOFA və NEWS2 formaları laboratoriya və monitor dəyərləri ilə əvvəlcədən doldurulur, hər dəyərin yanında mənbəyi və vaxtı yazılır. Kliniki qiymətləndirmə tələb edən sahəni (məs. QKŞ) siz seçirsiniz; şkala yalnız sizin imzanızla qəti olur.",
             "SOFA ve NEWS2 formları laboratuvar ve monitör değerleriyle önceden doldurulur, her değerin yanında kaynağı ve saati yazar. Klinik yargı gereken alanı (ör. GKS) siz seçersiniz; skor ancak sizin imzanızla kesinleşir.",
             "Формы SOFA и NEWS2 приходят заполненными по данным лаборатории и монитора, рядом с каждым значением — источник и время. Поля, требующие клинической оценки (например, ШКГ), выбираете вы; шкала становится окончательной только с вашей подписью.",
             "SOFA and NEWS2 forms arrive pre-filled from lab and monitor values, each with its source and time beside it. You choose the fields that need clinical judgement (such as GCS); the score becomes final only with your signature."],
    alarms_t: ["Xəbər zənciri", "Alarm ve haber zinciri", "Цепочка оповещения", "Alert chain"],
    alarms_d: ["Hər həyəcan siqnalı kimin nə vaxt gördüyü ilə birlikdə qeydə alınır. Cavab olmasa, xəbər bölmənin qurduğu ardıcıllıqla növbəti şəxsə keçir: baş tibb bacısı, həkim, təcili müdaxilə komandası.",
               "Her alarm, kimin ne zaman gördüğüyle birlikte kayda geçer. Yanıt gelmezse haber, birimin kurduğu sırayla bir sonraki kişiye gider: sorumlu hemşire, hekim, hızlı müdahale ekibi.",
               "Каждая тревога фиксируется вместе с тем, кто и когда её увидел. Если ответа нет, оповещение переходит к следующему в порядке, заданном отделением: старшая медсестра, врач, бригада быстрого реагирования.",
               "Every alarm is recorded with who saw it and when. If no one answers, it moves to the next person in the order the unit has set: charge nurse, physician, rapid response team."],
    rrt_t: ["Təcili müdaxilə komandası", "Hızlı müdahale ekibi", "Бригада быстрого реагирования", "Rapid response team"],
    rrt_d: ["Komandaya ötürülən və tezliklə ötürülə biləcək xəstələr ayrıca siyahılanır; hər kartda səbəb, keçən vaxt və reanimasiya statusu görünür. \u201cYoldayam\u201d demək bir toxunuşdur, çağıran tərəf bunu dərhal görür.",
            "Ekibe eskale edilen ve yakında edilebilecek hastalar ayrı listelenir; her kartta sebep, geçen süre ve kod durumu görünür. \u201cYoldayım\u201d demek tek dokunuş, çağıran taraf bunu hemen görür.",
            "Пациенты, переданные бригаде, и те, кто может скоро понадобиться, показаны отдельно; на каждой карточке — причина, прошедшее время и статус реанимации. \u00abВыезжаю\u00bb — одно касание, и вызвавший сразу это видит.",
            "Patients escalated to the team, and those who may be soon, are listed separately; each card shows the reason, elapsed time and code status. \u201cOn my way\u201d is one tap, and the caller sees it at once."],
    wall_t: ["Divar monitoru", "Duvar monitörü", "Настенный монитор", "Wall monitor"],
    wall_d: ["Tibb bacısı postundakı ekran kimi: monitorlu çarpayılar canlı, portativ cihazla ölçülənlər son ölçmə vaxtı ilə, uzaqdan oxunacaq ölçüdə görünür. Çarpayıya toxunanda həmin xəstə tam ekranda açılır.",
             "Hemşire istasyonundaki ekran gibi: monitörlü yataklar canlı, portatif cihazla ölçülenler son ölçüm saatiyle, uzaktan okunacak büyüklükte görünür. Bir yatağa dokununca o hasta tam ekran açılır.",
             "Как экран на посту медсестры: койки с монитором — в реальном времени, с портативным измерением — со временем последнего замера, крупно, чтобы читать издалека. Нажмите на койку — пациент откроется на весь экран.",
             "Like the screen at the nurses' station: monitored beds live, spot-checked beds with the time of their last reading, large enough to read across the room. Tap a bed to open that patient full screen."],

    tasks_t: ["Tapşırıqlarım", "Görevlerim", "Мои задачи", "My tasks"],
    tasks_d: ["Növbədəki xəstələrin bütün işləri 24 saatlıq cədvəldə: forma, dərman, qulluq, analiz nümunəsi. Gecikən iş qırmızı ilə önə çıxır, görülən iş bir toxunuşla bağlanır və vaxtı ilə qeydə düşür.",
              "Nöbetteki hastaların bütün işleri 24 saatlik bir ızgarada: form, ilaç, bakım, numune. Geciken iş kırmızıyla öne çıkar; yapılan iş tek dokunuşla kapanır ve saatiyle kayda geçer.",
              "Вся работа по пациентам смены на 24-часовой сетке: формы, лекарства, уход, анализы. Просроченное выделено красным; выполненное закрывается одним касанием и записывается со временем.",
              "All work for the shift's patients on a 24-hour grid: forms, medications, care, samples. Overdue items stand out in red; finished ones close with one tap and are logged with the time."],
    bakim_t: ["Qulluq planı", "Bakım planı", "План ухода", "Care plan"],
    bakim_d: ["Sistem qeydlərdən ehtimal olunan tibb bacısı diaqnozlarını təklif edir; plana almaq və ya rədd etmək tibb bacısının qərarıdır. Plandakı fəaliyyətlər tapşırığa çevrilir, hər növbənin qiymətləndirməsi cədvəldə görünür.",
              "Sistem kayıtlardan olası hemşirelik tanılarını önerir; plana almak ya da reddetmek hemşirenin kararıdır. Plandaki faaliyetler göreve dönüşür, her vardiyanın değerlendirmesi tabloda görünür.",
              "Система предлагает возможные сестринские диагнозы по данным записей; включить их в план или отклонить — решение медсестры. Действия плана становятся задачами, оценка каждой смены видна в таблице.",
              "The system suggests possible nursing diagnoses from the record; adding or rejecting them is the nurse's decision. Planned actions become tasks, and each shift's evaluation shows in the table."],
    bedside_t: ["Çarpayı başında qeyd", "Yatak başı kayıt", "Записи у койки", "Bedside charting"],
    bedside_d: ["Planşetdə xəstənin kimliyi təsdiqlənir, portativ cihazın dəyərləri formaya düşür; tənəffüsü və şüuru tibb bacısı daxil edir. NEWS2 avtomatik hesablanır və xəstəxana protokolunun təklif etdiyi cavabın yanında görünür; qərar həkimindir.",
                "Tablette hasta kimliği doğrulanır, portatif cihazın değerleri forma gelir; solunumu ve bilinci hemşire girer. NEWS2 kendiliğinden hesaplanır ve hastane protokolünün önerdiği yanıtın yanında görünür; karar hekimindir.",
                "На планшете подтверждается личность пациента, значения портативного прибора попадают в форму; дыхание и сознание вводит медсестра. NEWS2 считается автоматически и показывается рядом с ответом, предложенным протоколом больницы; решение принимает врач.",
                "The patient's identity is confirmed on a tablet and the portable device's readings fill the form; the nurse enters respiration and consciousness. NEWS2 is calculated automatically and shown next to the response the hospital protocol suggests; the decision is the physician's."],
    portatif_t: ["Portativ ölçmə paneli", "Portatif ölçüm paneli", "Панель портативных измерений", "Portable reading panel"],
    portatif_d: ["Monitoru olmayan çarpayıda da eyni görünüş: hər göstəricinin son dəyəri, əvvəlkinə görə fərqi, 24 saatlıq mini əyrisi və növbəti ölçməyə qalan vaxt. Canlı dalğa göstərilmir — hər rəqəmin yanında ölçmə vaxtı yazılır.",
                 "Monitörü olmayan yatakta da aynı görünüm: her vitalin son değeri, bir öncekine göre farkı, 24 saatlik mini eğrisi ve sıradaki ölçüme kalan süre. Canlı dalga gösterilmez — her rakamın yanında ölçüm saati yazar.",
                 "Тот же вид для койки без монитора: последнее значение каждого показателя, разница с предыдущим, мини-кривая за 24 часа и время до следующего замера. Живой кривой нет — у каждого числа указано время измерения.",
                 "The same view for beds without a monitor: each vital's last value, the change since the previous reading, a 24-hour mini-trend and the time until the next reading. No live waveform is shown; every number carries its measurement time."],
    hand_t: ["Möhürlü təhvil", "Mühürlü devir", "Скреплённая передача", "Sealed handover"],
    hand_d: ["Təhvil qeydini sistem xəstənin qeydlərindən hazırlayır, komanda düzəldir və imzalayır. Növbəni qəbul edən tibb bacısı oxuyub qarşı imza atır; imzalanmış qeyd artıq dəyişdirilə bilməz.",
             "Devir notunu sistem hastanın kayıtlarından hazırlar, ekip düzenler ve imzalar. Devralan hemşire okuyup karşı imza atar; imzalanan not artık değiştirilemez.",
             "Черновик передачи система готовит из записей пациента, команда правит и подписывает. Принимающая медсестра читает и ставит встречную подпись; после подписи запись изменить нельзя.",
             "The system drafts the handover note from the patient's record; the team edits and signs it. The incoming nurse reads it and countersigns; once signed, the note can no longer be changed."],

    admission_t: ["Qəbul və çarpayı doluluğu", "Kabul ve yatak doluluğu", "Приём и занятость коек", "Admissions and bed occupancy"],
    admission_d: ["Blok, mərtəbə, bölmə və otağa görə bütün çarpayılar: boş, dolu, təmizlikdə, rezervdə, istifadədən kənar. Bu ekranda kliniki məlumat yoxdur; qəbul əməkdaşı yalnız işi üçün lazım olanı görür.",
                  "Blok, kat, birim ve odaya göre bütün yataklar: boş, dolu, temizlikte, rezerve, kullanım dışı. Bu ekranda klinik bilgi yok; kabul ekibi yalnız işi için gerekeni görür.",
                  "Все койки по корпусу, этажу, отделению и палате: свободна, занята, на уборке, в резерве, выведена из работы. Клинической информации на этом экране нет; сотрудники приёма видят только нужное для своей работы.",
                  "Every bed by block, floor, unit and room: free, occupied, being cleaned, reserved, out of service. There is no clinical information on this screen; admissions staff see only what their job needs."],
    workload_t: ["Tibb bacısı iş yükü", "Hemşire iş yükü", "Нагрузка медсестёр", "Nursing workload"],
    workload_d: ["Bölmə üzrə xəstə, tibb bacısı, gecikən və qalan iş sayı, növbə boyu işin saatlara bölgüsü. Baş tibb bacısı bölgünü buna baxaraq tənzimləyir; şəxslər sıralanmır.",
                 "Birim başına hasta, hemşire, geciken ve kalan iş; vardiya boyunca işin saatlere dağılımı. Sorumlu hemşire dağıtımı buna bakarak düzenler; kişiler sıralanmaz.",
                 "Пациенты, медсёстры, просроченная и оставшаяся работа по отделениям и распределение работы по часам смены. Старшая медсестра выравнивает по ней распределение; рейтинга сотрудников нет.",
                 "Patients, nurses, overdue and remaining work per unit, and how the work spreads across the hours of the shift. The charge nurse balances assignments with it; people are not ranked."],
    devices_t: ["Cihazlar və texniki xidmət", "Cihazlar ve bakım takvimi", "Приборы и обслуживание", "Devices and maintenance"],
    devices_d: ["İnventar, texniki xidmət və kalibrləmə təqvimi, açıq nasazlıq qeydləri bir yerdə. Məlumat göndərməyən monitor və ya batareyası azalan portativ cihaz xəstə ekranında boşluq kimi görünməzdən əvvəl burada görünür.",
                "Envanter, bakım ve kalibrasyon takvimi, açık arıza kayıtları tek yerde. Veri göndermeyen monitör ya da şarjı azalan portatif cihaz, bir hasta ekranında boşluk olarak görünmeden önce burada görünür.",
                "Реестр, график обслуживания и калибровки, открытые заявки о неисправностях — в одном месте. Монитор, переставший передавать данные, или разряжающийся портативный прибор виден здесь раньше, чем как пробел на экране пациента.",
                "Inventory, the maintenance and calibration calendar and open fault reports in one place. A monitor that stopped sending data, or a portable device running low, shows up here before it shows up as a gap on a patient's screen."],
    quality_t: ["Keyfiyyət göstəriciləri", "Kalite göstergeleri", "Показатели качества", "Quality indicators"],
    quality_d: ["Həyəcan siqnalına cavab müddəti, eskalasiya payı, təhvil imzaları və qiymətləndirmələrin vaxtında aparılması bölmə-bölmə ölçülür. Şəxslər deyil, proseslər ölçülür; xəstə adı göstərilmir.",
                "Alarm yanıt süresi, eskalasyon oranı, devir imzaları ve değerlendirmelerin zamanında yapılması birim birim ölçülür. Kişiler değil süreçler ölçülür; hasta adı gösterilmez.",
                "Время ответа на тревогу, доля эскалаций, подписи при передаче смены и своевременность оценок — по каждому отделению. Измеряются процессы, а не люди; имена пациентов не показываются.",
                "Alarm response time, escalation rate, handover signatures and on-time assessments, measured unit by unit. Processes are measured, not people; no patient names are shown."],
    users_t: ["İstifadəçilər, rollar, audit", "Kullanıcılar, roller, denetim kaydı", "Пользователи, роли, аудит", "Users, roles, audit log"],
    users_d: ["Hər istifadəçinin rolu, bölmələri, iki mərhələli təsdiqi və son girişi. Heç kim işinə aid olmayan ekranı görmür; hər dəyişiklik və hər qeydə baxış audit jurnalına yazılır.",
              "Her kullanıcının rolü, birimleri, iki adımlı doğrulaması ve son girişi. Kimse işi olmayan ekranı görmez; her değişiklik ve her kayıt görüntüleme denetim kaydına yazılır.",
              "Роль каждого пользователя, его отделения, двухфакторный вход и время последнего входа. Никто не видит экран, не нужный для его работы; каждое изменение и каждый просмотр записи попадают в журнал аудита.",
              "Each user's role, units, two-step sign-in and last login. Nobody sees a screen their job doesn't need; every change and every record view is written to the audit log."],
  };
  var t = function (k) { var v = T[k]; return v ? v[IDX[lang]] : k; };

  /* rol → beş ekran (anahtar = gorsel/<anahtar>-<dil>-<tema>.webp) */
  var ROLES = [
    { k:"doc", ic:"heart", items:["unitdash", "skor", "alarms", "rrt", "wall"] },
    { k:"nur", ic:"clip",  items:["tasks", "bakim", "bedside", "portatif", "hand"] },
    { k:"org", ic:"bldg",  items:["admission", "workload", "devices", "quality", "users"] },
  ];
  var ICON = {
    heart:'<path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
    clip:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
    bldg:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    zoom:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
    pause:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    play:'<path d="M7 4v16l13-8z"/>',
    x:'<path d="M18 6 6 18M6 6l12 12"/>',
  };
  var ic = function (n) { return '<svg class="ne-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + "</svg>"; };

  /* ---------- CSS: yalnız #neler altında ---------- */
  var CSS = [
    '#neler-mount { min-width:0; }',
    '#neler-mount, #neler-mount * { box-sizing:border-box; }',
    '#neler svg.ne-i { width:18px; height:18px; flex:none; }',
    '#neler button { font:inherit; color:inherit; }',
    '#neler :focus-visible { outline:2px solid var(--pri); outline-offset:2px; border-radius:10px; }',
    /* rol seçici */
    '#neler .ne-roles { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:6px; padding:6px; background:var(--card); border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadowS); margin-bottom:10px; }',
    '#neler .ne-role { display:flex; align-items:center; gap:12px; min-width:0; padding:10px 14px; border:0; border-radius:13px; background:none; cursor:pointer; text-align:left; color:var(--mute); transition:background .2s, color .2s; }',
    '#neler .ne-role:hover { background:var(--card2); color:var(--ink); }',
    '#neler .ne-role .ne-ric { width:38px; height:38px; border-radius:11px; display:grid; place-items:center; background:var(--card2); color:var(--mute); flex:none; transition:background .2s, color .2s; }',
    '#neler .ne-role b { display:block; font:700 16px "Space Grotesk", Figtree, system-ui, sans-serif; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '#neler .ne-role small { display:block; font:600 12.5px Figtree, system-ui, sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '#neler .ne-role > span:last-child { min-width:0; }',
    '#neler .ne-role.on { background:var(--priSoft); color:var(--priInk); }',
    '#neler .ne-role.on .ne-ric { background:var(--pri); color:var(--onpri); }',
    '#neler .ne-hint { margin:0 4px 16px; color:var(--mute); font:500 13.5px Figtree, system-ui, sans-serif; }',
    /* sahne */
    '#neler .ne-stage { display:grid; grid-template-columns:minmax(300px, 400px) minmax(0, 1fr); gap:22px; align-items:start; }',
    '#neler .ne-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; min-width:0; }',
    '#neler .ne-it { position:relative; display:flex; gap:12px; width:100%; padding:14px 16px; border:1px solid var(--line); border-radius:16px; background:var(--card); cursor:pointer; text-align:left; overflow:hidden; transition:border-color .2s, box-shadow .2s, background .2s; }',
    '[data-theme="gece"] #neler .ne-it { background:#07101f; }',
    '#neler .ne-it:hover { border-color:var(--line2); }',
    '#neler .ne-it.on { border-color:var(--pri); box-shadow:var(--shadowS); }',
    '#neler .ne-n { width:28px; height:28px; border-radius:9px; display:grid; place-items:center; background:var(--card2); color:var(--mute); font:700 13px "JetBrains Mono", ui-monospace, monospace; flex:none; transition:background .2s, color .2s; }',
    '#neler .ne-it.on .ne-n { background:var(--pri); color:var(--onpri); }',
    '#neler .ne-tx { min-width:0; flex:1; }',
    '#neler .ne-tx b { display:block; font:700 15.5px Figtree, system-ui, sans-serif; color:var(--ink); line-height:1.35; padding-top:3px; }',
    '#neler .ne-tx p { margin:0; color:var(--mute); font-size:14px; line-height:1.55; max-height:0; opacity:0; overflow:hidden; transition:max-height .35s ease, opacity .25s ease, margin .35s ease; }',
    '#neler .ne-it.on .ne-tx p { max-height:260px; opacity:1; margin-top:6px; }',
    '#neler .ne-pg { position:absolute; left:0; bottom:0; height:3px; width:0; background:var(--pri); opacity:0; }',
    '#neler .ne-it.on .ne-pg { opacity:.9; }',
    '#neler .ne-it.on .ne-pg.run { width:100%; transition:width linear; transition-duration:inherit; }',
    /* çerçeve */
    '#neler .ne-frame { margin:0; min-width:0; background:var(--card); border:1px solid var(--line); border-radius:20px; box-shadow:var(--shadow); overflow:hidden; position:sticky; top:88px; }',
    '#neler .ne-top { display:flex; align-items:center; gap:10px; padding:10px 12px 10px 14px; border-bottom:1px solid var(--line); min-width:0; }',
    '#neler .ne-dots { display:flex; gap:6px; flex:none; } #neler .ne-dots i { width:10px; height:10px; border-radius:50%; background:var(--line2); }',
    '#neler .ne-crumb { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--mute); font:600 12.5px Figtree, system-ui, sans-serif; }',
    '#neler .ne-crumb b { color:var(--ink); font:700 13.5px "Space Grotesk", Figtree, sans-serif; }',
    '#neler .ne-ib { display:inline-grid; place-items:center; width:32px; height:32px; border-radius:9px; border:1px solid var(--line); background:var(--card); cursor:pointer; flex:none; color:var(--mute); }',
    '#neler .ne-ib:hover { color:var(--ink); border-color:var(--line2); }',
    '#neler .ne-ib svg.ne-i { width:16px; height:16px; }',
    '#neler .ne-shot { position:relative; display:block; width:100%; aspect-ratio:' + IMG_W + ' / ' + IMG_H + '; background:var(--card2); border:0; padding:0; cursor:zoom-in; }',
    '#neler .ne-shot img { display:block; width:100%; height:100%; object-fit:cover; object-position:top left; transition:opacity .25s ease; }',
    '#neler .ne-shot.ld img { opacity:.35; }',
    '#neler .ne-cap { display:flex; align-items:center; gap:10px; padding:9px 14px; border-top:1px solid var(--line); color:var(--mute); font:500 12.5px Figtree, system-ui, sans-serif; }',
    '#neler .ne-cap span { flex:1; min-width:0; }',
    /* büyütme */
    '#neler .ne-dlg { padding:0; border:0; background:transparent; max-width:min(96vw, 1400px); width:100%; max-height:94vh; }',
    '#neler .ne-dlg::backdrop { background:rgba(4,10,20,.78); }',
    '#neler .ne-dlg img { display:block; width:100%; height:auto; max-height:88vh; object-fit:contain; border-radius:14px; box-shadow:0 30px 80px rgba(0,0,0,.5); background:var(--card); }',
    '#neler .ne-dlg .ne-ib { position:absolute; top:10px; right:10px; background:var(--card); }',
    '#neler .ne-dlg p { margin:10px 4px 0; color:#e8eef7; font:600 13px Figtree, system-ui, sans-serif; text-align:center; }',
    '@media (max-width:1080px) { #neler .ne-stage { grid-template-columns:minmax(0, 1fr); } #neler .ne-frame { position:relative; top:0; order:-1; } }',
    '@media (max-width:760px) {',
    '  #neler .ne-roles { grid-template-columns:repeat(3, minmax(0, 1fr)); gap:4px; padding:4px; }',
    '  #neler .ne-role { flex-direction:column; gap:6px; padding:9px 4px; text-align:center; }',
    '  #neler .ne-role small { display:none; }',
    '  #neler .ne-role b { font-size:13.5px; white-space:normal; line-height:1.2; }',
    '  #neler .ne-role .ne-ric { width:32px; height:32px; }',
    '  #neler .ne-frame { border-radius:14px; }',
    '  #neler .ne-top { padding:8px 10px; } #neler .ne-dots { display:none; }',
    '  #neler .ne-cap { padding:8px 10px; font-size:12px; }',
    '  #neler .ne-it { padding:12px 13px; }',
    '}',
    '@media (prefers-reduced-motion:reduce) { #neler .ne-tx p, #neler .ne-shot img { transition:none; } #neler .ne-pg { display:none; } }',
  ].join("\n");
  if (!document.getElementById("neler-css")) { var st = document.createElement("style"); st.id = "neler-css"; st.textContent = CSS; document.head.appendChild(st); }

  /* ---------- iskelet ---------- */
  mount.innerHTML =
    '<div class="ne-roles" role="tablist"></div>' +
    '<p class="ne-hint"></p>' +
    '<div class="ne-stage">' +
      '<ol class="ne-list" role="tabpanel"></ol>' +
      '<figure class="ne-frame">' +
        '<div class="ne-top"><span class="ne-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="ne-crumb"></span>' +
          '<button type="button" class="ne-ib ne-zoomBtn">' + ic("zoom") + '</button></div>' +
        '<button type="button" class="ne-shot"><img width="' + IMG_W + '" height="' + IMG_H + '" loading="lazy" decoding="async" alt=""></button>' +
        '<figcaption class="ne-cap"><span></span><button type="button" class="ne-ib ne-playBtn"></button></figcaption>' +
      '</figure>' +
    '</div>' +
    '<dialog class="ne-dlg"><img alt=""><button type="button" class="ne-ib ne-close">' + ic("x") + '</button><p></p></dialog>';
  var q = function (s) { return mount.querySelector(s); };
  var rolesEl = q(".ne-roles"), listEl = q(".ne-list"), shot = q(".ne-shot"), img = shot.querySelector("img"), crumb = q(".ne-crumb"),
      capTx = q(".ne-cap span"), playBtn = q(".ne-playBtn"), zoomBtn = q(".ne-zoomBtn"), dlg = q(".ne-dlg"), dlgImg = dlg.querySelector("img"), frame = q(".ne-frame");

  var S = { role:0, item:0, playing:!reduced, userStopped:false, inView:false };
  var theme = function () { return document.documentElement.getAttribute("data-theme") === "gece" ? "gece" : "gun"; };
  var srcOf = function (key) { return BASE + key + "-" + lang + "-" + theme() + ".webp"; };
  var cur = function () { return ROLES[S.role].items[S.item]; };

  function drawRoles() {
    rolesEl.setAttribute("aria-label", t("pick"));
    rolesEl.innerHTML = ROLES.map(function (r, i) {
      return '<button type="button" role="tab" class="ne-role' + (i === S.role ? " on" : "") + '" data-role="' + i + '" id="neler-role-' + i + '" aria-selected="' + (i === S.role) + '" tabindex="' + (i === S.role ? 0 : -1) + '">' +
        '<span class="ne-ric">' + ic(r.ic) + '</span><span><b>' + t(r.k) + '</b><small>' + t(r.k + "_s") + '</small></span></button>';
    }).join("");
    listEl.setAttribute("aria-labelledby", "neler-role-" + S.role);
  }
  function drawList() {
    listEl.innerHTML = ROLES[S.role].items.map(function (k, i) {
      return '<li><button type="button" class="ne-it' + (i === S.item ? " on" : "") + '" data-item="' + i + '" aria-pressed="' + (i === S.item) + '">' +
        '<span class="ne-n">' + (i + 1) + '</span><span class="ne-tx"><b>' + t(k + "_t") + '</b><p>' + t(k + "_d") + '</p></span><i class="ne-pg"></i></button></li>';
    }).join("");
  }
  function markItem() {
    listEl.querySelectorAll(".ne-it").forEach(function (b, i) { var on = i === S.item; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    progress();
  }
  function progress() {
    listEl.querySelectorAll(".ne-pg").forEach(function (p) { p.classList.remove("run"); p.style.transitionDuration = "0ms"; });
    if (!S.playing || !S.inView || document.hidden) return;
    var p = listEl.querySelector(".ne-it.on .ne-pg"); if (!p) return;
    void p.offsetWidth; p.style.transitionDuration = STEP_MS + "ms"; p.classList.add("run");
  }
  var loadSeq = 0;
  function drawShot() {
    var k = cur(), src = srcOf(k), title = t(k + "_t"), seq = ++loadSeq;
    crumb.innerHTML = t(ROLES[S.role].k) + ' · <b>' + title + '</b>';
    img.alt = t("alt") + title;
    if (img.getAttribute("src") !== src) {
      shot.classList.add("ld");
      var done = function () { if (seq === loadSeq) shot.classList.remove("ld"); };
      img.onload = function () { if (img.decode) img.decode().then(done, done); else done(); preloadNext(); };
      img.onerror = done;
      img.src = src;
    }
    shot.setAttribute("aria-label", t("zoom") + ": " + title);
    zoomBtn.title = t("zoom"); zoomBtn.setAttribute("aria-label", t("zoom") + ": " + title);
    if (dlg.open) openZoom();
  }
  /* sıradaki ekranı sessizce önceden indir (yalnız bölüm görünürken) */
  function preloadNext() {
    if (!S.inView) return;
    var r = ROLES[S.role], k = S.item + 1 < r.items.length ? r.items[S.item + 1] : ROLES[(S.role + 1) % ROLES.length].items[0];
    var im = new Image(); im.decoding = "async"; im.src = srcOf(k);
  }
  function drawStatic() {
    q(".ne-hint").textContent = t("hint");
    capTx.textContent = t("cap");
    dlg.querySelector(".ne-close").setAttribute("aria-label", t("close"));
    dlg.querySelector(".ne-close").title = t("close");
    drawAuto();
  }
  function drawAuto() {
    playBtn.hidden = reduced;
    playBtn.innerHTML = ic(S.playing ? "pause" : "play");
    playBtn.title = t(S.playing ? "pause" : "play"); playBtn.setAttribute("aria-label", t(S.playing ? "pause" : "play"));
    /* kendiliğinden ilerlerken ekran okuyucuyu boğmasın */
    listEl.setAttribute("aria-live", S.playing ? "off" : "polite");
  }
  function drawAll() { drawRoles(); drawList(); drawStatic(); drawShot(); progress(); }

  /* ---------- kendiliğinden ilerleme ---------- */
  var timer = 0;
  function schedule() { clearTimeout(timer); progress(); if (!S.playing || !S.inView || document.hidden) return; timer = setTimeout(step, STEP_MS); }
  function step() {
    if (S.item < ROLES[S.role].items.length - 1) { S.item++; markItem(); drawShot(); }
    else { S.role = (S.role + 1) % ROLES.length; S.item = 0; drawRoles(); drawList(); drawShot(); }
    schedule();
  }
  function stop() { if (!S.playing && S.userStopped) return; S.playing = false; S.userStopped = true; clearTimeout(timer); drawAuto(); progress(); }
  function setRole(i, focus) {
    S.role = (i + ROLES.length) % ROLES.length; S.item = 0; drawRoles(); drawList(); drawShot();
    if (focus) { var b = document.getElementById("neler-role-" + S.role); if (b) b.focus(); }
  }
  function setItem(i) { if (i === S.item) return; S.item = i; markItem(); drawShot(); }

  rolesEl.addEventListener("click", function (e) { var b = e.target.closest("[data-role]"); if (!b) return; stop(); setRole(+b.getAttribute("data-role")); });
  rolesEl.addEventListener("keydown", function (e) {
    var i = S.role;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i++; else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i--;
    else if (e.key === "Home") i = 0; else if (e.key === "End") i = ROLES.length - 1; else return;
    e.preventDefault(); stop(); setRole(i, true);
  });
  listEl.addEventListener("click", function (e) { var b = e.target.closest("[data-item]"); if (!b) return; stop(); setItem(+b.getAttribute("data-item")); });
  if (canHover) {
    var hv = 0;
    listEl.addEventListener("mouseover", function (e) { var b = e.target.closest("[data-item]"); if (!b) return; clearTimeout(hv); hv = setTimeout(function () { stop(); setItem(+b.getAttribute("data-item")); }, 140); });
    listEl.addEventListener("mouseleave", function () { clearTimeout(hv); });
  }
  listEl.addEventListener("focusin", function () { stop(); });
  playBtn.addEventListener("click", function () {
    if (S.playing) return stop();
    S.playing = true; S.userStopped = false; drawAuto(); step();
  });

  /* büyütme: yerleşik <dialog> */
  function openZoom() {
    var k = cur(); dlgImg.src = srcOf(k); dlgImg.alt = t("alt") + t(k + "_t");
    dlg.querySelector("p").textContent = t(ROLES[S.role].k) + " · " + t(k + "_t");
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
  }
  var zoom = function () { stop(); openZoom(); };
  shot.addEventListener("click", zoom); zoomBtn.addEventListener("click", zoom);
  dlg.querySelector(".ne-close").addEventListener("click", function () { dlg.close ? dlg.close() : dlg.removeAttribute("open"); });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) { dlg.close ? dlg.close() : dlg.removeAttribute("open"); } });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        S.inView = en.isIntersecting;
        if (S.inView && !S.userStopped && !reduced) { S.playing = true; drawAuto(); preloadNext(); }
        schedule();
      });
    }, { threshold:.3 }).observe(frame);
  } else { S.inView = true; }
  document.addEventListener("visibilitychange", schedule);

  /* ---------- dil ve tema ---------- */
  document.addEventListener("hmc:lang", function (e) {
    var l = e && e.detail; if (typeof l === "string") l = l.toUpperCase();
    if (!(l in IDX) || l === lang) return;
    lang = l; drawAll();
  });
  if (window.MutationObserver) new MutationObserver(function () { drawShot(); }).observe(document.documentElement, { attributes:true, attributeFilter:["data-theme"] });

  drawAll(); schedule();
  window.HMC_NELER = { role:function (i) { stop(); setRole(i); }, item:function (i) { stop(); setItem(i); }, play:function () { if (!reduced) { S.playing = true; S.userStopped = false; drawAuto(); schedule(); } }, pause:stop, state:S };
})();
