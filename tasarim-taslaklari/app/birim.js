/* Homunculus · birim.js — birim düzeyi üç ekran (24.09, 15-sistem-neler-olabilir #13 #14 #18).
 *   workload  · Hemşire iş yükü           perm: staff_view | occupancy   (sorumlu hemşire, yönetici)
 *   infection · Enfeksiyon kontrol görünümü perm: quality | beds
 *   pilot     · Pilot başlangıç ölçümü ve sonuç raporu  perm: summary | quality
 * Kurallar: kişi sıralaması yok (iş yükü birim ve vardiya düzeyinde), eşik/oran uydurulmaz,
 * değer olmayan yerde "ölçüm başlamadı" yazılır. names:false rolünde hasta adı basılmaz (yalnız yatak no).
 * Stil kendi <style> etiketinde, "bu-" önekli. Metinler 4 dilde (bu_ önekli anahtarlar). */
(function () {
  const I = (k) => H.icon(k), E = H.esc;

  /* ================= sözlük: [AZ, TR, RU, EN] ================= */
  const D = {
    m_workload:["İş yükü", "Hemşire iş yükü", "Нагрузка медсестёр", "Nurse workload"],
    m_infection:["İnfeksiya nəzarəti", "Enfeksiyon kontrol", "Инфекционный контроль", "Infection control"],
    m_pilot:["Pilot ölçməsi", "Pilot ölçümü", "Замеры пилота", "Pilot measurement"],
    all_units:["Bütün şöbələr", "Tüm birimler", "Все отделения", "All units"],
    bed:["Çarpayı", "Yatak", "Койка", "Bed"], patient:["Xəstə", "Hasta", "Пациент", "Patient"], unit:["Şöbə", "Birim", "Отделение", "Unit"],
    no_name:["ad göstərilmir", "hasta adı gösterilmez", "имя пациента не показывается", "patient names hidden"],
    day_n:["{n}. gün", "{n}. gün", "день {n}", "day {n}"],
    close:["Bağla", "Kapat", "Закрыть", "Close"],
    // --- iş yükü
    wl_sub:["Bu növbə · {d} · şöbə və növbə səviyyəsində; şəxslər sıralanmır", "Bu vardiya · {d} · birim ve vardiya düzeyinde; kişi sıralaması yapılmaz", "Текущая смена · {d} · по отделениям и по часам; без рейтинга сотрудников", "This shift · {d} · by unit and by hour; no ranking of individuals"],
    wl_c_pts:["xəstə · {n} tibb bacısına təyin", "hasta · {n} hemşireye atanmış", "пациентов · у {n} медсестёр", "patients · assigned to {n} nurses"],
    wl_c_ratio:["tibb bacısı başına orta xəstə", "hemşire başına ortalama hasta", "пациентов на медсестру (среднее)", "patients per nurse (mean)"],
    wl_c_late:["gecikən iş · şöbələr üzrə", "geciken iş · birimlerde", "просроченных задач · по отделениям", "overdue tasks · across units"],
    wl_c_left:["növbə sonuna qalan iş", "vardiya bitimine kalan iş", "задач до конца смены", "tasks left this shift"],
    wl_c_unas:["tibb bacısı təyin olunmayıb", "hemşire atanmamış hasta", "пациентов без медсестры", "patients without a nurse"],
    wl_sec_units:["Şöbə səviyyəsində", "Birim düzeyinde", "По отделениям", "By unit"],
    wl_sec_units_s:["qalan iş ÷ tibb bacısı · ortalamaya görə", "kalan iş ÷ hemşire · ortalamaya göre", "оставшиеся задачи ÷ медсёстры · относительно среднего", "tasks left ÷ nurses · against the mean"],
    wl_th_nurses:["Tibb bacısı", "Hemşire", "Медсёстры", "Nurses"], wl_th_ratio:["Xəstə / t.b.", "Hasta / hemşire", "Пац. / медс.", "Patients / nurse"],
    wl_th_risk:["Yüksək riskli", "Yüksek riskli", "Высокий риск", "High risk"], wl_th_late:["Gecikən", "Geciken", "Просрочено", "Overdue"],
    wl_th_left:["Qalan iş", "Kalan iş", "Осталось", "Tasks left"], wl_th_per:["Qalan iş / t.b.", "Kalan iş / hemşire", "Осталось / медс.", "Left per nurse"],
    wl_above:["ortalamanın {x} qatı", "ortalamanın {x} katı", "{x}× от среднего", "{x}× the mean"],
    wl_no_nurse:["tibb bacısı yoxdur", "hemşire yok", "нет медсестры", "no nurse"],
    wl_sec_shift:["Növbə boyu iş bölgüsü", "Vardiya boyunca iş dağılımı", "Задачи по часам смены", "Work across the shift"],
    wl_sec_shift_s:["saat başına planlı iş · {a} → {b}", "saat başına planlı iş · {a} → {b}", "задач в час · {a} → {b}", "scheduled tasks per hour · {a} → {b}"],
    st_done:["Edildi", "Yapıldı", "Сделано", "Done"], st_late:["Gecikdi", "Gecikti", "Просрочено", "Overdue"], st_due:["İndi", "Şimdi", "Сейчас", "Due now"], st_plan:["Planlı", "Planlı", "Запланировано", "Planned"],
    wl_now:["indi", "şimdi", "сейчас", "now"],
    wl_peak:["Qalan hissədə ən sıx saat: {h} · {n} iş", "Kalan bölümde en yoğun saat: {h} · {n} iş", "Самый загруженный час до конца смены: {h} · {n} задач", "Busiest hour still ahead: {h} · {n} tasks"],
    wl_sec_nurse:["Tibb bacısı başına xəstə", "Hemşire başına hasta", "Пациенты на медсестру", "Patients per nurse"],
    wl_sec_nurse_s:["əlifba sırası · reytinq deyil", "alfabetik · sıralama değildir", "по алфавиту · это не рейтинг", "alphabetical · not a ranking"],
    wl_pts:["{n} xəstə", "{n} hasta", "пациентов: {n}", "{n} patients"], wl_left:["qalan {n} iş", "kalan {n} iş", "осталось задач: {n}", "{n} tasks left"],
    wl_hr:["{n} yüksək riskli", "{n} yüksek riskli", "высокий риск: {n}", "{n} high risk"],
    wl_unas:["Təyin olunmayıb", "Atanmamış", "Без медсестры", "Unassigned"],
    wl_redis:["Yenidən bölgü təklifi", "Yeniden dağıtım önerisi", "Предложение перераспределения", "Redistribution suggestion"],
    wl_m_intro:["Bu yalnız təklifdir; heç bir təyinat dəyişmir. Təyinatı baş tibb bacısı edir.", "Bu yalnız bir öneridir; hiçbir atama değişmez. Atamayı sorumlu hemşire yapar.", "Это только предложение; назначения не меняются. Решение за старшей медсестрой.", "This is only a suggestion; no assignment changes. The charge nurse decides."],
    wl_m_move:["{bed}: {a} → {b}. Qalan iş {a1}→{a2} və {b1}→{b2} olur.", "{bed}: {a} → {b}. Kalan iş {a1}→{a2} ve {b1}→{b2} olur.", "{bed}: {a} → {b}. Остаток задач {a1}→{a2} и {b1}→{b2}.", "{bed}: {a} → {b}. Tasks left become {a1}→{a2} and {b1}→{b2}."],
    wl_m_single:["{u}: bu şöbəyə səlahiyyətli yalnız bir tibb bacısı var ({n}). Şöbə daxilində bölüşdürüləcək başqa tibb bacısı yoxdur; əlavə kadr ehtiyacı müzakirə oluna bilər.", "{u}: bu birime yetkili tek hemşire var ({n}). Birim içinde dağıtılacak başka hemşire yok; ek personel ihtiyacı konuşulabilir.", "{u}: в отделении одна медсестра с допуском ({n}). Перераспределять не на кого; можно обсудить дополнительный персонал.", "{u}: only one nurse is authorised for this unit ({n}). There is nobody to share with; extra staffing can be discussed."],
    wl_m_flat:["Tibb bacıları arasındakı qalan iş fərqi bir xəstənin köçürülməsi ilə azalmır.", "Hemşireler arasındaki kalan iş farkı tek hasta taşımasıyla azalmıyor.", "Перевод одного пациента не уменьшает разницу нагрузки.", "Moving a single patient does not narrow the gap between nurses."],
    wl_m_unas:["{bed}: tibb bacısı təyin olunmayıb. Bu şöbəyə səlahiyyətli: {list}", "{bed}: hemşire atanmamış. Bu birime yetkili: {list}", "{bed}: медсестра не назначена. Допуск к отделению: {list}", "{bed}: no nurse assigned. Authorised for this unit: {list}"],
    wl_m_none:["heç kim tanımlanmayıb", "tanımlı kimse yok", "никого нет", "nobody defined"],
    wl_m_peak:["Növbənin qalan hissəsində ən sıx saat {h} ({n} iş).", "Vardiyanın kalanında en yoğun saat {h} ({n} iş).", "Самый загруженный час до конца смены {h} ({n} задач).", "Busiest hour for the rest of the shift is {h} ({n} tasks)."],
    wl_m_save:["Təklifi qeyd et", "Öneriyi not al", "Записать предложение", "Note the suggestion"],
    wl_m_saved:["Təklif qeyd olundu · təyinat dəyişmədi", "Öneri not edildi · atama değişmedi", "Предложение записано · назначения не изменены", "Suggestion noted · assignments unchanged"],
    wl_note:["Gecikən iş şəxsə deyil, şöbəyə yazılır. Bu ekran kimisə qiymətləndirmək üçün deyil, xəstə bölgüsünə kömək üçündür.", "Geciken iş kişiye değil birime yazılır. Bu ekran kimseyi değerlendirmek için değil, hasta dağıtımına yardım için vardır.", "Просрочка относится к отделению, а не к человеку. Экран помогает распределять пациентов, а не оценивать сотрудников.", "Overdue work is counted per unit, not per person. This screen helps share patients; it does not assess anyone."],
    wl_empty:["Kapsamınızda klinik şöbə yoxdur.", "Kapsamınızda klinik birim yok.", "В вашем доступе нет клинических отделений.", "No clinical units in your scope."],
    // --- enfeksiyon
    in_sub:["İzolyasiya, cihaz günləri və antibiotik günü · {d}", "İzolasyon, cihaz günleri ve antibiyotik günü · {d}", "Изоляция, дни устройств и дни антибиотиков · {d}", "Isolation, device days and antibiotic days · {d}"],
    in_c_iso:["izolyasiyada xəstə", "izolasyondaki hasta", "пациентов в изоляции", "patients in isolation"],
    in_c_room:["boş izolyasiya yeri", "boş izolasyon yatağı", "свободных изоляционных коек", "free isolation beds"],
    in_c_cvc:["mərkəzi kateterli xəstə", "santral kateterli hasta", "с центральным катетером", "with a central line"],
    in_c_uc:["sidik kateterli xəstə", "üriner kateterli hasta", "с мочевым катетером", "with a urinary catheter"],
    in_c_vent:["ventilyatorda", "ventilatörde", "на ИВЛ", "on a ventilator"],
    in_c_abx:["antibiotik alan", "antibiyotik alan", "получают антибиотики", "on antibiotics"],
    in_sec_iso:["İzolyasiyada olan xəstələr", "İzolasyondaki hastalar", "Пациенты в изоляции", "Patients in isolation"],
    in_th_iso:["İzolyasiya", "İzolasyon", "Изоляция", "Isolation"], in_th_room:["Otaq", "Oda", "Палата", "Room"],
    in_iso_room:["izolyasiya otağı", "izolasyon odası", "изоляционная палата", "isolation room"],
    in_not_iso_room:["izolyasiya otağında deyil", "izolasyon odasında değil", "не в изоляционной палате", "not in an isolation room"],
    in_iso_none:["Kapsamınızda izolyasiyada xəstə yoxdur.", "Kapsamınızda izolasyondaki hasta yok.", "В вашем доступе нет пациентов в изоляции.", "No patients in isolation in your scope."],
    in_sec_rooms:["İzolyasiya yerləri", "İzolasyon yatakları", "Изоляционные койки", "Isolation beds"],
    in_rooms_s:["{a} dolu · {b} boş", "{a} dolu · {b} boş", "занято {a} · свободно {b}", "{a} occupied · {b} free"],
    rs_free:["boş", "boş", "свободна", "free"], rs_iso:["izolyasiyalı xəstə", "izolasyonlu hasta", "пациент в изоляции", "isolated patient"],
    rs_noiso:["izolyasiyasız xəstə", "izolasyonsuz hasta", "пациент без изоляции", "patient not isolated"],
    rs_clean:["təmizlikdə", "temizlikte", "уборка", "cleaning"], rs_block:["bağlı", "bloke", "закрыта", "blocked"], rs_res:["rezerv", "rezerve", "резерв", "reserved"],
    in_sec_dev:["Cihaz günləri", "Cihaz günleri", "Дни устройств", "Device days"],
    in_dev_s:["hazırkı yatışlar · {d}", "mevcut yatışlar · {d}", "текущие госпитализации · {d}", "current stays · {d}"],
    dv_cvc:["Mərkəzi kateter", "Santral kateter", "Центральный катетер", "Central line"], dv_uc:["Sidik kateteri", "Üriner kateter", "Мочевой катетер", "Urinary catheter"], dv_vent:["Ventilyator", "Ventilatör", "ИВЛ", "Ventilator"],
    in_th_src:["Mənbə", "Kaynak", "Источник", "Source"],
    src_rec:["Tibb bacısı fəaliyyət qeydi", "Hemşire faaliyet kaydı", "Журнал сестринских действий", "Nursing activity record"],
    src_dev:["Cihaz / yatış qeydi", "Cihaz / yatış kaydı", "Запись устройства / госпитализации", "Device / admission record"],
    in_dev_none:["Kapsamınızda cihazlı xəstə yoxdur.", "Kapsamınızda cihazlı hasta yok.", "Пациентов с устройствами нет.", "No patients with devices in your scope."],
    in_sec_unit:["Şöbə üzrə cihaz-gün cəmi", "Birim bazında cihaz-gün toplamı", "Сумма дней устройств по отделениям", "Device days per unit"],
    in_th_pd:["Xəstə-gün", "Hasta-gün", "Пациенто-дни", "Patient days"], in_th_util:["Mərkəzi kateter istifadə nisbəti", "Santral kateter kullanım oranı", "Доля дней ЦВК", "Central line utilisation"],
    in_f_util:["Cihaz istifadə nisbəti = cihaz-gün ÷ xəstə-gün (eyni şöbə, eyni dövr). Xəstə-gün = hazırkı xəstələrin yatış günlərinin cəmi.", "Cihaz kullanım oranı = cihaz-gün ÷ hasta-gün (aynı birim, aynı dönem). Hasta-gün = mevcut hastaların yatış günleri toplamı.", "Доля использования = дни устройства ÷ пациенто-дни (то же отделение, тот же период). Пациенто-дни = сумма дней госпитализации текущих пациентов.", "Device utilisation = device days ÷ patient days (same unit, same period). Patient days = sum of current patients' days in hospital."],
    in_f_rate:["İnfeksiya nisbəti (məs. 1000 mərkəzi kateter gününə düşən kateterlə bağlı qan infeksiyası) = hadisə sayı ÷ cihaz-gün × 1000. Hadisə qeydi bu ekrana bağlı deyil; nisbət hesablanmayıb.", "Enfeksiyon oranı (ör. 1000 santral kateter gününde kateterle ilişkili kan dolaşımı enfeksiyonu) = olay sayısı ÷ cihaz-gün × 1000. Olay kaydı bu ekrana bağlı değil; oran hesaplanmadı.", "Частота инфекций (напр. катетер-ассоциированные инфекции кровотока на 1000 дней ЦВК) = число случаев ÷ дни устройства × 1000. Журнал случаев не подключён; частота не рассчитана.", "Infection rate (e.g. central-line bloodstream infections per 1000 line days) = events ÷ device days × 1000. No event record is connected here, so no rate is calculated."],
    in_adm:["İnfeksiya tərifləri və hadisə sayımı xəstəxananın infeksiya nəzarəti komitəsindən gəlir; sistem hədd və ya tərif yaratmır.", "Enfeksiyon tanımları ve olay sayımı hastanenin enfeksiyon kontrol komitesinden gelir; sistem eşik ya da tanım üretmez.", "Определения инфекций и учёт случаев задаёт комитет инфекционного контроля больницы; система не создаёт порогов и определений.", "Infection definitions and event counting come from the hospital's infection control committee; the system sets no thresholds or definitions."],
    in_sec_abx:["Antibiotik günü", "Antibiyotik günü", "Дни антибиотиков", "Antibiotic days"],
    in_th_day:["Gün", "Gün", "День", "Day"],
    in_abx_none:["Kapsamınızda antibiotik alan xəstə yoxdur.", "Kapsamınızda antibiyotik alan hasta yok.", "Нет пациентов на антибиотиках.", "No patients on antibiotics in your scope."],
    iso_Damlacık:["Damcı", "Damlacık", "Капельная", "Droplet"], iso_Koruyucu:["Qoruyucu", "Koruyucu", "Защитная", "Protective"], iso_Temas:["Təmas", "Temas", "Контактная", "Contact"], iso_Solunum:["Hava yolu", "Solunum", "Воздушная", "Airborne"],
    // --- pilot
    pl_title:["Pilot: başlanğıc ölçməsi və nəticə hesabatı", "Pilot başlangıç ölçümü ve sonuç raporu", "Пилот: исходные замеры и итоговый отчёт", "Pilot baseline and outcome report"],
    pl_sub:["Pilotdan əvvəl / sonra müqayisə şablonu · {d}", "Pilot öncesi / sonrası karşılaştırma şablonu · {d}", "Шаблон сравнения до / после пилота · {d}", "Before / after comparison template · {d}"],
    pl_warn:["Başlanğıc ölçməsi pilotdan ƏVVƏL alınmasa, pilot sonunda yaxşılaşma olduğunu demək olmaz.", "Başlangıç ölçümü pilottan ÖNCE alınmazsa, pilot sonunda bir iyileşme olduğu söylenemez.", "Если исходные замеры не сделаны ДО пилота, об улучшении после пилота говорить нельзя.", "Without a baseline taken BEFORE the pilot, no improvement can be claimed afterwards."],
    pl_cal:["Pilot təqvimi", "Pilot takvimi", "Календарь пилота", "Pilot calendar"],
    pl_start:["Başlanğıc", "Başlangıç", "Начало", "Start"], pl_end:["Son", "Bitiş", "Конец", "End"],
    pl_undef:["Pilot tarixləri təyin olunmayıb", "Pilot tarihleri tanımlanmadı", "Даты пилота не заданы", "Pilot dates not set"],
    pl_ph_base:["Başlanğıc ölçmə dövrü", "Başlangıç ölçümü dönemi", "Период исходных замеров", "Baseline period"],
    pl_ph_run:["Pilot davam edir", "Pilot sürüyor", "Пилот идёт", "Pilot running"], pl_ph_done:["Pilot bitdi", "Pilot bitti", "Пилот завершён", "Pilot finished"],
    pl_progress:["{n} / {m} başlanğıc ölçməsi qeydə alınıb", "{n} / {m} başlangıç ölçümü kayıtlı", "исходных замеров: {n} из {m}", "{n} of {m} baselines recorded"],
    pl_th_m:["Ölçü", "Ölçü", "Показатель", "Measure"], pl_th_def:["Tərif / düstur", "Tanım / formül", "Определение / формула", "Definition / formula"],
    pl_th_src:["Haradan gəlir", "Nereden gelir", "Откуда данные", "Where it comes from"],
    pl_th_pre:["Pilotdan əvvəl", "Pilot öncesi", "До пилота", "Before pilot"], pl_th_post:["Pilotdan sonra", "Pilot sonrası", "После пилота", "After pilot"], pl_th_diff:["Fərq", "Fark", "Разница", "Change"],
    pl_ns:["ölçmə başlamayıb", "ölçüm başlamadı", "замеры не начаты", "not yet measured"],
    pl_running:["pilot bitəndə hesablanır", "pilot bitince hesaplanır", "рассчитывается после пилота", "calculated when the pilot ends"],
    pl_enter:["Başlanğıc daxil et", "Başlangıç gir", "Ввести исходное", "Enter baseline"], pl_edit:["Düzəlt", "Düzelt", "Изменить", "Edit"],
    pl_value:["Dəyər", "Değer", "Значение", "Value"], pl_period:["Ölçmə dövrü", "Ölçüm dönemi", "Период замера", "Measurement period"], pl_method:["Üsul", "Yöntem", "Метод", "Method"], pl_by:["Ölçən", "Ölçen", "Кто измерил", "Measured by"],
    pl_save:["Yadda saxla", "Kaydet", "Сохранить", "Save"], pl_saved:["Başlanğıc ölçməsi qeydə alındı", "Başlangıç ölçümü kaydedildi", "Исходный замер сохранён", "Baseline saved"],
    pl_need:["Dəyər və dövr lazımdır", "Değer ve dönem gerekli", "Нужны значение и период", "Value and period are required"],
    pl_print:["Hesabatı endir", "Raporu indir", "Скачать отчёт", "Download report"], pl_doprint:["Çap et / PDF saxla", "Yazdır / PDF kaydet", "Печать / сохранить PDF", "Print / save as PDF"],
    pl_rep_t:["Pilot nəticə hesabatı", "Pilot sonuç raporu", "Итоговый отчёт пилота", "Pilot outcome report"],
    pl_rep_note:["Dəyər yazılmayan sətirlər ölçülməyib; hesabat təxmin ehtiva etmir.", "Değer yazılmayan satırlar ölçülmemiştir; rapor tahmin içermez.", "Строки без значений не измерялись; отчёт не содержит оценок.", "Rows without a value were not measured; the report contains no estimates."],
    pl_rep_prep:["Hazırlayan", "Hazırlayan", "Подготовил", "Prepared by"], pl_rep_q:["Keyfiyyət", "Kalite", "Качество", "Quality"], pl_rep_head:["Baş həkim", "Başhekim", "Главный врач", "Medical director"],
    pl_rep_date:["Hesabat tarixi", "Rapor tarihi", "Дата отчёта", "Report date"],
    pl_adm:["Ölçülərin tərifi (xüsusilə 'qaçırılmış pisləşmə') pilot protokolunda xəstəxana ilə birlikdə yazılır və pilotdan əvvəl dondurulur.", "Ölçülerin tanımı (özellikle 'kaçırılan kötüleşme') pilot protokolünde hastaneyle birlikte yazılır ve pilottan önce dondurulur.", "Определения показателей (особенно «пропущенное ухудшение») фиксируются в протоколе пилота вместе с больницей до старта.", "Measure definitions (especially 'missed deterioration') are written into the pilot protocol with the hospital and frozen before it starts."],
    mt_manual:["Əllə ölçmə (saniyəölçən)", "Elle ölçüm (kronometre)", "Ручной замер (секундомер)", "Manual timing (stopwatch)"], mt_chart:["Tibbi sənəd incələməsi", "Dosya incelemesi", "Анализ историй болезни", "Chart review"],
    mt_his:["Mövcud xəstəxana sistemi hesabatı", "Mevcut hastane sistemi raporu", "Отчёт действующей системы больницы", "Existing hospital system report"], mt_obs:["Müşahidə (yerində)", "Gözlem (yerinde)", "Наблюдение на месте", "On-site observation"],
  };
  const LI = { AZ:0, TR:1, RU:2, EN:3 }, dict = {};
  Object.entries(D).forEach(([k, a]) => { dict[k.startsWith("m_") ? k : "bu_" + k] = { AZ:a[0], TR:a[1], RU:a[2], EN:a[3] }; });
  H.addT(dict);
  const t = (k, v) => { let s = H.t(k.startsWith("m_") ? k : "bu_" + k); if (v) Object.keys(v).forEach(x => { s = s.split("{" + x + "}").join(v[x]); }); return s; };

  /* ================= ortak yardımcılar ================= */
  const NOW = (() => { const [h, m] = H.now().split(":").map(Number); return h + m / 60; })();
  const hh = (h) => String(Math.floor(h) % 24).padStart(2, "0") + ":00";
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const bedOf = (p) => H.bed(p.bed) || { no:"—", unitId:null, iso:false };
  const unitOf = (p) => H.unit(bedOf(p).unitId);
  const shortName = (p) => { const s = String(p.name || "").split(" "); return s[0] + (s[1] ? " " + s[1][0] + "." : ""); };
  const ptLabel = (p) => `<b class="bu-mono">${E(bedOf(p).no)}</b>${H.showNames() ? ` <span>${E(shortName(p))}</span>` : ""}`;
  const nurseName = (u) => { const x = u && H.userBy(u); return x ? x.name : u || "—"; };
  const scopeUnits = () => H.units().filter(u => H.state.user.units.includes(u.id));
  const isoName = (v) => { const k = "bu_iso_" + v; const r = H.t(k); return r === k ? v : r; };
  const HIGH = new Set(["crit", "high"]);
  const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(H.state.lang === "EN" ? "en-GB" : H.state.lang === "RU" ? "ru-RU" : "tr-TR", { minimumFractionDigits:d, maximumFractionDigits:d });

  const CSS = `<style>
    .bu-mono{font-family:"JetBrains Mono",monospace;font-weight:700}
    .bu-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 4px}
    .bu-bar select{width:auto;max-width:100%;min-width:0}
    .bu-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;min-width:0}
    .bu-card h5{margin:0 0 8px;font:700 11px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .bu-card h5 .r{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:600}
    .bu-hb{height:8px;border-radius:5px;background:var(--card2);overflow:hidden;min-width:60px}
    .bu-hb i{display:block;height:100%;border-radius:5px;background:var(--c,var(--pri))}
    .bu-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font:600 12px Figtree;color:var(--mute);margin:6px 0 0}
    .bu-legend span{display:inline-flex;align-items:center;gap:6px}.bu-legend span:before{content:"";width:10px;height:10px;border-radius:3px;background:var(--c)}
    .bu-chart{width:100%;overflow:hidden}.bu-chart svg{display:block;width:100%}
    .bu-nurses{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
    .bu-nurse .bu-ntop{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.bu-nurse .bu-ntop b{font:700 14px "Space Grotesk"}
    .bu-nurse .bu-nmeta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
    .bu-chips{display:flex;flex-wrap:wrap;gap:6px}
    .bu-chip{display:inline-flex;gap:6px;align-items:center;font:600 12px Figtree;border:1px solid var(--line2);border-radius:9px;padding:3px 8px;background:var(--card2);max-width:100%;min-width:0}
    .bu-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bu-chip.h{border-color:color-mix(in srgb,var(--high) 55%,transparent)}.bu-chip.c{border-color:color-mix(in srgb,var(--crit) 60%,transparent)}
    .bu-dot{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
    .bu-mute{color:var(--mute);font-size:12px}
    .bu-f{font:500 12.5px/1.5 Figtree;color:var(--mute);margin:8px 0 0}
    .bu-f b{color:var(--ink)}
    .bu-rooms{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
    .bu-room{border:1.5px solid color-mix(in srgb,var(--c) 55%,transparent);background:color-mix(in srgb,var(--c) 10%,var(--card));border-radius:11px;padding:7px 9px;min-width:0}
    .bu-room b{display:block;font:700 12.5px "JetBrains Mono"}.bu-room small{display:block;font:600 11px Figtree;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bu-dgrid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
    .bu-dev{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
    .bu-urow{display:grid;grid-template-columns:minmax(110px,190px) minmax(0,1fr);gap:6px 12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
    .bu-urow:last-child{border-bottom:0}.bu-urow .n{font:600 13px Figtree;min-width:0;overflow:hidden;text-overflow:ellipsis}
    .bu-urow .bars{display:grid;gap:4px;min-width:0}.bu-urow .bars div{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:center;font:700 11.5px "JetBrains Mono"}
    .bu-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}
    .bu-step{border:1px solid var(--line);border-radius:12px;padding:9px 11px;background:var(--card);min-width:0}
    .bu-step.on{border-color:var(--pri);background:var(--priSoft)}
    .bu-step small{display:block;font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
    .bu-step b{font:700 13.5px "Space Grotesk"}
    .bu-cal{display:flex;flex-wrap:wrap;gap:10px;align-items:end}
    .bu-cal label{display:grid;gap:4px;font:600 12px Figtree;color:var(--mute)}.bu-cal input{width:auto}
    table.t td.bu-def{min-width:220px;font-size:12.5px;color:var(--mute)}
    table.t td.bu-src{min-width:180px;font-size:12.5px}
    .bu-ns{color:var(--mute);font-style:italic;font-size:12.5px;white-space:nowrap}
    .bu-form{display:grid;gap:10px}.bu-form label{display:grid;gap:4px;font:600 12.5px Figtree;color:var(--mute)}
    .bu-form .two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .bu-paper{background:#fff;color:#111;border-radius:10px;padding:22px;font:13px/1.45 Figtree}
    .bu-paper h1{font:700 20px "Space Grotesk";margin:0 0 4px}.bu-paper .m{color:#555;font-size:12px}
    .bu-paper table{width:100%;border-collapse:collapse;margin:14px 0;font-size:12px}
    .bu-paper th,.bu-paper td{border:1px solid #bbb;padding:6px 8px;text-align:left;vertical-align:top}
    .bu-paper th{background:#f1f1f1;font-weight:700}
    .bu-paper .sig{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:34px}.bu-paper .sig div{border-top:1px solid #333;padding-top:5px;font-size:12px}
    .bu-paper .wrn{border:1px solid #c9a227;background:#fff8dc;padding:7px 9px;border-radius:6px;font-size:12px}
    .bu-pw{overflow-x:auto}
    @media (max-width:600px){.bu-urow{grid-template-columns:minmax(0,1fr)}.bu-steps{grid-template-columns:1fr}.bu-form .two{grid-template-columns:1fr}.bu-paper .sig{grid-template-columns:1fr}.bu-nurses{grid-template-columns:minmax(0,1fr)}}
    @media print{body.bu-printing>*:not(#bu-printroot){display:none!important}#bu-printroot{display:block!important}#bu-printroot .bu-paper{border-radius:0;padding:0}}
  </style>`;

  /* =====================================================================
   * #13 · HEMŞİRE İŞ YÜKÜ
   * Kaynak: H.data.tasks (pid, t, state), hasta atamaları (p.nurse), hemşire hesapları (role hemsire, units).
   * Puan/ölçek YOK: yalnız sayım. Geciken iş birime yazılır, hemşire satırında gösterilmez.
   * ===================================================================== */
  const WL = { unit:"" };
  const ST_COL = { done:"color-mix(in srgb,var(--ok) 45%,var(--card2))", late:"var(--crit)", due:"var(--high)", plan:"var(--pri)" };

  const drawHours = (svg, tasks) => {
    const W = Math.max(260, Math.floor(svg.parentElement.clientWidth || 600)), Hh = 170, pl = 26, pr = 6, pt = 16, pb = 22;
    const b = Array.from({ length:24 }, () => ({ done:0, late:0, due:0, plan:0 }));
    tasks.forEach(x => { const i = Math.floor(x.t) - 8; if (i >= 0 && i < 24) b[i][x.state]++; });
    const mx = Math.max(1, ...b.map(c => c.done + c.late + c.due + c.plan)), bw = (W - pl - pr) / 24;
    const y = (v) => pt + (1 - v / mx) * (Hh - pt - pb);
    let s = "";
    [0, Math.round(mx / 2), mx].filter((v, i, a) => a.indexOf(v) === i).forEach(v => { s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)"/><text x="${pl - 5}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" style="fill:var(--mute)">${v}</text>`; });
    b.forEach((c, i) => { let acc = 0; ["done", "late", "due", "plan"].forEach(k => { if (!c[k]) return; const y0 = y(acc), y1 = y(acc + c[k]);
      s += `<rect x="${(pl + i * bw + 1).toFixed(1)}" y="${y1.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${(y0 - y1).toFixed(1)}" rx="1.5" style="fill:${ST_COL[k]}"><title>${hh(8 + i)} · ${t("st_" + k)}: ${c[k]}</title></rect>`; acc += c[k]; }); });
    const step = W < 520 ? 4 : 2;
    for (let i = 0; i < 24; i += step) s += `<text x="${(pl + i * bw + bw / 2).toFixed(1)}" y="${Hh - 6}" text-anchor="middle" font-size="10" style="fill:var(--mute)">${hh(8 + i).slice(0, 2)}</text>`;
    const X = (pl + (NOW - 8) * bw).toFixed(1);
    s += `<line x1="${X}" x2="${X}" y1="${pt - 6}" y2="${Hh - pb}" style="stroke:var(--ink)" stroke-dasharray="3 3" opacity=".7"/><text x="${X}" y="${pt - 8}" text-anchor="middle" font-size="10" font-weight="700" style="fill:var(--ink)">${t("wl_now")} ${H.now()}</text>`;
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`); svg.setAttribute("height", Hh); svg.innerHTML = s;
  };

  const wlModel = () => {
    const units = scopeUnits().filter(H.isClinical);
    const pts = H.myPatients().filter(p => units.some(u => u.id === bedOf(p).unitId));
    const pids = new Set(pts.map(p => p.id));
    const tasks = H.data.tasks.filter(x => pids.has(x.pid));
    const left = (pid) => tasks.filter(x => x.pid === pid && x.state !== "done").length;
    const rows = units.map(u => { const up = pts.filter(p => bedOf(p).unitId === u.id), ut = tasks.filter(x => up.some(p => p.id === x.pid));
      const nurses = [...new Set(up.map(p => p.nurse).filter(Boolean))];
      const rem = ut.filter(x => x.state !== "done").length;
      return { u, pts:up, nurses, unas:up.filter(p => !p.nurse), high:up.filter(p => HIGH.has(p.risk)).length, late:ut.filter(x => x.state === "late").length, rem, per:nurses.length ? rem / nurses.length : null };
    }).filter(r => r.pts.length);
    const withN = rows.filter(r => r.per != null), avg = withN.length ? withN.reduce((a, r) => a + r.per, 0) / withN.length : 0;
    const nurseIds = [...new Set(pts.map(p => p.nurse).filter(Boolean))];
    const nurses = nurseIds.map(id => { const np = pts.filter(p => p.nurse === id); return { id, name:nurseName(id), pts:np, left:np.reduce((a, p) => a + left(p.id), 0), high:np.filter(p => HIGH.has(p.risk)).length }; })
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
    return { units, pts, tasks, rows, avg, nurses, left };
  };

  const suggest = (m) => {
    const out = [];
    // 1) atanmamış hasta
    m.pts.filter(p => !p.nurse).forEach(p => { const uid = bedOf(p).unitId;
      const auth = H.data.users.filter(x => x.role === "hemsire" && x.active !== false && (x.units || []).includes(uid)).map(x => x.name);
      out.push(t("wl_m_unas", { bed:E(bedOf(p).no), list:auth.length ? E(auth.join(", ")) : t("wl_m_none") })); });
    // 2) aynı birime yetkili iki hemşire arasında tek hasta taşıma (farkı azaltıyorsa)
    const load = {}; m.nurses.forEach(n => { load[n.id] = n.left; });
    const moves = [];
    m.nurses.forEach(a => a.pts.forEach(p => { const uid = bedOf(p).unitId, lp = m.left(p.id);
      m.nurses.forEach(b => { if (b.id === a.id) return; const bu = H.userBy(b.id); if (!bu || !(bu.units || []).includes(uid)) return;
        const before = Math.abs(load[a.id] - load[b.id]), after = Math.abs((load[a.id] - lp) - (load[b.id] + lp));
        if (after < before && !HIGH.has(p.risk)) moves.push({ p, a, b, lp, gain:before - after }); }); }));
    moves.sort((x, y) => y.gain - x.gain).slice(0, 3).forEach(mv => out.push(t("wl_m_move", { bed:E(bedOf(mv.p).no), a:E(mv.a.name), b:E(mv.b.name), a1:load[mv.a.id], a2:load[mv.a.id] - mv.lp, b1:load[mv.b.id], b2:load[mv.b.id] + mv.lp })));
    // 3) birimde tek yetkili hemşire
    m.rows.forEach(r => { const auth = H.data.users.filter(x => x.role === "hemsire" && x.active !== false && (x.units || []).includes(r.u.id));
      if (auth.length === 1) out.push(t("wl_m_single", { u:E(r.u.tr), n:E(auth[0].name) })); });
    if (!moves.length && m.nurses.length > 1) out.push(t("wl_m_flat"));
    // 4) vardiyanın kalanındaki en yoğun saat
    const ahead = {}; m.tasks.filter(x => x.state !== "done").forEach(x => { const h = Math.floor(x.t); ahead[h] = (ahead[h] || 0) + 1; });
    const pk = Object.entries(ahead).sort((a, b) => b[1] - a[1])[0];
    if (pk) out.push(t("wl_m_peak", { h:H.when(+pk[0] % 24), n:pk[1] }));
    return out;
  };

  H.register("workload", { title:() => t("m_workload"), perm:["staff_view", "occupancy"], render(root) {
    const m = wlModel();
    if (WL.unit && !m.rows.some(r => r.u.id === WL.unit)) WL.unit = "";
    if (!m.rows.length) { root.innerHTML = CSS + `<div class="ph"><div><h2>${t("m_workload")}</h2></div></div><div class="empty">${t("wl_empty")}</div>`; return; }
    const allN = new Set(m.pts.map(p => p.nurse).filter(Boolean)).size;
    const late = m.tasks.filter(x => x.state === "late").length, rem = m.tasks.filter(x => x.state !== "done").length, unas = m.pts.filter(p => !p.nurse).length;
    const maxPer = Math.max(1, ...m.rows.map(r => r.per || 0));
    const shiftTasks = WL.unit ? m.tasks.filter(x => bedOf(H.pt(x.pid)).unitId === WL.unit) : m.tasks;
    const aheadCnt = {}; shiftTasks.filter(x => x.state !== "done" && x.t >= Math.floor(NOW)).forEach(x => { const h = Math.floor(x.t); aheadCnt[h] = (aheadCnt[h] || 0) + 1; });
    const peak = Object.entries(aheadCnt).sort((a, b) => b[1] - a[1])[0];
    root.innerHTML = CSS + `<div class="ph"><div><h2>${I("users")} ${t("m_workload")}</h2><p>${t("wl_sub", { d:H.nowFull() })}${H.showNames() ? "" : " · " + t("no_name")}</p></div>
        <div class="r"><button class="btn p" data-bu-redis>${I("swap")} ${t("wl_redis")}</button></div></div>
      <div class="att">
        <div class="ac ok"><div class="i">${I("bed")}</div><b>${m.pts.length}</b><span>${t("wl_c_pts", { n:allN })}</span></div>
        <div class="ac ok"><div class="i">${I("users")}</div><b>${allN ? fmt(m.pts.filter(p => p.nurse).length / allN) : "—"}</b><span>${t("wl_c_ratio")}</span></div>
        <div class="ac ${late ? "crit" : "ok"}"><div class="i">${I("clock")}</div><b>${late}</b><span>${t("wl_c_late")}</span></div>
        <div class="ac ${unas ? "crit" : "ok"}"><div class="i">${I("userPlus")}</div><b>${unas}</b><span>${t("wl_c_unas")}</span></div></div>
      <div class="sec">${t("wl_sec_units")} <small>${t("wl_sec_units_s")}</small></div>
      <div class="tw"><table class="t"><tr><th>${t("unit")}</th><th>${t("patient")}</th><th>${t("wl_th_nurses")}</th><th>${t("wl_th_ratio")}</th><th>${t("wl_th_risk")}</th><th>${t("wl_th_late")}</th><th>${t("wl_th_left")}</th><th style="min-width:170px">${t("wl_th_per")}</th></tr>
        ${m.rows.map(r => { const above = r.per != null && m.avg && r.per > m.avg * 1.0001 && m.rows.length > 1;
          return `<tr><td><b>${E(r.u.tr)}</b><div class="bu-mute">${E(H.kindName(r.u.kind))}</div></td><td class="n">${r.pts.length}</td>
            <td class="n">${r.nurses.length || `<span class="tag c">${t("wl_no_nurse")}</span>`}${r.unas.length && r.nurses.length ? ` <span class="tag c">+${r.unas.length} ${t("wl_unas").toLowerCase()}</span>` : ""}</td>
            <td class="n">${r.nurses.length ? fmt(r.pts.filter(p => p.nurse).length / r.nurses.length) : "—"}</td><td class="n">${r.high}</td>
            <td class="n">${r.late ? `<span class="tag c">${r.late}</span>` : "0"}</td><td class="n">${r.rem}</td>
            <td>${r.per == null ? "—" : `<div style="display:flex;gap:8px;align-items:center"><div class="bu-hb" style="flex:1"><i style="width:${Math.round(r.per / maxPer * 100)}%;--c:${above ? "var(--high)" : "var(--pri)"}"></i></div><b class="bu-mono">${fmt(r.per)}</b></div>${above ? `<span class="tag w" style="margin-top:4px">${t("wl_above", { x:fmt(r.per / m.avg) })}</span>` : ""}`}</td></tr>`; }).join("")}
      </table></div>
      <div class="sec">${t("wl_sec_shift")} <small>${t("wl_sec_shift_s", { a:H.SHIFT.start, b:H.SHIFT.end })}</small></div>
      <div class="bu-card"><div class="bu-bar" style="margin-top:0"><select data-bu-wu><option value="">${t("all_units")}</option>${m.rows.map(r => `<option value="${r.u.id}" ${WL.unit === r.u.id ? "selected" : ""}>${E(r.u.tr)}</option>`).join("")}</select>
          ${peak ? `<span class="tag w">${t("wl_peak", { h:H.when(+peak[0] % 24), n:peak[1] })}</span>` : ""}</div>
        <div class="bu-chart"><svg data-bu-hours></svg></div>
        <div class="bu-legend">${["done", "late", "due", "plan"].map(k => `<span style="--c:${ST_COL[k]}">${t("st_" + k)}</span>`).join("")}</div></div>
      <div class="sec">${t("wl_sec_nurse")} <small>${t("wl_sec_nurse_s")}</small></div>
      <div class="bu-nurses">${m.nurses.map(n => `<div class="bu-card bu-nurse"><div class="bu-ntop"><b>${E(n.name)}</b><span class="bu-mute">${E([...new Set(n.pts.map(p => unitOf(p).tr))].join(" · "))}</span></div>
          <div class="bu-nmeta"><span class="pill">${t("wl_pts", { n:n.pts.length })}</span><span class="pill">${t("wl_left", { n:n.left })}</span>${n.high ? `<span class="pill">${t("wl_hr", { n:n.high })}</span>` : ""}</div>
          <div class="bu-chips">${n.pts.map(p => `<span class="bu-chip ${p.risk === "crit" ? "c" : p.risk === "high" ? "h" : ""}" title="${E(t("wl_left", { n:m.left(p.id) }))}"><i class="bu-dot" style="--c:${(H.SEV[p.risk] || H.SEV.stable).c}"></i>${ptLabel(p)}</span>`).join("")}</div></div>`).join("")}
        ${m.pts.some(p => !p.nurse) ? `<div class="bu-card bu-nurse" style="border-color:color-mix(in srgb,var(--crit) 45%,transparent)"><div class="bu-ntop"><b>${t("wl_unas")}</b></div>
          <div class="bu-chips" style="margin-top:8px">${m.pts.filter(p => !p.nurse).map(p => `<span class="bu-chip"><i class="bu-dot" style="--c:${(H.SEV[p.risk] || H.SEV.stable).c}"></i>${ptLabel(p)} <span class="bu-mute">${E(unitOf(p).tr)}</span></span>`).join("")}</div></div>` : ""}</div>
      <div class="note i" style="margin-top:14px">${t("wl_note")}</div>
      ${H.adminNote("İş yükü ölçeği ve hedef hasta/hemşire oranı hastane tarafından seçilir ve onaylanır; sistem puan üretmez, yalnız iş sayar.", "div")}`;
    drawHours(root.querySelector("[data-bu-hours]"), shiftTasks);
    root.addEventListener("change", e => { const s = e.target.closest("[data-bu-wu]"); if (s) { WL.unit = s.value; H.renderApp(); } });
    root.addEventListener("click", e => {
      if (!e.target.closest("[data-bu-redis]")) return;
      const lines = suggest(m);
      H.log("İş yükü · yeniden dağıtım önerisi görüntülendi", lines.length + " öneri");
      H.modal({ title:t("wl_redis"), body:`<div class="note i" style="margin-bottom:12px">${t("wl_m_intro")}</div><ul style="margin:0;padding-left:18px;display:grid;gap:8px;font-size:13.5px">${lines.map(l => `<li>${l}</li>`).join("")}</ul>`,
        actions:`<button class="btn" data-x>${t("close")}</button><button class="btn p" data-bu-note>${I("edit")} ${t("wl_m_save")}</button>`,
        onMount(md) { md.addEventListener("click", ev => { if (ev.target.closest("[data-bu-note]")) { H.log("İş yükü · öneri not alındı", lines.join(" | ").replace(/<[^>]+>/g, "")); H.closeModal(); H.toast(t("wl_m_saved")); } }); } });
    });
  } });

  /* =====================================================================
   * #14 · ENFEKSİYON KONTROL GÖRÜNÜMÜ
   * Cihaz günleri: önce hemşire faaliyet kaydı (H.data.nursing.ongoing: CVP / Mesane sonda / Entübasyon).
   * Faaliyet kaydı olmayan yoğun bakım / kemik iliği hastasında hasta kimliğinden deterministik türetilir (cihaz entegrasyonu yerine).
   * Ventilatör türetilmez: oksijen alanı invaziv destek göstermiyorsa çelişki üretir.
   * Enfeksiyon oranı UYDURULMAZ: olay kaydı yok → yalnız formül.
   * ===================================================================== */
  const INF = { unit:"" };
  const DEV_RE = { cvc:/^(CVP|Santral|Diyaliz kateteri)/i, uc:/Mesane sonda|Foley|Üriner/i, vent:/^(Entübasyon|Trakeostomi)$/i };
  const devicesOf = (p) => {
    const rec = ((H.data.nursing || {}).ongoing || []).filter(o => o.pid === p.id), out = { cvc:0, uc:0, vent:0, src:null };
    if (rec.length) { Object.keys(DEV_RE).forEach(k => { const r = rec.find(o => DEV_RE[k].test(o.name)); if (r) out[k] = Math.max(1, r.day || 1); }); out.src = "rec"; }
    else { const u = unitOf(p); if (u && (u.type === "icu" || u.type === "nicu" || u.kind === "bmt")) { const s = hash(p.id), d = Math.max(1, p.admitDays || 1);
      if (s % 3 !== 0 || u.kind === "bmt") out.cvc = 1 + (s >> 3) % d;
      if (p.ageGroup !== "neonate" && (s >> 5) % 2 === 0) out.uc = 1 + (s >> 7) % d;
      if (/ventil|entübe|mekanik|NIV/i.test((p.v || {}).o2 || "")) out.vent = d;
      out.src = "dev"; } }
    return out;
  };

  H.register("infection", { title:() => t("m_infection"), perm:["quality", "beds"], render(root) {
    if (INF.unit && !scopeUnits().some(u => u.id === INF.unit)) INF.unit = "";
    const units = scopeUnits().filter(u => !INF.unit || u.id === INF.unit), uid = new Set(units.map(u => u.id));
    const pts = H.myPatients().filter(p => uid.has(bedOf(p).unitId));
    const devs = pts.map(p => ({ p, d:devicesOf(p) })), withDev = devs.filter(x => x.d.cvc || x.d.uc || x.d.vent);
    const iso = pts.filter(p => p.isolation);
    const isoBeds = units.flatMap(u => u.beds.filter(b => b.iso).map(b => Object.assign(b, { unitId:u.id })));
    const freeIso = isoBeds.filter(b => b.status === "bos" && !b.oos).length, occIso = isoBeds.filter(b => b.status === "dolu").length;
    const abx = pts.filter(p => p.antibioticDay).sort((a, b) => b.antibioticDay - a.antibioticDay);
    const cnt = (k) => devs.filter(x => x.d[k]).length;
    const names = H.showNames();
    const perUnit = units.map(u => { const up = devs.filter(x => bedOf(x.p).unitId === u.id); const pd = up.reduce((a, x) => a + Math.max(1, x.p.admitDays || 1), 0);
      return { u, pd, cvc:up.reduce((a, x) => a + x.d.cvc, 0), uc:up.reduce((a, x) => a + x.d.uc, 0), vent:up.reduce((a, x) => a + x.d.vent, 0), n:up.length }; }).filter(r => r.n);
    const mxDev = Math.max(1, ...perUnit.flatMap(r => [r.cvc, r.uc, r.vent]));
    const roomState = (b) => { const p = b.pid && H.pt(b.pid);
      if (b.status === "dolu" && p) return p.isolation ? ["rs_iso", "var(--high)", p] : ["rs_noiso", "var(--mid)", p];
      return ({ bos:["rs_free", "var(--ok)"], temizlik:["rs_clean", "var(--mid)"], bloke:["rs_block", "var(--crit)"], rezerve:["rs_res", "var(--low)"] })[b.status] || ["rs_free", "var(--ok)"]; };
    const DC = { cvc:"var(--pri)", uc:"var(--low)", vent:"var(--high)" };
    root.innerHTML = CSS + `<div class="ph"><div><h2>${I("shield")} ${t("m_infection")}</h2><p>${t("in_sub", { d:H.nowFull() })}${names ? "" : " · " + t("no_name")}</p></div>
        <div class="r"><select data-bu-iu style="width:auto"><option value="">${t("all_units")}</option>${scopeUnits().map(u => `<option value="${u.id}" ${INF.unit === u.id ? "selected" : ""}>${E(u.tr)}</option>`).join("")}</select></div></div>
      <div class="att">
        <div class="ac ${iso.length ? "" : "ok"}"><div class="i">${I("shield")}</div><b>${iso.length}</b><span>${t("in_c_iso")}</span></div>
        <div class="ac ok"><div class="i">${I("bed")}</div><b>${freeIso} / ${isoBeds.length}</b><span>${t("in_c_room")}</span></div>
        <div class="ac ok"><div class="i">${I("syringe")}</div><b>${cnt("cvc")} · ${cnt("uc")} · ${cnt("vent")}</b><span>${t("dv_cvc")} · ${t("dv_uc")} · ${t("dv_vent")}</span></div>
        <div class="ac ok"><div class="i">${I("pill")}</div><b>${abx.length}</b><span>${t("in_c_abx")}</span></div></div>
      <div class="sec">${t("in_sec_iso")}</div>
      ${iso.length ? `<div class="tw"><table class="t"><tr><th>${t("bed")}</th>${names ? `<th>${t("patient")}</th>` : ""}<th>${t("unit")}</th><th>${t("in_th_iso")}</th><th>${t("in_th_room")}</th></tr>
        ${iso.map(p => { const b = bedOf(p); return `<tr><td class="bu-mono">${E(b.no)}</td>${names ? `<td>${E(shortName(p))}</td>` : ""}<td>${E(unitOf(p).tr)}</td><td><span class="tag w">${E(isoName(p.isolation))}</span></td>
          <td>${b.iso ? `<span class="tag">${t("in_iso_room")}</span>` : `<span class="tag c">${t("in_not_iso_room")}</span>`}</td></tr>`; }).join("")}</table></div>` : `<div class="empty">${t("in_iso_none")}</div>`}
      ${isoBeds.length ? `<div class="sec">${t("in_sec_rooms")} <small>${t("in_rooms_s", { a:occIso, b:freeIso })}</small></div>
      <div class="bu-rooms">${isoBeds.map(b => { const [k, c, p] = roomState(b); return `<div class="bu-room" style="--c:${c}"><b>${E(b.no)}</b><small>${E(H.unit(b.unitId).tr)} · ${E(b.room)}</small><small>${t(k)}${p && names ? " · " + E(shortName(p)) : ""}</small></div>`; }).join("")}</div>` : ""}
      <div class="sec">${t("in_sec_dev")} <small>${t("in_dev_s", { d:H.nowFull() })}</small></div>
      ${withDev.length ? `<div class="tw"><table class="t"><tr><th>${t("bed")}</th>${names ? `<th>${t("patient")}</th>` : ""}<th>${t("unit")}</th><th>${t("dv_cvc")}</th><th>${t("dv_uc")}</th><th>${t("dv_vent")}</th><th>${t("in_th_src")}</th></tr>
        ${withDev.map(({ p, d }) => `<tr><td class="bu-mono">${E(bedOf(p).no)}</td>${names ? `<td>${E(shortName(p))}</td>` : ""}<td>${E(unitOf(p).tr)}</td>${["cvc", "uc", "vent"].map(k => `<td class="n">${d[k] ? `<b>${t("day_n", { n:d[k] })}</b>` : "—"}</td>`).join("")}<td class="bu-mute">${t(d.src === "rec" ? "src_rec" : "src_dev")}</td></tr>`).join("")}</table></div>` : `<div class="empty">${t("in_dev_none")}</div>`}
      <div class="sec">${t("in_sec_unit")}</div>
      <div class="bu-dgrid">
        <div class="bu-card"><div class="bu-legend" style="margin:0 0 6px">${["cvc", "uc", "vent"].map(k => `<span style="--c:${DC[k]}">${t("dv_" + k)}</span>`).join("")}</div>
          <div class="bu-dev">${perUnit.filter(r => r.cvc + r.uc + r.vent).map(r => `<div class="bu-urow"><div class="n" title="${E(r.u.tr)}">${E(r.u.tr)}</div><div class="bars">${["cvc", "uc", "vent"].map(k => `<div><div class="bu-hb"><i style="width:${Math.round(r[k] / mxDev * 100)}%;--c:${DC[k]}"></i></div><span>${r[k]}</span></div>`).join("")}</div></div>`).join("") || `<div class="bu-mute">—</div>`}</div></div>
        <div class="tw"><table class="t"><tr><th>${t("unit")}</th><th>${t("in_th_pd")}</th><th>${t("dv_cvc")}</th><th>${t("dv_uc")}</th><th>${t("dv_vent")}</th><th>${t("in_th_util")}</th></tr>
          ${perUnit.map(r => `<tr><td><b>${E(r.u.tr)}</b></td><td class="n">${r.pd}</td><td class="n">${r.cvc}</td><td class="n">${r.uc}</td><td class="n">${r.vent}</td><td class="n">${r.pd ? fmt(r.cvc / r.pd, 2) : "—"}</td></tr>`).join("")}</table></div></div>
      <p class="bu-f">${t("in_f_util")}</p><p class="bu-f">${t("in_f_rate")}</p>
      ${H.adminNote(t("in_adm"), "div")}
      <div class="sec">${t("in_sec_abx")}</div>
      ${abx.length ? `<div class="tw"><table class="t"><tr><th>${t("bed")}</th>${names ? `<th>${t("patient")}</th>` : ""}<th>${t("unit")}</th><th>${t("in_th_day")}</th><th>${t("in_th_iso")}</th></tr>
        ${abx.map(p => `<tr><td class="bu-mono">${E(bedOf(p).no)}</td>${names ? `<td>${E(shortName(p))}</td>` : ""}<td>${E(unitOf(p).tr)}</td><td class="n"><b>${t("day_n", { n:p.antibioticDay })}</b></td><td>${p.isolation ? `<span class="tag w">${E(isoName(p.isolation))}</span>` : "—"}</td></tr>`).join("")}</table></div>` : `<div class="empty">${t("in_abx_none")}</div>`}`;
    root.addEventListener("change", e => { const s = e.target.closest("[data-bu-iu]"); if (s) { INF.unit = s.value; H.renderApp(); } });
  } });

  /* =====================================================================
   * #18 · PİLOT BAŞLANGIÇ ÖLÇÜMÜ VE SONUÇ RAPORU
   * Değer yok → "ölçüm başlamadı". Pilot sonrası değeri sistem pilot bitince kendi kayıtlarından hesaplar; burada UYDURULMAZ.
   * Başlangıç değeri elle girilir (kim, ne zaman, hangi yöntemle) ve denetim kaydına yazılır.
   * ===================================================================== */
  const PM = [
    { k:"resp", n:["Siqnala cavab müddəti", "Alarm yanıt süresi", "Время ответа на тревогу", "Alarm response time"], u:["dəq:san", "dk:sn", "мин:сек", "min:sec"],
      d:["Siqnalın açılmasından ilk cavaba (“gördüm” / yatağa gəliş) qədər keçən müddətin medianı.", "Alarmın açılmasından ilk yanıta (“gördüm” / yatağa varış) kadar geçen sürenin ortancası.", "Медиана времени от срабатывания тревоги до первого ответа («принято» / подход к койке).", "Median time from alarm onset to first response (acknowledged / at bedside)."],
      s:["Pilotdan əvvəl: əllə ölçmə və ya monitor mərkəzi qeydi. Pilotda: siqnal zaman damğaları (audit jurnalı).", "Pilot öncesi: elle ölçüm ya da monitör santrali kaydı. Pilotta: alarm zaman damgaları (denetim kaydı).", "До пилота: ручной замер или журнал центральной станции. В пилоте: отметки времени тревог (журнал аудита).", "Before: manual timing or central-station log. During: alarm timestamps (audit log)."] },
    { k:"esc", n:["Eskalasiya nisbəti", "Eskalasyon oranı", "Доля эскалаций", "Escalation rate"], u:["%", "%", "%", "%"],
      d:["Eskalasiya pilləsinə (həkim / təcili cavab) çatan siqnal ÷ bütün klinik siqnallar × 100.", "Eskalasyon basamağına (hekim / hızlı yanıt) ulaşan alarm ÷ tüm klinik alarmlar × 100.", "Тревоги, дошедшие до эскалации (врач / бригада) ÷ все клинические тревоги × 100.", "Alarms reaching an escalation step (physician / rapid response) ÷ all clinical alarms × 100."],
      s:["Pilotdan əvvəl: çağırış jurnalı / sənəd incələməsi. Pilotda: eskalasiya qeydi.", "Pilot öncesi: çağrı defteri / dosya incelemesi. Pilotta: eskalasyon kaydı.", "До пилота: журнал вызовов / анализ историй. В пилоте: журнал эскалаций.", "Before: call book / chart review. During: escalation log."] },
    { k:"miss", n:["Qaçırılmış pisləşmə", "Kaçırılan kötüleşme", "Пропущенное ухудшение", "Missed deterioration"], u:["/ 1000 xəstə-gün", "/ 1000 hasta-gün", "/ 1000 пациенто-дней", "/ 1000 patient days"],
      d:["Planlaşdırılmamış reanimasiyaya keçid, təcili cavab çağırışı və ya arrestdən əvvəlki saatlarda meyarlar qarşılandığı halda cavab qeydi olmayan hadisələr ÷ xəstə-gün × 1000. Tərif pilot protokolundadır.", "Planlanmamış yoğun bakım transferi, hızlı yanıt çağrısı ya da arrest öncesi saatlerde kriterler karşılandığı hâlde yanıt kaydı olmayan olaylar ÷ hasta-gün × 1000. Tanım pilot protokolündedir.", "Незапланированный перевод в ОРИТ, вызов бригады или остановка, когда критерии выполнялись, а ответа не было ÷ пациенто-дни × 1000. Определение — в протоколе пилота.", "Unplanned ICU transfer, rapid-response call or arrest where criteria were met beforehand with no recorded response ÷ patient days × 1000. Defined in the pilot protocol."],
      s:["Hər iki dövr: retrospektiv sənəd incələməsi (keyfiyyət), pilotda siqnal və eskalasiya qeydi ilə.", "Her iki dönem: geriye dönük dosya incelemesi (kalite); pilotta alarm ve eskalasyon kaydıyla birlikte.", "Оба периода: ретроспективный анализ историй (качество); в пилоте вместе с журналом тревог.", "Both periods: retrospective chart review (quality); during the pilot together with alarm and escalation logs."] },
    { k:"hand", n:["Növbə təhvili müddəti", "Vardiya devri süresi", "Длительность передачи смены", "Shift handover time"], u:["dəq", "dk", "мин", "min"],
      d:["Təhvilin başlamasından qarşı imzaya qədər keçən müddətin medianı (xəstə başına).", "Devrin başlamasından karşı imzaya kadar geçen sürenin ortancası (hasta başına).", "Медиана времени от начала передачи до встречной подписи (на пациента).", "Median time from handover start to counter-signature (per patient)."],
      s:["Pilotdan əvvəl: yerində müşahidə, saniyəölçən. Pilotda: təhvil qeydi (başlama / imza).", "Pilot öncesi: yerinde gözlem, kronometre. Pilotta: devir kaydı (başlama / imza).", "До пилота: наблюдение с секундомером. В пилоте: журнал передачи (начало / подпись).", "Before: on-site observation with stopwatch. During: handover record (start / signature)."] },
    { k:"gap", n:["Məlumat çatışmazlığı", "Veri eksikliği", "Неполнота данных", "Missing data"], u:["%", "%", "%", "%"],
      d:["Gözlənilən ölçmə / formlardan vaxtında daxil edilməyənlər ÷ gözlənilənlər × 100; cihaz məlumat kəsintisi ayrıca dəqiqə ilə.", "Beklenen ölçüm / formlardan zamanında girilmeyenler ÷ beklenenler × 100; cihaz veri kesintisi ayrıca dakika olarak.", "Не внесённые вовремя замеры / формы ÷ ожидаемые × 100; перерывы данных приборов отдельно, в минутах.", "Expected observations / forms not entered on time ÷ expected × 100; device data gaps separately, in minutes."],
      s:["Pilotdan əvvəl: kağız qrafik incələməsi. Pilotda: tibb bacısı tapşırıqları və cihaz bağlantı qeydi.", "Pilot öncesi: kâğıt çizelge incelemesi. Pilotta: hemşire görevleri ve cihaz bağlantı kaydı.", "До пилота: анализ бумажных листов. В пилоте: сестринские задачи и журнал подключения приборов.", "Before: paper chart review. During: nursing tasks and device connection log."] },
  ];
  const PL = { base:{}, start:"", end:"" };
  const L = (a) => a[LI[H.state.lang] ?? 1];
  const MU = (m) => L(m.u);
  const today = () => { const d = H.DAY0; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dmy = (iso) => iso ? iso.split("-").reverse().join(".") : "—";
  const phase = () => { if (!PL.start) return null; const d = today(); return d < PL.start ? "base" : PL.end && d > PL.end ? "done" : "run"; };
  const postCell = () => { const ph = phase(); return ph === "run" ? `<span class="bu-ns">${t("pl_running")}</span>` : `<span class="bu-ns">${t("pl_ns")}</span>`; };
  const baseCell = (m, forPrint) => { const b = PL.base[m.k]; if (!b) return forPrint ? t("pl_ns") : `<span class="bu-ns">${t("pl_ns")}</span>`;
    return `<b class="bu-mono">${E(b.v)}</b> <span class="bu-mute">${E(MU(m))}</span><div class="bu-mute">${dmy(b.from)} – ${dmy(b.to)} · ${E(b.method)}</div><div class="bu-mute">${E(b.by)}</div>`; };

  const reportHtml = () => `<div class="bu-paper"><h1>${t("pl_rep_t")}</h1>
      <div class="m">${E(H.data.hospital.name)} · ${t("pl_rep_date")}: ${H.dmy(0)} · ${t("pl_cal")}: ${PL.start ? dmy(PL.start) + " – " + dmy(PL.end) : t("pl_undef")}</div>
      <p class="wrn" style="margin-top:12px">${t("pl_warn")}</p>
      <table><tr><th>${t("pl_th_m")}</th><th>${t("pl_th_def")}</th><th>${t("pl_th_src")}</th><th>${t("pl_th_pre")}</th><th>${t("pl_th_post")}</th><th>${t("pl_th_diff")}</th></tr>
        ${PM.map(m => { const b = PL.base[m.k]; return `<tr><td><b>${E(L(m.n))}</b><br><small>${E(MU(m))}</small></td><td>${E(L(m.d))}</td><td>${E(L(m.s))}</td>
          <td>${b ? `<b>${E(b.v)}</b> ${E(MU(m))}<br><small>${dmy(b.from)} – ${dmy(b.to)} · ${E(b.method)} · ${E(b.by)}</small>` : t("pl_ns")}</td><td>${phase() === "run" ? t("pl_running") : t("pl_ns")}</td><td>—</td></tr>`; }).join("")}</table>
      <p class="m">${t("pl_rep_note")}</p>
      <div class="sig"><div>${t("pl_rep_prep")}: ${E(H.state.user.name)}</div><div>${t("pl_rep_q")}</div><div>${t("pl_rep_head")}</div></div></div>`;

  const doPrint = () => {
    let pr = document.getElementById("bu-printroot"); if (pr) pr.remove();
    pr = document.createElement("div"); pr.id = "bu-printroot"; pr.style.display = "none"; pr.innerHTML = reportHtml(); document.body.appendChild(pr);
    if (!document.getElementById("bu-printcss")) { const st = document.createElement("style"); st.id = "bu-printcss";
      st.textContent = "@media print{body.bu-printing>*:not(#bu-printroot){display:none!important}#bu-printroot{display:block!important}.bu-paper{background:#fff;color:#111;font:12px/1.45 Figtree,sans-serif}.bu-paper h1{font:700 18px 'Space Grotesk',sans-serif;margin:0 0 4px}.bu-paper .m{color:#555;font-size:11px}.bu-paper table{width:100%;border-collapse:collapse;margin:12px 0;font-size:11px}.bu-paper th,.bu-paper td{border:1px solid #999;padding:5px 7px;text-align:left;vertical-align:top}.bu-paper th{background:#eee}.bu-paper .sig{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px}.bu-paper .sig div{border-top:1px solid #333;padding-top:4px}.bu-paper .wrn{border:1px solid #c9a227;background:#fff8dc;padding:6px 8px}@page{size:A4 landscape;margin:14mm}}";
      document.head.appendChild(st); }
    document.body.classList.add("bu-printing");
    const done = () => { document.body.classList.remove("bu-printing"); const x = document.getElementById("bu-printroot"); if (x) x.remove(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    H.log("Pilot raporu yazdırıldı", PM.filter(m => PL.base[m.k]).length + "/" + PM.length + " başlangıç ölçümü");
    try { window.print(); } catch (e) { done(); }
  };

  const baseModal = (m, rerender) => {
    const b = PL.base[m.k] || {}, methods = ["mt_manual", "mt_chart", "mt_his", "mt_obs"].map(k => t(k));
    H.modal({ title:`${E(L(m.n))} · ${t("pl_th_pre")}`, body:`<div class="bu-form">
        <p class="bu-f" style="margin:0">${E(L(m.d))}</p>
        <label>${t("pl_value")} (${E(MU(m))})<input data-f="v" value="${E(b.v || "")}" inputmode="decimal"></label>
        <div class="two"><label>${t("pl_period")} · ${t("pl_start")}<input type="date" data-f="from" value="${E(b.from || "")}"></label><label>${t("pl_end")}<input type="date" data-f="to" value="${E(b.to || "")}"></label></div>
        <label>${t("pl_method")}<select data-f="method">${methods.map(x => `<option ${b.method === x ? "selected" : ""}>${E(x)}</option>`).join("")}</select></label>
        <label>${t("pl_by")}<input data-f="by" value="${E(b.by || H.state.user.name)}"></label>
        <p class="bu-f" style="margin:0">${E(L(m.s))}</p></div>`,
      actions:`<button class="btn" data-x>${t("close")}</button><button class="btn p" data-bu-save>${I("ok")} ${t("pl_save")}</button>`,
      onMount(md) { md.addEventListener("click", ev => { if (!ev.target.closest("[data-bu-save]")) return;
        const g = (f) => md.querySelector(`[data-f="${f}"]`).value.trim(), v = g("v"), from = g("from"), to = g("to");
        if (!v || !from || !to) return H.toast(t("pl_need"), "w");
        PL.base[m.k] = { v, from, to, method:g("method"), by:g("by") || H.state.user.name };
        H.log("Pilot başlangıç ölçümü girildi", `${L(m.n)} = ${v} ${MU(m)} · ${dmy(from)}–${dmy(to)}`);
        H.closeModal(); H.toast(t("pl_saved")); rerender(); }); } });
  };

  H.register("pilot", { title:() => t("m_pilot"), perm:["summary", "quality"], render(root) {
    const n = PM.filter(m => PL.base[m.k]).length, ph = phase(), edit = H.can("quality") || H.can("summary");
    const step = (k, lbl, sub) => `<div class="bu-step ${ph === k ? "on" : ""}"><small>${sub}</small><b>${lbl}</b></div>`;
    root.innerHTML = CSS + `<div class="ph"><div><h2>${I("chart")} ${t("pl_title")}</h2><p>${t("pl_sub", { d:H.nowFull() })}</p></div>
        <div class="r"><button class="btn" data-bu-print>${I("print")} ${t("pl_print")}</button></div></div>
      <div class="note">${t("pl_warn")}</div>
      <div class="bu-steps">${step("base", t("pl_ph_base"), "1")}${step("run", t("pl_ph_run"), "2")}${step("done", t("pl_ph_done"), "3")}</div>
      <div class="bu-card"><h5>${I("clock")} ${t("pl_cal")} <span class="r">${t("pl_progress", { n, m:PM.length })}</span></h5>
        <div class="bu-cal"><label>${t("pl_start")}<input type="date" data-bu-cal="start" value="${PL.start}" ${edit ? "" : "disabled"}></label><label>${t("pl_end")}<input type="date" data-bu-cal="end" value="${PL.end}" ${edit ? "" : "disabled"}></label>
          <span class="bu-mute">${PL.start ? `${dmy(PL.start)} – ${dmy(PL.end)}` : t("pl_undef")}</span></div>
        <div class="bu-hb" style="margin-top:10px"><i style="width:${Math.round(n / PM.length * 100)}%;--c:${n === PM.length ? "var(--ok)" : "var(--mid)"}"></i></div></div>
      <div class="sec">${t("pl_th_m")} <small>${t("pl_th_src").toLowerCase()} · ${t("pl_th_pre").toLowerCase()} · ${t("pl_th_post").toLowerCase()}</small></div>
      <div class="tw"><table class="t"><tr><th>${t("pl_th_m")}</th><th>${t("pl_th_def")}</th><th>${t("pl_th_src")}</th><th>${t("pl_th_pre")}</th><th>${t("pl_th_post")}</th><th>${t("pl_th_diff")}</th></tr>
        ${PM.map(m => `<tr><td style="min-width:140px"><b>${E(L(m.n))}</b><div class="bu-mute">${E(MU(m))}</div></td><td class="bu-def">${E(L(m.d))}</td><td class="bu-src">${E(L(m.s))}</td>
          <td style="min-width:150px">${baseCell(m)}${edit ? `<div style="margin-top:6px"><button class="btn sm" data-bu-base="${m.k}">${I(PL.base[m.k] ? "edit" : "plus")} ${t(PL.base[m.k] ? "pl_edit" : "pl_enter")}</button></div>` : ""}</td>
          <td>${postCell()}</td><td class="bu-mute">—</td></tr>`).join("")}</table></div>
      ${H.adminNote(t("pl_adm"), "div")}`;
    root.addEventListener("change", e => { const c = e.target.closest("[data-bu-cal]"); if (!c) return; PL[c.dataset.buCal] = c.value;
      if (PL.start && PL.end && PL.end < PL.start) PL.end = PL.start; H.log("Pilot takvimi değişti", `${dmy(PL.start)} – ${dmy(PL.end)}`); H.renderApp(); });
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-bu-base]"); if (b) return baseModal(PM.find(m => m.k === b.dataset.buBase), () => H.renderApp());
      if (e.target.closest("[data-bu-print]")) H.modal({ title:t("pl_rep_t"), wide:true, body:`<div class="bu-pw">${CSS}${reportHtml()}</div>`,
        actions:`<button class="btn" data-x>${t("close")}</button><button class="btn p" data-bu-doprint>${I("print")} ${t("pl_doprint")}</button>`,
        onMount(md) { md.addEventListener("click", ev => { if (ev.target.closest("[data-bu-doprint]")) doPrint(); }); } });
    });
  } });
})();
