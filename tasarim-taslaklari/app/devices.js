/* Homunculus prototip v1 — biyomedikal: cihaz envanteri, bakım ve kalibrasyon takvimi, arıza kayıtları.
 * Sayfa: 'devices' (sekmeler: ozet, envanter, takvim, ariza, odalar) — screens.js'teki eski salt-okunur sayfanın yerine geçer.
 * Dışa verilenler: H.data.devices, H.data.workOrders, H.devicesAt(unitId, room?), H.deviceById(id),
 *                  H.DEVICE_KINDS, H.reportDeviceFault({ deviceId, text, priority }), H.openDevice(id)
 * KESİN KURAL: bu modül hasta adı, tanı ya da vital GÖSTERMEZ. Konum = Blok · kat · birim · oda · yatak no; yatak için yalnız dolu/boş durumu.
 * Veri tamamen uydurmadır; marka/model adı yoktur, yalnız genel tür adları kullanılır. Bugün = 24.09.2026. */
(function () {
  const H = window.H;
  if (!H) return;
  const I = H.icon, esc = H.esc;
  /* 24.09 (3. oturum) · ekran iskeleti dil sözlüğü. H.log denetim metinleri, cihaz seri no/sertifika no gibi
   * üretilmiş veri değerleri ve iş emri serbest metinleri (w.text, closeNote…) kapsam dışı — veri/kayıt niteliğinde. */
  H.addT({
    dev_kind_mon:{ AZ:"Xəstə başı monitoru", TR:"Hasta başı monitör", RU:"Прикроватный монитор", EN:"Bedside monitor" },
    dev_kind_vent:{ AZ:"Ventilyator", TR:"Ventilatör", RU:"Аппарат ИВЛ", EN:"Ventilator" },
    dev_kind_inf:{ AZ:"İnfuziya nasosu", TR:"İnfüzyon pompası", RU:"Инфузионный насос", EN:"Infusion pump" },
    dev_kind_syr:{ AZ:"Şpris nasosu", TR:"Şırınga pompası", RU:"Шприцевой насос", EN:"Syringe pump" },
    dev_kind_defib:{ AZ:"Defibrillyator", TR:"Defibrilatör", RU:"Дефибриллятор", EN:"Defibrillator" },
    dev_kind_port:{ AZ:"Portativ vital monitor", TR:"Portatif vital monitör", RU:"Портативный монитор витальных функций", EN:"Portable vital signs monitor" },
    dev_kind_kuv:{ AZ:"Kuvez", TR:"Küvöz", RU:"Кувез (инкубатор)", EN:"Incubator" },
    dev_kind_ekg:{ AZ:"EKQ cihazı", TR:"EKG cihazı", RU:"Аппарат ЭКГ", EN:"ECG machine" },
    dev_kind_asp:{ AZ:"Aspirator", TR:"Aspiratör", RU:"Аспиратор", EN:"Suction unit" },
    dev_st_calisiyor:{ AZ:"İşləyir", TR:"Çalışıyor", RU:"Работает", EN:"Working" },
    dev_st_ariza:{ AZ:"Nasazdır", TR:"Arızalı", RU:"Неисправен", EN:"Faulty" },
    dev_st_bakimda:{ AZ:"Texniki xidmətdə", TR:"Bakımda", RU:"На обслуживании", EN:"In maintenance" },
    dev_st_depoda:{ AZ:"Anbarda", TR:"Depoda", RU:"На складе", EN:"In storage" },
    dev_st_kullanim_disi:{ AZ:"İstifadədən çıxarılıb", TR:"Kullanım dışı", RU:"Выведен из эксплуатации", EN:"Out of service" },
    dev_bs_dolu:{ AZ:"Dolu", TR:"Dolu", RU:"Занята", EN:"Occupied" },
    dev_bs_bos:{ AZ:"Boş", TR:"Boş", RU:"Свободна", EN:"Free" },
    dev_bs_temizlik:{ AZ:"Təmizlikdə", TR:"Temizlikte", RU:"На уборке", EN:"Being cleaned" },
    dev_bs_bloke:{ AZ:"Bloklanıb", TR:"Bloke", RU:"Заблокирована", EN:"Blocked" },
    dev_bs_rezerve:{ AZ:"Rezerv edilib", TR:"Rezerve", RU:"Зарезервирована", EN:"Reserved" },
    dev_pri_yuksek:{ AZ:"Yüksək", TR:"Yüksek", RU:"Высокий", EN:"High" },
    dev_pri_orta:{ AZ:"Orta", TR:"Orta", RU:"Средний", EN:"Medium" },
    dev_pri_dusuk:{ AZ:"Aşağı", TR:"Düşük", RU:"Низкий", EN:"Low" },
    dev_wst_acik:{ AZ:"Açıq", TR:"Açık", RU:"Открыта", EN:"Open" },
    dev_wst_atandi:{ AZ:"Təyin olundu", TR:"Atandı", RU:"Назначена", EN:"Assigned" },
    dev_wst_kapandi:{ AZ:"Bağlandı", TR:"Kapandı", RU:"Закрыта", EN:"Closed" },
    dev_ht_pm:{ AZ:"Dövri texniki xidmət", TR:"Periyodik bakım", RU:"Плановое обслуживание", EN:"Scheduled maintenance" },
    dev_ht_cal:{ AZ:"Kalibrləmə", TR:"Kalibrasyon", RU:"Калибровка", EN:"Calibration" },
    dev_ht_repair:{ AZ:"Nasazlığın aradan qaldırılması", TR:"Arıza onarımı", RU:"Ремонт неисправности", EN:"Fault repair" },
    dev_calby_biomed:{ AZ:"Xəstəxananın biotibbi mühəndislik şöbəsi", TR:"Hastane biyomedikal birimi", RU:"Биомедицинский отдел больницы", EN:"Hospital biomedical unit" },
    dev_calby_lab:{ AZ:"Səlahiyyətli kalibrləmə laboratoriyası", TR:"Yetkili kalibrasyon laboratuvarı", RU:"Аккредитованная калибровочная лаборатория", EN:"Accredited calibration laboratory" },
    dev_tab_ozet:{ AZ:"İcmal", TR:"Özet", RU:"Сводка", EN:"Summary" },
    dev_tab_envanter:{ AZ:"İnventar", TR:"Envanter", RU:"Инвентарь", EN:"Inventory" },
    dev_tab_takvim:{ AZ:"Texniki xidmət təqvimi", TR:"Bakım takvimi", RU:"Календарь обслуживания", EN:"Maintenance calendar" },
    dev_tab_ariza:{ AZ:"Nasazlıq qeydləri", TR:"Arıza kayıtları", RU:"Записи о неисправностях", EN:"Fault records" },
    dev_tab_odalar:{ AZ:"Çarpayılar və otaqlar", TR:"Yataklar ve odalar", RU:"Койки и палаты", EN:"Beds and rooms" },
    dev_month_jan:{ AZ:"Yanvar", TR:"Ocak", RU:"Январь", EN:"January" }, dev_month_feb:{ AZ:"Fevral", TR:"Şubat", RU:"Февраль", EN:"February" },
    dev_month_mar:{ AZ:"Mart", TR:"Mart", RU:"Март", EN:"March" }, dev_month_apr:{ AZ:"Aprel", TR:"Nisan", RU:"Апрель", EN:"April" },
    dev_month_may:{ AZ:"May", TR:"Mayıs", RU:"Май", EN:"May" }, dev_month_jun:{ AZ:"İyun", TR:"Haziran", RU:"Июнь", EN:"June" },
    dev_month_jul:{ AZ:"İyul", TR:"Temmuz", RU:"Июль", EN:"July" }, dev_month_aug:{ AZ:"Avqust", TR:"Ağustos", RU:"Август", EN:"August" },
    dev_month_sep:{ AZ:"Sentyabr", TR:"Eylül", RU:"Сентябрь", EN:"September" }, dev_month_oct:{ AZ:"Oktyabr", TR:"Ekim", RU:"Октябрь", EN:"October" },
    dev_month_nov:{ AZ:"Noyabr", TR:"Kasım", RU:"Ноябрь", EN:"November" }, dev_month_dec:{ AZ:"Dekabr", TR:"Aralık", RU:"Декабрь", EN:"December" },
    dev_day_sun:{ AZ:"Bazar", TR:"Pazar", RU:"Воскресенье", EN:"Sunday" }, dev_day_mon:{ AZ:"Bazar ertəsi", TR:"Pazartesi", RU:"Понедельник", EN:"Monday" },
    dev_day_tue:{ AZ:"Çərşənbə axşamı", TR:"Salı", RU:"Вторник", EN:"Tuesday" }, dev_day_wed:{ AZ:"Çərşənbə", TR:"Çarşamba", RU:"Среда", EN:"Wednesday" },
    dev_day_thu:{ AZ:"Cümə axşamı", TR:"Perşembe", RU:"Четверг", EN:"Thursday" }, dev_day_fri:{ AZ:"Cümə", TR:"Cuma", RU:"Пятница", EN:"Friday" },
    dev_day_sat:{ AZ:"Şənbə", TR:"Cumartesi", RU:"Суббота", EN:"Saturday" },
    dev_wd_mon:{ AZ:"B.e", TR:"Pzt", RU:"Пн", EN:"Mon" }, dev_wd_tue:{ AZ:"Ç.a", TR:"Sal", RU:"Вт", EN:"Tue" },
    dev_wd_wed:{ AZ:"Ç", TR:"Çar", RU:"Ср", EN:"Wed" }, dev_wd_thu:{ AZ:"C.a", TR:"Per", RU:"Чт", EN:"Thu" },
    dev_wd_fri:{ AZ:"C", TR:"Cum", RU:"Пт", EN:"Fri" }, dev_wd_sat:{ AZ:"Ş", TR:"Cmt", RU:"Сб", EN:"Sat" },
    dev_wd_sun:{ AZ:"B", TR:"Paz", RU:"Вс", EN:"Sun" },
    dev_ev_late:{ AZ:"Gecikmiş", TR:"Gecikmiş", RU:"Просрочено", EN:"Overdue" },
    dev_ev_plan:{ AZ:"Planlı", TR:"Planlı", RU:"Запланировано", EN:"Planned" },
    dev_ev_done:{ AZ:"Edildi", TR:"Yapıldı", RU:"Выполнено", EN:"Done" },
    dev_page_sub_tpl:{ AZ:"İnventar, texniki xidmət və kalibrləmə təqvimi · bu gün {date} · {n} cihaz · bu ekranda xəstə məlumatı yoxdur",
      TR:"Envanter, bakım ve kalibrasyon takvimi · bugün {date} · {n} cihaz · bu ekranda hasta bilgisi yoktur",
      RU:"Инвентарь, обслуживание и календарь калибровки · сегодня {date} · {n} приборов · на этом экране нет данных о пациентах",
      EN:"Inventory, maintenance and calibration calendar · today {date} · {n} devices · this screen holds no patient information" },
    dev_btn_newwo:{ AZ:"Nasazlıq qeydi aç", TR:"Arıza kaydı aç", RU:"Открыть запись о неисправности", EN:"Open a fault record" },
    dev_conn_note:{ AZ:"Cihaz bağlantısı (drayverlər, şəbəkə keçidi) cihaz/inteqrasiya komandasının sahəsidir; bu ekran inventar və texniki xidmət üçündür.",
      TR:"Cihaz bağlantısı (sürücüler, ağ geçidi) cihaz/entegrasyon ekibinin alanıdır; bu ekran envanter ve bakım içindir.",
      RU:"Подключение устройств (драйверы, шлюз) — область команды устройств/интеграции; этот экран предназначен для инвентаря и обслуживания.",
      EN:"Device connectivity (drivers, gateway) is the device/integration team's domain; this screen is for inventory and maintenance." },
    dev_card_late_tpl:{ AZ:"texniki xidmət / kalibrləmə gecikib · {n} cihaz", TR:"bakım / kalibrasyon gecikmiş · {n} cihaz", RU:"просрочено обслуживание / калибровка · {n} приборов", EN:"maintenance / calibration overdue · {n} devices" },
    dev_card_week:{ AZ:"bu həftə ediləcək texniki xidmət / kalibrləmə", TR:"bu hafta yapılacak bakım / kalibrasyon", RU:"обслуживание / калибровка на этой неделе", EN:"maintenance / calibration due this week" },
    dev_card_wo_open_tpl:{ AZ:"açıq nasazlıq qeydi · {n} hələ təyin olunmayıb", TR:"açık arıza kaydı · {n} henüz atanmadı", RU:"открытых записей о неисправности · {n} ещё не назначено", EN:"open fault records · {n} not yet assigned" },
    dev_card_silent_tpl:{ AZ:"monitor məlumat göndərmir · {list}, {n} dəq", TR:"monitör veri göndermiyor · {list}, {n} dk", RU:"монитор не передаёт данные · {list}, {n} мин", EN:"monitor not sending data · {list}, {n} min" },
    dev_card_silent_none:{ AZ:"məlumat göndərməyən monitor yoxdur", TR:"veri göndermeyen monitör yok", RU:"нет молчащих мониторов", EN:"no silent monitors" },
    dev_card_lowbatt:{ AZ:"portativ cihazın batareyası %20-dən aşağıdır", TR:"portatif cihazın şarjı %20'nin altında", RU:"заряд портативного прибора ниже 20%", EN:"portable device battery below 20%" },
    dev_sec_today_week_tpl:{ AZ:"Bu gün və bu həftə ediləcəklər", TR:"Bugün ve bu hafta yapılacaklar", RU:"Что нужно сделать сегодня и на этой неделе", EN:"Due today and this week" },
    dev_grp_late_tpl:{ AZ:"Gecikmiş · {n}", TR:"Gecikmiş · {n}", RU:"Просрочено · {n}", EN:"Overdue · {n}" },
    dev_more_late_tpl:{ AZ:"{n} gecikmiş iş daha · təqvimdə bax", TR:"{n} gecikmiş iş daha · takvimde gör", RU:"ещё {n} просроченных · смотреть в календаре", EN:"{n} more overdue · view in calendar" },
    dev_grp_today_tpl:{ AZ:"Bu gün · {n}", TR:"Bugün · {n}", RU:"Сегодня · {n}", EN:"Today · {n}" },
    dev_no_pm_today:{ AZ:"Bu gün planlı texniki xidmət yoxdur.", TR:"Bugün planlı bakım yok.", RU:"На сегодня плановое обслуживание не запланировано.", EN:"No maintenance planned for today." },
    dev_grp_week_tpl:{ AZ:"Bu həftə · {n}", TR:"Bu hafta · {n}", RU:"На этой неделе · {n}", EN:"This week · {n}" },
    dev_sec_open_wo:{ AZ:"Açıq nasazlıq qeydləri", TR:"Açık arıza kayıtları", RU:"Открытые записи о неисправностях", EN:"Open fault records" },
    dev_all:{ AZ:"Hamısı", TR:"Tümü", RU:"Все", EN:"All" },
    dev_no_open_wo:{ AZ:"Açıq nasazlıq qeydi yoxdur.", TR:"Açık arıza kaydı yok.", RU:"Открытых записей о неисправностях нет.", EN:"No open fault records." },
    dev_opened_by_tpl:{ AZ:"{who} açdı", TR:"{who} açtı", RU:"открыл(а) {who}", EN:"opened by {who}" },
    dev_box_status:{ AZ:"Cihaz vəziyyəti", TR:"Cihaz durumu", RU:"Статус приборов", EN:"Device status" },
    dev_box_bykind:{ AZ:"Növə görə", TR:"Türe göre", RU:"По типу", EN:"By type" },
    dev_opt_all_units:{ AZ:"Bütün bölmələr", TR:"Tüm birimler", RU:"Все отделения", EN:"All units" },
    dev_opt_all_kinds:{ AZ:"Bütün növlər", TR:"Tüm türler", RU:"Все типы", EN:"All types" },
    dev_opt_all_status:{ AZ:"Bütün vəziyyətlər", TR:"Tüm durumlar", RU:"Все статусы", EN:"All statuses" },
    dev_opt_all_due:{ AZ:"Bütün texniki xidmət tarixləri", TR:"Tüm bakım tarihleri", RU:"Все сроки обслуживания", EN:"All maintenance dates" },
    dev_opt_due_late:{ AZ:"Gecikmiş", TR:"Gecikmiş", RU:"Просрочено", EN:"Overdue" },
    dev_opt_due_week:{ AZ:"7 gün ərzində", TR:"7 gün içinde", RU:"В течение 7 дней", EN:"Within 7 days" },
    dev_opt_due_month:{ AZ:"30 gün ərzində", TR:"30 gün içinde", RU:"В течение 30 дней", EN:"Within 30 days" },
    dev_search_ph:{ AZ:"Cihaz no, seriya no, otaq, çarpayı no…", TR:"Cihaz no, seri no, oda, yatak no…", RU:"№ прибора, серийный №, палата, № койки…", EN:"Device no, serial no, room, bed no…" },
    dev_chip_silent:{ AZ:"Yalnız məlumat göndərməyən monitorlar", TR:"Yalnız veri göndermeyen monitörler", RU:"Только молчащие мониторы", EN:"Only silent monitors" },
    dev_chip_lowbatt:{ AZ:"Yalnız batareyası aşağı olanlar", TR:"Yalnız şarjı düşük olanlar", RU:"Только с низким зарядом", EN:"Only low-battery ones" },
    dev_showing_tpl:{ AZ:"{total} cihazdan {n} göstərilir", TR:"{total} cihazdan {n} gösteriliyor", RU:"Показано {n} из {total} приборов", EN:"Showing {n} of {total} devices" },
    dev_clear_filters:{ AZ:"Filtrləri təmizlə", TR:"Filtreleri temizle", RU:"Сбросить фильтры", EN:"Clear filters" },
    dev_th_id:{ AZ:"Cihaz no", TR:"Cihaz no", RU:"№ прибора", EN:"Device no" },
    dev_th_kind:{ AZ:"Növ", TR:"Tür", RU:"Тип", EN:"Type" },
    dev_th_loc:{ AZ:"Yer", TR:"Konum", RU:"Расположение", EN:"Location" },
    dev_th_status:{ AZ:"Vəziyyət", TR:"Durum", RU:"Статус", EN:"Status" },
    dev_th_pm:{ AZ:"Texniki xidmət", TR:"Bakım", RU:"Обслуживание", EN:"Maintenance" },
    dev_th_cal:{ AZ:"Kalibrləmə", TR:"Kalibrasyon", RU:"Калибровка", EN:"Calibration" },
    dev_th_conn:{ AZ:"Bağlantı", TR:"Bağlantı", RU:"Подключение", EN:"Connection" },
    dev_risk_tpl:{ AZ:"risk: {v}", TR:"risk: {v}", RU:"риск: {v}", EN:"risk: {v}" },
    dev_no_match:{ AZ:"Bu filtrə uyğun cihaz yoxdur.", TR:"Bu filtreye uyan cihaz yok.", RU:"Нет приборов, соответствующих этому фильтру.", EN:"No devices match this filter." },
    dev_last_tpl:{ AZ:"son: {v}", TR:"son: {v}", RU:"последний: {v}", EN:"last: {v}" },
    dev_not_required:{ AZ:"gərək deyil", TR:"gerekmez", RU:"не требуется", EN:"not required" },
    dev_conn_no_net:{ AZ:"şəbəkəyə bağlı deyil", TR:"ağa bağlı değil", RU:"не подключён к сети", EN:"not on network" },
    dev_conn_connected:{ AZ:"Bağlı", TR:"Bağlı", RU:"Подключён", EN:"Connected" },
    dev_last_data_tpl:{ AZ:"son məlumat {v}", TR:"son veri {v}", RU:"последние данные {v}", EN:"last data {v}" },
    dev_conn_silent:{ AZ:"Səssiz", TR:"Sessiz", RU:"Молчит", EN:"Silent" },
    dev_conn_offline:{ AZ:"Oflayn", TR:"Çevrim dışı", RU:"Не в сети", EN:"Offline" },
    dev_last_seen_tpl:{ AZ:"son görülmə {v}", TR:"son görülme {v}", RU:"последний раз в сети {v}", EN:"last seen {v}" },
    dev_view_calendar:{ AZ:"Təqvim", TR:"Takvim", RU:"Календарь", EN:"Calendar" },
    dev_view_list:{ AZ:"Siyahı", TR:"Liste", RU:"Список", EN:"List" },
    dev_late_days_tpl:{ AZ:"{n} gün gecikdi", TR:"{n} gün gecikti", RU:"просрочено на {n} дн.", EN:"{n} days overdue" },
    dev_today_word:{ AZ:"bu gün", TR:"bugün", RU:"сегодня", EN:"today" },
    dev_tomorrow_word:{ AZ:"sabah", TR:"yarın", RU:"завтра", EN:"tomorrow" },
    dev_in_days_tpl:{ AZ:"{n} gün", TR:"{n} gün", RU:"через {n} дн.", EN:"in {n} days" },
    dev_no_pm_month:{ AZ:"Bu ay qeydiyyatda texniki xidmət yoxdur.", TR:"Bu ay kayıtlı bakım yok.", RU:"В этом месяце нет запланированного обслуживания.", EN:"No maintenance recorded this month." },
    dev_and_today:{ AZ:" · bu gün", TR:" · bugün", RU:" · сегодня", EN:" · today" },
    dev_prev_month:{ AZ:"Əvvəlki ay", TR:"Önceki ay", RU:"Предыдущий месяц", EN:"Previous month" },
    dev_next_month:{ AZ:"Sonrakı ay", TR:"Sonraki ay", RU:"Следующий месяц", EN:"Next month" },
    dev_footnote_calendar:{ AZ:"Dövri texniki xidmət və kalibrləmə birlikdə sayılır. İstifadədən çıxarılmış cihazlar təqvimə düşmür.",
      TR:"Periyodik bakım ve kalibrasyon birlikte sayılır. Kullanım dışı cihazlar takvime girmez.",
      RU:"Плановое обслуживание и калибровка учитываются вместе. Приборы, выведенные из эксплуатации, в календарь не включаются.",
      EN:"Scheduled maintenance and calibration are counted together. Out-of-service devices don't appear on the calendar." },
    dev_pick_day:{ AZ:"Gün seçin", TR:"Gün seçin", RU:"Выберите день", EN:"Pick a day" },
    dev_jobs_tpl:{ AZ:"{n} iş", TR:"{n} iş", RU:"{n} задач", EN:"{n} jobs" },
    dev_no_records_day:{ AZ:"Bu gün üçün qeyd yoxdur.", TR:"Bu gün için kayıt yok.", RU:"На этот день записей нет.", EN:"No records for this day." },
    dev_tap_a_day:{ AZ:"Təqvimdə bir günə toxunun.", TR:"Takvimde bir güne dokunun.", RU:"Нажмите на день в календаре.", EN:"Tap a day on the calendar." },
    dev_sec_late:{ AZ:"Gecikənlər", TR:"Gecikenler", RU:"Просроченные", EN:"Overdue items" },
    dev_no_late:{ AZ:"Gecikmiş texniki xidmət yoxdur.", TR:"Gecikmiş bakım yok.", RU:"Просроченного обслуживания нет.", EN:"No overdue maintenance." },
    dev_wo_client_note:{ AZ:"Klinik heyət yataq başından nasazlıq bildirə bilər; bildirişlər buraya düşür. Qeyddə heyət adı görünür, xəstə məlumatı daxil edilmir.",
      TR:"Klinik personel yatak başından arıza bildirebilir; bildirimler buraya düşer. Kayıtta personel adı görünür, hasta bilgisi girilmez.",
      RU:"Клинический персонал может сообщить о неисправности от койки пациента; уведомления попадают сюда. В записи видно имя сотрудника, данные пациента не вводятся.",
      EN:"Clinical staff can report a fault from the bedside; reports land here. The record shows the staff member's name; no patient information is entered." },
    dev_wof_active_tpl:{ AZ:"Açıq + təyin olunmuş · {n}", TR:"Açık + atanmış · {n}", RU:"Открытые + назначенные · {n}", EN:"Open + assigned · {n}" },
    dev_wof_unassigned_tpl:{ AZ:"Təyin olunmamış · {n}", TR:"Atanmamış · {n}", RU:"Не назначено · {n}", EN:"Unassigned · {n}" },
    dev_wof_assigned:{ AZ:"Təyin olunmuş", TR:"Atanmış", RU:"Назначено", EN:"Assigned" },
    dev_wof_closed:{ AZ:"Bağlanan", TR:"Kapanan", RU:"Закрытые", EN:"Closed" },
    dev_priority_suffix:{ AZ:"prioritet", TR:"öncelik", RU:"приоритет", EN:"priority" },
    dev_assignee_tpl:{ AZ:"təyin olunan: {who}", TR:"atanan: {who}", RU:"назначен: {who}", EN:"assignee: {who}" },
    dev_closed_at_tpl:{ AZ:"bağlandı {v}", TR:"kapandı {v}", RU:"закрыто {v}", EN:"closed {v}" },
    dev_btn_take:{ AZ:"Öz üzərinə götür", TR:"Üstlen", RU:"Взять в работу", EN:"Take" },
    dev_btn_send_service:{ AZ:"Səlahiyyətli servisə göndər", TR:"Yetkili servise gönder", RU:"Отправить в авторизованный сервис", EN:"Send to authorized service" },
    dev_btn_close_wo:{ AZ:"Bağla", TR:"Kapat", RU:"Закрыть", EN:"Close" },
    dev_btn_reopen:{ AZ:"Yenidən aç", TR:"Yeniden aç", RU:"Открыть заново", EN:"Reopen" },
    dev_btn_open_device:{ AZ:"Cihazı aç", TR:"Cihazı aç", RU:"Открыть прибор", EN:"Open device" },
    dev_no_match_filter:{ AZ:"Bu filtrdə qeyd yoxdur.", TR:"Bu filtrede kayıt yok.", RU:"В этом фильтре записей нет.", EN:"No records in this filter." },
    dev_unit_summary_tpl:{ AZ:"{rooms} sahə · {beds} çarpayı ({occ} dolu, {free} boş) · {dev} cihaz", TR:"{rooms} alan · {beds} yatak ({occ} dolu, {free} boş) · {dev} cihaz",
      RU:"зон: {rooms} · коек: {beds} (занято {occ}, свободно {free}) · приборов: {dev}", EN:"{rooms} areas · {beds} beds ({occ} occupied, {free} free) · {dev} devices" },
    dev_room_beds_tpl:{ AZ:"{n} çarpayı · ", TR:"{n} yatak · ", RU:"коек: {n} · ", EN:"{n} beds · " },
    dev_room_devs_tpl:{ AZ:"{n} cihaz", TR:"{n} cihaz", RU:"приборов: {n}", EN:"{n} devices" },
    dev_code_tpl:{ AZ:"Kod {v}", TR:"Kod {v}", RU:"Код {v}", EN:"Code {v}" },
    dev_iso_suffix:{ AZ:" · izolyasiya", TR:" · izolasyon", RU:" · изоляция", EN:" · isolation" },
    dev_maint_late_tpl:{ AZ:"{n} cihazın texniki xidməti gecikib", TR:"{n} cihazın bakımı gecikmiş", RU:"обслуживание {n} приборов просрочено", EN:"maintenance overdue on {n} devices" },
    dev_room_word:{ AZ:"Otaq", TR:"Oda", RU:"Палата", EN:"Room" },
    dev_no_devices_here:{ AZ:"Qeydiyyatlı cihaz yoxdur.", TR:"Kayıtlı cihaz yok.", RU:"Зарегистрированных приборов нет.", EN:"No registered devices." },
    dev_footnote_beds:{ AZ:"Çarpayı üçün yalnız doluluq vəziyyəti göstərilir; bu ekranda xəstə məlumatı yoxdur.",
      TR:"Yatak için yalnız doluluk durumu gösterilir; hasta bilgisi bu ekranda yoktur.",
      RU:"Для койки показывается только статус занятости; данные пациента на этом экране отсутствуют.",
      EN:"Only occupancy status is shown for a bed; there is no patient information on this screen." },
    dev_here_tag:{ AZ:"gecikmiş", TR:"gecikmiş", RU:"просрочено", EN:"overdue" },
    dev_this_week_tag:{ AZ:"bu həftə", TR:"bu hafta", RU:"на этой неделе", EN:"this week" },
    dev_silent_tag:{ AZ:"səssiz", TR:"sessiz", RU:"молчит", EN:"silent" },
    dev_maint_title:{ AZ:"texniki xidmət", TR:"bakım", RU:"обслуживание", EN:"maintenance" },
    dev_out_of_service:{ AZ:"istifadədən çıxarılıb", TR:"kullanım dışı", RU:"выведен из эксплуатации", EN:"out of service" },
    dev_wo_open_tpl:{ AZ:"{n} açıq nasazlıq qeydi: {list}", TR:"{n} açık arıza kaydı: {list}", RU:"{n} открытых записей о неисправности: {list}", EN:"{n} open fault records: {list}" },
    dev_silent_note_tpl:{ AZ:"Monitor {n} dəqiqədir mərkəzə məlumat göndərmir (son məlumat {v}).",
      TR:"Monitör {n} dakikadır merkeze veri göndermiyor (son veri {v}).",
      RU:"Монитор {n} мин. не передаёт данные на центральный пост (последние данные {v}).",
      EN:"The monitor hasn't sent data to the central station for {n} minutes (last data {v})." },
    dev_box_identity:{ AZ:"Kimlik", TR:"Kimlik", RU:"Идентификация", EN:"Identity" },
    dev_kv_id:{ AZ:"Cihaz no", TR:"Cihaz no", RU:"№ прибора", EN:"Device no" },
    dev_kv_kind:{ AZ:"Növ", TR:"Tür", RU:"Тип", EN:"Type" },
    dev_kv_serial:{ AZ:"Seriya no", TR:"Seri no", RU:"Серийный №", EN:"Serial no" },
    dev_kv_risk:{ AZ:"Risk sinfi", TR:"Risk sınıfı", RU:"Класс риска", EN:"Risk class" },
    dev_kv_interval_tpl:{ AZ:"{n} ayda bir", TR:"{n} ayda bir", RU:"раз в {n} мес.", EN:"every {n} months" },
    dev_kv_pm_interval:{ AZ:"Texniki xidmət aralığı", TR:"Bakım aralığı", RU:"Интервал обслуживания", EN:"Maintenance interval" },
    dev_kv_battery:{ AZ:"Batareya", TR:"Batarya", RU:"Заряд батареи", EN:"Battery" },
    dev_kv_network:{ AZ:"Şəbəkə bağlantısı", TR:"Ağ bağlantısı", RU:"Сетевое подключение", EN:"Network connection" },
    dev_net_none:{ AZ:"yoxdur", TR:"yok", RU:"нет", EN:"none" },
    dev_net_connected_tpl:{ AZ:"bağlı · {v}", TR:"bağlı · {v}", RU:"подключён · {v}", EN:"connected · {v}" },
    dev_net_none_last_tpl:{ AZ:"yoxdur · son {v}", TR:"yok · son {v}", RU:"нет · последний раз {v}", EN:"none · last {v}" },
    dev_box_location:{ AZ:"Yer", TR:"Konum", RU:"Расположение", EN:"Location" },
    dev_kv_block:{ AZ:"Blok", TR:"Blok", RU:"Корпус", EN:"Block" },
    dev_kv_floor:{ AZ:"Mərtəbə", TR:"Kat", RU:"Этаж", EN:"Floor" },
    dev_kv_unit:{ AZ:"Bölmə", TR:"Birim", RU:"Отделение", EN:"Unit" },
    dev_kv_room:{ AZ:"Otaq / sahə", TR:"Oda / alan", RU:"Палата / зона", EN:"Room / area" },
    dev_kv_bed:{ AZ:"Çarpayı", TR:"Yatak", RU:"Койка", EN:"Bed" },
    dev_assigned_to_room:{ AZ:"otağa təyin olunub", TR:"odaya atanmış", RU:"назначен палате", EN:"assigned to room" },
    dev_no_patient_screen:{ AZ:"Xəstə məlumatı bu ekranda göstərilmir.", TR:"Hasta bilgisi bu ekranda gösterilmez.", RU:"Данные пациента на этом экране не отображаются.", EN:"Patient information is not shown on this screen." },
    dev_box_pm:{ AZ:"Dövri texniki xidmət", TR:"Periyodik bakım", RU:"Плановое обслуживание", EN:"Scheduled maintenance" },
    dev_kv_last_pm:{ AZ:"Son texniki xidmət", TR:"Son bakım", RU:"Последнее обслуживание", EN:"Last maintenance" },
    dev_kv_next_pm:{ AZ:"Növbəti texniki xidmət", TR:"Sonraki bakım", RU:"Следующее обслуживание", EN:"Next maintenance" },
    dev_kv_status:{ AZ:"Vəziyyət", TR:"Durum", RU:"Статус", EN:"Status" },
    dev_on_time:{ AZ:"vaxtındadır", TR:"zamanında", RU:"в срок", EN:"on time" },
    dev_box_cal:{ AZ:"Kalibrləmə", TR:"Kalibrasyon", RU:"Калибровка", EN:"Calibration" },
    dev_kv_last_cal:{ AZ:"Son kalibrləmə", TR:"Son kalibrasyon", RU:"Последняя калибровка", EN:"Last calibration" },
    dev_kv_next:{ AZ:"Növbəti", TR:"Sonraki", RU:"Следующая", EN:"Next" },
    dev_kv_cert:{ AZ:"Sertifikat no", TR:"Sertifika no", RU:"№ сертификата", EN:"Certificate no" },
    dev_kv_doneby:{ AZ:"Edən", TR:"Yapan", RU:"Кто выполнил", EN:"Performed by" },
    dev_kv_result:{ AZ:"Nəticə", TR:"Sonuç", RU:"Результат", EN:"Result" },
    dev_result_ok:{ AZ:"Uyğundur", TR:"Uygun", RU:"Соответствует", EN:"Pass" },
    dev_no_cal_needed:{ AZ:"Bu cihaz növü kalibrləmə tələb etmir.", TR:"Bu cihaz türü kalibrasyon gerektirmez.", RU:"Этот тип прибора не требует калибровки.", EN:"This device type does not require calibration." },
    dev_sec_history:{ AZ:"Texniki xidmət tarixçəsi", TR:"Bakım geçmişi", RU:"История обслуживания", EN:"Maintenance history" },
    dev_records_tpl:{ AZ:"{n} qeyd", TR:"{n} kayıt", RU:"{n} записей", EN:"{n} records" },
    dev_maint_perm_note:{ AZ:"Texniki xidmət qeydi və yer dəyişikliyi üçün \"maintenance\" icazəsi lazımdır.",
      TR:"Bakım kaydı ve konum değişikliği için \"maintenance\" yetkisi gerekir.",
      RU:"Для записи обслуживания и изменения местоположения требуется право «maintenance».",
      EN:"Recording maintenance and changing location require the \"maintenance\" permission." },
    dev_btn_open_wo:{ AZ:"Nasazlıq qeydi aç", TR:"Arıza kaydı aç", RU:"Открыть запись о неисправности", EN:"Open fault record" },
    dev_btn_move:{ AZ:"Yerini dəyiş", TR:"Konum değiştir", RU:"Изменить местоположение", EN:"Change location" },
    dev_btn_mark_done:{ AZ:"Texniki xidməti edilmiş kimi işarələ", TR:"Bakım yapıldı olarak işaretle", RU:"Отметить обслуживание выполненным", EN:"Mark maintenance as done" },
    dev_modal_maint_tpl:{ AZ:"Texniki xidmət qeydi · {id}", TR:"Bakım kaydı · {id}", RU:"Запись обслуживания · {id}", EN:"Maintenance record · {id}" },
    dev_field_worktype:{ AZ:"Görülən iş", TR:"Yapılan iş", RU:"Выполненная работа", EN:"Work performed" },
    dev_opt_pm_only:{ AZ:"Dövri texniki xidmət", TR:"Periyodik bakım", RU:"Плановое обслуживание", EN:"Scheduled maintenance" },
    dev_opt_both:{ AZ:"Texniki xidmət + kalibrləmə", TR:"Bakım + kalibrasyon", RU:"Обслуживание + калибровка", EN:"Maintenance + calibration" },
    dev_field_date:{ AZ:"Tarix", TR:"Tarih", RU:"Дата", EN:"Date" },
    dev_field_result:{ AZ:"Nəticə", TR:"Sonuç", RU:"Результат", EN:"Result" },
    dev_result_fail:{ AZ:"Uyğun deyil", TR:"Uygun değil", RU:"Не соответствует", EN:"Fail" },
    dev_field_note:{ AZ:"Qeyd", TR:"Not", RU:"Заметка", EN:"Note" },
    dev_note_ph_maint:{ AZ:"Aparılan testlər, dəyişən hissə…", TR:"Yapılan testler, değişen parça…", RU:"Проведённые тесты, заменённая деталь…", EN:"Tests performed, part replaced…" },
    dev_maint_footnote_tpl:{ AZ:"Qeyd auditə yazılır. Növbəti texniki xidmət tarixi {n} ay irəli aparılır{cal}. \"Uyğun deyil\" seçilsə cihaz nasaz kimi işarələnir.",
      TR:"Kayıt denetim kaydına yazılır. Sonraki bakım tarihi {n} ay ileri alınır{cal}. \"Uygun değil\" seçilirse cihaz arızalı olarak işaretlenir.",
      RU:"Запись фиксируется в журнале аудита. Следующая дата обслуживания переносится на {n} мес. вперёд{cal}. Если выбрано «Не соответствует», прибор помечается неисправным.",
      EN:"The record is logged for audit. The next maintenance date moves forward {n} months{cal}. If \"Fail\" is selected, the device is marked faulty." },
    dev_maint_footnote_cal:{ AZ:", kalibrləmədə 12 ay", TR:", kalibrasyonda 12 ay", RU:", при калибровке — 12 мес.", EN:", 12 months for calibration" },
    dev_date_err:{ AZ:"Tarix boş və ya gələcək gün ola bilməz.", TR:"Tarih boş ya da ileri bir gün olamaz.", RU:"Дата пуста или указывает на будущее.", EN:"The date is empty or is in the future." },
    dev_saved_next_tpl:{ AZ:"{id} · texniki xidmət qeydə alındı · növbəti {v}{fail}", TR:"{id} · bakım işlendi · sonraki bakım {v}{fail}", RU:"{id} · обслуживание внесено · следующее {v}{fail}", EN:"{id} · maintenance logged · next {v}{fail}" },
    dev_marked_faulty_suffix:{ AZ:" · cihaz nasaz kimi işarələndi", TR:" · cihaz arızalı işaretlendi", RU:" · прибор помечен неисправным", EN:" · device marked faulty" },
    dev_modal_move_tpl:{ AZ:"Yerini dəyiş · {id}", TR:"Konum değiştir · {id}", RU:"Изменить местоположение · {id}", EN:"Change location · {id}" },
    dev_now_at_tpl:{ AZ:"Hazırda: {v}", TR:"Şu an: {v}", RU:"Сейчас: {v}", EN:"Currently: {v}" },
    dev_field_unit:{ AZ:"Bölmə", TR:"Birim", RU:"Отделение", EN:"Unit" },
    dev_field_room:{ AZ:"Otaq / sahə", TR:"Oda / alan", RU:"Палата / зона", EN:"Room / area" },
    dev_move_note:{ AZ:"Daşına bilən cihaz otağa təyin olunur, çarpayıya bağlanmır. \"Anbar\" seçilsə vəziyyəti \"Anbarda\" olur.",
      TR:"Taşınabilir cihaz odaya atanır, yatağa bağlanmaz. \"Depo\" seçilirse durumu \"Depoda\" olur.",
      RU:"Портативный прибор назначается палате, а не койке. Если выбрано «Склад», статус становится «На складе».",
      EN:"A portable device is assigned to a room, not a bed. If \"Storage\" is selected, its status becomes \"In storage\"." },
    dev_btn_move_do:{ AZ:"Daşı", TR:"Taşı", RU:"Переместить", EN:"Move" },
    dev_same_location:{ AZ:"Yer eynidir.", TR:"Konum aynı.", RU:"Местоположение не изменилось.", EN:"Location is unchanged." },
    dev_moved_tpl:{ AZ:"{id} daşındı → {v}", TR:"{id} taşındı → {v}", RU:"{id} перемещён → {v}", EN:"{id} moved → {v}" },
    dev_modal_wo:{ AZ:"Nasazlıq qeydi aç", TR:"Arıza kaydı aç", RU:"Открыть запись о неисправности", EN:"Open a fault record" },
    dev_field_device:{ AZ:"Cihaz", TR:"Cihaz", RU:"Прибор", EN:"Device" },
    dev_search_ph_wo:{ AZ:"Cihaz no, növ, otaq və ya çarpayı no…", TR:"Cihaz no, tür, oda ya da yatak no…", RU:"№ прибора, тип, палата или № койки…", EN:"Device no, type, room or bed no…" },
    dev_no_match_device:{ AZ:"Uyğun cihaz yoxdur.", TR:"Eşleşen cihaz yok.", RU:"Совпадающих приборов нет.", EN:"No matching device." },
    dev_field_priority:{ AZ:"Prioritet", TR:"Öncelik", RU:"Приоритет", EN:"Priority" },
    dev_field_desc:{ AZ:"Açıqlama", TR:"Açıklama", RU:"Описание", EN:"Description" },
    dev_desc_ph:{ AZ:"Cihazın problemi: nə olur, nə vaxtdan bəri…", TR:"Cihazın sorunu: ne oluyor, ne zamandır…", RU:"Проблема прибора: что происходит, с какого времени…", EN:"The device's problem: what's happening, since when…" },
    dev_ck_pull:{ AZ:"Cihazı nasaz kimi işarələ (istifadədən çıxarılır)", TR:"Cihazı arızalı olarak işaretle (kullanımdan çekilir)", RU:"Отметить прибор неисправным (снимается с эксплуатации)", EN:"Mark device as faulty (taken out of service)" },
    dev_wo_privacy_note:{ AZ:"Açıqlamaya xəstə adı və ya klinik məlumat yazmayın; yalnız cihazın problemini yazın.",
      TR:"Açıklamaya hasta adı ya da klinik bilgi yazmayın; yalnız cihazın sorununu yazın.",
      RU:"Не указывайте в описании имя пациента или клиническую информацию; пишите только о проблеме прибора.",
      EN:"Do not put a patient's name or clinical information in the description; describe only the device's problem." },
    dev_btn_open_record:{ AZ:"Nasazlığı qeydə al", TR:"Arızayı aç", RU:"Зарегистрировать неисправность", EN:"Report fault" },
    dev_select_device:{ AZ:"Cihaz seçin.", TR:"Cihaz seçin.", RU:"Выберите прибор.", EN:"Select a device." },
    dev_desc_too_short:{ AZ:"Qısa bir açıqlama yazın.", TR:"Kısa bir açıklama yazın.", RU:"Напишите краткое описание.", EN:"Write a short description." },
    dev_wo_opened_tpl:{ AZ:"{id} açıldı · {dev}", TR:"{id} açıldı · {dev}", RU:"{id} открыт · {dev}", EN:"{id} opened · {dev}" },
    dev_modal_close_wo_tpl:{ AZ:"Qeydi bağla · {id}", TR:"Kaydı kapat · {id}", RU:"Закрыть запись · {id}", EN:"Close record · {id}" },
    dev_field_action:{ AZ:"Görülən iş", TR:"Yapılan işlem", RU:"Выполненное действие", EN:"Action taken" },
    dev_action_ph:{ AZ:"Nə edildi, hansı test tətbiq olundu…", TR:"Ne yapıldı, hangi test uygulandı…", RU:"Что сделано, какой тест применён…", EN:"What was done, which test was applied…" },
    dev_ck_ready:{ AZ:"Cihaz yenidən istifadəyə hazırdır (vəziyyət: işləyir)", TR:"Cihaz tekrar kullanıma hazır (durum: çalışıyor)", RU:"Прибор снова готов к использованию (статус: работает)", EN:"Device is ready for use again (status: working)" },
    dev_action_required:{ AZ:"Görülən işi yazın.", TR:"Yapılan işlemi yazın.", RU:"Опишите выполненное действие.", EN:"Describe the action taken." },
    dev_wo_closed_tpl:{ AZ:"{id} bağlandı.", TR:"{id} kapatıldı.", RU:"{id} закрыт.", EN:"{id} closed." },
    dev_system_auto:{ AZ:"Sistem (avtomatik)", TR:"Sistem (otomatik)", RU:"Система (автоматически)", EN:"System (automatic)" },
    dev_toast_assigned_you:{ AZ:"sizə təyin olundu", TR:"size atandı", RU:"назначено вам", EN:"assigned to you" },
    dev_toast_assigned_to_tpl:{ AZ:"{who} şəxsinə göndərildi", TR:"{who} kişisine gönderildi", RU:"отправлено: {who}", EN:"sent to {who}" },
    dev_battery_pct_tpl:{ AZ:"batareya %{v}", TR:"batarya %{v}", RU:"заряд {v}%", EN:"battery {v}%" },
    // 24.09 (4. oturum) · takvim/arıza/odalar sekmeleri ve beş pencere
    dev_rm_nurse:{ AZ:"Tibb bacısı postu", TR:"Hemşire istasyonu", RU:"Сестринский пост", EN:"Nurses' station" },
    dev_rm_store:{ AZ:"Anbar", TR:"Depo", RU:"Склад", EN:"Storage" },
    dev_rm_cart:{ AZ:"Dəhliz · təcili yardım arabası", TR:"Koridor · acil arabası", RU:"Коридор · реанимационная тележка", EN:"Corridor · crash cart" },
    dev_rm_obs:{ AZ:"Müşahidə", TR:"Gözlem", RU:"Наблюдение", EN:"Observation" },
    dev_ago_sec_tpl:{ AZ:"{n} san əvvəl", TR:"{n} sn önce", RU:"{n} с назад", EN:"{n} s ago" },
    dev_ago_min_tpl:{ AZ:"{n} dəq əvvəl", TR:"{n} dk önce", RU:"{n} мин назад", EN:"{n} min ago" },
    dev_just_now:{ AZ:"indicə", TR:"az önce", RU:"только что", EN:"just now" },
    dev_yesterday_tpl:{ AZ:"dünən {v}", TR:"dün {v}", RU:"вчера {v}", EN:"yesterday {v}" },
    dev_auth_service:{ AZ:"Səlahiyyətli servis", TR:"Yetkili servis", RU:"Авторизованный сервис", EN:"Authorized service" },
    dev_not_found_tpl:{ AZ:"Cihaz tapılmadı: {id}", TR:"Cihaz bulunamadı: {id}", RU:"Прибор не найден: {id}", EN:"Device not found: {id}" },
    dev_pct_tpl:{ AZ:"%{v}", TR:"%{v}", RU:"{v}%", EN:"{v}%" },
    dev_btn_log_maint:{ AZ:"Texniki xidməti qeydə al", TR:"Bakımı işle", RU:"Внести обслуживание", EN:"Log maintenance" },
    dev_btn_close_record:{ AZ:"Qeydi bağla", TR:"Kaydı kapat", RU:"Закрыть запись", EN:"Close record" },
    dev_day_jobs_aria_tpl:{ AZ:"{date} · {n} iş", TR:"{date} · {n} iş", RU:"{date} · задач: {n}", EN:"{date} · {n} jobs" },
  });
  const devTpl = (key, vals) => Object.entries(vals || {}).reduce((s, [k, v]) => s.split("{" + k + "}").join(v), H.t(key));
  const locTag = () => ({ AZ:"az", TR:"tr", RU:"ru", EN:"en" }[H.state.lang] || "tr");

  /* ================= stil (yalnız bu modül) ================= */
  const css = `
.dv-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.dv-bar select,.dv-bar input{width:auto;flex:1 1 150px;min-width:0;max-width:230px}
.dv-bar .dv-q{max-width:280px}
.dv-chip{display:inline-flex;align-items:center;gap:6px;font:600 12px Figtree;padding:5px 9px;border-radius:999px;background:var(--priSoft);color:var(--pri);cursor:pointer;border:0}
.dv-chip svg{width:13px;height:13px}
.dv-st{display:inline-flex;align-items:center;gap:6px;font:600 12px Figtree;white-space:nowrap;color:var(--ink)}
.dv-st::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--c);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent)}
.dv-due{font:600 12px "JetBrains Mono";white-space:nowrap}
.dv-due.late{color:var(--crit)}.dv-due.week{color:var(--attInk)}.dv-due.ok{color:var(--mute)}.dv-due.done{color:var(--ok)}
.dv-sub{display:block;font-size:11.5px;color:var(--mute);font-weight:500}
.dv-t{min-width:820px}
.dv-t td{vertical-align:top}
.dv-list{display:grid;gap:6px}
.dv-it{display:grid;grid-template-columns:4px minmax(0,1fr) auto;gap:10px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:9px 12px;cursor:pointer;min-width:0}
.dv-it:hover{border-color:var(--line2)}
.dv-it>i{align-self:stretch;border-radius:2px;background:var(--c)}
.dv-it>div{min-width:0}
.dv-it b{font-size:13.5px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dv-grp{font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:12px 0 6px}
.dv-grp:first-child{margin-top:0}
.att.dv-att{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.dv-split{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px;align-items:start}
.dv-split>*{min-width:0}
.dv-bars{display:grid;gap:7px}
.dv-bars div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;font-size:13px}
.dv-bars em{grid-column:1/-1;height:6px;border-radius:99px;background:var(--card2);overflow:hidden;display:block}
.dv-bars em i{display:block;height:100%;background:var(--c);border-radius:99px}
.dv-calw{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:14px;align-items:start}
.dv-calw>*{min-width:0}
.dv-calh{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.dv-calh .m{font:700 16px "Space Grotesk";min-width:112px;text-align:center}
.dv-lg{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--mute);margin-left:auto}
.dv-lg span{display:inline-flex;align-items:center;gap:5px}
.dv-lg span::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--c)}
.dv-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.dv-grid .h{font:700 10.5px Figtree;color:var(--mute);text-transform:uppercase;text-align:center;padding:2px 0 4px;letter-spacing:.05em}
.dv-day{min-height:74px;border:1px solid var(--line);border-radius:10px;background:var(--card);padding:5px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0;text-align:left;font:inherit;color:var(--ink)}
.dv-day:hover{border-color:var(--line2)}
.dv-day.x{background:transparent;border-style:dashed;opacity:.35;cursor:default}
.dv-day.we{background:var(--card2)}
.dv-day.today{border-color:var(--pri);box-shadow:inset 0 0 0 1px var(--pri)}
.dv-day.sel{background:var(--priSoft);border-color:var(--pri)}
.dv-day .n{font:700 12px "JetBrains Mono"}
.dv-dots{display:flex;flex-wrap:wrap;gap:3px 7px;font:600 11px "JetBrains Mono"}
.dv-dots span{display:inline-flex;align-items:center;gap:3px}
.dv-dots span::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--c);flex:none}
.dv-rooms{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.dv-room{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;min-width:0}
.dv-room h6{margin:0 0 8px;font:700 14px "Space Grotesk";display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dv-room h6 small{margin-left:auto;font:600 11px Figtree;color:var(--mute)}
.dv-beds{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.dv-bd{--c:var(--mute);border:1.5px solid color-mix(in srgb,var(--c) 55%,transparent);background:color-mix(in srgb,var(--c) 12%,var(--card));border-radius:9px;padding:4px 8px;font:700 12px "JetBrains Mono";min-width:64px}
.dv-bd small{display:block;font:600 10.5px Figtree;color:var(--mute)}
.dv-dev{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px dashed var(--line);font-size:12.5px;cursor:pointer;min-width:0}
.dv-dev:hover .nm{color:var(--pri)}
.dv-dev>svg{width:15px;height:15px;color:var(--mute);flex:none}
.dv-dev .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dv-dev .dv-st{font-size:0;gap:0}
.dv-wo{display:grid;grid-template-columns:4px minmax(0,1fr);gap:12px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:8px}
.dv-wo>i{border-radius:2px;background:var(--c)}
.dv-wo.closed{opacity:.7}
.dv-wot{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dv-wot time{margin-left:auto;font:600 11.5px "JetBrains Mono";color:var(--mute)}
.dv-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
.dv-g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dv-g2>*{min-width:0}
.dv-mh{display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.dv-mh>svg{width:34px;height:34px;padding:7px;border-radius:10px;background:var(--card2);color:var(--pri);flex:none}
.dv-mh b{font:700 16px "Space Grotesk";display:block}
.dv-mh .dv-st{margin-left:auto}
.dv-hist{display:grid;gap:0}
.dv-hist div{display:grid;grid-template-columns:92px minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px dashed var(--line);font-size:12.5px}
.dv-hist div:last-child{border:0}
.dv-hist time{font:600 12px "JetBrains Mono";color:var(--mute)}
.dv-mf{flex-wrap:wrap}
.dv-ck{display:flex;gap:8px;align-items:flex-start;font-size:13px;cursor:pointer;margin:8px 0}
.dv-ck input{width:16px!important;height:16px;padding:0;margin:2px 0 0;accent-color:var(--pri);flex:none}
.dv-pick{max-height:220px;overflow:auto;border:1px solid var(--line2);border-radius:10px;background:var(--card2);margin-top:6px}
.dv-pick div{padding:7px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid var(--line)}
.dv-pick div:last-child{border:0}
.dv-pick div:hover{background:var(--card)}
.dv-pick div.on{background:var(--priSoft);color:var(--pri);font-weight:700}
.dv-err label{color:var(--crit)!important}
@media(max-width:1100px){.dv-calw{grid-template-columns:1fr}}
@media(max-width:860px){.dv-split,.dv-g2{grid-template-columns:1fr}}
@media(max-width:640px){
  .dv-bar select,.dv-bar input,.dv-bar .dv-q{max-width:none;flex:1 1 100%}
  .dv-grid{gap:2px}.dv-day{min-height:48px;padding:4px 3px;border-radius:7px;gap:3px}
  .dv-dots{font-size:0;gap:2px}.dv-dots span{gap:0}.dv-dots span::before{width:6px;height:6px}
  .dv-lg{margin-left:0;width:100%}
  .dv-hist div{grid-template-columns:1fr;gap:2px}
}
`;
  const st = document.createElement("style"); st.id = "dv-css"; st.textContent = css; document.head.appendChild(st);

  /* ================= tarih yardımcıları (bugün 24.09.2026) ================= */
  const TODAY = H.isoD(H.clockDate());   // 30.09c: gerçek takvim günü (bakım tarihleri buna göre üretilir)
  const M0 = H.clockDate().getMonth(), Y0 = H.clockDate().getFullYear();
  // yazılmış "dün 16:20" gibi son görülme → kaydırılır; takvimde yine dünse "dün HH:MM", değilse tarihli
  const seenAgo = (hm, dayOff) => { const d = new Date(+H.atD(hm) + dayOff * 864e5), c = H.dOff(d) - H.calOff(); return c === 0 ? H.hm(d) : c === -1 ? `dün ${H.hm(d)}` : `${H.dm(H.dOff(d))} ${H.hm(d)}`; };
  const pd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
  const addM = (s, n) => { const d = pd(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return iso(d); };
  const diff = (s) => Math.round((pd(s) - pd(TODAY)) / 864e5);
  const fmt = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "—";
  const fmtS = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : "—";
  // MONTHS/DAYS: fonksiyon — her çağrıda güncel dilde yeniden üretilir (dil değişince sabitlenmesin diye).
  const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTHS = () => MONTH_KEYS.map(k => H.t("dev_month_" + k));
  const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const DAYS = () => DAY_KEYS.map(k => H.t("dev_day_" + k));
  const WD_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const WEEK_HEAD = () => WD_KEYS.map(k => H.t("dev_wd_" + k));

  /* ================= katalog ================= *
   * pm: periyodik bakım aralığı (ay) · cal: kalibrasyon aralığı (ay, null = kalibrasyon yok)
   * net: ağa bağlı monitör · bat: bataryalı · mob: taşınabilir (konum değiştirilebilir)
   * n alanı Türkçe kalır (dahili varsayılan / H.DEVICE_KINDS dışa aktarımı); ekranda K(d).n çağrıldığında
   * KIND_KEY üzerinden anlık çevrilir — bkz. K() fonksiyonu aşağıda. */
  const KINDS = {
    mon:   { n:"Hasta başı monitör",       c:"MN", i:"activity", pm:6,  cal:12,   risk:"orta",   net:true },
    vent:  { n:"Ventilatör",               c:"VN", i:"cpu",      pm:6,  cal:12,   risk:"yüksek" },
    inf:   { n:"İnfüzyon pompası",         c:"IP", i:"drop",     pm:6,  cal:12,   risk:"orta",   mob:true },
    syr:   { n:"Şırınga pompası",          c:"SP", i:"syringe",  pm:6,  cal:12,   risk:"orta",   mob:true },
    defib: { n:"Defibrilatör",             c:"DF", i:"zap",      pm:6,  cal:12,   risk:"yüksek", bat:true },
    port:  { n:"Portatif vital monitör",   c:"PV", i:"tablet",   pm:12, cal:12,   risk:"orta",   net:true, bat:true, mob:true },
    kuv:   { n:"Küvöz",                    c:"KV", i:"thermo",   pm:6,  cal:12,   risk:"yüksek" },
    ekg:   { n:"EKG cihazı",               c:"EK", i:"heart",    pm:12, cal:12,   risk:"düşük",  mob:true },
    asp:   { n:"Aspiratör",                c:"AS", i:"flask",    pm:12, cal:null, risk:"düşük",  mob:true },
  };
  const KIND_KEY = { mon:"dev_kind_mon", vent:"dev_kind_vent", inf:"dev_kind_inf", syr:"dev_kind_syr", defib:"dev_kind_defib", port:"dev_kind_port", kuv:"dev_kind_kuv", ekg:"dev_kind_ekg", asp:"dev_kind_asp" };
  const kindName = (k) => H.t(KIND_KEY[k] || "");
  const PRI_KEY = { "yüksek":"dev_pri_yuksek", orta:"dev_pri_orta", "düşük":"dev_pri_dusuk" };
  const riskName = (r) => H.t(PRI_KEY[r] || "");
  // ST/BS/PRI/WST: [0] artık Türkçe metin değil, çeviri ANAHTARI — her kullanım yerinde H.t(...) ile sarılır.
  const ST = { calisiyor:["dev_st_calisiyor", "var(--ok)"], ariza:["dev_st_ariza", "var(--crit)"], bakimda:["dev_st_bakimda", "var(--mid)"], depoda:["dev_st_depoda", "var(--low)"], kullanim_disi:["dev_st_kullanim_disi", "var(--mute)"] };
  const BS = { dolu:["dev_bs_dolu", "var(--pri)"], bos:["dev_bs_bos", "var(--ok)"], temizlik:["dev_bs_temizlik", "var(--mid)"], bloke:["dev_bs_bloke", "var(--crit)"], rezerve:["dev_bs_rezerve", "var(--low)"] };
  const PRI = { "yüksek":[PRI_KEY["yüksek"], "var(--crit)"], orta:[PRI_KEY.orta, "var(--mid)"], "düşük":[PRI_KEY["düşük"], "var(--low)"] };
  const WST = { acik:["dev_wst_acik", "var(--crit)"], atandi:["dev_wst_atandi", "var(--mid)"], kapandi:["dev_wst_kapandi", "var(--ok)"] };
  const HT = { pm:"dev_ht_pm", cal:"dev_ht_cal", repair:"dev_ht_repair" };
  const CAL_BY = ["dev_calby_biomed", "dev_calby_lab"];   // d.calBy artık ANAHTAR tutar; gösterilirken H.t(...) ile çevrilir

  /* ================= uydurma veri: cihazlar ================= */
  let seed = 20260924;
  const r = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  // Sonraki tarihi dağıt: ~%10 gecikmiş, ~%10 bu hafta, ~%13 yakın zamanda yapılmış, kalanı ileride (çoğu Eylül–Aralık 2026).
  const nextDate = (months, pLate) => { const x = r();
    if (x < pLate) return addD(TODAY, -ri(1, 26));
    if (x < pLate + .10) return addD(TODAY, ri(0, 6));
    if (x < pLate + .23) return addM(addD(TODAY, -ri(1, 23)), months);
    if (x < pLate + .50) return addD(TODAY, ri(7, 37));
    return addD(TODAY, ri(38, 98)); };

  const devices = []; let seq = 0;
  function add(kind, u, room, bed, extra) {
    const K = KINDS[kind]; seq++;
    const d = { id:"BM-" + String(seq).padStart(4, "0"), kind, unitId:u.id, room, bedId:bed ? bed.id : null,
      serial:`SN-${K.c}-${ri(100000, 999999)}`, status:"calisiyor", battery:K.bat ? ri(38, 99) : null,
      pmIntervalMonths:K.pm, riskClass:K.risk, online:K.net ? true : null, lastSeen:K.net ? "2 sn önce" : null, history:[] };
    d.nextPM = nextDate(K.pm, .10); d.lastPM = addM(d.nextPM, -K.pm);
    if (K.cal) { d.nextCal = nextDate(K.cal, .06); d.lastCal = addM(d.nextCal, -K.cal); d.certNo = `KAL-${d.lastCal.slice(0, 4)}-${ri(1000, 9999)}`; d.calBy = CAL_BY[ri(0, 1)]; }
    else { d.nextCal = null; d.lastCal = null; d.certNo = null; d.calBy = null; }
    if (kind === "port") d.lastSeen = H.at(`21:${String(ri(0, 41)).padStart(2, "0")}`);
    Object.assign(d, extra || {});
    devices.push(d); return d;
  }
  const byNo = (no) => { for (const u of H.units()) { const b = u.beds.find(x => x.no === no); if (b) return b; } return null; };

  H.units().forEach(u => {
    const B = u.beds, rooms = [...new Set(B.map(b => b.room))], room = (k) => rooms[k % rooms.length];
    if (u.type === "icu" || u.type === "nicu") {
      B.forEach((b, i) => {
        add("mon", u, b.room, b);
        if (["rea", "kvc", "pic"].includes(u.id) && i % 4 !== 3) add("vent", u, b.room, b);
        if (u.id === "nic") { add("kuv", u, b.room, b); add("syr", u, b.room, b); }
        else { add("inf", u, b.room, b); add("syr", u, b.room, b); if (i % 2 === 0) add("asp", u, b.room, b); }
      });
      if (u.id !== "nic") add("ekg", u, "Hemşire istasyonu", null);
    }
    if (u.id === "aci") {
      B.filter(b => /^Resus/.test(b.room)).forEach(b => add("mon", u, b.room, b));
      add("port", u, "Müşahidə", null); add("port", u, "Müşahidə", null, { battery:17 });
      add("inf", u, "Müşahidə", null); add("inf", u, "Resus-1", null);
      add("asp", u, "Resus-1", null); add("asp", u, "Resus-2", null);
      add("ekg", u, "Müşahidə", null);
    }
    if (u.id === "dax") {
      add("port", u, room(0), null); add("port", u, room(3), null); add("port", u, "Depo", null, { status:"depoda", online:false, lastSeen:seenAgo("16:20", -1) });
      add("inf", u, room(1), null); add("inf", u, room(2), null); add("inf", u, room(4), null);
      const dax8 = byNo("DAX08"); if (dax8) add("asp", u, dax8.room, dax8, { status:"ariza" });   // DAX08 yatağı "bloke · arıza" — sebebi bu cihaz
      add("asp", u, room(5), null); add("ekg", u, "Hemşire istasyonu", null);
    }
    if (u.id === "cer") {
      add("port", u, room(0), null, { battery:12 }); add("port", u, room(2), null);
      add("inf", u, room(1), null); add("inf", u, room(3), null);
      add("inf", u, "Depo", null, { status:"kullanim_disi", online:null });
      add("asp", u, room(4), null); add("ekg", u, "Hemşire istasyonu", null);
    }
    if (u.id === "usq") { add("port", u, room(0), null); add("port", u, "Depo", null, { status:"depoda", online:false, lastSeen:H.ts("22.09 09:10") }); add("inf", u, room(1), null); add("inf", u, room(2), null); }
    if (u.id === "bmt") { B.forEach(b => add("inf", u, b.room, b)); add("port", u, room(0), null); }
    if (u.id === "kem") B.slice(0, 4).forEach(b => add("inf", u, b.room, b));
    add("defib", u, "Koridor · acil arabası", null);
  });

  // Sabit demo durumları: REA07 monitörü sessiz (6 dk veri yok), birkaç cihaz bakımda
  const re07 = devices.find(d => d.kind === "mon" && d.bedId === (byNo("REA07") || {}).id);
  if (re07) Object.assign(re07, { online:false, lastSeen:"6 dk önce", silentMin:6 });
  const kvcVent = devices.find(d => d.kind === "vent" && d.unitId === "kvc"); if (kvcVent) kvcVent.status = "bakimda";
  const picSyr = devices.find(d => d.kind === "syr" && d.unitId === "pic"); if (picSyr) picSyr.status = "bakimda";

  // Bakım geçmişi: son bakım, bir önceki bakım, son kalibrasyon, bazılarında onarım
  devices.forEach((d, i) => {
    d.history.push({ date:d.lastPM, type:"pm", by:"bio.orxan", note:"Periyodik bakım · görsel kontrol, elektriksel güvenlik testi uygun" });
    const prev = addM(d.lastPM, -d.pmIntervalMonths); d.history.push({ date:prev, type:"pm", by:i % 3 ? "bio.orxan" : "Yetkili servis", note:"Periyodik bakım · uygun" });
    if (d.lastCal) d.history.push({ date:d.lastCal, type:"cal", by:d.calBy, note:`Kalibrasyon · sonuç uygun · sertifika ${d.certNo}` });
    if (i % 7 === 3) d.history.push({ date:addD(d.lastPM, 41), type:"repair", by:"bio.orxan", note:"Arıza onarımı · kablo/konnektör değişti, test uygun" });
    d.history.sort((a, b) => b.date.localeCompare(a.date));
  });
  H.data.devices = devices;

  /* ================= uydurma veri: arıza iş emirleri ================= */
  const dev = (pred) => devices.find(pred) || devices[0];
  const WO = (id, d, date, time, by, text, state, priority, more) => Object.assign({ id, deviceId:d.id, date, time, by, text, state, priority, assignee:null, closedAt:null, closeNote:null }, more || {});
  // 30.09c · tohum iş emirleri "24.09 21:42" varsayımıyla yazıldı → tarih ve saat gerçek saate kaydırılır
  const WO0 = (id, d, date0, time0, ...rest) => { const [date, time] = H.tsPair(date0, time0), w = WO(id, d, date, time, ...rest); if (w.closedAt) w.closedAt = H.ts(w.closedAt); return w; };
  H.data.workOrders = [
    WO0("İE-0418", re07 || devices[0], "2026-09-24", "21:36", "sistem", "Monitör merkeze veri göndermiyor (6 dk). Ağ kablosu ya da cihaz ağ kartı kontrol edilmeli.", "acik", "yüksek"),
    WO0("İE-0417", dev(d => d.kind === "mon" && d.bedId === "rea-2"), "2026-09-24", "20:15", "hs.sevda", "SpO₂ probu bağlantısı gevşek, sinyal ara ara kesiliyor.", "acik", "yüksek"),
    WO0("İE-0416", dev(d => d.kind === "asp" && d.unitId === "dax" && d.status === "ariza"), "2026-09-24", "14:02", "hs.gulnar", "Duvar aspiratörü vakum oluşturmuyor. Yatak kullanıma kapatıldı.", "atandi", "yüksek", { assignee:"bio.orxan" }),
    WO0("İE-0415", dev(d => d.kind === "inf" && d.unitId === "usq"), "2026-09-23", "22:40", "hs.nuray", "Hat açıkken de tıkanma alarmı veriyor.", "acik", "orta"),
    WO0("İE-0414", dev(d => d.kind === "port" && d.unitId === "cer" && d.battery < 20), "2026-09-23", "08:15", "hs.gulnar", "Batarya yarım nöbet dayanmıyor.", "atandi", "düşük", { assignee:"Yetkili servis" }),
    WO0("İE-0412", picSyr || devices[1], "2026-09-21", "10:30", "hs.nuray", "Dokunmatik ekran yanıt vermiyor.", "atandi", "orta", { assignee:"bio.orxan" }),
    WO0("İE-0409", kvcVent || devices[2], "2026-09-19", "03:20", "hs.sevda", "Hortum kaçak alarmı sık tekrarlıyor.", "kapandi", "yüksek", { assignee:"bio.orxan", closedAt:"2026-09-20", closeNote:"Ekshalasyon valfi değiştirildi; kaçak testi uygun. Periyodik bakıma alındı." }),
    WO0("İE-0405", dev(d => d.kind === "defib" && d.unitId === "aci"), "2026-09-15", "11:05", "rrt.emil", "Günlük test sırasında şarj süresi uzun.", "kapandi", "orta", { assignee:"bio.orxan", closedAt:"2026-09-16", closeNote:"Batarya yenilendi; şarj ve enerji testi uygun." }),
  ];
  let woSeq = 419;

  /* ================= dışa verilenler ================= */
  H.DEVICE_KINDS = KINDS;
  H.deviceById = (id) => H.data.devices.find(d => d.id === id);
  H.devicesAt = (unitId, room) => H.data.devices.filter(d => d.unitId === unitId && (room == null || d.room === room));
  H.reportDeviceFault = ({ deviceId, text, priority = "orta" }) => {
    const w = WO("İE-" + String(woSeq++).padStart(4, "0"), { id:deviceId }, TODAY, H.now(), H.state.user ? H.state.user.u : "—", text, "acik", priority);
    H.data.workOrders.unshift(w); H.log("cihaz arıza kaydı açıldı", `${w.id} · ${deviceId}`); return w;
  };
  H.openDevice = (id) => openDevice(id);

  /* ================= yardımcılar ================= */
  const K = (d) => { const k = KINDS[d.kind]; return k ? Object.assign({}, k, { n:kindName(d.kind) }) : k; };
  const bld = (id) => ((H.data.hospital.buildings.find(b => b.id === id) || {}).name || id).split(" · ")[0];
  // d.room VERİ değeridir (Türkçe sabit ad: "Depo", "Hemşire istasyonu"…) ve öyle kalır — moveModal "Depo"yu buna göre tanır; yalnız gösterimde çevrilir.
  const ROOM_KEY = { "Hemşire istasyonu":"dev_rm_nurse", "Depo":"dev_rm_store", "Koridor · acil arabası":"dev_rm_cart", "Müşahidə":"dev_rm_obs" };
  const roomLabel = (rm) => /^\d+$/.test(rm) ? H.t("dev_room_word") + " " + rm : ROOM_KEY[rm] ? H.t(ROOM_KEY[rm]) : rm;
  // d.lastSeen de veri ("2 sn önce", "6 dk önce", "dün 16:20", "az önce", "21:05") — gösterimde kalıp tanınıp çevrilir.
  const seenText = (v) => { if (v == null) return "—"; let m;
    if ((m = /^(\d+) sn önce$/.exec(v))) return devTpl("dev_ago_sec_tpl", { n:m[1] });
    if ((m = /^(\d+) dk önce$/.exec(v))) return devTpl("dev_ago_min_tpl", { n:m[1] });
    if (v === "az önce") return H.t("dev_just_now");
    if ((m = /^dün (.+)$/.exec(v))) return devTpl("dev_yesterday_tpl", { v:m[1] });
    return v; };
  const loc = (d) => { const u = H.unit(d.unitId) || { tr:d.unitId }, b = d.bedId && H.bed(d.bedId);
    return { u, b, short:`${u.tr} · ${roomLabel(d.room)}${b ? " · " + b.no : ""}`, full:`${bld(u.building)} · ${H.floorText(u.floor)} · ${u.tr} · ${roomLabel(d.room)}${b ? " · " + b.no : ""}`, bf:`${bld(u.building)} · ${H.floorText(u.floor)}` }; };
  const stPill = (s) => `<span class="dv-st" style="--c:${ST[s][1]}" title="${esc(H.t(ST[s][0]))}">${esc(H.t(ST[s][0]))}</span>`;
  const dueCls = (s) => { if (!s) return "ok"; const n = diff(s); return n < 0 ? "late" : n <= 6 ? "week" : "ok"; };
  const dueText = (s) => { if (!s) return "—"; const n = diff(s); return n < 0 ? `${fmtS(s)} · ${devTpl("dev_late_days_tpl", { n:-n })}` : n === 0 ? H.t("dev_today_word") : n === 1 ? H.t("dev_tomorrow_word") : `${fmtS(s)} · ${devTpl("dev_in_days_tpl", { n })}`; };
  // h.note serbest kayıt metnidir (çevrilmez) ama başında tür adını tekrarlar ("Periyodik bakım · …"); tür zaten çevrili
  // başlıkta yazdığı için gösterimde bu önek düşülür, iş emri no'su "(İE-…)" korunur. Veri değişmez.
  const noteBody = (s) => String(s || "").replace(/^(Periyodik bakım|Kalibrasyon|Arıza onarımı) ?(\([^)]*\))? · /, (_, a, p) => p ? p + " · " : "");
  // "sistem", "Yetkili servis" ve dev_calby_* anahtarları veri kimliğidir; gösterimde çevrilir.
  const nm = (u) => u === "sistem" ? H.t("dev_system_auto") : u === "Yetkili servis" ? H.t("dev_auth_service") : /^dev_/.test(u || "") ? H.t(u) : H.userBy(u) ? `${u} · ${H.userBy(u).name}` : u;
  const live = () => H.data.devices.filter(d => d.status !== "kullanim_disi");
  const dueItems = (test) => { const out = []; live().forEach(d => { if (test(d.nextPM)) out.push({ d, type:"pm", date:d.nextPM }); if (d.nextCal && test(d.nextCal)) out.push({ d, type:"cal", date:d.nextCal }); }); return out.sort((a, b) => a.date.localeCompare(b.date) || a.d.id.localeCompare(b.d.id)); };
  const lateItems = () => dueItems(s => diff(s) < 0);
  const weekItems = () => dueItems(s => diff(s) >= 0 && diff(s) <= 6);
  const openWO = () => H.data.workOrders.filter(w => w.state !== "kapandi");
  const silentMons = () => H.data.devices.filter(d => d.kind === "mon" && d.online === false && d.status === "calisiyor");
  const lowBatt = () => H.data.devices.filter(d => d.battery != null && d.battery < 20 && d.status !== "kullanim_disi");
  const dueRow = (it) => { const d = it.d, c = dueCls(it.date);
    return `<div class="dv-it" data-dev="${d.id}" style="--c:${c === "late" ? "var(--crit)" : c === "week" ? "var(--mid)" : "var(--low)"}"><i></i><div><b>${K(d).n} · ${d.id}</b><span class="dv-sub">${H.t(HT[it.type])} · ${esc(loc(d).short)}</span></div><span class="dv-due ${c}">${dueText(it.date)}</span></div>`; };
  const canM = () => H.can("maintenance");

  /* ================= sayfa ================= */
  const TABS = [["ozet", "dev_tab_ozet"], ["envanter", "dev_tab_envanter"], ["takvim", "dev_tab_takvim"], ["ariza", "dev_tab_ariza"], ["odalar", "dev_tab_odalar"]];
  const DV = { tab:"ozet", f:{ unit:"", kind:"", status:"", due:"", q:"", special:"" }, month:M0, day:TODAY, calView:"takvim", wo:"aktif", roomUnit:"rea" };
  let redraw = () => {}, redrawInv = () => {};

  H.register("devices", { title:() => H.t("m_devices"), perm:"devices", render(root, params) {
    if (params && params.tab && TABS.some(t => t[0] === params.tab)) DV.tab = params.tab;
    const draw = () => {
      const nLate = lateItems().length, nWo = openWO().length;
      root.innerHTML = `<div class="ph"><div><h2>${H.t("m_devices")}</h2><p>${devTpl("dev_page_sub_tpl", { date:fmt(TODAY), n:H.data.devices.length })}</p></div>
          <div class="r"><button class="btn p" data-newwo>${I("plus")} ${H.t("dev_btn_newwo")}</button></div></div>
        <div class="note i">${I("plug")} ${H.t("dev_conn_note")}</div>
        <div class="tabs">${TABS.map(([k, l]) => `<span data-tab="${k}" class="${DV.tab === k ? "on" : ""}">${H.t(l)}${k === "takvim" && nLate ? ` <em>${nLate}</em>` : k === "ariza" && nWo ? ` <em>${nWo}</em>` : ""}</span>`).join("")}</div>
        <div data-body></div>`;
      const body = root.querySelector("[data-body]");
      ({ ozet:tabOzet, envanter:tabEnvanter, takvim:tabTakvim, ariza:tabAriza, odalar:tabOdalar })[DV.tab](body);
    };
    redraw = () => { if (root.isConnected) draw(); };
    root.addEventListener("click", e => {
      const q = (s) => e.target.closest(s);
      let el;
      if ((el = q("[data-tab]"))) { DV.tab = el.dataset.tab; H.state.params = Object.assign({}, H.state.params, { tab:DV.tab }); return draw(); }
      if ((el = q("[data-newwo]"))) return woModal(null);
      if ((el = q("[data-go]"))) { const [tab, key, val] = el.dataset.go.split(":"); DV.tab = tab;
        if (tab === "envanter") { DV.f = { unit:"", kind:"", status:"", due:"", q:"", special:"" }; if (key) DV.f[key] = val; }
        if (tab === "ariza" && key) DV.wo = val;
        H.state.params = Object.assign({}, H.state.params, { tab }); return draw(); }
      if ((el = q("[data-clr]"))) { DV.f = { unit:"", kind:"", status:"", due:"", q:"", special:"" }; return draw(); }
      if ((el = q("[data-take]"))) { const w = H.data.workOrders.find(x => x.id === el.dataset.take); w.state = "atandi"; w.assignee = el.dataset.to || H.state.user.u; H.log("arıza kaydı atandı", `${w.id} → ${w.assignee}`); H.toast(`${w.id} ${w.assignee === H.state.user.u ? H.t("dev_toast_assigned_you") : devTpl("dev_toast_assigned_to_tpl", { who:nm(w.assignee) })}.`); return draw(); }
      if ((el = q("[data-closewo]"))) return closeModal(el.dataset.closewo);
      if ((el = q("[data-wop]"))) return H.print.open("wo", { wo:el.dataset.wop });
      if ((el = q("[data-reopen]"))) { const w = H.data.workOrders.find(x => x.id === el.dataset.reopen); w.state = "acik"; w.closedAt = null; H.log("arıza kaydı yeniden açıldı", w.id); return draw(); }
      if ((el = q("[data-wof] button"))) { DV.wo = el.dataset.v; return draw(); }
      if ((el = q("[data-calv] button"))) { DV.calView = el.dataset.v; return draw(); }
      if ((el = q("[data-mon]"))) { DV.month = Math.max(M0, Math.min(M0 + 1, DV.month + Number(el.dataset.mon))); DV.day = DV.month === M0 ? TODAY : null; return draw(); }
      if ((el = q("[data-day]"))) { DV.day = el.dataset.day; return draw(); }
      if ((el = q("[data-dev]"))) return openDevice(el.dataset.dev);
    });
    root.addEventListener("change", e => {
      const f = e.target.closest("select[data-f]"); if (f) { DV.f[f.dataset.f] = f.value; return redrawInv(); }
      const ru = e.target.closest("select[data-ru]"); if (ru) { DV.roomUnit = ru.value; return draw(); }
    });
    root.addEventListener("input", e => { const s = e.target.closest("input[data-f]"); if (s) { DV.f.q = s.value; redrawInv(); } });
    draw();
    if (params && params.device) setTimeout(() => openDevice(params.device), 0);
  } });

  /* ---------- a) Özet ---------- */
  function tabOzet(body) {
    const late = lateItems(), week = weekItems(), wos = openWO(), sil = silentMons(), low = lowBatt();
    const lateDev = new Set(late.map(x => x.d.id)).size;
    const cards = [
      [late.length ? "crit" : "ok", "clock", late.length, devTpl("dev_card_late_tpl", { n:lateDev }), "envanter:due:late"],
      [week.length ? "" : "ok", "list", week.length, H.t("dev_card_week"), "envanter:due:week"],
      [wos.some(w => w.priority === "yüksek" && w.state === "acik") ? "crit" : wos.length ? "" : "ok", "alert", wos.length, devTpl("dev_card_wo_open_tpl", { n:wos.filter(w => w.state === "acik").length }), "ariza"],
      [sil.length ? "crit" : "ok", "wifi", sil.length, sil.length ? devTpl("dev_card_silent_tpl", { list:sil.map(d => (loc(d).b || {}).no || d.id).join(", "), n:sil[0].silentMin || "?" }) : H.t("dev_card_silent_none"), "envanter:special:silent"],
      [low.length ? "" : "ok", "zap", low.length, H.t("dev_card_lowbatt"), "envanter:special:lowbatt"],
    ];
    const byStatus = Object.keys(ST).map(s => [s, H.data.devices.filter(d => d.status === s).length]);
    const byKind = Object.keys(KINDS).map(k => [k, H.data.devices.filter(d => d.kind === k).length]);
    const maxK = Math.max(...byKind.map(x => x[1]));
    const LATE_MAX = 6;
    body.innerHTML = `<div class="att dv-att">${cards.map(([c, ic, n, t, go]) => `<div class="ac ${c}" data-go="${go}"><div class="i">${I(ic)}</div><b>${n}</b><span>${t}</span></div>`).join("")}</div>
      <div class="dv-split" style="margin-top:16px">
        <div><div class="sec" style="margin-top:0">${H.t("dev_sec_today_week_tpl")} <small>${fmtS(TODAY)} – ${fmtS(addD(TODAY, 6))}</small></div>
          ${late.length ? `<div class="dv-grp" style="color:var(--crit)">${devTpl("dev_grp_late_tpl", { n:late.length })}</div><div class="dv-list">${late.slice(0, LATE_MAX).map(dueRow).join("")}</div>
            ${late.length > LATE_MAX ? `<button class="btn g sm" style="margin-top:6px" data-go="takvim">${devTpl("dev_more_late_tpl", { n:late.length - LATE_MAX })} ${I("chevR")}</button>` : ""}` : ""}
          <div class="dv-grp">${devTpl("dev_grp_today_tpl", { n:week.filter(x => diff(x.date) === 0).length })}</div><div class="dv-list">${week.filter(x => diff(x.date) === 0).map(dueRow).join("") || `<div class="mute" style="font-size:13px">${H.t("dev_no_pm_today")}</div>`}</div>
          <div class="dv-grp">${devTpl("dev_grp_week_tpl", { n:week.filter(x => diff(x.date) > 0).length })}</div><div class="dv-list">${week.filter(x => diff(x.date) > 0).map(dueRow).join("") || `<div class="mute" style="font-size:13px">—</div>`}</div>
        </div>
        <div>
          <div class="sec" style="margin-top:0">${H.t("dev_sec_open_wo")} <small><button class="btn g sm" data-go="ariza">${H.t("dev_all")} ${I("chevR")}</button></small></div>
          <div class="dv-list">${wos.slice().sort(woSort).slice(0, 4).map(w => { const d = H.deviceById(w.deviceId);
            return `<div class="dv-it" data-dev="${d.id}" style="--c:${PRI[w.priority][1]}"><i></i><div><b>${esc(w.text)}</b><span class="dv-sub">${K(d).n} · ${esc(loc(d).short)} · ${devTpl("dev_opened_by_tpl", { who:esc(nm(w.by)) })}</span></div><span class="dv-st" style="--c:${WST[w.state][1]}">${H.t(WST[w.state][0])}</span></div>`; }).join("") || `<div class="empty">${H.t("dev_no_open_wo")}</div>`}</div>
          <div class="box" style="margin-top:14px"><h5>${H.t("dev_box_status")}</h5><div class="dv-bars">${byStatus.map(([s, n]) => `<div><span>${stPill(s)}</span><b class="mono">${n}</b><em><i style="--c:${ST[s][1]};width:${Math.round(n / H.data.devices.length * 100)}%"></i></em></div>`).join("")}</div></div>
          <div class="box" style="margin-top:12px"><h5>${H.t("dev_box_bykind")}</h5><div class="dv-bars">${byKind.map(([k, n]) => `<div><span>${kindName(k)}</span><b class="mono">${n}</b><em><i style="--c:var(--pri);width:${Math.round(n / maxK * 100)}%"></i></em></div>`).join("")}</div></div>
        </div>
      </div>`;
  }
  const woSort = (a, b) => ["acik", "atandi", "kapandi"].indexOf(a.state) - ["acik", "atandi", "kapandi"].indexOf(b.state) || ["yüksek", "orta", "düşük"].indexOf(a.priority) - ["yüksek", "orta", "düşük"].indexOf(b.priority) || (b.date + b.time).localeCompare(a.date + a.time);

  /* ---------- b) Envanter ---------- */
  function tabEnvanter(body) {
    const units = H.units(), F = DV.f;
    const opt = (v, l, cur) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`;
    body.innerHTML = `<div class="dv-bar">
        <select data-f="unit">${opt("", H.t("dev_opt_all_units"), F.unit)}${units.map(u => opt(u.id, esc(u.tr), F.unit)).join("")}</select>
        <select data-f="kind">${opt("", H.t("dev_opt_all_kinds"), F.kind)}${Object.keys(KINDS).map(k => opt(k, kindName(k), F.kind)).join("")}</select>
        <select data-f="status">${opt("", H.t("dev_opt_all_status"), F.status)}${Object.keys(ST).map(s => opt(s, H.t(ST[s][0]), F.status)).join("")}</select>
        <select data-f="due">${opt("", H.t("dev_opt_all_due"), F.due)}${opt("late", H.t("dev_opt_due_late"), F.due)}${opt("week", H.t("dev_opt_due_week"), F.due)}${opt("month", H.t("dev_opt_due_month"), F.due)}</select>
        <input class="dv-q" data-f="q" type="search" placeholder="${esc(H.t("dev_search_ph"))}" value="${esc(F.q)}">
      </div><div data-inv></div>`;
    const host = body.querySelector("[data-inv]");
    redrawInv = () => { if (host.isConnected) host.innerHTML = invTable(); };
    redrawInv();
  }
  function invTable() {
    const F = DV.f, q = F.q.trim().toLocaleLowerCase(locTag());
    const dueOk = (d) => { if (!F.due) return true; const ds = [d.nextPM, d.nextCal].filter(Boolean).map(diff);
      return F.due === "late" ? ds.some(n => n < 0) : F.due === "week" ? ds.some(n => n >= 0 && n <= 6) : ds.some(n => n >= 0 && n <= 30); };
    const rows = H.data.devices.filter(d => (!F.unit || d.unitId === F.unit) && (!F.kind || d.kind === F.kind) && (!F.status || d.status === F.status) && dueOk(d)
      && (F.special !== "silent" || (d.kind === "mon" && d.online === false && d.status === "calisiyor"))
      && (F.special !== "lowbatt" || (d.battery != null && d.battery < 20 && d.status !== "kullanim_disi"))
      && (!q || [d.id, d.serial, K(d).n, loc(d).short, loc(d).bf].join(" ").toLocaleLowerCase(locTag()).includes(q)));
    const chip = F.special ? `<button class="dv-chip" data-clr>${F.special === "silent" ? H.t("dev_chip_silent") : H.t("dev_chip_lowbatt")} ${I("x")}</button>` : "";
    const anyF = F.unit || F.kind || F.status || F.due || F.q || F.special;
    const conn = (d) => d.online == null ? `<span class="mute">—</span><span class="dv-sub">${H.t("dev_conn_no_net")}</span>`
      : d.online ? `<span class="dv-st" style="--c:var(--ok)">${H.t("dev_conn_connected")}</span><span class="dv-sub">${devTpl("dev_last_data_tpl", { v:esc(seenText(d.lastSeen)) })}</span>`
      : d.status === "calisiyor" ? `<span class="tag c">${H.t("dev_conn_silent")}</span><span class="dv-sub">${devTpl("dev_last_data_tpl", { v:esc(seenText(d.lastSeen)) })}</span>` : `<span class="mute">${H.t("dev_conn_offline")}</span><span class="dv-sub">${devTpl("dev_last_seen_tpl", { v:esc(seenText(d.lastSeen)) })}</span>`;
    return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;font-size:12.5px" class="mute">${devTpl("dev_showing_tpl", { total:H.data.devices.length, n:`<b style="color:var(--ink)">${rows.length}</b>` })} ${chip}${anyF ? `<button class="btn g sm" data-clr>${H.t("dev_clear_filters")}</button>` : ""}</div>
      ${rows.length ? `<div class="tw"><table class="t dv-t"><tr><th>${H.t("dev_th_id")}</th><th>${H.t("dev_th_kind")}</th><th>${H.t("dev_th_loc")}</th><th>${H.t("dev_th_status")}</th><th>${H.t("dev_th_pm")}</th><th>${H.t("dev_th_cal")}</th><th>${H.t("dev_th_conn")}</th></tr>
      ${rows.map(d => { const L = loc(d);
        return `<tr class="row" data-dev="${d.id}"><td class="n">${d.id}<span class="dv-sub mono">${d.serial}</span></td>
          <td>${K(d).n}<span class="dv-sub">${devTpl("dev_risk_tpl", { v:riskName(d.riskClass) })}</span></td>
          <td>${esc(L.short)}<span class="dv-sub">${esc(L.bf)}</span></td>
          <td>${stPill(d.status)}${d.battery != null ? `<span class="dv-sub" style="${d.battery < 20 ? "color:var(--crit);font-weight:700" : ""}">${devTpl("dev_battery_pct_tpl", { v:d.battery })}</span>` : ""}</td>
          <td><span class="dv-due ${dueCls(d.nextPM)}">${dueText(d.nextPM)}</span><span class="dv-sub">${devTpl("dev_last_tpl", { v:fmt(d.lastPM) })}</span></td>
          <td>${d.nextCal ? `<span class="dv-due ${dueCls(d.nextCal)}">${dueText(d.nextCal)}</span><span class="dv-sub">${devTpl("dev_last_tpl", { v:fmt(d.lastCal) })}</span>` : `<span class="mute">${H.t("dev_not_required")}</span>`}</td>
          <td>${conn(d)}</td></tr>`; }).join("")}</table></div>` : `<div class="empty">${H.t("dev_no_match")}</div>`}`;
  }

  /* ---------- c) Bakım takvimi ---------- */
  function monthEvents(y, m) {
    const pre = `${y}-${String(m + 1).padStart(2, "0")}`, map = {};
    const push = (date, ev) => { if (!date || !date.startsWith(pre)) return; (map[date] = map[date] || []).push(ev); };
    H.data.devices.forEach(d => {
      if (d.status !== "kullanim_disi") {
        push(d.nextPM, { d, type:"pm", date:d.nextPM, state:diff(d.nextPM) < 0 ? "late" : "plan" });
        if (d.nextCal) push(d.nextCal, { d, type:"cal", date:d.nextCal, state:diff(d.nextCal) < 0 ? "late" : "plan" });
      }
      d.history.forEach(h => push(h.date, { d, type:h.type, date:h.date, state:"done", by:h.by, note:h.note }));
    });
    return map;
  }
  const EVC = { late:"var(--crit)", plan:"var(--low)", done:"var(--ok)" };
  const EVL = { late:"dev_ev_late", plan:"dev_ev_plan", done:"dev_ev_done" };   // anahtar — H.t ile gösterilir
  const evRow = (ev) => { const d = ev.d;
    return `<div class="dv-it" data-dev="${d.id}" style="--c:${EVC[ev.state]}"><i></i><div><b>${K(d).n} · ${d.id}</b><span class="dv-sub">${H.t(HT[ev.type])} · ${esc(loc(d).short)}</span></div><span class="dv-due ${ev.state === "done" ? "done" : ev.state === "late" ? "late" : "ok"}">${ev.state === "late" ? devTpl("dev_late_days_tpl", { n:-diff(ev.date) }) : H.t(EVL[ev.state])}</span></div>`; };
  const evSort = (a, b) => ["late", "plan", "done"].indexOf(a.state) - ["late", "plan", "done"].indexOf(b.state) || a.d.id.localeCompare(b.d.id);

  function tabTakvim(body) {
    const y = Y0 + Math.floor(DV.month / 12), m = DV.month % 12, map = monthEvents(y, m), first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, nd = new Date(y, m + 1, 0).getDate();
    const cnt = (list, s) => list.filter(e => e.state === s).length;
    const late = lateItems();
    let grid = "";
    if (DV.calView === "takvim") {
      grid = `<div class="dv-grid">${WEEK_HEAD().map(h => `<div class="h">${h}</div>`).join("")}
        ${Array.from({ length:lead }, () => `<div class="dv-day x"></div>`).join("")}
        ${Array.from({ length:nd }, (_, i) => { const ds = iso(new Date(y, m, i + 1)), L = map[ds] || [], wd = new Date(y, m, i + 1).getDay();
          const parts = [["late", cnt(L, "late")], ["plan", cnt(L, "plan")], ["done", cnt(L, "done")]].filter(x => x[1]);
          return `<button class="dv-day${ds === TODAY ? " today" : ""}${ds === DV.day ? " sel" : ""}${wd === 0 || wd === 6 ? " we" : ""}" data-day="${ds}" aria-label="${esc(devTpl("dev_day_jobs_aria_tpl", { date:fmt(ds), n:L.length }))}"><span class="n">${i + 1}</span>
            <span class="dv-dots">${parts.map(([s, n]) => `<span style="--c:${EVC[s]}" title="${esc(H.t(EVL[s]))}: ${n}">${n}</span>`).join("")}</span></button>`; }).join("")}</div>`;
    } else {
      const days = Object.keys(map).sort();
      grid = days.length ? days.map(ds => `<div class="dv-grp"${ds === TODAY ? ' style="color:var(--pri)"' : ""}>${fmt(ds)} · ${DAYS()[pd(ds).getDay()]}${ds === TODAY ? H.t("dev_and_today") : ""}</div><div class="dv-list">${map[ds].slice().sort(evSort).map(evRow).join("")}</div>`).join("")
        : `<div class="empty">${H.t("dev_no_pm_month")}</div>`;
    }
    const sel = DV.day && map[DV.day] ? map[DV.day].slice().sort(evSort) : [];
    body.innerHTML = `<div class="dv-calw"><div>
        <div class="dv-calh"><button class="btn sm" data-mon="-1" ${m <= 8 ? "disabled" : ""} aria-label="${esc(H.t("dev_prev_month"))}">${I("chevL")}</button><span class="m">${MONTHS()[m]} ${y}</span><button class="btn sm" data-mon="1" ${m >= 9 ? "disabled" : ""} aria-label="${esc(H.t("dev_next_month"))}">${I("chevR")}</button>
          <div class="seg" data-calv><button data-v="takvim" class="${DV.calView === "takvim" ? "on" : ""}">${H.t("dev_view_calendar")}</button><button data-v="liste" class="${DV.calView === "liste" ? "on" : ""}">${H.t("dev_view_list")}</button></div>
          <div class="dv-lg"><span style="--c:${EVC.late}">${H.t(EVL.late)}</span><span style="--c:${EVC.plan}">${H.t(EVL.plan)}</span><span style="--c:${EVC.done}">${H.t(EVL.done)}</span></div></div>
        ${grid}
        <div class="mute" style="font-size:11.5px;margin-top:8px">${H.t("dev_footnote_calendar")}</div>
      </div><div>
        ${DV.calView === "takvim" ? `<div class="sec" style="margin-top:0">${DV.day ? `${fmt(DV.day)} · ${DAYS()[pd(DV.day).getDay()]}` : H.t("dev_pick_day")} <small>${sel.length ? devTpl("dev_jobs_tpl", { n:sel.length }) : ""}</small></div>
          <div class="dv-list">${DV.day ? (sel.map(evRow).join("") || `<div class="mute" style="font-size:13px">${H.t("dev_no_records_day")}</div>`) : `<div class="mute" style="font-size:13px">${H.t("dev_tap_a_day")}</div>`}</div>` : ""}
        <div class="sec"${DV.calView === "takvim" ? "" : ' style="margin-top:0"'}>${H.t("dev_sec_late")} <small>${devTpl("dev_jobs_tpl", { n:late.length })}</small></div>
        <div class="dv-list">${late.map(dueRow).join("") || `<div class="empty">${H.t("dev_no_late")}</div>`}</div>
      </div></div>`;
  }

  /* ---------- d) Arıza kayıtları ---------- */
  function tabAriza(body) {
    const all = H.data.workOrders.slice().sort(woSort), can = canM(), me = H.state.user.u;
    const F = { aktif:(w) => w.state !== "kapandi", acik:(w) => w.state === "acik", atandi:(w) => w.state === "atandi", kapandi:(w) => w.state === "kapandi", tum:() => true };
    const list = all.filter(F[DV.wo] || F.aktif);
    body.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <div class="seg" data-wof style="flex-wrap:wrap">${[["aktif", devTpl("dev_wof_active_tpl", { n:all.filter(F.aktif).length })], ["acik", devTpl("dev_wof_unassigned_tpl", { n:all.filter(F.acik).length })], ["atandi", H.t("dev_wof_assigned")], ["kapandi", H.t("dev_wof_closed")], ["tum", H.t("dev_all")]].map(([k, l]) => `<button data-v="${k}" class="${DV.wo === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="mute" style="font-size:12.5px;margin-bottom:10px">${H.t("dev_wo_client_note")}</div>
      ${list.map(w => { const d = H.deviceById(w.deviceId) || { id:w.deviceId, kind:"mon", room:"—", unitId:"" }, L = loc(d);
        return `<div class="dv-wo${w.state === "kapandi" ? " closed" : ""}" style="--c:${PRI[w.priority][1]}"><i></i><div style="min-width:0">
          <div class="dv-wot"><b class="mono">${w.id}</b><span class="dv-st" style="--c:${WST[w.state][1]}">${H.t(WST[w.state][0])}</span><span class="tag">${H.t(PRI[w.priority][0])} ${H.t("dev_priority_suffix")}</span><time>${fmtS(w.date)} ${w.time}</time></div>
          <div style="margin:7px 0 3px;font-weight:600">${esc(w.text)}</div>
          <span class="dv-sub">${K(d).n} · ${d.id} · ${esc(L.full)}</span>
          <span class="dv-sub">${devTpl("dev_opened_by_tpl", { who:esc(nm(w.by)) })}${w.assignee ? ` · ${devTpl("dev_assignee_tpl", { who:esc(nm(w.assignee)) })}` : ""}${w.closedAt ? ` · ${devTpl("dev_closed_at_tpl", { v:fmt(w.closedAt) })}` : ""}</span>
          ${w.closeNote ? `<div class="dv-sub" style="margin-top:4px;color:var(--ink)">${I("ok")} ${esc(w.closeNote)}</div>` : ""}
          <div class="dv-acts">
            ${w.state === "acik" ? `<button class="btn p sm" data-take="${w.id}" ${can ? "" : "disabled"}>${H.t("dev_btn_take")}</button><button class="btn sm" data-take="${w.id}" data-to="Yetkili servis" ${can ? "" : "disabled"}>${H.t("dev_btn_send_service")}</button>` : ""}
            ${w.state === "atandi" && w.assignee !== me ? `<button class="btn sm" data-take="${w.id}" ${can ? "" : "disabled"}>${H.t("dev_btn_take")}</button>` : ""}
            ${w.state !== "kapandi" ? `<button class="btn sm" data-closewo="${w.id}" ${can ? "" : "disabled"}>${I("ok")} ${H.t("dev_btn_close_wo")}</button>` : `<button class="btn g sm" data-reopen="${w.id}" ${can ? "" : "disabled"}>${H.t("dev_btn_reopen")}</button>`}
            ${H.print && H.print.canDoc("wo") ? `<button class="btn g sm" data-wop="${w.id}">${I("print")} ${H.t("pr_btn_wo")}</button>` : ""}
            <button class="btn g sm" data-dev="${d.id}">${H.t("dev_btn_open_device")} ${I("chevR")}</button>
          </div></div></div>`; }).join("") || `<div class="empty">${H.t("dev_no_match_filter")}</div>`}`;
  }

  /* ---------- e) Yataklar ve odalar ---------- */
  function tabOdalar(body) {
    const u = H.unit(DV.roomUnit) || H.units()[0];
    const rooms = [...new Set(u.beds.map(b => b.room))], ds = H.devicesAt(u.id);
    ds.forEach(d => { if (!rooms.includes(d.room)) rooms.push(d.room); });
    const occ = u.beds.filter(b => b.status === "dolu").length, free = u.beds.filter(b => b.status === "bos" && !b.oos).length;
    const lateHere = ds.filter(d => d.status !== "kullanim_disi" && [d.nextPM, d.nextCal].filter(Boolean).some(s => diff(s) < 0)).length;
    const groups = H.data.hospital.buildings.map(b => `<optgroup label="${esc(b.name)}">${b.floors.map(f => f.units.map(x => `<option value="${x.id}" ${x.id === u.id ? "selected" : ""}>${H.floorText(f.no)} · ${esc(x.tr)}</option>`).join("")).join("")}</optgroup>`).join("");
    const bedChip = (b) => { const s = b.oos ? ["dev_st_kullanim_disi", "var(--mute)"] : BS[b.status] || ["—", "var(--mute)"];
      return `<div class="dv-bd" style="--c:${s[1]}" title="${esc(b.type || "")}">${b.no}<small>${H.t(s[0])}${b.iso ? H.t("dev_iso_suffix") : ""}</small></div>`; };
    const devLine = (d) => { const c = [d.nextPM, d.nextCal].filter(Boolean).map(dueCls), w = c.includes("late") ? "late" : c.includes("week") ? "week" : "";
      return `<div class="dv-dev" data-dev="${d.id}">${I(K(d).i)}<span class="nm">${K(d).n} <span class="mute mono" style="font-size:11px">${d.id}${d.bedId ? " · " + H.bed(d.bedId).no : ""}</span></span>
        ${w ? `<span class="dv-due ${w}" title="${esc(H.t("dev_maint_title"))}">${w === "late" ? H.t("dev_here_tag") : H.t("dev_this_week_tag")}</span>` : ""}${d.kind === "mon" && d.online === false && d.status === "calisiyor" ? `<span class="tag c">${H.t("dev_silent_tag")}</span>` : ""}${stPill(d.status)}</div>`; };
    body.innerHTML = `<div class="dv-bar"><select data-ru style="max-width:360px;flex:1 1 260px">${groups}</select></div>
      <div class="sec" style="margin-top:4px">${esc(u.tr)} <span class="pill">${bld(u.building)} · ${H.floorText(u.floor)}</span><span class="pill">${esc(devTpl("dev_code_tpl", { v:u.code || "—" }))}</span><small>${devTpl("dev_unit_summary_tpl", { rooms:rooms.length, beds:u.beds.length, occ, free, dev:ds.length })}${lateHere ? ` · <b style="color:var(--crit)">${devTpl("dev_maint_late_tpl", { n:lateHere })}</b>` : ""}</small></div>
      <div class="dv-lg" style="margin:0 0 10px">${Object.values(BS).map(([l, c]) => `<span style="--c:${c}">${H.t(l)}</span>`).join("")}</div>
      <div class="dv-rooms">${rooms.map(rm => { const bs = u.beds.filter(b => b.room === rm), dd = ds.filter(d => d.room === rm);
        return `<div class="dv-room"><h6>${I(bs.length ? "bed" : "building")} ${esc(roomLabel(rm))}<small>${bs.length ? devTpl("dev_room_beds_tpl", { n:bs.length }) : ""}${devTpl("dev_room_devs_tpl", { n:dd.length })}</small></h6>
          ${bs.length ? `<div class="dv-beds">${bs.map(bedChip).join("")}</div>` : ""}
          ${dd.map(devLine).join("") || `<div class="mute" style="font-size:12.5px;border-top:1px dashed var(--line);padding-top:6px">${H.t("dev_no_devices_here")}</div>`}</div>`; }).join("")}</div>
      <div class="mute" style="font-size:11.5px;margin-top:10px">${H.t("dev_footnote_beds")}</div>`;
  }

  /* ================= modallar ================= */
  function openDevice(id) {
    const d = H.deviceById(id); if (!d) return H.toast(devTpl("dev_not_found_tpl", { id }), "w");
    const k = K(d), L = loc(d), can = canM(), wos = H.data.workOrders.filter(w => w.deviceId === d.id && w.state !== "kapandi");
    const kv = (a, b) => `<div class="kv"><span>${a}</span><span style="text-align:right">${b}</span></div>`;
    const bedSt = L.b ? (L.b.oos ? H.t("dev_out_of_service") : H.t((BS[L.b.status] || ["—"])[0]).toLocaleLowerCase(locTag())) : null;
    const pmLate = -diff(d.nextPM);
    H.modal({ title:`${d.id} · ${k.n}`, wide:false,
      body:`<div class="dv-mh">${I(k.i)}<div><b>${k.n}</b><span class="dv-sub mono">${d.id} · ${d.serial}</span></div>${stPill(d.status)}</div>
        ${wos.length ? `<div class="note" style="margin-bottom:12px">${I("alert")} ${devTpl("dev_wo_open_tpl", { n:wos.length, list:wos.map(w => `${w.id} · ${esc(w.text)}`).join(" · ") })}</div>` : ""}
        ${d.kind === "mon" && d.online === false && d.status === "calisiyor" ? `<div class="note" style="margin-bottom:12px;color:var(--crit);background:var(--critSoft);border-color:transparent">${I("wifi")} ${devTpl("dev_silent_note_tpl", { n:d.silentMin || "?", v:esc(seenText(d.lastSeen)) })}</div>` : ""}
        <div class="dv-g2">
          <div class="box"><h5>${I("tablet")} ${H.t("dev_box_identity")}</h5>${kv(H.t("dev_kv_id"), `<b>${d.id}</b>`)}${kv(H.t("dev_kv_kind"), k.n)}${kv(H.t("dev_kv_serial"), `<b>${d.serial}</b>`)}${kv(H.t("dev_kv_risk"), riskName(d.riskClass))}${kv(H.t("dev_kv_pm_interval"), devTpl("dev_kv_interval_tpl", { n:d.pmIntervalMonths }))}${d.battery != null ? kv(H.t("dev_kv_battery"), `<b style="${d.battery < 20 ? "color:var(--crit)" : ""}">${devTpl("dev_pct_tpl", { v:d.battery })}</b>`) : ""}${kv(H.t("dev_kv_network"), d.online == null ? H.t("dev_net_none") : d.online ? devTpl("dev_net_connected_tpl", { v:esc(seenText(d.lastSeen)) }) : devTpl("dev_net_none_last_tpl", { v:esc(seenText(d.lastSeen)) }))}</div>
          <div class="box"><h5>${I("building")} ${H.t("dev_box_location")}</h5>${kv(H.t("dev_kv_block"), esc(bld(L.u.building)))}${kv(H.t("dev_kv_floor"), H.floorText(L.u.floor))}${kv(H.t("dev_kv_unit"), `${esc(L.u.tr)}${L.u.code ? ` · ${esc(L.u.code)}` : ""}`)}${kv(H.t("dev_kv_room"), esc(roomLabel(d.room)))}${kv(H.t("dev_kv_bed"), L.b ? `<b>${L.b.no}</b> · ${bedSt}` : H.t("dev_assigned_to_room"))}
            <div class="mute" style="font-size:11.5px;margin-top:6px">${H.t("dev_no_patient_screen")}</div></div>
          <div class="box"><h5>${I("clock")} ${H.t("dev_box_pm")}</h5>${kv(H.t("dev_kv_last_pm"), `<b>${fmt(d.lastPM)}</b>`)}${kv(H.t("dev_kv_next_pm"), `<b>${fmt(d.nextPM)}</b>`)}${kv(H.t("dev_kv_status"), `<span class="dv-due ${dueCls(d.nextPM)}">${pmLate > 0 ? devTpl("dev_late_days_tpl", { n:pmLate }) : -pmLate <= 6 ? H.t("dev_this_week_tag") : H.t("dev_on_time")}</span>`)}</div>
          <div class="box"><h5>${I("file")} ${H.t("dev_box_cal")}</h5>${d.nextCal ? kv(H.t("dev_kv_last_cal"), `<b>${fmt(d.lastCal)}</b>`) + kv(H.t("dev_kv_next"), `<b>${fmt(d.nextCal)}</b> <span class="dv-due ${dueCls(d.nextCal)}">${diff(d.nextCal) < 0 ? `· ${devTpl("dev_late_days_tpl", { n:-diff(d.nextCal) })}` : ""}</span>`) + kv(H.t("dev_kv_cert"), `<b>${d.certNo}</b>`) + kv(H.t("dev_kv_doneby"), esc(nm(d.calBy))) + kv(H.t("dev_kv_result"), `<span style="color:var(--ok);font-weight:700">${H.t("dev_result_ok")}</span>`) : `<div class="mute" style="font-size:13px">${H.t("dev_no_cal_needed")}</div>`}</div>
        </div>
        <div class="sec">${H.t("dev_sec_history")} <small>${devTpl("dev_records_tpl", { n:d.history.length })}</small></div>
        <div class="box dv-hist">${d.history.map(h => `<div><time>${fmt(h.date)}</time><span><b>${H.t(HT[h.type])}</b> · ${esc(noteBody(h.note))}<span class="dv-sub">${esc(nm(h.by))}</span></span></div>`).join("")}</div>
        ${!can ? `<div class="mute" style="font-size:12px;margin-top:10px">${H.t("dev_maint_perm_note")}</div>` : ""}`,
      actions:`${H.print && H.print.canDoc("dev") ? `<button class="btn" data-a="label">${I("print")} ${H.t("pr_btn_devlabel")}</button>` : ""}<button class="btn" data-a="wo">${I("alert")} ${H.t("dev_btn_open_wo")}</button>${k.mob ? `<button class="btn" data-a="move" ${can ? "" : "disabled"}>${I("swap")} ${H.t("dev_btn_move")}</button>` : ""}<button class="btn p" data-a="done" ${can ? "" : "disabled"}>${I("ok")} ${H.t("dev_btn_mark_done")}</button>`,
      onMount:(m) => { const mf = m.querySelector(".mf"); if (mf) mf.classList.add("dv-mf");
        m.addEventListener("click", e => { const a = e.target.closest("[data-a]"); if (!a || a.disabled) return;
          ({ wo:() => woModal(d.id), move:() => moveModal(d), done:() => doneModal(d), label:() => { H.closeModal(); H.print.open("dev", { dev:d.id }); } })[a.dataset.a](); }); } });
  }

  function doneModal(d) {
    const k = K(d);
    // types[1]: Türkçe etiket H.log denetim metni için (kapsam dışı, kayıt niteliğinde); ekranda types[2] anahtarı H.t ile gösterilir.
    const types = k.cal ? [["pm", "Periyodik bakım", "dev_opt_pm_only"], ["cal", "Kalibrasyon", "dev_ht_cal"], ["both", "Bakım + kalibrasyon", "dev_opt_both"]] : [["pm", "Periyodik bakım", "dev_opt_pm_only"]];
    H.modal({ title:devTpl("dev_modal_maint_tpl", { id:d.id }),
      body:`<p class="mute" style="margin-top:0;font-size:13px">${k.n} · ${esc(loc(d).full)}</p>
        <div class="fld"><label>${H.t("dev_field_worktype")}</label><div class="opts" data-o="type">${types.map(([v, , l], i) => `<i data-v="${v}" class="${i === 0 ? "on" : ""}">${H.t(l)}</i>`).join("")}</div></div>
        <div class="fld" data-fd><label>${H.t("dev_field_date")}</label><input type="date" data-date value="${TODAY}" max="${TODAY}"></div>
        <div class="fld"><label>${H.t("dev_field_result")}</label><div class="opts" data-o="res"><i data-v="ok" class="on">${H.t("dev_result_ok")}</i><i data-v="fail">${H.t("dev_result_fail")}</i></div></div>
        <div class="fld"><label>${H.t("dev_field_note")}</label><textarea data-note placeholder="${esc(H.t("dev_note_ph_maint"))}"></textarea></div>
        <div class="mute" style="font-size:12px">${devTpl("dev_maint_footnote_tpl", { n:d.pmIntervalMonths, cal:k.cal ? H.t("dev_maint_footnote_cal") : "" })}</div>`,
      actions:`<button class="btn" data-x>${H.t("cancel")}</button><button class="btn p" data-ok>${I("ok")} ${H.t("dev_btn_log_maint")}</button>`,
      onMount:(m) => { m.addEventListener("click", e => {
        const o = e.target.closest("[data-o] i"); if (o) { [...o.parentNode.children].forEach(x => x.classList.toggle("on", x === o)); return; }
        if (!e.target.closest("[data-ok]")) return;
        const type = m.querySelector('[data-o="type"] i.on').dataset.v, res = m.querySelector('[data-o="res"] i.on').dataset.v;
        const date = m.querySelector("[data-date]").value, note = m.querySelector("[data-note]").value.trim();
        if (!date || date > TODAY) { m.querySelector("[data-fd]").classList.add("dv-err"); return H.toast(H.t("dev_date_err"), "w"); }
        const who = H.state.user.u, resTxt = res === "ok" ? "sonuç uygun" : "sonuç uygun değil";
        if (type === "pm" || type === "both") { d.lastPM = date; d.nextPM = addM(date, d.pmIntervalMonths); d.history.unshift({ date, type:"pm", by:who, note:`Periyodik bakım · ${resTxt}${note ? " · " + note : ""}` }); }
        if ((type === "cal" || type === "both") && k.cal) { d.lastCal = date; d.nextCal = addM(date, k.cal); d.certNo = `KAL-${date.slice(0, 4)}-${ri(1000, 9999)}`; d.calBy = CAL_BY[0];
          d.history.unshift({ date, type:"cal", by:who, note:`Kalibrasyon · ${resTxt} · sertifika ${d.certNo}${note ? " · " + note : ""}` }); }
        d.history.sort((a, b) => b.date.localeCompare(a.date));
        if (res === "fail") d.status = "ariza"; else if (d.status === "bakimda") d.status = "calisiyor";
        H.log("cihaz bakımı işaretlendi", `${d.id} · ${types.find(t => t[0] === type)[1]} · ${fmt(date)} · ${resTxt}${note ? " · " + note : ""}`);
        H.closeModal(); H.toast(devTpl("dev_saved_next_tpl", { id:d.id, v:fmt(d.nextPM), fail:res === "fail" ? H.t("dev_marked_faulty_suffix") : "" }), res === "fail" ? "w" : "");
        redraw(); openDevice(d.id);
      }); } });
  }

  function moveModal(d) {
    const roomsOf = (uid) => { const u = H.unit(uid); const rs = [...new Set(u.beds.map(b => b.room))]; ["Hemşire istasyonu", "Depo"].forEach(x => { if (!rs.includes(x)) rs.push(x); }); return rs; };
    const roomOpts = (uid, cur) => roomsOf(uid).map(rm => `<option value="${esc(rm)}" ${rm === cur ? "selected" : ""}>${esc(roomLabel(rm))}</option>`).join("");
    const before = loc(d).full;
    H.modal({ title:devTpl("dev_modal_move_tpl", { id:d.id }),
      body:`<p class="mute" style="margin-top:0;font-size:13px">${devTpl("dev_now_at_tpl", { v:esc(before) })}</p>
        <div class="fld"><label>${H.t("dev_field_unit")}</label><select data-u>${H.units().map(u => `<option value="${u.id}" ${u.id === d.unitId ? "selected" : ""}>${H.floorText(u.floor)} · ${esc(u.tr)}</option>`).join("")}</select></div>
        <div class="fld"><label>${H.t("dev_field_room")}</label><select data-r>${roomOpts(d.unitId, d.room)}</select></div>
        <div class="mute" style="font-size:12px">${H.t("dev_move_note")}</div>`,
      actions:`<button class="btn" data-x>${H.t("cancel")}</button><button class="btn p" data-ok>${H.t("dev_btn_move_do")}</button>`,
      onMount:(m) => {
        m.addEventListener("change", e => { if (e.target.matches("[data-u]")) m.querySelector("[data-r]").innerHTML = roomOpts(e.target.value, ""); });
        m.addEventListener("click", e => { if (!e.target.closest("[data-ok]")) return;
          const uid = m.querySelector("[data-u]").value, rm = m.querySelector("[data-r]").value;
          if (uid === d.unitId && rm === d.room && !d.bedId) return H.toast(H.t("dev_same_location"), "w");
          d.unitId = uid; d.room = rm; d.bedId = null;
          if (rm === "Depo") { if (d.status === "calisiyor") d.status = "depoda"; if (d.online != null) d.online = false; }
          else if (d.status === "depoda") { d.status = "calisiyor"; if (d.online != null) { d.online = true; d.lastSeen = "az önce"; } }   // veri değeri; seenText() gösterimde çevirir
          H.log("cihaz konumu değişti", `${d.id} · ${before} → ${loc(d).full}`);
          H.closeModal(); H.toast(devTpl("dev_moved_tpl", { id:d.id, v:loc(d).short })); redraw(); openDevice(d.id);
        }); } });
  }

  function woModal(deviceId) {
    let sel = deviceId || null;
    const optList = (q) => { const s = (q || "").toLocaleLowerCase(locTag());
      return H.data.devices.filter(d => d.status !== "kullanim_disi" && (!s || [d.id, d.serial, K(d).n, loc(d).short].join(" ").toLocaleLowerCase(locTag()).includes(s))).slice(0, 60)
        .map(d => `<div data-pk="${d.id}" class="${d.id === sel ? "on" : ""}"><b class="mono">${d.id}</b> · ${K(d).n} · <span class="mute">${esc(loc(d).short)}</span></div>`).join("") || `<div class="mute">${H.t("dev_no_match_device")}</div>`; };
    const fixed = deviceId && H.deviceById(deviceId);
    // data-v öncelik VERİ değeridir ("yüksek"/"orta"/"düşük"), etiket H.t ile çevrilir.
    H.modal({ title:H.t("dev_modal_wo"),
      body:`${fixed ? `<div class="fld"><label>${H.t("dev_field_device")}</label><div><b class="mono">${fixed.id}</b> · ${K(fixed).n}<span class="dv-sub">${esc(loc(fixed).full)}</span></div></div>`
          : `<div class="fld" data-fdev><label>${H.t("dev_field_device")} <span class="req">*</span></label><div><input type="search" data-pq placeholder="${esc(H.t("dev_search_ph_wo"))}"><div class="dv-pick" data-pl>${optList("")}</div></div></div>`}
        <div class="fld"><label>${H.t("dev_field_priority")}</label><div class="opts" data-o="pri">${Object.keys(PRI).map(p => `<i data-v="${p}"${p === "orta" ? ' class="on"' : ""}>${H.t(PRI[p][0])}</i>`).join("")}</div></div>
        <div class="fld" data-ftx><label>${H.t("dev_field_desc")} <span class="req">*</span></label><textarea data-tx placeholder="${esc(H.t("dev_desc_ph"))}"></textarea></div>
        <label class="dv-ck"><input type="checkbox" data-pull> ${H.t("dev_ck_pull")}</label>
        <div class="note" style="margin-top:8px">${H.t("dev_wo_privacy_note")}</div>`,
      actions:`<button class="btn" data-x>${H.t("cancel")}</button><button class="btn p" data-ok>${H.t("dev_btn_open_record")}</button>`,
      onMount:(m) => {
        m.addEventListener("input", e => { if (e.target.matches("[data-pq]")) m.querySelector("[data-pl]").innerHTML = optList(e.target.value); });
        m.addEventListener("click", e => {
          const pk = e.target.closest("[data-pk]"); if (pk) { sel = pk.dataset.pk; m.querySelectorAll("[data-pk]").forEach(x => x.classList.toggle("on", x === pk)); return; }
          const o = e.target.closest("[data-o] i"); if (o) { [...o.parentNode.children].forEach(x => x.classList.toggle("on", x === o)); return; }
          if (!e.target.closest("[data-ok]")) return;
          const tx = m.querySelector("[data-tx]").value.trim(), pri = m.querySelector('[data-o="pri"] i.on').dataset.v;
          m.querySelectorAll(".dv-err").forEach(x => x.classList.remove("dv-err"));
          if (!sel) { const f = m.querySelector("[data-fdev]"); if (f) f.classList.add("dv-err"); return H.toast(H.t("dev_select_device"), "w"); }
          if (tx.length < 5) { m.querySelector("[data-ftx]").classList.add("dv-err"); return H.toast(H.t("dev_desc_too_short"), "w"); }
          const w = H.reportDeviceFault({ deviceId:sel, text:tx, priority:pri });
          const d = H.deviceById(sel); if (m.querySelector("[data-pull]").checked && d) { d.status = "ariza"; H.log("cihaz arızalı işaretlendi", d.id); }
          H.closeModal(); H.toast(devTpl("dev_wo_opened_tpl", { id:w.id, dev:sel })); DV.wo = "aktif"; redraw();
        }); } });
  }

  function closeModal(woId) {
    const w = H.data.workOrders.find(x => x.id === woId), d = H.deviceById(w.deviceId);
    H.modal({ title:devTpl("dev_modal_close_wo_tpl", { id:w.id }),
      body:`<p class="mute" style="margin-top:0;font-size:13px">${esc(w.text)}<br>${d ? `${K(d).n} · ${d.id} · ${esc(loc(d).short)}` : ""}</p>
        <div class="fld col" data-fn><label>${H.t("dev_field_action")} <span class="req">*</span></label><textarea data-cn placeholder="${esc(H.t("dev_action_ph"))}"></textarea></div>
        ${d ? `<label class="dv-ck"><input type="checkbox" data-ready checked> ${H.t("dev_ck_ready")}</label>` : ""}`,
      actions:`<button class="btn" data-x>${H.t("cancel")}</button><button class="btn p" data-ok>${I("ok")} ${H.t("dev_btn_close_record")}</button>`,
      onMount:(m) => { m.addEventListener("click", e => { if (!e.target.closest("[data-ok]")) return;
        const note = m.querySelector("[data-cn]").value.trim();
        if (note.length < 3) { m.querySelector("[data-fn]").classList.add("dv-err"); return H.toast(H.t("dev_action_required"), "w"); }
        w.state = "kapandi"; w.closedAt = TODAY; w.closeNote = note; if (!w.assignee) w.assignee = H.state.user.u;
        if (d) { d.history.unshift({ date:TODAY, type:"repair", by:H.state.user.u, note:`Arıza onarımı (${w.id}) · ${note}` });
          if (m.querySelector("[data-ready]") && m.querySelector("[data-ready]").checked && (d.status === "ariza" || d.status === "bakimda")) d.status = "calisiyor";
          if (d.kind === "mon" && d.online === false && d.status === "calisiyor" && m.querySelector("[data-ready]").checked) { d.online = true; d.lastSeen = "az önce"; d.silentMin = 0; } }
        H.log("arıza kaydı kapatıldı", `${w.id} · ${note}`);
        H.closeModal(); H.toast(devTpl("dev_wo_closed_tpl", { id:w.id })); redraw();
      }); } });
  }
})();
