/* Homunculus prototip v1 — kamera modülü (yoğun bakım yatak kameraları).
 * Sayfa:        'camera' (Kamera duvarı, perm 'camera')
 * Dışa verilen: H.cameraAdmin(body)  → yönetim paneli "Kamera" sekmesi (perm 'admin_camera')
 *               H.cameraTab(el, pid) → hasta ekranına gömülen küçük panel
 * Veri:         H.data.cameras
 *
 * DÜRÜSTLÜK: Bu prototipte hiçbir kamera gerçekten bağlanamaz. Sahte video, sahte hasta görüntüsü,
 * stok fotoğraf YOK. Görüntü alanı her zaman koyu boş bir çerçeve + durum metnidir.
 * "Bağlantıyı sına" ve "Bağlan" her zaman "yanıt yok (prototip — gerçek bağlantı yok)" döner.
 *
 * Konsey eleştirmeninin koşulları (tasarımın omurgası):
 *  a) yazılı hukuki dayanak + kurum politikası   b) yalnız birimin hekimi / sorumlu hemşiresi; her açılış denetim kaydına
 *  c) varsayılan kayıt yok, yalnız canlı         d) mahremiyet perdesi + "şu an izleniyor" göstergesi
 *  e) hasta/aile bilgilendirme, odada levha      f) biyomedikal, kabul, kalite, eczacı görüntüyü hiç görmez
 *  g) görüntü hastane ağından çıkmaz             h) kamera monitör alarmının yerine geçmez */
(function () {
  const H = window.H;
  if (!H) return;
  const esc = H.esc, I = H.icon;
  /* 24.09 (3. oturum) · ekran iskeleti dil sözlüğü. H.data.cameras içindeki kanal/oda/log verisi ve H.log metinleri
   * (denetim kaydı) veri/kayıt niteliğinde — kapsam dışı, careplan/alerts'teki aynı kararla tutarlı. */
  H.addT({
    cam_reason_bedside:{ AZ:"Xəstə başı qiymətləndirmə", TR:"Hasta başı değerlendirme", RU:"Оценка у постели пациента", EN:"Bedside assessment" },
    cam_reason_alarm:{ AZ:"Siqnaldan sonra yoxlama", TR:"Alarm sonrası kontrol", RU:"Проверка после тревоги", EN:"Check after alarm" },
    cam_reason_request:{ AZ:"Həkim tələbi", TR:"Hekim talebi", RU:"По запросу врача", EN:"Physician's request" },
    cam_reason_other:{ AZ:"Digər", TR:"Diğer", RU:"Другое", EN:"Other" },
    cam_kind_nvr:{ AZ:"Şəbəkə video qeydedicisi (NVR)", TR:"Ağ video kaydedici (NVR)", RU:"Сетевой видеорегистратор (NVR)", EN:"Network video recorder (NVR)" },
    cam_kind_vms:{ AZ:"Video idarəetmə proqramı (VMS)", TR:"Video yönetim yazılımı (VMS)", RU:"Программа управления видео (VMS)", EN:"Video management software (VMS)" },
    cam_kind_ip:{ AZ:"Tək-tək IP kamera", TR:"Tek tek IP kamera", RU:"Отдельные IP-камеры", EN:"Individual IP cameras" },
    cam_no_reply:{ AZ:"Cavab yoxdur · ünvanı və şəbəkəni yoxlayın", TR:"Yanıt yok · adresi ve ağı denetleyin", RU:"Нет ответа · проверьте адрес и сеть", EN:"No response · check the address and network" },
    cam_pre_legal_t:{ AZ:"Yazılı hüquqi əsas", TR:"Yazılı hukuki dayanak", RU:"Письменное правовое основание", EN:"Written legal basis" },
    cam_pre_legal_d:{ AZ:"Xəstə otağında kamera ilə izləmə yerli qanunvericiliyə uyğun olaraq xəstəxananın hüquq şöbəsi tərəfindən yazılı şəkildə qiymətləndirilib təsdiqlənib. Sənəd xəstəxanada saxlanılır.",
      TR:"Hasta odasında kamerayla izleme, yerel mevzuata göre hastane hukuk birimince yazılı olarak değerlendirilip onaylandı. Belge hastanede saklanır.",
      RU:"Наблюдение камерой в палате пациента письменно оценено и одобрено юридическим отделом больницы согласно местному законодательству. Документ хранится в больнице.",
      EN:"Camera monitoring in the patient room has been assessed and approved in writing by the hospital's legal department per local law. The document is kept at the hospital." },
    cam_pre_policy_t:{ AZ:"Qurum siyasəti", TR:"Kurum politikası", RU:"Политика учреждения", EN:"Institutional policy" },
    cam_pre_policy_d:{ AZ:"Kimin, hansı məqsədlə, nə qədər müddət izləyə biləcəyini yazan siyasət təsdiqləndi və bölmə heyətinə bildirildi.",
      TR:"Kimin, hangi amaçla, ne kadar süre izleyebileceğini yazan politika onaylandı ve birim personeline duyuruldu.",
      RU:"Утверждена политика, определяющая, кто, с какой целью и как долго может наблюдать, и она доведена до сведения персонала отделения.",
      EN:"A policy stating who may watch, for what purpose, and for how long has been approved and communicated to unit staff." },
    cam_pre_signage_t:{ AZ:"Lövhə və məlumatlandırma", TR:"Levha ve bilgilendirme", RU:"Табличка и информирование", EN:"Signage and notice" },
    cam_pre_signage_d:{ AZ:"Hər otaqda görünən lövhə var; xəstə və ailəsi yazılı məlumatlandırılıb. Şüuru qapalı xəstədə yaxınına məlumat verilir.",
      TR:"Her odada görünür levha var; hasta ve ailesi yazılı bilgilendirildi. Bilinci kapalı hastada yakınına bilgi verilir.",
      RU:"В каждой палате есть видимая табличка; пациент и его семья письменно проинформированы. Если пациент без сознания, информируется его родственник.",
      EN:"A visible sign is posted in every room; the patient and family have been informed in writing. If the patient is unconscious, the relative is informed." },
    cam_pre_audit_t:{ AZ:"Giriş qeydiyyatı", TR:"Erişim kaydı", RU:"Журнал доступа", EN:"Access log" },
    cam_pre_audit_d:{ AZ:"Hər açılış kim · hansı çarpayı · nə qədər · səbəb ilə qeydə yazılır; qeyd dəyişdirilə bilməz.",
      TR:"Her açılış kim · hangi yatak · ne kadar · gerekçe ile kayda yazılır; kayıt değiştirilemez.",
      RU:"Каждое включение записывается: кто · какая койка · как долго · причина; запись нельзя изменить.",
      EN:"Every session is logged: who · which bed · how long · reason; the log cannot be altered." },
    cam_pre_norecord_t:{ AZ:"Qeyd yoxdur, yalnız canlı", TR:"Kayıt yok, yalnız canlı", RU:"Записи нет, только прямой эфир", EN:"No recording, live only" },
    cam_pre_norecord_d:{ AZ:"Görüntü saxlanılmır. Qeydi açmaq ayrı qurum qərarıdır; bu ekrandan açılmır.",
      TR:"Görüntü saklanmaz. Kaydı açmak ayrı bir kurum kararıdır; bu ekrandan açılmaz.",
      RU:"Видео не сохраняется. Включение записи — отдельное решение учреждения; отсюда не включается.",
      EN:"Footage is not stored. Enabling recording is a separate institutional decision; it cannot be turned on from this screen." },
    cam_pre_privacy_t:{ AZ:"Məxfilik pərdəsi", TR:"Mahremiyet perdesi", RU:"Экран приватности", EN:"Privacy curtain" },
    cam_pre_privacy_d:{ AZ:"Qulluq, tualet, geyinmə zamanı tibb bacısı ya da həkim görüntünü bağlayır; ekranda \"izlənilir\" göstəricisi var.",
      TR:"Bakım, tuvalet, giyinme sırasında hemşire ya da hekim görüntüyü kapatır; ekranda \"izleniyor\" göstergesi vardır.",
      RU:"Во время ухода, туалета, переодевания медсестра или врач закрывают изображение; на экране есть индикатор «идёт наблюдение».",
      EN:"During care, toileting, or dressing, the nurse or physician turns off the image; the screen shows a \"being watched\" indicator." },
    cam_pre_onprem_t:{ AZ:"Görüntü xəstəxana şəbəkəsində qalır", TR:"Görüntü hastane ağında kalır", RU:"Изображение остаётся в сети больницы", EN:"Video stays on the hospital network" },
    cam_pre_onprem_d:{ AZ:"Axın xəstəxanadan kənara, buluda ya da istehsalçıya çıxmır.", TR:"Akış hastane dışına, buluta ya da üreticiye çıkmaz.", RU:"Поток не выходит за пределы больницы, в облако или к производителю.", EN:"The stream never leaves the hospital, the cloud, or the manufacturer." },
    cam_fixed_tag:{ AZ:"məhsul tələbi", TR:"ürün gereği", RU:"требование системы", EN:"by design" },
    cam_marked_by:{ AZ:"İşarələyən:", TR:"İşaretleyen:", RU:"Отметил(а):", EN:"Marked by:" },
    cam_pre_footnote:{ AZ:"İlk üç bənd qurumun qərarıdır; sənəd xəstəxanada saxlanılır, işarələyən şəxs və saat qeydə yazılır.",
      TR:"İlk üç madde kurumun kararıdır; belge hastanede saklanır, işaretleyen kişi ve saat kayda yazılır.",
      RU:"Первые три пункта — решение учреждения; документ хранится в больнице, отмечающий и время записываются.",
      EN:"The first three items are the institution's decision; the document is kept at the hospital, and the person and time of marking are logged." },
    cam_warn:{ AZ:"Bu izləmə aləti deyil; siqnalların yerini tutmur. Xəstənin vəziyyəti üçün monitora və siqnal sisteminə baxmağa davam edin.",
      TR:"Bu bir izleme aracı değildir; alarmların yerini tutmaz. Hastanın durumu için monitöre ve alarm sistemine bakmaya devam edin.",
      RU:"Это не средство мониторинга; оно не заменяет тревоги. Для оценки состояния пациента продолжайте следить за монитором и системой тревог.",
      EN:"This is not a monitoring tool; it does not replace alarms. Keep checking the monitor and the alarm system for the patient's condition." },
    cam_warn_short:{ AZ:"Bu izləmə aləti deyil; siqnalların yerini tutmur. Qeyd yoxdur, yalnız canlı; hər açılış qeydiyyata yazılır.",
      TR:"Bu bir izleme aracı değildir; alarmların yerini tutmaz. Kayıt yok, yalnız canlı; her açılış denetim kaydına yazılır.",
      RU:"Это не средство мониторинга; оно не заменяет тревоги. Записи нет, только прямой эфир; каждое включение фиксируется в журнале.",
      EN:"This is not a monitoring tool; it does not replace alarms. No recording, live only; every session is logged." },
    cam_chip_norecord:{ AZ:"Qeyd yoxdur · yalnız canlı", TR:"Kayıt yok · yalnız canlı", RU:"Записи нет · только прямой эфир", EN:"No recording · live only" },
    cam_chip_audit:{ AZ:"Hər açılış qeydiyyata yazılır", TR:"Her açılış denetim kaydına yazılır", RU:"Каждое включение фиксируется в журнале", EN:"Every session is logged" },
    cam_chip_reason:{ AZ:"Səbəb məcburidir", TR:"Gerekçe zorunlu", RU:"Причина обязательна", EN:"Reason required" },
    cam_chip_minutes_tpl:{ AZ:"{n} dəqiqədə bir soruşur", TR:"{n} dk'da bir sorar", RU:"спрашивает каждые {n} мин", EN:"asks every {n} min" },
    cam_st_curtain_main:{ AZ:"Məxfilik pərdəsi açıqdır", TR:"Mahremiyet perdesi açık", RU:"Экран приватности открыт", EN:"Privacy curtain is on" },
    cam_st_curtain_frame:{ AZ:"Məxfilik pərdəsi açıqdır — görüntü bağlıdır", TR:"Mahremiyet perdesi açık — görüntü kapalı", RU:"Экран приватности открыт — изображение отключено", EN:"Privacy curtain is on — image is off" },
    cam_st_off_main:{ AZ:"Kamera sistemi qoşulmayıb", TR:"Kamera sistemi bağlı değil", RU:"Система камер не подключена", EN:"Camera system not connected" },
    cam_st_off_sub_assigned_tpl:{ AZ:"{ch} təyin olunub · bağlantı yoxdur", TR:"{ch} atandı · bağlantı yok", RU:"{ch} назначен · нет подключения", EN:"{ch} assigned · no connection" },
    cam_st_no_camera:{ AZ:"Bu çarpayıya kamera təyin olunmayıb", TR:"Bu yatağa kamera atanmadı", RU:"Камера этой койке не назначена", EN:"No camera assigned to this bed" },
    cam_st_off_frame:{ AZ:"Görüntü yoxdur — kamera sistemi qoşulmayıb", TR:"Görüntü yok — kamera sistemi bağlı değil", RU:"Нет изображения — система камер не подключена", EN:"No image — camera system not connected" },
    cam_st_nomap_sub:{ AZ:"Kanal idarəetmə panelindən təyin olunur", TR:"Yönetim panelinden kanal atanır", RU:"Канал назначается в панели управления", EN:"The channel is assigned from the admin panel" },
    cam_st_nomap_frame:{ AZ:"Görüntü yoxdur — bu çarpayıya kamera təyin olunmayıb", TR:"Görüntü yok — bu yatağa kamera atanmadı", RU:"Нет изображения — камера этой койке не назначена", EN:"No image — no camera assigned to this bed" },
    cam_st_ready_sub:{ AZ:"Canlı · qeyd yoxdur", TR:"Canlı · kayıt yok", RU:"Прямой эфир · без записи", EN:"Live · no recording" },
    cam_st_ready_frame:{ AZ:"Görüntü gözlənilir…", TR:"Görüntü bekleniyor…", RU:"Ожидание изображения…", EN:"Waiting for image…" },
    cam_watching_tpl:{ AZ:"Hazırda izlənilir · {name}", TR:"Şu an izleniyor · {name}", RU:"Сейчас наблюдается · {name}", EN:"Being watched now · {name}" },
    cam_channel_word:{ AZ:"Kanal", TR:"Kanal", RU:"Канал", EN:"Channel" },
    cam_curtain_denied:{ AZ:"Pərdəni yalnız bu bölmənin tibb bacısı ya da həkimi aça-bağlaya bilər.", TR:"Perdeyi yalnız bu birimin hemşiresi ya da hekimi açıp kapatabilir.", RU:"Экран может открыть или закрыть только медсестра или врач этого отделения.", EN:"Only this unit's nurse or physician can open or close the curtain." },
    cam_curtain_on_tpl:{ AZ:"{bed} · məxfilik pərdəsi açıqdır, görüntü bağlıdır", TR:"{bed} · mahremiyet perdesi açık, görüntü kapalı", RU:"{bed} · экран приватности открыт, изображение отключено", EN:"{bed} · privacy curtain on, image off" },
    cam_curtain_off_tpl:{ AZ:"{bed} · məxfilik pərdəsi bağlandı", TR:"{bed} · mahremiyet perdesi kapandı", RU:"{bed} · экран приватности закрыт", EN:"{bed} · privacy curtain closed" },
    cam_view_denied:{ AZ:"Kamera görüntüsü yalnız bu bölmənin həkiminə və məsul tibb bacısına açıqdır.", TR:"Kamera görüntüsü yalnız bu birimin hekimine ve sorumlu hemşiresine açıktır.", RU:"Изображение с камеры доступно только врачу и старшей медсестре этого отделения.", EN:"Camera footage is only accessible to this unit's physician and charge nurse." },
    cam_curtain_block_note:{ AZ:"Pərdə qulluq ya da məxfilik tələb edən bir proses zamanı açılır. Pərdə bağlanmadan izləmə seansı başladıla bilməz.",
      TR:"Perde, bakım ya da mahremiyet gerektiren bir işlem sırasında açılır. Perde kapanmadan izleme oturumu başlatılamaz.",
      RU:"Экран открывается во время процедур ухода или требующих приватности. Пока экран не закрыт, сеанс наблюдения нельзя начать.",
      EN:"The curtain is opened during care or a procedure requiring privacy. A watching session cannot start until the curtain is closed." },
    cam_btn_close_curtain:{ AZ:"Pərdəni bağla", TR:"Perdeyi kapat", RU:"Закрыть экран", EN:"Close curtain" },
    cam_reason_section:{ AZ:"İzləmə səbəbi", TR:"İzleme gerekçesi", RU:"Причина наблюдения", EN:"Reason for watching" },
    cam_reason_required_sub:{ AZ:"Məcburidir · qeydiyyata yazılır", TR:"Zorunlu · denetim kaydına yazılır", RU:"Обязательно · записывается в журнал", EN:"Required · logged" },
    cam_note_label:{ AZ:"Qeyd", TR:"Not", RU:"Заметка", EN:"Note" },
    cam_note_required_other:{ AZ:"* “Digər” üçün məcburidir", TR:"* “Diğer” için zorunlu", RU:"* обязательно для «Другое»", EN:"* required for “Other”" },
    cam_note_ph:{ AZ:"Qısa izah (istəyə bağlı)", TR:"Kısa açıklama (isteğe bağlı)", RU:"Краткое описание (необязательно)", EN:"Short note (optional)" },
    cam_open_note:{ AZ:"Qeyd yoxdur, yalnız canlı. Açılış qeydi: <b>kim · hansı çarpayı · nə qədər · səbəb</b>. Xəstə və ailəsi otaqdakı lövhə ilə məlumatlandırılıb.",
      TR:"Kayıt yok, yalnız canlı. Açılış kaydı: <b>kim · hangi yatak · ne kadar · gerekçe</b>. Hasta ve ailesi odadaki levhayla bilgilendirilmiştir.",
      RU:"Записи нет, только прямой эфир. Запись о включении: <b>кто · какая койка · как долго · причина</b>. Пациент и семья проинформированы табличкой в палате.",
      EN:"No recording, live only. Session log: <b>who · which bed · how long · reason</b>. The patient and family have been informed via the sign in the room." },
    cam_btn_start_watch:{ AZ:"İzləməyə başla", TR:"İzlemeyi başlat", RU:"Начать наблюдение", EN:"Start watching" },
    cam_session_open:{ AZ:"İzləmə seansı açıqdır ·", TR:"İzleme oturumu açık ·", RU:"Сеанс наблюдения открыт ·", EN:"Watching session open ·" },
    cam_norecord_badge:{ AZ:"QEYD YOXDUR", TR:"KAYIT YOK", RU:"БЕЗ ЗАПИСИ", EN:"NO RECORDING" },
    cam_ask_tpl:{ AZ:"Seans {n} dəqiqəni keçdi. İzləməyə davam edirsiniz? Cavab gəlməsə 60 saniyə içində bağlanacaq.",
      TR:"Oturum {n} dakikayı geçti. İzlemeye devam ediyor musunuz? Yanıt gelmezse 60 sn içinde kapanır.",
      RU:"Сеанс превысил {n} минут. Продолжить наблюдение? Если ответа не будет, закроется через 60 секунд.",
      EN:"The session has passed {n} minutes. Continue watching? It will close in 60 seconds if there's no response." },
    cam_btn_continue:{ AZ:"Davam et", TR:"Devam et", RU:"Продолжить", EN:"Continue" },
    cam_started_tpl:{ AZ:"Başladı {at}", TR:"Başladı {at}", RU:"Начало {at}", EN:"Started {at}" },
    cam_toast_autoclose_tpl:{ AZ:"{bed} · izləmə seansı özü bağlandı", TR:"{bed} · izleme oturumu kendiliğinden kapandı", RU:"{bed} · сеанс наблюдения закрылся автоматически", EN:"{bed} · the watching session closed automatically" },
    cam_no_sessions:{ AZ:"Hələ izləmə seansınız yoxdur.", TR:"Henüz izleme oturumunuz yok.", RU:"У вас пока нет сеансов наблюдения.", EN:"You have no watching sessions yet." },
    cam_sec_short:{ AZ:"san", TR:"sn", RU:"сек", EN:"sec" },
    cam_min_short:{ AZ:"dəq", TR:"dk", RU:"мин", EN:"min" },
    cam_page_sub:{ AZ:"Bölmələrinizdəki intensiv baxım çarpayıları · yalnız canlı, qeyd yoxdur", TR:"Birimlerinizdeki yoğun bakım yatakları · yalnız canlı, kayıt yok", RU:"Койки интенсивной терапии в ваших отделениях · только прямой эфир, без записи", EN:"ICU beds in your units · live only, no recording" },
    cam_sys_on:{ AZ:"Kamera sistemi qoşuludur", TR:"Kamera sistemi bağlı", RU:"Система камер подключена", EN:"Camera system connected" },
    cam_sys_off_sub:{ AZ:"Xəstəxananın ilkin şərtləri tamamlanıb cihaz komandası ilə bağlantı qurulana qədər görüntü yoxdur. Qutulara toxunaraq izləmə axınını sınaya bilərsiniz.",
      TR:"Hastanenin ön koşulları tamamlanıp cihaz ekibiyle bağlantı kurulana kadar görüntü yoktur. Kutulara tıklayarak izleme akışını deneyebilirsiniz.",
      RU:"Изображения не будет, пока не выполнены предварительные условия больницы и не установлена связь с командой оборудования. Нажимая на плитки, можно опробовать поток наблюдения.",
      EN:"There is no image until the hospital's preconditions are complete and the connection with the device team is made. You can try the watching flow by clicking the tiles." },
    cam_bed_full:{ AZ:"Dolu çarpayı", TR:"Dolu yatak", RU:"Занятая койка", EN:"Occupied bed" },
    cam_bed_empty:{ AZ:"Boş çarpayı", TR:"Boş yatak", RU:"Свободная койка", EN:"Empty bed" },
    cam_room_word:{ AZ:"Otaq", TR:"Oda", RU:"Палата", EN:"Room" },
    cam_no_watch_needed:{ AZ:"İzləmə tələb olunmur", TR:"İzleme gerekmez", RU:"Наблюдение не требуется", EN:"No watching needed" },
    cam_no_icu_units:{ AZ:"Bölmələrinizdə intensiv baxım çarpayısı yoxdur. Kamera izləmə yalnız intensiv baxım bölmələrində təyin olunub.",
      TR:"Birimlerinizde yoğun bakım yatağı yok. Kamera izleme yalnız yoğun bakım birimlerinde tanımlıdır.",
      RU:"В ваших отделениях нет коек интенсивной терапии. Видеонаблюдение определено только в отделениях интенсивной терапии.",
      EN:"There are no ICU beds in your units. Camera monitoring is defined only for intensive care units." },
    cam_bed_word:{ AZ:"çarpayı", TR:"yatak", RU:"коек", EN:"beds" },
    cam_my_sessions:{ AZ:"Son izləmə seanslarım", TR:"Son izleme oturumlarım", RU:"Мои последние сеансы наблюдения", EN:"My recent watching sessions" },
    cam_log_immutable:{ AZ:"Qeyd dəyişdirilə bilməz", TR:"Kayıt değiştirilemez", RU:"Запись нельзя изменить", EN:"Records cannot be changed" },
    cam_patient_notfound:{ AZ:"Xəstə tapılmadı.", TR:"Hasta bulunamadı.", RU:"Пациент не найден.", EN:"Patient not found." },
    cam_not_icu_tpl:{ AZ:"Kamera izləmə yalnız intensiv baxım bölmələrində təyin olunub. {unit} bölməsində kamera yoxdur.",
      TR:"Kamera izleme yalnız yoğun bakım birimlerinde tanımlıdır. {unit} biriminde kamera yoktur.",
      RU:"Видеонаблюдение определено только в отделениях интенсивной терапии. В отделении {unit} камер нет.",
      EN:"Camera monitoring is defined only for intensive care units. There is no camera in the {unit} unit." },
    cam_no_access:{ AZ:"Kamera görüntüsü yalnız bu bölmənin həkiminə və məsul tibb bacısına açıqdır. Rolünüz bu görüntüyə çata bilməz.",
      TR:"Kamera görüntüsü yalnız bu birimin hekimine ve sorumlu hemşiresine açıktır. Rolünüz bu görüntüye erişemez.",
      RU:"Изображение с камеры доступно только врачу и старшей медсестре этого отделения. Ваша роль не имеет доступа к этому изображению.",
      EN:"Camera footage is only accessible to this unit's physician and charge nurse. Your role cannot access this footage." },
    cam_singular:{ AZ:"Kamera", TR:"Kamera", RU:"Камера", EN:"Camera" },
    cam_curtain_open_tag:{ AZ:"pərdə açıq", TR:"perde açık", RU:"экран открыт", EN:"curtain open" },
    cam_curtain_disabled_title:{ AZ:"Pərdə açıq olduqda izləmə başladıla bilməz", TR:"Perde açıkken izleme başlatılamaz", RU:"Пока экран открыт, наблюдение начать нельзя", EN:"Watching can't start while the curtain is open" },
    cam_only_role_access:{ AZ:"İzləmə yalnız həkim və məsul tibb bacısına açıqdır", TR:"İzleme yalnız hekim ve sorumlu hemşireye açık", RU:"Наблюдение доступно только врачу и старшей медсестре", EN:"Watching is only available to the physician and charge nurse" },
    cam_bed_sessions:{ AZ:"Bu çarpayıdakı son seanslarım", TR:"Bu yataktaki son oturumlarım", RU:"Мои последние сеансы на этой койке", EN:"My recent sessions on this bed" },
    cam_adm_missing_tpl:{ AZ:"İlkin şərtlərdən {n} dənəsi gözlənilir.", TR:"Ön koşullardan {n} tanesi bekliyor.", RU:"Ожидается выполнение {n} предварительных условий.", EN:"{n} preconditions still pending." },
    cam_adm_ready:{ AZ:"İlkin şərtlər tamamdır; bağlantı cihaz komandası ilə qurulur.", TR:"Ön koşullar tamam; bağlantı cihaz ekibiyle kurulur.", RU:"Предварительные условия выполнены; подключение устанавливает команда оборудования.", EN:"Preconditions are complete; the connection is set up with the device team." },
    cam_adm_you_too:{ AZ:" Bu ekranı idarə edən siz də görüntünü görə bilməzsiniz.", TR:" Bu ekranı yöneten siz de görüntüyü göremezsiniz.", RU:" Вы, управляющий этим экраном, тоже не видите изображение.", EN:" You, who manage this screen, cannot see the image either." },
    cam_box_preconditions:{ AZ:"İlkin şərtlər", TR:"Ön koşullar", RU:"Предварительные условия", EN:"Preconditions" },
    cam_inst_condition:{ AZ:"qurum şərti", TR:"kurum koşulu", RU:"условие учреждения", EN:"institutional condition" },
    cam_box_connection:{ AZ:"Bağlantı", TR:"Bağlantı", RU:"Подключение", EN:"Connection" },
    cam_tag_notconnected:{ AZ:"qoşulmayıb", TR:"bağlı değil", RU:"не подключено", EN:"not connected" },
    cam_fld_systype:{ AZ:"Sistem növü", TR:"Sistem türü", RU:"Тип системы", EN:"System type" },
    cam_fld_address:{ AZ:"Ünvan", TR:"Adres", RU:"Адрес", EN:"Address" },
    cam_fld_username:{ AZ:"İstifadəçi adı", TR:"Kullanıcı adı", RU:"Имя пользователя", EN:"Username" },
    cam_ph_from_devteam:{ AZ:"cihaz komandasından", TR:"cihaz ekibinden", RU:"от команды оборудования", EN:"from the device team" },
    cam_fld_password:{ AZ:"Şifrə", TR:"Şifre", RU:"Пароль", EN:"Password" },
    cam_pw_saved:{ AZ:"•••••• qeydə alınıb · göstərilmir", TR:"•••••• kayıtlı · gösterilmez", RU:"•••••• сохранён · не отображается", EN:"•••••• saved · not shown" },
    cam_pw_empty:{ AZ:"daxil edilməyib", TR:"girilmedi", RU:"не введён", EN:"not entered" },
    cam_tag_saved:{ AZ:"qeydə alınıb", TR:"kayıtlı", RU:"сохранён", EN:"saved" },
    cam_fld_protocol:{ AZ:"Protokol", TR:"Protokol", RU:"Протокол", EN:"Protocol" },
    cam_btn_test:{ AZ:"Bağlantını sına", TR:"Bağlantıyı sına", RU:"Проверить подключение", EN:"Test connection" },
    cam_btn_connect:{ AZ:"Qoşul", TR:"Bağlan", RU:"Подключиться", EN:"Connect" },
    cam_why_missing_tpl:{ AZ:"Qoşul qeyri-aktivdir: {list} işarələnməyib.", TR:"Bağlan pasif: {list} işaretlenmedi.", RU:"«Подключиться» неактивно: не отмечено: {list}.", EN:"Connect is disabled: {list} not checked." },
    cam_why_nourl:{ AZ:"Qoşul qeyri-aktivdir: kamera sistemi ünvanı daxil edilməyib.", TR:"Bağlan pasif: kamera sistemi adresi girilmedi.", RU:"«Подключиться» неактивно: не введён адрес системы камер.", EN:"Connect is disabled: no camera system address entered." },
    cam_addr_warn:{ AZ:"Ünvan xəstəxananın daxili şəbəkəsində görünmür. Görüntü xəstəxana şəbəkəsindən çıxmamalıdır; ünvanı cihaz komandası ilə yoxlayın.",
      TR:"Adres hastane iç ağında görünmüyor. Görüntü hastane ağından çıkmamalıdır; adresi cihaz ekibiyle doğrulayın.",
      RU:"Адрес не выглядит как адрес внутренней сети больницы. Изображение не должно выходить за пределы сети больницы; проверьте адрес с командой оборудования.",
      EN:"The address doesn't look like it's on the hospital's internal network. Video must not leave the hospital network; verify the address with the device team." },
    cam_test_what_test:{ AZ:"Bağlantı sınağı", TR:"Bağlantı sınaması", RU:"Проверка подключения", EN:"Connection test" },
    cam_test_what_connect:{ AZ:"Qoşulma cəhdi", TR:"Bağlanma denemesi", RU:"Попытка подключения", EN:"Connection attempt" },
    cam_test_result_note:{ AZ:"Kamera sistemi hələ qoşulmayıb. Qoşulanda sorğu xəstəxana şəbəkəsindəki kamera sisteminə gedir; cavab, axın formatı və kanal siyahısı burada görünür.",
      TR:"Kamera sistemi henüz bağlanmadı. Bağlandığında istek hastane ağındaki kamera sistemine gider; yanıt, akış biçimi ve kanal listesi burada görünür.",
      RU:"Система камер ещё не подключена. После подключения запрос идёт к системе камер в сети больницы; здесь будут видны ответ, формат потока и список каналов.",
      EN:"The camera system is not connected yet. Once connected, the request goes to the camera system on the hospital network; the response, stream format and channel list appear here." },
    cam_field_note:{ AZ:"Bu sahələr xəstəxana şəbəkəsindəki cihaz komandası ilə birlikdə doldurulur. Şifrə heç bir ekranda göstərilmir və qeydiyyata yazılmır.",
      TR:"Bu alanlar hastane ağındaki cihaz ekibiyle birlikte doldurulur. Şifre hiçbir ekranda gösterilmez ve denetim kaydına yazılmaz.",
      RU:"Эти поля заполняются совместно с командой оборудования в сети больницы. Пароль нигде не отображается и не записывается в журнал.",
      EN:"These fields are filled in together with the device team on the hospital network. The password is never shown on screen and is never logged." },
    cam_sec_mapping:{ AZ:"Çarpayı uyğunlaşdırması", TR:"Yatak eşleştirme", RU:"Сопоставление коек", EN:"Bed mapping" },
    cam_mapping_sub_tpl:{ AZ:"Yalnız intensiv baxım bölmələri · {n} çarpayı", TR:"Yalnız yoğun bakım birimleri · {n} yatak", RU:"Только отделения интенсивной терапии · {n} коек", EN:"ICU units only · {n} beds" },
    cam_notconnected_note:{ AZ:"Sistem qoşulu deyil: kanal seçimi qeydə alınır, amma görüntü gəlmir. Kanal siyahısı nümunədir; real siyahı bağlantıdan sonra sistemdən oxunur.",
      TR:"Sistem bağlı değil: kanal seçimi kaydedilir ama görüntü gelmez. Kanal listesi örnektir; gerçek liste bağlantıdan sonra sistemden okunur.",
      RU:"Система не подключена: выбор канала сохраняется, но изображения не будет. Список каналов примерный; реальный список считывается из системы после подключения.",
      EN:"System not connected: the channel choice is saved but no image arrives. The channel list is an example; the real list is read from the system after connecting." },
    cam_opt_unassigned:{ AZ:"— təyin olunmayıb —", TR:"— atanmadı —", RU:"— не назначено —", EN:"— not assigned —" },
    cam_tag_noconn:{ AZ:"bağlantı yoxdur", TR:"bağlantı yok", RU:"нет подключения", EN:"no connection" },
    cam_tag_dup_tpl:{ AZ:"{ch} birdən çox çarpayıda", TR:"{ch} birden çok yatakta", RU:"{ch} на нескольких койках", EN:"{ch} used on multiple beds" },
    cam_box_kimGorebilir:{ AZ:"Kim görə bilər", TR:"Kim görebilir", RU:"Кто может видеть", EN:"Who can view" },
    cam_can_open:{ AZ:"Görüntünü aça bilər", TR:"Görüntüyü açabilir", RU:"Может открыть изображение", EN:"Can open the video" },
    cam_own_unit_suffix:{ AZ:"(öz bölməsi)", TR:"(kendi birimi)", RU:"(в своём отделении)", EN:"(own unit)" },
    cam_curtain_toggle:{ AZ:"Məxfilik pərdəsini aça-bağlaya bilər", TR:"Mahremiyet perdesini açıp kapatabilir", RU:"Может открывать и закрывать экран приватности", EN:"Can open and close the privacy curtain" },
    cam_curtain_open_short:{ AZ:"Məxfilik pərdəsini aç", TR:"Mahremiyet perdesi aç", RU:"Открыть экран приватности", EN:"Open privacy curtain" },
    cam_curtain_close_short:{ AZ:"Məxfilik pərdəsini bağla", TR:"Mahremiyet perdesini kapat", RU:"Закрыть экран приватности", EN:"Close privacy curtain" },
    cam_role_hekim:{ AZ:"Həkim", TR:"Hekim", RU:"Врач", EN:"Physician" },
    cam_role_hemsire:{ AZ:"Tibb bacısı", TR:"Hemşire", RU:"Медсестра", EN:"Nurse" },
    cam_never_see:{ AZ:"Görüntünü heç görə bilməz", TR:"Görüntüyü hiç göremez", RU:"Никогда не видит изображение", EN:"Can never see the video" },
    cam_role_extra_tpl:{ AZ:"{role} (məsul işarəsi yoxdursa)", TR:"{role} (sorumlu işareti yoksa)", RU:"{role} (если нет отметки старшего)", EN:"{role} (unless marked charge)" },
    cam_violation_tpl:{ AZ:"Qayda pozuntusu: {roles} rolunda kamera icazəsi var. Bu rollar görüntünü görməməlidir — Rollar və icazələr sekmesindən silin.",
      TR:"Kural ihlali: {roles} rolünde kamera yetkisi var. Bu roller görüntüyü görmemelidir — Roller ve yetkiler sekmesinden kaldırın.",
      RU:"Нарушение правила: у роли {roles} есть право на камеру. Эти роли не должны видеть изображение — удалите его на вкладке «Роли и права».",
      EN:"Rule violation: the role {roles} has camera access. These roles must never see the video — remove it in the Roles & permissions tab." },
    cam_who_footnote:{ AZ:"Siyahı Rollar və icazələr sekmesindən oxunur; oradakı \"camera\" icazəsi dəyişsə burası da dəyişir.",
      TR:"Liste Roller ve yetkiler sekmesinden okunur; oradaki \"camera\" yetkisi değişirse burası da değişir.",
      RU:"Список считывается со вкладки «Роли и права»; если там изменится право «camera», изменится и здесь.",
      EN:"The list is read from the Roles & permissions tab; if the \"camera\" permission changes there, it changes here too." },
    cam_sec_recent_logs:{ AZ:"Son kamera qeydləri", TR:"Son kamera kayıtları", RU:"Последние записи камер", EN:"Recent camera log entries" },
    cam_recent_logs_sub:{ AZ:"Qeydiyyat jurnalından · tamamı Qeydiyyat jurnalı sekmesindədir", TR:"Denetim kaydından · tamamı Denetim kaydı sekmesinde", RU:"Из журнала аудита · весь список на вкладке «Журнал аудита»", EN:"From the audit log · full list in the Audit log tab" },
    cam_no_logs:{ AZ:"Hələ kamera qeydi yoxdur.", TR:"Henüz kamera kaydı yok.", RU:"Записей камер пока нет.", EN:"No camera log entries yet." },
    cam_rules_h:{ AZ:"Qaydalar", TR:"Kurallar", RU:"Правила", EN:"Rules" },
    cam_rule_record_t:{ AZ:"Qeyd", TR:"Kayıt", RU:"Запись", EN:"Recording" },
    cam_rule_record_d:{ AZ:"Görüntü saxlanılmır. Qeydi açmaq ayrı qurum qərarıdır; bu ekrandan dəyişdirilmir.", TR:"Görüntü saklanmaz. Kaydı açmak ayrı bir kurum kararıdır; bu ekrandan değiştirilmez.", RU:"Видео не сохраняется. Включение записи — отдельное решение учреждения; отсюда не меняется.", EN:"Footage is not stored. Enabling recording is a separate institutional decision; it cannot be changed from this screen." },
    cam_rule_record_tag:{ AZ:"Bağlı · yalnız oxuna bilər", TR:"Kapalı · salt okunur", RU:"Выключено · только чтение", EN:"Off · read-only" },
    cam_rule_session_t:{ AZ:"Seans limiti", TR:"Oturum sınırı", RU:"Ограничение сеанса", EN:"Session limit" },
    cam_rule_session_d:{ AZ:"Müddət bitəndə \"davam edirsiniz?\" deyə soruşur; 60 saniyə cavab gəlməsə seans bağlanır.", TR:"Süre dolunca \"devam ediyor musunuz?\" diye sorar; 60 sn yanıt yoksa oturum kapanır.", RU:"По истечении времени спрашивает «Продолжить?»; если ответа нет 60 секунд, сеанс закрывается.", EN:"When time is up it asks \"Still watching?\"; if there's no response in 60 seconds, the session closes." },
    cam_rule_reason_t:{ AZ:"Səbəb", TR:"Gerekçe", RU:"Причина", EN:"Reason" },
    cam_rule_reason_d:{ AZ:"Hər açılışda seçilir; \"Digər\" seçilsə qeyd məcburidir.", TR:"Her açılışta seçilir; \"Diğer\" seçilirse not zorunludur.", RU:"Выбирается при каждом включении; если выбрано «Другое», заметка обязательна.", EN:"Chosen at every session; if \"Other\" is selected, a note is required." },
    cam_rule_reason_tag:{ AZ:"Məcburi · yalnız oxuna bilər", TR:"Zorunlu · salt okunur", RU:"Обязательно · только чтение", EN:"Required · read-only" },
    cam_rule_access_t:{ AZ:"Giriş qeydiyyatı", TR:"Erişim kaydı", RU:"Журнал доступа", EN:"Access log" },
    cam_rule_access_d:{ AZ:"Kim · hansı çarpayı · nə qədər · səbəb. Silinə və düzəldilə bilməz.", TR:"Kim · hangi yatak · ne kadar · gerekçe. Silinemez, düzeltilemez.", RU:"Кто · какая койка · как долго · причина. Нельзя удалить или изменить.", EN:"Who · which bed · how long · reason. Cannot be deleted or edited." },
    cam_rule_access_tag:{ AZ:"Dəyişdirilə bilməz", TR:"Değiştirilemez", RU:"Нельзя изменить", EN:"Cannot be changed" },
    cam_aria_channel:{ AZ:"kamera kanalı", TR:"kamera kanalı", RU:"канал камеры", EN:"camera channel" },
  });
  const camTpl = (key, vals) => Object.entries(vals || {}).reduce((s, [k, v]) => s.split("{" + k + "}").join(v), H.t(key));
  const locTag = () => ({ AZ:"az", TR:"tr", RU:"ru", EN:"en" }[H.state.lang] || "tr");

  /* ================= stil (yalnız bu modül, önek cm-) ================= */
  const css = `
.cm-strip{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:12px;font-size:13px;min-width:0}
.cm-strip b{font-weight:700}
.cm-strip .cm-sub{flex:1 1 220px;min-width:0}
.cm-dot{width:9px;height:9px;border-radius:50%;background:var(--c,var(--mute));box-shadow:0 0 0 3px color-mix(in srgb,var(--c,var(--mute)) 25%,transparent);flex:none;display:inline-block}
.cm-warn{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;line-height:1.4}
.cm-warn svg{width:16px!important;height:16px!important;margin-top:1px}
.cm-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}
.cm-sub{font-size:12px;color:var(--mute)}
.cm-wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.cm-tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px;cursor:pointer;min-width:0;display:flex;flex-direction:column;gap:8px;transition:border-color .15s,transform .15s}
.cm-tile:hover{border-color:var(--pri);transform:translateY(-1px)}
.cm-tile:focus-visible{outline:3px solid var(--priSoft);border-color:var(--pri)}
.cm-tile.off{cursor:default;opacity:.62}.cm-tile.off:hover{border-color:var(--line);transform:none}
.cm-th{display:flex;gap:8px;align-items:baseline;min-width:0}
.cm-th b{font:700 14px "JetBrains Mono";flex:none}
.cm-th span{font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.cm-th small{margin-left:auto;color:var(--mute);font-size:11.5px;white-space:nowrap;flex:none}
.cm-frame{position:relative;aspect-ratio:16/9;background:var(--monbg);border:1px solid var(--line2);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;padding:12px;color:color-mix(in srgb,white 80%,var(--monbg));overflow:hidden;min-width:0}
.cm-frame svg{width:22px!important;height:22px!important;opacity:.6}
.cm-frame em{font-style:normal;font-weight:700;font-size:13px;line-height:1.3}
.cm-frame small{font-size:11.5px;opacity:.72;line-height:1.35}
.cm-frame.pv{border-color:color-mix(in srgb,var(--mid) 60%,transparent);background:repeating-linear-gradient(135deg,var(--monbg) 0 14px,color-mix(in srgb,var(--mid) 9%,var(--monbg)) 14px 28px)}
.cm-frame.pv em{color:var(--mid)}
.cm-frame.lg{aspect-ratio:16/9;max-height:52vh}
.cm-frame.lg em{font-size:15px}
.cm-frame.sm{aspect-ratio:auto;min-height:92px}
.cm-live{position:absolute;top:8px;left:8px;display:inline-flex;gap:6px;align-items:center;background:var(--crit);color:white;font:700 11px Figtree;padding:4px 9px;border-radius:999px;max-width:calc(100% - 16px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-live i{width:7px;height:7px;border-radius:50%;background:white;flex:none;animation:cmPulse 1.2s ease-in-out infinite}
.cm-live b{font-family:"JetBrains Mono"}
.cm-norec{position:absolute;top:8px;right:8px;font:800 9.5px Figtree;letter-spacing:.12em;color:color-mix(in srgb,white 70%,var(--monbg));border:1px solid color-mix(in srgb,white 25%,var(--monbg));border-radius:6px;padding:3px 6px}
.cm-watching{display:inline-flex;gap:6px;align-items:center;font:700 11.5px Figtree;color:var(--crit)}
.cm-watching i{width:7px;height:7px;border-radius:50%;background:var(--crit);animation:cmPulse 1.2s ease-in-out infinite}
@keyframes cmPulse{50%{opacity:.25}}
.cm-reasons{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0 10px}
.cm-reasons i{font-style:normal;font:600 13px Figtree;padding:10px 11px;border-radius:10px;border:1px solid var(--line2);cursor:pointer;background:var(--card);user-select:none;min-width:0}
.cm-reasons i:hover{border-color:var(--pri)}
.cm-reasons i.on{background:var(--pri);color:var(--onpri);border-color:transparent}
.cm-ask{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
.cm-ask span{flex:1 1 200px;min-width:0}
.cm-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.cm-ck{width:17px!important;height:17px;padding:0!important;margin:2px 0 0;accent-color:var(--pri);flex:none;cursor:pointer}
.cm-ck[disabled]{cursor:not-allowed}
.cm-pi{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px dashed var(--line);cursor:pointer;min-width:0}
.cm-pi:last-of-type{border-bottom:0}
.cm-pi.fix{cursor:default}
.cm-pi>div{min-width:0;flex:1}
.cm-pi b{font-size:13.5px}
.cm-pi .cm-sub{display:block;margin-top:2px;line-height:1.4}
.cm-pi .tag{margin-left:6px;vertical-align:1px}
.cm-why{margin-top:10px;font-size:12.5px;line-height:1.45}
.cm-res{margin-top:10px;border-radius:10px;padding:9px 11px;font-size:12.5px;background:var(--critSoft);border:1px solid color-mix(in srgb,var(--crit) 40%,transparent);color:var(--ink);line-height:1.45}
.cm-res b{color:var(--crit)}
.cm-pw{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cm-pw input{flex:1 1 160px;min-width:0}
.cm-grp{font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:12px 0 2px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cm-grp:first-of-type{margin-top:0}
.cm-mr{display:flex;gap:8px 12px;align-items:center;flex-wrap:wrap;padding:8px 0;border-bottom:1px dashed var(--line);min-width:0}
.cm-mr:last-child{border-bottom:0}
.cm-mr>b{font:700 13px "JetBrains Mono";min-width:70px}
.cm-mr .cm-room{font-size:12px;color:var(--mute);min-width:70px}
.cm-mr select{width:auto;min-width:0;flex:0 1 170px;padding:6px 9px}
.cm-mr .cm-mt{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.cm-rule{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;padding:9px 0;border-bottom:1px dashed var(--line)}
.cm-rule:last-child{border-bottom:0}
.cm-rule>div:first-child{flex:1 1 200px;min-width:0}
.cm-rule b{font-size:13.5px}
.cm-who{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 10px}
.cm-log{display:grid;gap:0}
.cm-log>div{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:8px 0;border-bottom:1px dashed var(--line);font-size:12.5px;min-width:0}
.cm-log>div:last-child{border-bottom:0}
.cm-log time{font:600 11.5px "JetBrains Mono";color:var(--mute);white-space:nowrap}
.cm-log span{min-width:0;overflow-wrap:anywhere}
.cm-tab .cm-frame{margin:8px 0}
@media(max-width:640px){.cm-reasons{grid-template-columns:1fr}.cm-wall{grid-template-columns:1fr}.cm-mr .cm-mt{margin-left:0}}
`;
  const st = document.createElement("style"); st.id = "cm-css"; st.textContent = css; document.head.appendChild(st);

  /* ================= veri ================= */
  // Başlangıç: sistem bağlı değil, hukuki / politika / levha işaretsiz.
  // Eşleştirmedeki birkaç kanal yalnız ÖRNEK yapılandırmadır — bağlantı değildir, görüntü üretmez.
  H.data.cameras = {
    system:null,                                   // gerçek bağlantı kurulunca { kind, url, proto, at } olurdu; prototipte hiç dolmaz
    preconditions:{ legal:false, policy:false, signage:false, audit:true, noRecord:true, privacy:true, onPrem:true },
    preMeta:{},                                    // koşul → { by, at } (kim, ne zaman işaretledi)
    map:{ "rea-1":"Kanal 1", "rea-2":"Kanal 2", "rea-3":"Kanal 3", "rea-4":"Kanal 4", "kvc-1":"Kanal 9" },
    privacy:{ "rea-2":{ on:true, by:"hs.sevda", at:H.at("21:30") } },   // bedId → perde açık mı, kim, ne zaman
    rules:{ maxMin:10 },                           // izleme oturumu en çok X dk sonra "devam ediyor musunuz?" diye sorar
    sessions:[],                                   // kapanmış izleme oturumları { bedId, bedNo, u, reason, note, at, sec, why }
    live:{},                                       // bedId → açık oturum ("şu an izleniyor" göstergesi)
  };
  const C = () => H.data.cameras;

  const REASONS = () => [["bedside", H.t("cam_reason_bedside")], ["alarm", H.t("cam_reason_alarm")], ["request", H.t("cam_reason_request")], ["other", H.t("cam_reason_other")]];
  const reasonL = (k) => (REASONS().find(r => r[0] === k) || [k, k])[1];
  // Not: kanal adı ("Kanal N") ekipman kimliğidir, H.data.cameras.map içindeki saklanan değerle birebir eşleşmesi
  // gerekir; dile göre çevrilirse dil değişince "atanmadı" görünür. Bu yüzden kasıtlı olarak çevrilmez.
  const CHANNELS = Array.from({ length:16 }, (_, i) => "Kanal " + (i + 1));   // uydurma kanal listesi
  const KINDS = () => [["nvr", H.t("cam_kind_nvr")], ["vms", H.t("cam_kind_vms")], ["ip", H.t("cam_kind_ip")]];
  const PROTOS = [["rtsp", "RTSP"], ["onvif", "ONVIF"]];
  const NO_REPLY = () => H.t("cam_no_reply");
  const FORBID = ["biyomed", "kabul", "kalite", "eczaci"];        // (f) görüntüyü HİÇ görmemesi gereken roller

  const PRE = () => [
    ["legal", H.t("cam_pre_legal_t"), H.t("cam_pre_legal_d"), false],
    ["policy", H.t("cam_pre_policy_t"), H.t("cam_pre_policy_d"), false],
    ["signage", H.t("cam_pre_signage_t"), H.t("cam_pre_signage_d"), false],
    ["audit", H.t("cam_pre_audit_t"), H.t("cam_pre_audit_d"), true],
    ["noRecord", H.t("cam_pre_norecord_t"), H.t("cam_pre_norecord_d"), true],
    ["privacy", H.t("cam_pre_privacy_t"), H.t("cam_pre_privacy_d"), true],
    ["onPrem", H.t("cam_pre_onprem_t"), H.t("cam_pre_onprem_d"), true],
  ];
  const MUST = ["legal", "policy", "signage"];

  /* ================= yardımcılar ================= */
  const isICU = (u) => !!u && (u.type === "icu" || u.type === "nicu");
  const icuUnits = () => H.units().filter(isICU);
  const me = () => H.state.user || {};
  const myUnits = () => me().units || [];
  const bedUnit = (bedId) => { const b = H.bed(bedId); return b ? H.unit(b.unitId) : null; };
  const shortName = (uid) => { const x = H.userBy(uid); if (!x) return uid || "—"; const w = x.name.split(" "); const last = w.pop(); return w.length ? `${w.join(" ")} ${last[0]}.` : last; };
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const durText = (s) => s < 60 ? `${s} ${H.t("cam_sec_short")}` : `${Math.floor(s / 60)} ${H.t("cam_min_short")} ${String(s % 60).padStart(2, "0")} ${H.t("cam_sec_short")}`;
  const opts = (f, list, val) => `<div class="opts" data-cmf="${f}">${list.map(([v, l]) => `<i data-v="${esc(v)}" class="${val === v ? "on" : ""}">${esc(l)}</i>`).join("")}</div>`;
  const fld = (label, html, req) => `<div class="fld"><label>${label}${req ? ' <span class="req">*</span>' : ""}</label><div style="min-width:0">${html}</div></div>`;
  const privateAddr = (url) => /^(rtsp|https?|onvif):\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.trim());

  // Yetki: görüntüyü yalnız 'camera' yetkisi olan, o yoğun bakım biriminde çalışan kişi açar.
  const canView = (bedId) => { const u = bedUnit(bedId); return H.can("camera") && isICU(u) && myUnits().includes(u.id); };
  // Mahremiyet perdesi: o birimin hemşiresi ya da hekimi (sorumlu işareti gerekmez).
  const canCurtain = (bedId) => { const u = bedUnit(bedId); return ["hekim", "hemsire"].includes(me().role) && isICU(u) && myUnits().includes(u.id); };

  /* yatağın kamera durumu: öncelik perde > sistem > kanal */
  function status(bedId) {
    const cam = C(), pv = cam.privacy[bedId], ch = cam.map[bedId];
    if (pv && pv.on) return { k:"pv", icon:"eye", main:H.t("cam_st_curtain_main"), sub:`${shortName(pv.by)} · ${pv.at}`, frame:H.t("cam_st_curtain_frame") };
    if (!cam.system) return { k:"off", icon:"tv", main:H.t("cam_st_off_main"), sub:ch ? camTpl("cam_st_off_sub_assigned_tpl", { ch }) : H.t("cam_st_no_camera"), frame:H.t("cam_st_off_frame") };
    if (!ch) return { k:"nomap", icon:"tv", main:H.t("cam_st_no_camera"), sub:H.t("cam_st_nomap_sub"), frame:H.t("cam_st_nomap_frame") };
    return { k:"ready", icon:"tv", main:ch, sub:H.t("cam_st_ready_sub"), frame:H.t("cam_st_ready_frame") };
  }
  const frameHTML = (s) => `${I(s.icon)}<em>${esc(s.frame)}</em><small>${esc(s.sub)}</small>`;
  const liveBadge = (bedId) => { const l = C().live[bedId]; return l ? `<span class="cm-watching"><i></i>${camTpl("cam_watching_tpl", { name:esc(shortName(l.u)) })}</span>` : ""; };

  const WARN = () => `<div class="note cm-warn">${I("alert")}<span>${H.t("cam_warn")}</span></div>`;
  const RULE_CHIPS = () => `<div class="cm-chips"><span class="pill">${I("lock")}${H.t("cam_chip_norecord")}</span><span class="pill">${I("file")}${H.t("cam_chip_audit")}</span>
    <span class="pill">${I("edit")}${H.t("cam_chip_reason")}</span><span class="pill">${I("shield")}${H.t("cam_pre_onprem_t")}</span><span class="pill">${I("clock")}${camTpl("cam_chip_minutes_tpl", { n:C().rules.maxMin })}</span></div>`;

  /* ================= mahremiyet perdesi ================= */
  function setCurtain(bedId, on) {
    const b = H.bed(bedId); if (!b || !canCurtain(bedId)) { H.toast(H.t("cam_curtain_denied"), "w"); return false; }
    if (on) C().privacy[bedId] = { on:true, by:me().u, at:H.now() }; else delete C().privacy[bedId];
    H.log("Mahremiyet perdesi", `${b.no} · ${on ? "açıldı — görüntü kapandı" : "kapandı"}`);
    H.toast(on ? camTpl("cam_curtain_on_tpl", { bed:b.no }) : camTpl("cam_curtain_off_tpl", { bed:b.no }));
    return true;
  }

  /* ================= izleme akışı: gerekçe → oturum ================= */
  function openWatch(bedId, onDone) {
    const b = H.bed(bedId), u = bedUnit(bedId);
    if (!b || !canView(bedId)) { H.toast(H.t("cam_view_denied"), "w"); return; }
    const p = b.pid ? H.pt(b.pid) : null;
    const title = `${H.t("cam_singular")} · ${b.no}${p && H.showNames() ? " · " + p.name : ""}`;
    const s0 = status(bedId);

    if (s0.k === "pv") {   // perde açıkken izleme başlamaz
      H.modal({ title, body:`<div class="cm-frame pv">${frameHTML(s0)}</div>
        <p class="cm-sub" style="margin:10px 0 0">${H.t("cam_curtain_block_note")}</p>`,
        actions:`${canCurtain(bedId) ? `<button class="btn" data-cm="curtainOff">${I("eye")}${H.t("cam_btn_close_curtain")}</button>` : ""}<button class="btn g" data-x>${H.t("cancel")}</button>`,
        onMount(m) { m.addEventListener("click", e => { if (e.target.closest('[data-cm="curtainOff"]') && setCurtain(bedId, false)) { H.closeModal(); onDone && onDone(); openWatch(bedId, onDone); } }); } });
      return;
    }

    const F = { reason:null, note:"" };
    H.modal({ title, body:`${WARN()}
      <div class="sec" style="margin-top:0">${H.t("cam_reason_section")} <small>${H.t("cam_reason_required_sub")}</small></div>
      <div class="cm-reasons" data-reasons>${REASONS().map(([k, l]) => `<i data-v="${k}">${l}</i>`).join("")}</div>
      <div class="fld col"><label>${H.t("cam_note_label")} <span data-notereq class="req hidden">${H.t("cam_note_required_other")}</span></label><textarea data-note rows="2" style="min-height:56px" placeholder="${esc(H.t("cam_note_ph"))}"></textarea></div>
      <div class="note i" style="font-weight:500">${H.t("cam_open_note")}</div>`,
      actions:`<button class="btn g" data-x>${H.t("cancel")}</button><button class="btn p" data-cm="start" disabled>${I("eye")}${H.t("cam_btn_start_watch")}</button>`,
      onMount(m) {
        const btn = m.querySelector('[data-cm="start"]'), note = m.querySelector("[data-note]"), req = m.querySelector("[data-notereq]");
        const check = () => { const ok = !!F.reason && (F.reason !== "other" || F.note.trim().length >= 3); btn.disabled = !ok; req.classList.toggle("hidden", F.reason !== "other"); };
        m.addEventListener("click", e => {
          const i = e.target.closest("[data-reasons] > i");
          if (i) { F.reason = i.dataset.v; m.querySelectorAll("[data-reasons] > i").forEach(x => x.classList.toggle("on", x === i)); check(); return; }
          if (e.target.closest('[data-cm="start"]') && !btn.disabled) startSession(bedId, F.reason, F.note.trim(), onDone);
        });
        note.addEventListener("input", () => { F.note = note.value; check(); });
      } });
  }

  function startSession(bedId, reason, note, onDone) {
    const b = H.bed(bedId), cam = C(), p = b.pid ? H.pt(b.pid) : null;
    const s = { bedId, bedNo:b.no, u:me().u, reason, note, at:H.now(), t0:Date.now(), sec:0, ended:false, why:"" };
    cam.live[bedId] = s;
    H.log("Kamera izleme açıldı", `${b.no} · ${reasonL(reason)}${note ? " — " + note : ""}`);
    let nextAsk = cam.rules.maxMin * 60, askedAt = null, timer = null, m = null;

    const end = (why = "") => {
      if (s.ended) return; s.ended = true; clearInterval(timer);
      s.sec = Math.max(1, Math.round((Date.now() - s.t0) / 1000)); s.why = why;
      delete cam.live[bedId]; cam.sessions.unshift(s);
      H.log("Kamera izleme", `${b.no} · ${durText(s.sec)} · ${reasonL(reason)}${note ? " — " + note : ""}${why ? " · " + why : ""}`);
      onDone && onDone();
    };
    const paint = () => {
      const st2 = status(bedId), fr = m.querySelector("[data-frame]");
      fr.className = "cm-frame lg" + (st2.k === "pv" ? " pv" : "");
      fr.querySelector("[data-center]").innerHTML = frameHTML(st2);
      const cb = m.querySelector('[data-cm="curtain"]');
      if (cb) cb.innerHTML = `${I("eye")}${st2.k === "pv" ? H.t("cam_curtain_close_short") : H.t("cam_curtain_open_short")}`;
    };

    H.modal({ title:`${H.t("cam_singular")} · ${b.no}${p && H.showNames() ? " · " + p.name : ""}`, wide:false,
      body:`<div class="cm-frame lg" data-frame>
          <span class="cm-live"><i></i>${H.t("cam_session_open")} <b data-clock>00:00</b></span><span class="cm-norec">${H.t("cam_norecord_badge")}</span>
          <div data-center style="display:flex;flex-direction:column;align-items:center;gap:4px"></div></div>
        <div class="cm-ask note hidden" data-ask><span>${camTpl("cam_ask_tpl", { n:cam.rules.maxMin })}</span>
          <button class="btn sm p" data-cm="cont">${H.t("cam_btn_continue")}</button></div>
        <div class="cm-bar"><span class="pill">${I("edit")}${esc(reasonL(reason))}${note ? " · " + esc(note) : ""}</span><span class="pill">${I("clock")}${camTpl("cam_started_tpl", { at:s.at })}</span></div>
        ${WARN().replace("cm-warn", "cm-warn\" style=\"margin:10px 0 0")}`,
      actions:`${canCurtain(bedId) ? `<button class="btn" data-cm="curtain"></button>` : ""}<button class="btn d" data-cm="close">${I("x")}${H.t("close")}</button>`,
      onMount(el) {
        m = el; paint();
        m.addEventListener("click", e => {
          const a = e.target.closest("[data-cm]"); if (!a) return;
          if (a.dataset.cm === "close") { H.closeModal(); end(); }
          if (a.dataset.cm === "curtain") { const on = status(bedId).k !== "pv"; if (setCurtain(bedId, on)) paint(); }
          if (a.dataset.cm === "cont") { const el2 = Math.round((Date.now() - s.t0) / 1000); nextAsk = el2 + cam.rules.maxMin * 60; askedAt = null;
            m.querySelector("[data-ask]").classList.add("hidden"); H.log("Kamera izleme uzatıldı", `${b.no} · ${durText(el2)} sonra`); }
        });
      },
      onClose() { end(); } });

    timer = setInterval(() => {
      if (!m || !document.body.contains(m)) { end("pencere kapandı"); return; }
      const el = Math.round((Date.now() - s.t0) / 1000);
      m.querySelector("[data-clock]").textContent = mmss(el);
      if (askedAt === null && el >= nextAsk) { askedAt = el; m.querySelector("[data-ask]").classList.remove("hidden"); }
      if (askedAt !== null && el - askedAt >= 60) { H.closeModal(); end("yanıt yok, kendiliğinden kapandı"); H.toast(camTpl("cam_toast_autoclose_tpl", { bed:b.no }), "w"); }
    }, 1000);
  }

  /* ================= oturum listesi (kendi oturumların) ================= */
  function sessionList(filter) {
    const list = C().sessions.filter(s => s.u === me().u && (!filter || filter(s))).slice(0, 8);
    if (!list.length) return `<div class="empty" style="padding:16px 10px;font-size:13px">${H.t("cam_no_sessions")}</div>`;
    return `<div class="box"><div class="cm-log">${list.map(s => `<div><time>${s.at}</time><span><b class="mono">${esc(s.bedNo)}</b> · ${durText(s.sec)} · ${esc(reasonL(s.reason))}${s.note ? " — " + esc(s.note) : ""}${s.why ? ` <span class="cm-sub">(${esc(s.why)})</span>` : ""}</span></div>`).join("")}</div></div>`;
  }

  /* ================= sayfa: Kamera duvarı ================= */
  H.register("camera", { title:() => H.t("m_camera"), perm:"camera", render(root) {
    root.innerHTML = ""; const w = document.createElement("div"); w.className = "cm"; root.appendChild(w);
    const draw = () => {
      const units = icuUnits().filter(u => myUnits().includes(u.id)), cam = C();
      const tile = (b) => {
        const p = b.pid ? H.pt(b.pid) : null, s = status(b.id), empty = !p;
        const nm = p ? (H.showNames() ? esc(p.name) : H.t("cam_bed_full")) : H.t("cam_bed_empty");
        return `<div class="cm-tile${empty ? " off" : ""}" ${empty ? "" : `role="button" tabindex="0" data-bed="${b.id}"`}>
          <div class="cm-th"><b>${esc(b.no)}</b><span>${nm}</span><small>${H.t("cam_room_word")} ${esc(b.room)}</small></div>
          <div class="cm-frame${s.k === "pv" ? " pv" : ""}">${empty ? `${I("bed")}<em>${H.t("cam_bed_empty")}</em><small>${H.t("cam_no_watch_needed")}</small>` : frameHTML(s)}</div>
          ${liveBadge(b.id)}</div>`;
      };
      w.innerHTML = `<div class="ph"><div><h2>${H.t("m_camera")}</h2><p>${H.t("cam_page_sub")}</p></div></div>
        ${WARN()}
        <div class="cm-strip"><span class="cm-dot" style="--c:${cam.system ? "var(--ok)" : "var(--mute)"}"></span><b>${cam.system ? H.t("cam_sys_on") : H.t("cam_st_off_main")}</b>
          <span class="cm-sub">${cam.system ? "" : H.t("cam_sys_off_sub")}</span></div>
        ${RULE_CHIPS()}
        ${units.length ? units.map(u => `<div class="sec">${esc(u.tr)} <small>${u.beds.length} ${H.t("cam_bed_word")}</small></div><div class="cm-wall">${u.beds.map(tile).join("")}</div>`).join("")
          : `<div class="empty">${H.t("cam_no_icu_units")}</div>`}
        <div class="sec">${H.t("cam_my_sessions")} <small>${H.t("cam_log_immutable")}</small></div>${sessionList()}`;
    };
    const open = (t) => { if (t) openWatch(t.dataset.bed, draw); };
    w.addEventListener("click", e => open(e.target.closest(".cm-tile[data-bed]")));
    w.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".cm-tile[data-bed]")) { e.preventDefault(); open(e.target); } });
    draw();
  } });

  /* ================= hasta ekranı paneli ================= */
  H.cameraTab = (el, pid) => {
    el.innerHTML = ""; const w = document.createElement("div"); w.className = "cm-tab"; el.appendChild(w);
    const draw = () => {
      const p = H.pt(pid), b = p && H.bed(p.bed), u = b && H.unit(b.unitId);
      if (!b) { w.innerHTML = `<div class="empty">${H.t("cam_patient_notfound")}</div>`; return; }
      if (!isICU(u)) { w.innerHTML = `<div class="box"><h5>${I("tv")} ${H.t("cam_singular")}</h5><p class="cm-sub" style="margin:0">${camTpl("cam_not_icu_tpl", { unit:esc(u ? u.tr : "") })}</p></div>`; return; }
      const view = canView(b.id), curt = canCurtain(b.id);
      if (!view && !curt) { w.innerHTML = `<div class="box"><h5>${I("lock")} ${H.t("cam_singular")}</h5><p class="cm-sub" style="margin:0">${H.t("cam_no_access")}</p></div>`; return; }
      const s = status(b.id);
      w.innerHTML = `<div class="box"><h5>${I("tv")} ${H.t("cam_singular")} · ${esc(b.no)} <span class="r">${s.k === "pv" ? `<span class="tag w">${H.t("cam_curtain_open_tag")}</span>` : `<span class="tag">${esc(s.main)}</span>`}</span></h5>
        <div class="cm-frame sm${s.k === "pv" ? " pv" : ""}">${frameHTML(s)}</div>
        ${liveBadge(b.id)}
        <p class="cm-sub" style="margin:6px 0 0">${H.t("cam_warn_short")}</p>
        <div class="cm-bar">
          ${view ? `<button class="btn p sm" data-cm="watch"${s.k === "pv" ? ` disabled title="${esc(H.t("cam_curtain_disabled_title"))}"` : ""}>${I("eye")}${H.t("cam_btn_start_watch")}</button>` : `<span class="cm-sub">${I("lock")} ${H.t("cam_only_role_access")}</span>`}
          ${curt ? `<button class="btn sm" data-cm="curtain">${I("eye")}${s.k === "pv" ? H.t("cam_curtain_close_short") : H.t("cam_curtain_open_short")}</button>` : ""}
        </div></div>
        ${view ? `<div class="sec">${H.t("cam_bed_sessions")}</div>${sessionList(x => x.bedId === b.id)}` : ""}`;
    };
    w.addEventListener("click", e => {
      const a = e.target.closest("[data-cm]"); if (!a || a.disabled) return;
      const b = H.bed(H.pt(pid).bed);
      if (a.dataset.cm === "watch") openWatch(b.id, draw);
      if (a.dataset.cm === "curtain" && setCurtain(b.id, status(b.id).k !== "pv")) draw();
    });
    draw();
  };

  /* ================= yönetim paneli: Kamera sekmesi ================= */
  const F = { kind:"nvr", url:"", user:"", proto:"rtsp", pwSet:false };   // bağlantı formu (şifrenin kendisi hiçbir yerde tutulmaz)
  let lastTest = null;

  H.cameraAdmin = (body) => {
    body.innerHTML = ""; const w = document.createElement("div"); w.className = "cm-adm"; body.appendChild(w);
    const draw = () => {
      const cam = C(), pc = cam.preconditions, PREL = PRE();
      const missing = MUST.filter(k => !pc[k]).map(k => PREL.find(x => x[0] === k)[1].toLocaleLowerCase(locTag()));
      const canConnect = !missing.length && F.url.trim();
      const whyOff = missing.length ? camTpl("cam_why_missing_tpl", { list:missing.join(", ") }) : !F.url.trim() ? H.t("cam_why_nourl") : "";
      const addrWarn = F.url.trim() && !privateAddr(F.url) ? `<div class="note" style="margin-top:6px">${I("alert")} ${H.t("cam_addr_warn")}</div>` : "";

      // eşleştirme: yalnız yoğun bakım türü birimler; aynı kanal iki yatakta ise uyar
      const used = {}; Object.entries(cam.map).forEach(([bid, ch]) => { (used[ch] = used[ch] || []).push(bid); });
      const mapRow = (b) => { const ch = cam.map[b.id] || "", dup = ch && used[ch].length > 1;
        return `<div class="cm-mr"><b>${esc(b.no)}</b><span class="cm-room">${H.t("cam_room_word")} ${esc(b.room)}</span>
          <select data-map="${b.id}" aria-label="${esc(b.no)} ${esc(H.t("cam_aria_channel"))}"><option value="">${H.t("cam_opt_unassigned")}</option>${CHANNELS.map(c => `<option${c === ch ? " selected" : ""}>${c}</option>`).join("")}</select>
          <span class="cm-mt">${ch && !cam.system ? `<span class="tag">${H.t("cam_tag_noconn")}</span>` : ""}${dup ? `<span class="tag c">${camTpl("cam_tag_dup_tpl", { ch:esc(ch) })}</span>` : ""}${cam.privacy[b.id] ? `<span class="tag w">${H.t("cam_curtain_open_tag")}</span>` : ""}</span></div>`; };

      // kimler görebilir — rollerden türetilir; yasaklı rolde yetki varsa ihlal gösterilir
      const roles = H.data.roles, viewers = Object.entries(roles).filter(([, r]) => r.perms.includes("camera")).map(([, r]) => r.name + " " + H.t("cam_own_unit_suffix"))
        .concat(Object.values(H.EXTRA).filter(x => x.perms.includes("camera")).map(x => x.name + " " + H.t("cam_own_unit_suffix")));
      const never = Object.entries(roles).filter(([, r]) => !r.perms.includes("camera"))
        .map(([k, r]) => Object.values(H.EXTRA).some(x => x.for.includes(k) && x.perms.includes("camera")) ? camTpl("cam_role_extra_tpl", { role:r.name }) : r.name);
      const bad = FORBID.filter(k => roles[k] && roles[k].perms.includes("camera")).map(k => roles[k].name);
      const camLog = H.audit.filter(a => /^Kamera|^Mahremiyet/.test(a.action)).slice(0, 8);
      const hhmm = (d) => d instanceof Date ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "—";

      w.innerHTML = `
      <div class="cm-strip"><span class="cm-dot" style="--c:${cam.system ? "var(--ok)" : "var(--mute)"}"></span><b>${cam.system ? H.t("cam_sys_on") : H.t("cam_st_off_main")}</b>
        <span class="cm-sub">${missing.length ? camTpl("cam_adm_missing_tpl", { n:missing.length }) : H.t("cam_adm_ready")}${H.t("cam_adm_you_too")}</span></div>
      ${WARN()}
      <div class="g2">
        <div class="box"><h5>${I("shield")} ${H.t("cam_box_preconditions")} <span class="r">${MUST.length - missing.length} / ${MUST.length} ${H.t("cam_inst_condition")}</span></h5>
          ${PREL.map(([k, l, d, fixed]) => { const meta = cam.preMeta[k];
            return `<label class="cm-pi${fixed ? " fix" : ""}"><input type="checkbox" class="cm-ck" data-pre="${k}"${pc[k] ? " checked" : ""}${fixed ? " disabled" : ""}>
              <div><b>${l}</b>${fixed ? `<span class="tag">${H.t("cam_fixed_tag")}</span>` : ""}<span class="cm-sub">${d}</span>
              ${!fixed && pc[k] && meta ? `<span class="cm-sub">${H.t("cam_marked_by")} ${esc(shortName(meta.by))} · ${meta.at}</span>` : ""}</div></label>`; }).join("")}
          <p class="cm-sub" style="margin:8px 0 0">${H.t("cam_pre_footnote")}</p></div>

        <div class="box"><h5>${I("link")} ${H.t("cam_box_connection")} <span class="r"><span class="tag">${H.t("cam_tag_notconnected")}</span></span></h5>
          ${fld(H.t("cam_fld_systype"), opts("kind", KINDS(), F.kind))}
          ${fld(H.t("cam_fld_address"), `<input data-cmi="url" value="${esc(F.url)}" placeholder="rtsp://10.0.0.5:554/…" inputmode="url" autocomplete="off" spellcheck="false">${addrWarn}`, true)}
          ${fld(H.t("cam_fld_username"), `<input data-cmi="user" value="${esc(F.user)}" autocomplete="off" placeholder="${esc(H.t("cam_ph_from_devteam"))}">`)}
          ${fld(H.t("cam_fld_password"), `<div class="cm-pw"><input type="password" data-cmi="pw" value="" autocomplete="new-password" placeholder="${esc(F.pwSet ? H.t("cam_pw_saved") : H.t("cam_pw_empty"))}">${F.pwSet ? `<span class="tag">${H.t("cam_tag_saved")}</span>` : ""}</div>`)}
          ${fld(H.t("cam_fld_protocol"), opts("proto", PROTOS, F.proto))}
          <div class="cm-bar"><button class="btn sm" data-cma="test"${F.url.trim() ? "" : " disabled"}>${I("zap")}${H.t("cam_btn_test")}</button>
            <button class="btn sm p" data-cma="connect"${canConnect ? "" : " disabled"}>${I("plug")}${H.t("cam_btn_connect")}</button></div>
          ${whyOff ? `<div class="cm-sub cm-why">${I("lock")} ${esc(whyOff)}</div>` : ""}
          ${lastTest ? `<div class="cm-res"><b>${lastTest.at} · ${esc(lastTest.what)}: ${NO_REPLY()}</b><br>${H.t("cam_test_result_note")}</div>` : ""}
          <div class="note i" style="margin-top:10px;font-weight:500">${H.t("cam_field_note")}</div></div>
      </div>

      <div class="sec">${H.t("cam_sec_mapping")} <small>${camTpl("cam_mapping_sub_tpl", { n:icuUnits().reduce((n, u) => n + u.beds.length, 0) })}</small></div>
      <div class="box">${!cam.system ? `<div class="note" style="margin-bottom:10px">${I("alert")} ${H.t("cam_notconnected_note")}</div>` : ""}
        ${icuUnits().map(u => `<div class="cm-grp">${esc(u.tr)} <span class="pill">${esc(H.kindName(u.kind) || "")}</span></div>${u.beds.map(mapRow).join("")}`).join("")}</div>

      <div class="g2" style="margin-top:12px">
        <div class="box"><h5>${I("gear")} ${H.t("cam_rules_h")}</h5>
          <div class="cm-rule"><div><b>${H.t("cam_rule_record_t")}</b><div class="cm-sub">${H.t("cam_rule_record_d")}</div></div><span class="tag">${I("lock")}${H.t("cam_rule_record_tag")}</span></div>
          <div class="cm-rule"><div><b>${H.t("cam_rule_session_t")}</b><div class="cm-sub">${H.t("cam_rule_session_d")}</div></div>${opts("maxMin", [["5", "5 " + H.t("cam_min_short")], ["10", "10 " + H.t("cam_min_short")], ["15", "15 " + H.t("cam_min_short")], ["30", "30 " + H.t("cam_min_short")]], String(cam.rules.maxMin))}</div>
          <div class="cm-rule"><div><b>${H.t("cam_rule_reason_t")}</b><div class="cm-sub">${H.t("cam_rule_reason_d")}</div></div><span class="tag">${I("lock")}${H.t("cam_rule_reason_tag")}</span></div>
          <div class="cm-rule"><div><b>${H.t("cam_rule_access_t")}</b><div class="cm-sub">${H.t("cam_rule_access_d")}</div></div><span class="tag">${I("lock")}${H.t("cam_rule_access_tag")}</span></div></div>

        <div class="box"><h5>${I("users")} ${H.t("cam_box_kimGorebilir")}</h5>
          <div class="cm-sub">${H.t("cam_can_open")}</div><div class="cm-who">${viewers.map(x => `<span class="tag">${I("eye")}${esc(x)}</span>`).join("") || `<span class="cm-sub">—</span>`}</div>
          <div class="cm-sub">${H.t("cam_curtain_toggle")}</div><div class="cm-who"><span class="tag">${H.t("cam_role_hekim")}</span><span class="tag">${H.t("cam_role_hemsire")}</span></div>
          <div class="cm-sub">${H.t("cam_never_see")}</div><div class="cm-who">${never.map(x => `<span class="tag">${I("lock")}${esc(x)}</span>`).join("")}</div>
          ${bad.length ? `<div class="note" style="border-color:color-mix(in srgb,var(--crit) 45%,transparent);color:var(--crit);background:var(--critSoft)">${I("alert")} ${camTpl("cam_violation_tpl", { roles:esc(bad.join(", ")) })}</div>` : ""}
          <p class="cm-sub" style="margin:4px 0 0">${H.t("cam_who_footnote")}</p></div>
      </div>

      <div class="sec">${H.t("cam_sec_recent_logs")} <small>${H.t("cam_recent_logs_sub")}</small></div>
      ${camLog.length ? `<div class="box"><div class="cm-log">${camLog.map(a => `<div><time>${hhmm(a.at)}</time><span><b>${esc(a.action)}</b> · ${esc(shortName(a.user))} · ${esc(a.detail)}</span></div>`).join("")}</div></div>`
        : `<div class="empty" style="padding:16px 10px;font-size:13px">${H.t("cam_no_logs")}</div>`}`;
    };

    w.addEventListener("click", e => {
      const cam = C();
      const i = e.target.closest(".opts[data-cmf] > i");
      if (i) { const f = i.parentElement.dataset.cmf, v = i.dataset.v;
        if (f === "maxMin") { if (+v === cam.rules.maxMin) return; H.log("Kamera kuralı", `Oturum sınırı: ${cam.rules.maxMin} dk → ${v} dk`); cam.rules.maxMin = +v; }
        else { if (F[f] === v) return; const L = f === "kind" ? KINDS() : PROTOS; H.log("Kamera bağlantısı", `${f === "kind" ? "Sistem türü" : "Protokol"}: ${(L.find(x => x[0] === F[f]) || [])[1]} → ${(L.find(x => x[0] === v) || [])[1]}`); F[f] = v; }
        draw(); return; }
      const a = e.target.closest("[data-cma]"); if (!a || a.disabled) return;
      const what = a.dataset.cma === "test" ? H.t("cam_test_what_test") : H.t("cam_test_what_connect");
      lastTest = { at:H.now(), what };
      H.log("Kamera bağlantısı", `${what} · ${KINDS().find(x => x[0] === F.kind)[1]} · ${PROTOS.find(x => x[0] === F.proto)[1]} · ${NO_REPLY()}`);
      H.toast(`${what}: ${NO_REPLY()}`, "e"); draw();
    });
    w.addEventListener("change", e => {
      const cam = C(), t = e.target;
      if (t.dataset.pre) { const k = t.dataset.pre, item = PRE().find(x => x[0] === k); if (!item || item[3]) return;
        cam.preconditions[k] = t.checked; if (t.checked) cam.preMeta[k] = { by:me().u, at:H.now() }; else delete cam.preMeta[k];
        H.log("Kamera ön koşulu", `${item[1]}: ${t.checked ? "işaretlendi" : "işaret kaldırıldı"}`); draw(); return; }
      if (t.dataset.map) { const b = H.bed(t.dataset.map), old = cam.map[b.id] || "atanmadı", nv = t.value || "atanmadı";
        if (t.value) cam.map[b.id] = t.value; else delete cam.map[b.id];
        H.log("Kamera eşleştirme", `${b.no}: ${old} → ${nv}`); draw(); return; }
      if (t.dataset.cmi === "pw") { if (!t.value) return; t.value = ""; F.pwSet = true; H.log("Kamera bağlantısı", "Şifre değiştirildi (değer kaydedilmez)"); draw(); return; }
      if (t.dataset.cmi) { const f = t.dataset.cmi, v = t.value.trim(); if (F[f] === v) return; F[f] = v;
        H.log("Kamera bağlantısı", f === "url" ? `Adres: ${v || "silindi"}` : `Kullanıcı adı: ${v ? "değiştirildi" : "silindi"}`); draw(); }
    });
    draw();
  };
})();
