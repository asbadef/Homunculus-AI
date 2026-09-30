/* Homunculus prototip v1 — hemşirelik bakım planı + sıvı izlem ızgarası (careplan.js).
 * Yükleme sırası: core → patient → nursing → careplan → admin → …
 *
 * Dışa verilenler:
 *   H.CARE_CATALOG            YAYIMDAKİ katalog (hemşirenin gördüğü) · [{ key, name, was?, group, ages?, opt?, hbys, causes[], goals[], acts[{t,l,f}], pending, empty }]
 *   H.CARE_CATALOG_LABEL      katalog etiketi
 *   H.careCatalog             sürümlü katalog verisi + yönetim API'si (admin.js "Bakım kataloğu" sekmesi kullanır):
 *                             { version, versions[], master[], rules[], fields, freqs, favs, hbysNames, status(m), edit(), discard(),
 *                               publish(by,kind,add,change), importPreview(), importApply(by), plansByVersion(), fieldName, levelName, freqName,
 *                               bölüme göre içerik (24.09): scopes, scopeName, scopesText, scopeOfUnit, packages, visibleIn, rowsIn, setVisible,
 *                               setFav, copyPackage, addRow, proposals, propose, decide, xlsxPreview(), xlsxApply(by) }
 *   H.carePlan = { html(p), after(el, p), summary(pid), suggestions(p), plans(pid) }
 *   H.data.tasks'a yazar      mühürlenen planın faaliyetleri sıklığıyla Görevlerim'e iş olarak düşer ({ src:"cp", cp, ai })
 *   H.fluidGrid = { html(p), after(el, p) }
 *   H.data.carePlans[pid]     bakım planı kayıtları (bellekte; sayfa yenilenince başa döner)
 *   H.data.ioGrid[pid]        sıvı ızgarası girişleri (bellekte)
 *
 * Ürün kuralları: sistem tanı koymaz, emir vermez, doz önermez. Hemşirelik tanısı hemşirenin kararıdır;
 * sistem yalnız ÖNERİ sunar ve öneri hemşire kabul etmeden plana girmez. Faaliyet metinlerinde ilaç adı/doz yoktur.
 * Öneri kurallarındaki eşikler (ağrı ≥4, ateş ≥38,3) Ozan'ın brifinginden gelir ve ekranda "örnek kural" diye yazılır.
 * Veri SENTETİKTİR; ad olarak yalnız core.js'teki ve devir listesindeki uydurma adlar kullanılır.
 */
(function () {
  const H = window.H;
  if (!H) return;
  const E = (s) => H.esc(s);
  const I = (k) => H.icon(k);
  const me = () => (H.state.user && H.state.user.name) || "—";
  const TODAY = "24.09";                                     // demo günü: 24.09.2026, nöbet 08–20 / 20–08
  const stamp = () => `${TODAY} ${H.now()}`;
  const norm = (s) => String(s || "").toLocaleLowerCase("tr");
  const seedOf = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 2147483646) + 1; };
  const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bedNo = (p) => { const b = H.bed(p.bed); return b ? b.no : p.bed; };

  /* 24.09 (3. oturum) · dil sözlüğü: ekran iskeleti (başlık, düğme, tablo başlığı, boş durum, toast, pencere, sıvı satırları).
   * KAPSAM DIŞI (Türkçe kalır): H.CARE_CATALOG — 25 tanının adı, grubu, seçenekleri (Evre…), nedenleri, hedefleri,
   * faaliyetleri. Hastanenin onaylayacağı klinik içerik. (24.09 Ozan: "katalog Türkçe / hastane onayı" gibi notlar kullanıcı
   * ekranında görünmez; onay/netleştirme notları yalnız H.adminNote ile yönetim yetkisi olana çizilir.)
   * Denetim kaydı (H.log) metinleri, hemşirenin yazdığı notlar ve core.js'ten gelen veri değerleri (yüksek/orta, Ek oksijen) de
   * kayıt/veri niteliğinde, çevrilmez. "Kaydet" düğmeleri Ozan'ın sözlüğüyle "Taslağı sakla" oldu (HBYS kelimesi kullanılmaz). */
  H.addT({
    cp_cat_label:{ AZ:"Qulluq planı kataloqu", TR:"Bakım planı kataloğu", RU:"Каталог планов ухода", EN:"Care plan catalogue" },
    cp_cat_line_tpl:{ AZ:"{label} · {n} diaqnoz", TR:"{label} · {n} tanı", RU:"{label} · диагнозов: {n}", EN:"{label} · {n} diagnoses" },
    cp_adm_cat:{ AZ:"Kataloq məzmunu xəstəxananın təsdiqi ilə İdarəetmə → Qulluq kataloqunda dəyişir; hazırda türkcədir.", TR:"Katalog içeriği hastanenin onayıyla Yönetim → Bakım kataloğu'nda değişir; şimdilik Türkçe.", RU:"Содержание каталога меняется с одобрения больницы в разделе Управление → Каталог ухода; пока на турецком.", EN:"Catalogue content changes with hospital approval under Admin → Care catalogue; Turkish for now." },
    cp_foot_tpl:{ AZ:"{label} · {n} diaqnoz. Fəaliyyətlər qulluq və müşahidə dilindədir; dərman və doza həkimin təyinatındadır, sistem təklif etmir.",
      TR:"{label} · {n} tanı. Faaliyetler bakım ve gözlem dilindedir; ilaç ve doz hekimin order'ındadır, sistem önermez.",
      RU:"{label} · диагнозов: {n}. Мероприятия сформулированы как уход и наблюдение; препараты и дозы — в назначениях врача, система их не предлагает.",
      EN:"{label} · {n} diagnoses. Interventions are written as care and observation; drugs and doses are in the physician's orders — the system does not suggest them." },
    // bakım planı sekmesi
    cp_title:{ AZ:"Tibb bacısı qulluq planı", TR:"Hemşirelik bakım planı", RU:"План сестринского ухода", EN:"Nursing care plan" },
    cp_head_active_tpl:{ AZ:"{n} aktiv diaqnoz", TR:"{n} aktif tanı", RU:"Активных диагнозов: {n}", EN:"{n} active diagnoses" },
    cp_head_shift_tpl:{ AZ:"bu növbə: {x}", TR:"bu vardiya {x}", RU:"эта смена: {x}", EN:"this shift: {x}" },
    cp_missing_tpl:{ AZ:"{n} qiymətləndirmə çatışmır", TR:"{n} değerlendirme eksik", RU:"без оценки: {n}", EN:"{n} assessment(s) missing" },
    cp_done:{ AZ:"tamamdır", TR:"tamam", RU:"готово", EN:"complete" },
    cp_btn_new:{ AZ:"Yeni diaqnoz", TR:"Yeni tanı", RU:"Новый диагноз", EN:"New diagnosis" },
    cp_opunit_note:{ AZ:"Bu bölmə əməliyyat qatındadır; sistem burada diaqnoz təklifi vermir. Plan əl ilə aparıla bilər.", TR:"Bu birim operasyonel katmanda; sistem burada tanı önerisi üretmez. Plan elle tutulabilir.", RU:"Это отделение на операционном уровне; система здесь не предлагает диагнозы. План можно вести вручную.", EN:"This unit is on the operational layer; the system makes no diagnosis suggestions here. The plan can be kept manually." },
    cp_sug_title:{ AZ:"Sistemin təklif etdiyi diaqnozlar", TR:"Sistemin önerdiği tanılar", RU:"Диагнозы, предложенные системой", EN:"Diagnoses suggested by the system" },
    cp_sug_sub:{ AZ:"xəstə qeydlərindən çıxarılıb · siz qəbul etmədən plana düşmür", TR:"hasta kayıtlarından türetildi · siz kabul etmeden plana girmez", RU:"выведены из записей пациента · не попадают в план без вашего согласия", EN:"derived from the patient record · not added to the plan until you accept" },
    cp_btn_add_plan:{ AZ:"Plana əlavə et", TR:"Plana ekle", RU:"Добавить в план", EN:"Add to plan" },
    cp_btn_dismiss:{ AZ:"Lazım deyil", TR:"Gerek yok", RU:"Не нужно", EN:"Not needed" },
    cp_sug_none:{ AZ:"Hazırda gözləyən təklif yoxdur.", TR:"Şu an bekleyen öneri yok.", RU:"Сейчас нет ожидающих предложений.", EN:"No pending suggestions right now." },
    cp_sug_foot:{ AZ:"Tibb bacısı diaqnozu qoymaq qərarı tibb bacısına aiddir.", TR:"Hemşirelik tanısı koyma kararı hemşirenindir.", RU:"Решение о сестринском диагнозе принимает медсестра.", EN:"The decision to make a nursing diagnosis is the nurse's." },
    cp_adm_sug_rules:{ AZ:"Təklif qaydaları İdarəetmə → Qulluq kataloqu → Təklif qaydalarında xəstəxananın təsdiqi ilə tənzimlənir.", TR:"Öneri kuralları Yönetim → Bakım kataloğu → Önerme kuralları'nda hastanenin onayıyla ayarlanır.", RU:"Правила предложений настраиваются с одобрения больницы: Управление → Каталог ухода → Правила предложений.", EN:"Suggestion rules are set with the hospital's approval under Admin → Care catalogue → Suggestion rules." },
    cp_sug_dismissed_tpl:{ AZ:"{n} təklif rədd edildi", TR:"{n} öneri geri çevrildi", RU:"отклонено предложений: {n}", EN:"{n} suggestion(s) declined" },
    cp_undo:{ AZ:"geri qaytar", TR:"geri al", RU:"отменить", EN:"undo" },
    cp_th_dx:{ AZ:"Tibb bacısı diaqnozu", TR:"Hemşirelik tanısı", RU:"Сестринский диагноз", EN:"Nursing diagnosis" },
    cp_today:{ AZ:"Bu gün", TR:"Bugün", RU:"Сегодня", EN:"Today" },
    cp_now:{ AZ:"indi", TR:"şimdi", RU:"сейчас", EN:"now" },
    cp_since_tpl:{ AZ:"{s}-dən bəri", TR:"{s}'den beri", RU:"с {s}", EN:"since {s}" },
    cp_ongoing:{ AZ:"Davam edir", TR:"Devam ediyor", RU:"Продолжается", EN:"Ongoing" },
    cp_t_info:{ AZ:"Səbəb, hədəf, fəaliyyətlər", TR:"Neden, hedef, faaliyetler", RU:"Причины, цели, мероприятия", EN:"Causes, goals, interventions" },
    cp_t_edit:{ AZ:"Düzəliş et", TR:"Düzenle", RU:"Изменить", EN:"Edit" },
    cp_t_hist:{ AZ:"Tarixçə", TR:"Tarihçe", RU:"История", EN:"History" },
    cp_t_end:{ AZ:"Sonlandır", TR:"Sonlandır", RU:"Завершить", EN:"End" },
    cp_h_causes:{ AZ:"Səbəblər / risk amilləri", TR:"Nedenler / risk faktörleri", RU:"Причины / факторы риска", EN:"Causes / risk factors" },
    cp_h_goals:{ AZ:"Hədəflər", TR:"Hedefler", RU:"Цели", EN:"Goals" },
    cp_h_acts:{ AZ:"Fəaliyyətlər", TR:"Faaliyetler", RU:"Мероприятия", EN:"Interventions" },
    cp_not_selected:{ AZ:"Seçilməyib", TR:"Seçilmedi", RU:"Не выбрано", EN:"None selected" },
    cp_warn_unmet_tpl:{ AZ:"<b>{name}</b>: son iki qiymətləndirmədə hədəfə çatılmadı. Planın (səbəb, hədəf, fəaliyyət) nəzərdən keçirilməsi tövsiyə olunur.",
      TR:"<b>{name}</b>: son iki değerlendirmede hedef karşılanmadı. Planın (neden, hedef, faaliyet) gözden geçirilmesi önerilir.",
      RU:"<b>{name}</b>: в двух последних оценках цель не достигнута. Рекомендуется пересмотреть план (причины, цели, мероприятия).",
      EN:"<b>{name}</b>: goal not met in the last two assessments. Reviewing the plan (causes, goals, interventions) is recommended." },
    cp_warn_gaps_tpl:{ AZ:"Son 3 gündə {n} növbə qiymətləndirməsi boş qalıb (boz ⊗). Gecikmiş qeyd daxil edilə bilər; “gecikmiş giriş” kimi işarələnir.",
      TR:"Son 3 günde {n} vardiya değerlendirmesi boş kalmış (gri ⊗). Geç kayıt girilebilir; \"geç giriş\" olarak işaretlenir.",
      RU:"За последние 3 дня не заполнено оценок смен: {n} (серый ⊗). Можно внести запись с опозданием; она помечается как «поздняя запись».",
      EN:"{n} shift assessment(s) left blank in the last 3 days (grey ⊗). A late entry can be made; it is marked as “late entry”." },
    cp_leg_met:{ AZ:"hədəfə çatıldı", TR:"hedef karşılandı", RU:"цель достигнута", EN:"goal met" },
    cp_leg_partial:{ AZ:"qismən", TR:"kısmen", RU:"частично", EN:"partly" },
    cp_leg_unmet:{ AZ:"çatılmadı", TR:"karşılanmadı", RU:"не достигнута", EN:"not met" },
    cp_leg_notassessed:{ AZ:"qiymətləndirilməyib", TR:"değerlendirilmedi", RU:"не оценено", EN:"not assessed" },
    cp_leg_thisshift:{ AZ:"bu növbə", TR:"bu vardiya", RU:"эта смена", EN:"this shift" },
    cp_assess:{ AZ:"Qiymətləndir", TR:"Değerlendir", RU:"Оценить", EN:"Assess" },
    cp_leg_tap:{ AZ:"xanaya toxunun → növbə qiymətləndirməsi", TR:"hücreye dokunun → vardiya değerlendirmesi", RU:"нажмите на ячейку → оценка смены", EN:"tap a cell → shift assessment" },
    cp_empty:{ AZ:"Bu xəstənin qulluq planında aktiv diaqnoz yoxdur.", TR:"Bu hastanın bakım planında aktif tanı yok.", RU:"В плане ухода этого пациента нет активных диагнозов.", EN:"This patient's care plan has no active diagnoses." },
    cp_empty_cat_tpl:{ AZ:"{btn} ilə kataloqdan seçə bilərsiniz.", TR:"{btn} ile katalogdan seçebilirsiniz.", RU:"Выберите из каталога через {btn}.", EN:"Pick from the catalogue with {btn}." },
    cp_empty_sug_tpl:{ AZ:"Yuxarıdakı təkliflərdən əlavə edə və ya {btn} ilə kataloqdan seçə bilərsiniz.", TR:"Yukarıdaki önerilerden ekleyebilir ya da {btn} ile katalogdan seçebilirsiniz.", RU:"Добавьте из предложений выше или выберите из каталога через {btn}.", EN:"Add from the suggestions above, or pick from the catalogue with {btn}." },
    cp_ended_h:{ AZ:"Sonlanmış diaqnozlar", TR:"Sonlanan tanılar", RU:"Завершённые диагнозы", EN:"Ended diagnoses" },
    cp_hide:{ AZ:"Gizlət", TR:"Gizle", RU:"Скрыть", EN:"Hide" },
    cp_show:{ AZ:"Göstər", TR:"Göster", RU:"Показать", EN:"Show" },
    cp_c_na:{ AZ:"Diaqnoz bu növbədə hələ yox idi", TR:"Tanı bu vardiyada henüz yoktu", RU:"В эту смену диагноза ещё не было", EN:"The diagnosis did not exist yet in this shift" },
    cp_late:{ AZ:"gecikmiş giriş", TR:"geç giriş", RU:"поздняя запись", EN:"late entry" },
    cp_c_now:{ AZ:"Bu növbə · qiymətləndirmə gözləyir", TR:"Bu vardiya · değerlendirme bekliyor", RU:"Эта смена · ожидает оценки", EN:"This shift · awaiting assessment" },
    cp_c_miss:{ AZ:"Qiymətləndirilməyib · gecikmiş qeyd üçün toxunun", TR:"Değerlendirilmedi · geç kayıt için dokunun", RU:"Не оценено · нажмите для поздней записи", EN:"Not assessed · tap for a late entry" },
    cp_g_met:{ AZ:"Hədəfə çatıldı", TR:"Karşılandı", RU:"Достигнута", EN:"Met" },
    cp_g_partial:{ AZ:"Qismən çatıldı", TR:"Kısmen karşılandı", RU:"Частично достигнута", EN:"Partly met" },
    cp_g_unmet:{ AZ:"Çatılmadı", TR:"Karşılanmadı", RU:"Не достигнута", EN:"Not met" },
    cp_end_goal:{ AZ:"Hədəfə çatıldı", TR:"Hedefe ulaşıldı", RU:"Цель достигнута", EN:"Goal reached" },
    cp_end_disch:{ AZ:"Evə yazılma / köçürmə", TR:"Taburcu / transfer", RU:"Выписка / перевод", EN:"Discharge / transfer" },
    cp_end_invalid:{ AZ:"Diaqnoz etibarsızdır (səhv daxiletmə)", TR:"Tanı geçersiz (hatalı giriş)", RU:"Диагноз недействителен (ошибочный ввод)", EN:"Diagnosis invalid (entry error)" },
    // özet (teslim / belge)
    cp_sum_none:{ AZ:"Qulluq planında aktiv diaqnoz yoxdur", TR:"Bakım planında aktif tanı yok", RU:"В плане ухода нет активных диагнозов", EN:"No active diagnoses in the care plan" },
    cp_sum_none_sug_tpl:{ AZ:"Qulluq planında aktiv diaqnoz yoxdur · {n} təklif gözləyir", TR:"Bakım planında aktif tanı yok · {n} öneri bekliyor", RU:"В плане ухода нет активных диагнозов · ожидает предложений: {n}", EN:"No active diagnoses in the care plan · {n} suggestion(s) pending" },
    cp_sum_miss_tpl:{ AZ:"{a} aktiv diaqnoz · bu növbədə {m} qiymətləndirmə çatışmır", TR:"{a} aktif tanı · bu vardiya {m} değerlendirme eksik", RU:"Активных диагнозов: {a} · в этой смене без оценки: {m}", EN:"{a} active diagnoses · {m} assessment(s) missing this shift" },
    cp_sum_ok_tpl:{ AZ:"{a} aktiv diaqnoz · bu növbənin qiymətləndirmələri tamamdır", TR:"{a} aktif tanı · bu vardiyanın değerlendirmeleri tamam", RU:"Активных диагнозов: {a} · оценки этой смены выполнены", EN:"{a} active diagnoses · this shift's assessments complete" },
    // öneri gerekçeleri (değerler core.js verisidir, çevrilmez)
    cp_w_fall_tpl:{ AZ:"Yıxılma riski forması · 16:00: {v}", TR:"Düşme riski formu · 16:00: {v}", RU:"Форма риска падения · 16:00: {v}", EN:"Fall risk form · 16:00: {v}" },
    cp_w_braden_tpl:{ AZ:"Yataq yarası riski forması · 08:00: {v} risk", TR:"Bası yarası riski formu · 08:00: {v} risk", RU:"Форма риска пролежней · 08:00: риск {v}", EN:"Pressure injury risk form · 08:00: {v} risk" },
    cp_w_pain_tpl:{ AZ:"Son ağrı balı {v}/10 · bölmə qaydası: ≥{t}", TR:"Son ağrı skoru {v}/10 · birim kuralı: ≥{t}", RU:"Последняя оценка боли {v}/10 · правило отделения: ≥{t}", EN:"Last pain score {v}/10 · unit rule: ≥{t}" },
    cp_w_abx_tpl:{ AZ:"Antibiotik müalicəsi · {d}. gün (təyinat qeydi)", TR:"Antibiyotik tedavisi {d}. gün (order kaydı)", RU:"Антибиотикотерапия, день {d} (запись назначения)", EN:"Antibiotic therapy, day {d} (order record)" },
    cp_w_temp_tpl:{ AZ:"Son bədən temperaturu {v} °C · bölmə qaydası: ≥{t}", TR:"Son vücut ısısı {v} °C · birim kuralı: ≥{t}", RU:"Последняя температура тела {v} °C · правило отделения: ≥{t}", EN:"Last body temperature {v} °C · unit rule: ≥{t}" },
    cp_w_fever_tpl:{ AZ:"Qızdırma {v} °C (son vital)", TR:"Ateş {v} °C (son vital)", RU:"Лихорадка {v} °C (последние показатели)", EN:"Fever {v} °C (last vitals)" },
    cp_w_o2_tpl:{ AZ:"Oksigen dəstəyi: {v} (son vital)", TR:"Oksijen desteği: {v} (son vital)", RU:"Кислородная поддержка: {v} (последние показатели)", EN:"Oxygen support: {v} (last vitals)" },
    cp_w_iso:{ AZ:"Qoruyucu izolyasiya qeydi var", TR:"Koruyucu izolasyon kaydı var", RU:"Есть запись о защитной изоляции", EN:"Protective isolation on record" },
    cp_w_neo_tpl:{ AZ:"Yenidoğulmuş · {d} günlük", TR:"Yenidoğan · {d} günlük", RU:"Новорождённый · {d} дн.", EN:"Neonate · {d} days old" },
    cp_w_gest_tpl:{ AZ:"{w} həftəlik doğulub", TR:"{w} hf doğum", RU:"рождён на {w} нед.", EN:"born at {w} wk" },
    cp_w_bw_tpl:{ AZ:"doğuş çəkisi {g} q", TR:"doğum ağırlığı {g} g", RU:"масса при рождении {g} г", EN:"birth weight {g} g" },
    cp_w_conf:{ AZ:"Şüur qeydi: konfuziya (son vital)", TR:"Bilinç kaydı: konfüze (son vital)", RU:"Сознание: спутанное (последние показатели)", EN:"Consciousness: confused (last vitals)" },
    cp_toast_dismissed:{ AZ:"Təklif rədd edildi · audit qeydinə yazıldı", TR:"Öneri geri çevrildi · denetim kaydına yazıldı", RU:"Предложение отклонено · записано в журнал аудита", EN:"Suggestion declined · written to the audit log" },
    cp_toast_undo:{ AZ:"Rədd edilmiş təkliflər yenidən göstərilir", TR:"Geri çevrilen öneriler yeniden gösteriliyor", RU:"Отклонённые предложения снова показаны", EN:"Declined suggestions are shown again" },
    // Yeni tanı / Düzenle penceresi
    cp_in_plan:{ AZ:"planda", TR:"planda", RU:"в плане", EN:"in plan" },
    cp_suggested:{ AZ:"təklif", TR:"öneri", RU:"предложение", EN:"suggested" },
    cp_no_match_tpl:{ AZ:"“{q}” ilə uyğun diaqnoz yoxdur.", TR:"\"{q}\" ile eşleşen tanı yok.", RU:"Нет диагноза, соответствующего «{q}».", EN:"No diagnosis matches “{q}”." },
    cp_hint_inplan:{ AZ:"Bu diaqnoz planda artıq aktivdir. Dəyişmək üçün plan cədvəlindəki <b>Düzəliş et</b> düyməsindən istifadə edin.", TR:"Bu tanı planda zaten aktif. Değiştirmek için plan tablosundaki <b>Düzenle</b>'yi kullanın.", RU:"Этот диагноз уже активен в плане. Чтобы изменить его, используйте <b>Изменить</b> в таблице плана.", EN:"This diagnosis is already active in the plan. To change it, use <b>Edit</b> in the plan table." },
    cp_hint_pick:{ AZ:"Plana əlavə etmək üçün soldakı qutunu işarələyin və ya aşağıdan seçin.", TR:"Plana eklemek için soldaki kutuyu işaretleyin ya da aşağıdan seçim yapın.", RU:"Чтобы добавить в план, отметьте флажок слева или выберите ниже.", EN:"To add to the plan, tick the box on the left or choose below." },
    cp_sys_sug:{ AZ:"Sistem təklifi", TR:"Sistem önerisi", RU:"Предложение системы", EN:"System suggestion" },
    cp_acts_full:{ AZ:"Fəaliyyətlər (müdaxilələr)", TR:"Faaliyetler (girişimler)", RU:"Мероприятия (вмешательства)", EN:"Interventions (actions)" },
    cp_unselect_all:{ AZ:"Hamısını götür", TR:"Tümünü kaldır", RU:"Снять все", EN:"Clear all" },
    cp_select_all:{ AZ:"Hamısını seç", TR:"Tümünü seç", RU:"Выбрать все", EN:"Select all" },
    cp_hint_std:{ AZ:"Öncədən işarələnənlər kataloqdakı standart paketdir; plana əlavə etməzdən əvvəl xəstəyə görə düzəldin.", TR:"Önceden işaretliler katalogdaki standart pakettir; plana eklemeden önce hastaya göre düzenleyin.", RU:"Заранее отмеченное — стандартный пакет каталога; перед добавлением в план адаптируйте его под пациента.", EN:"Pre-ticked items are the catalogue's standard bundle; adjust them to the patient before adding to the plan." },
    cp_selected_tpl:{ AZ:"Seçilənlər ({n}):", TR:"Seçilenler ({n}):", RU:"Выбрано ({n}):", EN:"Selected ({n}):" },
    cp_chip_counts_tpl:{ AZ:"{c} səbəb · {g} hədəf · {a} fəaliyyət", TR:"{c} neden · {g} hedef · {a} faaliyet", RU:"причин: {c} · целей: {g} · мероприятий: {a}", EN:"{c} causes · {g} goals · {a} interventions" },
    cp_remove:{ AZ:"Çıxar", TR:"Çıkar", RU:"Убрать", EN:"Remove" },
    cp_none_selected:{ AZ:"Hələ diaqnoz seçilməyib.", TR:"Henüz tanı seçilmedi.", RU:"Диагноз ещё не выбран.", EN:"No diagnosis selected yet." },
    cp_edit_note:{ AZ:"Dəyişiklik tarixçəyə və audit qeydinə yazılır. Keçmiş növbə qiymətləndirmələri dəyişmir.", TR:"Değişiklik tarihçeye ve denetim kaydına yazılır. Geçmiş vardiya değerlendirmeleri değişmez.", RU:"Изменение записывается в историю и журнал аудита. Прошлые оценки смен не меняются.", EN:"The change is written to the history and the audit log. Past shift assessments stay unchanged." },
    cp_search_ph:{ AZ:"Diaqnoz axtar (məs. ağrı, solunum, deri)", TR:"Tanı ara (ör. ağrı, solunum, deri)", RU:"Поиск диагноза (напр. ağrı, solunum, deri)", EN:"Search diagnoses (e.g. ağrı, solunum, deri)" },
    cp_start:{ AZ:"Başlanğıc", TR:"Başlangıç", RU:"Начало", EN:"Start" },
    cp_m_edit_tpl:{ AZ:"Diaqnoza düzəliş et · {n}", TR:"Tanıyı düzenle · {n}", RU:"Изменить диагноз · {n}", EN:"Edit diagnosis · {n}" },
    cp_m_new_tpl:{ AZ:"Yeni tibb bacısı diaqnozu · {b}", TR:"Yeni hemşirelik tanısı · {b}", RU:"Новый сестринский диагноз · {b}", EN:"New nursing diagnosis · {b}" },
    cp_cancel:{ AZ:"İmtina", TR:"Vazgeç", RU:"Отмена", EN:"Cancel" },
    cp_keep_draft:{ AZ:"Qaralamanı saxla", TR:"Taslağı sakla", RU:"Сохранить черновик", EN:"Keep draft" },
    cp_toast_pick_one:{ AZ:"Əvvəlcə ən azı bir diaqnoz seçin", TR:"Önce en az bir tanı seçin", RU:"Сначала выберите хотя бы один диагноз", EN:"Select at least one diagnosis first" },
    cp_toast_need_ga_tpl:{ AZ:"{n}: ən azı bir hədəf və bir fəaliyyət seçin", TR:"{n}: en az bir hedef ve bir faaliyet seçin", RU:"{n}: выберите хотя бы одну цель и одно мероприятие", EN:"{n}: select at least one goal and one intervention" },
    cp_toast_updated:{ AZ:"Diaqnoz yeniləndi", TR:"Tanı güncellendi", RU:"Диагноз обновлён", EN:"Diagnosis updated" },
    cp_toast_future:{ AZ:"Gələcək tarixli diaqnoz daxil edilə bilməz", TR:"İleri tarihli tanı girilemez", RU:"Нельзя внести диагноз будущей датой", EN:"A diagnosis cannot be future-dated" },
    cp_toast_added_n_tpl:{ AZ:"{n} diaqnoz plana əlavə edildi", TR:"{n} tanı plana eklendi", RU:"В план добавлено диагнозов: {n}", EN:"{n} diagnoses added to the plan" },
    cp_toast_added1:{ AZ:"Diaqnoz plana əlavə edildi", TR:"Tanı plana eklendi", RU:"Диагноз добавлен в план", EN:"Diagnosis added to the plan" },
    // tarihçe kayıtları (ekranda çizilirken çevrilir)
    cp_h_added:{ AZ:"Plana əlavə edildi", TR:"Plana eklendi", RU:"Добавлено в план", EN:"Added to plan" },
    cp_h_startshift_tpl:{ AZ:"Başlanğıc növbəsi {s}", TR:"Başlangıç vardiyası {s}", RU:"Начальная смена {s}", EN:"Start shift {s}" },
    cp_h_start_tpl:{ AZ:"Başlanğıc {s}", TR:"Başlangıç {s}", RU:"Начало {s}", EN:"Start {s}" },
    cp_h_from_sug_tpl:{ AZ:"sistem təklifindən qəbul edildi ({why})", TR:"sistem önerisinden kabul edildi ({why})", RU:"принято из предложения системы ({why})", EN:"accepted from a system suggestion ({why})" },
    cp_h_edited:{ AZ:"Düzəliş edildi", TR:"Düzenlendi", RU:"Изменено", EN:"Edited" },
    cp_d_c_tpl:{ AZ:"{x} səbəb", TR:"{x} neden", RU:"причины {x}", EN:"{x} cause(s)" },
    cp_d_g_tpl:{ AZ:"{x} hədəf", TR:"{x} hedef", RU:"цели {x}", EN:"{x} goal(s)" },
    cp_d_a_tpl:{ AZ:"{x} fəaliyyət", TR:"{x} faaliyet", RU:"мероприятия {x}", EN:"{x} intervention(s)" },
    cp_d_opt:{ AZ:"seçim", TR:"seçenek", RU:"вариант", EN:"option" },
    cp_h_eval_changed_tpl:{ AZ:"Qiymətləndirmə dəyişdirildi · {s}", TR:"Değerlendirme değiştirildi · {s}", RU:"Оценка изменена · {s}", EN:"Assessment changed · {s}" },
    cp_h_prev_tpl:{ AZ:"Əvvəlki: {x}", TR:"Önceki: {x}", RU:"Прежняя: {x}", EN:"Previous: {x}" },
    cp_h_ended_tpl:{ AZ:"Sonlandırıldı · {r}", TR:"Sonlandırıldı · {r}", RU:"Завершено · {r}", EN:"Ended · {r}" },
    // vardiya değerlendirmesi
    cp_m_eval:{ AZ:"Növbə qiymətləndirməsi", TR:"Vardiya değerlendirmesi", RU:"Оценка смены", EN:"Shift assessment" },
    cp_late_note_tpl:{ AZ:"Bu növbə bağlanıb. Qeyd <b>gecikmiş giriş</b> kimi işarələnir və saatı ilə ({t}) audit qeydinə yazılır.", TR:"Bu vardiya kapandı. Kayıt <b>geç giriş</b> olarak işaretlenir ve saatiyle ({t}) denetim kaydına yazılır.", RU:"Эта смена закрыта. Запись помечается как <b>поздняя запись</b> и заносится в журнал аудита со временем ({t}).", EN:"This shift is closed. The entry is marked as a <b>late entry</b> and written to the audit log with its time ({t})." },
    cp_ex_note_tpl:{ AZ:"Bu qiymətləndirməni {by} {at} tarixində qeyd edib. Dəyişsəniz, köhnə halı tarixçədə qalır.", TR:"Bu değerlendirme {by} tarafından {at} kaydedildi. Değiştirirseniz eski hâli tarihçede kalır.", RU:"Эту оценку внёс(ла) {by} {at}. Если измените её, прежний вариант останется в истории.", EN:"This assessment was recorded by {by} at {at}. If you change it, the old version stays in the history." },
    cp_acts_done:{ AZ:"Bu növbədə görülən fəaliyyətlər", TR:"Bu vardiyada yapılan faaliyetler", RU:"Мероприятия, выполненные в эту смену", EN:"Interventions done this shift" },
    cp_check_auto:{ AZ:"qeyddən öncədən işarələnənləri yoxlayın", TR:"kayıttan ön işaretlenenleri kontrol edin", RU:"проверьте отмеченное заранее по записям", EN:"check the items pre-ticked from records" },
    cp_from_rec:{ AZ:"qeyddən", TR:"kayıttan", RU:"из записи", EN:"from record" },
    cp_goal_status:{ AZ:"Hədəfin vəziyyəti", TR:"Hedef durumu", RU:"Статус цели", EN:"Goal status" },
    cp_nurse_eval:{ AZ:"tibb bacısının qiymətləndirməsi", TR:"hemşire değerlendirmesi", RU:"оценка медсестры", EN:"nurse's assessment" },
    cp_short_note:{ AZ:"Qısa qeyd", TR:"Kısa not", RU:"Краткая заметка", EN:"Short note" },
    cp_note_ph:{ AZ:"Müşahidə, həkimə məlumat, plan dəyişikliyinin səbəbi…", TR:"Gözlem, hekime bildirim, plan değişikliği gerekçesi…", RU:"Наблюдение, сообщение врачу, причина изменения плана…", EN:"Observation, report to the physician, reason for a plan change…" },
    cp_toast_pick_goal:{ AZ:"Hədəfin vəziyyətini seçin", TR:"Hedef durumunu seçin", RU:"Выберите статус цели", EN:"Choose the goal status" },
    cp_toast_late_saved:{ AZ:"Gecikmiş giriş qeyd edildi", TR:"Geç giriş kaydedildi", RU:"Поздняя запись внесена", EN:"Late entry recorded" },
    cp_toast_eval_saved:{ AZ:"Qiymətləndirmə qeyd edildi", TR:"Değerlendirme kaydedildi", RU:"Оценка внесена", EN:"Assessment recorded" },
    // sonlandır · tarihçe
    cp_m_end_tpl:{ AZ:"Diaqnozu sonlandır · {n}", TR:"Tanıyı sonlandır · {n}", RU:"Завершить диагноз · {n}", EN:"End diagnosis · {n}" },
    cp_end_reason:{ AZ:"Sonlandırma səbəbi", TR:"Sonlandırma nedeni", RU:"Причина завершения", EN:"Reason for ending" },
    cp_note_opt:{ AZ:"Qeyd (istəyə bağlı)", TR:"Not (isteğe bağlı)", RU:"Заметка (необязательно)", EN:"Note (optional)" },
    cp_end_noeval:{ AZ:"Bu növbənin qiymətləndirməsi daxil edilməyib. Sonlandırmadan əvvəl daxil etmək istəyə bilərsiniz.", TR:"Bu vardiyanın değerlendirmesi girilmedi. Sonlandırmadan önce girmek isteyebilirsiniz.", RU:"Оценка этой смены не внесена. Возможно, стоит внести её перед завершением.", EN:"This shift's assessment hasn't been entered. You may want to enter it before ending." },
    cp_end_keep:{ AZ:"Sonlanmış diaqnoz silinmir; qiymətləndirmələri və tarixçəsi “Sonlanmış diaqnozlar” bölməsində qalır.", TR:"Sonlanan tanı silinmez; değerlendirmeleri ve tarihçesi \"Sonlanan tanılar\" altında kalır.", RU:"Завершённый диагноз не удаляется; его оценки и история остаются в разделе «Завершённые диагнозы».", EN:"An ended diagnosis is not deleted; its assessments and history remain under “Ended diagnoses”." },
    cp_toast_pick_reason:{ AZ:"Sonlandırma səbəbini seçin", TR:"Sonlandırma nedenini seçin", RU:"Выберите причину завершения", EN:"Choose a reason for ending" },
    cp_toast_ended:{ AZ:"Diaqnoz sonlandırıldı", TR:"Tanı sonlandırıldı", RU:"Диагноз завершён", EN:"Diagnosis ended" },
    cp_m_hist_tpl:{ AZ:"Tarixçə · {n}", TR:"Tarihçe · {n}", RU:"История · {n}", EN:"History · {n}" },
    cp_plan_changes:{ AZ:"Plan dəyişiklikləri", TR:"Plan değişiklikleri", RU:"Изменения плана", EN:"Plan changes" },
    cp_shift_evals:{ AZ:"Növbə qiymətləndirmələri", TR:"Vardiya değerlendirmeleri", RU:"Оценки смен", EN:"Shift assessments" },
    cp_n_records_tpl:{ AZ:"{n} qeyd", TR:"{n} kayıt", RU:"записей: {n}", EN:"{n} entries" },
    cp_acts_ratio_tpl:{ AZ:"{a}/{b} fəaliyyət", TR:"{a}/{b} faaliyet", RU:"мероприятий {a}/{b}", EN:"{a}/{b} interventions" },
    cp_no_evals:{ AZ:"Hələ qiymətləndirmə yoxdur.", TR:"Henüz değerlendirme yok.", RU:"Оценок пока нет.", EN:"No assessments yet." },
    cp_close:{ AZ:"Bağla", TR:"Kapat", RU:"Закрыть", EN:"Close" },
    // sıvı izlem ızgarası
    cp_io_title:{ AZ:"Maye izləmə cədvəli", TR:"Sıvı izlem çizelgesi", RU:"Карта учёта жидкости", EN:"Fluid monitoring chart" },
    cp_io_dutyday:{ AZ:"növbə günü", TR:"nöbet günü", RU:"дежурные сутки", EN:"duty day" },
    cp_io_oral:{ AZ:"Oral", TR:"Oral", RU:"Перорально", EN:"Oral" },
    cp_io_tpn:{ AZ:"Parenteral qidalanma", TR:"Parenteral beslenme", RU:"Парентеральное питание", EN:"Parenteral nutrition" },
    cp_io_iv:{ AZ:"IV maye / infuziya", TR:"IV sıvı / infüzyon", RU:"В/в жидкость / инфузия", EN:"IV fluid / infusion" },
    cp_io_pcai:{ AZ:"PCA infuziya", TR:"PCA infüzyon", RU:"PCA-инфузия", EN:"PCA infusion" },
    cp_io_pcab:{ AZ:"PCA bolus", TR:"PCA bolus", RU:"PCA-болюс", EN:"PCA bolus" },
    cp_io_peg:{ AZ:"PEG / PEJ", TR:"PEG / PEJ", RU:"PEG / PEJ", EN:"PEG / PEJ" },
    cp_io_ngin:{ AZ:"NG / OG", TR:"NG / OG", RU:"НГ / ОГ", EN:"NG / OG" },
    cp_io_blood:{ AZ:"Qan məhsulları", TR:"Kan ürünleri", RU:"Препараты крови", EN:"Blood products" },
    cp_io_pd:{ AZ:"Peritoneal dializ", TR:"Periton diyalizi", RU:"Перитонеальный диализ", EN:"Peritoneal dialysis" },
    cp_io_irrin:{ AZ:"İrriqasiya (verilən)", TR:"İrigasyon (verilen)", RU:"Ирригация (введено)", EN:"Irrigation (in)" },
    cp_io_inoth:{ AZ:"Digər", TR:"Diğer", RU:"Другое", EN:"Other" },
    cp_io_uri:{ AZ:"Spontan / Foley", TR:"Spontan / Foley", RU:"Спонтанно / Фолей", EN:"Spontaneous / Foley" },
    cp_io_nefro:{ AZ:"Nefrostoma", TR:"Nefrostomi", RU:"Нефростома", EN:"Nephrostomy" },
    cp_io_uro:{ AZ:"Urostoma", TR:"Ürostomi", RU:"Уростома", EN:"Urostomy" },
    cp_io_sisto:{ AZ:"Sistostoma", TR:"Sistostomi", RU:"Цистостома", EN:"Cystostomy" },
    cp_io_dr1:{ AZ:"Dren 1", TR:"Dren 1", RU:"Дренаж 1", EN:"Drain 1" },
    cp_io_dr2:{ AZ:"Dren 2", TR:"Dren 2", RU:"Дренаж 2", EN:"Drain 2" },
    cp_io_kusma:{ AZ:"Qusma", TR:"Kusma", RU:"Рвота", EN:"Vomiting" },
    cp_io_gaita:{ AZ:"Nəcis", TR:"Gaita", RU:"Стул", EN:"Stool" },
    cp_io_ngd:{ AZ:"NG drenajı", TR:"NG drenajı", RU:"Отделяемое по НГ-зонду", EN:"NG drainage" },
    cp_io_kan:{ AZ:"Qan itkisi (ölçülən)", TR:"Kan kaybı (ölçülen)", RU:"Кровопотеря (измеренная)", EN:"Blood loss (measured)" },
    cp_io_irrout:{ AZ:"İrriqasiya (gələn)", TR:"İrigasyon (gelen)", RU:"Ирригация (выведено)", EN:"Irrigation (out)" },
    cp_io_outoth:{ AZ:"Digər", TR:"Diğer", RU:"Другое", EN:"Other" },
    cp_io_neo_oral:{ AZ:"Oral (ana südü / qida qarışığı)", TR:"Oral (anne sütü / mama)", RU:"Перорально (грудное молоко / смесь)", EN:"Oral (breast milk / formula)" },
    cp_io_neo_ngin:{ AZ:"OG / NG qidalanma", TR:"OG / NG beslenme", RU:"Кормление через ОГ / НГ", EN:"OG / NG feeding" },
    cp_io_neo_uri:{ AZ:"Sidik (bez çəkisi)", TR:"İdrar (bez tartısı)", RU:"Моча (взвешивание подгузника)", EN:"Urine (diaper weight)" },
    cp_io_g_par:{ AZ:"Parenteral", TR:"Parenteral", RU:"Парентерально", EN:"Parenteral" },
    cp_io_g_ent:{ AZ:"Enteral", TR:"Enteral", RU:"Энтерально", EN:"Enteral" },
    cp_io_g_uri:{ AZ:"Sidik", TR:"İdrar", RU:"Моча", EN:"Urine" },
    cp_io_24h:{ AZ:"24 saat", TR:"24 saat", RU:"24 ч", EN:"24 h" },
    cp_io_hour:{ AZ:"Saat", TR:"Saat", RU:"Час", EN:"Hour" },
    cp_io_range:{ AZ:"Aralıq", TR:"Aralık", RU:"Интервал", EN:"Interval" },
    cp_io_total:{ AZ:"Cəmi", TR:"Toplam", RU:"Итого", EN:"Total" },
    cp_io_from_pump:{ AZ:"pompadan", TR:"pompadan", RU:"с помпы", EN:"from pump" },
    cp_io_has_fix:{ AZ:"əl ilə düzəliş var", TR:"elle düzeltme var", RU:"есть ручная поправка", EN:"manual correction" },
    cp_io_noentry:{ AZ:"giriş yoxdur", TR:"giriş yok", RU:"нет записи", EN:"no entry" },
    cp_io_in:{ AZ:"Qəbul edilən", TR:"Aldığı", RU:"Введено", EN:"Intake" },
    cp_io_out:{ AZ:"Xaric edilən", TR:"Çıkardığı", RU:"Выведено", EN:"Output" },
    cp_io_tin:{ AZ:"Cəmi qəbul", TR:"Toplam aldığı", RU:"Всего введено", EN:"Total intake" },
    cp_io_tout:{ AZ:"Cəmi xaric", TR:"Toplam çıkardığı", RU:"Всего выведено", EN:"Total output" },
    cp_io_bal:{ AZ:"Balans", TR:"Balans", RU:"Баланс", EN:"Balance" },
    cp_io_cum:{ AZ:"Kumulyativ balans", TR:"Kümülatif balans", RU:"Накопительный баланс", EN:"Cumulative balance" },
    cp_io_since8:{ AZ:"08:00-dan", TR:"08:00'den", RU:"с 08:00", EN:"since 08:00" },
    cp_io_bloodbal:{ AZ:"Qan balansı", TR:"Kan balansı", RU:"Баланс крови", EN:"Blood balance" },
    cp_io_irrbal:{ AZ:"İrriqasiya balansı", TR:"İrigasyon balansı", RU:"Баланс ирригации", EN:"Irrigation balance" },
    cp_io_norec:{ AZ:"qeyd yoxdur", TR:"kayıt yok", RU:"записей нет", EN:"no records" },
    cp_io_uokg:{ AZ:"Sidik · mL/kq/saat", TR:"İdrar · mL/kg/sa", RU:"Моча · мл/кг/ч", EN:"Urine · mL/kg/h" },
    cp_io_complete_h:{ AZ:"tamamlanmış saatlar", TR:"tamamlanan saatler", RU:"завершённые часы", EN:"completed hours" },
    cp_io_w_gap1_tpl:{ AZ:"Sidik: {h} saatı boşdur. Saatlıq izlənən xəstədə giriş gözlənilir.", TR:"İdrar: {h} saati boş. Saatlik izlenen hastada giriş bekleniyor.", RU:"Моча: нет записи за {h}. У пациента с почасовым наблюдением запись ожидается.", EN:"Urine: {h} is blank. An entry is expected for an hourly-monitored patient." },
    cp_io_w_gapn_tpl:{ AZ:"Sidik: {h} saatları boşdur. Saatlıq izlənən xəstədə giriş gözlənilir.", TR:"İdrar: {h} saatleri boş. Saatlik izlenen hastada giriş bekleniyor.", RU:"Моча: нет записей за {h}. У пациента с почасовым наблюдением запись ожидается.", EN:"Urine: {h} are blank. An entry is expected for an hourly-monitored patient." },
    cp_io_w_now_tpl:{ AZ:"Sidik: {h}:00 saatı davam edir, giriş hələ yoxdur.", TR:"İdrar: {h}:00 saati sürüyor, giriş henüz yok.", RU:"Моча: час {h}:00 идёт, записи пока нет.", EN:"Urine: the {h}:00 hour is under way, no entry yet." },
    cp_io_w_fix_tpl:{ AZ:"{row}: {n} saatda pompa dəyəri əl ilə düzəldilib (sarı alt xətt). Audit qeydindədir.", TR:"{row}: {n} saatte pompa değeri elle düzeltilmiş (sarı alt çizgi). Denetim kaydında.", RU:"{row}: значение помпы исправлено вручную, часов: {n} (жёлтое подчёркивание). Есть в журнале аудита.", EN:"{row}: pump value manually corrected in {n} hour(s) (yellow underline). In the audit log." },
    cp_io_v1:{ AZ:"Saatlıq", TR:"Saatlik", RU:"Почасово", EN:"Hourly" },
    cp_io_vh_tpl:{ AZ:"{n} saat", TR:"{n} saat", RU:"{n} ч", EN:"{n} h" },
    cp_io_v24:{ AZ:"Günlük", TR:"Günlük", RU:"За сутки", EN:"Daily" },
    cp_io_showall:{ AZ:"Bütün sətirləri göstər", TR:"Tüm satırları göster", RU:"Показать все строки", EN:"Show all rows" },
    cp_io_hidden_tpl:{ AZ:"({n} gizli)", TR:"({n} gizli)", RU:"(скрыто: {n})", EN:"({n} hidden)" },
    cp_io_leg_pump:{ AZ:"pompadan avtomatik", TR:"pompadan otomatik", RU:"автоматически с помпы", EN:"automatic from pump" },
    cp_io_leg_fix:{ AZ:"əl ilə düzəliş", TR:"elle düzeltme", RU:"ручная поправка", EN:"manual correction" },
    cp_io_leg_gap:{ AZ:"gözlənilən giriş yoxdur", TR:"beklenen giriş yok", RU:"нет ожидаемой записи", EN:"expected entry missing" },
    cp_io_leg_tap:{ AZ:"xanaya toxunun → giriş", TR:"hücreye dokunun → giriş", RU:"нажмите на ячейку → запись", EN:"tap a cell → entry" },
    cp_io_foot:{ AZ:"Cəmi qəbul–xaric və balans irriqasiyanı daxil etmir; irriqasiya verilən−gələn ayrıca aparılır, sidiyə qarışmır. Qan balansı = qan məhsulları − ölçülən qan itkisi.",
      TR:"Toplam aldığı–çıkardığı ve balans irigasyonu içermez; irigasyon verilen−gelen ayrı tutulur, idrara karışmaz. Kan balansı = kan ürünleri − ölçülen kan kaybı.",
      RU:"Итоги «введено–выведено» и баланс не включают ирригацию; ирригация (введено − выведено) учитывается отдельно и не смешивается с мочой. Баланс крови = препараты крови − измеренная кровопотеря.",
      EN:"Total intake/output and balance exclude irrigation; irrigation in − out is kept separately and never mixed with urine. Blood balance = blood products − measured blood loss." },
    cp_adm_io:{ AZ:"Qan balansının tərifi xəstəxana ilə dəqiqləşdiriləcək. Pompa dəyərləri infuziya pompası inteqrasiyası qurulana qədər buradan gəlir; qurulduqdan sonra pompadan oxunur.",
      TR:"Kan balansı tanımı hastaneyle netleştirilecek. Pompa değerleri infüzyon pompası entegrasyonu kurulana dek buradan gelir; kurulunca pompadan okunur.",
      RU:"Определение баланса крови уточняется с больницей. Значения помп берутся отсюда, пока не настроена интеграция с инфузионными помпами; после настройки читаются с помп.",
      EN:"The blood balance definition is to be agreed with the hospital. Pump values come from here until the infusion pump integration is set up; after that they are read from the pumps." },
    cp_src_elle:{ AZ:"Əl ilə", TR:"Elle", RU:"Вручную", EN:"Manual" },
    cp_src_pompa:{ AZ:"Pompa", TR:"Pompa", RU:"Помпа", EN:"Pump" },
    cp_src_tarti:{ AZ:"Çəki", TR:"Tartı", RU:"Взвешивание", EN:"Weighing" },
    cp_io_pump_dev:{ AZ:"İnfuziya pompası", TR:"İnfüzyon pompası", RU:"Инфузионная помпа", EN:"Infusion pump" },
    cp_io_night_nurse:{ AZ:"Gecə tibb bacısı", TR:"Gece hemşiresi", RU:"Ночная медсестра", EN:"Night nurse" },
    cp_io_hour_running:{ AZ:"saat davam edir", TR:"saat sürüyor", RU:"час идёт", EN:"hour in progress" },
    cp_io_no_rec_hour:{ AZ:"Bu saatda qeyd yoxdur.", TR:"Bu saatte kayıt yok.", RU:"За этот час записей нет.", EN:"No entries for this hour." },
    cp_io_to_irr:{ AZ:"irriqasiya balansına yazılır", TR:"irigasyon balansına yazılır", RU:"учитывается в балансе ирригации", EN:"counted in the irrigation balance" },
    cp_io_amount:{ AZ:"Miqdar", TR:"Miktar", RU:"Количество", EN:"Amount" },
    cp_io_source:{ AZ:"Mənbə", TR:"Kaynak", RU:"Источник", EN:"Source" },
    cp_io_pump_note:{ AZ:"Bu sətir pompadan avtomatik dolur. Əl ilə giriş pompa dəyərini düzəldir (mənfi dəyər daxil edilə bilər) və audit qeydinə yazılır.", TR:"Bu satır pompadan otomatik dolar. Elle giriş pompa değerini düzeltir (eksi değer girilebilir) ve denetim kaydına yazılır.", RU:"Эта строка заполняется автоматически с помпы. Ручная запись корректирует значение помпы (можно ввести отрицательное значение) и заносится в журнал аудита.", EN:"This row fills automatically from the pump. A manual entry corrects the pump value (a negative value is allowed) and is written to the audit log." },
    cp_io_neo_weigh:{ AZ:"Çəki: yaş bez − quru bez çəkisi; q → mL çevrilməsi müəssisə protokoluna görə.", TR:"Tartı: ıslak bez − kuru bez ağırlığı; g → mL çevrimi kurum protokolüne göre.", RU:"Взвешивание: вес мокрого − сухого подгузника; пересчёт г → мл по протоколу учреждения.", EN:"Weighing: wet minus dry diaper weight; g → mL conversion per institutional protocol." },
    cp_m_io:{ AZ:"Qəbul–xaric girişi", TR:"Aldığı–çıkardığı girişi", RU:"Запись «введено–выведено»", EN:"Intake–output entry" },
    cp_toast_io_invalid_pump:{ AZ:"Düzgün miqdar daxil edin (düzəliş üçün mənfi ola bilər)", TR:"Geçerli bir miktar girin (düzeltme için eksi değer olabilir)", RU:"Введите корректное количество (для поправки можно отрицательное)", EN:"Enter a valid amount (may be negative for a correction)" },
    cp_toast_io_invalid:{ AZ:"Düzgün miqdar daxil edin", TR:"Geçerli bir miktar girin", RU:"Введите корректное количество", EN:"Enter a valid amount" },
    cp_toast_io_saved_tpl:{ AZ:"{row} · {ml} mL qeyd edildi", TR:"{row} · {ml} mL kaydedildi", RU:"{row} · {ml} мл внесено", EN:"{row} · {ml} mL recorded" },
    cp_io_n_bolus:{ AZ:"Bolus (həkim təyinatı) · 19:40", TR:"Bolus (hekim istemi) · 19:40", RU:"Болюс (назначение врача) · 19:40", EN:"Bolus (physician order) · 19:40" },
    cp_io_n_blood:{ AZ:"Qan məhsulu · barkod və ikiqat yoxlama qan transfuziyası formasındadır", TR:"Kan ürünü · barkod ve çift kontrol kan transfüzyon formunda", RU:"Препарат крови · штрихкод и двойная проверка — в форме трансфузии", EN:"Blood product · barcode and double check are in the transfusion form" },
    cp_io_n_line:{ AZ:"Pompa xəttinin dəyişdirilməsi · artıq sayılan həcm düzəldildi", TR:"Pompa hattı değişimi · fazla sayılan hacim düzeltildi", RU:"Замена линии помпы · излишне учтённый объём исправлен", EN:"Pump line change · over-counted volume corrected" },
    cp_io_n_fix:{ AZ:"Əl ilə düzəliş", TR:"Elle düzeltme", RU:"Ручная поправка", EN:"Manual correction" },
  });
  /* 24.09 (4. oturum) · tanı ekleme penceresi (üç bölme + sekme), sıklık, kaynaklı ön işaret, sürümlü katalog, öneri kuralları. */
  H.addT({
    cp_grp_sug:{ AZ:"Təklif olunan (sistemdən)", TR:"Önerilen (sistemden)", RU:"Предложенные (системой)", EN:"Suggested (by the system)" },
    cp_grp_fav:{ AZ:"Bölmənin tez-tez istifadə etdikləri", TR:"Birimin sık kullandıkları", RU:"Часто используемые в отделении", EN:"Frequently used in this unit" },
    cp_grp_all_tpl:{ AZ:"Hamısı ({n})", TR:"Tümü ({n})", RU:"Все ({n})", EN:"All ({n})" },
    cp_pending:{ AZ:"məzmun gözləyir", TR:"içerik bekliyor", RU:"ждёт содержания", EN:"content pending" },
    cp_pending_msg:{ AZ:"Bu diaqnozun məzmunu hələ köçürülməyib · xəstəxana kataloqundan gələcək", TR:"Bu tanının içeriği henüz aktarılmadı · hastane kataloğundan gelecek", RU:"Содержание этого диагноза ещё не перенесено · поступит из каталога больницы", EN:"This diagnosis' content has not been transferred yet · it will come from the hospital catalogue" },
    cp_pending_sub:{ AZ:"Diaqnozu yenə də plana əlavə edib sərbəst qeyd yaza bilərsiniz.", TR:"Tanıyı yine de plana ekleyip serbest not yazabilirsiniz.", RU:"Диагноз всё равно можно добавить в план и написать свободную заметку.", EN:"You can still add the diagnosis to the plan and write a free note." },
    cp_free_note:{ AZ:"Sərbəst qeyd", TR:"Serbest not", RU:"Свободная заметка", EN:"Free note" },
    cp_free_note_ph:{ AZ:"Bu xəstə üçün səbəb, hədəf və görüləcək işləri öz sözlərinizlə yazın…", TR:"Bu hasta için neden, hedef ve yapılacakları kendi cümlenizle yazın…", RU:"Опишите своими словами причины, цели и мероприятия для этого пациента…", EN:"Describe causes, goals and interventions for this patient in your own words…" },
    cp_freq_lbl:{ AZ:"Tezlik", TR:"Sıklık", RU:"Частота", EN:"Frequency" },
    cp_freq_shift:{ AZ:"Növbədə 1 dəfə", TR:"Vardiyada 1", RU:"1 раз за смену", EN:"Once per shift" },
    cp_freq_q4:{ AZ:"4 saatdan bir", TR:"4 saatte bir", RU:"Каждые 4 ч", EN:"Every 4 h" },
    cp_freq_q8:{ AZ:"8 saatdan bir", TR:"8 saatte bir", RU:"Каждые 8 ч", EN:"Every 8 h" },
    cp_freq_prn:{ AZ:"Lazım olduqda", TR:"Gerektikçe", RU:"По необходимости", EN:"As needed" },
    cp_bar_tpl:{ AZ:"<b>{d}</b> diaqnoz · <b>{a}</b> fəaliyyət · <b>{t}</b> iş “{tasks}” bölməsinə düşəcək", TR:"<b>{d}</b> tanı · <b>{a}</b> faaliyet · <b>{t}</b> iş {tasks}'e düşecek", RU:"Диагнозов: <b>{d}</b> · мероприятий: <b>{a}</b> · в «{tasks}» попадёт задач: <b>{t}</b>", EN:"<b>{d}</b> diagnoses · <b>{a}</b> interventions · <b>{t}</b> tasks go to {tasks}" },
    cp_seal:{ AZ:"Möhürlə", TR:"Mühürle", RU:"Заверить", EN:"Seal" },
    cp_toast_draft_saved:{ AZ:"Qaralama saxlanıldı · plana düşmədi", TR:"Taslak saklandı · plana girmedi", RU:"Черновик сохранён · в план не внесён", EN:"Draft kept · not added to the plan" },
    cp_draft_restored_tpl:{ AZ:"Saxlanılmış qaralama açıldı · {by} · {at}", TR:"Saklanan taslak açıldı · {by} · {at}", RU:"Открыт сохранённый черновик · {by} · {at}", EN:"Kept draft reopened · {by} · {at}" },
    cp_draft_badge_tpl:{ AZ:"Qaralama · {n} diaqnoz", TR:"Taslak · {n} tanı", RU:"Черновик · диагнозов: {n}", EN:"Draft · {n} diagnoses" },
    cp_toast_sealed_tpl:{ AZ:"{n} diaqnoz möhürləndi · {t} iş “{tasks}” bölməsinə düşdü", TR:"{n} tanı mühürlendi · {t} iş {tasks}'e düştü", RU:"Заверено диагнозов: {n} · в «{tasks}» добавлено задач: {t}", EN:"{n} diagnoses sealed · {t} tasks added to {tasks}" },
    cp_toast_sealed_edit_tpl:{ AZ:"Diaqnoz möhürləndi · {t} iş yeniləndi", TR:"Tanı mühürlendi · {t} iş güncellendi", RU:"Диагноз заверен · задач обновлено: {t}", EN:"Diagnosis sealed · {t} tasks updated" },
    cp_preview:{ AZ:"baxış", TR:"önizleme", RU:"просмотр", EN:"preview" },
    cp_take:{ AZ:"Plana götür", TR:"Plana al", RU:"Взять в план", EN:"Take into plan" },
    cp_auto_hint:{ AZ:"Bəzi səbəblər xəstənin məlumatından öncədən işarələnib; mənbəyi yanında yazılıb. Uyğun deyilsə, götürün.", TR:"Bazı nedenler hastanın verisinden önceden işaretlendi; kaynağı yanında yazıyor. Uymuyorsa kaldırın.", RU:"Некоторые причины отмечены заранее по данным пациента; источник указан рядом. Если не подходит — снимите отметку.", EN:"Some causes are pre-ticked from the patient's data, with the source shown next to them. Untick any that don't apply." },
    cp_src_rec:{ AZ:"qeyddən", TR:"kayıttan", RU:"из записи", EN:"from record" },
    cp_src_vital:{ AZ:"son vital", TR:"son vital", RU:"последние показатели", EN:"last vitals" },
    cp_src_act:{ AZ:"fəaliyyət qeydi", TR:"faaliyet kaydı", RU:"запись мероприятий", EN:"activity record" },
    cp_src_chronic:{ AZ:"xroniki xəstəlik qeydi", TR:"kronik hastalık kaydı", RU:"запись о хронических заболеваниях", EN:"chronic disease record" },
    cp_src_dx:{ AZ:"diaqnoz qeydi", TR:"tanı kaydı", RU:"запись диагноза", EN:"diagnosis record" },
    cp_ev_age_tpl:{ AZ:"Yaş {v}", TR:"Yaş {v}", RU:"Возраст {v}", EN:"Age {v}" },
    cp_ev_loc_tpl:{ AZ:"Şüur: {v}", TR:"Bilinç: {v}", RU:"Сознание: {v}", EN:"Consciousness: {v}" },
    cp_ev_day_tpl:{ AZ:"{n} · gün {d}", TR:"{n} · {d}. gün", RU:"{n} · день {d}", EN:"{n} · day {d}" },
    cp_ev_pain_tpl:{ AZ:"Ağrı balı {v}/10 · ağrı forması {t}", TR:"Ağrı skoru {v}/10 · ağrı formu {t}", RU:"Боль {v}/10 · форма оценки боли {t}", EN:"Pain score {v}/10 · pain form {t}" },
    cp_ev_temp_tpl:{ AZ:"Bədən temperaturu {v} °C", TR:"Vücut ısısı {v} °C", RU:"Температура тела {v} °C", EN:"Body temperature {v} °C" },
    cp_ev_abx_tpl:{ AZ:"Antibiotik müalicəsi · gün {d}", TR:"Antibiyotik tedavisi · {d}. gün", RU:"Антибиотикотерапия · день {d}", EN:"Antibiotic therapy · day {d}" },
    cp_src_order:{ AZ:"təyinat qeydi", TR:"order kaydı", RU:"запись назначения", EN:"order record" },
    cp_cv_tpl:{ AZ:"kataloq v{v}", TR:"katalog v{v}", RU:"каталог v{v}", EN:"catalogue v{v}" },
    cp_cv_old_tpl:{ AZ:"Bu plan kataloq v{v} ilə yazılıb və o versiya ilə açılır. Dərcdə olan versiya: v{c}.", TR:"Bu plan katalog v{v} ile yazıldı ve o sürümle açılır. Yayımdaki sürüm: v{c}.", RU:"Этот план составлен по каталогу v{v} и открывается в этой версии. Опубликованная версия: v{c}.", EN:"This plan was written with catalogue v{v} and opens with that version. Published version: v{c}." },
    cp_edit_oldv_tpl:{ AZ:"Bu plan kataloq v{v} ilə yazılıb; düzəliş o versiyanın siyahısı ilə edilir.", TR:"Bu plan katalog v{v} ile yazıldı; düzenleme o sürümün listesiyle yapılır.", RU:"Этот план составлен по каталогу v{v}; изменения вносятся по списку этой версии.", EN:"This plan was written with catalogue v{v}; edits use that version's lists." },
    cp_cat_v_tpl:{ AZ:"{label} · v{v} · {n} diaqnoz", TR:"{label} · v{v} · {n} tanı", RU:"{label} · v{v} · диагнозов: {n}", EN:"{label} · v{v} · {n} diagnoses" },
    cp_tasks_line_tpl:{ AZ:"{n} iş “{tasks}” bölməsində", TR:"{n} iş {tasks}'de", RU:"задач в «{tasks}»: {n}", EN:"{n} tasks in {tasks}" },
    cp_no_goals_pending:{ AZ:"Hədəflər xəstəxana kataloqundan gələcək.", TR:"Hedefler hastane kataloğundan gelecek.", RU:"Цели поступят из каталога больницы.", EN:"Goals will come from the hospital catalogue." },
    // öneri kuralı veri alanları (Yönetim → Bakım kataloğu → Önerme kuralları da kullanır)
    cp_f_fall:{ AZ:"Yıxılma riski forması · səviyyə", TR:"Düşme riski formu · düzey", RU:"Форма риска падения · уровень", EN:"Fall risk form · level" },
    cp_f_braden:{ AZ:"Yataq yarası riski forması · səviyyə", TR:"Bası yarası riski formu · düzey", RU:"Форма риска пролежней · уровень", EN:"Pressure injury risk form · level" },
    cp_f_pain:{ AZ:"Ağrı balı (0–10)", TR:"Ağrı skoru (0–10)", RU:"Оценка боли (0–10)", EN:"Pain score (0–10)" },
    cp_f_temp:{ AZ:"Bədən temperaturu (°C)", TR:"Vücut ısısı (°C)", RU:"Температура тела (°C)", EN:"Body temperature (°C)" },
    cp_f_age:{ AZ:"Yaş", TR:"Yaş", RU:"Возраст", EN:"Age" },
    cp_f_spo2:{ AZ:"SpO₂ (%)", TR:"SpO₂ (%)", RU:"SpO₂ (%)", EN:"SpO₂ (%)" },
    cp_f_o2:{ AZ:"Oksigen dəstəyi", TR:"Oksijen desteği", RU:"Кислородная поддержка", EN:"Oxygen support" },
    cp_f_abx:{ AZ:"Antibiotik müalicəsi (təyinat)", TR:"Antibiyotik tedavisi (order)", RU:"Антибиотикотерапия (назначение)", EN:"Antibiotic therapy (order)" },
    cp_f_iso:{ AZ:"Qoruyucu izolyasiya", TR:"Koruyucu izolasyon", RU:"Защитная изоляция", EN:"Protective isolation" },
    cp_f_neo:{ AZ:"Yenidoğulmuş", TR:"Yenidoğan", RU:"Новорождённый", EN:"Neonate" },
    cp_f_conf:{ AZ:"Şüur: konfuziya", TR:"Bilinç: konfüze", RU:"Сознание: спутанное", EN:"Consciousness: confused" },
    cp_f_intub:{ AZ:"Entubasiya (fəaliyyət qeydi)", TR:"Entübasyon (faaliyet kaydı)", RU:"Интубация (запись мероприятий)", EN:"Intubation (activity record)" },
    cp_w_intub_tpl:{ AZ:"Entubasiya · gün {d} (fəaliyyət qeydi)", TR:"Entübasyon · {d}. gün (faaliyet kaydı)", RU:"Интубация · день {d} (запись мероприятий)", EN:"Intubation · day {d} (activity record)" },
    cp_w_age_tpl:{ AZ:"Yaş {v} · bölmə qaydası: ≥{t}", TR:"Yaş {v} · birim kuralı: ≥{t}", RU:"Возраст {v} · правило отделения: ≥{t}", EN:"Age {v} · unit rule: ≥{t}" },
    cp_w_spo2_tpl:{ AZ:"Son SpO₂ {v}% · bölmə qaydası: ≤{t}", TR:"Son SpO₂ %{v} · birim kuralı: ≤{t}", RU:"Последняя SpO₂ {v}% · правило отделения: ≤{t}", EN:"Last SpO₂ {v}% · unit rule: ≤{t}" },
    cp_lvl_orta:{ AZ:"orta və yuxarı", TR:"orta ve üstü", RU:"средний и выше", EN:"medium or higher" },
    cp_lvl_yuksek:{ AZ:"yalnız yüksək", TR:"yalnız yüksek", RU:"только высокий", EN:"high only" },
    cp_yes:{ AZ:"var", TR:"var", RU:"есть", EN:"present" },
  });
  /* 24.09 (5. oturum) · bölüme göre içerik: kapsam adları, birim paketi süzmesi, "bu birim için madde öner". */
  H.addT({
    cp_sc_all:{ AZ:"Bütün bölmələr", TR:"Tüm birimler", RU:"Все отделения", EN:"All units" },
    cp_sc_icu:{ AZ:"Böyüklər reanimasiyası", TR:"Erişkin YBÜ", RU:"Взрослая реанимация", EN:"Adult ICU" },
    cp_sc_cvicu:{ AZ:"KVC reanimasiyası", TR:"KVC YBÜ", RU:"Кардиохирургическая реанимация", EN:"Cardiac surgery ICU" },
    cp_sc_ccu:{ AZ:"Koronar reanimasiya", TR:"Koroner YBÜ", RU:"Коронарная реанимация", EN:"Coronary care unit" },
    cp_sc_nicu:{ AZ:"Yenidoğulmuş reanimasiyası", TR:"Yenidoğan YBÜ", RU:"Реанимация новорождённых", EN:"Neonatal ICU" },
    cp_sc_picu:{ AZ:"Uşaq reanimasiyası", TR:"Çocuk YBÜ", RU:"Детская реанимация", EN:"Paediatric ICU" },
    cp_sc_med:{ AZ:"Daxili xəstəliklər servisi", TR:"Dahiliye servisi", RU:"Терапевтическое отделение", EN:"Medical ward" },
    cp_sc_surg:{ AZ:"Cərrahiyyə servisi", TR:"Cerrahi servis", RU:"Хирургическое отделение", EN:"Surgical ward" },
    cp_sc_cward:{ AZ:"Uşaq servisi", TR:"Çocuk servisi", RU:"Детское отделение", EN:"Paediatric ward" },
    cp_sc_er:{ AZ:"Təcili yardım", TR:"Acil", RU:"Приёмное отделение", EN:"Emergency" },
    cp_ps_yb:{ AZ:"Bütün reanimasiyalar", TR:"Tüm yoğun bakımlar", RU:"Все реанимации", EN:"All ICUs" },
    cp_ps_eyb:{ AZ:"Böyüklər reanimasiyaları", TR:"Erişkin yoğun bakımlar", RU:"Взрослые реанимации", EN:"Adult ICUs" },
    cp_ps_notnn:{ AZ:"Yenidoğulmuş xaric", TR:"Yenidoğan hariç", RU:"Кроме новорождённых", EN:"All except neonatal" },
    cp_ps_ward:{ AZ:"Servislər", TR:"Servisler", RU:"Отделения (палаты)", EN:"Wards" },
    cp_pkg_tpl:{ AZ:"{u} paketi", TR:"{u} paketi", RU:"Пакет: {u}", EN:"{u} package" },
    cp_other_units:{ AZ:"Digər bölmələrin maddələrini də göstər", TR:"Diğer birimlerin maddelerini de göster", RU:"Показать пункты других отделений", EN:"Also show other units' items" },
    cp_other_unit:{ AZ:"digər bölmə", TR:"diğer birim", RU:"другое отделение", EN:"other unit" },
    cp_hidden_tpl:{ AZ:"({n} gizli)", TR:"({n} gizli)", RU:"(скрыто: {n})", EN:"({n} hidden)" },
    cp_rows_hidden_tpl:{ AZ:"Digər bölmələrə aid {n} maddə göstərilmir ({u} paketi).", TR:"Başka birimlere özgü {n} madde gösterilmiyor ({u} paketi).", RU:"Не показано пунктов других отделений: {n} (пакет: {u}).", EN:"{n} item(s) specific to other units are hidden ({u} package)." },
    cp_prop_btn_tpl:{ AZ:"{u} üçün maddə təklif et", TR:"{u} için madde öner", RU:"Предложить пункт для: {u}", EN:"Suggest an item for {u}" },
    cp_prop_kind:{ AZ:"Növ", TR:"Tür", RU:"Тип", EN:"Type" },
    cp_prop_ph:{ AZ:"Maddənin mətni…", TR:"Madde metni…", RU:"Текст пункта…", EN:"Item text…" },
    cp_prop_note:{ AZ:"Təklif rəhbərliyin təsdiqindən sonra kataloqa düşür.", TR:"Öneri yönetimin onayından sonra kataloğa girer.", RU:"Предложение попадёт в каталог после одобрения руководством.", EN:"The suggestion enters the catalogue after management approval." },
    cp_prop_send:{ AZ:"Göndər", TR:"Gönder", RU:"Отправить", EN:"Send" },
    cp_prop_empty:{ AZ:"Maddənin mətnini yazın", TR:"Madde metnini yazın", RU:"Введите текст пункта", EN:"Enter the item text" },
    cp_prop_sent:{ AZ:"Təklif rəhbərliyə göndərildi · audit qeydinə yazıldı", TR:"Öneri yönetime iletildi · denetim kaydına yazıldı", RU:"Предложение отправлено руководству · записано в журнал аудита", EN:"Suggestion sent to management · written to the audit log" },
  });
  const tpl = (key, vals) => Object.entries(vals || {}).reduce((s, [k, v]) => s.split("{" + k + "}").join(v), H.t(key));
  const txt = (x) => typeof x === "function" ? x() : (x || "");          // tarihçe/son kayıt metni: dil değişince yeniden üretilir
  const LOC = () => ({ AZ:"az", TR:"tr-TR", RU:"ru-RU", EN:"en-US" }[H.state.lang] || "tr-TR");
  const DEC = () => (H.state.lang === "EN" ? "." : ",");
  // Onay / netleştirme notları kullanıcı ekranında görünmez; yalnız yönetim yetkisi olana (core.js H.adminNote) çizilir.
  const AN = (k) => H.adminNote ? H.adminNote(H.t(k)) : "";

  /* ================================ stil (yalnız CSS değişkenleri) ================================ */
  const CSS = `
  .cp-root{min-width:0;max-width:100%}
  .cp-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
  .cp-head h4{margin:0;font:700 16px "Space Grotesk"}
  .cp-head .cp-sum{font-size:12.5px;color:var(--mute)} .cp-head .cp-sum b{color:var(--ink)}
  .cp-head .r{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
  .cp-sug{border:1px solid color-mix(in srgb,var(--pri) 40%,transparent);background:var(--priSoft);border-radius:14px;padding:10px 12px;margin-bottom:12px}
  .cp-sugh{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:700 13px Figtree;color:var(--ink)}
  .cp-sugh svg{width:15px;height:15px;color:var(--pri)} .cp-sugh span{font-weight:500;font-size:12px;color:var(--mute)}
  .cp-sugl{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin-top:8px}
  .cp-sgi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:9px 10px;display:flex;flex-direction:column;gap:8px;min-width:0}
  .cp-sgi b{font:700 13.5px Figtree}
  .cp-sgi ul{margin:4px 0 0;padding:0 0 0 16px;font-size:12px;color:var(--mute);line-height:1.45}
  .cp-sgb{display:flex;gap:6px;margin-top:auto;flex-wrap:wrap}
  .cp-sgf{font-size:11.5px;color:var(--mute);margin-top:8px;line-height:1.45}
  .cp-sgf a{cursor:pointer;font-weight:700}
  .cp-warn{display:grid;gap:6px;margin-bottom:12px}
  .cp-warn .note{display:flex;gap:8px;align-items:flex-start;font-size:12.5px}
  .cp-warn .note svg{width:15px;height:15px;flex:none;margin-top:1px}
  .cp-tw{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--card);max-width:100%}
  table.cp-t{border-collapse:separate;border-spacing:0;width:100%;min-width:640px;font-size:12.5px}
  table.cp-t th,table.cp-t td{border-bottom:1px solid var(--line);padding:7px 6px;text-align:center;vertical-align:middle}
  table.cp-t thead th{font:700 10.5px Figtree;letter-spacing:.05em;text-transform:uppercase;color:var(--mute);background:var(--card2);white-space:nowrap}
  table.cp-t thead th.cp-day{border-left:1px solid var(--line)}
  table.cp-t thead th.cp-day.today{color:var(--ink)}
  table.cp-t thead th.cp-shh{font:700 11px "JetBrains Mono";letter-spacing:0;text-transform:none}
  table.cp-t thead th.cp-shh:nth-child(odd){border-left:1px solid var(--line)}
  table.cp-t thead th.cp-shh.now{color:var(--pri);background:var(--priSoft)}
  table.cp-t thead th small{display:block;font:700 9.5px Figtree;letter-spacing:.04em;text-transform:uppercase}
  table.cp-t .cp-dx,table.cp-t .cp-dxh{position:sticky;left:0;z-index:1;text-align:left;background:var(--card);border-right:1px solid var(--line);min-width:190px;max-width:250px;white-space:normal}
  table.cp-t thead .cp-dxh{background:var(--card2);z-index:2}
  .cp-dxn b{font:700 13.5px Figtree;color:var(--ink)} .cp-dxn .tag{margin-left:4px;font-size:10.5px;padding:1px 6px}
  .cp-dxm{font-size:11.5px;color:var(--mute);font-weight:500;margin-top:2px}
  .cp-st{color:var(--ok);font-weight:700}
  .cp-dxa{display:flex;gap:2px;margin-top:4px}
  .cp-ic{width:30px;height:30px;border-radius:8px;border:1px solid transparent;background:none;display:grid;place-items:center;color:var(--mute);cursor:pointer;padding:0}
  .cp-ic:hover{background:var(--card2);color:var(--ink);border-color:var(--line2)} .cp-ic svg{width:15px;height:15px}
  .cp-ic.on{color:var(--pri);background:var(--priSoft)}
  td.cp-c{min-width:62px;cursor:pointer;font:700 15px Figtree}
  td.cp-c:nth-child(even){border-left:1px solid var(--line)}
  td.cp-c:hover{background:var(--card2)}
  td.cp-c.na{cursor:default;background:repeating-linear-gradient(135deg,transparent,transparent 5px,var(--card2) 5px,var(--card2) 7px)}
  td.cp-c.na:hover{background:repeating-linear-gradient(135deg,transparent,transparent 5px,var(--card2) 5px,var(--card2) 7px)}
  td.cp-c.miss{color:var(--mute);opacity:.75}
  td.cp-c.now{background:var(--priSoft)}
  .cp-ck{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:color-mix(in srgb,var(--c) 18%,transparent);color:var(--c);font:800 14px Figtree}
  .cp-ck small{font:700 9px Figtree}
  .cp-late{display:block;font:700 9px Figtree;color:var(--mute);letter-spacing:.04em;margin-top:1px}
  .cp-go{display:inline-block;font:700 11px Figtree;color:var(--onpri);background:var(--pri);border-radius:999px;padding:3px 9px;white-space:nowrap}
  .cp-det td{background:var(--card2);text-align:left}
  .cp-detIn{position:sticky;left:8px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;max-width:min(900px,calc(100vw - 150px));font-size:12.5px}
  .cp-detIn h6{margin:0 0 4px;font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
  .cp-detIn ul{margin:0;padding-left:16px;line-height:1.5}
  .cp-leg{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--mute);margin-top:8px;align-items:center}
  .cp-leg .cp-ck{width:20px;height:20px;font-size:11px}
  .cp-foot{font-size:11.5px;color:var(--mute);margin-top:6px;line-height:1.45}
  .cp-ended{margin-top:12px}
  .cp-ended .kv span{min-width:0}
  /* modallar */
  .cp-nd{display:grid;gap:10px}
  .cp-ndTop{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .cp-srch{flex:1 1 220px;display:flex;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--line2);border-radius:10px;padding:0 10px;color:var(--mute)}
  .cp-srch input{border:0;background:transparent;box-shadow:none!important;padding:9px 0}
  .cp-ndTop label{display:flex;align-items:center;gap:6px;font:600 12.5px Figtree;color:var(--mute);white-space:nowrap}
  .cp-ndTop input[type=date]{width:auto;padding:7px 9px}
  .cp-cat{font-size:11.5px;color:var(--mute)} .cp-cat b{color:var(--attInk)}
  .cp-ndGrid{display:grid;grid-template-columns:minmax(200px,.9fr) minmax(0,1.1fr) minmax(0,1.2fr);gap:10px;align-items:start}
  .cp-ndGrid>div{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px;min-width:0}
  .cp-ndL{max-height:440px;overflow:auto}
  .cp-li{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:9px;cursor:pointer;font:600 13px/1.3 Figtree}
  .cp-li:hover{background:var(--card2)} .cp-li.on{background:var(--priSoft);box-shadow:inset 3px 0 0 var(--pri)}
  .cp-li.dis{opacity:.6}
  .cp-li input,.cp-ck2 input{width:18px;height:18px;flex:none;padding:0;accent-color:var(--pri)}
  .cp-li span{flex:1;min-width:0}
  .cp-li em{font-style:normal;font:700 10px Figtree;padding:1px 6px;border-radius:999px;background:var(--priSoft);color:var(--pri);white-space:nowrap}
  .cp-li em.in{background:var(--card2);color:var(--mute)}
  .cp-colh{font:700 14px "Space Grotesk";margin:2px 4px 6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .cp-sub{font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:10px 4px 4px;display:flex;align-items:center;gap:6px}
  .cp-sub a{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:700;cursor:pointer}
  .cp-ck2{display:flex;align-items:flex-start;gap:8px;padding:6px 6px;border-radius:8px;font-size:13px;line-height:1.35;cursor:pointer}
  .cp-ck2:hover{background:var(--card2)} .cp-ck2 input{margin-top:1px}
  .cp-ck2 .tag{font-size:10.5px;padding:1px 6px;margin-left:4px}
  .cp-ck2.dis{opacity:.55;cursor:not-allowed}
  .cp-hint{font-size:12px;color:var(--mute);background:var(--card2);border-radius:9px;padding:7px 9px;margin:0 4px}
  .cp-selS{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--mute)}
  .cp-chip{display:inline-flex;align-items:center;gap:6px;background:var(--priSoft);color:var(--ink);border-radius:999px;padding:3px 4px 3px 10px;font:600 12px Figtree}
  .cp-chip small{color:var(--mute);font-weight:600}
  .cp-chip button{border:0;background:none;width:24px;height:24px;border-radius:50%;cursor:pointer;color:var(--mute);display:grid;place-items:center;padding:0}
  .cp-chip button:hover{background:var(--card2);color:var(--ink)} .cp-chip svg{width:13px;height:13px}
  .cp-ev{display:grid;gap:10px}
  .cp-evh{display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:9px 11px}
  .cp-evh b{font:700 15px "Space Grotesk"} .cp-evh .mono{font-size:12.5px;color:var(--pri)}
  .cp-evh .r{margin-left:auto}
  .cp-goals{margin:0;padding-left:18px;font-size:12.5px;color:var(--mute);line-height:1.5}
  .cp-gopt i[data-cpe-g="met"].on{background:var(--ok);color:#fff}
  .cp-gopt i[data-cpe-g="partial"].on{background:var(--mid);color:#1b1400}
  .cp-gopt i[data-cpe-g="unmet"].on{background:var(--high);color:#fff}
  .cp-hist{display:grid;gap:0}
  .cp-hist div{display:grid;grid-template-columns:96px 1fr;gap:10px;padding:7px 0;border-bottom:1px dashed var(--line);font-size:12.5px}
  .cp-hist div:last-child{border:0} .cp-hist time{font:600 11.5px "JetBrains Mono";color:var(--mute)}
  .cp-hist small{display:block;color:var(--mute)}
  @media (max-width:860px){.cp-ndGrid{grid-template-columns:1fr}.cp-ndL{max-height:230px}.cp-detIn{grid-template-columns:1fr;max-width:calc(100vw - 80px)}}
  /* 24.09 · tanı ekleme penceresi: solda liste (gruplu), sağda seçilen tanı sekmeleri + Nedenler/Hedefler | Faaliyetler */
  .modal.cp-xl{width:min(1500px,100%)}
  .modal.cp-xl .mb{padding:12px 16px}
  .cp-x{display:grid;grid-template-columns:minmax(250px,320px) minmax(0,1fr);gap:12px;align-items:stretch;min-height:0}
  .cp-x>div{min-width:0}
  .cp-xL{background:var(--card);border:1px solid var(--line);border-radius:12px;display:flex;flex-direction:column;min-height:0;max-height:min(600px,calc(100vh - 290px))}
  .cp-xL .cp-srch{margin:8px;flex:none}
  .cp-xLs{overflow:auto;padding:0 6px 8px;min-height:0}
  .cp-xg{font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:10px 6px 4px;display:flex;gap:6px;align-items:center}
  .cp-xg svg{width:13px;height:13px}
  .cp-li small{display:block;font:500 11px Figtree;color:var(--mute);margin-top:1px}
  .cp-li em.pd{background:var(--card2);color:var(--attInk)}
  .cp-xR{display:flex;flex-direction:column;gap:8px;min-height:0}
  .cp-tabs{display:flex;gap:4px;flex-wrap:wrap;align-items:flex-end;border-bottom:1px solid var(--line);padding:0 2px}
  .cp-tab{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;background:var(--card2);padding:6px 6px 6px 10px;font:600 12.5px Figtree;color:var(--mute);cursor:pointer;max-width:100%;margin-bottom:-1px}
  .cp-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px}
  .cp-tab small{font:700 10.5px "JetBrains Mono";color:var(--mute)}
  .cp-tab.on{background:var(--card);color:var(--ink);border-color:var(--line2);box-shadow:inset 0 2px 0 var(--pri)}
  .cp-tab.pv{border-style:dashed;font-style:italic}
  .cp-tab button{border:0;background:none;width:22px;height:22px;border-radius:50%;cursor:pointer;color:var(--mute);display:grid;place-items:center;padding:0}
  .cp-tab button:hover{background:var(--card2);color:var(--ink)} .cp-tab svg{width:12px;height:12px}
  .cp-xH{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .cp-xH b{font:700 16px "Space Grotesk"}
  .cp-xH .r{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .cp-xP{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:10px;align-items:start}
  .cp-xP>div{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px 8px 8px;min-width:0;max-height:min(520px,calc(100vh - 360px));overflow:auto}
  .cp-xS{font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:8px 4px 4px;display:flex;align-items:center;gap:6px;position:sticky;top:-6px;background:var(--card);padding:4px 0;z-index:1}
  .cp-xS i{font-style:normal;font:700 10.5px "JetBrains Mono";letter-spacing:0}
  .cp-xS a{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:700;cursor:pointer;color:var(--pri)}
  .cp-src{display:inline-block;font:600 11px/1.35 Figtree;color:var(--pri);background:var(--priSoft);border-radius:8px;padding:2px 8px;margin:3px 0 0;white-space:normal;max-width:100%;overflow-wrap:anywhere}
  .cp-src svg{width:11px;height:11px;vertical-align:-1px;margin-right:4px}
  .cp-ck2 .cp-t2{flex:1;min-width:0}
  .cp-ck2 .cp-t2>span{display:block}
  .cp-fq{display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap}
  .cp-fq select{width:auto;padding:3px 6px;font-size:11.5px;min-width:0;max-width:100%}
  .cp-fq select:disabled{opacity:.45}
  .cp-pend{border:1px dashed var(--attLine);background:var(--att);color:var(--attInk);border-radius:12px;padding:12px;font-size:13px;line-height:1.45}
  .cp-pend b{display:block;margin-bottom:2px}
  .cp-xN textarea{min-height:92px}
  .cp-bar{margin-right:auto;font-size:12.5px;color:var(--mute);align-self:center}
  .cp-bar b{color:var(--ink)}
  .cp-dr{display:inline-flex;align-items:center;gap:5px;cursor:pointer}
  .cp-v{font:600 10.5px "JetBrains Mono";color:var(--mute);border:1px solid var(--line);border-radius:6px;padding:0 4px;margin-left:2px}
  .cp-v.old{color:var(--attInk);border-color:var(--attLine)}
  .cp-detIn .cp-fqt{font:600 10.5px Figtree;color:var(--mute);margin-left:4px}
  /* 24.09 (5. oturum) · birim paketi süzmesi + madde önerisi */
  .cp-pkg{display:flex;align-items:center;gap:6px;margin:2px 6px 0;font:600 11.5px Figtree;color:var(--pri)}
  .cp-pkg svg{width:13px;height:13px}
  .cp-xgA{flex-wrap:wrap}
  .cp-oth{margin-left:auto;display:inline-flex;align-items:center;gap:5px;text-transform:none;letter-spacing:0;font:600 11px Figtree;color:var(--mute);cursor:pointer}
  .cp-oth input{width:14px;height:14px;padding:0;accent-color:var(--pri)} .cp-oth i{font-style:normal;color:var(--attInk)}
  .cp-prop{margin:10px 4px 0;font-size:12.5px}
  .cp-prop a{cursor:pointer;font-weight:700;color:var(--pri);display:inline-flex;align-items:center;gap:4px} .cp-prop a svg{width:13px;height:13px}
  .cp-prop.on{display:grid;gap:6px;border:1px dashed var(--line2);border-radius:10px;padding:8px}
  .cp-propR{display:flex;gap:6px;align-items:center;flex-wrap:wrap} .cp-propR select{width:auto;padding:4px 6px;font-size:12px}
  @media (max-width:860px){.cp-x{grid-template-columns:1fr}.cp-xL{max-height:260px}.cp-xP{grid-template-columns:1fr}.cp-xP>div{max-height:none;overflow:visible}.cp-xS{position:static}
    .modal.cp-xl .mf{flex-wrap:wrap}.cp-bar{flex:1 1 100%;margin:0 0 4px}.cp-tab span{max-width:180px}}

  /* ---------- sıvı izlem ızgarası ---------- */
  .cp-io-root{min-width:0;max-width:100%}
  .cp-io-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
  .cp-io-top .seg button{padding:5px 9px;font-size:12px}
  .cp-io-top .r{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .cp-io-top label{display:flex;gap:6px;align-items:center;font:600 12px Figtree;color:var(--mute);cursor:pointer;white-space:nowrap}
  .cp-io-top label input{width:16px;height:16px;padding:0;accent-color:var(--pri)}
  .cp-io-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px;max-width:100%;background:var(--card)}
  table.cp-io{border-collapse:separate;border-spacing:0;font-size:12px;min-width:100%}
  table.cp-io th,table.cp-io td{padding:5px 6px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:right;font-family:"JetBrains Mono",monospace}
  table.cp-io thead th{font:700 10.5px "JetBrains Mono";color:var(--mute);background:var(--card2);text-align:center;min-width:44px}
  table.cp-io thead th.now{color:var(--pri);background:var(--priSoft)}
  table.cp-io thead th small{display:block;font:700 8.5px Figtree;letter-spacing:.04em;text-transform:uppercase}
  table.cp-io .h{position:sticky;left:0;z-index:1;background:var(--card);text-align:left;font:600 12px Figtree;min-width:150px;max-width:200px;white-space:normal;border-right:1px solid var(--line)}
  table.cp-io thead .h{background:var(--card2);z-index:2}
  table.cp-io .h.in2{padding-left:18px;font-weight:500}
  table.cp-io .h .pb{display:inline-block;font:700 9.5px Figtree;color:var(--pri);background:var(--priSoft);border-radius:999px;padding:0 6px;margin-left:4px;vertical-align:1px}
  table.cp-io tr.sec th,table.cp-io tr.sec td{background:var(--card2);font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
  table.cp-io tr.grp th,table.cp-io tr.grp td{font-weight:700;color:var(--mute)}
  table.cp-io td.c{cursor:pointer;color:var(--ink);position:relative}
  table.cp-io td.c:hover{background:var(--card2)}
  table.cp-io td.c:empty::after{content:"+";color:var(--line2);font-weight:700}
  table.cp-io td.c:hover:empty::after{color:var(--pri)}
  table.cp-io td.c.pump{color:var(--pri)}
  table.cp-io td.c.fix{box-shadow:inset 0 -2px 0 var(--mid)}
  table.cp-io td.now{background:color-mix(in srgb,var(--pri) 7%,transparent)}
  table.cp-io td.fut{color:var(--line2);background:repeating-linear-gradient(135deg,transparent,transparent 5px,var(--card2) 5px,var(--card2) 7px);cursor:default}
  table.cp-io td.gap{box-shadow:inset 0 0 0 1px var(--attLine);background:var(--att)}
  table.cp-io tr.tot th,table.cp-io tr.tot td{font-weight:700;background:var(--card2)}
  table.cp-io tr.tot.b th,table.cp-io tr.tot.b td{border-top:2px solid var(--line2)}
  table.cp-io td.pos{color:var(--pri)} table.cp-io td.neg{color:var(--attInk)}
  .cp-io-warn{display:grid;gap:6px;margin-top:8px}
  .cp-io-warn .note{font-size:12px}
  .cp-io-leg{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--mute);margin-top:8px;align-items:center}
  .cp-io-leg i{display:inline-block;width:14px;height:10px;border-radius:3px;vertical-align:-1px;margin-right:4px}
  .cp-io-ent{display:grid;gap:0;margin-bottom:10px}
  .cp-io-ent div{display:grid;grid-template-columns:62px 1fr auto;gap:8px;padding:6px 0;border-bottom:1px dashed var(--line);font-size:12.5px;align-items:center}
  .cp-io-ent div:last-child{border:0} .cp-io-ent time{font:600 11.5px "JetBrains Mono";color:var(--mute)} .cp-io-ent b{font-family:"JetBrains Mono"}
  `;
  if (!document.getElementById("cp-css")) { const st = document.createElement("style"); st.id = "cp-css"; st.textContent = CSS; document.head.appendChild(st); }

  /* ================================ katalog (VERİ · sürümlü) ================================
   * 24.09 kararı: katalog koda gömülü bir liste değil, VERİDİR. Hastanenin kendi listesi hastane kayıt sisteminden içe
   * aktarılır, Yönetim → Bakım kataloğu'nda düzenlenir, SÜRÜMLÜ tutulur. Aşağıdaki CAT_RAW yalnız v1'in tohumudur
   * (25 tanı, içerik birim hemşireleriyle yazıldı); HBYS_NAMES hastanenin "Tanı Ekleme" ekranındaki adlardır.
   * 24.09 (5. oturum) · Ozan: "eksik tanı alanlarını da ekleyelim, rahat edelim." Boş duran tanılar genel hemşirelik
   * uygulamasına dayanan BAŞLANGIÇ içeriğiyle dolduruldu (src:"baslangic" · yönetimde "hastane onayı bekliyor"); ilaç adı,
   * doz, sayısal eşik ve tanı koyan cümle yoktur. Hastanenin ekranından birebir alınan iki tanı (Düşme riski, Aspirasyon
   * riski) src:"hastane"dir ve metinleri AYNEN durur. İleride yalnız ad gelen yeni tanı yine boş kalır ("içerik bekliyor").
   * BÖLÜME GÖRE İÇERİK: tek ana katalog + birim paketleri. Her tanı ve her madde bir kapsam taşır (u / units: birim türü
   * listesi; null = tüm birimler). Tanı ekleme penceresi hastanın biriminin kapsamına göre süzer. Birim paketi = o birimin
   * sık kullandıkları + görünür/gizli anahtarları (PKG); birime özgü madde ana katalogda kapsamlı satır olarak durur.
   * Her plan yazıldığı katalog sürümünün kopyasını (snap) taşır; katalog değişse de eski plan kendi sürümüyle açılır.
   * Faaliyet: düz metin ya da [metin, bağ]. Bağ "form:<H.FORMS anahtarı>" ya da "care:<görev etiketi>";
   * vardiya değerlendirmesinde o vardiyada tamamlanmış kayıt varsa faaliyet önceden işaretlenir (hemşire değiştirebilir). */
  const PRES = "Pozisyon kurum protokolündeki aralıkla değiştirilecek";
  const CAT_RAW = [
    { key:"agri", name:"Ağrı", group:"Konfor",
      causes:["Cerrahi girişim / doku hasarı", "Enfeksiyon / inflamasyon", "İnvaziv girişimler (kateter, dren, tüp)", "Hareketsizlik / uygun olmayan pozisyon", "Hastalığa bağlı süreç"],
      goals:["Hasta ağrısının azaldığını ifade eder / ağrı skoru hastanenin hedef aralığına iner", "Hasta ağrıyı azaltan yöntemleri kullanır", "Ağrıya bağlı davranış bulguları (yüz ifadesi, huzursuzluk) azalır"],
      acts:[["Ağrı skoru 4 saatte bir ve gerektikçe değerlendirilecek", "form:pain"], "Hekim istemine göre analjezik uygulanacak, etkisi değerlendirilecek", "Ağrının yeri, niteliği ve süresi kaydedilecek", ["Rahat pozisyon verilecek", "care:Pozisyon ver"], "Farmakolojik olmayan yöntemler (soğuk/sıcak uygulama, dikkati başka yöne çekme) uygulanacak", "Işık ve gürültü azaltılarak uygun ortam sağlanacak", "Ağrı artışı ya da yeni ağrı hekime bildirilecek"] },
    { key:"enfeksiyon", name:"Enfeksiyon riski", group:"Güvenlik",
      causes:["İnvaziv girişimler (santral/periferik kateter, üriner kateter)", "Bağışıklık sisteminde baskılanma", "Cerrahi yara", "Uzun süreli hastanede yatış", "Kronik hastalık (diyabet vb.)"],
      goals:["Enfeksiyon belirti ve bulguları gelişmez ya da erken fark edilir", "Kateter giriş yerleri temiz ve kuru kalır", "Hasta/yakını enfeksiyondan korunma önlemlerini uygular"],
      acts:[["Vücut ısısı ve vital bulgular izlenecek", "form:vitals"], "El hijyeni kurallarına uyulacak", "Kateter giriş yerleri enfeksiyon bulguları yönünden değerlendirilecek", "Kateter ve pansuman bakımı kurum protokolüne göre yapılacak", "Aseptik tekniğe uyulacak", "Hekim istemine göre kültür örnekleri alınacak", "Hekim istemine göre antibiyotik uygulanacak", "Gerekiyorsa izolasyon önlemleri uygulanacak"] },
    { key:"dusme", name:"Düşme riski", group:"Güvenlik", ages:["adult", "child"],
      causes:["İleri yaş", "Bilinç değişikliği / sedasyon", "Mobilizasyonda kısıtlılık", "Düşme riskini artıran ilaç kullanımı", "Daha önce düşme öyküsü"],
      goals:["Yatış süresince düşme olmaz", "Hasta/yakını düşme önlemlerini bilir ve uygular"],
      acts:[["Düşme riski kurum protokolündeki sıklıkla değerlendirilecek", "form:fall"], "Yatak kenarlıkları kaldırılacak, yatak en alçak konumda tutulacak", "Çağrı zili hastanın erişebileceği yere konacak", "Hasta odasına / yatağına düşme riski işareti konacak", "Mobilizasyonda hastaya eşlik edilecek", "Zemin kuru, ortam aydınlık tutulacak", "Hasta ve yakınına düşme önlemleri anlatılacak"] },
    { key:"deri_risk", name:"Deri bütünlüğünde bozulma riski", group:"Deri",
      causes:["Hareketsizlik", "Nem / inkontinans", "Beslenme yetersizliği", "Sürtünme ve makaslama", "Periferik dolaşımda azalma"],
      goals:["Deri bütünlüğü korunur", "Basınç bölgelerinde kızarıklık gelişmez"],
      acts:[["Bası yarası riski günde 1 kez değerlendirilecek", "form:braden"], [PRES, "care:Pozisyon ver"], "Kemik çıkıntıları her vardiyada kontrol edilecek", "Deri temiz ve kuru tutulacak", "Basınç azaltıcı yüzey kullanılacak", "Çarşaf gergin ve kırışıksız tutulacak", "Beslenme durumu izlenecek"] },
    { key:"deri_bozulma", name:"Deri bütünlüğünde bozulma (bası yarası)", group:"Deri",
      opt:{ l:"Evre", v:["Evre 1", "Evre 2", "Evre 3", "Evre 4", "Evrelendirilemeyen", "Derin doku hasarı şüphesi"] },
      causes:["Uzun süreli basınç", "Nem / inkontinans", "Beslenme yetersizliği", "Sürtünme ve makaslama"],
      goals:["Yara iyileşme belirtileri gösterir", "Yarada enfeksiyon gelişmez", "Yeni basınç yarası gelişmez"],
      acts:[["Yara her pansumanda değerlendirilecek ve kaydedilecek", "form:wound"], "Yara bakımı kurum protokolüne ve hekim / yara bakım hemşiresi önerisine göre yapılacak", "Yara bölgesine bası engellenecek", [PRES, "care:Pozisyon ver"], "Yara çevresindeki deri değerlendirilecek", "Beslenme desteği için diyetisyenle iş birliği yapılacak", "Enfeksiyon bulguları hekime bildirilecek"] },
    { key:"aktivite", name:"Aktivite intoleransı", group:"Hareket",
      causes:["Oksijen gereksinimi ile sunumu arasında dengesizlik", "Uzun süreli yatak istirahati", "Genel güçsüzlük", "Ağrı"],
      goals:["Hasta günlük aktivitelerini tolerans sınırları içinde yapar", "Aktivite sırasında vital bulguları hekimin belirlediği aralıkta kalır"],
      acts:[["Aktivite öncesi ve sonrası vital bulgular izlenecek", "form:vitals"], "Aktiviteler dinlenme aralarıyla planlanacak", "Kademeli mobilizasyon sağlanacak", "Yorgunluk, nefes darlığı gibi belirtiler izlenecek", "Günlük aktivitelerde gerektiği kadar yardım edilecek"] },
    { key:"anksiyete", name:"Anksiyete", group:"Psikososyal",
      causes:["Yoğun bakım ortamı", "Hastalığın seyri hakkında belirsizlik", "Ağrı", "Aileden ayrı kalma"],
      goals:["Hasta anksiyetesinin azaldığını ifade eder", "Hasta duygularını ifade eder"],
      acts:["Hastanın duygularını ifade etmesine fırsat verilecek", "Yapılacak işlemler öncesinde açıklama yapılacak", "Sakin ve güven veren bir ortam sağlanacak", "Aile ziyaretleri kurum kurallarına göre desteklenecek", "Anksiyete bulguları izlenecek ve kaydedilecek"] },
    { key:"aspirasyon", name:"Aspirasyon riski", group:"Solunum",
      causes:["Bilinç düzeyinde azalma", "Yutma güçlüğü", "Enteral beslenme", "Öksürük / öğürme refleksinde azalma"],
      goals:["Aspirasyon gelişmez", "Hava yolu açıklığı korunur"],
      acts:["Yatak başı kurum protokolüne / hekim istemine göre yükseltilecek", "Beslenme tüpünün yeri beslenme öncesinde kontrol edilecek", "Yutma güçlüğü açısından değerlendirme yapılacak", "Gerektiğinde ağız ve üst solunum yolu aspirasyonu yapılacak", "Ağız bakımı yapılacak", "Öksürük, solunum sıkıntısı gibi bulgular izlenecek"] },
    { key:"solunum", name:"Etkisiz solunum örüntüsü", group:"Solunum",
      causes:["Solunum kaslarında yorgunluk", "Enfeksiyon / akciğer hastalığı", "Ağrı", "Anksiyete", "Bilinç değişikliği"],
      goals:["Solunum sayısı ve derinliği hasta için belirlenen aralıkta olur", "Oksijen satürasyonu hekimin belirlediği hedefte kalır", "Solunum sıkıntısı bulguları azalır"],
      acts:[["Solunum sayısı, derinliği ve SpO₂ izlenecek", "form:vitals"], "Hekim istemine göre oksijen tedavisi uygulanacak", "Solunumu kolaylaştıran pozisyon verilecek", "Yardımcı solunum kaslarının kullanımı izlenecek", "Derin solunum egzersizleri öğretilecek", "Solunum sıkıntısının artması hekime bildirilecek"] },
    { key:"havayolu", name:"Hava yolu temizlemede etkisizlik", group:"Solunum",
      causes:["Sekresyon artışı", "Etkisiz öksürük", "Yapay hava yolu", "Kronik akciğer hastalığı"],
      goals:["Hava yolu açıklığı korunur", "Hasta sekresyonlarını etkili şekilde çıkarır", "Solunum sesleri iyileşir"],
      acts:["Solunum sesleri değerlendirilecek", "Etkili öksürme teknikleri öğretilecek", "Gerektiğinde aspirasyon yapılacak, sekresyonun rengi ve miktarı kaydedilecek", "Hekim istemine göre nemlendirme / inhalasyon uygulanacak", "Sıvı alımı hekim istemi doğrultusunda desteklenecek", "Pozisyon değişikliği ile sekresyon drenajı desteklenecek"] },
    { key:"sivi_eksik", name:"Sıvı volüm eksikliği riski", group:"Sıvı–beslenme",
      causes:["Kusma / ishal", "Ateş", "Yetersiz sıvı alımı", "Drenlerden kayıp", "Kanama"],
      goals:["Sıvı dengesi korunur", "Dehidratasyon bulguları gelişmez"],
      acts:[["Aldığı–çıkardığı izlenecek ve kaydedilecek", "form:io"], "Mukoz membranlar ve deri turgoru değerlendirilecek", ["Vital bulgular izlenecek", "form:vitals"], "Hekim istemine göre IV sıvı uygulanacak", "Günlük kilo takibi yapılacak", "İdrar miktarı ve rengi izlenecek"] },
    { key:"sivi_fazla", name:"Sıvı volüm fazlalığı", group:"Sıvı–beslenme",
      causes:["Kalp yetmezliği", "Böbrek fonksiyonlarında bozulma", "Aşırı sıvı alımı", "Sodyum tutulumu"],
      goals:["Ödem azalır", "Sıvı dengesi hekimin belirlediği hedefe yaklaşır", "Solunum sıkıntısı gelişmez"],
      acts:[["Aldığı–çıkardığı izlenecek ve kaydedilecek", "form:io"], "Günlük kilo takibi aynı koşullarda yapılacak", "Ödem değerlendirilecek", "Solunum sesleri ve solunum sıkıntısı izlenecek", "Hekim istemine göre sıvı kısıtlaması uygulanacak", "Hekim istemine göre diüretik uygulanacak, etkisi izlenecek"] },
    { key:"hipertermi", name:"Hipertermi", group:"Isı",
      causes:["Enfeksiyon", "Dehidratasyon", "Metabolizma hızında artış", "Çevre ısısı"],
      goals:["Vücut ısısı normal sınırlara iner", "Hipertermiye bağlı komplikasyon gelişmez"],
      acts:[["Vücut ısısı kurum protokolüne göre ölçülecek", "form:vitals"], "Hekim istemine göre ateş düşürücü uygulanacak, etkisi değerlendirilecek", "Soğuk uygulama yapılacak", "Oda ısısı düzenlenecek, ince giysi / örtü kullanılacak", "Sıvı alımı desteklenecek", "Titreme ve bilinç değişikliği izlenecek"] },
    { key:"hipotermi", name:"Hipotermi / hipotermi riski", group:"Isı", ages:["neonate", "child", "adult"],
      causes:["Prematürite / düşük doğum ağırlığı", "Deri altı yağ dokusunun azlığı", "Çevre ısısının düşük olması", "Enfeksiyon / sepsis"],
      goals:["Vücut ısısı normal sınırlarda korunur", "Isı kaybına bağlı komplikasyon gelişmez"],
      acts:[["Vücut ısısı kurum protokolüne göre ölçülecek", "form:vitals"], "Küvöz / ısıtıcı ısısı ve nemi izlenecek, kaydedilecek", "İşlemler küvöz kapaklarının açık kalma süresi en aza indirilerek yapılacak", "Isıtılmış örtü ve bere kullanılacak", "Uygun olduğunda aile ile ten tene temas desteklenecek", "Soğuk yüzeylerle temas engellenecek"] },
    { key:"kanama", name:"Kanama riski", group:"Güvenlik",
      causes:["Pıhtılaşma bozukluğu", "Antikoagülan tedavi", "Trombosit düşüklüğü", "Cerrahi girişim"],
      goals:["Kanama gelişmez ya da erken fark edilir", "Hasta kanama bulgularını bildirir"],
      acts:["Kanama bulguları (peteşi, ekimoz, dren/idrar/gaitada kan) izlenecek", "İnvaziv girişimler en aza indirilecek", "Girişim yerlerine yeterli süre bası uygulanacak", "Yumuşak diş fırçası kullanılacak", "Hekim istemine göre laboratuvar örnekleri alınacak", "Kanama bulgusu hekime hemen bildirilecek"] },
    { key:"beslenme", name:"Beslenme dengesizliği riski (gereksinimden az)", group:"Sıvı–beslenme",
      causes:["İştahsızlık", "Yutma güçlüğü", "Metabolik gereksinim artışı", "Oral alımın kısıtlanması"],
      goals:["Beslenme gereksinimi karşılanır", "Kilo kaybı gelişmez"],
      acts:["Besin alımı ve tüketilen miktar kaydedilecek", "Kilo takibi istem doğrultusunda yapılacak", "Diyetisyen ile iş birliği yapılacak", "Enteral / parenteral beslenme hekim istemine göre uygulanacak", "Ağız bakımı yapılacak", "Öğün saatlerinde uygun ortam sağlanacak"] },
    { key:"ozbakim", name:"Öz bakımda yetersizlik", group:"Hareket",
      causes:["Hareket kısıtlılığı", "Bilinç değişikliği", "Güçsüzlük / yorgunluk", "Ağrı"],
      goals:["Öz bakım gereksinimleri karşılanır", "Hasta yapabildiği ölçüde öz bakıma katılır"],
      acts:["Banyo, ağız bakımı ve giyinmede yardım edilecek", "Hastanın yapabildikleri teşvik edilecek", "Boşaltım gereksinimlerinde yardım edilecek", "Gerekli araç gereç erişilebilir yerde tutulacak", "Hasta yakını bakıma katılım için bilgilendirilecek"] },
    { key:"bulanti", name:"Bulantı–kusma", group:"Sıvı–beslenme",
      causes:["İlaç yan etkisi", "Gastrointestinal hastalık", "Anestezi sonrası", "Ağrı / anksiyete"],
      goals:["Bulantı–kusma azalır", "Sıvı–elektrolit dengesi korunur", "Aspirasyon gelişmez"],
      acts:["Bulantı–kusmanın sıklığı ve miktarı kaydedilecek", "Hekim istemine göre antiemetik uygulanacak, etkisi değerlendirilecek", "Kusma sırasında aspirasyonu önleyecek pozisyon verilecek", "Ağız bakımı yapılacak", ["Aldığı–çıkardığı izlenecek", "form:io"], "Koku ve uyaranlar azaltılacak"] },
    { key:"konstipasyon", name:"Konstipasyon", group:"Boşaltım",
      causes:["Hareketsizlik", "Yetersiz sıvı ve lif alımı", "İlaç yan etkisi", "Ortam değişikliği / mahremiyet eksikliği"],
      goals:["Hasta olağan bağırsak alışkanlığına döner", "Gaita çıkışı rahat olur"],
      acts:["Gaita sıklığı ve niteliği kaydedilecek", "Bağırsak sesleri ve karın distansiyonu değerlendirilecek", "Kısıtlama yoksa sıvı ve lifli besin alımı desteklenecek", "Mobilizasyon desteklenecek", "Hekim istemine göre laksatif / lavman uygulanacak", "Mahremiyet sağlanacak"] },
    { key:"retansiyon", name:"İdrar retansiyonu", group:"Boşaltım",
      causes:["Anestezi / cerrahi sonrası", "Prostat büyümesi", "İlaç yan etkisi", "Nörolojik bozukluk"],
      goals:["Hasta mesanesini etkili şekilde boşaltır", "Mesane distansiyonu gelişmez"],
      acts:[["Aldığı–çıkardığı izlenecek", "form:io"], "Mesane distansiyonu palpasyonla ya da kurum protokolüne göre mesane tarayıcıyla değerlendirilecek", "İşeme için mahremiyet ve uygun pozisyon sağlanacak", "Hekim istemine göre aralıklı / kalıcı kateterizasyon yapılacak", "İdrar rengi ve niteliği izlenecek"] },
    { key:"vap", name:"Ventilatöre bağlı pnömoni riski", group:"Solunum",
      causes:["Endotrakeal entübasyon / trakeostomi", "Uzun süreli mekanik ventilasyon", "Sedasyon", "Aspirasyon riski"],
      goals:["Ventilatöre bağlı pnömoni gelişmez", "Hava yolu açıklığı korunur"],
      acts:["Yatak başı kurum protokolüne göre yükseltilecek", "Ağız bakımı kurum protokolüne göre yapılacak", "Kaf basıncı kurum protokolüne göre kontrol edilecek", "Kapalı sistem aspirasyon aseptik teknikle yapılacak", "Ventilatör devresindeki kondansat uzaklaştırılacak", "Sedasyona ara verme ve ekstübasyon uygunluğu hekimle birlikte değerlendirilecek", "El hijyenine uyulacak"] },
    { key:"weaning", name:"Respiratörden ayrılmaya işlevsel olmayan tepki riski", group:"Solunum",
      causes:["Uzun süreli mekanik ventilasyon", "Solunum kaslarında güçsüzlük", "Anksiyete", "Beslenme yetersizliği"],
      goals:["Hasta ayırma denemesini tolere eder", "Ayırma sırasında solunum sıkıntısı bulguları erken fark edilir"],
      acts:["Ayırma denemesi öncesi hasta ve ortam hazırlanacak", ["Deneme süresince vital bulgular ve solunum örüntüsü izlenecek", "form:vitals"], "Hastaya süreç hakkında açıklama yapılacak, destek olunacak", "Tolere etmeme bulguları hekime hemen bildirilecek", "Dinlenme ve uyku dönemleri planlanacak"] },
    { key:"uyku", name:"Uyku örüntüsünde bozulma", group:"Konfor",
      causes:["Yoğun bakım ortamı (ışık, gürültü, alarmlar)", "Ağrı", "Sık yapılan girişimler", "Anksiyete"],
      goals:["Hasta yeterli uyuduğunu ifade eder", "Gece kesintisiz uyku süresi artar"],
      acts:["Gece ışık ve gürültü azaltılacak", "Bakım girişimleri gruplandırılarak uykunun bölünmesi azaltılacak", "Uyku düzeni izlenecek ve kaydedilecek", "Gündüz uyanıklık desteklenecek", "Rahat pozisyon ve ortam sağlanacak"] },
    { key:"bilgi", name:"Bilgi eksikliği", group:"Psikososyal",
      causes:["Yeni tanı / tedavi", "Bilgi kaynaklarına erişim eksikliği", "Dil / iletişim engeli", "Kaygı nedeniyle öğrenmede güçlük"],
      goals:["Hasta/yakını hastalık ve bakımıyla ilgili bilgiyi ifade eder", "Taburculuk sonrası bakımı uygulayabileceğini gösterir"],
      acts:["Bilgi gereksinimi değerlendirilecek", "Hasta/yakınına anlayabileceği dilde bilgi verilecek", "Yazılı eğitim materyali verilecek", "Geri bildirim alınarak öğrenme değerlendirilecek", "Verilen eğitim kaydedilecek"] },
    { key:"deliryum", name:"Akut konfüzyon / deliryum riski", group:"Psikososyal",
      causes:["İleri yaş", "Sedasyon / ilaç etkisi", "Uyku yoksunluğu", "Enfeksiyon", "Duyusal eksiklik (gözlük, işitme cihazı)"],
      goals:["Hasta zaman, yer ve kişi yönelimini korur", "Deliryum bulguları erken fark edilir"],
      acts:["Deliryum değerlendirmesi kurum protokolündeki araçla yapılacak", "Hastaya yönelim sağlanacak (saat, takvim, açıklama)", "Gözlük / işitme cihazı kullanımı sağlanacak", "Gece–gündüz düzeni desteklenecek", "Aile ziyaretleri desteklenecek", "Bilinç değişikliği hekime bildirilecek"] },
  ];
  // Aynı kavramın hastane kaydındaki adı (hizalama, v3). Eski ad `was` alanında kalır; v2 ile yazılmış planlar eski adla açılır.
  const ALIGN = { bulanti:"Bulantı-kusma", ozbakim:"Öz-bakımda yetersizlik", havayolu:"Hava yolunu temizlemede etkisizlik", hipotermi:"Hipotermi",
    weaning:"Respiratörden ayrılmaya tepki riski", vap:"Ventilatöre bağlı pnömoni oluşma riski", deri_bozulma:"Bası yarası evre 1–4 ve derin doku hasarı" };
  // Hastane kaydındaki tanı adları (hastanenin sırasıyla). Anahtarı var olan 18 tanı eşleşir; kalan 38'e 24.09'da başlangıç içeriği yazıldı (START).
  // Grup yalnız listeyi düzenlemek içindir (klinik içerik değil); yönetim değiştirebilir.
  const HBYS_NAMES = [
    ["aktivite", "Aktivite intoleransı", "Hareket"], ["anksiyete", "Anksiyete", "Psikososyal"], ["aritmi", "Aritmi riski", "Dolaşım"], ["aspirasyon", "Aspirasyon riski", "Solunum"],
    ["bag_risk", "Bağırsak alışkanlıklarının değişmesi riski", "Boşaltım"], ["bag_deg", "Bağırsak hareketlerinde değişiklik", "Boşaltım"],
    ["beslenme_deg", "Beslenme düzeninde değişiklik riski", "Sıvı–beslenme"], ["bilgi", "Bilgi eksikliği", "Psikososyal"], ["bulanti", "Bulantı-kusma", "Sıvı–beslenme"],
    ["deri", "Deri bütünlüğünde bozulma", "Deri"], ["diyare", "Diyare", "Boşaltım"], ["perfuzyon", "Doku perfüzyonunda değişiklik", "Dolaşım"],
    ["doku_deri", "Doku ve deri bütünlüğünde bozulma", "Deri"], ["dusme", "Düşme riski", "Güvenlik"], ["solunum_risk", "Etkisiz solunum riski", "Solunum"],
    ["fiz_hareket", "Fiziksel hareketin bozulması", "Hareket"], ["taburculuk", "Taburculuk eğitim gereksinimi", "Psikososyal"],
    ["havayolu_ac", "Hava yolu açıklığında yetersizlik", "Solunum"], ["havayolu", "Hava yolunu temizlemede etkisizlik", "Solunum"], ["hiperglisemi", "Hiperglisemi", "Metabolik"],
    ["hipertermi", "Hipertermi", "Isı"], ["hipoglisemi", "Hipoglisemi", "Metabolik"], ["hipotermi", "Hipotermi", "Isı"], ["retansiyon", "İdrar retansiyonu", "Boşaltım"],
    ["kanama", "Kanama riski", "Güvenlik"], ["konfuzyon", "Konfüzyon-deliryum", "Psikososyal"], ["konstipasyon", "Konstipasyon", "Boşaltım"], ["konst_risk", "Konstipasyon riski", "Boşaltım"],
    ["konvulsiyon", "Konvülsiyon", "Nöroloji"], ["oral_muk", "Oral mukoz membranda bozulma", "Deri"], ["olum_korku", "Ölüm korkusu", "Psikososyal"],
    ["ozbakim", "Öz-bakımda yetersizlik", "Hareket"], ["weaning", "Respiratörden ayrılmaya tepki riski", "Solunum"], ["sive", "Sıvı-elektrolit dengesizliği", "Sıvı–beslenme"],
    ["sive_risk", "Sıvı-elektrolit dengesizliği riski", "Sıvı–beslenme"], ["sivi_eksik", "Sıvı volüm eksikliği riski", "Sıvı–beslenme"], ["sivi_fazla", "Sıvı volüm fazlalığı", "Sıvı–beslenme"],
    ["spontan", "Spontan solunumu sürdürmede yetersizlik riski", "Solunum"], ["trakeo", "Trakeostomi bakımı", "Solunum"], ["vap", "Ventilatöre bağlı pnömoni oluşma riski", "Solunum"],
    ["bobrek", "Yetersiz böbrek doku perfüzyonu", "Dolaşım"], ["yutma", "Yutma güçlüğü ve sözel iletişimde bozulma riski", "Nöroloji"], ["reaksiyon", "Reaksiyon gelişme riski", "Güvenlik"],
    ["inanc", "Dini/inanç gereksinimlerini gerçekleştirme", "Psikososyal"], ["cerrahi", "Cerrahi iyileşmede gecikme", "Deri"], ["immob", "İmmobilizasyon", "Hareket"],
    ["lipo", "Lipodistrofi gelişme riski", "Deri"], ["hematom", "Kanama-hematom riski", "Güvenlik"], ["deri_bozulma", "Bası yarası evre 1–4 ve derin doku hasarı", "Deri"],
    ["saglik", "Sağlığın sürdürülmesinde değişim", "Psikososyal"], ["adli", "Adli vakaların takibi", "İzlem"], ["ajite", "Ajite hastaların takibi", "İzlem"],
    ["hemofiltr", "Hemofiltrasyon", "İzlem"], ["mv_takip", "Mekanik ventilasyon uygulanan hastaların takibi", "İzlem"], ["postop", "Post-op hasta takibi", "İzlem"],
    ["bilinc_risk", "Bilinç değişikliği riski", "Nöroloji"],
  ];
  // Faaliyet sıklığı: Görevlerim'e düşme biçimi. Bu vardiya (20–08, şimdi 21:42) için saatler; 24+ ertesi gün.
  const FREQS = ["shift", "q4", "q8", "prn"];
  const FREQ_H = { shift:[22], q4:[22, 26, 30], q8:[22, 30], prn:[] };
  const FORM_FREQ = { vitals:"q4", pain:"q4", gcs:"q4", io:"q4", fall:"q8", braden:"shift", wound:"shift", glucose:"prn", activity:"prn" };
  const defFreq = (t, l) => { if (l && l.startsWith("form:")) return FORM_FREQ[l.slice(5)] || "shift"; if (l === "care:Pozisyon ver") return "q4";
    if (/4 saatte bir/.test(t)) return "q4"; if (/gerektiğinde|gerekiyorsa|hekim istemine göre|bildirilecek|hekime/i.test(t)) return "prn"; return "shift"; };
  const normName = (s) => norm(s).replace(/[–—\-/]/g, " ").replace(/\s+/g, " ").trim();
  const freqName = (f) => H.t("cp_freq_" + (FREQS.includes(f) ? f : "shift"));

  /* ---------------- kapsam (birim türü) ----------------
   * Kapsam anahtarları core.js'teki birimlere bağlanır: tür (kind) yetiyorsa türden, servislerde birimin kendisinden.
   * Koroner YBÜ bu hastanede henüz tanımlı birim değil; paketi hazır durur, birim açılınca kendiliğinden bağlanır. */
  const SCOPES = ["icu", "cvicu", "ccu", "nicu", "picu", "med", "surg", "cward", "er"];
  const SC_MACRO = { YB:["icu", "cvicu", "ccu", "picu", "nicu"], EYB:["icu", "cvicu", "ccu"], "-YD":SCOPES.filter(s => s !== "nicu"), SERVIS:["med", "surg", "cward"] };
  const scList = (s) => [...new Set(String(s).split(",").flatMap(x => SC_MACRO[x.trim()] || [x.trim()]))].filter(x => SCOPES.includes(x));
  const UNIT_SCOPE = { cer:"surg" };                          // servislerde uzmanlık alanı birim verisinde yok → birimden
  const scopeOfUnit = (u) => { if (!u) return null; if (UNIT_SCOPE[u.id]) return UNIT_SCOPE[u.id];
    if (["icu", "cvicu", "ccu", "nicu", "picu", "er"].includes(u.kind)) return u.kind;
    if (u.kind === "ward" || u.kind === "bmt") return u.ageGroup === "child" ? "cward" : "med"; return null; };   // operasyonel birim → süzme yok
  const scopeName = (s) => H.t("cp_sc_" + (s || "all"));
  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const scopesText = (u) => { if (!u || !u.length || u.length >= SCOPES.length) return scopeName(null);
    const mk = Object.keys(SC_MACRO).find(k => sameSet(SC_MACRO[k], u)); return mk ? H.t("cp_ps_" + { YB:"yb", EYB:"eyb", "-YD":"notnn", SERVIS:"ward" }[mk]) : u.map(scopeName).join(", "); };
  const inSc = (u, sc) => !sc || !u || !u.length || u.includes(sc);

  /* ---------------- içerik (hastane kataloğu + başlangıç içeriği) ----------------
   * Satır yazımı: "metin ¦ sıklık ¦ bağ ¦ @kapsam" — sıklık shift|q4|q8|prn, bağ form:<anahtar> ya da care:<iş>,
   * kapsam birim anahtarları ya da kısaltma (YB = tüm yoğun bakımlar, EYB = erişkin yoğun bakımlar, -YD = yenidoğan hariç,
   * SERVIS = servisler). Kapsamsız satır tüm birimlerde görünür. */
  const P = (s) => { const [t, ...tok] = String(s).split(" ¦ "); const o = { t:t.trim(), l:null, f:null, u:null };
    tok.forEach(x => { x = x.trim(); if (FREQS.includes(x)) o.f = x; else if (/^(form|care):/.test(x)) o.l = x; else if (x[0] === "@") o.u = scList(x.slice(1)); }); return o; };
  const KAYIT = "Yapılan girişim, eğitim ve gözlemler kayda alınır ¦ shift";
  // Hastanenin ekranından birebir (24.09). Metinler değiştirilmez; yalnız kapsam ve varsayılan sıklık bizim eklememiz.
  const HOSP = {
    dusme:{ units:"-YD",
      c:["Baş dönmesi", "İlaç kullanımı", "Vertigo", "Bozulmuş fiziksel hareketlilik", "Değişen duyusal algı", "Hastalığın varlığı", "Yaş (özellikle ≥65)", "Daha önce düşme öyküsü",
        "Genel durum bozukluğu", "Yardımcı cihaz kullanımı", "Mobilite bozuklukları", "Kardiyak aritmi", "Senkop", "Parkinson", "Yürürken dengesizlik", "Serebrovasküler hastalıklar",
        "Kas gücü kaybı", "İşitme/görme bozuklukları", "Diğer"],
      g:["Hastada düşme gelişmeyecek", "Düşme riskinin en aza indirilmesi", "Hastanın güvenliğinin sağlanması"],
      a:["Düşme riski yüksek hastanın takibi kurum politikasına uygun yapılır ¦ shift", "Düşme riskini artıran faktörler belirlenir ¦ shift", "Düşmeyi önlemeye yönelik güvenlik önlemleri alınır ¦ shift",
        "Güç ve esnekliği artıran egzersizler öğretilir ¦ prn", "Transfer iki kişiyle, sedye kenarlıkları kaldırılarak güvenli yapılır ¦ prn", "Hastane protokolüne göre düşme riski değerlendirmesi yapılır ¦ q8 ¦ form:fall",
        "Yatak her zaman en alt seviyede tutulur ¦ shift", "Konfüzyonu olan hasta için güvenlik önlemleri alınır ¦ prn", "Kullanılan ilaçların düşme riski oluşturup oluşturmadığı kontrol edilir ¦ shift",
        "Ortam aydınlatması yeterli tutulur, geceleri gece lambası kullanılır ¦ shift", "Ortostatik hipotansiyon değerlendirilir, hasta bilgilendirilir ¦ prn", "Tabanı kaymayan ayakkabı önerilir ¦ prn",
        "Taburculuk sonrası ev güvenliği konusunda aileye eğitim verilir ¦ prn", "Uzun yatıştan sonra kademeli mobilizasyon uygulanır ¦ prn", "Yatak kenarlıkları kaldırılır ¦ shift",
        "Yürümede dengesizlikte baston/koltuk değneği kullanımı öğretilir ¦ prn", KAYIT] },
    // Hastanenin listesi yenidoğan (küvöz, gestasyon yaşı, OGS) ve erişkin maddelerini birlikte içeriyor → her madde kapsamlı.
    aspirasyon:{
      c:["OGS ile beslenme ¦ @nicu", "NG sonda ile beslenme", "Anestezi", "SVO ¦ @EYB,med,surg,er", "Kafa travması ¦ @-YD", "Koma ¦ @-YD", "Yutma bozukluğu", "Trakeoözofageal fistül ¦ @nicu,picu,cward"],
      g:["Hasta aspire etmeyecek"],
      a:["Batın distansiyonu izlenir, gerekirse hekimle birlikte beslenme planı düzenlenir ¦ q4", "Beslenme öncesi sondanın midede olduğu kontrol edilir ¦ prn", "Rezidü, reflü ve kusma açısından değerlendirilir ¦ q4",
        "Kontrendike değilse yatağın/küvözün başı yükseltilir ¦ shift", "Sonda ile beslenmede yerçekiminden yararlanılır, pistona basınç uygulanmaz ¦ prn ¦ @nicu,picu,cward",
        "Oral beslenme öncesi dil pozisyonu ve hava yolu açıklığı değerlendirilir ¦ prn ¦ @nicu", "Sekresyon değerlendirilir, gerekirse ağız içi temizlenir ve aspire edilir ¦ prn",
        "Yaşa uygun numarada sonda takılıp tespit edilir ¦ prn ¦ @nicu,picu,cward", "Gestasyon yaşı ve klinik duruma göre hekim istemiyle oral/OGS/NGS beslenme planlanır ¦ shift ¦ @nicu", KAYIT] },
  };
  // Başlangıç içeriği: genel hemşirelik uygulaması; hastanenin onayını bekler. İlaç adı, doz, sayısal eşik yok.
  const START = {
    aritmi:{ units:"YB,med,surg",
      c:["Elektrolit dengesizliği", "Hipoksi", "Miyokard iskemisi / koroner arter hastalığı ¦ @EYB,med,surg", "Kalp cerrahisi sonrası dönem ¦ @cvicu", "Kalp yetmezliği öyküsü", "İnvaziv kateterler (santral venöz kateter vb.)", "Aritmiye yol açabilen ilaç kullanımı", "Geçici epikardiyal pace teli ¦ @cvicu"],
      g:["Ritim değişiklikleri erken fark edilir ve hekime bildirilir", "Aritmiye bağlı hemodinamik bozulma gelişmez"],
      a:["Kalp ritmi monitörden sürekli izlenir, alarm sınırları hastane protokolüne göre ayarlanır ¦ shift", "Vital bulgular izlenir ¦ q4 ¦ form:vitals", "Çarpıntı, baş dönmesi, göğüs ağrısı ve ritim değişikliği hekime bildirilir ¦ prn",
        "Hekim istemine göre EKG çekilir ¦ prn", "Hekim istemine göre elektrolit örnekleri alınır, sonuçlar izlenir ¦ prn", "Monitör elektrotları kurum protokolüne göre değiştirilir, altındaki deri kontrol edilir ¦ shift",
        "Defibrilatör ve acil arabasının hazır olduğu kontrol edilir ¦ shift", "Geçici pace telleri ve bağlantılarının yerinde olduğu, hekimin belirlediği ayarların sürdüğü kontrol edilir ¦ q4 ¦ @cvicu", KAYIT] },
    bag_risk:{ c:["Hareketsizlik", "Enteral beslenme", "Beslenme düzeninde değişiklik", "İlaç yan etkisi", "Ortam değişikliği / mahremiyet eksikliği", "Cerrahi girişim / anestezi"],
      g:["Hastanın olağan bağırsak alışkanlığı korunur", "Bağırsak alışkanlığındaki değişiklik erken fark edilir"],
      a:["Gaita sıklığı, miktarı ve niteliği kaydedilir ¦ shift", "Bağırsak sesleri ve karın distansiyonu değerlendirilir ¦ shift", "Kısıtlama yoksa sıvı ve lifli besin alımı desteklenir ¦ shift",
        "Hareket durumuna göre mobilizasyon desteklenir ¦ shift", "Boşaltım sırasında mahremiyet sağlanır ¦ prn", "Bağırsak alışkanlığındaki değişiklik hekime bildirilir ¦ prn", KAYIT] },
    bag_deg:{ c:["Enfeksiyon", "Enteral beslenme ürününe uyumsuzluk", "İlaç yan etkisi", "Hareketsizlik", "Gastrointestinal hastalık", "Stres"],
      g:["Hasta olağan bağırsak hareketlerine döner", "Sıvı–elektrolit dengesi korunur"],
      a:["Gaita sıklığı, kıvamı ve rengi kaydedilir ¦ shift", "Bağırsak sesleri dinlenir, karın distansiyonu değerlendirilir ¦ shift", "Aldığı–çıkardığı izlenir ¦ q4 ¦ form:io",
        "Perianal deri temiz ve kuru tutulur ¦ prn", "Hekim istemine göre gaita örneği alınır ¦ prn", "Değişiklik hekime bildirilir ¦ prn", KAYIT] },
    beslenme_deg:{ c:["Oral alımın kısıtlanması", "Yutma güçlüğü", "Metabolik gereksinim artışı", "Bulantı–kusma", "Mekanik ventilasyon ¦ @YB", "Emme–yutma koordinasyonunun gelişmemiş olması ¦ @nicu"],
      g:["Beslenme gereksinimi karşılanır", "Kilo kaybı gelişmez ya da yaşa uygun kilo alımı sürer"],
      a:["Alınan besin miktarı kaydedilir ¦ shift", "Kilo takibi hekim istemine göre yapılır ¦ prn", "Enteral / parenteral beslenme hekim istemine göre uygulanır ¦ prn",
        "Enteral beslenme toleransı (rezidü, distansiyon, kusma) izlenir ¦ q4", "Diyetisyenle iş birliği yapılır ¦ prn", "Ağız bakımı yapılır ¦ shift",
        "Anne sütüyle beslenme ve emzirme desteklenir ¦ shift ¦ @nicu", KAYIT] },
    deri:{ c:["Basınç / hareketsizlik", "Nem / inkontinans", "Tıbbi cihaza bağlı bası", "Sürtünme ve makaslama", "Beslenme yetersizliği", "Flaster / yapıştırıcı kullanımı", "Ödem"],
      g:["Hasarlı deride iyileşme belirtileri görülür", "Yeni deri hasarı gelişmez"],
      a:["Hasarlı bölgenin yeri, boyutu ve görünümü değerlendirilip kaydedilir ¦ shift ¦ form:wound", "Bası yarası riski değerlendirilir ¦ shift ¦ form:braden", PRES + " ¦ q4 ¦ care:Pozisyon ver",
        "Deri temiz ve kuru tutulur ¦ shift", "Tıbbi cihazların altındaki deri kontrol edilir ¦ shift", "Basınç azaltıcı yüzey kullanılır ¦ shift",
        "Yara bakımı hekim / yara bakım hemşiresi önerisine göre yapılır ¦ prn", "Enfeksiyon bulguları hekime bildirilir ¦ prn"] },
    diyare:{ c:["Enfeksiyon", "Enteral beslenmeye intolerans", "İlaç yan etkisi", "Gastrointestinal hastalık", "Stres"],
      g:["Gaita sıklığı ve kıvamı olağana döner", "Sıvı–elektrolit dengesi korunur", "Perianal deri bütünlüğü korunur"],
      a:["Gaita sıklığı, miktarı ve kıvamı kaydedilir ¦ shift", "Aldığı–çıkardığı izlenir ¦ q4 ¦ form:io", "Dehidratasyon bulguları (mukoza kuruluğu, deri turgoru) değerlendirilir ¦ shift",
        "Perianal bölge temiz ve kuru tutulur, bariyer ürünü kurum protokolüne göre kullanılır ¦ prn", "Hekim istemine göre gaita örneği alınır ¦ prn",
        "Enfeksiyon şüphesinde temas izolasyonu kurum protokolüne göre uygulanır ¦ prn", "Enteral beslenmenin hızı ve içeriği hekim ve diyetisyenle birlikte değerlendirilir ¦ prn", KAYIT] },
    perfuzyon:{ c:["Hipotansiyon / dolaşım yetersizliği", "Hipovolemi", "Periferik damar hastalığı", "Tromboemboli", "Uzun süre hareketsizlik", "Damar daraltıcı etkili ilaç kullanımı"],
      g:["Periferik nabızlar alınır, deri rengi ve ısısı olağandır", "Perfüzyon bozulması bulguları erken fark edilir ve hekime bildirilir"],
      a:["Periferik nabızlar, deri rengi, ısısı ve kapiller dolum değerlendirilir ¦ q4", "Vital bulgular izlenir ¦ q4 ¦ form:vitals", "Bilinç durumu izlenir ¦ shift", "İdrar miktarı izlenir ¦ q4 ¦ form:io",
        "Ekstremitelerde ödem, ağrı ve renk değişikliği izlenir ¦ shift", "Dolaşımı kısıtlayan giysi ve bandajdan kaçınılır ¦ shift", "Perfüzyon bozulması bulguları hekime hemen bildirilir ¦ prn", KAYIT] },
    doku_deri:{ c:["Cerrahi insizyon", "Travma", "Bası", "Yanık", "Tedaviye bağlı deri değişiklikleri", "Beslenme yetersizliği", "Dolaşım bozukluğu"],
      g:["Doku iyileşme belirtileri gösterir", "Hasarlı bölgede enfeksiyon gelişmez"],
      a:["Yaranın yeri, boyutu ve akıntısı değerlendirilip kaydedilir ¦ shift ¦ form:wound", "Pansuman kurum protokolüne göre aseptik teknikle yapılır ¦ prn", "Yara çevresindeki deri değerlendirilir ¦ shift",
        PRES + " ¦ q4 ¦ care:Pozisyon ver", "Beslenme durumu izlenir, diyetisyenle iş birliği yapılır ¦ prn", "Enfeksiyon bulguları hekime bildirilir ¦ prn", KAYIT] },
    solunum_risk:{ c:["Bilinç düzeyinde azalma / sedasyon", "Ağrıya bağlı yüzeyel solunum", "Göğüs ya da üst batın cerrahisi", "Solunum kaslarında güçsüzlük", "Hareketsizlik", "Nöromüsküler hastalık", "Prematürite ¦ @nicu"],
      g:["Solunum sayısı, derinliği ve satürasyon hekimin belirlediği aralıkta kalır", "Solunum sıkıntısı bulguları erken fark edilir"],
      a:["Solunum sayısı, derinliği ve SpO₂ izlenir ¦ q4 ¦ form:vitals", "Solunum sesleri değerlendirilir ¦ shift", "Kontrendike değilse yatak başı yükseltilir ¦ shift",
        "Derin solunum ve etkili öksürme egzersizleri öğretilir, uygulatılır ¦ shift ¦ @-YD", "Ağrı değerlendirilir ¦ q4 ¦ form:pain", "Hekim istemine göre oksijen uygulanır ¦ prn",
        "Solunum sıkıntısının artması hekime bildirilir ¦ prn", KAYIT] },
    fiz_hareket:{ units:"-YD", c:["Ağrı", "Kas gücünde azalma", "Nörolojik bozukluk", "Sedasyon", "Tıbbi cihazlar (kateter, dren, solunum cihazı)", "Uzun süreli yatak istirahati", "Ortopedik kısıtlama"],
      g:["Hasta tolerans sınırları içinde hareket eder", "Hareketsizliğe bağlı komplikasyon (bası yarası, kontraktür, tromboz) gelişmez"],
      a:["Hareket düzeyi ve kas gücü değerlendirilir ¦ shift ¦ form:activity", PRES + " ¦ q4 ¦ care:Pozisyon ver", "Pasif / aktif eklem hareket egzersizleri yaptırılır ¦ shift",
        "Fizyoterapistle iş birliği yapılır ¦ prn", "Mobilizasyon hekim istemine göre kademeli planlanır ¦ prn", "Tromboz bulguları (bacakta şişlik, ağrı, kızarıklık) izlenir ¦ shift",
        "Mobilizasyon sırasında düşmeye karşı önlem alınır ¦ prn", KAYIT] },
    taburculuk:{ units:"SERVIS,er,nicu,picu", c:["Yeni tanı / tedavi", "Evde bakım gereksinimi", "Evde kullanılacak araç gereç", "Bilgi kaynaklarına erişim eksikliği", "Dil / iletişim engeli"],
      g:["Hasta/yakını evde bakımı, hekimin önerdiği tedaviyi ve kontrol tarihini ifade eder", "Hasta/yakını evde bakımı uygulayabildiğini gösterir"],
      a:["Eğitim gereksinimi değerlendirilir ¦ shift", "Evde bakım, beslenme ve hijyen konusunda eğitim verilir ¦ shift", "Hekimin reçetelediği ilaçların kullanımı hakkında bilgi verilir, eczacıyla iş birliği yapılır ¦ prn",
        "Acil başvuru gerektiren belirtiler anlatılır ¦ shift", "Kontrol randevusu bilgisi verilir ¦ prn", "Yazılı eğitim materyali verilir ¦ prn",
        "Bebek bakımı, emzirme ve bebeğin ısısının korunması konusunda aileye eğitim verilir ¦ shift ¦ @nicu", "Geri bildirim alınarak öğrenme değerlendirilir ¦ prn", KAYIT] },
    havayolu_ac:{ c:["Bilinç düzeyinde azalma", "Sekresyon birikimi", "Dilin geriye düşmesi", "Yapay hava yolunun (tüp, trakeostomi) tıkanması ya da yer değiştirmesi", "Hava yolunda ödem", "Aspirasyon"],
      g:["Hava yolu açık kalır", "Solunum sesleri temizdir, satürasyon hekimin belirlediği hedeftedir"],
      a:["Hava yolu açıklığı, solunum sesleri ve göğüs hareketleri değerlendirilir ¦ q4", "Baş–boyun pozisyonu hava yolunu açık tutacak şekilde verilir ¦ shift",
        "Gerektiğinde ağız, burun ya da tüp aspirasyonu yapılır, sekresyonun niteliği kaydedilir ¦ prn", "Tüpün yeri, tespiti ve dudak hizası kontrol edilip kaydedilir ¦ shift ¦ @YB",
        "Aspirasyon ve oksijen seti yatak başında hazır tutulur ¦ shift", "Hekim istemine göre oksijen uygulanır ¦ prn", "Hava yolu tıkanıklığı bulguları hekime hemen bildirilir ¦ prn", KAYIT] },
    hiperglisemi:{ c:["Stres yanıtı", "Diabetes mellitus", "Parenteral / enteral beslenme", "Enfeksiyon", "Kan şekerini yükseltebilen ilaç kullanımı"],
      g:["Kan şekeri hekimin belirlediği hedef aralıkta tutulur", "Hiperglisemi belirtileri erken fark edilir"],
      a:["Kan şekeri hekim istemindeki sıklıkla ölçülür ¦ q4 ¦ form:glucose", "Hekim istemine göre kan şekerini düzenleyen tedavi uygulanır, etkisi izlenir ¦ prn",
        "Hiperglisemi belirtileri (susama, sık idrara çıkma, bilinç değişikliği) izlenir ¦ shift", "Aldığı–çıkardığı izlenir ¦ q4 ¦ form:io", "Beslenme ve kan şekeri ölçüm saatleri uyumlu planlanır ¦ shift",
        "Hastane protokolündeki eşiğin dışındaki değerler hekime bildirilir ¦ prn", KAYIT] },
    hipoglisemi:{ c:["Beslenmenin kesilmesi ya da azalması", "Kan şekerini düşüren tedavi", "Sepsis", "Karaciğer yetmezliği", "Prematürite / anne diyabeti ¦ @nicu"],
      g:["Kan şekeri hekimin belirlediği aralıkta kalır", "Hipoglisemi bulguları erken fark edilir ve bildirilir"],
      a:["Kan şekeri hekim istemindeki sıklıkla ölçülür ¦ q4 ¦ form:glucose", "Hipoglisemi bulguları (terleme, titreme, bilinç değişikliği) izlenir ¦ shift ¦ @-YD",
        "Beslenme isteksizliği, titreme, apne gibi bulgular izlenir ¦ shift ¦ @nicu", "Hastane protokolündeki eşiğin altındaki değer hekime hemen bildirilir, hastanenin hipoglisemi protokolü uygulanır ¦ prn",
        "Beslenme kesintileri hekime bildirilir ¦ prn", "Beslenme ve tedavi saatleri uyumlu planlanır ¦ shift", KAYIT] },
    konfuzyon:{ units:"-YD", c:["Enfeksiyon", "Sedasyon / ilaç etkisi", "Uyku yoksunluğu", "Hipoksi", "Metabolik bozukluk", "İleri yaş", "Duyusal eksiklik (gözlük, işitme cihazı)", "Alkol / madde yoksunluğu"],
      g:["Hasta güvenliği sağlanır, hasta kendine zarar vermez", "Yönelim bulguları düzelir"],
      a:["Deliryum değerlendirmesi kurum protokolündeki araçla yapılır ¦ shift", "Bilinç düzeyi izlenir ¦ q4 ¦ form:gcs", "Hastaya yönelim sağlanır (saat, takvim, açıklama) ¦ shift",
        "Gözlük / işitme cihazı kullanımı sağlanır ¦ shift", "Gece–gündüz düzeni desteklenir ¦ shift", "Tüp ve kateterlerin çekilmesine karşı güvenlik önlemleri alınır ¦ shift",
        "Aile ziyaretleri desteklenir ¦ prn", "Bilinç ve davranış değişiklikleri hekime bildirilir ¦ prn", KAYIT] },
    konst_risk:{ c:["Hareketsizlik", "Yetersiz sıvı ve lif alımı", "İlaç yan etkisi", "Enteral beslenme", "Mahremiyet eksikliği", "Cerrahi sonrası dönem"],
      g:["Olağan bağırsak alışkanlığı sürer", "Konstipasyon gelişmez"],
      a:["Gaita sıklığı ve niteliği kaydedilir ¦ shift", "Bağırsak sesleri ve karın distansiyonu değerlendirilir ¦ shift", "Kısıtlama yoksa sıvı ve lif alımı desteklenir ¦ shift",
        "Mobilizasyon desteklenir ¦ shift", "Boşaltım sırasında mahremiyet sağlanır ¦ prn", "Hastane protokolündeki süre boyunca gaita çıkışı olmaması hekime bildirilir ¦ prn", KAYIT] },
    konvulsiyon:{ c:["Nörolojik hastalık / kafa içi olay", "Metabolik bozukluk (kan şekeri, elektrolit)", "Yüksek ateş ¦ @picu,cward,nicu", "Hipoksi", "İlaç / madde yoksunluğu", "Epilepsi öyküsü"],
      g:["Nöbet sırasında hasta yaralanmaz", "Hava yolu açıklığı korunur", "Nöbetin özellikleri eksiksiz kaydedilir ve hekime bildirilir"],
      a:["Yatak kenarlıkları kaldırılır ve yastıklanır ¦ shift", "Aspirasyon ve oksijen seti yatak başında hazır tutulur ¦ shift", "Nöbet sırasında hasta yan çevrilir, ağza bir şey konmaz, hava yolu açık tutulur ¦ prn",
        "Nöbetin başlangıç saati, süresi ve özellikleri kaydedilir ¦ prn", "Nöbet hekime hemen bildirilir, hekim istemine göre tedavi uygulanır ¦ prn",
        "Nöbet sonrası bilinç ve vital bulgular izlenir ¦ prn ¦ form:gcs", KAYIT] },
    oral_muk:{ c:["Oral alım kısıtlılığı", "Ağızdan solunum / oksijen tedavisi", "Endotrakeal tüp ¦ @YB", "Tedaviye bağlı mukozit", "Dehidratasyon", "Enfeksiyon"],
      g:["Oral mukoza nemli ve bütündür", "Ağızda ağrı ve lezyon azalır"],
      a:["Ağız içi her vardiyada değerlendirilir ¦ shift", "Ağız bakımı kurum protokolüne göre yapılır ¦ q4", "Dudaklar nemlendirilir ¦ q4",
        "Tüp tespit yeri değiştirilerek dudak ve dil basısı önlenir ¦ shift ¦ @YB", "Kısıtlama yoksa sıvı alımı desteklenir ¦ shift", "Lezyon, kanama ve enfeksiyon bulguları hekime bildirilir ¦ prn", KAYIT] },
    olum_korku:{ units:"-YD", c:["Ağır hastalık / belirsiz seyir", "Yoğun bakım ortamı", "Önceki olumsuz deneyim", "Ağrı ve nefes darlığı", "Aileden ayrı kalma"],
      g:["Hasta korkularını ifade eder", "Hasta kendini güvende hissettiğini ifade eder"],
      a:["Hastanın duygularını ifade etmesine zaman ayrılır, dinlenir ¦ shift", "Sorular anlaşılır dille yanıtlanır, gerekirse hekimle görüşme sağlanır ¦ prn", "Aile ziyaretleri kurum kurallarına göre desteklenir ¦ prn",
        "Hastanın isteğine göre manevi destek sağlanır ¦ prn", "Psikolojik destek birimiyle iş birliği yapılır ¦ prn", "Ağrı ve nefes darlığı gibi rahatsızlıklar hekime bildirilir ¦ prn", KAYIT] },
    sive:{ c:["Kusma / ishal", "Drenlerden kayıp", "Böbrek fonksiyonlarında bozulma", "Tedaviye bağlı sıvı kaybı", "Yetersiz alım", "Endokrin bozukluk", "Yanık"],
      g:["Aldığı–çıkardığı dengesi hekimin belirlediği hedefe yaklaşır", "Elektrolit dengesizliği bulguları erken fark edilir"],
      a:["Aldığı–çıkardığı izlenir ¦ q4 ¦ form:io", "Vital bulgular izlenir ¦ q4 ¦ form:vitals", "Günlük kilo takibi aynı koşullarda yapılır ¦ shift", "Hekim istemine göre elektrolit örnekleri alınır ¦ prn",
        "Kas krampı, halsizlik, ritim ve bilinç değişikliği izlenir ¦ shift", "Hekim istemine göre sıvı ve elektrolit replasmanı uygulanır ¦ prn",
        "Hastane protokolündeki eşiğin dışındaki laboratuvar sonuçları hekime bildirilir ¦ prn", KAYIT] },
    sive_risk:{ c:["Kusma / ishal", "Drenlerden kayıp", "Yetersiz sıvı alımı", "Böbrek hastalığı", "Ateş", "Tedaviye bağlı sıvı kaybı"],
      g:["Sıvı–elektrolit dengesi korunur", "Dengesizlik bulguları erken fark edilir"],
      a:["Aldığı–çıkardığı izlenir ¦ q4 ¦ form:io", "Mukoz membranlar, deri turgoru ve ödem değerlendirilir ¦ shift", "Günlük kilo takibi yapılır ¦ shift", "Hekim istemine göre laboratuvar örnekleri alınır ¦ prn",
        "Sıvı alımı hekim istemi doğrultusunda desteklenir ¦ shift", "Dengesizlik bulguları hekime bildirilir ¦ prn", KAYIT] },
    spontan:{ units:"YB", c:["Solunum kaslarında yorgunluk", "Metabolik gereksinim artışı", "Sedasyon", "Nöromüsküler hastalık", "Prematürite / apne ¦ @nicu"],
      g:["Solunum sayısı, derinliği ve kan gazları hekimin belirlediği aralıkta kalır", "Solunum yetersizliği bulguları erken fark edilir"],
      a:["Solunum sayısı, derinliği ve SpO₂ izlenir ¦ q4 ¦ form:vitals", "Yardımcı solunum kası kullanımı ve göğüs hareketleri izlenir ¦ q4", "Hekim istemine göre kan gazı örneği alınır ¦ prn",
        "Solunum destek cihazının ayarlarının hekim istemiyle uyumlu olduğu kontrol edilir ¦ q4", "Apne ve bradikardi atakları izlenir, kaydedilir ¦ q4 ¦ @nicu",
        "Bakımlar gruplandırılarak enerji tüketimi azaltılır ¦ shift", "Solunum yetersizliği bulguları hekime hemen bildirilir ¦ prn", KAYIT] },
    trakeo:{ c:["Trakeostomi kanülü varlığı", "Sekresyon artışı", "Stoma çevresinde deri hasarı riski", "Kanülün tıkanması / yer değiştirmesi riski"],
      g:["Kanül açık ve yerinde kalır", "Stoma çevresinde enfeksiyon ve deri hasarı gelişmez", "Hasta/yakını trakeostomi bakımını öğrenir"],
      a:["Stoma çevresi temizliği ve pansumanı kurum protokolüne göre yapılır ¦ shift", "Kanül tespit bağı kontrol edilir, gerektiğinde değiştirilir ¦ shift", "Gerektiğinde aseptik teknikle aspirasyon yapılır ¦ prn",
        "İç kanül varsa kurum protokolüne göre temizlenir ¦ q8", "Kaf basıncı kurum protokolüne göre kontrol edilir ¦ q8", "Yedek kanül ve aspirasyon seti yatak başında hazır tutulur ¦ shift",
        "Solunan hava nemlendirilir ¦ shift", "Hasta/yakınına trakeostomi bakımı öğretilir ¦ prn ¦ @SERVIS,picu", KAYIT] },
    bobrek:{ c:["Hipovolemi", "Hipotansiyon", "Sepsis", "Böbreğe zararlı ilaç ya da kontrast madde kullanımı", "Kalp yetmezliği", "Kalp cerrahisi / kardiyopulmoner bypass ¦ @cvicu"],
      g:["İdrar miktarı hekimin belirlediği hedefin altına düşmez", "Böbrek fonksiyon bozulması erken fark edilir"],
      a:["İdrar miktarı ve rengi saatlik izlenir, kaydedilir ¦ q4 ¦ form:io", "Aldığı–çıkardığı dengesi vardiya sonunda hesaplanır ¦ shift", "Vital bulgular izlenir ¦ q4 ¦ form:vitals",
        "Hekim istemine göre böbrek fonksiyon testleri için örnek alınır ¦ prn", "Ödem ve kilo izlenir ¦ shift", "Hastane protokolündeki eşiğin altındaki idrar miktarı hekime bildirilir ¦ prn",
        "Böbreğe zararlı olabilecek ilaçlar konusunda hekim ve eczacıyla iletişim kurulur ¦ prn", KAYIT] },
    yutma:{ units:"-YD", c:["SVO / nörolojik hastalık", "Yapay hava yolu (tüp, trakeostomi)", "Bilinç değişikliği", "Baş–boyun cerrahisi", "Kas güçsüzlüğü"],
      g:["Aspirasyon gelişmez", "Hasta gereksinimlerini alternatif yollarla iletebilir"],
      a:["Yutma işlevi hastanenin tarama aracıyla değerlendirilir ¦ shift", "Oral beslenmeye hekim / konuşma terapisti değerlendirmesinden sonra başlanır ¦ prn", "Beslenme sırasında dik oturur pozisyon verilir ¦ prn",
        "İletişim için yazı tahtası, resim kartları gibi araçlar sağlanır ¦ shift", "Hastaya evet/hayır ile yanıtlayabileceği sorular sorulur ¦ shift", "Çağrı zili hastanın erişebileceği yerde tutulur ¦ shift", KAYIT] },
    reaksiyon:{ c:["Kan / kan ürünü transfüzyonu", "Bilinen alerji öyküsü", "Yeni başlanan ilaç", "Kontrast madde uygulaması", "Beslenme ürünleri"],
      g:["Reaksiyon bulguları erken fark edilir", "Hastada ciddi reaksiyon gelişmez"],
      a:["Alerji öyküsü kontrol edilir, kayıtta görünür tutulur ¦ shift", "Kan ürünü uygulamasında hastanenin transfüzyon protokolüne uyulur, çift kontrol yapılır ¦ prn", "Uygulamanın ilk dakikalarında hasta yakından izlenir ¦ prn",
        "Vital bulgular izlenir ¦ q4 ¦ form:vitals", "Kaşıntı, döküntü, nefes darlığı, ateş ve titreme izlenir ¦ shift", "Reaksiyon bulgusunda hastane protokolüne göre uygulama durdurulur, hekime hemen bildirilir ¦ prn",
        "Acil müdahale seti hazır tutulur ¦ shift", KAYIT] },
    inanc:{ c:["Hastane ortamı", "Hareket kısıtlılığı", "Ağır hastalık", "Aileden ayrı kalma"],
      g:["Hasta/yakını inanç gereksinimlerini ifade eder", "Hasta/yakını gereksinimlerinin olanaklar ölçüsünde karşılandığını ifade eder"],
      a:["İnanç gereksinimleri hasta/yakınıyla konuşularak belirlenir ¦ shift", "Olanaklar ölçüsünde ibadet için mahremiyet ve uygun ortam sağlanır ¦ prn", "İsteğe göre din görevlisiyle görüşme sağlanır ¦ prn",
        "Beslenme kısıtları diyetisyenle paylaşılır ¦ prn", "Hastanın inancına saygılı iletişim kurulur ¦ shift", KAYIT] },
    cerrahi:{ c:["Enfeksiyon", "Beslenme yetersizliği", "Diabetes mellitus", "Dolaşım bozukluğu", "Sigara kullanımı", "İleri yaş", "Hareketsizlik"],
      g:["Cerrahi yara iyileşme belirtileri gösterir", "Yarada enfeksiyon gelişmez"],
      a:["İnsizyon yeri değerlendirilip kayda alınır ¦ shift ¦ form:wound", "Pansuman kurum protokolüne göre aseptik teknikle yapılır ¦ prn", "Kızarıklık, akıntı, ısı artışı gibi enfeksiyon bulguları izlenir, hekime bildirilir ¦ shift",
        "Beslenme durumu izlenir, diyetisyenle iş birliği yapılır ¦ prn", "Kan şekeri hekim istemine göre izlenir ¦ prn ¦ form:glucose", "Mobilizasyon desteklenir ¦ shift", "Hasta insizyon bakımı konusunda bilgilendirilir ¦ prn", KAYIT] },
    immob:{ c:["Sedasyon / bilinç kaybı", "Ortopedik tespit (alçı, traksiyon)", "Nörolojik hasar", "Tıbbi cihazlar", "Hekim istemiyle yatak istirahati"],
      g:["İmmobilizasyona bağlı komplikasyon (bası yarası, tromboz, kontraktür, pnömoni) gelişmez"],
      a:[PRES + " ¦ q4 ¦ care:Pozisyon ver", "Bası yarası riski değerlendirilir ¦ shift ¦ form:braden", "Pasif eklem hareket egzersizleri yaptırılır ¦ shift", "Tromboz bulguları izlenir ¦ shift",
        "Hekim istemine göre tromboz önleyici çorap ya da cihaz uygulanır ¦ prn", "Derin solunum egzersizleri desteklenir ¦ shift ¦ @-YD", "Tespit (alçı, atel) altındaki dolaşım kontrol edilir ¦ q4",
        "Fizyoterapistle iş birliği yapılır ¦ prn", KAYIT] },
    lipo:{ units:"SERVIS", c:["Aynı bölgeye tekrarlayan enjeksiyon", "Uzun süreli deri altı ilaç uygulaması", "Enjeksiyon tekniğinde hata"],
      g:["Enjeksiyon bölgelerinde lipodistrofi gelişmez", "Hasta enjeksiyon bölgesini değiştirme planını uygular"],
      a:["Enjeksiyon bölgeleri her uygulamada değerlendirilir ¦ prn", "Bölge değişim planı yapılır ve kaydedilir ¦ shift", "Enjeksiyon kurum protokolüne uygun teknikle yapılır ¦ prn",
        "Hasta/yakınına bölge değiştirme öğretilir ¦ prn", "Sertlik ya da şişlik saptanan bölge kullanılmaz, hekime bildirilir ¦ prn", KAYIT] },
    hematom:{ c:["Arter / ven girişimi (kateter, anjiyografi)", "Pıhtılaşmayı etkileyen tedavi", "Trombosit düşüklüğü", "Cerrahi girişim", "Sık kan alma"],
      g:["Girişim yerinde kanama / hematom gelişmez ya da erken fark edilir"],
      a:["Girişim yeri kurum protokolündeki aralıkla kontrol edilir ¦ q4", "Girişim sonrası kurum protokolüne göre bası ve yatak istirahati uygulanır ¦ prn", "Distal nabız, deri rengi ve ısısı izlenir ¦ q4",
        "Hematomun sınırları işaretlenip kaydedilir ¦ prn", "Vital bulgular izlenir ¦ q4 ¦ form:vitals", "Kanama bulgusu hekime hemen bildirilir ¦ prn", KAYIT] },
    saglik:{ units:"SERVIS,er", c:["Bilgi eksikliği", "Sağlık hizmetine erişim güçlüğü", "Kronik hastalık yönetiminde güçlük", "Sosyal destek yetersizliği", "Sağlığı olumsuz etkileyen yaşam alışkanlıkları"],
      g:["Hasta sağlığını sürdürmek için yapacaklarını ifade eder", "Hasta/yakını kontrol ve takip planını bilir"],
      a:["Sağlık alışkanlıkları ve destek sistemleri değerlendirilir ¦ shift", "Kronik hastalık yönetimi konusunda eğitim verilir ¦ prn", "Sosyal hizmet uzmanıyla iş birliği yapılır ¦ prn",
        "Kontrol ve takip planı anlatılır ¦ prn", "Yazılı eğitim materyali verilir ¦ prn", KAYIT] },
    adli:{ c:["Travma / yaralanma", "Zehirlenme", "Şiddet şüphesi", "Trafik kazası", "İş kazası"],
      g:["Adli süreç kurum protokolüne uygun yürütülür", "Kanıtlar ve kayıtlar eksiksiz korunur", "Hasta mahremiyeti korunur"],
      a:["Hastanın geliş durumu, yaraları ve beyanı nesnel olarak kaydedilir ¦ prn", "Adli bildirim kurum protokolüne göre yapılır ¦ prn", "Hastanın giysi ve eşyaları kurum protokolüne göre ayrı ayrı paketlenir, teslim tutanağı tutulur ¦ prn",
        "Ziyaretçi kabulü ve bilgi paylaşımı kurum politikasına göre sınırlandırılır ¦ shift", "Şiddet şüphesinde hasta güvenliği sağlanır, sosyal hizmete bildirilir ¦ prn", "Hekimin adli rapor süreci desteklenir ¦ prn", KAYIT] },
    ajite:{ units:"-YD", c:["Deliryum", "Ağrı", "Hipoksi", "Madde / alkol yoksunluğu", "Psikiyatrik hastalık", "Tıbbi cihazlardan rahatsızlık", "Uyku yoksunluğu"],
      g:["Hasta ve çalışan güvenliği sağlanır", "Ajitasyon bulguları azalır", "Tüp ve kateterlerin istemsiz çekilmesi önlenir"],
      a:["Ajitasyon düzeyi kurum protokolündeki ölçekle değerlendirilir ¦ q4", "Ajitasyonu tetikleyebilecek durumlar (ağrı, idrar retansiyonu, hipoksi) değerlendirilir, hekime bildirilir ¦ prn",
        "Sakin ortam sağlanır, hastayla sakin ve kısa cümlelerle iletişim kurulur ¦ shift", "Tüp ve kateterlerin tespiti güçlendirilir ¦ shift",
        "Fiziksel kısıtlama yalnız hekim istemi ve kurum protokolüyle uygulanır, düzenli aralıklarla kontrol edilir ¦ prn", "Yakınlarının yanında bulunması desteklenir ¦ prn", KAYIT] },
    hemofiltr:{ units:"YB", c:["Böbrek yetmezliği", "Sıvı yüklenmesi", "Metabolik bozukluk", "Sepsis"],
      g:["Tedavi hekimin belirlediği hedef ve sürede kesintisiz sürdürülür", "Kateter ve devreye bağlı komplikasyon (kanama, enfeksiyon, pıhtılaşma) gelişmez"],
      a:["Cihaz ayarlarının hekim istemiyle uyumlu olduğu kontrol edilir ¦ q4", "Saatlik sıvı çekimi ve balans kaydedilir ¦ q4 ¦ form:io", "Vital bulgular izlenir ¦ q4 ¦ form:vitals",
        "Devre basınçları ve alarmlar izlenir, pıhtılaşma bulguları kaydedilir ¦ q4", "Kateter giriş yeri kurum protokolüne göre değerlendirilir, pansumanı yapılır ¦ shift", "Kanama bulguları izlenir ¦ shift",
        "Hekim istemine göre laboratuvar örnekleri alınır ¦ prn", "Isı kaybına karşı hasta ısıtılır, vücut ısısı izlenir ¦ q4", "Tedavi kesintisi ve nedeni kaydedilir, hekime bildirilir ¦ prn"] },
    mv_takip:{ units:"YB", c:["Solunum yetmezliği", "Bilinç kaybı", "Cerrahi sonrası dönem", "Sedasyon", "Prematürite ¦ @nicu"],
      g:["Ventilasyon ve oksijenlenme hekimin belirlediği hedeftedir", "Ventilatöre bağlı komplikasyon (pnömoni, hava yolu hasarı, istemsiz ekstübasyon) gelişmez"],
      a:["Ventilatör ayarlarının hekim istemiyle uyumlu olduğu vardiya başında kontrol edilir ¦ shift", "Solunum parametreleri ve SpO₂ izlenir ¦ q4 ¦ form:vitals", "Tüpün yeri, dudak hizası ve tespiti kontrol edilir ¦ shift",
        "Kaf basıncı kurum protokolüne göre kontrol edilir ¦ q8 ¦ @-YD", "Yatak başı kurum protokolüne göre yükseltilir ¦ shift", "Ağız bakımı kurum protokolüne göre yapılır ¦ q4",
        "Gerektiğinde kapalı sistemle aspirasyon yapılır ¦ prn", "Ambu ve oksijen kaynağı yatak başında hazır tutulur ¦ shift", "Ventilatör alarmları yanıtlanır, nedeni kaydedilir ¦ prn",
        "Sedasyon düzeyi kurum protokolündeki ölçekle değerlendirilir ¦ q4"] },
    postop:{ units:"-YD", c:["Anestezi etkisi", "Cerrahi girişim", "Kanama riski", "Ağrı", "Hipotermi", "Bulantı–kusma", "Sternotomi / kalp cerrahisi ¦ @cvicu"],
      g:["Ameliyat sonrası dönem komplikasyonsuz geçer", "Komplikasyon bulguları erken fark edilir"],
      a:["Vital bulgular hastane protokolündeki sıklıkla izlenir ¦ q4 ¦ form:vitals", "Bilinç ve anesteziden derlenme izlenir ¦ q4 ¦ form:gcs", "Ağrı değerlendirilir ¦ q4 ¦ form:pain",
        "Pansuman ve drenler kanama yönünden izlenir, dren miktarları kaydedilir ¦ q4 ¦ form:io", "İdrar çıkışı izlenir ¦ shift", "Bulantı–kusma izlenir ¦ shift",
        "Oral alıma hekim istemine göre geçilir ¦ prn", "Erken mobilizasyon hekim istemine göre desteklenir ¦ prn", "Mediastinal dren ve epikardiyal pace telleri kontrol edilir ¦ q4 ¦ @cvicu", KAYIT] },
    bilinc_risk:{ c:["Kafa içi olay / kafa travması", "Metabolik bozukluk", "Hipoksi", "Sedasyon", "Enfeksiyon", "Kan şekeri değişiklikleri"],
      g:["Bilinç değişikliği erken fark edilir ve hekime bildirilir", "Hasta güvenliği sağlanır"],
      a:["Bilinç düzeyi kurum protokolündeki sıklıkla değerlendirilir ¦ q4 ¦ form:gcs", "Pupil boyutu ve ışık yanıtı değerlendirilir ¦ q4", "Vital bulgular izlenir ¦ q4 ¦ form:vitals",
        "Kan şekeri hekim istemine göre ölçülür ¦ prn ¦ form:glucose", "Yatak kenarlıkları kaldırılır, düşmeye karşı önlem alınır ¦ shift", "Bilinç değişikliği hekime hemen bildirilir ¦ prn", KAYIT] },
  };
  // Ana katalogda olmayan, KVC YBÜ paketi için eklenen tanılar (başlangıç içeriği; hastanenin onayını bekler).
  const NEW_DX = [
    { key:"kardiyak_debi", name:"Kardiyak debide azalma riski", group:"Dolaşım", units:"EYB",
      c:["Kalp cerrahisi sonrası kalp işlevinde azalma ¦ @cvicu", "Aritmi", "Kanama / hipovolemi", "Kardiyak tamponad riski ¦ @cvicu", "Kalp yetmezliği", "Miyokard iskemisi"],
      g:["Hemodinamik bulgular hekimin belirlediği aralıkta kalır", "Düşük debi bulguları erken fark edilir ve hekime bildirilir"],
      a:["Kalp hızı, ritim, arter basıncı ve santral venöz basınç izlenir, kaydedilir ¦ q4 ¦ form:vitals", "Periferik nabızlar, deri rengi, ısısı ve kapiller dolum değerlendirilir ¦ q4",
        "İdrar miktarı saatlik izlenir ¦ q4 ¦ form:io", "Bilinç durumu izlenir ¦ shift", "Hekim istemindeki infüzyonların kesintisiz sürdüğü, hat ve pompa bağlantıları kontrol edilir ¦ q4",
        "Tamponad bulguları (dren miktarında ani azalma, boyun venlerinde dolgunluk, kan basıncında düşme) izlenir ¦ q4 ¦ @cvicu", "Düşük debi bulguları hekime hemen bildirilir ¦ prn", KAYIT] },
    { key:"gogus_tupu", name:"Göğüs tüpü / drenaj bakımı", group:"Solunum", units:"icu,cvicu,picu,surg",
      c:["Kalp ya da göğüs cerrahisi sonrası dren ¦ @cvicu,surg,icu", "Pnömotoraks", "Plevral sıvı", "Hemotoraks"],
      g:["Drenaj sistemi açık ve kapalı sistem olarak çalışır", "Tüpe bağlı komplikasyon (tıkanma, yerinden çıkma, enfeksiyon) gelişmez"],
      a:["Drenaj miktarı, rengi ve niteliği saatlik kaydedilir ¦ q4 ¦ form:io", "Su altı drenaj sisteminde dalgalanma ve hava kaçağı kontrol edilir ¦ q4",
        "Tüp bükülme ve tıkanma yönünden kontrol edilir, sistem göğüs seviyesinin altında tutulur ¦ q4", "Bağlantılar ve tespit kontrol edilir ¦ shift",
        "Giriş yeri kurum protokolüne göre değerlendirilir, pansumanı yapılır ¦ shift", "Yatak başında klemp ve steril gazlı bez hazır tutulur ¦ shift", "Solunum sesleri ve SpO₂ izlenir ¦ q4 ¦ form:vitals",
        "Drenaj miktarında ani artış, renk değişikliği ya da solunum sıkıntısı hekime hemen bildirilir ¦ prn", KAYIT] },
  ];
  // Var olan tanılara bölüme özgü EK satırlar ve mevcut satırların kapsamı (metin başıyla eşlenir).
  const EXTRA = {
    agri:{ c:["Sternotomi / torakotomi insizyonu ¦ @cvicu", "Göğüs tüpü varlığı ¦ @cvicu,surg"], a:["Öksürme ve derin solunumda insizyon yastıkla desteklenir ¦ q4 ¦ @cvicu"] },
    kanama:{ c:["Kardiyopulmoner bypass sonrası pıhtılaşma bozukluğu ¦ @cvicu"], a:["Mediastinal / göğüs dren miktarı saatlik izlenir, hastane protokolündeki eşiği aşan miktar hekime hemen bildirilir ¦ q4 ¦ form:io ¦ @cvicu"] },
    hipotermi:{ c:["Ameliyat sonrası dönem / anestezi etkisi ¦ @-YD", "Ekstrakorporeal dolaşım (bypass, hemofiltrasyon) ¦ @icu,cvicu,picu"],
      a:["Isıtıcı battaniye ya da ısıtma sistemi kurum protokolüne göre kullanılır ¦ q4 ¦ @-YD", "Titreme izlenir, hekime bildirilir ¦ prn ¦ @-YD"] },
  };
  // Hipotermi içeriği yenidoğan ağırlıklı yazılmıştı → yenidoğana özgü satırlar kapsamlandı.
  const SCOPE_PATCH = { hipotermi:[[/^(Prematürite|Deri altı yağ|Küvöz|İşlemler küvöz|Uygun olduğunda aile ile ten)/, "nicu"], [/^Isıtılmış örtü ve bere/, "nicu,picu,cward"]] };
  const DX_UNITS = { vap:"YB", weaning:"YB", deliryum:"-YD" };           // v1 tanılarının tanı düzeyindeki kapsamı

  /* MASTER = yönetimin gördüğü kayıt: girdiler { t, off } · faaliyet { t, l, f, off } · tanı { hbys, passive, was, changed, by }.
   * Hemşirenin gördüğü yayım (CAT) MASTER'dan türetilir: pasif tanı ve pasif girdiler düşer. */
  /* MASTER satırı: neden/hedef { t, off, u } · faaliyet { t, l, f, off, u } · u = kapsam (null = tüm birimler).
   * Tanı: { units (null = tüm birimler), src: "hastane" | "baslangic" } — src yalnız yönetimde görünür. */
  const rowOf = (s) => { const o = P(s); return { t:o.t, off:false, u:o.u }; };
  const actOf = (s) => { const o = P(s); return { t:o.t, l:o.l, f:o.f || defFreq(o.t, o.l), off:false, u:o.u }; };
  const MASTER = CAT_RAW.map(c => ({ key:c.key, name:ALIGN[c.key] || c.name, was:ALIGN[c.key] ? c.name : null, group:c.group, ages:c.ages || null, opt:c.opt || null,
    hbys:false, passive:false, units:DX_UNITS[c.key] ? scList(DX_UNITS[c.key]) : null, src:"baslangic", changed:ALIGN[c.key] ? "24.09.2026" : "15.09.2026", by:"admin",
    causes:c.causes.map(rowOf), goals:c.goals.map(rowOf), acts:c.acts.map(a => { const [t, l] = Array.isArray(a) ? a : [a, null]; return { t, l, f:defFreq(t, l), off:false, u:null }; }) }));
  HBYS_NAMES.forEach(([key, name, group]) => { const m = MASTER.find(x => x.key === key); if (m) { m.hbys = true; return; }
    MASTER.push({ key, name, was:null, group, ages:null, opt:null, hbys:true, passive:false, units:null, src:"baslangic", changed:"24.09.2026", by:"admin", causes:[], goals:[], acts:[] }); });
  const fill = (m, d, src) => { m.causes = d.c.map(rowOf); m.goals = d.g.map(rowOf); m.acts = d.a.map(actOf); if (d.units) m.units = scList(d.units); m.src = src; m.changed = "24.09.2026"; };
  Object.entries(HOSP).forEach(([k, d]) => { const m = MASTER.find(x => x.key === k); if (m) fill(m, d, "hastane"); });
  Object.entries(START).forEach(([k, d]) => { const m = MASTER.find(x => x.key === k); if (m && !m.acts.length) fill(m, d, "baslangic"); });
  NEW_DX.forEach(d => { const m = { key:d.key, name:d.name, was:null, group:d.group, ages:null, opt:null, hbys:false, passive:false, units:null, src:"baslangic", changed:"24.09.2026", by:"admin" }; fill(m, d, "baslangic"); MASTER.push(m); });
  Object.entries(EXTRA).forEach(([k, d]) => { const m = MASTER.find(x => x.key === k); if (!m) return; (d.c || []).forEach(s => m.causes.push(rowOf(s))); (d.a || []).forEach(s => m.acts.push(actOf(s))); m.changed = "24.09.2026"; });
  Object.entries(SCOPE_PATCH).forEach(([k, L]) => { const m = MASTER.find(x => x.key === k); if (!m) return;
    [...m.causes, ...m.goals, ...m.acts].forEach(r => { const hit = L.find(([re]) => re.test(r.t)); if (hit && !r.u) r.u = scList(hit[1]); }); });
  const pubOf = (m) => { const C = m.causes.filter(x => !x.off), G = m.goals.filter(x => !x.off), a = m.acts.filter(x => !x.off).map(x => ({ t:x.t, l:x.l, f:x.f || "shift", u:x.u || null }));
    const c = C.map(x => x.t), g = G.map(x => x.t);
    return { key:m.key, name:m.name, was:m.was, group:m.group, ages:m.ages, opt:m.opt, hbys:m.hbys, units:m.units || null, causes:c, cu:C.map(x => x.u || null), goals:g, gu:G.map(x => x.u || null), acts:a,
      pending:!(g.length && a.length), empty:!(c.length || g.length || a.length) }; };
  let CAT = [], CAT_BY = {};
  const coll = new Intl.Collator("tr", { sensitivity:"base" });
  function setPublished() { CAT = MASTER.filter(m => !m.passive).map(pubOf).sort((a, b) => coll.compare(a.name, b.name)); CAT_BY = {}; CAT.forEach(c => { CAT_BY[c.key] = c; }); H.CARE_CATALOG = CAT; }
  setPublished();
  H.CARE_CATALOG_LABEL = "Hastanenin onayladığı bakım planı kataloğu";
  // Plan kopyası: yazıldığı sürümün içeriği. v3'ten önceki sürümlerde hizalanan tanılar eski adıyla durur.
  const snapOf = (key, v) => { const c = CAT_BY[key]; if (!c) return null; const s = JSON.parse(JSON.stringify(c)); if (v < 3 && c.was) s.name = c.was; return s; };
  const cOf = (pl) => pl.snap || CAT_BY[pl.key] || { name:pl.key, group:"", causes:[], goals:[], acts:[], pending:true, empty:true };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------------- öneri kuralları (veri; Yönetim → Bakım kataloğu → Önerme kuralları düzenler) ---------------- */
  const LVL = { "düşük":0, "orta":1, "yüksek":2 };
  const ongoingOf = (p, re) => ((H.data.nursing || {}).ongoing || []).filter(o => o.pid === p.id && re.test(o.name));
  const f1 = (n) => String(n).replace(".", H.state.lang === "EN" ? "." : ",");
  const FIELDS = {
    fall:{ kind:"lvl", get:p => (p.flags || {}).fall, why:(p) => tpl("cp_w_fall_tpl", { v:p.flags.fall }) },
    braden:{ kind:"lvl", get:p => (p.flags || {}).braden, why:(p) => tpl("cp_w_braden_tpl", { v:p.flags.braden }) },
    pain:{ kind:"num", op:">=", get:p => (p.flags || {}).pain, why:(p, r) => tpl("cp_w_pain_tpl", { v:p.flags.pain, t:r.v }) },
    temp:{ kind:"num", op:">=", get:p => (p.v || {}).temp, why:(p, r) => tpl("cp_w_temp_tpl", { v:f1(p.v.temp), t:f1(r.v) }) },
    age:{ kind:"num", op:">=", get:p => p.ageGroup === "neonate" ? null : p.age, why:(p, r) => tpl("cp_w_age_tpl", { v:p.age, t:r.v }) },
    spo2:{ kind:"num", op:"<=", get:p => (p.v || {}).spo2, why:(p, r) => tpl("cp_w_spo2_tpl", { v:p.v.spo2, t:r.v }) },
    o2:{ kind:"bool", get:p => ["Ek oksijen", "CPAP", "Yüksek akım"].includes((p.v || {}).o2), why:(p) => tpl("cp_w_o2_tpl", { v:p.v.o2 }) },
    abx:{ kind:"bool", get:p => !!p.antibioticDay, why:(p) => tpl("cp_w_abx_tpl", { d:p.antibioticDay }) },
    iso:{ kind:"bool", get:p => p.isolation === "Koruyucu", why:() => H.t("cp_w_iso") },
    neo:{ kind:"bool", get:p => p.ageGroup === "neonate", why:(p) => [tpl("cp_w_neo_tpl", { d:p.ageDays }), p.gestWeeks ? tpl("cp_w_gest_tpl", { w:p.gestWeeks }) : "", p.birthWeight ? tpl("cp_w_bw_tpl", { g:p.birthWeight }) : ""].filter(Boolean).join(" · ") },
    conf:{ kind:"bool", get:p => (p.v || {}).loc === "Konfüze", why:() => H.t("cp_w_conf") },
    intub:{ kind:"bool", get:p => ongoingOf(p, /^Entübasyon$/).length > 0, why:(p) => tpl("cp_w_intub_tpl", { d:ongoingOf(p, /^Entübasyon$/)[0].day }) },
  };
  const RULES = [
    { id:"r1", f:"fall", v:"orta", key:"dusme", on:true }, { id:"r2", f:"braden", v:"orta", key:"deri_risk", on:true }, { id:"r3", f:"pain", v:4, key:"agri", on:true },
    { id:"r4", f:"abx", key:"enfeksiyon", on:true }, { id:"r5", f:"temp", v:38.3, key:"hipertermi", on:true }, { id:"r6", f:"temp", v:38.3, key:"enfeksiyon", on:true },
    { id:"r7", f:"o2", key:"solunum", on:true }, { id:"r8", f:"iso", key:"enfeksiyon", on:true }, { id:"r9", f:"neo", key:"hipotermi", on:true },
    { id:"r10", f:"conf", key:"deliryum", on:true }, { id:"r11", f:"intub", key:"vap", on:true },
  ];
  const ruleHits = (r, p) => { const F = FIELDS[r.f]; if (!F || !r.on) return false; const x = F.get(p); if (x == null || x === "") return false;
    if (F.kind === "bool") return !!x; if (F.kind === "lvl") return (LVL[x] ?? -1) >= (LVL[r.v] ?? 9); return F.op === "<=" ? +x <= +r.v : +x >= +r.v; };

  /* ---------------- nedenlerin veriden ön işareti (kaynağı yanında; hemşire kaldırabilir) ---------------- */
  const lastDone = (pid, form) => { const d = (H.data.tasks || []).filter(x => x.pid === pid && x.form === form && x.state === "done"); return d.length ? hhmmQ(Math.max(...d.map(x => x.t))) : "—"; };
  const hhmmQ = (t) => { const h = Math.floor(t), m = Math.round((t - h) * 60); return String(h % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0"); };
  const ruleVal = (f, key, dflt) => { const r = RULES.find(x => x.f === f && x.on && (!key || x.key === key)) || RULES.find(x => x.f === f); return r && r.v != null ? +r.v : dflt; };
  const dayList = (L) => L.map(o => tpl("cp_ev_day_tpl", { n:o.name, d:o.day })).join(", ");
  const CAUSE_EV = [
    [/^(İleri yaş|Yaş \(özellikle)/, p => p.ageGroup !== "neonate" && p.age >= 65 ? `${tpl("cp_ev_age_tpl", { v:p.age })} · ${H.t("cp_src_rec")}` : null],
    [/^Bilinç (düzeyinde azalma|değişikliği)/, p => { const l = (p.v || {}).loc; return l && !["Uyanık", "—"].includes(l) ? `${tpl("cp_ev_loc_tpl", { v:l })} · ${H.t("cp_src_vital")}` : null; }],
    [/^İnvaziv girişim/, p => { const L = ongoingOf(p, /CVP|kateter|Damar yolu|sonda|Dren|Entübasyon/i); return L.length ? `${dayList(L)} · ${H.t("cp_src_act")}` : null; }],
    [/^(Endotrakeal entübasyon|Yapay hava yolu)/, p => { const L = ongoingOf(p, /Entübasyon|Trakeostomi/i); return L.length ? `${dayList(L)} · ${H.t("cp_src_act")}` : null; }],
    [/^Enfeksiyon/, p => p.antibioticDay ? `${tpl("cp_ev_abx_tpl", { d:p.antibioticDay })} · ${H.t("cp_src_order")}` : null],
    [/^Ateş$/, p => (p.v || {}).temp >= ruleVal("temp", null, 38.3) ? `${tpl("cp_ev_temp_tpl", { v:f1(p.v.temp) })} · ${H.t("cp_src_vital")}` : null],
    [/^Ağrı( \/ anksiyete)?$/, p => (p.flags || {}).pain >= ruleVal("pain", "agri", 4) ? tpl("cp_ev_pain_tpl", { v:p.flags.pain, t:lastDone(p.id, "pain") }) : null],
    [/diyabet/i, p => (p.chronic || []).includes("Diabetes mellitus") ? `Diabetes mellitus · ${H.t("cp_src_chronic")}` : null],
    [/^Kalp yetmezliği/, p => (p.chronic || []).includes("Kalp yetmezliği") ? `Kalp yetmezliği · ${H.t("cp_src_chronic")}` : null],
    [/akciğer hastalığı/i, p => (p.chronic || []).includes("KOAH") ? `KOAH · ${H.t("cp_src_chronic")}` : null],
    [/^Prematürite/, p => p.ageGroup === "neonate" && ((p.gestWeeks && p.gestWeeks < 37) || (p.birthWeight && p.birthWeight < 2500))
      ? [p.gestWeeks ? tpl("cp_w_gest_tpl", { w:p.gestWeeks }) : "", p.birthWeight ? tpl("cp_w_bw_tpl", { g:p.birthWeight }) : ""].filter(Boolean).join(" · ") + ` · ${H.t("cp_src_rec")}` : null],
    [/^(Cerrahi girişim|Cerrahi yara|Anestezi)/, p => /postop|sonrası|operasyon|cerrahi|ameliyat/i.test(p.dx || "") ? `${p.dx} · ${H.t("cp_src_dx")}` : null],
  ];
  const causeEv = (p, text) => { for (const [re, f] of CAUSE_EV) if (re.test(text)) { const r = f(p); if (r) return r; } return null; };

  /* Birim paketleri (kapsam başına): favs = birimin sık kullandıkları · off = bu birimde gizlenen tanılar ·
   * on = kapsamı dışında olduğu hâlde bu birimde açılan tanılar. Erişkin YBÜ ve KVC YBÜ tam; diğerleri iskelet.
   * Anahtarlar Yönetim → Bakım kataloğu → Birim paketleri'nde değişir (şimdilik sürümlenmez, denetim kaydına yazılır). */
  const PKG = {
    icu:{ favs:["agri", "enfeksiyon", "dusme", "deri_risk", "vap", "mv_takip", "aspirasyon", "deliryum", "sivi_eksik", "havayolu", "hiperglisemi", "bilinc_risk", "ajite", "oral_muk", "spontan", "weaning"], off:["lipo"], on:[] },
    cvicu:{ favs:["kardiyak_debi", "gogus_tupu", "kanama", "agri", "hipotermi", "aritmi", "postop", "enfeksiyon", "mv_takip", "sivi_fazla", "bobrek", "deliryum", "deri_risk", "dusme"], off:["lipo", "adli"], on:[] },
    ccu:{ favs:["aritmi", "kardiyak_debi", "agri", "anksiyete", "aktivite", "sivi_fazla", "hematom", "bilgi"], off:[], on:[] },
    nicu:{ favs:["hipotermi", "enfeksiyon", "beslenme", "deri_risk", "aspirasyon", "bilgi", "hipoglisemi", "spontan"], off:[], on:[] },
    picu:{ favs:["agri", "enfeksiyon", "dusme", "deri_risk", "mv_takip", "aspirasyon", "hipertermi", "sivi_eksik"], off:[], on:[] },
    med:{ favs:["agri", "dusme", "bilgi", "enfeksiyon", "ozbakim", "konstipasyon", "hiperglisemi", "taburculuk"], off:[], on:[] },
    surg:{ favs:["agri", "postop", "cerrahi", "enfeksiyon", "dusme", "bulanti", "taburculuk"], off:[], on:[] },
    cward:{ favs:["agri", "dusme", "hipertermi", "enfeksiyon", "bilgi", "sivi_eksik"], off:[], on:[] },
    er:{ favs:["agri", "dusme", "adli", "ajite", "anksiyete", "kanama"], off:[], on:[] },
  };
  const FAVS = { icu:PKG.icu.favs, nicu:PKG.nicu.favs, ward:PKG.med.favs };                    // eski çağrılar için
  const visibleIn = (key, sc, base) => { if (!sc) return true; const K = PKG[sc]; if (!K) return true; if (K.on.includes(key)) return true; if (K.off.includes(key)) return false;
    const m = (base || MASTER).find(x => x.key === key) || CAT_BY[key]; return !m || inSc(m.units, sc); };
  // Birim sorumlu hemşiresinin "bu birim için madde öner" kayıtları → Yönetim → Bekleyen öneriler.
  const PROPOSALS = [
    { id:"pr1", key:"gogus_tupu", kind:"acts", t:"Transfer sırasında drenaj sistemi klemplenmeden, göğüs seviyesinin altında taşınır", f:"prn", sc:"cvicu", by:"hs.sevda", at:"23.09.2026 10:40", state:"pending" },
    { id:"pr2", key:"mv_takip", kind:"acts", t:"Ziyarette hasta yakınına solunum cihazıyla ilgili kısa bilgi verilir", f:"prn", sc:"icu", by:"hs.sevda", at:"24.09.2026 09:15", state:"pending" },
  ];
  /* Excel'den içe aktarma: hastanenin geri gönderdiği şablon satırları ana katalogla karşılaştırılır.
   * Dosya bu ekranda satır satır okunmaz; aşağıdaki fark kümesi hastanenin düzelttiği şablonun karşılığıdır. */
  const XLSX_DELTA = {
    add:[{ key:"dusme", kind:"causes", t:"Sedasyon uygulanması", u:["icu"] }, { key:"mv_takip", kind:"acts", t:"Hasta ve yakınına solunum cihazı süreciyle ilgili bilgi verilir", f:"prn", u:["icu"] },
      { key:"gogus_tupu", kind:"acts", t:"Dren sağılması yalnız hekim istemiyle yapılır", f:"prn", u:["cvicu"] }, { key:"kardiyak_debi", kind:"causes", t:"Kalp işlevinde azalma öyküsü", u:["cvicu"] },
      { key:"hipotermi", kind:"acts", t:"Transport sırasında ısı kaybı önlenir", f:"prn", u:["nicu"] }, { key:"konst_risk", kind:"acts", t:"Tuvalet alışkanlığına uygun saat planlanır", f:"shift", u:["med"] }],
    change:[{ key:"agri", kind:"acts", from:"Ağrı skoru 4 saatte bir ve gerektikçe değerlendirilecek", to:"Ağrı hastanenin ölçeğiyle 4 saatte bir ve gerektikçe değerlendirilir" },
      { key:"vap", kind:"acts", from:"El hijyenine uyulacak", to:"El hijyeni kurallarına uyulur" }],
    off:[{ key:"uyku", kind:"acts", t:"Gündüz uyanıklık desteklenecek" }],
  };

  /* ---------------- sürümler ---------------- */
  const VERSIONS = [
    { v:1, at:"01.09.2026 10:12", by:"admin", kind:"init", add:25, change:0 },
    { v:2, at:"15.09.2026 14:30", by:"admin", kind:"edit", add:0, change:12 },
    { v:3, at:"24.09.2026 03:40", by:"admin", kind:"import", add:38, change:7 },
  ];
  const CC = H.careCatalog = {
    get version() { return VERSIONS[VERSIONS.length - 1].v; },
    versions:VERSIONS, master:MASTER, rules:RULES, fields:FIELDS, freqs:FREQS, favs:FAVS, hbysNames:HBYS_NAMES,
    published:() => CAT, byKey:(k) => CAT_BY[k], freqName, normName,
    fieldName:(f) => H.t("cp_f_" + f), levels:["orta", "yüksek"], levelName:(v) => H.t(v === "yüksek" ? "cp_lvl_yuksek" : "cp_lvl_orta"),
    // içerik durumu (yalnız yönetim görür): hastane kataloğu · başlangıç içeriği (hastane onayı bekliyor) · içerik bekliyor · pasif
    status:(m) => m.passive ? "passive" : !(m.goals.some(x => !x.off) && m.acts.some(x => !x.off)) ? "pending" : m.src === "hastane" ? "hospital" : "starter",
    /* ---- bölüme göre içerik: kapsam + birim paketleri ---- */
    scopes:SCOPES, scopeName, scopesText, scList, scopeOfUnit, inScope:inSc, packages:PKG, proposals:PROPOSALS,
    unitsOf:(sc) => H.allUnits().filter(u => scopeOfUnit(u) === sc),
    visibleIn:(key, sc) => visibleIn(key, sc, CC.draft || MASTER),
    // bir tanının bu kapsamda görünen satır sayıları { c, g, a, own } (own = YALNIZ bu birime özgü satır)
    rowsIn(m, sc) { const n = (L) => L.filter(x => !x.off && inSc(x.u, sc)).length, own = [...m.causes, ...m.goals, ...m.acts].filter(x => !x.off && x.u && x.u.length === 1 && x.u[0] === sc).length;
      return { c:n(m.causes), g:n(m.goals), a:n(m.acts), own }; },
    setVisible(key, sc, on) { const K = PKG[sc], m = (CC.draft || MASTER).find(x => x.key === key); if (!K) return;
      K.off = K.off.filter(k => k !== key); K.on = K.on.filter(k => k !== key);
      const natural = !m || inSc(m.units, sc); if (on && !natural) K.on.push(key); if (!on && natural) K.off.push(key); },
    setFav(key, sc, on) { const K = PKG[sc]; if (!K) return; K.favs = K.favs.filter(k => k !== key); if (on) K.favs.push(key); },
    // paketi kopyala: sık kullanılanlar + görünür/gizli anahtarları; kaynağa özgü satırlara hedef kapsam taslakta eklenir
    copyPackage(from, to) { const A = PKG[from], B = PKG[to]; if (!A || !B || from === to) return 0; B.favs = A.favs.slice(); B.off = A.off.slice(); B.on = A.on.slice();
      let n = 0; const d = CC.edit(); d.forEach(m => [...m.causes, ...m.goals, ...m.acts].forEach(r => { if (r.u && r.u.length === 1 && r.u[0] === from) { r.u = [from, to]; n++; } }));
      CC.draftN += n; if (!n && !CC.draftN) CC.discard(); return n; },
    // birime özgü madde: ana katalogda kapsamlı satır olarak taslağa girer
    addRow(key, kind, t, f, sc, by) { const d = CC.edit(), m = d.find(x => x.key === key); if (!m || !t) return false;
      m[kind].push(kind === "acts" ? { t, l:null, f:f || "shift", off:false, u:sc ? [sc] : null } : { t, off:false, u:sc ? [sc] : null });
      m.changed = `${TODAY}.2026`; m.by = by; CC.draftN++; return true; },
    propose(o) { const pr = Object.assign({ id:"pr" + (PROPOSALS.length + 1) + "_" + Date.now() % 1000, at:`${TODAY}.2026 ${H.now()}`, state:"pending" }, o); PROPOSALS.unshift(pr); return pr; },
    decide(id, ok, by) { const pr = PROPOSALS.find(x => x.id === id); if (!pr || pr.state !== "pending") return null;
      pr.state = ok ? "approved" : "rejected"; pr.dec = { by, at:`${TODAY}.2026 ${H.now()}` }; if (ok) CC.addRow(pr.key, pr.kind, pr.t, pr.f, pr.sc, by); return pr; },
    // Excel'den içe aktarma önizlemesi: toplam ve birim bazında eklenecek / değişecek / aynı kalan / pasife alınacak
    xlsxPreview() { const base = CC.draft || MASTER, find = (k) => base.find(x => x.key === k);
      const add = XLSX_DELTA.add.filter(a => { const m = find(a.key); return m && !m[a.kind].some(r => r.t === a.t); });
      const change = XLSX_DELTA.change.filter(c => { const m = find(c.key); return m && m[c.kind].some(r => r.t === c.from); });
      const off = XLSX_DELTA.off.filter(o => { const m = find(o.key); return m && m[o.kind].some(r => r.t === o.t && !r.off); });
      const rowU = (x) => { const m = find(x.key), r = m && m[x.kind].find(y => y.t === (x.from || x.t)); return r ? r.u : x.u; };
      const per = SCOPES.map(sc => { let same = 0; base.filter(m => !m.passive && visibleIn(m.key, sc, base)).forEach(m => [m.causes, m.goals, m.acts].forEach(L => { same += L.filter(r => !r.off && inSc(r.u, sc)).length; }));
        const hit = (L) => L.filter(x => visibleIn(x.key, sc, base) && inSc(rowU(x), sc)).length, ch = hit(change), of = hit(off);
        return { sc, add:hit(add), change:ch, off:of, same:same - ch - of }; });
      const tot = { add:add.length, change:change.length, off:off.length, same:base.reduce((a, m) => a + [m.causes, m.goals, m.acts].reduce((b, L) => b + L.filter(r => !r.off).length, 0), 0) - change.length - off.length };
      return { add, change, off, per, tot }; },
    xlsxApply(by) { const pv = CC.xlsxPreview(), d = CC.edit(), find = (k) => d.find(x => x.key === k), touch = new Set();
      pv.add.forEach(a => { const m = find(a.key); m[a.kind].push(a.kind === "acts" ? { t:a.t, l:null, f:a.f || "shift", off:false, u:a.u || null } : { t:a.t, off:false, u:a.u || null }); touch.add(m); });
      pv.change.forEach(c => { const m = find(c.key), r = m[c.kind].find(y => y.t === c.from); r.t = c.to; touch.add(m); });
      pv.off.forEach(o => { const m = find(o.key), r = m[o.kind].find(y => y.t === o.t); r.off = true; touch.add(m); });
      touch.forEach(m => { m.src = "hastane"; m.changed = `${TODAY}.2026`; m.by = by; });
      return CC.publish(by, "excel", pv.add.length, pv.change.length + pv.off.length + CC.draftN); },
    // yönetim taslağı: MASTER'ın kopyası üzerinde çalışılır; yayımlanınca MASTER değişir, sürüm +1 olur.
    draft:null, draftN:0,
    edit() { if (!CC.draft) { CC.draft = clone(MASTER); CC.draftN = 0; } return CC.draft; },
    discard() { CC.draft = null; CC.draftN = 0; },
    publish(by, kind, add, change) { const src = CC.draft || MASTER; MASTER.splice(0, MASTER.length, ...clone(src));
      const v = CC.version + 1; VERSIONS.push({ v, at:`${TODAY}.2026 ${H.now()}`, by, kind, add:add || 0, change:change == null ? CC.draftN : change });
      CC.draft = null; CC.draftN = 0; setPublished(); return v; },
    // hastane kaydıyla karşılaştırma: eklenecek (hastanede var, bizde yok) · değişecek (ad yazımı farklı) · aynı · yalnız bizde
    importPreview() { const base = CC.draft || MASTER, add = [], change = [];
      HBYS_NAMES.forEach(([key, name, group]) => { const m = base.find(x => x.key === key) || base.find(x => normName(x.name) === normName(name));
        if (!m) add.push({ key, name, group }); else if (m.name !== name) change.push({ key:m.key, from:m.name, to:name }); });
      return { add, change, same:HBYS_NAMES.length - add.length - change.length, local:base.filter(m => !HBYS_NAMES.some(h => h[0] === m.key)).length }; },
    importApply(by) { const pv = CC.importPreview(), d = CC.edit();
      pv.add.forEach(a => d.push({ key:a.key, name:a.name, was:null, group:a.group, ages:null, opt:null, hbys:true, passive:false, changed:`${TODAY}.2026`, by, causes:[], goals:[], acts:[] }));
      pv.change.forEach(c => { const m = d.find(x => x.key === c.key); if (m) { m.was = m.was || c.from; m.name = c.to; m.hbys = true; m.changed = `${TODAY}.2026`; m.by = by; } });
      return CC.publish(by, "import", pv.add.length, pv.change.length + CC.draftN); },
    hits:(r, p) => ruleHits(r, p),
    plansByVersion() { const out = {}; Object.values(H.data.carePlans || {}).forEach(L => L.forEach(pl => { out[pl.cv] = (out[pl.cv] || 0) + 1; })); return out; },
  };
  const LINK_NAME = (l) => { if (!l) return ""; const [k, v] = l.split(":"); if (k === "care") return v; const f = (H.FORMS || []).find(x => x.key === v); return f ? f.name : v; };

  /* ================================ vardiyalar ================================
   * Son 3 gün × 2 vardiya; bugün en solda (HBYS gibi). İndis 0 = içinde bulunduğumuz vardiya (24.09 20–08). */
  // [gün, gün farkı (H.wd ile render anında dile göre kısa gün adı), iso]
  const DAYS = [["24.09", 0, "2026-09-24"], ["23.09", -1, "2026-09-23"], ["22.09", -2, "2026-09-22"]];
  const SH = [];
  DAYS.forEach(([d, off, iso], di) => { SH.push({ k:d + "|N", d, off, iso, n:"20–08", night:true, di }); SH.push({ k:d + "|D", d, off, iso, n:"08–20", night:false, di }); });
  const SH_LABEL = (i) => `${SH[i].d} ${SH[i].n}`;
  const GOAL_K = { met:["cp_g_met", "var(--ok)", "✓"], partial:["cp_g_partial", "var(--mid)", "◐"], unmet:["cp_g_unmet", "var(--high)", "✕"] };
  const GOAL = new Proxy({}, { get:(_, k) => GOAL_K[k] && [H.t(GOAL_K[k][0]), GOAL_K[k][1], GOAL_K[k][2]], ownKeys:() => Reflect.ownKeys(GOAL_K), getOwnPropertyDescriptor:(_, k) => ({ enumerable:true, configurable:true, value:GOAL[k] }) });
  const END_REASONS = ["goal", "disch", "invalid"];            // kayıtta anahtar tutulur, ekranda H.t ile çizilir
  const endReason = (r) => END_REASONS.includes(r) ? H.t("cp_end_" + r) : r;
  // Vardiya değerlendirmesinde "kayıttan" ön işaret: bugünün görev listesi (H.data.tasks) yalnız son iki vardiyayı kapsar.
  const TASK_WIN = { 0:[20, 32], 1:[8, 20] };
  const hhmm = (t) => { const h = Math.floor(t), m = Math.round((t - h) * 60); return String(h % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0"); };
  const autoDone = (p, link, si, plId, ai) => {
    const w = TASK_WIN[si]; if (!w || (!link && !plId)) return null;
    const [kind, val] = (link || "").split(":");
    const L = (H.data.tasks || []).filter(x => x.pid === p.id && x.t >= w[0] && x.t < w[1] && x.state === "done" && ((plId && x.cp === plId && x.ai === ai) || (link && (kind === "form" ? x.form === val : x.kind === "care" && x.label === val))));
    return L.length ? L.map(x => hhmm(x.t)).join(", ") : null;
  };

  /* ================================ veri ================================ */
  H.data.carePlans = H.data.carePlans || {};
  const DISMISS = {};                 // pid → { key: { by, at } }
  const DRAFTS = {};                  // pid → saklanan tanı ekleme taslağı { sel, tabs, focus, date, sh, by, at } (plana girmez)
  const UI = {};                      // pid → { open:Set(planId), ended:bool }
  const ui = (pid) => UI[pid] || (UI[pid] = { open:new Set(), ended:false });
  let SEQ = 1;
  const newId = () => "cp" + (SEQ++);
  const dayNurse = "Mələk A.";        // devir listesindeki uydurma adlar (core.js H.data.handovers)
  const nightNurse = (i) => i === 4 ? "Aygün M." : "Sevda Q.";

  function mkPlan(key, startIdx, startAt, by, sel, evals, cv) {
    cv = cv || CC.version;
    const c = snapOf(key, cv), all = (a) => a.map((_, i) => i);
    const pl = { id:newId(), key, cv, snap:c, causes:sel.c || [], goals:sel.g || all(c.goals), acts:sel.a || all(c.acts), opt:sel.opt || null,
      freq:Object.assign({}, ...c.acts.map((a, i) => ({ [i]:a.f || "shift" })), sel.f || {}), note:sel.note || "", auto:sel.auto || {},
      start:{ idx:startIdx, label:SH_LABEL(startIdx), at:startAt, by }, status:"active", end:null, evals:{}, hist:[] };
    pl.hist.push({ at:startAt, by, what:() => H.t("cp_h_added"), sub:() => tpl("cp_h_startshift_tpl", { s:SH_LABEL(startIdx) }) });
    Object.entries(evals || {}).forEach(([i, v]) => {
      if (!v) return; i = +i; const s = SH[i];
      const at = `${s.night ? (i === 0 ? TODAY : nextDay(s.d)) : s.d} ${v.at || (s.night ? (i === 0 ? "21:05" : "07:10") : "19:30")}`;
      const doneActs = pl.acts.filter((_, j) => !(v.skip || []).includes(j));
      pl.evals[s.k] = { goal:v.g, acts:doneActs, note:v.note || "", by:v.by || (s.night ? nightNurse(i) : dayNurse), at, late:false };
    });
    return pl;
  }
  const nextDay = (d) => ({ "22.09":"23.09", "23.09":"24.09", "24.09":"25.09" })[d] || d;

  function seed() {
    if (H.data.carePlans.__seeded) return;
    Object.defineProperty(H.data.carePlans, "__seeded", { value:true, enumerable:false });
    // p1 · 3 aktif tanı. Solunum: son iki değerlendirmede hedef karşılanmadı → uyarı örneği. Ağrı: 23.09 gecesi boş.
    // 22–23.09'da yazılan planlar katalog v2 ile yazıldı (v3 24.09'da yayımlandı) → kendi sürümleriyle açılır.
    H.data.carePlans.p1 = [
      mkPlan("agri", 5, "22.09 10:15", dayNurse, { c:[1, 2], g:[0, 1], a:[0, 1, 2, 3, 6] },
        { 5:{ g:"unmet", note:"Hekime bildirildi, istem güncellendi." }, 4:{ g:"partial" }, 3:{ g:"partial", skip:[4] }, 2:null, 1:{ g:"partial" } }, 2),
      mkPlan("dusme", 5, "22.09 10:20", dayNurse, { c:[0, 1, 3], g:[0, 1], a:[0, 1, 2, 3, 5] },
        { 5:{ g:"met" }, 4:{ g:"met" }, 3:{ g:"met" }, 2:{ g:"met" }, 1:{ g:"met" }, 0:{ g:"met", at:"20:40", by:"Sevda Q." } }, 2),
      mkPlan("solunum", 3, "23.09 11:30", dayNurse, { c:[0, 1], g:[1, 2], a:[0, 1, 2, 3, 5] },
        { 3:{ g:"partial" }, 2:{ g:"unmet", note:"Ek oksijenle satürasyon hedefin altında seyretti, hekime bildirildi." }, 1:{ g:"unmet", note:"Solunum sıkıntısı sürüyor; hekim değerlendirdi." } }, 2),
    ];
    // p2 · 2 aktif tanı; birkaç boş hücre.
    H.data.carePlans.p2 = [
      mkPlan("havayolu", 5, "22.09 09:40", dayNurse, { c:[0, 1, 3], g:[0, 1, 2], a:[0, 1, 2, 3, 5] },
        { 5:{ g:"partial" }, 4:null, 3:{ g:"partial" }, 2:{ g:"partial", skip:[1] }, 1:{ g:"met" } }, 2),
      mkPlan("deri_risk", 4, "22.09 22:30", "Aygün M.", { c:[0, 2], g:[0, 1] },
        { 4:{ g:"met" }, 3:{ g:"met" }, 2:null, 1:{ g:"met" } }, 2),
    ];
    // Görevlerim bağı: aktif planların seçili faaliyetleri bu vardiyanın kalan saatlerine iş olarak düşer (geçmiş saatler uydurulmaz).
    ["p1", "p2"].forEach(pid => { const p = H.pt(pid); if (p) H.data.carePlans[pid].forEach(pl => planTasks(p, pl)); });
  }

  /* ---------------- Görevlerim bağı ----------------
   * Faaliyet sıklığı → bu vardiyanın kalan saatleri (FREQ_H). Forma ya da bakım işine bağlı faaliyette aynı iş ±1 saatte zaten
   * varsa yenisi açılmaz (form takvimi ya da pozisyon planıyla çakışmasın). Gerektikçe olan faaliyet saatli iş üretmez.
   * İş kaydı: { pid, t, kind, label, form?, state, src:"cp", cp:planId, ai } — nursing.js Görevlerim bunu diğer işler gibi çizer. */
  function planTasks(p, pl, dry) {
    const c = cOf(pl), T = H.data.tasks || (H.data.tasks = []); let n = 0;
    pl.acts.forEach(ai => {
      const a = c.acts[ai]; if (!a) return;
      const fq = (pl.freq || {})[ai] || a.f || "shift", hours = FREQ_H[fq] || [];
      const [lk, lv] = (a.l || "").split(":");
      // bağlı işte aynı iş sıklığın yarı aralığında zaten varsa (vardiyada 1 → bu vardiyada) yenisi açılmaz
      const near = (x, h) => fq === "shift" ? x.t >= 20 && x.t < 32 : Math.abs(x.t - h) <= (fq === "q8" ? 4 : 2);
      hours.forEach(h => {
        const base = lk === "form" ? { kind:"form", label:(H.FORMS.find(f => f.key === lv) || { name:a.t }).name, form:lv } : lk === "care" ? { kind:"care", label:lv } : { kind:"care", label:a.t };
        if (lk && T.some(x => x.pid === p.id && near(x, h) && (lk === "form" ? x.form === lv : x.kind === "care" && x.label === lv))) return;
        if (T.some(x => x.cp === pl.id && x.ai === ai && x.t === h)) return;
        if (!dry) T.push(Object.assign({ pid:p.id, t:h, state:h < 23 ? "due" : "plan", src:"cp", cp:pl.id, ai }, base)); n++;
      });
    });
    return n;
  }
  // Plan düzenlenince / sonlanınca o plandan gelen tamamlanmamış işler geri çekilir (tamamlananlar kayıt olarak kalır).
  function dropTasks(pl) { const T = H.data.tasks || []; for (let i = T.length - 1; i >= 0; i--) if (T[i].cp === pl.id && T[i].state !== "done") T.splice(i, 1); }
  const planTaskCount = (pl) => (H.data.tasks || []).filter(x => x.cp === pl.id).length;
  const plansOf = (pid) => { seed(); return H.data.carePlans[pid] || (H.data.carePlans[pid] = []); };
  const activeOf = (pid) => plansOf(pid).filter(x => x.status === "active");
  const cellApplies = (pl, i) => i <= pl.start.idx;

  /* ---------------- sistem önerileri (kayıtlardan türetilir; kabul edilmeden plana girmez) ---------------- */
  // Gerekçeler render anında dile göre üretilsin diye kapanış (fonksiyon) olarak tutulur; why[] ekranda txt() ile çözülür.
  // 24.09 · öneriler artık veri olan kurallardan (CC.rules) türetilir; kural pasif ya da hedef tanı yayımda yoksa öneri çıkmaz.
  function suggestionsAll(p) {
    const out = {};
    RULES.forEach(r => { if (!CAT_BY[r.key] || !ruleHits(r, p)) return; (out[r.key] = out[r.key] || []).push(() => FIELDS[r.f].why(p, r)); });
    return Object.entries(out).map(([key, why]) => ({ key, why, name:CAT_BY[key].name }));
  }
  const dismissed = (pid) => DISMISS[pid] || (DISMISS[pid] = {});
  function suggestions(p) {
    const pl = plansOf(p.id), dis = dismissed(p.id);
    return suggestionsAll(p).filter(s => !pl.some(x => x.key === s.key) && !dis[s.key]);
  }

  /* ---------------- özet (vardiya devri için) ---------------- */
  function summary(pid) {
    const p = H.pt(pid); if (!p) return "";
    const act = activeOf(pid);
    if (!act.length) { const n = suggestions(p).length; return n ? tpl("cp_sum_none_sug_tpl", { n }) : H.t("cp_sum_none"); }
    const miss = act.filter(x => !x.evals[SH[0].k]).length;
    return miss ? tpl("cp_sum_miss_tpl", { a:act.length, m:miss }) : tpl("cp_sum_ok_tpl", { a:act.length });
  }

  /* ================================ bakım planı sekmesi ================================ */
  function lastEvals(pl, n) { const out = []; for (let i = 0; i < SH.length && out.length < n; i++) { const e = pl.evals[SH[i].k]; if (e) out.push(e); } return out; }

  function cellHtml(pl, i) {
    if (!cellApplies(pl, i)) return `<td class="cp-c na" title="${E(H.t("cp_c_na"))}"></td>`;
    const e = pl.evals[SH[i].k], attr = `data-cp-cell="${pl.id}|${i}"`;
    if (e) { const g = GOAL[e.goal]; return `<td class="cp-c ${i === 0 ? "now" : ""}" ${attr} title="${E(g[0])} · ${E(e.by)} · ${E(e.at)}"><span class="cp-ck" style="--c:${g[1]}">${g[2]}</span>${e.late ? `<span class="cp-late">${H.t("cp_late")}</span>` : ""}</td>`; }
    if (i === 0) return `<td class="cp-c now" ${attr} title="${E(H.t("cp_c_now"))}"><span class="cp-go">${H.t("cp_assess")}</span></td>`;
    return `<td class="cp-c miss" ${attr} title="${E(H.t("cp_c_miss"))}">⊗</td>`;
  }

  function planInner(p) {
    const act = activeOf(p.id), ended = plansOf(p.id).filter(x => x.status !== "active"), sug = suggestions(p), U = ui(p.id);
    const nDis = Object.keys(dismissed(p.id)).length;
    const miss = act.filter(x => !x.evals[SH[0].k]).length;
    const unit = H.unit((H.bed(p.bed) || {}).unitId);
    const opUnit = unit && H.isClinical && !H.isClinical(unit);

    // uyarılar: son iki değerlendirmede hedef karşılanmadı · son 3 günde boş kalan vardiyalar
    const warns = [];
    act.forEach(pl => {
      const le = lastEvals(pl, 2);
      if (le.length === 2 && le.every(e => e.goal === "unmet")) warns.push(["w", tpl("cp_warn_unmet_tpl", { name:E(cOf(pl).name) })]);
    });
    const gaps = act.reduce((a, pl) => a + SH.filter((s, i) => i > 0 && cellApplies(pl, i) && !pl.evals[s.k]).length, 0);
    if (gaps) warns.push(["i", E(tpl("cp_warn_gaps_tpl", { n:gaps }))]);

    const sugHtml = sug.length || nDis ? `<div class="cp-sug">
        <div class="cp-sugh">${I("zap")}${H.t("cp_sug_title")} <span>${H.t("cp_sug_sub")}</span></div>
        ${sug.length ? `<div class="cp-sugl">${sug.map(s => `<div class="cp-sgi"><div><b>${E(s.name)}</b><ul>${s.why.map(w => `<li>${E(txt(w))}</li>`).join("")}</ul></div>
          <div class="cp-sgb"><button class="btn p sm" data-cp-sa="${s.key}">${I("plus")}${H.t("cp_btn_add_plan")}</button><button class="btn g sm" data-cp-sd="${s.key}">${H.t("cp_btn_dismiss")}</button></div></div>`).join("")}</div>`
          : `<div class="cp-sgf" style="margin-top:6px">${H.t("cp_sug_none")}</div>`}
        <div class="cp-sgf">${H.t("cp_sug_foot")}${AN("cp_adm_sug_rules")}${nDis ? ` · ${tpl("cp_sug_dismissed_tpl", { n:nDis })} — <a data-cp-undo>${H.t("cp_undo")}</a>` : ""}</div></div>` : "";

    const head = `<thead><tr><th class="cp-dxh" rowspan="2">${H.t("cp_th_dx")}</th>${DAYS.map(([d, off], i) => `<th colspan="2" class="cp-day ${i === 0 ? "today" : ""}">${i === 0 ? H.t("cp_today") + " · " : ""}${H.wd(off)} ${d}</th>`).join("")}</tr>
      <tr>${SH.map((s, i) => `<th class="cp-shh ${i === 0 ? "now" : ""}">${s.n}${i === 0 ? `<small>${H.t("cp_now")}</small>` : ""}</th>`).join("")}</tr></thead>`;
    const rows = act.map(pl => {
      const c = cOf(pl), open = U.open.has(pl.id);
      const row = `<tr><th class="cp-dx"><div class="cp-dxn"><b>${E(c.name)}</b>${pl.opt ? `<span class="tag">${E(pl.opt)}</span>` : ""}</div>
          <div class="cp-dxm">${E(tpl("cp_since_tpl", { s:pl.start.label }))} · <span class="cp-st">${H.t("cp_ongoing")}</span> <span class="cp-v ${pl.cv < CC.version ? "old" : ""}" title="${E(tpl("cp_cv_old_tpl", { v:pl.cv, c:CC.version }))}">v${pl.cv}</span></div>
          <div class="cp-dxa"><button class="cp-ic ${open ? "on" : ""}" data-cp-a="info" data-cp-id="${pl.id}" title="${E(H.t("cp_t_info"))}">${I("eye")}</button>
            <button class="cp-ic" data-cp-a="edit" data-cp-id="${pl.id}" title="${E(H.t("cp_t_edit"))}">${I("edit")}</button>
            <button class="cp-ic" data-cp-a="hist" data-cp-id="${pl.id}" title="${E(H.t("cp_t_hist"))}">${I("clock")}</button>
            <button class="cp-ic" data-cp-a="end" data-cp-id="${pl.id}" title="${E(H.t("cp_t_end"))}">${I("x")}</button></div></th>
        ${SH.map((_, i) => cellHtml(pl, i)).join("")}</tr>`;
      const det = open ? `<tr class="cp-det"><td colspan="${SH.length + 1}"><div class="cp-detIn">
          <div><h6>${H.t("cp_h_causes")}</h6>${pl.causes.length ? `<ul>${pl.causes.map(i => `<li>${E(c.causes[i])}</li>`).join("")}</ul>` : `<span class="mute">${H.t("cp_not_selected")}</span>`}</div>
          <div><h6>${H.t("cp_h_goals")}</h6>${pl.goals.length ? `<ul>${pl.goals.map(i => `<li>${E(c.goals[i])}</li>`).join("")}</ul>` : `<span class="mute">${c.pending ? H.t("cp_no_goals_pending") : H.t("cp_not_selected")}</span>`}</div>
          <div><h6>${H.t("cp_h_acts")}</h6>${pl.acts.length ? `<ul>${pl.acts.map(i => `<li>${E(c.acts[i].t)}<span class="cp-fqt">· ${E(freqName((pl.freq || {})[i] || c.acts[i].f))}</span></li>`).join("")}</ul>` : `<span class="mute">${H.t("cp_not_selected")}</span>`}
            ${planTaskCount(pl) ? `<div class="mute" style="font-size:11.5px;margin-top:4px">${I("list")} ${E(tpl("cp_tasks_line_tpl", { n:planTaskCount(pl), tasks:H.t("m_tasks") }))}</div>` : ""}</div>
          ${pl.note ? `<div style="grid-column:1/-1"><h6>${H.t("cp_free_note")}</h6><div>${E(pl.note)}</div></div>` : ""}</div></td></tr>` : "";
      return row + det;
    }).join("");

    const btnNew = `<b>${H.t("cp_btn_new")}</b>`;
    return `<div class="cp-head"><h4>${H.t("cp_title")}</h4>
        <span class="cp-sum">${tpl("cp_head_active_tpl", { n:`<b>${act.length}</b>` })}${act.length ? ` · ${tpl("cp_head_shift_tpl", { x:miss ? `<b style="color:var(--attInk)">${E(tpl("cp_missing_tpl", { n:miss }))}</b>` : `<b style="color:var(--ok)">${H.t("cp_done")}</b>` })}` : ""}</span>
        <span class="r">${DRAFTS[p.id] ? `<button class="btn g sm" data-cp-new>${I("edit")}${E(tpl("cp_draft_badge_tpl", { n:Object.keys(DRAFTS[p.id].sel).length }))}</button>` : ""}<button class="btn p sm" data-cp-new>${I("plus")}${H.t("cp_btn_new")}</button></span></div>
      ${opUnit ? `<div class="note i" style="margin-bottom:12px">${H.t("cp_opunit_note")}</div>` : sugHtml}
      ${warns.length ? `<div class="cp-warn">${warns.map(([k, t]) => `<div class="note ${k === "i" ? "i" : ""}">${I(k === "i" ? "clock" : "alert")}<span>${t}</span></div>`).join("")}</div>` : ""}
      ${act.length ? `<div class="cp-tw"><table class="cp-t">${head}<tbody>${rows}</tbody></table></div>
        <div class="cp-leg"><span><span class="cp-ck" style="--c:var(--ok)">✓</span> ${H.t("cp_leg_met")}</span><span><span class="cp-ck" style="--c:var(--mid)">◐</span> ${H.t("cp_leg_partial")}</span><span><span class="cp-ck" style="--c:var(--high)">✕</span> ${H.t("cp_leg_unmet")}</span><span>⊗ ${H.t("cp_leg_notassessed")}</span><span><span class="cp-go">${H.t("cp_assess")}</span> ${H.t("cp_leg_thisshift")}</span><span>${H.t("cp_leg_tap")}</span></div>`
        : `<div class="empty">${H.t("cp_empty")} ${tpl(sug.length ? "cp_empty_sug_tpl" : "cp_empty_cat_tpl", { btn:btnNew })}</div>`}
      ${ended.length ? `<div class="box cp-ended"><h5>${H.t("cp_ended_h")} (${ended.length}) <span class="r"><button class="btn g sm" data-cp-ended>${U.ended ? H.t("cp_hide") : H.t("cp_show")}</button></span></h5>
        ${U.ended ? ended.map(pl => `<div class="kv"><span><b style="font-family:Figtree">${E(cOf(pl).name)}</b> <span class="mute">· ${E(pl.start.label)} → ${E(pl.end.at)} · ${E(endReason(pl.end.reason))}${pl.end.note ? " · " + E(pl.end.note) : ""}</span></span><button class="btn g sm" data-cp-a="hist" data-cp-id="${pl.id}">${I("clock")}${H.t("cp_t_hist")}</button></div>`).join("") : ""}</div>` : ""}
      <div class="cp-foot">${E(tpl("cp_foot_tpl", { label:`${H.t("cp_cat_label")} v${CC.version}`, n:CAT.length }))}${AN("cp_adm_cat")}</div>`;
  }

  function planHtml(p) { return `<div class="cp-root" data-cp-root="${E(p.id)}">${planInner(p)}</div>`; }

  function planAfter(el, p) {
    const root = el && (el.matches && el.matches(".cp-root") ? el : el.querySelector(".cp-root"));
    if (!root) return;
    const rerender = () => { root.innerHTML = planInner(p); };
    root.onclick = (e) => {
      const T = e.target;
      if (T.closest("[data-cp-new]")) { dxModal(p, { mode:"new" }, rerender); return; }
      const sa = T.closest("[data-cp-sa]"); if (sa) { dxModal(p, { mode:"new", pre:sa.dataset.cpSa }, rerender); return; }
      const sd = T.closest("[data-cp-sd]"); if (sd) { const k = sd.dataset.cpSd; dismissed(p.id)[k] = { by:me(), at:stamp() }; H.log("Bakım planı önerisi geri çevrildi", `${bedNo(p)} · ${CAT_BY[k].name}`); H.toast(H.t("cp_toast_dismissed")); rerender(); return; }
      if (T.closest("[data-cp-undo]")) { DISMISS[p.id] = {}; H.toast(H.t("cp_toast_undo")); rerender(); return; }
      if (T.closest("[data-cp-ended]")) { const U = ui(p.id); U.ended = !U.ended; rerender(); return; }
      const cell = T.closest("[data-cp-cell]"); if (cell) { const [id, i] = cell.dataset.cpCell.split("|"); const pl = plansOf(p.id).find(x => x.id === id); if (pl) evalModal(p, pl, +i, rerender); return; }
      const a = T.closest("[data-cp-a]"); if (a) {
        const pl = plansOf(p.id).find(x => x.id === a.dataset.cpId); if (!pl) return;
        const k = a.dataset.cpA;
        if (k === "info") { const U = ui(p.id); U.open.has(pl.id) ? U.open.delete(pl.id) : U.open.add(pl.id); rerender(); }
        else if (k === "edit") dxModal(p, { mode:"edit", plan:pl }, rerender);
        else if (k === "hist") histModal(p, pl);
        else if (k === "end") endModal(p, pl, rerender);
      }
    };
  }

  /* ---------------- Yeni tanı / Düzenle penceresi (24.09 · 4. oturum yeniden) ----------------
   * Hastane kayıt sisteminin "Tanı Ekleme" ekranının üç bölmesi, birebir kopya değil; bizim katkılarımızla:
   *  · solda arama + gruplu liste: Önerilen (sistemden) · Birimin sık kullandıkları · Tümü
   *  · seçilen tanılar üstte sekme; her sekmede Nedenler + Hedefler | Faaliyetler, her bölümde "tümünü seç"
   *  · nedenler hasta verisinden ÖNCEDEN işaretli, kaynağı rozetle yanında (hemşire kaldırabilir) — causeEv
   *  · her faaliyetin sıklığı; Mühürle'de Görevlerim'e iş olarak düşer — planTasks
   *  · içeriği hastane kataloğundan henüz gelmemiş tanı: bölmeler yerine "içerik bekliyor" + serbest not
   * Alt çubuk: kaç tanı / faaliyet / iş · Vazgeç · Taslağı sakla · Mühürle ("Kaydet/İmzala" kullanılmaz).
   * Düzenlemede sol liste yok; plan kendi katalog sürümünün (snap) listesiyle düzenlenir. */
  function dxModal(p, o, rerender) {
    const edit = o.mode === "edit", plans = activeOf(p.id);
    const sugAll = suggestionsAll(p);
    const inPlan = (k) => !edit && plans.some(x => x.key === k);
    const unitObj = H.unit((H.bed(p.bed) || {}).unitId), unitType = (unitObj || {}).type || "icu";
    // 24.09 · bölüme göre içerik: hastanın biriminin kapsamı (Erişkin YBÜ, KVC YBÜ…) listeyi ve maddeleri süzer.
    const SC = scopeOfUnit(unitObj);
    const favs = ((SC && PKG[SC] ? PKG[SC].favs : FAVS[unitType]) || FAVS.icu).filter(k => CAT_BY[k]);
    const src = (k) => edit ? o.plan.snap : CAT_BY[k];
    const S = { q:"", sel:{}, tabs:[], focus:null, date:"2026-09-24", sh:"N", restored:null, other:false, prop:null };
    const canProp = !edit && !!SC && ((H.state.user || {}).extras || []).includes("charge");
    const uOf = (c, kind, i) => kind === "c" ? (c.cu || [])[i] : kind === "g" ? (c.gu || [])[i] : ((c.acts[i] || {}).u);
    const rowIn = (c, kind, i) => inSc(uOf(c, kind, i), SC);
    const LST = { c:"causes", g:"goals", a:"acts" };
    // görünen satırlar: bu birimin kapsamındakiler + (düzenlemede) zaten seçili olanlar; anahtar açıksa hepsi
    const visIdx = (c, kind) => c[LST[kind]].map((_, i) => i).filter(i => S.other || rowIn(c, kind, i) || (S.sel[c.key] && S.sel[c.key][kind].has(i)));
    const dxIn = (c) => S.other || edit || visibleIn(c.key, SC);
    const freqsOf = (c) => Object.assign({}, ...c.acts.map((a, i) => ({ [i]:a.f || "shift" })));
    const pick = (k) => { const c = CAT_BY[k]; if (!c || inPlan(k)) return; const auto = {}, cs = new Set();
      c.causes.forEach((t, i) => { if (!rowIn(c, "c", i)) return; const ev = causeEv(p, t); if (ev) { auto[i] = ev; cs.add(i); } });
      const vis = (kind) => new Set(c[LST[kind]].map((_, i) => i).filter(i => rowIn(c, kind, i)));
      S.sel[k] = { c:cs, g:vis("g"), a:vis("a"), f:freqsOf(c), opt:c.opt ? c.opt.v[0] : null, note:"", auto };
      if (!S.tabs.includes(k)) S.tabs.push(k); };
    const unpick = (k) => { delete S.sel[k]; S.tabs = S.tabs.filter(x => x !== k); };
    const ensure = () => { if (!S.sel[S.focus]) pick(S.focus); return S.sel[S.focus]; };

    if (edit) { const pl = o.plan; S.sel[pl.key] = { c:new Set(pl.causes), g:new Set(pl.goals), a:new Set(pl.acts), f:Object.assign(freqsOf(pl.snap), pl.freq || {}), opt:pl.opt, note:pl.note || "", auto:Object.assign({}, pl.auto || {}) };
      S.tabs = [pl.key]; S.focus = pl.key; }
    else {
      const d = DRAFTS[p.id];
      if (d) { Object.entries(d.sel).forEach(([k, s]) => { if (!CAT_BY[k] || inPlan(k)) return; S.sel[k] = { c:new Set(s.c), g:new Set(s.g), a:new Set(s.a), f:Object.assign({}, s.f), opt:s.opt, note:s.note, auto:Object.assign({}, s.auto) }; });
        S.tabs = d.tabs.filter(k => S.sel[k]); S.date = d.date; S.sh = d.sh; S.focus = S.sel[d.focus] ? d.focus : S.tabs[0]; S.restored = { by:d.by, at:d.at }; }
      if (o.pre && !inPlan(o.pre)) { pick(o.pre); S.focus = o.pre; }
      if (!S.focus) S.focus = (sugAll.find(s => !inPlan(s.key) && dxIn(CAT_BY[s.key] || {})) || {}).key || favs.find(k => !inPlan(k)) || (CAT.find(dxIn) || CAT[0]).key;
    }

    /* --- sol liste --- */
    const liHtml = (c, sub) => { const on = !!S.sel[c.key], dis = inPlan(c.key);
      return `<div class="cp-li ${S.focus === c.key ? "on" : ""} ${dis ? "dis" : ""}" data-cpn-f="${c.key}"><input type="checkbox" data-cpn-chk="${c.key}" ${on ? "checked" : ""} ${dis ? "disabled" : ""} aria-label="${E(c.name)}"><span>${E(c.name)}${sub ? `<small>${sub}</small>` : ""}</span>${dis ? `<em class="in">${H.t("cp_in_plan")}</em>` : c.empty ? `<em class="pd">${H.t("cp_pending")}</em>` : ""}</div>`; };
    const listHtml = () => { const q = norm(S.q), hit = (c) => !q || norm(c.name).includes(q) || norm(c.group).includes(q) || (c.was && norm(c.was).includes(q));
      const hid = SC ? CAT.filter(c => hit(c) && !visibleIn(c.key, SC)).length : 0;
      const tog = SC ? `<label class="cp-oth" title="${E(tpl("cp_pkg_tpl", { u:scopeName(SC) }))}"><input type="checkbox" data-cpn-other${S.other ? " checked" : ""}>${H.t("cp_other_units")}${!S.other && hid ? ` <i>${E(tpl("cp_hidden_tpl", { n:hid }))}</i>` : ""}</label>` : "";
      const all = CAT.filter(c => hit(c) && dxIn(c));
      const allH = `<div class="cp-xg cp-xgA">${I("list")}${tpl("cp_grp_all_tpl", { n:all.length })}${tog}</div>`;
      if (!all.length) return allH + `<div class="cp-hint" style="margin:8px 4px">${E(tpl("cp_no_match_tpl", { q:S.q }))}</div>`;
      const sug = sugAll.filter(s => CAT_BY[s.key] && hit(CAT_BY[s.key]) && dxIn(CAT_BY[s.key])), fav = favs.map(k => CAT_BY[k]).filter(c => hit(c) && dxIn(c));
      const oth = (c) => SC && !visibleIn(c.key, SC) ? ` · ${H.t("cp_other_unit")}` : "";
      return (SC ? `<div class="cp-pkg">${I("building")}${E(tpl("cp_pkg_tpl", { u:scopeName(SC) }))}</div>` : "")
        + (sug.length ? `<div class="cp-xg">${I("zap")}${H.t("cp_grp_sug")}</div>${sug.map(s => liHtml(CAT_BY[s.key], E(txt(s.why[0])))).join("")}` : "")
        + (fav.length ? `<div class="cp-xg">${I("star")}${H.t("cp_grp_fav")}</div>${fav.map(c => liHtml(c)).join("")}` : "")
        + allH + all.map(c => liHtml(c, E(c.group) + oth(c))).join(""); };

    /* --- sekmeler --- */
    const tabsHtml = () => { const t = S.tabs.map(k => { const s = S.sel[k], c = src(k);
        return `<span class="cp-tab ${S.focus === k ? "on" : ""}" data-cpn-tab="${k}" title="${E(c.name)}"><span>${E(c.name)}</span><small>${s.a.size}</small>${edit ? "" : `<button type="button" data-cpn-rm="${k}" title="${E(H.t("cp_remove"))}">${I("x")}</button>`}</span>`; });
      if (S.focus && !S.sel[S.focus] && src(S.focus)) t.push(`<span class="cp-tab on pv"><span>${E(src(S.focus).name)}</span><small>${H.t("cp_preview")}</small></span>`);
      return t.join("") || `<span class="mute" style="font-size:12.5px;padding:6px">${H.t("cp_none_selected")}</span>`; };

    /* --- Nedenler + Hedefler | Faaliyetler --- */
    const chkRow = (kind, i, text, on, dis, extra) => `<label class="cp-ck2 ${dis ? "dis" : ""}"><input type="checkbox" data-cpn-${kind}="${i}" ${on ? "checked" : ""} ${dis ? "disabled" : ""}><span class="cp-t2"><span>${text}</span>${extra || ""}</span></label>`;
    const secH = (label, kind, set, vis, dis) => { const n = vis.length, k = set ? vis.filter(i => set.has(i)).length : 0;
      return `<div class="cp-xS">${label} <i>${k}/${n}</i>${n && !dis ? `<a data-cpn-all="${kind}">${k === n ? H.t("cp_unselect_all") : H.t("cp_select_all")}</a>` : ""}</div>`; };
    const othTag = (c, kind, i) => SC && !rowIn(c, kind, i) ? ` <span class="tag" title="${E(scopesText(uOf(c, kind, i)))}">${H.t("cp_other_unit")}</span>` : "";
    // birim sorumlu hemşiresi: "Bu birim için madde öner" → Yönetim → Bekleyen öneriler
    const propHtml = () => { if (!canProp) return ""; const c = src(S.focus); if (!c) return "";
      if (!S.prop) return `<div class="cp-prop"><a data-cpp-open>${I("plus")}${E(tpl("cp_prop_btn_tpl", { u:scopeName(SC) }))}</a></div>`;
      return `<div class="cp-prop on"><b>${E(tpl("cp_prop_btn_tpl", { u:scopeName(SC) }))}</b>
        <div class="cp-propR"><select data-cpp-kind aria-label="${E(H.t("cp_prop_kind"))}">${[["causes", "cp_h_causes"], ["goals", "cp_h_goals"], ["acts", "cp_h_acts"]].map(([k, l]) => `<option value="${k}"${S.prop.kind === k ? " selected" : ""}>${E(H.t(l))}</option>`).join("")}</select>
          ${S.prop.kind === "acts" ? `<select data-cpp-f aria-label="${E(H.t("cp_freq_lbl"))}">${FREQS.map(f => `<option value="${f}"${S.prop.f === f ? " selected" : ""}>${E(freqName(f))}</option>`).join("")}</select>` : ""}</div>
        <input data-cpp-t maxlength="200" value="${E(S.prop.t)}" placeholder="${E(H.t("cp_prop_ph"))}">
        <div class="cp-propR"><span class="mute" style="font-size:11.5px;flex:1 1 180px">${H.t("cp_prop_note")}</span><button type="button" class="btn g sm" data-cpp-x>${H.t("cp_cancel")}</button><button type="button" class="btn p sm" data-cpp-send>${I("ok")}${H.t("cp_prop_send")}</button></div></div>`; };
    const paneHtml = () => { const k = S.focus, c = src(k); if (!c) return "";
      const s = S.sel[k], dis = inPlan(k), why = !edit && sugAll.find(x => x.key === k);
      const head = `<div class="cp-xH"><b>${E(c.name)}</b><span class="tag">${E(c.group)}</span>${c.empty ? `<span class="tag w">${H.t("cp_pending")}</span>` : ""}
          <span class="r">${!s && !dis ? `<button type="button" class="btn p sm" data-cpn-take>${I("plus")}${H.t("cp_take")}</button>` : ""}</span></div>
        ${dis ? `<div class="cp-hint" style="margin:0">${H.t("cp_hint_inplan")}</div>` : !s ? `<div class="cp-hint" style="margin:0">${H.t("cp_hint_pick")}</div>` : ""}
        ${why ? `<div class="cp-hint" style="margin:0">${I("zap")} ${H.t("cp_sys_sug")}: ${why.why.map(w => E(txt(w))).join(" · ")}</div>` : ""}
        ${edit && o.plan.cv < CC.version ? `<div class="cp-hint" style="margin:0">${E(tpl("cp_edit_oldv_tpl", { v:o.plan.cv }))}</div>` : ""}`;
      const noteBox = `<div class="fld col cp-xN" style="margin:8px 4px 0"><label>${H.t("cp_free_note")}</label><textarea data-cpn-note maxlength="600" placeholder="${E(H.t("cp_free_note_ph"))}"${dis ? " disabled" : ""}>${E(s ? s.note : "")}</textarea></div>`;
      if (c.empty) return head + `<div class="cp-pend"><b>${H.t("cp_pending_msg")}</b>${H.t("cp_pending_sub")}</div>${noteBox}${propHtml()}`;
      const auto = s ? s.auto || {} : {};
      const vC = visIdx(c, "c"), vG = visIdx(c, "g"), vA = visIdx(c, "a");
      const causes = vC.map(i => { const t = c.causes[i], ev = s ? auto[i] : (rowIn(c, "c", i) ? causeEv(p, t) : null);
        return chkRow("c", i, E(t) + othTag(c, "c", i), s && s.c.has(i), dis, ev ? `<span class="cp-src">${I("link")}${E(ev)}</span>` : ""); }).join("");
      const goals = vG.map(i => chkRow("g", i, E(c.goals[i]) + othTag(c, "g", i), s && s.g.has(i), dis)).join("");
      const acts = vA.map(i => { const a = c.acts[i], on = !!(s && s.a.has(i)), fq = s ? s.f[i] : a.f;
        return chkRow("a", i, E(a.t) + (a.l ? ` <span class="tag">${I("link")}${E(LINK_NAME(a.l))}</span>` : "") + othTag(c, "a", i), on, dis,
          `<span class="cp-fq"><select data-cpn-fq="${i}" aria-label="${E(H.t("cp_freq_lbl"))}"${on && !dis ? "" : " disabled"}>${FREQS.map(f => `<option value="${f}"${fq === f ? " selected" : ""}>${E(freqName(f))}</option>`).join("")}</select></span>`); }).join("");
      const opt = c.opt ? `<div class="cp-xS">${E(c.opt.l)}</div><div class="opts" style="margin:0 4px">${c.opt.v.map(v => `<i data-cpn-opt="${E(v)}" class="${s && s.opt === v ? "on" : ""}">${E(v)}</i>`).join("")}</div>` : "";
      const none = `<div class="mute" style="padding:4px 6px;font-size:12.5px">—</div>`;
      const hidN = SC && !S.other ? (c.causes.length + c.goals.length + c.acts.length) - (vC.length + vG.length + vA.length) : 0;
      return head + `<div class="cp-xP"><div>${opt}
          ${secH(H.t("cp_h_causes"), "c", s && s.c, vC, dis)}${Object.keys(auto).length || (!s && vC.some(i => causeEv(p, c.causes[i]))) ? `<div class="cp-hint" style="margin:0 4px 4px">${H.t("cp_auto_hint")}</div>` : ""}${causes || none}
          ${secH(H.t("cp_h_goals"), "g", s && s.g, vG, dis)}${goals || none}
          ${c.pending && !c.empty ? `<div class="cp-hint" style="margin:6px 4px 0">${H.t("cp_pending_msg")}</div>` : ""}
          ${hidN ? `<div class="cp-hint" style="margin:8px 4px 0">${E(tpl("cp_rows_hidden_tpl", { n:hidN, u:scopeName(SC) }))}</div>` : ""}</div>
        <div>${secH(H.t("cp_acts_full"), "a", s && s.a, vA, dis)}${acts || none}
          ${edit ? "" : `<div class="cp-hint" style="margin:8px 4px 0">${H.t("cp_hint_std")}</div>`}${noteBox}${propHtml()}</div></div>`; };

    /* --- alt çubuk --- */
    const dryPlan = (k) => { const s = S.sel[k]; return { id:"~" + k, key:k, snap:src(k), acts:[...s.a], freq:s.f }; };
    const barHtml = () => { const ks = Object.keys(S.sel); let a = 0, t = 0;
      ks.forEach(k => { a += S.sel[k].a.size; t += planTasks(p, dryPlan(k), true); });
      return tpl("cp_bar_tpl", { d:ks.length, a, t, tasks:E(H.t("m_tasks")) }); };

    const body = `<div class="cp-nd">
      ${edit ? "" : `<div class="cp-ndTop">
          <label>${H.t("cp_start")} <input type="date" data-cpn-date value="${S.date}" max="2026-09-24"></label>
          <div class="seg" data-cpn-sh><button type="button" data-v="D" class="${S.sh === "D" ? "on" : ""}">08–20</button><button type="button" data-v="N" class="${S.sh === "N" ? "on" : ""}">20–08</button></div>
          <span class="cp-cat" style="margin-left:auto">${tpl("cp_cat_v_tpl", { label:`<b>${E(H.t("cp_cat_label"))}</b>`, v:CC.version, n:CAT.length })}${AN("cp_adm_cat")}</span></div>`}
      ${S.restored ? `<div class="note i">${E(tpl("cp_draft_restored_tpl", S.restored))}</div>` : ""}
      <div class="cp-x"${edit ? ' style="grid-template-columns:1fr"' : ""}>
        ${edit ? "" : `<div class="cp-xL"><div class="cp-srch">${I("search")}<input data-cpn-q placeholder="${E(H.t("cp_search_ph"))}"></div><div class="cp-xLs" data-cpn-list></div></div>`}
        <div class="cp-xR"><div class="cp-tabs" data-cpn-tabs></div><div data-cpn-pane style="display:grid;gap:8px;min-width:0"></div></div></div>
      ${edit ? `<div class="cp-cat">${H.t("cp_edit_note")}</div>` : ""}</div>`;
    const m = H.modal({ title:edit ? E(tpl("cp_m_edit_tpl", { n:o.plan.snap.name })) : E(tpl("cp_m_new_tpl", { b:bedNo(p) })), wide:true, body,
      actions:`<span class="cp-bar" data-cpn-bar></span><button class="btn g" data-cpn-x="c">${H.t("cp_cancel")}</button>${edit ? "" : `<button class="btn" data-cpn-x="d">${I("clock")}${H.t("cp_keep_draft")}</button>`}<button class="btn p" data-cpn-x="s">${I("lock")}${H.t("cp_seal")}</button>` });
    m.classList.add("cp-xl");
    const Q = (s) => m.querySelector(s);
    const draw = (what) => {
      const w = (x) => !what || what.includes(x);
      if (!edit && w("l")) { const L = Q("[data-cpn-list]"), st = L.scrollTop; L.innerHTML = listHtml(); L.scrollTop = st; }
      if (w("t")) Q("[data-cpn-tabs]").innerHTML = tabsHtml();
      if (w("p")) { const P = Q("[data-cpn-pane]"), cols = [...P.querySelectorAll(".cp-xP>div")].map(x => x.scrollTop), same = P.dataset.k === S.focus;
        P.innerHTML = paneHtml(); P.dataset.k = S.focus || ""; if (same) P.querySelectorAll(".cp-xP>div").forEach((x, i) => { x.scrollTop = cols[i] || 0; }); }
      if (w("b")) { Q("[data-cpn-bar]").innerHTML = barHtml(); const sb = Q("[data-cpn-x='s']"), db = Q("[data-cpn-x='d']"), n = Object.keys(S.sel).length;
        if (sb) sb.disabled = !n; if (db) db.disabled = !n; }
    };
    draw();

    m.onclick = (e) => {
      const T = e.target;
      if (T.matches("input,select,textarea,option")) return;                 // onay kutuları / seçimler onchange'de işlenir
      const x = T.closest("[data-cpn-x]"); if (x) { const k = x.dataset.cpnX; if (k === "c") { H.closeModal(); return; } if (k === "d") { keepDraft(); return; } seal(); return; }
      const rm = T.closest("[data-cpn-rm]"); if (rm) { unpick(rm.dataset.cpnRm); if (!S.sel[S.focus] && S.tabs.length) S.focus = S.tabs[S.tabs.length - 1]; draw(); return; }
      const tb = T.closest("[data-cpn-tab]"); if (tb) { S.focus = tb.dataset.cpnTab; draw("ltp"); return; }
      const f = T.closest("[data-cpn-f]"); if (f && !T.closest("label")) { S.focus = f.dataset.cpnF; draw("ltp"); return; }
      if (T.closest("[data-cpn-take]")) { ensure(); draw(); return; }
      const op = T.closest("[data-cpn-opt]"); if (op && !inPlan(S.focus)) { ensure().opt = op.dataset.cpnOpt; draw("ltp"); return; }
      const sh = T.closest("[data-cpn-sh] button"); if (sh) { S.sh = sh.dataset.v; m.querySelectorAll("[data-cpn-sh] button").forEach(b => b.classList.toggle("on", b === sh)); return; }
      const al = T.closest("[data-cpn-all]"); if (al && !inPlan(S.focus)) { const kind = al.dataset.cpnAll, c = src(S.focus), s = ensure(), vis = visIdx(c, kind);
        const allOn = vis.every(i => s[kind].has(i)); vis.forEach(i => allOn ? s[kind].delete(i) : s[kind].add(i)); draw(); return; }
      if (T.closest("[data-cpp-open]")) { S.prop = { kind:"acts", t:"", f:"shift" }; draw("p"); const i = m.querySelector("[data-cpp-t]"); if (i) i.focus(); return; }
      if (T.closest("[data-cpp-x]")) { S.prop = null; draw("p"); return; }
      if (T.closest("[data-cpp-send]")) { const t = (S.prop.t || "").trim(); if (!t) { H.toast(H.t("cp_prop_empty"), "w"); return; }
        const c = src(S.focus), pr = CC.propose({ key:S.focus, kind:S.prop.kind, t, f:S.prop.kind === "acts" ? S.prop.f : null, sc:SC, by:(H.state.user || {}).u || "—" });
        H.log("Bakım kataloğu: birim için madde önerildi", `${scopeName(SC)} · ${c.name} · ${t}`);
        S.prop = null; draw("p"); H.toast(H.t("cp_prop_sent")); return pr; }
    };
    m.onchange = (e) => {
      const T = e.target;
      if (T.matches("[data-cpn-other]")) { S.other = T.checked; draw("lp"); return; }
      if (T.matches("[data-cpp-kind]")) { S.prop.kind = T.value; draw("p"); return; }
      if (T.matches("[data-cpp-f]")) { S.prop.f = T.value; return; }
      if (T.matches("[data-cpn-chk]")) { const k = T.dataset.cpnChk; if (T.checked) { pick(k); S.focus = k; } else { unpick(k); S.focus = k; } draw(); return; }
      if (T.matches("[data-cpn-date]")) { S.date = T.value; return; }
      if (T.matches("[data-cpn-fq]")) { ensure().f[+T.dataset.cpnFq] = T.value; draw("b"); return; }
      const kind = T.matches("[data-cpn-c]") ? "c" : T.matches("[data-cpn-g]") ? "g" : T.matches("[data-cpn-a]") ? "a" : null;
      if (kind) { const i = +T.dataset["cpn" + kind.toUpperCase()]; const had = !!S.sel[S.focus], s = ensure();
        if (had || kind !== "c" || T.checked) T.checked ? s[kind].add(i) : s[kind].delete(i); draw(had ? "tpb" : ""); }
    };
    m.oninput = (e) => {
      if (e.target.matches("[data-cpn-q]")) { S.q = e.target.value; draw("l"); return; }
      if (e.target.matches("[data-cpp-t]")) { S.prop.t = e.target.value; return; }
      if (e.target.matches("[data-cpn-note]")) { const had = !!S.sel[S.focus]; ensure().note = e.target.value; if (!had) draw("ltb"); }
    };

    const ser = () => Object.fromEntries(Object.entries(S.sel).map(([k, s]) => [k, { c:[...s.c], g:[...s.g], a:[...s.a], f:s.f, opt:s.opt, note:s.note, auto:s.auto }]));
    function keepDraft() {
      const ks = Object.keys(S.sel); if (!ks.length) { H.toast(H.t("cp_toast_pick_one"), "w"); return; }
      DRAFTS[p.id] = { sel:ser(), tabs:S.tabs.slice(), focus:S.focus, date:S.date, sh:S.sh, by:me(), at:stamp() };
      H.log("Bakım planı taslağı saklandı", `${bedNo(p)} · ${ks.map(k => CAT_BY[k].name).join(", ")}`);
      H.closeModal(); H.toast(H.t("cp_toast_draft_saved")); rerender();
    }
    const sorted = (set) => [...set].sort((a, b) => a - b);
    function seal() {
      const keys = Object.keys(S.sel);
      if (!keys.length) { H.toast(H.t("cp_toast_pick_one"), "w"); return; }
      const bad = keys.filter(k => { const c = src(k), s = S.sel[k]; return !c.pending && (!s.g.size || !s.a.size); });
      if (bad.length) { S.focus = bad[0]; draw(); H.toast(tpl("cp_toast_need_ga_tpl", { n:src(bad[0]).name }), "e"); return; }
      if (edit) {
        const pl = o.plan, c = pl.snap, s = S.sel[pl.key], d = [], dl = [];    // d: ekranda (dile göre), dl: denetim kaydı (Türkçe)
        const diff = (old, now, kind, name) => { const add = [...now].filter(i => !old.includes(i)).length, rem = old.filter(i => !now.has(i)).length;
          if (add) { d.push(() => tpl(`cp_d_${kind}_tpl`, { x:`+${add}` })); dl.push(`+${add} ${name}`); }
          if (rem) { d.push(() => tpl(`cp_d_${kind}_tpl`, { x:`−${rem}` })); dl.push(`−${rem} ${name}`); } };
        diff(pl.causes, s.c, "c", "neden"); diff(pl.goals, s.g, "g", "hedef"); diff(pl.acts, s.a, "a", "faaliyet");
        if ((pl.opt || null) !== (s.opt || null)) { const ol = c.opt ? c.opt.l : null, ch = `${pl.opt || "—"} → ${s.opt || "—"}`;
          d.push(() => `${ol || H.t("cp_d_opt")}: ${ch}`); dl.push(`${ol || "seçenek"}: ${ch}`); }
        const fch = [...s.a].filter(i => (pl.freq || {})[i] !== s.f[i]).length;
        if (fch) { d.push(() => `${H.t("cp_freq_lbl")}: ${fch}`); dl.push(`sıklık: ${fch}`); }
        if ((pl.note || "") !== (s.note || "").trim()) { d.push(() => H.t("cp_free_note")); dl.push("serbest not"); }
        if (!d.length) { H.closeModal(); return; }
        pl.causes = sorted(s.c); pl.goals = sorted(s.g); pl.acts = sorted(s.a); pl.opt = s.opt; pl.freq = Object.assign({}, s.f); pl.note = (s.note || "").trim();
        pl.auto = Object.fromEntries(Object.entries(s.auto || {}).filter(([i]) => s.c.has(+i)));
        dropTasks(pl); const n = planTasks(p, pl);
        pl.hist.push({ at:stamp(), by:me(), what:() => H.t("cp_h_edited"), sub:() => d.map(txt).join(" · ") });
        H.log("Bakım planı düzenlendi · mühürlendi", `${bedNo(p)} · ${c.name} · ${dl.join(", ")} · ${n} iş`);
        H.closeModal(); H.toast(tpl("cp_toast_sealed_edit_tpl", { t:n })); rerender(); return;
      }
      if (S.date > "2026-09-24") { H.toast(H.t("cp_toast_future"), "e"); return; }
      const di = DAYS.findIndex(x => x[2] === S.date);
      const idx = di < 0 ? SH.length - 1 : Math.max(0, di * 2 + (S.sh === "N" ? 0 : 1));
      const [yy, mm, dd] = S.date.split("-");
      const list = plansOf(p.id); let n = 0;
      keys.forEach(k => {
        const s = S.sel[k], why = sugAll.find(x => x.key === k);
        const pl = mkPlan(k, idx, stamp(), me(), { c:sorted(s.c), g:sorted(s.g), a:sorted(s.a), opt:s.opt, f:s.f, note:(s.note || "").trim(),
          auto:Object.fromEntries(Object.entries(s.auto || {}).filter(([i]) => s.c.has(+i))) });
        pl.start.label = di < 0 ? `${dd}.${mm} ${S.sh === "N" ? "20–08" : "08–20"}` : SH_LABEL(idx);
        const shTxt = `${dd}.${mm}.${yy} ${S.sh === "N" ? "20–08" : "08–20"}`;
        pl.hist[0].sub = () => tpl("cp_h_start_tpl", { s:shTxt }) + (why ? " · " + tpl("cp_h_from_sug_tpl", { why:why.why.map(txt).join("; ") }) : "");
        list.push(pl); n += planTasks(p, pl);
      });
      delete DRAFTS[p.id];
      H.log("Bakım planı mühürlendi", `${bedNo(p)} · ${keys.map(k => CAT_BY[k].name).join(", ")} · katalog v${CC.version} · ${n} iş Görevlerim'e`);
      H.closeModal(); H.toast(tpl("cp_toast_sealed_tpl", { n:keys.length, t:n, tasks:H.t("m_tasks") })); rerender();
    }
  }

  /* ---------------- vardiya değerlendirmesi ---------------- */
  function evalModal(p, pl, si, rerender) {
    const c = cOf(pl), sh = SH[si], ex = pl.evals[sh.k];
    const auto = {}; pl.acts.forEach(ai => { const r = autoDone(p, c.acts[ai].l, si, pl.id, ai); if (r) auto[ai] = r; });
    const S = { acts:new Set(ex ? ex.acts : Object.keys(auto).map(Number)), goal:ex ? ex.goal : null };
    const lateNew = si > 0 && !ex;
    const body = `<div class="cp-ev">
      <div class="cp-evh"><div><b>${E(c.name)}</b>${pl.opt ? ` <span class="tag">${E(pl.opt)}</span>` : ""}<div class="mute" style="font-size:12px">${E(p.name)} · ${E(bedNo(p))}</div></div><span class="r mono">${E(H.wd(sh.off))} ${E(sh.d)} · ${E(sh.n)}${si === 0 ? " · " + H.t("cp_now") : ""}</span></div>
      ${lateNew ? `<div class="note">${tpl("cp_late_note_tpl", { t:E(stamp()) })}</div>` : ""}
      ${ex ? `<div class="note i">${E(tpl("cp_ex_note_tpl", { by:ex.by, at:ex.at }))}</div>` : ""}
      <div class="box"><h5>${H.t("cp_h_goals")}</h5>${pl.goals.length ? `<ul class="cp-goals">${pl.goals.map(i => `<li>${E(c.goals[i])}</li>`).join("")}</ul>` : `<div class="mute" style="font-size:12.5px">${c.pending ? H.t("cp_no_goals_pending") : H.t("cp_not_selected")}${pl.note ? ` · ${E(pl.note)}` : ""}</div>`}</div>
      <div class="box"><h5>${H.t("cp_acts_done")} <span class="r mute">${Object.keys(auto).length ? H.t("cp_check_auto") : ""}</span></h5>
        ${pl.acts.map(ai => `<label class="cp-ck2"><input type="checkbox" data-cpe-a="${ai}" ${S.acts.has(ai) ? "checked" : ""}><span>${E(c.acts[ai].t)}${auto[ai] ? ` <span class="tag">${I("ok")}${H.t("cp_from_rec")}: ${E(c.acts[ai].l ? LINK_NAME(c.acts[ai].l) : H.t("m_tasks"))} ${E(auto[ai])}</span>` : ""}</span></label>`).join("")}</div>
      <div class="box"><h5>${H.t("cp_goal_status")} <span class="r mute">${H.t("cp_nurse_eval")}</span></h5>
        <div class="opts cp-gopt">${Object.keys(GOAL_K).map(k => `<i data-cpe-g="${k}" class="${S.goal === k ? "on" : ""}">${GOAL[k][0]}</i>`).join("")}</div>
        <div class="fld col" style="margin:10px 0 0"><label>${H.t("cp_short_note")}</label><textarea data-cpe-note maxlength="400" placeholder="${E(H.t("cp_note_ph"))}">${E(ex ? ex.note : "")}</textarea></div></div></div>`;
    const m = H.modal({ title:H.t("cp_m_eval"), body, actions:`<button class="btn g" data-cpe-x="c">${H.t("cp_cancel")}</button><button class="btn p" data-cpe-x="s">${I("ok")}${H.t("cp_keep_draft")}</button>` });
    m.onclick = (e) => {
      const T = e.target;
      const g = T.closest("[data-cpe-g]"); if (g) { S.goal = g.dataset.cpeG; m.querySelectorAll("[data-cpe-g]").forEach(x => x.classList.toggle("on", x === g)); return; }
      const x = T.closest("[data-cpe-x]"); if (!x) return;
      if (x.dataset.cpeX === "c") { H.closeModal(); return; }
      if (!S.goal) { H.toast(H.t("cp_toast_pick_goal"), "e"); return; }
      m.querySelectorAll("[data-cpe-a]").forEach(i => { i.checked ? S.acts.add(+i.dataset.cpeA) : S.acts.delete(+i.dataset.cpeA); });
      const note = m.querySelector("[data-cpe-note]").value.trim();
      if (ex) { const shL = SH_LABEL(si), old = Object.assign({}, ex);
        pl.hist.push({ at:stamp(), by:me(), what:() => tpl("cp_h_eval_changed_tpl", { s:shL }), sub:() => tpl("cp_h_prev_tpl", { x:`${GOAL[old.goal][0]} · ${old.by} ${old.at}${old.note ? " · “" + old.note + "”" : ""}` }) }); }
      pl.evals[sh.k] = { goal:S.goal, acts:pl.acts.filter(a => S.acts.has(a)), note, by:me(), at:stamp(), late:ex ? ex.late : lateNew };
      H.log("Bakım planı değerlendirmesi", `${bedNo(p)} · ${c.name} · ${SH_LABEL(si)} · ${({ met:"Karşılandı", partial:"Kısmen karşılandı", unmet:"Karşılanmadı" })[S.goal]}${lateNew ? " · geç giriş" : ""}`);
      H.closeModal(); H.toast(lateNew ? H.t("cp_toast_late_saved") : H.t("cp_toast_eval_saved")); rerender();
    };
  }

  /* ---------------- sonlandır ---------------- */
  function endModal(p, pl, rerender) {
    const c = cOf(pl); let reason = null;
    const m = H.modal({ title:E(tpl("cp_m_end_tpl", { n:c.name })),
      body:`<div class="fld col"><label>${H.t("cp_end_reason")}</label><div class="opts">${END_REASONS.map(r => `<i data-cps-r="${E(r)}">${E(endReason(r))}</i>`).join("")}</div></div>
        <div class="fld col"><label>${H.t("cp_note_opt")}</label><textarea data-cps-note maxlength="300"></textarea></div>
        ${!pl.evals[SH[0].k] ? `<div class="note">${H.t("cp_end_noeval")}</div>` : ""}
        <div class="mute" style="font-size:12px;margin-top:8px">${E(H.t("cp_end_keep"))}</div>`,
      actions:`<button class="btn g" data-cps-x="c">${H.t("cp_cancel")}</button><button class="btn d" data-cps-x="s">${H.t("cp_t_end")}</button>` });
    m.onclick = (e) => {
      const T = e.target, r = T.closest("[data-cps-r]");
      if (r) { reason = r.dataset.cpsR; m.querySelectorAll("[data-cps-r]").forEach(x => x.classList.toggle("on", x === r)); return; }
      const x = T.closest("[data-cps-x]"); if (!x) return;
      if (x.dataset.cpsX === "c") { H.closeModal(); return; }
      if (!reason) { H.toast(H.t("cp_toast_pick_reason"), "e"); return; }
      const note = m.querySelector("[data-cps-note]").value.trim();
      pl.status = "ended"; pl.end = { reason, note, by:me(), at:stamp() }; dropTasks(pl);
      pl.hist.push({ at:stamp(), by:me(), what:() => tpl("cp_h_ended_tpl", { r:endReason(reason) }), sub:note });
      ui(p.id).open.delete(pl.id);
      H.log("Bakım planı tanısı sonlandırıldı", `${bedNo(p)} · ${c.name} · ${({ goal:"Hedefe ulaşıldı", disch:"Taburcu / transfer", invalid:"Tanı geçersiz (hatalı giriş)" })[reason] || reason}`);
      H.closeModal(); H.toast(H.t("cp_toast_ended")); rerender();
    };
  }

  /* ---------------- tarihçe ---------------- */
  function histModal(p, pl) {
    const c = cOf(pl);
    const ev = SH.map((s, i) => [s, i, pl.evals[s.k]]).filter(x => x[2]);
    H.modal({ title:E(tpl("cp_m_hist_tpl", { n:c.name })),
      body:`<div class="box"><h5>${H.t("cp_plan_changes")}</h5><div class="cp-hist">${pl.hist.slice().reverse().map(h => { const sub = txt(h.sub); return `<div><time>${E(h.at)}</time><span><b>${E(txt(h.what))}</b> · ${E(h.by)}${sub ? `<small>${E(sub)}</small>` : ""}</span></div>`; }).join("")}</div></div>
        <div class="box" style="margin-top:12px"><h5>${H.t("cp_shift_evals")} <span class="r mute">${tpl("cp_n_records_tpl", { n:ev.length })}</span></h5>
        ${ev.length ? `<div class="cp-hist">${ev.map(([s, i, e]) => `<div><time>${E(s.d)} ${E(s.n)}</time><span><span class="cp-ck" style="--c:${GOAL[e.goal][1]};width:20px;height:20px;font-size:11px">${GOAL[e.goal][2]}</span> <b>${E(GOAL[e.goal][0])}</b> · ${tpl("cp_acts_ratio_tpl", { a:e.acts.length, b:pl.acts.length })} · ${E(e.by)} ${E(e.at)}${e.late ? " · " + H.t("cp_late") : ""}${e.note ? `<small>“${E(e.note)}”</small>` : ""}</span></div>`).join("")}</div>` : `<div class="mute">${H.t("cp_no_evals")}</div>`}</div>`,
      actions:`<button class="btn" data-x>${H.t("cp_close")}</button>` });
  }

  H.carePlan = { html:planHtml, after:planAfter, summary, suggestions, plans:(pid) => plansOf(pid) };
  seed();                             // Görevlerim, bakım planı sekmesi açılmadan da plan işlerini görsün

  /* ====================================================================================================
   * SIVI İZLEM IZGARASI — patient.js'teki "Sıvı" sekmesinin altına eklenir.
   * Nöbet günü 08:00'de başlar (24.09 08:00 → 25.09 08:00). Şu an 21:42 → 21:00 sütunu "şimdi", sonrası ileri saat.
   * Değerler SENTETİK; patient.js'in ioOf formülüyle (risk/yaş/kiloya göre saatlik aldığı, hastaya özel idrar) kabaca tutarlı
   * kendi deterministik üretimimizdir (ioOf patient.js'e özel, erişilemez).
   * İrigasyon verilen/gelen ayrı satırlardır; toplam aldığı–çıkardığına ve idrara KATILMAZ, kendi balansı vardır.
   * ==================================================================================================== */
  const NOW_H = +String(H.now()).split(":")[0], NOW_M = +String(H.now()).split(":")[1];
  const NOWI = ((NOW_H - 8) % 24 + 24) % 24;                  // 21:42 → 13
  const HL = (i) => String((8 + i) % 24).padStart(2, "0");
  const IO = [
    { k:"oral", s:"in", n:"Oral" },
    { k:"tpn", s:"in", g:"Parenteral", n:"Parenteral beslenme", pump:1 },
    { k:"iv", s:"in", g:"Parenteral", n:"IV sıvı / infüzyon", pump:1 },
    { k:"pcai", s:"in", g:"Parenteral", n:"PCA infüzyon", pump:1 },
    { k:"pcab", s:"in", g:"Parenteral", n:"PCA bolus", pump:1 },
    { k:"peg", s:"in", g:"Enteral", n:"PEG / PEJ" },
    { k:"ngin", s:"in", g:"Enteral", n:"NG / OG" },
    { k:"blood", s:"in", n:"Kan ürünleri" },
    { k:"pd", s:"in", n:"Periton diyalizi" },
    { k:"irrin", s:"in", n:"İrigasyon (verilen)", irr:1 },
    { k:"inoth", s:"in", n:"Diğer" },
    { k:"uri", s:"out", g:"İdrar", n:"Spontan / Foley", urine:1 },
    { k:"nefro", s:"out", g:"İdrar", n:"Nefrostomi", urine:1 },
    { k:"uro", s:"out", g:"İdrar", n:"Ürostomi", urine:1 },
    { k:"sisto", s:"out", g:"İdrar", n:"Sistostomi", urine:1 },
    { k:"dr1", s:"out", n:"Dren 1" },
    { k:"dr2", s:"out", n:"Dren 2" },
    { k:"kusma", s:"out", n:"Kusma" },
    { k:"gaita", s:"out", n:"Gaita" },
    { k:"ngd", s:"out", n:"NG drenajı" },
    { k:"kan", s:"out", n:"Kan kaybı (ölçülen)" },
    { k:"irrout", s:"out", n:"İrigasyon (gelen)", irr:1 },
    { k:"outoth", s:"out", n:"Diğer" },
  ];
  const ROW = {}; IO.forEach(r => { ROW[r.k] = r; });
  // r.n / r.g Türkçe kimliktir (denetim kaydında aynen kalır); ekranda satır ve grup adı H.t ile çizilir.
  const NEO_ROWS = { oral:"Oral (anne sütü / mama)", ngin:"OG / NG beslenme", uri:"İdrar (bez tartısı)" };
  const rowNameTR = (p, r) => p.ageGroup === "neonate" ? (NEO_ROWS[r.k] || r.n) : r.n;
  const rowName = (p, r) => H.t(p.ageGroup === "neonate" && NEO_ROWS[r.k] ? "cp_io_neo_" + r.k : "cp_io_" + r.k);
  const GRP_K = { "Parenteral":"cp_io_g_par", "Enteral":"cp_io_g_ent", "İdrar":"cp_io_g_uri" };
  const grpName = (g) => GRP_K[g] ? H.t(GRP_K[g]) : g;
  const SRC_K = { elle:"cp_src_elle", pompa:"cp_src_pompa", "tartı":"cp_src_tarti" };
  const srcName = (s) => SRC_K[s] ? H.t(SRC_K[s]) : s;
  const USE = { p1:["iv", "ngin", "uri", "ngd"], p3:["oral", "iv", "irrin", "irrout", "uri"], p4:["oral", "iv", "pcai", "pcab", "uri", "dr1", "dr2", "ngd"],
    p10:["oral", "iv", "pcai", "pcab", "uri", "dr1"], p12:["oral", "iv", "uri", "kusma", "gaita"], p13:["iv", "tpn", "ngin", "uri"], p14:["oral", "iv", "uri"],
    p15:["iv", "ngin", "uri"], p16:["oral", "iv", "blood", "uri", "dr1", "dr2"], p19:["oral", "iv", "tpn", "blood", "uri"] };
  const usedKeys = (p) => USE[p.id] || (p.ageGroup === "neonate" ? ["ngin", "iv", "uri"] : ["oral", "iv", "uri"]);
  H.data.ioGrid = H.data.ioGrid || {};
  const FST = {};                                             // pid → { view, all }
  const fst = (pid) => FST[pid] || (FST[pid] = { view:1, all:false });
  const neoOf = (p) => p.ageGroup === "neonate";
  const rdOf = (p) => neoOf(p) ? (v) => Math.round(v * 10) / 10 : (v) => Math.round(v);
  const r5 = (v) => Math.max(5, Math.round(v / 5) * 5);
  const fmtOf = (p) => (v) => v == null ? "" : neoOf(p) ? String(Math.round(v * 10) / 10).replace(".", DEC()) : Math.round(v).toLocaleString(LOC());

  function ioSeed(p) {
    if (H.data.ioGrid[p.id]) return H.data.ioGrid[p.id];
    const r = seeded(seedOf(p.id + "grid")), kg = p.weight || 70, neo = neoOf(p), use = new Set(usedKeys(p)), rd = rdOf(p);
    const inBase = neo ? 6 * kg : p.ageGroup === "child" ? 3.5 * kg : ({ crit:125, high:95, mid:85 }[p.risk] || 75);
    const uo = ({ p1:0.35, p3:0.3, p7:1.6, p13:2.2 }[p.id]) || (neo ? 3 : p.risk === "crit" ? 0.4 : 0.9);
    // by:null → ekranda "Gece hemşiresi" (dile göre) · pompa girişlerinde ekranda "İnfüzyon pompası" (dile göre) çizilir
    const D = {}, nurse = (i) => i < 12 ? dayNurse : ((H.userBy(p.nurse) || {}).name || null);
    const add = (k, i, ml, src, extra) => { if (!(ml > 0)) return; ((D[k] = D[k] || {})[i] = D[k][i] || []).push(Object.assign({ ml, src, by:src === "pompa" ? "İnfüzyon pompası" : nurse(i), at:`${HL(i)}:${src === "pompa" ? "59" : String(10 + Math.floor(r() * 40)).padStart(2, "0")}` }, extra || {})); };
    const hasEnt = use.has("oral") || use.has("ngin");
    const pumpTot = inBase * (hasEnt ? 0.72 : 0.95);
    const ivRate = use.has("tpn") ? pumpTot * 0.55 : pumpTot, tpnRate = use.has("tpn") ? pumpTot * 0.45 : 0;
    for (let i = 0; i <= NOWI; i++) {
      const frac = i === NOWI ? NOW_M / 60 : 1, now = i === NOWI ? { at:`${HL(i)}:${String(NOW_M).padStart(2, "0")}`, live:true } : null;
      if (use.has("iv")) add("iv", i, rd(ivRate * (i < 6 ? 1 : 1.08) * (0.97 + r() * 0.06) * frac), "pompa", now);
      if (use.has("tpn")) add("tpn", i, rd(tpnRate * frac), "pompa", now);
      if (use.has("pcai")) add("pcai", i, rd(4 * frac), "pompa", now);
      if (use.has("pcab")) { const b = Math.floor(r() * 3); if (b && i < NOWI) add("pcab", i, b, "pompa"); }
    }
    if (p.id === "p1") add("iv", 11, 500, "pompa", { note:() => H.t("cp_io_n_bolus") });
    const entInt = neo ? 3 : 4;
    for (let i = neo ? 1 : 0; i <= NOWI; i += entInt) {
      const amt = inBase * entInt * (hasEnt ? 0.28 : 0) * (0.85 + r() * 0.3);
      if (use.has("oral")) add("oral", i, neo ? rd(amt) : r5(amt), "elle");
      else if (use.has("ngin")) add("ngin", i, neo ? rd(amt) : r5(amt), "elle");
    }
    if (use.has("uri")) {
      if (neo) for (let i = 2; i < NOWI; i += 3) add("uri", i, rd(uo * kg * 3 * (0.8 + r() * 0.4)), "tartı");
      else if (p.monitored) for (let i = 0; i < NOWI; i++) { if (p.id === "p2" && i === 7) continue; add("uri", i, r5(uo * kg * (0.7 + r() * 0.6) * (p.id === "p1" && i >= 10 ? 0.6 : 1))); }
      else [1, 5, 9, 12].forEach((i, j) => { if (i < NOWI) add("uri", i, r5(uo * kg * (j ? 4 : 2) * (0.8 + r() * 0.4) + (p.id === "p7" && i === 5 ? 180 : 0)), "elle"); });
    }
    const every4 = (k, lo, hi) => [3, 7, 11].forEach(i => add(k, i, r5(lo + r() * (hi - lo)), "elle"));
    if (use.has("dr1")) every4("dr1", p.id === "p10" ? 10 : p.id === "p16" ? 40 : 30, p.id === "p10" ? 25 : p.id === "p16" ? 80 : 60);
    if (use.has("dr2")) every4("dr2", 20, 45);
    if (use.has("ngd")) every4("ngd", p.id === "p4" ? 80 : 50, p.id === "p4" ? 150 : 120);
    if (use.has("kusma")) [2, 6].forEach(i => add("kusma", i, r5(60 + r() * 60), "elle"));
    if (use.has("gaita")) [3, 9, 11].forEach(i => add("gaita", i, r5(80 + r() * 70), "elle"));
    if (use.has("blood")) add("blood", p.id === "p16" ? 2 : 6, p.id === "p16" ? 300 : 250, "elle", { note:() => H.t("cp_io_n_blood") });
    if (use.has("irrin")) for (let i = 0; i < NOWI; i++) { add("irrin", i, 250, "elle"); add("irrout", i, r5(240 + r() * 30), "elle"); }
    // pompa satırında elle düzeltme örneği (uyarıda görünür)
    if (p.id === "p2" && D.iv && D.iv[9]) D.iv[9].push({ ml:-20, src:"elle", by:dayNurse, at:"17:35", note:() => H.t("cp_io_n_line") });
    return (H.data.ioGrid[p.id] = D);
  }
  const cellSum = (D, k, from, to) => { let s = 0, any = false; for (let i = from; i < to; i++) (D[k] && D[k][i] || []).forEach(e => { s += e.ml; any = true; }); return any ? s : null; };

  function gridInner(p) {
    const D = ioSeed(p), F = fst(p.id), b = F.view, nC = 24 / b, fmt = fmtOf(p), neo = neoOf(p);
    const used = new Set([...usedKeys(p), ...Object.keys(D)]);
    const rows = IO.filter(r => F.all || used.has(r.k));
    const cols = Array.from({ length:nC }, (_, c) => ({ from:c * b, to:c * b + b }));
    const colState = (c) => c.from > NOWI ? "fut" : (c.to > NOWI ? "now" : "past");
    const colLbl = (c) => b === 24 ? H.t("cp_io_24h") : b === 1 ? HL(c.from) : `${HL(c.from)}–${HL(c.to % 24)}`;
    const head = `<thead><tr><th class="h">${b === 1 ? H.t("cp_io_hour") : H.t("cp_io_range")} · mL</th>${cols.map(c => `<th class="${colState(c) === "now" ? "now" : ""}">${colLbl(c)}${colState(c) === "now" ? `<small>${H.t("cp_now")}</small>` : ""}</th>`).join("")}<th>${H.t("cp_io_total")}</th></tr></thead>`;
    const sumRow = (keys, c) => { let s = null; keys.forEach(k => { const v = cellSum(D, k, c.from, Math.min(c.to, NOWI + 1)); if (v != null) s = (s || 0) + v; }); return s; };
    const dayTot = (keys) => sumRow(keys, { from:0, to:24 });

    const gapCells = new Set();
    if (p.monitored && used.has("uri")) for (let i = 0; i < NOWI; i++) if (!(D.uri && D.uri[i])) gapCells.add(i);

    const valRow = (r) => {
      const isPump = r.pump && Object.values(D[r.k] || {}).some(L => L.some(e => e.src === "pompa"));
      const cells = cols.map((c, ci) => {
        const st = colState(c);
        if (st === "fut") return `<td class="fut"></td>`;
        const v = cellSum(D, r.k, c.from, Math.min(c.to, NOWI + 1));
        const L = []; for (let i = c.from; i < Math.min(c.to, NOWI + 1); i++) (D[r.k] && D[r.k][i] || []).forEach(e => L.push(e));
        const pump = L.length && L.every(e => e.src === "pompa"), fix = r.pump && L.some(e => e.src !== "pompa" && !e.form);
        const gap = r.k === "uri" && b === 1 && gapCells.has(c.from);
        return `<td class="c ${pump ? "pump" : ""} ${fix ? "fix" : ""} ${st === "now" ? "now" : ""} ${gap ? "gap" : ""}" data-cpio="${r.k}|${ci}" title="${E(rowName(p, r))} · ${colLbl(c)}${pump ? " · " + E(H.t("cp_io_from_pump")) : ""}${fix ? " · " + E(H.t("cp_io_has_fix")) : ""}${gap ? " · " + E(H.t("cp_io_noentry")) : ""}">${v == null ? "" : fmt(v)}</td>`;
      }).join("");
      const t = dayTot([r.k]);
      return `<tr><th class="h ${r.g ? "in2" : ""}">${E(rowName(p, r))}${isPump ? `<span class="pb">${H.t("cp_io_from_pump")}</span>` : ""}</th>${cells}<td>${t == null ? "" : fmt(t)}</td></tr>`;
    };
    const section = (side, title) => {
      const L = rows.filter(r => r.s === side); if (!L.length) return "";
      let out = `<tr class="sec"><th class="h">${title}</th><td colspan="${nC + 1}"></td></tr>`, lastG = null;
      L.forEach(r => {
        if (r.g && r.g !== lastG) { const gk = L.filter(x => x.g === r.g).map(x => x.k);
          out += `<tr class="grp"><th class="h">${E(grpName(r.g))}</th>${cols.map(c => { const v = colState(c) === "fut" ? null : sumRow(gk, c); return `<td class="${colState(c) === "fut" ? "fut" : ""}">${v == null ? "" : fmt(v)}</td>`; }).join("")}<td>${fmt(dayTot(gk))}</td></tr>`; }
        lastG = r.g || null; out += valRow(r);
      });
      return out;
    };
    const inK = IO.filter(r => r.s === "in" && !r.irr).map(r => r.k), outK = IO.filter(r => r.s === "out" && !r.irr).map(r => r.k);
    let cum = 0;
    const totRow = (lbl, fn, cls = "", signed = false) => `<tr class="tot ${cls}"><th class="h">${lbl}</th>${cols.map(c => { if (colState(c) === "fut") return `<td class="fut"></td>`; const v = fn(c); return `<td class="${signed && v ? (v > 0 ? "pos" : "neg") : ""}">${v == null ? "—" : (signed && v > 0 ? "+" : "") + fmt(v)}</td>`; }).join("")}<td class="${signed ? "" : ""}">${(() => { const v = fn({ from:0, to:24 }, true); return v == null ? "—" : (signed && v > 0 ? "+" : "") + fmt(v); })()}</td></tr>`;
    const tin = (c) => sumRow(inK, c) || 0, tout = (c) => sumRow(outK, c) || 0;
    const hasBlood = used.has("blood") || used.has("kan"), hasIrr = used.has("irrin") || used.has("irrout");
    const kgHrs = (c) => { let h = 0; for (let i = c.from; i < Math.min(c.to, NOWI); i++) h++; return h; };
    const sm = (k) => ` <span class="mute" style="font-weight:500">${H.t(k)}</span>`;
    const totals = totRow(H.t("cp_io_tin"), tin, "b")
      + totRow(H.t("cp_io_tout"), tout)
      + totRow(H.t("cp_io_bal"), c => tin(c) - tout(c), "", true)
      + `<tr class="tot"><th class="h">${H.t("cp_io_cum")}${sm("cp_io_since8")}</th>${cols.map(c => { if (colState(c) === "fut") return `<td class="fut"></td>`; cum += tin(c) - tout(c); return `<td class="${cum > 0 ? "pos" : cum < 0 ? "neg" : ""}">${cum > 0 ? "+" : ""}${fmt(cum)}</td>`; }).join("")}<td></td></tr>`
      + totRow(`${H.t("cp_io_bloodbal")}${hasBlood ? "" : sm("cp_io_norec")}`, c => hasBlood ? (sumRow(["blood"], c) || 0) - (sumRow(["kan"], c) || 0) : null, "", true)
      + totRow(`${H.t("cp_io_irrbal")}${hasIrr ? "" : sm("cp_io_norec")}`, c => hasIrr ? (sumRow(["irrin"], c) || 0) - (sumRow(["irrout"], c) || 0) : null, "", true)
      + (neo ? totRow(`${H.t("cp_io_uokg")}${sm("cp_io_complete_h")}`, c => { const h = kgHrs(c); if (!h) return null; let s = 0; for (let i = c.from; i < c.from + h; i++) (D.uri && D.uri[i] || []).forEach(e => s += e.ml); return Math.round(s / p.weight / h * 10) / 10; }) : "");

    // uyarılar: operasyonel (eksik giriş, pompa düzeltmesi); klinik eşik kullanılmaz
    const warns = [];
    if (gapCells.size) { const g = [...gapCells].map(i => HL(i) + ":00"); warns.push(tpl(g.length > 1 ? "cp_io_w_gapn_tpl" : "cp_io_w_gap1_tpl", { h:g.join(", ") })); }
    if (used.has("uri") && p.monitored && !(D.uri && D.uri[NOWI])) warns.push(tpl("cp_io_w_now_tpl", { h:HL(NOWI) }));
    IO.filter(r => r.pump).forEach(r => { const n = Object.values(D[r.k] || {}).filter(L => L.some(e => e.src !== "pompa" && !e.form)).length; if (n) warns.push(tpl("cp_io_w_fix_tpl", { row:rowName(p, r), n })); });
    const hidden = IO.length - rows.length;

    return `<div class="cp-io-top"><div class="seg" data-cpio-v>${[[1, H.t("cp_io_v1")], [4, tpl("cp_io_vh_tpl", { n:4 })], [8, tpl("cp_io_vh_tpl", { n:8 })], [12, tpl("cp_io_vh_tpl", { n:12 })], [24, H.t("cp_io_v24")]].map(([v, l]) => `<button data-v="${v}" class="${b === v ? "on" : ""}">${l}</button>`).join("")}</div>
        <span class="r"><label><input type="checkbox" data-cpio-all ${F.all ? "checked" : ""}>${H.t("cp_io_showall")}${!F.all && hidden ? ` <span class="mute">${tpl("cp_io_hidden_tpl", { n:hidden })}</span>` : ""}</label></span></div>
      <div class="cp-io-scroll"><table class="cp-io">${head}<tbody>${section("in", H.t("cp_io_in"))}${section("out", H.t("cp_io_out"))}${totals}</tbody></table></div>
      ${warns.length ? `<div class="cp-io-warn">${warns.map(w => `<div class="note">${E(w)}</div>`).join("")}</div>` : ""}
      <div class="cp-io-leg"><span><i style="background:var(--priSoft);box-shadow:inset 0 0 0 1px var(--pri)"></i>${H.t("cp_io_leg_pump")}</span><span><i style="background:var(--card);box-shadow:inset 0 -2px 0 var(--mid)"></i>${H.t("cp_io_leg_fix")}</span><span><i style="background:var(--att);box-shadow:inset 0 0 0 1px var(--attLine)"></i>${H.t("cp_io_leg_gap")}</span><span>${H.t("cp_io_leg_tap")}</span></div>
      <div class="cp-foot">${H.t("cp_io_foot")}${AN("cp_adm_io")}</div>`;
  }

  function gridHtml(p) { return `<div class="box cp-io-root" data-cpio-root="${E(p.id)}"><h5>${I("drop")}${H.t("cp_io_title")} · ${TODAY} 08:00 → 25.09 08:00 <span class="r mute">${H.t("cp_io_dutyday")}</span></h5><div data-cpio-body>${gridInner(p)}</div></div>`; }

  function gridAfter(el, p) {
    const root = el && (el.matches && el.matches(".cp-io-root") ? el : el.querySelector(".cp-io-root"));
    if (!root) return;
    const bodyEl = root.querySelector("[data-cpio-body]");
    const rerender = () => { bodyEl.innerHTML = gridInner(p); };
    root.onclick = (e) => {
      const T = e.target;
      const v = T.closest("[data-cpio-v] button"); if (v) { fst(p.id).view = +v.dataset.v; rerender(); return; }
      const c = T.closest("[data-cpio]"); if (c) { const [k, ci] = c.dataset.cpio.split("|"); const b = fst(p.id).view, from = +ci * b, hours = []; for (let i = from; i < from + b && i <= NOWI; i++) hours.push(i); if (hours.length) ioModal(p, k, hours, rerender); }
    };
    root.onchange = (e) => { if (e.target.matches("[data-cpio-all]")) { fst(p.id).all = e.target.checked; rerender(); } };
  }

  function ioModal(p, k, hours, rerender) {
    const r = ROW[k], D = ioSeed(p), fmt = fmtOf(p), neo = neoOf(p);
    const S = { h:hours[hours.length - 1], src:r.pump ? "pompa" : neo && r.urine ? "tartı" : "elle" };
    const SRC = ["elle", "pompa", "tartı"];
    const lc = (s) => s.toLocaleLowerCase(LOC());
    const byName = (e) => e.src === "pompa" && e.by === "İnfüzyon pompası" ? H.t("cp_io_pump_dev") : (e.by || H.t("cp_io_night_nurse"));
    const entries = () => { const L = (D[k] && D[k][S.h]) || [];
      return L.length ? `<div class="cp-io-ent">${L.map(e => { const nt = txt(e.note); return `<div><time>${E(e.at)}</time><span>${E(srcName(e.src))} · ${E(byName(e))}${e.live ? " · " + E(H.t("cp_io_hour_running")) : ""}${nt ? `<small class="mute" style="display:block">${E(nt)}</small>` : ""}</span><b>${fmt(e.ml)} mL</b></div>`; }).join("")}</div>` : `<div class="mute" style="font-size:12.5px;margin-bottom:10px">${H.t("cp_io_no_rec_hour")}</div>`; };
    const body = () => `<div class="cp-evh" style="margin-bottom:10px"><div><b>${E(rowName(p, r))}</b>${r.g ? ` <span class="tag">${E(grpName(r.g))}</span>` : ""}<div class="mute" style="font-size:12px">${E(p.name)} · ${E(bedNo(p))} · ${E(lc(H.t(r.s === "in" ? "cp_io_in" : "cp_io_out")))}${r.irr ? " · " + E(H.t("cp_io_to_irr")) : ""}</div></div>
        ${hours.length > 1 ? `<span class="r"><select data-cpio-h style="width:auto">${hours.map(i => `<option value="${i}" ${i === S.h ? "selected" : ""}>${HL(i)}:00–${HL(i + 1)}:00</option>`).join("")}</select></span>` : `<span class="r mono">${HL(S.h)}:00–${HL(S.h + 1)}:00${S.h === NOWI ? " · " + H.t("cp_now") : ""}</span>`}</div>
      <div data-cpio-ent>${entries()}</div>
      <div class="fld"><label>${H.t("cp_io_amount")}</label><div class="step"><button type="button" data-cpio-st="-1">−</button><input data-cpio-ml inputmode="decimal" placeholder="0"><button type="button" data-cpio-st="1">+</button><span class="u">mL</span></div></div>
      <div class="fld"><label>${H.t("cp_io_source")}</label><div class="opts" data-cpio-src>${SRC.map(v => `<i data-v="${v}" class="${S.src === v ? "on" : ""}">${E(srcName(v))}</i>`).join("")}</div></div>
      ${r.pump ? `<div class="note i" style="margin-top:4px">${H.t("cp_io_pump_note")}</div>` : ""}
      ${neo && r.urine ? `<div class="mute" style="font-size:12px;margin-top:6px">${H.t("cp_io_neo_weigh")}</div>` : ""}`;
    const m = H.modal({ title:H.t("cp_m_io"), body:body(), actions:`<button class="btn g" data-cpio-x="c">${H.t("cp_cancel")}</button><button class="btn p" data-cpio-x="s">${I("ok")}${H.t("cp_keep_draft")}</button>` });
    const step = neo ? 1 : r.pump ? 10 : 25;
    m.onclick = (e) => {
      const T = e.target, inp = m.querySelector("[data-cpio-ml]");
      const st = T.closest("[data-cpio-st]"); if (st) { const cur = parseFloat(String(inp.value).replace(",", ".")) || 0; const nv = cur + step * +st.dataset.cpioSt; inp.value = r.pump ? nv : Math.max(0, nv); return; }
      const sv = T.closest("[data-cpio-src] i"); if (sv) { S.src = sv.dataset.v; m.querySelectorAll("[data-cpio-src] i").forEach(x => x.classList.toggle("on", x === sv)); return; }
      const x = T.closest("[data-cpio-x]"); if (!x) return;
      if (x.dataset.cpioX === "c") { H.closeModal(); return; }
      const ml = parseFloat(String(inp.value).replace(",", "."));
      if (!isFinite(ml) || ml === 0 || (ml < 0 && !r.pump)) { H.toast(r.pump ? H.t("cp_toast_io_invalid_pump") : H.t("cp_toast_io_invalid"), "e"); return; }
      const L = ((D[k] = D[k] || {})[S.h] = D[k][S.h] || []);
      const fix = r.pump && S.src !== "pompa";
      L.push({ ml:rdOf(p)(ml), src:S.src, by:me(), at:H.now(), note:fix ? () => H.t("cp_io_n_fix") : "" });
      H.log(fix ? "Pompa değeri elle düzeltildi" : "Aldığı–çıkardığı girişi", `${bedNo(p)} · ${rowNameTR(p, r)} · ${HL(S.h)}:00 · ${String(ml).replace(".", ",")} mL · kaynak: ${S.src}`);
      H.closeModal(); H.toast(tpl("cp_toast_io_saved_tpl", { row:rowName(p, r), ml:fmt(ml) })); rerender();
    };
    m.onchange = (e) => { if (e.target.matches("[data-cpio-h]")) { S.h = +e.target.value; m.querySelector("[data-cpio-ent]").innerHTML = entries(); } };
  }

  /* 30.09 · kontrol §4-3: sıvı için TEK defter. Önceden üç ayrı yer vardı (form → NS.records, ızgara → ioGrid, sekmenin üst
   * kutuları → patient.js'te rastgele ioOf). Artık: form girişleri de bu ızgaraya (H.data.ioGrid) yazılır; sekmenin özet kutuları,
   * saatlik grafik, ameliyat sonrası panel ve belge satırı hepsi buradan hesaplanır. Tohum verisi ızgaranın kendi tohumudur. */
  const IN_K = IO.filter(r => r.s === "in" && !r.irr).map(r => r.k), OUT_K = IO.filter(r => r.s === "out" && !r.irr).map(r => r.k);
  const URI_K = IO.filter(r => r.urine).map(r => r.k);
  const slotSum = (D, keys, i) => keys.reduce((a, k) => a + ((D[k] && D[k][i]) || []).reduce((x, e) => x + (+e.ml || 0), 0), 0);
  function ioSummary(p) {
    const D = ioSeed(p), rd = rdOf(p), rows = [];
    for (let i = 0; i <= NOWI; i++) rows.push({ h:(8 + i) % 24, slot:i, i:rd(slotSum(D, IN_K, i)), o:rd(slotSum(D, OUT_K, i)) });
    const sumK = (keys) => rd(rows.reduce((a, r) => a + slotSum(D, keys, r.slot), 0));
    const tin = rows.reduce((a, r) => a + r.i, 0), tout = rows.reduce((a, r) => a + r.o, 0);
    const full = rows.filter(r => r.slot < NOWI).slice(-6), uri6 = full.reduce((a, r) => a + slotSum(D, URI_K, r.slot), 0);
    // son hemşire girişi (pompa kayıtları hariç): slot sırası, sonra saat
    let last = null;
    Object.keys(D).forEach(k => Object.keys(D[k] || {}).forEach(i => (D[k][i] || []).forEach(e => { if (e.src === "pompa") return;
      const key = +i * 100 + (+String(e.at).split(":")[1] || 0); if (!last || key >= last.key) last = { key, at:e.at, by:e.by, row:k }; })));
    return { rows, tin:rd(tin), tout:rd(tout), bal:rd(tin - tout), uokg:full.length ? uri6 / full.length / (p.weight || 70) : 0,
      iv:sumK(["iv", "tpn", "pcai", "pcab"]), ent:sumK(["oral", "peg", "ngin"]), blood:sumK(["blood"]), inOth:sumK(["pd", "inoth"]),
      uri:sumK(URI_K), drn:sumK(["dr1", "dr2"]), outOth:sumK(["kusma", "gaita", "ngd", "kan", "outoth"]),
      urineSlots:rows.map(r => slotSum(D, URI_K, r.slot)), drainSlots:rows.map(r => slotSum(D, ["dr1", "dr2"], r.slot)),
      last:last ? { at:last.at, by:last.by || H.t("cp_io_night_nurse") } : null, since:"08:00", nowSlot:NOWI };
  }
  // Form (nursing.js "Aldığı–çıkardığı") girişini ızgaranın ŞU ANKİ saat hücresine yazar. k: ızgara satır anahtarı.
  function ioAdd(p, k, ml, o = {}) {
    if (!ROW[k] || !(ml > 0)) return false;
    const D = ioSeed(p), i = o.slot ?? NOWI, L = ((D[k] = D[k] || {})[i] = D[k][i] || []);
    L.push({ ml:rdOf(p)(ml), src:o.src || "elle", by:o.by || me(), at:o.at || H.now(), form:!!o.form, note:o.note || "" });
    return true;
  }
  H.fluidGrid = { html:gridHtml, after:gridAfter, seed:ioSeed, summary:ioSummary, add:ioAdd, nowSlot:NOWI };
})();
