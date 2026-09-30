/* Homunculus · telefon düzeni (PWA) · 24.09.2026
 * Kararlar (Taslak 22 + mobil-tasarim-plani.md): alt menü C (ortada eylem düğmesi) · üst çubuk C (arama öncelikli)
 * · Bana C (öncelik kartı + liste) · Hastalar A (yatak kartları) · seçili sekme B (dolgu hap) · orta düğme A (çentikli daire).
 * Ekran ≤ 760 px ise kendiliğinden devreye girer. Masaüstü kabuğu çizildikten sonra: sol şerit gizlenir, üst çubuk
 * telefon üst çubuğuyla değişir, alt menü eklenir. Sayfalar yeniden yazılmaz; yeni sayfa yalnız Bana, Hastalar (kart),
 * Bildirimler ve "masaüstünde açın". Onaylanan 8 madde: iPhone bildirim sınırı · kaydırarak onay · bağlantı kopması ·
 * bileklik okutma · titreşim · otomatik gece teması · hızlı yanıt tek dokunuş (rrt sayfasında zaten var) · PWA/Expo ayrımı. */
(function () {
  "use strict";
  const H = window.H;
  const MQ = window.matchMedia ? matchMedia("(max-width:760px)") : { matches:false, addEventListener() {} };
  const I = (k) => H.icon(k, "i");
  const esc = (s) => H.esc(String(s == null ? "" : s));

  H.addT({
    mt_home:{ AZ:"İşlərim", TR:"İşlerim", RU:"Мои задачи", EN:"My work" },
    mt_pts:{ AZ:"Xəstələr", TR:"Hastalar", RU:"Пациенты", EN:"Patients" },
    mt_measure:{ AZ:"Ölç", TR:"Ölç", RU:"Замер", EN:"Measure" },
    mt_alarm:{ AZ:"Həyəcan", TR:"Alarm", RU:"Тревоги", EN:"Alarms" },
    mt_notif:{ AZ:"Bildiriş", TR:"Bildirim", RU:"Уведомл.", EN:"Alerts" },
    mt_me:{ AZ:"Profil", TR:"Profil", RU:"Профиль", EN:"Profile" },
    m_photo_add:{ AZ:"Şəkil əlavə et", TR:"Fotoğraf ekle", RU:"Добавить фото", EN:"Add photo" },
    m_photo_chg:{ AZ:"Dəyiş", TR:"Değiştir", RU:"Изменить", EN:"Change" },
    m_photo_del:{ AZ:"Sil", TR:"Kaldır", RU:"Удалить", EN:"Remove" },
    m_photo_note:{ AZ:"Şəkil yalnız bu cihazda saxlanır (prototip).", TR:"Fotoğraf yalnız bu cihazda saklanır (prototip).", RU:"Фото хранится только на этом устройстве (прототип).", EN:"The photo is kept on this device only (prototype)." },
    mt_call:{ AZ:"Çağırış", TR:"Çağrı", RU:"Вызов", EN:"Calls" },
    mt_jobs:{ AZ:"İşlər", TR:"İşler", RU:"Работы", EN:"Jobs" },
    mt_devices:{ AZ:"Cihazlar", TR:"Cihazlar", RU:"Приборы", EN:"Devices" },
    mt_fault:{ AZ:"Nasazlıq", TR:"Arıza", RU:"Неиспр.", EN:"Fault" },
    mt_sum:{ AZ:"Xülasə", TR:"Özet", RU:"Сводка", EN:"Summary" },
    mt_info:{ AZ:"Məlumat", TR:"Bilgi", RU:"Инфо", EN:"Info" },
    m_search:{ AZ:"Xəstə, çarpayı axtar", TR:"Hasta, yatak ara", RU:"Пациент, койка", EN:"Search patient, bed" },
    m_now:{ AZ:"İndi", TR:"Şimdi", RU:"Сейчас", EN:"Now" },
    m_later:{ AZ:"Sonra", TR:"Sonra", RU:"Далее", EN:"Next" },
    m_crit_you:{ AZ:"Kritik · sizə düşdü", TR:"Kritik · size düştü", RU:"Критично · назначено вам", EN:"Critical · assigned to you" },
    m_high_you:{ AZ:"Yüksək · sizə düşdü", TR:"Yüksek · size düştü", RU:"Высокий · назначено вам", EN:"High · assigned to you" },
    m_swipe:{ AZ:"Gördüm · sağa sürüşdürün", TR:"Gördüm · sağa kaydırın", RU:"Видел · сдвиньте вправо", EN:"Seen · slide right" },
    m_open_pt:{ AZ:"Xəstəni aç", TR:"Hastayı aç", RU:"Открыть", EN:"Open patient" },
    m_escalate:{ AZ:"Eskalasiya", TR:"Eskale", RU:"Эскалация", EN:"Escalate" },
    m_seen_ok:{ AZ:"Görüldü kimi qeyd edildi. Eskalasiya dayandı.", TR:"Görüldü olarak kaydedildi. Eskalasyon durdu.", RU:"Отмечено как просмотренное. Эскалация остановлена.", EN:"Marked as seen. Escalation stopped." },
    m_esc_ok:{ AZ:"Növbəti pilləyə ötürüldü", TR:"Bir sonraki basamağa iletildi", RU:"Передано на следующую ступень", EN:"Passed to the next step" },
    m_late_tasks:{ AZ:"gecikmiş iş", TR:"geciken iş", RU:"просроченных задач", EN:"overdue tasks" },
    m_hand_wait:{ AZ:"təhvil əks imza gözləyir", TR:"devir karşı imza bekliyor", RU:"передача ждёт подписи", EN:"handovers await countersign" },
    m_unread:{ AZ:"oxunmamış bildiriş", TR:"okunmamış bildirim", RU:"непрочитанных", EN:"unread alerts" },
    m_calm:{ AZ:"İndi sizə düşən təcili iş yoxdur.", TR:"Şu an size düşen acil iş yok.", RU:"Сейчас срочных задач нет.", EN:"Nothing urgent for you right now." },
    m_all:{ AZ:"Hamısı", TR:"Hepsi", RU:"Все", EN:"All" },
    m_att:{ AZ:"Diqqət", TR:"Dikkat", RU:"Внимание", EN:"Attention" },
    m_stable:{ AZ:"Stabil", TR:"Stabil", RU:"Стабильно", EN:"Stable" },
    m_hr:{ AZ:"Nəbz", TR:"Nabız", RU:"Пульс", EN:"HR" },
    m_read_all:{ AZ:"Hamısını oxunmuş say", TR:"Tümünü okundu say", RU:"Прочитать все", EN:"Mark all read" },
    m_no_notif:{ AZ:"Bildiriş yoxdur.", TR:"Bildirim yok.", RU:"Уведомлений нет.", EN:"No alerts." },
    m_desk_t:{ AZ:"Bu rol masaüstündə işləyir", TR:"Bu rol masaüstünde çalışır", RU:"Эта роль работает на компьютере", EN:"This role works on a desktop" },
    m_desk_s:{ AZ:"İstifadəçi, rol və inteqrasiya ayarları telefonda açılmır. Kompüterdən daxil olun.", TR:"Kullanıcı, rol ve entegrasyon ayarları telefonda açılmaz. Bilgisayardan girin.", RU:"Настройки пользователей, ролей и интеграций на телефоне не открываются. Войдите с компьютера.", EN:"User, role and integration settings don't open on a phone. Sign in from a computer." },
    m_phone:{ AZ:"Telefon", TR:"Telefon", RU:"Телефон", EN:"Phone" },
    m_theme_auto:{ AZ:"Gecə temasını özü aç (20:00–08:00)", TR:"Gece temasını kendiliğinden aç (20:00–08:00)", RU:"Ночная тема автоматически (20:00–08:00)", EN:"Night theme automatically (20:00–08:00)" },
    m_offline_try:{ AZ:"Bağlantı kəsilməsini sına", TR:"Bağlantı kopmasını dene", RU:"Проверить обрыв связи", EN:"Try a lost connection" },
    m_offline_bar:{ AZ:"Bağlantı yoxdur · son məlumat {m} dəq əvvəl · ölçmələr telefonda gözləyir", TR:"Bağlantı yok · son veri {m} dk önce · ölçümler telefonda bekler", RU:"Нет связи · данные {m} мин назад · замеры ждут на телефоне", EN:"Offline · data from {m} min ago · measurements wait on the phone" },
    m_vib:{ AZ:"Titrəmə", TR:"Titreşim", RU:"Вибрация", EN:"Vibration" },
    m_vib_yes:{ AZ:"Kritik həyəcanda titrəyir", TR:"Kritik alarmda titrer", RU:"Вибрирует при критической тревоге", EN:"Vibrates on critical alarms" },
    m_vib_no:{ AZ:"Bu cihazda veb titrəmə yoxdur (iPhone)", TR:"Bu cihazda web titreşimi yok (iPhone)", RU:"На этом устройстве нет веб-вибрации (iPhone)", EN:"No web vibration on this device (iPhone)" },
    m_vib_try:{ AZ:"Sına", TR:"Dene", RU:"Проверить", EN:"Try" },
    m_push_steps:{ AZ:"Telefona bildiriş", TR:"Telefona bildirim", RU:"Уведомления на телефон", EN:"Phone notifications" },
    m_ios_need:{ AZ:"iPhone: bildiriş yalnız ana ekrana əlavə edildikdən sonra və HTTPS ilə işləyir; arxa planda səs yoxdur.", TR:"iPhone: bildirim yalnız ana ekrana eklendikten sonra ve HTTPS üzerinden çalışır; arka planda ses çalmaz.", RU:"iPhone: уведомления работают только после добавления на экран «Домой» и через HTTPS; без звука в фоне.", EN:"iPhone: notifications work only after Add to Home Screen and over HTTPS; no sound in the background." },
    m_https_no:{ AZ:"Bu ünvan HTTPS deyil → telefona bildiriş gəlmir. Tətbiqin görünüşü yoxlanıla bilər.", TR:"Bu adres HTTPS değil → telefona bildirim gelmez. Uygulamanın görünüşü denenebilir.", RU:"Адрес не HTTPS → уведомления не придут. Внешний вид проверить можно.", EN:"This address isn't HTTPS → no phone notifications. You can still check the layout." },
    m_backup:{ AZ:"Kritik həyəcanın ehtiyat kanalı (SMS / zəng): quraşdırmada müəyyən edilir.", TR:"Kritik alarmın yedek kanalı (SMS / çağrı): kurulumda belirlenir.", RU:"Резервный канал для критических тревог (SMS / звонок): определяется при установке.", EN:"Backup channel for critical alarms (SMS / call): set at installation." },
    m_signout:{ AZ:"Çıxış", TR:"Çıkış", RU:"Выйти", EN:"Sign out" },
    pin_on:{ AZ:"PIN təyin edilib · növbəti açılışda PIN ilə", TR:"PIN belirlendi · bir sonraki açılışta PIN ile", RU:"PIN задан · следующий вход по PIN", EN:"PIN set · next time sign in with your PIN" },
    pin_off:{ AZ:"PIN təyin edilməyib · hər dəfə şifrə ilə", TR:"PIN belirlenmedi · her seferinde şifreyle", RU:"PIN не задан · каждый раз пароль", EN:"No PIN · password every time" },
    mq_other2:{ AZ:"Başqa hesab", TR:"Başka hesap", RU:"Другой аккаунт", EN:"Other account" },
    pin_confirm:{ AZ:"İmzanı PIN ilə təsdiqləyin", TR:"İmzayı PIN ile onaylayın", RU:"Подтвердите подпись PIN-кодом", EN:"Confirm the signature with your PIN" },
    cr_title:{ AZ:"KRİTİK HƏYƏCAN", TR:"KRİTİK ALARM", RU:"КРИТИЧЕСКАЯ ТРЕВОГА", EN:"CRITICAL ALARM" },
    cr_test:{ AZ:"Kritik həyəcan sınağı", TR:"Kritik alarm denemesi", RU:"Проверка критической тревоги", EN:"Critical alarm test" },
    cr_test_s:{ AZ:"Tam ekran xəbərdarlığı, səsi və titrəməni yoxlayın", TR:"Tam ekran uyarıyı, sesi ve titreşimi deneyin", RU:"Проверьте полноэкранное оповещение, звук и вибрацию", EN:"Try the full-screen alert, sound and vibration" },
    cr_test_txt:{ AZ:"Sınaq · pisləşmə meyarları ödənilir", TR:"Deneme · kötüleşme kriterleri karşılanıyor", RU:"Проверка · критерии ухудшения выполнены", EN:"Test · deterioration criteria met" },
    rem_t:{ AZ:"Vaxtı yaxınlaşan işlər", TR:"Saati yaklaşan işler", RU:"Скоро по плану", EN:"Coming up" },
    rem_set:{ AZ:"İş xatırlatması", TR:"İş hatırlatma", RU:"Напоминания о задачах", EN:"Task reminders" },
    rem_set_s:{ AZ:"Saatı gələn iş üçün titrəmə və qısa xəbər", TR:"Saati gelen iş için titreşim ve kısa bildirim", RU:"Вибрация и короткое уведомление о задаче", EN:"Vibration and a short note when a task is due" },
    fs_t:{ AZ:"Yazı ölçüsü", TR:"Yazı boyu", RU:"Размер текста", EN:"Text size" },
    fs_1:{ AZ:"Normal", TR:"Normal", RU:"Обычный", EN:"Normal" }, fs_2:{ AZ:"Böyük", TR:"Büyük", RU:"Крупный", EN:"Large" }, fs_3:{ AZ:"Çox böyük", TR:"Çok büyük", RU:"Очень крупный", EN:"Extra large" },
    nr_t:{ AZ:"Gecə otağı rejimi", TR:"Gece odası modu", RU:"Режим ночной палаты", EN:"Night ward mode" },
    nr_s:{ AZ:"Qaranlıq, zəif işıq; xəstəni narahat etmir. Kritik rənglər qorunur.", TR:"Koyu, kısık ışık; hastayı rahatsız etmez. Kritik renkler korunur.", RU:"Тёмный, приглушённый свет, не мешает пациенту. Критические цвета сохраняются.", EN:"Dark, dimmed light that won't disturb the patient. Critical colours are kept." },
    m_back:{ AZ:"Geri", TR:"Geri", RU:"Назад", EN:"Back" },
    pth_more:{ AZ:"Xəstə məlumatını aç", TR:"Hasta bilgisini aç", RU:"Показать данные пациента", EN:"Show patient details" },
    pth_less:{ AZ:"Xəstə məlumatını bağla", TR:"Hasta bilgisini kapat", RU:"Скрыть данные пациента", EN:"Hide patient details" },
    vn_btn:{ AZ:"Səsli qeyd", TR:"Sesli not", RU:"Голосовая заметка", EN:"Voice note" },
    vn_t:{ AZ:"Xəstəyə qeyd", TR:"Hastaya not", RU:"Заметка о пациенте", EN:"Patient note" },
    vn_hint:{ AZ:"Danışın; mətn kimi yazılır. Mikrofon açılmırsa klaviaturadakı mikrofon düyməsindən istifadə edin.", TR:"Konuşun; yazı olarak düşer. Mikrofon açılmazsa klavyedeki mikrofon düğmesini kullanın.", RU:"Говорите — текст запишется. Если микрофон не открылся, используйте микрофон на клавиатуре.", EN:"Speak and it's written down. If the mic doesn't start, use the keyboard's mic button." },
    vn_rec:{ AZ:"Danış", TR:"Konuş", RU:"Говорить", EN:"Speak" }, vn_stop:{ AZ:"Dayandır", TR:"Durdur", RU:"Стоп", EN:"Stop" },
    vn_save:{ AZ:"Qeydi saxla", TR:"Notu kaydet", RU:"Сохранить", EN:"Save note" }, vn_ok:{ AZ:"Qeyd saxlanıldı", TR:"Not kaydedildi", RU:"Заметка сохранена", EN:"Note saved" },
    ct_btn:{ AZ:"Həkimə yaz / zəng", TR:"Hekime ulaş", RU:"Связаться с врачом", EN:"Contact physician" },
    ct_call:{ AZ:"Zəng et", TR:"Ara", RU:"Позвонить", EN:"Call" }, ct_int:{ AZ:"daxili", TR:"dahili", RU:"внутр.", EN:"ext." },
    ct_msgs:{ AZ:"Hazır mesaj göndər", TR:"Hazır mesaj gönder", RU:"Отправить готовое сообщение", EN:"Send a quick message" },
    ct_m1:{ AZ:"Qiymətləndirmə istəyir", TR:"Değerlendirme istiyor", RU:"Просит осмотра", EN:"Requests assessment" },
    ct_m2:{ AZ:"Kritik nəticə var", TR:"Kritik sonuç var", RU:"Есть критический результат", EN:"Critical result" },
    ct_m3:{ AZ:"Ağrı nəzarəti lazımdır", TR:"Ağrı kontrolü gerekiyor", RU:"Нужен контроль боли", EN:"Pain control needed" },
    ct_m4:{ AZ:"Ailə görüşmək istəyir", TR:"Aile görüşmek istiyor", RU:"Семья просит встречи", EN:"Family wants to talk" },
    ct_sent:{ AZ:"Göndərildi · {n}", TR:"Gönderildi · {n}", RU:"Отправлено · {n}", EN:"Sent · {n}" },
    ack_btn:{ AZ:"Gördüm", TR:"Gördüm", RU:"Видел", EN:"Seen" }, ack_by:{ AZ:"Gördü · {n} · {t}", TR:"Gördü · {n} · {t}", RU:"Просмотрено · {n} · {t}", EN:"Seen · {n} · {t}" },
    md_scan:{ AZ:"Oxut", TR:"Okut", RU:"Сканировать", EN:"Scan" },
    md_pt:{ AZ:"1 · Xəstə qolbağı", TR:"1 · Hasta bilekliği", RU:"1 · Браслет пациента", EN:"1 · Patient wristband" },
    md_drug:{ AZ:"2 · Dərman barkodu", TR:"2 · İlaç barkodu", RU:"2 · Штрихкод препарата", EN:"2 · Drug barcode" },
    md_ok:{ AZ:"uyğundur", TR:"eşleşti", RU:"совпадает", EN:"matched" }, md_bad:{ AZ:"UYĞUN DEYİL", TR:"EŞLEŞMEDİ", RU:"НЕ СОВПАДАЕТ", EN:"MISMATCH" },
    md_wrongpt:{ AZ:"Başqa xəstənin qolbağı: {b}", TR:"Başka hastanın bilekliği: {b}", RU:"Браслет другого пациента: {b}", EN:"Another patient's wristband: {b}" },
    md_wrongdrug:{ AZ:"Bu dərman bu tapşırıqda deyil: {c}", TR:"Bu ilaç bu görevde yok: {c}", RU:"Этого препарата нет в задании: {c}", EN:"This drug isn't in this task: {c}" },
    md_rights:{ AZ:"Doğru xəstə · doğru dərman · doğru vaxt", TR:"Doğru hasta · doğru ilaç · doğru saat", RU:"Верный пациент · препарат · время", EN:"Right patient · right drug · right time" },
    md_ph:{ AZ:"Dərman adı və ya barkod", TR:"İlaç adı ya da barkod", RU:"Название или штрихкод", EN:"Drug name or barcode" },
    fid_ready:{ AZ:"Face ID hazırdır", TR:"Face ID hazır", RU:"Face ID готов", EN:"Face ID ready" },
    fid_none:{ AZ:"Face ID bu telefonda hələ açılmayıb · Profil-dən açın", TR:"Face ID bu telefonda henüz açılmadı · Profil'den açın", RU:"Face ID на этом телефоне не включён · включите в профиле", EN:"Face ID isn't set up on this phone · turn it on in Profile" },
    fid_insecure:{ AZ:"Face ID bu ünvanda işləmir: təhlükəsiz (https) bağlantı lazımdır. PIN ilə daxil olun.", TR:"Face ID bu adreste çalışmaz: güvenli (https) bağlantı gerekir. PIN ile girin.", RU:"Face ID не работает на этом адресе: нужно защищённое (https) соединение. Войдите по PIN.", EN:"Face ID can't work on this address: a secure (https) connection is needed. Use your PIN." },
    fid_nodev:{ AZ:"Bu cihazda Face ID / barmaq izi yoxdur", TR:"Bu cihazda Face ID / parmak izi yok", RU:"На этом устройстве нет Face ID / отпечатка", EN:"This device has no Face ID / fingerprint" },
    fid_fail:{ AZ:"Üz tanınmadı və ya ləğv edildi. Yenidən sınayın və ya PIN ilə daxil olun.", TR:"Yüz tanınmadı ya da iptal edildi. Tekrar deneyin ya da PIN ile girin.", RU:"Лицо не распознано или отменено. Повторите или войдите по PIN.", EN:"Face not recognised or cancelled. Try again or use your PIN." },
    fid_wait:{ AZ:"Telefonun Face ID pəncərəsinə baxın…", TR:"Telefonun Face ID penceresine bakın…", RU:"Смотрите в окно Face ID…", EN:"Look at the Face ID prompt…" },
    fid_on:{ AZ:"Face ID-ni bu telefonda aç", TR:"Face ID'yi bu telefonda aç", RU:"Включить Face ID на этом телефоне", EN:"Turn on Face ID on this phone" },
    fid_off:{ AZ:"Face ID-ni bağla", TR:"Face ID'yi kapat", RU:"Выключить Face ID", EN:"Turn off Face ID" },
    fid_set_ok:{ AZ:"Face ID açıldı. Növbəti açılışda üzünüzlə daxil olacaqsınız.", TR:"Face ID açıldı. Bir sonraki açılışta yüzünüzle gireceksiniz.", RU:"Face ID включён. В следующий раз вход по лицу.", EN:"Face ID is on. Next time you'll sign in with your face." },
    pin_set:{ AZ:"PIN təyin et", TR:"PIN belirle", RU:"Задать PIN", EN:"Set PIN" },
    pin_chg:{ AZ:"PIN-i dəyiş", TR:"PIN değiştir", RU:"Изменить PIN", EN:"Change PIN" },
    pin_new:{ AZ:"Yeni 4 rəqəmli PIN", TR:"Yeni 4 haneli PIN", RU:"Новый PIN из 4 цифр", EN:"New 4-digit PIN" },
    pin_again:{ AZ:"PIN-i təkrar daxil edin", TR:"PIN'i tekrar girin", RU:"Повторите PIN", EN:"Enter the PIN again" },
    pin_mismatch:{ AZ:"PIN-lər eyni deyil", TR:"PIN'ler aynı değil", RU:"PIN не совпадают", EN:"PINs don't match" },
    pin_ok:{ AZ:"PIN saxlanıldı", TR:"PIN kaydedildi", RU:"PIN сохранён", EN:"PIN saved" },
    pin_none:{ AZ:"PIN təyin edilməyib · Profil-dən təyin edin", TR:"PIN belirlenmedi · Profil'den belirleyin", RU:"PIN не задан · задайте в профиле", EN:"No PIN set · set one in Profile" },
    pin_wrong:{ AZ:"PIN yanlışdır · qalan cəhd {n}", TR:"PIN yanlış · kalan deneme {n}", RU:"Неверный PIN · осталось попыток: {n}", EN:"Wrong PIN · {n} tries left" },
    pin_locked:{ AZ:"Çox səhv cəhd · şifrə ilə daxil olun", TR:"Çok fazla hatalı deneme · şifreyle girin", RU:"Слишком много попыток · войдите с паролем", EN:"Too many attempts · sign in with your password" },
    m_snd:{ AZ:"Həyəcan səsi", TR:"Alarm sesi", RU:"Звук тревоги", EN:"Alarm sound" },
    m_snd_on:{ AZ:"Açıqdır · kritik və yüksək həyəcanda çalır", TR:"Açık · kritik ve yüksek alarmda çalar", RU:"Включён · звучит при критической и высокой тревоге", EN:"On · plays for critical and high alarms" },
    m_snd_off:{ AZ:"Bağlıdır", TR:"Kapalı", RU:"Выключен", EN:"Off" },
    m_snd_ios:{ AZ:"iPhone: səssiz rejimdə də çalır (iOS 17+). Səs düyməsi ilə səviyyəni artırın.", TR:"iPhone: sessiz modda da çalar (iOS 17+). Ses düğmesiyle seviyeyi açın.", RU:"iPhone: звучит и в беззвучном режиме (iOS 17+). Увеличьте громкость кнопкой.", EN:"iPhone: plays in silent mode too (iOS 17+). Turn the volume up." },
    m_units:{ AZ:"şöbə", TR:"birim", RU:"отд.", EN:"units" },
    m_close:{ AZ:"Bağla", TR:"Kapat", RU:"Закрыть", EN:"Close" },
    m_shift_left:{ AZ:"Növbənin bitməsinə", TR:"Nöbet bitimine", RU:"До конца смены", EN:"Shift ends in" },
    mq_cont:{ AZ:"{n} olaraq davam et", TR:"{n} olarak devam et", RU:"Продолжить как {n}", EN:"Continue as {n}" },
    mq_face:{ AZ:"Face ID ilə aç", TR:"Face ID ile aç", RU:"Открыть по Face ID", EN:"Open with Face ID" },
    mq_face_in:{ AZ:"Face ID ilə daxil ol", TR:"Face ID ile gir", RU:"Войти по Face ID", EN:"Sign in with Face ID" },
    mq_pin:{ AZ:"PIN ilə daxil ol", TR:"PIN ile gir", RU:"Войти по PIN", EN:"Sign in with PIN" },
    mq_pin_t:{ AZ:"PIN daxil edin", TR:"PIN girin", RU:"Введите PIN", EN:"Enter PIN" },
    mq_other:{ AZ:"Başqa hesabla daxil ol", TR:"Başka hesapla giriş", RU:"Войти в другой аккаунт", EN:"Sign in with another account" },
    mq_back:{ AZ:"Geri", TR:"Geri", RU:"Назад", EN:"Back" },
    mq_proto:{ AZ:"Prototip: Face ID canlandırmadır, demo PIN 1234. Real məhsulda telefonun keçid açarı (passkey) istifadə olunur.", TR:"Prototip: Face ID canlandırmadır, demo PIN 1234. Gerçek üründe telefonun geçiş anahtarı (passkey) kullanılır.", RU:"Прототип: Face ID — имитация, демо-PIN 1234. В продукте используется ключ доступа (passkey) телефона.", EN:"Prototype: Face ID is simulated, demo PIN 1234. The product uses the phone's passkey." },
    m_quick:{ AZ:"Sürətli qayıdış", TR:"Hızlı dönüş", RU:"Быстрый вход", EN:"Quick return" },
    m_quick_on:{ AZ:"Bu telefonda: Face ID, yoxdursa PIN", TR:"Bu telefonda: Face ID, yoksa PIN", RU:"На этом телефоне: Face ID, иначе PIN", EN:"On this phone: Face ID, otherwise PIN" },
    m_forget:{ AZ:"Bu telefonda məni unut", TR:"Bu telefonda beni unut", RU:"Забыть меня на этом телефоне", EN:"Forget me on this phone" },
  });

  /* ---------- rol başına alt menü: [anahtar, ikon, etiket, sayfa, parametre, rozet] ---------- */
  const unread = () => H.myNotifs().filter(n => !n.read).length;
  const role = () => H.state.user && H.state.user.role;
  const extras = () => (H.state.user && H.state.user.extras) || [];
  function tabs() {
    const r = role(), rrt = extras().includes("rrt");
    const not = ["not", "bell", "mt_notif", "mnotif", null, unread], me = ["me", "user", "mt_me", "settings"];
    const home = rrt ? ["home", "zap", "mt_call", "rrt"] : ["home", "list", "mt_home", "mhome"];
    if (r === "hemsire") return [home, ["pts", "bed", "mt_pts", "mpts"], ["mid", "activity", "mt_measure", "bedside"], not, me];
    if (r === "hekim") return [home, ["pts", "bed", "mt_pts", "mpts"], ["mid", "alert", "mt_alarm", "alarms", null, () => H.openAlarms().length], not, me];
    if (r === "biyomed") return [["home", "clock", "mt_jobs", "devices", { tab:"takvim" }], ["pts", "cpu", "mt_devices", "devices", { tab:"envanter" }], ["mid", "plus", "mt_fault", "devices", { tab:"ariza" }], not, me];
    const sum = { eczaci:"pharmacy", kabul:"occupancy", yonetici:"summary", kalite:"quality" }[r];
    if (sum) return [["home", "chart", "mt_sum", sum], not, me];
    return [["home", "shield", "mt_info", "mdesk"], me];
  }
  function activeKey() {
    const pg = H.state.page, tab = (H.state.params || {}).tab, T = tabs();
    const exact = T.find(x => x[3] === pg && (!x[4] || x[4].tab === tab));
    if (exact) return exact[0];
    if (pg === "patient") return "pts";
    const byPage = T.find(x => x[3] === pg); return byPage ? byPage[0] : null;
  }
  function tabHtml() {
    const T = tabs(), on = activeKey(), mid = T.find(x => x[0] === "mid");
    const items = T.map(x => {
      const n = x[5] ? x[5]() : 0, isMid = x[0] === "mid";
      return `<button type="button" class="mt-i${x[0] === on ? " on" : ""}${isMid ? " mid" : ""}" data-mt="${x[0]}" aria-label="${esc(H.t(x[2]))}"${x[0] === on ? ' aria-current="page"' : ""}>
        ${isMid ? `<span class="mt-sp"></span>` : I(x[1])}<span class="mt-l">${esc(H.t(x[2]))}</span>${n && !isMid ? `<span class="mt-b">${n > 9 ? "9+" : n}</span>` : ""}</button>`;
    }).join("");
    const fab = mid ? `<button type="button" class="mt-fab${on === "mid" ? " on" : ""}" data-mt="mid" aria-label="${esc(H.t(mid[2]))}">${I(mid[1])}${mid[5] && mid[5]() ? `<span class="mt-b">${mid[5]()}</span>` : ""}</button>` : "";
    return `${fab}<nav class="mt-bar${mid ? " has-mid" : ""}" style="grid-template-columns:repeat(${T.length}, 1fr)">${items}</nav>`;
  }

  /* ---------- üst çubuk: arama öncelikli (C) + küçük sayfa etiketi ---------- */
  const stil = () => { const u = new URLSearchParams(location.search).get("stil"); return /^[ABC]$/.test(u || "") ? u : "A"; };
  let srchOpen = false;
  function topHtml() {
    const S = stil(); document.body.dataset.mstil = S;
    if (S !== "C") {
      const pg = H.pages[H.state.page], u = H.state.user, n = unread(), clinical = H.can("patient") && H.state.page !== "mdesk";
      const ini = (u.name || "?").replace(/^(Dr\.|Ecz\.)\s*/, "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
      const units = (u.units || []).map(H.unit).filter(Boolean), unit = H.state.unitId ? H.unit(H.state.unitId) : units.length === 1 ? units[0] : null;
      const sub = [unit ? (unit.tr || unit.name) : units.length > 1 ? units.length + " " + H.t("m_units") : "", H.SHIFT && (H.can("beds") || H.can("tasks")) ? H.t("m_shift_left") + " " + H.SHIFT.left : ""].filter(Boolean).join(" · ");
      if (srchOpen && clinical) return `<div class="mtop2 srch"><label class="msearch">${I("search")}<input data-search enterkeyhint="search" placeholder="${esc(H.t("m_search"))}"></label><button type="button" class="mib2" data-msrch aria-label="${esc(H.t("m_close"))}">${I("x")}</button></div>`;
      // 27.09 · #199 · alt menüde olmayan sayfada (hasta, ayrıntı) görünür geri düğmesi; önceden yalnız kaydırmayla dönülüyordu
      const detail = H.state.page === "patient" || !activeKey();
      return `<div class="mtop2">${detail ? `<button type="button" class="mib2 mback" data-mback aria-label="${esc(H.t("m_back"))}" title="${esc(H.t("m_back"))}">${I("chevL")}</button>` : ""}<div class="mt2-t"><b>${esc(H.state.page === "settings" ? H.t("mt_me") : pg ? pg.title(H.state.params) : "")}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
        ${clinical ? `<button type="button" class="mib2" data-msrch aria-label="${esc(H.t("m_search"))}">${I("search")}</button>` : ""}
        <button type="button" class="mib2" data-mt="not" aria-label="${esc(H.t("mt_notif"))}">${I("bell")}${n ? `<span class="mt-b">${n}</span>` : ""}</button>
        <button type="button" class="mav2" data-mt="me" aria-label="${esc(H.t("mt_me"))}">${esc(ini)}</button></div>`;
    }
    const pg = H.pages[H.state.page], u = H.state.user, n = unread();
    const clinical = H.can("patient") && H.state.page !== "mdesk";
    const ini = (u.name || "?").replace(/^(Dr\.|Ecz\.)\s*/, "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    const unit = H.state.unitId ? H.unit(H.state.unitId) : null;
    return `<div class="mtop">
      <div class="mtop-r">
        ${clinical ? `<label class="msearch">${I("search")}<input data-search enterkeyhint="search" placeholder="${esc(H.t("m_search"))}"></label>` : `<b class="mtop-t">${esc(pg ? pg.title(H.state.params) : "")}</b>`}
        <button type="button" class="mib" data-mt="not" aria-label="${esc(H.t("mt_notif"))}">${I("bell")}${n ? `<span class="mt-b">${n}</span>` : ""}</button>
        <button type="button" class="mav" data-mt="me" aria-label="${esc(H.t("mt_me"))}">${esc(ini)}</button>
      </div>
      ${clinical ? `<div class="mtop-lbl"><b>${esc(pg ? pg.title(H.state.params) : "")}</b>${unit ? ` · ${esc(unit.tr || unit.name || "")}` : ""}</div>` : ""}
    </div>`;
  }

  /* ---------- sayfa: Bana (öncelik kartı + liste) ---------- */
  const sevRank = { crit:0, high:1, mid:2, low:3, stable:4 };
  const bedNo = (p) => { const b = p && H.bed(p.bed); return b ? b.no : "—"; };
  const mmss = (m) => { const s = Math.round(m * 60); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  function row(t, cls, title, sub, go) {
    return `<button type="button" class="m-row" data-go='${esc(JSON.stringify(go || null))}'><span class="t mono">${esc(t)}</span><span class="bar ${cls}"></span><span class="tx"><b>${esc(title)}</b><small>${esc(sub)}</small></span>${go ? I("chevR") : ""}</button>`;
  }
  let vibrated = false;
  H.register("mhome", { title:() => H.t("mt_home"), perm:[], render(root) {
    const al = H.openAlarms().slice().sort((a, b) => (sevRank[a.sev] - sevRank[b.sev]) || (b.ageMin - a.ageMin));
    const top = al[0], rest = al.slice(1);
    const late = H.can("tasks") ? H.data.tasks.filter(t => t.state === "late" && H.inScope(t.pid)) : [];
    const due = H.can("tasks") ? H.data.tasks.filter(t => t.state === "due" && H.inScope(t.pid)).slice(0, 3) : [];
    const hand = H.can("hand") ? H.data.handovers.filter(h => h.state === "waiting" && H.inScope(h.pid)) : [];
    const n = unread(), u = H.state.user;
    // 25.09 · Ozan: ad ve tarih burada gereksiz (üst çubukta ve profilde var) → ekran doğrudan işlerle başlar
    let h = "";
    if (top) {
      const p = H.pt(top.pid);
      h += `<div class="m-hero ${top.sev}" data-aid="${top.id}">
        <div class="m-hero-h"><span>${esc(H.t(top.sev === "crit" ? "m_crit_you" : "m_high_you"))}</span><span class="mono">${mmss(top.ageMin)}</span></div>
        <h3>${esc(bedNo(p))}</h3><p>${esc(top.txt)}</p>
        <div class="m-swipe" data-swipe><span class="m-knob">${I("ok")}</span><span class="m-swipe-l">${esc(H.t("m_swipe"))}</span></div>
        <div class="m-acts"><button type="button" class="btn sm" data-open="${esc(top.pid)}">${esc(H.t("m_open_pt"))}</button><button type="button" class="btn sm r" data-esc="${top.id}">${esc(H.t("m_escalate"))}</button></div>
      </div>`;
      if (top.sev === "crit" && !vibrated && navigator.vibrate) { vibrated = true; try { navigator.vibrate([220, 120, 220]); } catch (e) {} }
    } else h += `<div class="m-calm">${I("ok")}<span>${esc(H.t("m_calm"))}</span></div>`;
    const later = [];
    rest.forEach(a => { const p = H.pt(a.pid); later.push(row(mmss(a.ageMin), a.sev === "crit" ? "c" : a.sev === "high" ? "h" : "m", bedNo(p) + " · " + a.txt.split(" · ")[0], a.txt.split(" · ").slice(1).join(" · "), ["patient", { pid:a.pid, tab:"ozet" }])); });
    if (late.length) later.push(row("!", "h", late.length + " " + H.t("m_late_tasks"), [...new Set(late.map(t => t.label))].slice(0, 2).join(" · "), ["tasks", {}]));
    due.forEach(t => { const p = H.pt(t.pid), hh = Math.floor(t.t) % 24, mm = Math.round((t.t % 1) * 60); later.push(row(String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0"), "", t.label, bedNo(p), ["tasks", {}])); });
    if (hand.length) later.push(row("", "", hand.length + " " + H.t("m_hand_wait"), hand.map(x => bedNo(H.pt(x.pid))).join(", "), ["hand", {}]));
    if (n) later.push(row("", "", n + " " + H.t("m_unread"), H.myNotifs().filter(x => !x.read)[0].title, ["mnotif", {}]));
    if (later.length) h += `<div class="m-h6">${esc(H.t("m_later"))}</div>${later.join("")}`;
    root.innerHTML = `<div class="m-page">${h}</div>`;
    wireRows(root);
    wireSwipe(root, top);
    root.querySelectorAll("[data-open]").forEach(b => b.onclick = () => H.go("patient", { pid:b.dataset.open, tab:"ozet" }));
    root.querySelectorAll("[data-esc]").forEach(b => b.onclick = () => { const a = H.data.alarms.find(x => x.id === +b.dataset.esc); if (a) { a.step = (a.step || 0) + 1; H.log("alarm eskale edildi (telefon)", a.pid); } H.toast(H.t("m_esc_ok")); H.renderApp(); });
  } });
  function wireRows(root) {
    root.querySelectorAll(".m-row[data-go]").forEach(b => b.onclick = () => { const g = JSON.parse(b.dataset.go || "null"); if (g) H.go(g[0], g[1] || {}); });
  }
  // madde 2 · kaydırarak onay: düğme değil, sona kadar sürüklenince "görüldü" olur; yarıda bırakılırsa geri döner
  function wireSwipe(root, alarm) {
    const tr = root.querySelector("[data-swipe]"); if (!tr || !alarm) return;
    const knob = tr.querySelector(".m-knob"); let x0 = null, dx = 0;
    const max = () => tr.clientWidth - knob.offsetWidth - 8;
    const move = (x) => { dx = Math.max(0, Math.min(max(), x - x0)); knob.style.transform = `translateX(${dx}px)`; tr.style.setProperty("--p", (dx / max()).toFixed(2)); };
    const end = () => { if (x0 == null) return; x0 = null;
      if (dx >= max() * 0.9) { alarm.state = "seen"; H.log("alarm görüldü (telefon, kaydırarak)", alarm.pid); H.toast(H.t("m_seen_ok")); return H.renderApp(); }
      knob.style.transition = "transform .2s"; knob.style.transform = ""; tr.style.setProperty("--p", 0); setTimeout(() => { knob.style.transition = ""; }, 220); dx = 0; };
    knob.addEventListener("pointerdown", e => { x0 = e.clientX; dx = 0; knob.setPointerCapture(e.pointerId); });
    knob.addEventListener("pointermove", e => { if (x0 != null) move(e.clientX); });
    knob.addEventListener("pointerup", end); knob.addEventListener("pointercancel", end);
  }

  /* ---------- sayfa: Hastalar (yatak kartları) ---------- */
  let ptFilter = "all";
  H.register("mpts", { title:() => H.t("mt_pts"), perm:"beds", render(root) {
    const pts = H.myPatients().slice().sort((a, b) => (sevRank[a.risk] ?? 5) - (sevRank[b.risk] ?? 5) || bedNo(a).localeCompare(bedNo(b)));
    const att = pts.filter(p => ["crit", "high", "mid"].includes(p.risk));
    const list = ptFilter === "att" ? att : ptFilter === "stable" ? pts.filter(p => !att.includes(p)) : pts;
    const chip = (k, l, n) => `<button type="button" class="m-chip${ptFilter === k ? " on" : ""}" data-f="${k}">${esc(H.t(l))} <b>${n}</b></button>`;
    root.innerHTML = `<div class="m-page"><div class="m-chips">${chip("all", "m_all", pts.length)}${chip("att", "m_att", att.length)}${chip("stable", "m_stable", pts.length - att.length)}</div>
      ${list.map(p => { const v = p.v || {}, r = p.risk || "stable";
        return `<button type="button" class="m-bed ${r}" data-pid="${esc(p.id)}"><span class="m-bed-h"><b class="mono">${esc(bedNo(p))}</b><span class="nm">${H.data.roles[role()].names ? esc(p.name) : ""}</span>${H.sevPill(r)}</span>
          <span class="m-bed-s">${esc(p.dx || "")}</span>
          <span class="m-bed-v">${v.hr != null ? `<span><small>${esc(H.t("m_hr"))}</small><b class="mono hr">${v.hr}</b></span>` : ""}${v.spo2 != null ? `<span><small>SpO₂</small><b class="mono spo">${v.spo2}</b></span>` : ""}${v.map != null ? `<span><small>MAP</small><b class="mono">${v.map}</b></span>` : ""}<span class="sc">${esc(H.scoreLabel(p))}</span></span></button>`; }).join("")}</div>`;
    root.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { ptFilter = b.dataset.f; H.renderApp(); });
    root.querySelectorAll("[data-pid]").forEach(b => b.onclick = () => H.go("patient", { pid:b.dataset.pid, tab:"ozet" }));
  } });

  /* ---------- sayfa: Bildirimler ---------- */
  H.register("mnotif", { title:() => H.t("mt_notif"), perm:[], render(root) {
    const L = H.myNotifs();
    root.innerHTML = `<div class="m-page"><div class="m-row-h"><span class="m-h6">${esc(H.t("m_now"))}</span>${L.some(n => !n.read) ? `<button type="button" class="btn sm" data-readall>${esc(H.t("m_read_all"))}</button>` : ""}</div>
      ${L.length ? L.map(n => { const crit = n.sev === "crit" || /kritik|critical|критич/i.test(n.body || "");
        return `<button type="button" class="m-row${n.read && !crit ? " read" : ""}" data-nid="${n.id}"><span class="t mono">${esc(n.at)}</span><span class="bar ${crit ? "c" : n.sev === "high" ? "h" : ""}"></span><span class="tx"><b>${esc(n.title)}</b><small>${esc(n.body)}</small>${crit ? (n.ack ? `<small class="ack">✓ ${esc(H.t("ack_by").replace("{n}", n.ack.by).replace("{t}", n.ack.at))}</small>` : `<span class="btn sm p ack-b" data-ack="${n.id}">${esc(H.t("ack_btn"))}</span>`) : ""}</span>${I("chevR")}</button>`; }).join("") : `<div class="m-calm">${I("ok")}<span>${esc(H.t("m_no_notif"))}</span></div>`}</div>`;
    root.querySelectorAll("[data-nid]").forEach(b => b.onclick = () => { const n = H.data.notifs.find(x => x.id === +b.dataset.nid); if (!n) return; n.read = true; H.go(n.go[0], n.go[1] || {}); });
    const ra = root.querySelector("[data-readall]"); if (ra) ra.onclick = () => { H.myNotifs().forEach(n => { n.read = true; }); H.renderApp(); };
  } });

  /* ---------- sayfa: masaüstünde açın (BT) ---------- */
  H.register("mdesk", { title:() => H.t("mt_info"), perm:[], render(root) {
    root.innerHTML = `<div class="m-page"><div class="m-desk">${I("tv")}<h3>${esc(H.t("m_desk_t"))}</h3><p>${esc(H.t("m_desk_s"))}</p></div></div>`;
  } });

  /* ---------- Ben (ayarlar) sayfasının başına telefon kartı ---------- */
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let simOffline = false;
  function phoneCard() {
    const canVib = !!navigator.vibrate && !isIOS();
    const auto = localStorage.getItem("hmc.themeAuto") === "1";
    return `<section class="m-card"><h4>${I("tablet")}${esc(H.t("m_phone"))}</h4>
      <div class="m-set m-sw"><span>${esc(H.t("m_snd"))}<small>${esc(H.t(H.sound && H.sound.state.on ? "m_snd_on" : "m_snd_off"))}</small>${isIOS() ? `<small>${esc(H.t("m_snd_ios"))}</small>` : ""}</span>
        <span style="display:flex;gap:8px;align-items:center">${H.sound ? `<button type="button" class="btn sm" data-msndt>${esc(H.t("m_vib_try"))}</button>` : ""}<input type="checkbox" data-msnd ${H.sound && H.sound.state.on ? "checked" : ""}></span></div>
      <label class="m-set m-sw"><span>${esc(H.t("m_theme_auto"))}</span><input type="checkbox" data-mauto ${auto ? "checked" : ""}></label>
      <div class="m-set"><div class="m-sw" style="cursor:default"><span>${esc(H.t("fs_t"))}</span></div><div class="m-seg" data-mfs>${["1", "2", "3"].map(v => `<button type="button" data-v="${v}" class="${(localStorage.getItem("hmc.mFs") || "1") === v ? "on" : ""}">${esc(H.t("fs_" + v))}</button>`).join("")}</div></div>
      <label class="m-set m-sw"><span>${esc(H.t("nr_t"))}<small>${esc(H.t("nr_s"))}</small></span><input type="checkbox" data-mnight ${localStorage.getItem("hmc.mNight") === "1" ? "checked" : ""}></label>
      ${H.can("tasks") ? `<label class="m-set m-sw"><span>${esc(H.t("rem_set"))}<small>${esc(H.t("rem_set_s"))}</small></span><input type="checkbox" data-mrem ${localStorage.getItem("hmc.mRem") !== "0" ? "checked" : ""}></label>` : ""}
      ${H.can("alarms") ? `<div class="m-set m-sw"><span>${esc(H.t("cr_test"))}<small>${esc(H.t("cr_test_s"))}</small></span><button type="button" class="btn sm" data-crtest>${esc(H.t("m_vib_try"))}</button></div>` : ""}
      <div class="m-set m-sw"><span>${esc(H.t("m_vib"))}<small>${esc(H.t(canVib ? "m_vib_yes" : "m_vib_no"))}</small></span>${canVib ? `<button type="button" class="btn sm" data-mvib>${esc(H.t("m_vib_try"))}</button>` : ""}</div>
      <label class="m-set m-sw"><span>${esc(H.t("m_offline_try"))}</span><input type="checkbox" data-moff ${simOffline ? "checked" : ""}></label>
      <div class="m-set"><div class="m-sw" style="cursor:default"><span>${esc(H.t("m_quick"))}<small>${esc(H.t(pinOf(H.state.user) ? "pin_on" : "pin_off"))}</small></span></div>
        <div class="m-qbtns"><button type="button" class="btn sm" data-pinset>${esc(H.t(pinOf(H.state.user) ? "pin_chg" : "pin_set"))}</button><button type="button" class="btn sm" data-mforget>${esc(H.t("m_forget"))}</button></div></div>
      <button type="button" class="btn m-out" data-mout>${I("out")}${esc(H.t("m_signout"))}</button></section>`;
  }

  /* madde 6 · otomatik gece teması: prototip saati (H.now) 20:00–08:00 arasındaysa koyu */
  function autoTheme() {
    if (localStorage.getItem("hmc.themeAuto") !== "1") return;
    const h = parseInt(String(H.now()).split(":")[0], 10); const th = (h >= 20 || h < 8) ? "gece" : "gun";
    if (H.state.theme !== th) { H.state.theme = th; H.savePref("theme", th); }
  }

  /* ---------- kabuğu sar ---------- */
  const base = H.renderApp;
  let lastUser = null, lastPg = null;
  H.renderApp = (anim) => {
    const u = H.state.user, mob = MQ.matches && !!u;
    if (mob) {
      autoTheme();
      const key = u.u + "|" + u.role + "|" + (H.state.realUser ? "pv" : "");
      if (key !== lastUser) { lastUser = key; const f = tabs()[0]; H.state.page = f[3]; H.state.params = f[4] || {};
        if (!H.state.realUser) try { localStorage.setItem("hmc.mRemember", JSON.stringify({ u:u.u, name:u.name, label:H.roleLabel ? H.roleLabel(u) : "" })); } catch (e) {} }
      closeQuick();
    } else if (!u) lastUser = null;
    if (H.state.page !== lastPg) { srchOpen = false; lastPg = H.state.page; }
    base(anim);
    avatars(); statusBar();
    const shell = document.querySelector("#root .shell");
    document.body.classList.toggle("mob", !!(mob && shell));
    let fx = document.querySelector(".mt-wrap");
    if (!mob || !shell) { if (fx) fx.remove(); const ob = document.querySelector(".m-off"); if (ob) ob.remove(); return; }
    shell.querySelector(".top").innerHTML = topHtml();
    if (!fx) { fx = document.createElement("div"); fx.className = "mt-wrap"; shell.appendChild(fx); }
    fx.innerHTML = tabHtml();
    let ob = shell.querySelector(".m-off");
    const off = simOffline || navigator.onLine === false;
    if (off && !ob) { ob = document.createElement("div"); ob.className = "m-off"; shell.querySelector(".main").insertBefore(ob, shell.querySelector(".content")); }
    if (ob) { if (off) ob.innerHTML = `${I("wifi")}<span>${esc(H.t("m_offline_bar").replace("{m}", "4"))}</span>`; else ob.remove(); }
    if (H.mAfter) setTimeout(H.mAfter, 0);
    if (H.state.page === "settings") {
      const c = shell.querySelector(".content"); c.insertAdjacentHTML("afterbegin", phoneCard());
      const a = c.querySelector("[data-mauto]"); if (a) a.onchange = () => { H.savePref("themeAuto", a.checked ? "1" : "0"); H.renderApp(); };
      const o = c.querySelector("[data-moff]"); if (o) o.onchange = () => { simOffline = o.checked; H.renderApp(); };
      const v = c.querySelector("[data-mvib]"); if (v) v.onclick = () => { try { navigator.vibrate([220, 120, 220]); } catch (e) {} };
      const so = c.querySelector("[data-mout]"); if (so) so.onclick = () => H.logout();
      const sd = c.querySelector("[data-msnd]"); if (sd && H.sound) sd.onchange = () => { if (sd.checked !== H.sound.state.on) H.sound.toggle(); H.renderApp(); };
      const st = c.querySelector("[data-msndt]"); if (st && H.sound) st.onclick = () => H.sound.test("crit");
      c.querySelectorAll("[data-mfs] button").forEach(b => b.onclick = () => { try { localStorage.setItem("hmc.mFs", b.dataset.v); } catch (e) {} H.renderApp(); });
      const ng = c.querySelector("[data-mnight]"); if (ng) ng.onchange = () => { try { localStorage.setItem("hmc.mNight", ng.checked ? "1" : "0"); } catch (e) {} if (ng.checked) { H.state.theme = "gece"; H.savePref("theme", "gece"); } H.renderApp(); };
      const rm = c.querySelector("[data-mrem]"); if (rm) rm.onchange = () => { try { localStorage.setItem("hmc.mRem", rm.checked ? "1" : "0"); } catch (e) {} };
      const ct = c.querySelector("[data-crtest]"); if (ct) ct.onclick = () => H.mCritTest && H.mCritTest();
      const ps = c.querySelector("[data-pinset]"); if (ps) ps.onclick = () => pinPad({ mode:"set", user:H.state.user });
      const fg = c.querySelector("[data-mforget]"); if (fg) fg.onclick = () => { try { localStorage.removeItem("hmc.mRemember"); } catch (e) {} fg.disabled = true; fg.textContent = "✓"; };
    }
  };
  document.addEventListener("click", (e) => {
    const sr = e.target.closest("[data-msrch]");
    if (sr && document.body.classList.contains("mob")) { srchOpen = !srchOpen; H.renderApp(); if (srchOpen) { const i = document.querySelector(".mtop2 [data-search]"); if (i) i.focus(); } return; }
    if (e.target.closest("[data-mback]") && document.body.classList.contains("mob")) { e.preventDefault(); if (!H.mBack()) { const f = tabs().find(t => t[0] === (H.state.page === "patient" ? "pts" : "home")) || tabs()[0]; H.go(f[3], Object.assign({}, f[4] || {})); } return; }
    const b = e.target.closest("[data-mt]"); if (!b || !document.body.classList.contains("mob")) return;
    const x = tabs().find(t => t[0] === b.dataset.mt) || (b.dataset.mt === "not" ? ["not", "", "", "mnotif"] : b.dataset.mt === "me" ? ["me", "", "", "settings"] : null);
    if (!x) return; e.preventDefault(); H.go(x[3], Object.assign({}, x[4] || {}));
  });
  /* ---------- hızlı dönüş (Taslak 23 · A, PIN yedek) ----------
   * Telefonda bir kez giren kişi hatırlanır; sonraki açılışta "… olarak devam et". Prototipte Face ID canlandırmadır ve
   * giriş, giriş ekranındaki hızlı giriş düğmesiyle yapılır (şifre/2FA atlanır). Gerçek üründe WebAuthn geçiş anahtarı + sunucu. */
  const FACE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1M15 9v1M9.5 15a3.5 3.5 0 0 0 5 0M12 9v4h-1"/></svg>';
  /* 25.09 · Ozan: "Face ID yüzü tanımasa bile açıyor". Önceki ekran yalnız canlandırmaydı. Şimdi:
   * Face ID = telefonun kendi doğrulaması (WebAuthn, platform doğrulayıcı, userVerification:"required"). Başarısızsa AÇILMAZ.
   * Tarayıcı bunu yalnız güvenli (https) adreste verir; http'de düğme kapalıdır ve nedeni yazar.
   * PIN = kişinin Profil'de kendisinin belirlediği 4 hane; 5 hatalı denemede kilitlenir, şifre gerekir.
   * Prototip sınırı: imza sunucuda doğrulanmıyor (sunucu yok); gerçek üründe WebAuthn doğrulaması sunucuda yapılır. */
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const rnd = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
  const credOf = (u) => { try { return u && localStorage.getItem("hmc.mCred." + u.u); } catch (e) { return null; } };
  const pinOf = (u) => { try { return u && localStorage.getItem("hmc.mPin." + u.u); } catch (e) { return null; } };
  const pinHash = (u, p) => { let h = 2166136261; for (const ch of (u.u + ":" + p + ":hmc")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
  async function bioState() {
    if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return "insecure";
    try { return (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) ? "ok" : "nodev"; } catch (e) { return "nodev"; }
  }
  let bioCache = "insecure"; bioState().then(v => { bioCache = v; });
  function bioStatusText(u) { u = u || H.state.user || remembered(); if (bioCache === "insecure") return H.t("fid_insecure"); if (bioCache === "nodev") return H.t("fid_nodev"); return H.t(credOf(u) ? "fid_ready" : "fid_none"); }
  async function enroll(u) {
    const c = await navigator.credentials.create({ publicKey:{ rp:{ name:"Homunculus" }, user:{ id:new TextEncoder().encode(u.u), name:u.u, displayName:u.name || u.u },
      challenge:rnd(32), pubKeyCredParams:[{ type:"public-key", alg:-7 }, { type:"public-key", alg:-257 }],
      authenticatorSelection:{ authenticatorAttachment:"platform", userVerification:"required", residentKey:"preferred" }, timeout:60000, attestation:"none" } });
    localStorage.setItem("hmc.mCred." + u.u, b64(c.rawId)); H.log("Face ID bu telefonda açıldı", u.u);
  }
  async function verify(u) {
    const id = credOf(u); if (!id) throw new Error("none");
    const a = await navigator.credentials.get({ publicKey:{ challenge:rnd(32), allowCredentials:[{ type:"public-key", id:unb64(id), transports:["internal"] }], userVerification:"required", timeout:60000 } });
    if (!a || !a.response || !(a.response.authenticatorData.byteLength)) throw new Error("fail");
    const flags = new Uint8Array(a.response.authenticatorData)[32]; if (!(flags & 0x04)) throw new Error("uv");   // UV biti: kişi gerçekten doğrulandı
    return true;
  }
  // PIN tuş takımı: mode "enter" (giriş) ya da "set" (Profil'de belirleme, iki kez)
  function pinPad(opts) { const { mode, user } = opts; let r = opts.r;
    closeQuick(); const q = document.createElement("div"); q.className = "mq"; q.setAttribute("role", "dialog");
    let pin = "", first = null, tries = 0;
    const title = mode === "set" ? H.t("pin_new") : H.t("mq_pin_t");
    const who = r ? String(r.name || r.u) : "";
    q.innerHTML = `<div class="mq-brand"><i>h</i>homunculus</div>${who && mode !== "set" ? `<b class="mq-who">${esc(who)}</b>` : ""}<h2 data-pt>${esc(title)}</h2><small data-pmsg>&nbsp;</small><div class="mq-dots"></div>
      <div class="mq-pad">${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(n => `<button type="button" data-k="${n}">${n}</button>`).join("")}<button type="button" class="ghost" data-k="back">${esc(H.t(mode === "enter" && !opts.onOk ? "mq_other2" : "mq_back"))}</button><button type="button" data-k="0">0</button><button type="button" class="ghost" data-k="del">⌫</button></div>`;
    const draw = () => { q.querySelector(".mq-dots").innerHTML = [0, 1, 2, 3].map(i => `<i class="${i < pin.length ? "f" : ""}"></i>`).join(""); };
    const bad = (msg) => { q.querySelector("[data-pmsg]").textContent = msg; q.classList.remove("bad"); void q.offsetWidth; q.classList.add("bad"); if (navigator.vibrate) try { navigator.vibrate(120); } catch (x) {} pin = ""; setTimeout(draw, 300); };
    q.addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (!b) return; const k = b.dataset.k;
      if (k === "back") { closeQuick(); if (mode === "enter" && !opts.onOk) { try { localStorage.removeItem("hmc.mRemember"); } catch (x) {} } return; } if (k === "del") { pin = pin.slice(0, -1); return draw(); }
      if (pin.length < 4) pin += k; draw(); if (pin.length < 4) return;
      if (mode === "set") {
        if (first == null) { first = pin; pin = ""; q.querySelector("[data-pt]").textContent = H.t("pin_again"); return setTimeout(draw, 150); }
        if (first !== pin) { first = null; q.querySelector("[data-pt]").textContent = H.t("pin_new"); return bad(H.t("pin_mismatch")); }
        try { localStorage.setItem("hmc.mPin." + user.u, pinHash(user, pin)); } catch (x) {} H.log("PIN belirlendi", user.u); closeQuick(); H.toast(H.t("pin_ok")); return H.renderApp();
      }
      const u = { u:r.u };
      if (pinOf(u) === pinHash(u, pin)) { if (opts.onOk) { closeQuick(); return opts.onOk(); } H.log("hızlı dönüş · PIN", r.u); return setTimeout(() => enter(r), 120); }
      tries++; if (tries >= 5) { try { localStorage.removeItem("hmc.mPin." + r.u); } catch (x) {} closeQuick(); H.toast(H.t("pin_locked"), "w"); return; }
      bad(H.t("pin_wrong").replace("{n}", 5 - tries)); });
    document.body.appendChild(q); draw();
  }
  const remembered = () => { try { return JSON.parse(localStorage.getItem("hmc.mRemember") || "null"); } catch (e) { return null; } };
  function closeQuick() { const q = document.querySelector(".mq"); if (q) q.remove(); }
  function enter(r) { const b = document.querySelector('[data-demo="' + r.u + '"]'); closeQuick(); if (b) b.click(); }
  function openQuick() {
    const r = remembered(); if (!r || H.state.user) return;
    if (!pinOf(r)) return;                       // PIN belirlenmemişse normal giriş ekranı
    return pinPad({ mode:"enter", r });
    closeQuick();
    const q = document.createElement("div"); q.className = "mq"; q.setAttribute("role", "dialog");
    const first = String(r.name || r.u).replace(/^(Dr\.|Ecz\.)\s*/, "").split(" ")[0];
    const who = (/^Dr\./.test(r.name || "") ? "Dr. " : "") + first;
    if (mode === "pin") { return pinPad({ mode:"enter", r }); }
    q.innerHTML = `<div class="mq-brand"><i>h</i>homunculus</div><div class="mq-ic">${FACE}</div><h2>${esc(H.t("mq_cont").replace("{n}", who))}</h2><small>${esc(r.label || "")}</small>
      <button type="button" class="mq-main" data-face ${bioCache === "ok" && credOf(r) ? "" : "disabled"}>${FACE}${esc(H.t("mq_face"))}</button>
      <div class="mq-st" data-fst>${esc(bioStatusText(r))}</div>
      ${pinOf(r) ? `<button type="button" class="mq-link" data-pin>${esc(H.t("mq_pin"))}</button>` : `<div class="mq-st">${esc(H.t("pin_none"))}</div>`}
      <button type="button" class="mq-link" data-other style="opacity:.8">${esc(H.t("mq_other"))}</button>`;
    q.querySelector("[data-face]").onclick = async () => { const st = q.querySelector("[data-fst]"); q.classList.add("scan"); st.textContent = H.t("fid_wait");
      try { await verify(r); q.classList.remove("scan"); q.classList.add("ok"); H.log("hızlı dönüş · Face ID", r.u); setTimeout(() => enter(r), 350); }
      catch (e) { q.classList.remove("scan"); q.classList.add("bad2"); st.textContent = H.t("fid_fail"); setTimeout(() => q.classList.remove("bad2"), 600); } };
    const pb = q.querySelector("[data-pin]"); if (pb) pb.onclick = () => openQuick("pin");
    q.querySelector("[data-other]").onclick = () => { try { localStorage.removeItem("hmc.mRemember"); } catch (e) {} closeQuick(); };
    document.body.appendChild(q);
  }
  // giriş ekranı her çizildiğinde (telefonda, hatırlanan kişi varsa) formun altına "Face ID ile gir"
  const root0 = document.getElementById("root");
  if (window.MutationObserver && root0) new MutationObserver(() => {
    if (!MQ.matches || H.state.user) return;
    const f = root0.querySelector('form[data-f="login"]'); const rr = remembered(); if (!f || f.querySelector(".m-faceid") || !rr || !pinOf(rr)) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "m-faceid"; b.innerHTML = esc(H.t("mq_pin"));
    b.onclick = () => openQuick(); f.appendChild(b);
  }).observe(root0, { childList:true, subtree:true });
  if (MQ.matches && !H.state.user && !new URLSearchParams(location.search).get("demo")) openQuick();

  const Q = new URLSearchParams(location.search);
  if (/^(gun|gece)$/.test(Q.get("tema") || "")) { H.state.theme = Q.get("tema"); document.body.dataset.theme = H.state.theme; }
  if (Q.get("demo") && !H.state.user) {
    closeQuick();
    const b = document.querySelector('[data-demo="' + Q.get("demo") + '"]');
    if (b) { b.click(); const pg = Q.get("sayfa"); if (pg && H.pages[pg]) { const pr = {}; if (pg === "patient") { const pt = H.myPatients()[0]; if (pt) { pr.pid = pt.id; pr.tab = "ozet"; } } H.go(pg, pr); } }
  }

  /* ---------- profil fotoğrafı (25.09 · Ozan: "profilde resim koyma alanı yok") ----------
   * Prototip: 256 px'e küçültülüp bu cihazda saklanır (hmc.avatar.<kullanıcı>). Gerçek üründe sunucuda, kurum politikasıyla. */
  const avKey = (u) => "hmc.avatar." + (u && u.u);
  const avGet = (u) => { try { return localStorage.getItem(avKey(u)); } catch (e) { return null; } };
  function avatars() {
    const u = H.state.user; if (!u) return; const img = avGet(u);
    document.querySelectorAll("#root .top .av, .mav, .mav2, .st-me .av, .st-who .av").forEach(el => {
      el.classList.toggle("has-ph", !!img); el.style.backgroundImage = img ? `url(${img})` : ""; });
    const card = document.querySelector(".st-me"); if (!card || card.querySelector(".av-ctl")) return;
    const c = document.createElement("div"); c.className = "av-ctl";
    c.innerHTML = `<label class="btn sm">${I("plus")}${esc(H.t(img ? "m_photo_chg" : "m_photo_add"))}<input type="file" accept="image/*" hidden></label>${img ? `<button type="button" class="btn sm" data-avdel>${esc(H.t("m_photo_del"))}</button>` : ""}`;
    card.appendChild(c);
    c.querySelector("input").onchange = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => {
        const S = 256, cv = document.createElement("canvas"); cv.width = cv.height = S; const x = cv.getContext("2d"), m = Math.min(im.width, im.height);
        x.drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, S, S);
        try { localStorage.setItem(avKey(u), cv.toDataURL("image/jpeg", .85)); } catch (err) {} H.renderApp(); }; im.src = r.result; }; r.readAsDataURL(f); };
    const d = c.querySelector("[data-avdel]"); if (d) d.onclick = () => { try { localStorage.removeItem(avKey(u)); } catch (e) {} H.renderApp(); };
  }
  /* ---------- ekran kilidi "hep açık": telefonun ekranı da kararmasın (Screen Wake Lock) ---------- */
  let wl = null;
  H.wake = async () => { let on = false; try { on = localStorage.getItem("hmc.lockMin") === "0"; } catch (e) {}
    if (on && !wl && navigator.wakeLock && H.state.user) { try { wl = await navigator.wakeLock.request("screen"); wl.addEventListener("release", () => { wl = null; }); } catch (e) {} }
    if (!on && wl) { try { wl.release(); } catch (e) {} wl = null; } };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) H.wake(); });
  document.addEventListener("pointerdown", () => H.wake(), { passive:true });

  /* ---------- iPhone üst şeridi (saat/çentik alanı) ekranın üst rengiyle aynı olsun (25.09 · "kesilmiş gibi") ---------- */
  function statusBar() {
    const dark = H.state.theme === "gece", full = document.querySelector(".mon-full"), q = document.querySelector(".mq");
    const c = full ? "#000000" : (q || !H.state.user) ? (MQ.matches ? "#0a3a4a" : (dark ? "#07101f" : "#eef0f3")) : MQ.matches ? (dark ? "#07101f" : "#f3f7fa") : (dark ? "#0a1628" : "#ffffff");
    let m = document.querySelector('meta[name="theme-color"]'); if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
    if (m.content !== c) m.content = c;
    document.documentElement.style.background = c;
  }
  new MutationObserver(() => statusBar()).observe(document.body, { childList:true });
  statusBar();

  /* ---------- kaydırarak sekme geçişi (25.09 · Ozan: "sayfaları sağa sola geçirecek kaydırma") ----------
   * İçerikte yatay kaydırma → alt menüdeki bir sonraki / önceki sekme (orta eylem düğmesi atlanır).
   * Yana kayan alanlarda (tablo, sekme şeridi, çipler, monitör, "Gördüm" sürgüsü) ve pencere açıkken çalışmaz. */
  let sx = null, sy = 0, st0 = 0;
  const NOSWIPE = "table, .tabs, .m-chips, .nfNav, .m-swipe, input, textarea, select, .seg, .modalBg, .mq, .mcrit, .scn, [data-noswipe]";
  const scrollX = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { if (a.scrollWidth > a.clientWidth + 4 && /(auto|scroll)/.test(getComputedStyle(a).overflowX)) return true; } return false; };
  document.addEventListener("touchstart", (e) => { if (!document.body.classList.contains("mob") || e.touches.length !== 1) return;
    const t = e.target; if (!t.closest(".content") || t.closest(NOSWIPE) || scrollX(t)) { sx = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st0 = Date.now();
    const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    if (!standalone && (sx < 28 || sx > innerWidth - 28)) sx = null;   // tarayıcıda kenar kaydırması tarayıcının "geri" hareketi
  }, { passive:true });
  document.addEventListener("touchend", (e) => { if (sx == null) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - st0 > 700) return;
    const back = dx > 0;
    // hasta ekranı: sağdan sola = sonraki sekme, soldan sağa = önceki sekme; ilk sekmede soldan sağa = geri
    if (H.state.page === "patient") {
      const tb = [...document.querySelectorAll(".content .tabs [data-tab]")], on = tb.findIndex(x => x.classList.contains("on"));
      const j2 = on + (back ? -1 : 1);
      if (j2 >= 0 && j2 < tb.length) { tb[j2].click(); tb[j2].scrollIntoView({ inline:"center", block:"nearest" }); const c3 = document.querySelector(".content"); if (c3) { c3.classList.add(back ? "sw-r" : "sw-l"); setTimeout(() => c3.classList.remove("sw-l", "sw-r"), 300); } return; }
      if (back) { if (!H.mBack()) H.go("mpts", {}); return; }
      return;
    }
    // alt menüde olmayan ayrıntı sayfaları: soldan sağa = geri
    const T0 = tabs(); if (!T0.some(x => x[3] === H.state.page) && back) { if (H.mBack()) return; }
    const T = tabs().filter(x => x[0] !== "mid"), cur = activeKey(), i = T.findIndex(x => x[0] === cur);
    const j = i < 0 ? 0 : i + (dx < 0 ? 1 : -1); if (j < 0 || j >= T.length) return;
    const c = document.querySelector(".content"); if (c) c.dataset.swipe = dx < 0 ? "l" : "r";
    H.go(T[j][3], Object.assign({}, T[j][4] || {}));
    const c2 = document.querySelector(".content"); if (c2) { c2.classList.add(dx < 0 ? "sw-l" : "sw-r"); setTimeout(() => c2.classList.remove("sw-l", "sw-r"), 300); } }, { passive:true });

  /* ---------- form seçici (25.09 · Ozan: üstteki form şeridi sağa kayıyor; seçince aşağı doğru açılsın, alt alta seçsin) ----------
   * Telefonda yatay şerit gizli; yerine "şu anki form ▾" düğmesi. Dokununca formlar alt alta açılır, seçince kapanır. */
  function formPicker() {
    if (!MQ.matches) return;
    const nav = document.querySelector(".modal .nfNav"); if (!nav) return;
    let pk = nav.previousElementSibling && nav.previousElementSibling.classList.contains("nf-pick") ? nav.previousElementSibling : null;
    if (!pk) { pk = document.createElement("button"); pk.type = "button"; pk.className = "nf-pick"; nav.parentNode.insertBefore(pk, nav);
      pk.addEventListener("click", () => { nav.classList.toggle("open"); pk.classList.toggle("open", nav.classList.contains("open")); });
      nav.addEventListener("click", (e) => { if (e.target.closest("button")) { nav.classList.remove("open"); pk.classList.remove("open"); } }); }
    const on = nav.querySelector("button.on") || nav.querySelector("button"); if (!on) return;
    const html = on.innerHTML + '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    if (pk.__h !== html) { pk.innerHTML = html; pk.__h = html; }
  }
  new MutationObserver(() => formPicker()).observe(document.body, { childList:true, subtree:true });

  /* =========================================================================================================
   * 25.09 · Ozan'ın seçtiği mobil öneriler (mobil-oneriler.md): 1 ilaç barkodu · 2 kritik alarm tam ekran · 3 arka planda gizle
   * · 4 sesli not · 5 devir imzası PIN ile · 6 kritik sonuç "gördüm" · 7 hekime ulaş · 8 iş hatırlatma · 9 NFC (tarayici.js)
   * · 11 yazı boyu · 12 gece odası. (10 kilit ekranında canlı durum yalnız Expo'da yapılabilir.)
   * ========================================================================================================= */
  const pref = (k, d) => { try { const v = localStorage.getItem("hmc." + k); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem("hmc." + k, v); } catch (e) {} };
  const me = () => H.state.user ? H.state.user.name : "";

  /* --- 3 · arka plana geçince hasta bilgisini gizle (uygulama değiştirici ekranında bulanık) --- */
  const priv = (on) => document.body.classList.toggle("m-priv", !!on && MQ.matches && !!H.state.user);
  document.addEventListener("visibilitychange", () => priv(document.hidden));
  window.addEventListener("pagehide", () => priv(true)); window.addEventListener("blur", () => priv(true));
  window.addEventListener("focus", () => priv(false)); window.addEventListener("pageshow", () => priv(false));

  /* --- 11 · yazı boyu · 12 · gece odası --- */
  function applyLook() { document.body.dataset.mfs = pref("mFs", "1"); document.body.classList.toggle("m-night", pref("mNight", "0") === "1" && MQ.matches); }

  /* --- 2 · kritik alarm tam ekran --- */
  const shownCrit = new Set();
  function critFull(a) {
    if (!a || document.querySelector(".mcrit")) return; shownCrit.add(a.id);
    const p = H.pt(a.pid), bno = p ? (H.bed(p.bed) || {}).no : "";
    const o = document.createElement("div"); o.className = "mcrit"; o.setAttribute("role", "alertdialog");
    o.innerHTML = `<div class="mc-k">${I("alert")}${esc(H.t("cr_title"))}</div><div class="mc-bed mono">${esc(bno)}</div><p>${esc(a.txt)}</p>
      <div class="m-swipe" data-swipe><span class="m-knob">${I("ok")}</span><span class="m-swipe-l">${esc(H.t("m_swipe"))}</span></div>
      <div class="m-acts"><button type="button" class="btn sm" data-copen>${esc(H.t("m_open_pt"))}</button><button type="button" class="btn sm r" data-cesc>${esc(H.t("m_escalate"))}</button></div>`;
    document.body.appendChild(o);
    if (H.sound) { try { H.sound.unlock && H.sound.unlock(); H.sound.test("crit"); } catch (e) {} }
    if (navigator.vibrate) try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
    wireSwipe(o, a);
    const gone = setInterval(() => { if (a.state !== "open" || !o.isConnected) { clearInterval(gone); o.remove(); } }, 300);
    o.querySelector("[data-copen]").onclick = () => { o.remove(); H.go("patient", { pid:a.pid, tab:"ozet" }); };
    o.querySelector("[data-cesc]").onclick = () => { a.step = (a.step || 0) + 1; H.log("alarm eskale edildi (tam ekran)", a.pid); o.remove(); H.toast(H.t("m_esc_ok")); };
  }
  function critCheck() {
    if (!MQ.matches || !H.state.user || !H.can("alarms")) return;
    const a = H.openAlarms().find(x => x.sev === "crit" && !shownCrit.has(x.id)); if (a) critFull(a);
  }
  function critTest() {
    const p = H.myPatients()[0]; if (!p) return;
    const a = { id:Math.max(0, ...H.data.alarms.map(x => x.id)) + 1, pid:p.id, txt:H.t("cr_test_txt"), sev:"crit", ageMin:0, step:0, state:"open" };
    H.data.alarms.push(a); critFull(a);
  }

  /* --- 8 · iş hatırlatma: açılışta saati yaklaşan (30 dk içinde) işler, oturum başına bir kez --- */
  let remDone = false;
  function remind() {
    if (remDone || !MQ.matches || !H.state.user || !H.can("tasks") || pref("mRem", "1") !== "1") return; remDone = true;
    const now = H.nowT();   // 30.09c: nöbet saati (gece yarısından sonra 24+), görev saatleriyle aynı ölçek
    const soon = H.data.tasks.filter(t => H.inScope(t.pid) && t.state !== "done" && t.t >= now && t.t <= now + .5).slice(0, 3);
    if (!soon.length) return;
    setTimeout(() => { H.toast(H.t("rem_t") + ": " + soon.map(t => { const p = H.pt(t.pid); return H.when(Math.floor(t.t) % 24, Math.round(t.t % 1 * 60)) + " " + t.label + (p ? " · " + (H.bed(p.bed) || {}).no : ""); }).join(" · "));
      if (navigator.vibrate) try { navigator.vibrate([120, 80, 120]); } catch (e) {} }, 1200);
  }

  /* --- 4 · sesli not · 7 · hekime ulaş (hasta ekranında) --- */
  /* 27.09 · #196 · hasta başlığı telefonda katlanır. Hep görünen: yatak, ad, risk, skor, alerji/izolasyon, tanı satırı.
   * ▾ ile açılan: yaş/ölçüler, cihaz günleri, konsültasyon, hekim/hemşire, numaralar, kayıt kaynağı. Açık/kapalı hâli
   * aynı hastada sekme değişince korunur, başka hastaya geçince kapanır. Masaüstü değişmez. */
  let ptOpenId = null;
  function ptCompact(c) {
    if (H.state.page !== "patient" || !MQ.matches) return;
    const w = c.querySelector(".pt-wrap"), h = w && w.querySelector(".pt-h"); if (!h || h.querySelector(".m-pth-tg")) return;
    const pid = (H.state.params || {}).pid, md = h.querySelector(".md"), nm = h.querySelector(".nm"), rt = h.querySelector(".rt");
    if (!md || !nm) return;
    if (rt) md.insertBefore(rt, nm.nextSibling);
    const b = document.createElement("button"); b.type = "button"; b.className = "m-pth-tg"; b.innerHTML = I("chevD");
    const sync = () => { const o = ptOpenId === pid; w.classList.toggle("m-open", o); b.setAttribute("aria-expanded", String(o)); b.title = H.t(o ? "pth_less" : "pth_more"); b.setAttribute("aria-label", b.title); };
    b.onclick = (e) => { e.stopPropagation(); ptOpenId = ptOpenId === pid ? null : pid; sync(); };
    nm.appendChild(b); sync();
  }
  /* 27.09 · #193 · yönetimde "telefonda kapalı" seçilen hasta sekmeleri ve formlar telefonda gösterilmez (admin.js H.mobileAllows) */
  const mobOk = (kind, key) => !H.mobileAllows || H.mobileAllows(kind, key);
  function ptModFilter(c) {
    if (H.state.page !== "patient" || !MQ.matches) return;
    const pr = H.state.params || {};
    if (pr.tab && pr.tab !== "ozet" && !mobOk("tab", pr.tab)) { H.go("patient", { pid:pr.pid, tab:"ozet" }); return; }
    c.querySelectorAll(".pt-wrap > .tabs [data-tab]").forEach(s => { if (!mobOk("tab", s.dataset.tab)) s.remove(); });
    c.querySelectorAll("[data-fm] [data-form]").forEach(a => { if (!mobOk("form", a.dataset.form)) a.remove(); });
  }
  new MutationObserver(() => { if (!MQ.matches) return; document.querySelectorAll(".modal [data-nfnav] [data-nfk]").forEach(b => { if (!b.classList.contains("on") && !mobOk("form", b.dataset.nfk)) b.remove(); }); }).observe(document.body, { childList:true, subtree:true });
  function ptActions(c) {
    if (H.state.page !== "patient" || !MQ.matches) return;
    const bar = c.querySelector(".pt-bar"); if (!bar || bar.querySelector(".m-ptacts")) return;
    const d = document.createElement("div"); d.className = "m-ptacts";
    d.innerHTML = `<button type="button" class="btn sm" data-vnote>${I("edit")}${esc(H.t("vn_btn"))}</button>${H.state.user.role !== "hekim" ? `<button type="button" class="btn sm" data-ctdoc>${I("user")}${esc(H.t("ct_btn"))}</button>` : ""}`;
    bar.appendChild(d);
    d.querySelector("[data-vnote]").onclick = () => voiceNote(H.state.params.pid);
    const cd = d.querySelector("[data-ctdoc]"); if (cd) cd.onclick = () => contactDoc(H.state.params.pid);
  }
  function voiceNote(pid) {
    const p = H.pt(pid); if (!p) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition, canMic = !!SR && window.isSecureContext;
    const m = H.modal({ title:H.t("vn_t") + " · " + (H.bed(p.bed) || {}).no, body:`<p class="m-note" style="margin:0 0 8px">${esc(H.t("vn_hint"))}</p><textarea data-vtxt rows="7" style="width:100%;font:500 16px Figtree;padding:12px;border-radius:12px;border:1px solid var(--line2);background:var(--card);color:var(--ink)"></textarea>
      ${canMic ? `<button type="button" class="btn" data-vrec style="margin-top:8px;width:100%;justify-content:center;height:48px">${I("zap")}${esc(H.t("vn_rec"))}</button>` : ""}`,
      actions:`<button class="btn g" data-vx>${esc(H.t("m_close"))}</button><button class="btn p" data-vs>${I("ok")}${esc(H.t("vn_save"))}</button>` });
    const ta = m.querySelector("[data-vtxt]"); let rec = null;
    const rb = m.querySelector("[data-vrec]");
    if (rb) rb.onclick = () => { if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = { AZ:"az-AZ", TR:"tr-TR", RU:"ru-RU", EN:"en-US" }[H.state.lang] || "tr-TR"; rec.interimResults = true; rec.continuous = true;
      const base = ta.value ? ta.value + " " : "";
      rec.onresult = (e) => { let t = ""; for (const r of e.results) t += r[0].transcript; ta.value = base + t; };
      rec.onend = () => { rec = null; rb.innerHTML = I("zap") + esc(H.t("vn_rec")); rb.classList.remove("p"); };
      try { rec.start(); rb.innerHTML = I("x") + esc(H.t("vn_stop")); rb.classList.add("p"); } catch (e) { rec = null; } };
    m.querySelector("[data-vx]").onclick = () => { if (rec) rec.stop(); H.closeModal(); };
    m.querySelector("[data-vs]").onclick = () => { const t = ta.value.trim(); if (!t) return;
      (p.notes = p.notes || []).push({ at:H.now(), by:me(), text:t, voice:canMic }); H.log("hasta notu (telefon)", p.id); if (rec) rec.stop(); H.closeModal(); H.toast(H.t("vn_ok")); };
    setTimeout(() => ta.focus(), 100);
  }
  function contactDoc(pid) {
    const p = H.pt(pid); if (!p) return; const doc = H.userBy(p.attending) || {}, bno = (H.bed(p.bed) || {}).no;
    const ext = doc.ext || ("2" + String(100 + (H.data.users.indexOf(doc) + 1) * 7).slice(-3));
    const msgs = ["ct_m1", "ct_m2", "ct_m3", "ct_m4"];
    const m = H.modal({ title:H.t("ct_btn"), body:`<div class="m-card" style="margin:0 0 12px"><b style="font-size:17px">${esc(doc.name || "—")}</b><small class="mute">${esc(bno)} · ${esc(p.name)}</small>
        <a class="btn p" href="tel:${esc(ext)}" style="height:48px;justify-content:center;margin-top:8px">${I("bell")}${esc(H.t("ct_call"))} · ${esc(H.t("ct_int"))} ${esc(ext)}</a></div>
      <div class="m-h6">${esc(H.t("ct_msgs"))}</div>${msgs.map(k => `<button type="button" class="m-row" data-cmsg="${k}"><span class="tx"><b>${esc(H.t(k))}</b><small>${esc(bno)}</small></span>${I("chevR")}</button>`).join("")}`,
      actions:`<button class="btn g" data-cx>${esc(H.t("m_close"))}</button>` });
    m.querySelector("[data-cx]").onclick = () => H.closeModal();
    m.querySelectorAll("[data-cmsg]").forEach(b => b.onclick = () => {
      H.pushNotif({ at:H.now(), to:["hekim"], sev:b.dataset.cmsg === "ct_m2" ? "high" : "", title:bno + " · " + H.t(b.dataset.cmsg), body:me() + " · " + p.name, go:["patient", { pid:p.id, tab:"ozet" }], pid:p.id });
      H.log("hekime mesaj (telefon)", p.id); H.closeModal(); H.toast(H.t("ct_sent").replace("{n}", doc.name || "")); });
  }

  /* --- 1 · ilaç uygulamada barkod doğrulama: bileklik + ilaç okutulmadan "okutuldu" işaretlenemez --- */
  const nrm = (x) => String(x || "").toLocaleUpperCase("tr").replace(/İ/g, "I").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
  function medScan(modal) {
    const chk = modal.querySelector("[data-m-scan]"); if (!chk || modal.querySelector(".md-scan")) return;
    const kv = [...modal.querySelectorAll(".kv b")].map(b => b.textContent), bno = (kv[0] || "").split(" · ")[0], label = kv[1] || "";
    const pt = H.data.patients.find(x => (H.bed(x.bed) || {}).no === bno); if (!pt) return;
    const S = modal.__md = modal.__md || { pt:null, drug:null };
    const row = chk.closest("label"); row.style.display = "none";
    const box = document.createElement("div"); box.className = "md-scan"; row.after(box);
    const draw = () => {
      const st = (v) => v == null ? "" : v === true ? `<em class="ok">✓ ${esc(H.t("md_ok"))}</em>` : `<em class="bad">✕ ${esc(v)}</em>`;
      box.innerHTML = `<div class="md-r"><span>${esc(H.t("md_pt"))}</span>${st(S.pt)}<button type="button" class="btn sm" data-mdp>${I("qr")}${esc(H.t("md_scan"))}</button></div>
        <div class="md-r"><span>${esc(H.t("md_drug"))}</span>${st(S.drug)}<button type="button" class="btn sm" data-mdd>${I("qr")}${esc(H.t("md_scan"))}</button></div>
        ${S.pt === true && S.drug === true ? `<div class="md-all">✓ ${esc(H.t("md_rights"))}</div>` : ""}`;
      chk.checked = S.pt === true && S.drug === true;
      box.querySelector("[data-mdp]").onclick = () => H.scanner.open((p) => { S.pt = p.id === pt.id ? true : H.t("md_wrongpt").replace("{b}", (H.bed(p.bed) || {}).no); H.log("ilaç · bileklik " + (S.pt === true ? "eşleşti" : "EŞLEŞMEDİ"), pt.id); draw(); });
      box.querySelector("[data-mdd]").onclick = () => H.scanner.open((code) => {
        const c = nrm(code).replace(/^ILAC/, ""), L = nrm(label), ok = c.length >= 4 && (L.includes(c) || L.startsWith(c.slice(0, 6)));
        S.drug = ok ? true : H.t("md_wrongdrug").replace("{c}", code); H.log("ilaç · barkod " + (ok ? "eşleşti" : "EŞLEŞMEDİ"), pt.id); draw(); }, { raw:true, title:H.t("sc_drug"), ph:H.t("md_ph") });
    };
    draw();
  }

  /* --- 5 · devir karşı imzası telefonda PIN ile onaylanır (PIN belirlenmişse) --- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sign], [data-signall]"); if (!b || !MQ.matches || b.__pinOk || !H.state.user || !pinOf(H.state.user)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    pinPad({ mode:"enter", r:{ u:H.state.user.u, name:H.t("pin_confirm") }, onOk:() => { b.__pinOk = true; b.click(); b.__pinOk = false; } });
  }, true);

  /* --- 6 · kritik sonuç / kritik bildirim: "Gördüm" onayı, kim ne zaman --- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ack]"); if (!b) return; e.preventDefault(); e.stopPropagation();
    const n = H.data.notifs.find(x => x.id === +b.dataset.ack); if (!n) return; n.ack = { by:me(), at:H.now() }; n.read = true;
    H.log("kritik bildirim görüldü", n.pid || n.title); H.renderApp();
  }, true);

  /* --- kaydırma v2: hasta ekranında sekmeler arası, ayrıntı sayfalarında geri --- */
  const hist = []; let lastKey = null, goingBack = false;
  // geçmiş sayfa bazında: aynı sayfada sekme değişimi yeni kayıt açmaz (hasta için hasta başına)
  function track() { const pr = H.state.params || {}, k = H.state.page + "|" + JSON.stringify(H.state.page === "patient" ? { pid:pr.pid } : pr.tab ? { tab:pr.tab } : {});
    if (k === lastKey) return; if (lastKey && !goingBack) { const [pg, pr] = [lastKey.split("|")[0], lastKey.slice(lastKey.indexOf("|") + 1)]; hist.push([pg, JSON.parse(pr)]); if (hist.length > 30) hist.shift(); }
    goingBack = false; lastKey = k; }
  H.mBack = () => { const t = hist.pop(); if (!t) return false; goingBack = true; H.go(t[0], t[1]); return true; };

  // tek renderApp kancası: bütün yeni işlevler her çizimden sonra
  H.mAfter = () => { track(); applyLook(); const c = document.querySelector("#root .content"); if (c) { ptModFilter(c); ptActions(c); ptCompact(c); } critCheck(); remind(); };
  new MutationObserver(() => { const m = document.querySelector(".modal"); if (m && MQ.matches) medScan(m); }).observe(document.body, { childList:true, subtree:true });
  H.mCritTest = critTest;

  const re = () => { if (H.state.user) H.renderApp(); };
  MQ.addEventListener ? MQ.addEventListener("change", re) : MQ.addListener(re);
  window.addEventListener("online", re); window.addEventListener("offline", re);
  if (MQ.matches && H.state.user) H.renderApp();
})();
