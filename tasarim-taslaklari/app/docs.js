/* Homunculus prototip v1 — hasta belgeleri (docs.js).
 * Dışa verir: H.docs = { html(p), after(el, p) } — hasta ekranındaki "Belgeler" sekmesinin içeriği.
 * Veri: H.data.docs (sayfa yenilenince başa döner).
 *
 * 24.09 · Ozan'ın isteği: muayene dokümanı doldurma ekranı yoktu; sesle yazdırma ve epikriz yazım ekranı.
 * Sözlük (Ozan kararı, HBYS kelimeleri yerine): "Taslağı sakla" · "Mühürle" (mühürlenen belge değişmez, yalnız ek not) · "Teslim".
 * Sistem TANI YAZMAZ: "Sistemden doldur" yalnız kayıtlı bulguyu kaynağı ve saatiyle ekler. Karar hekimindir.
 * Laboratuvar değerleri patient.js'in sentetik tablosunun aynasıdır; patient.js H.labs dışa verirse o kullanılır. */
(function () {
  const H = window.H;
  const esc = (s) => H.esc(s);
  H.data.docs = H.data.docs || [];

  /* ================= metinler (4 dil · dc_ öneki) =================
   * 24.09 · #8 günlük izlem iskeleti ve #9 transfer özeti ile gelen metinler. Eski Türkçe metinler yerinde kaldı. */
  H.addT({
    dc_t_izlem:{ AZ:"Gündəlik izləm qeydi", TR:"Günlük izlem notu", RU:"Ежедневная запись наблюдения", EN:"Daily progress note" },
    dc_t_transfer:{ AZ:"Transfer xülasəsi", TR:"Transfer özeti", RU:"Сводка при переводе", EN:"Transfer summary" },
    dc_s_vit24:{ AZ:"Vital göstəricilər · son 24 saat", TR:"Vital bulgular · son 24 saat", RU:"Витальные показатели · 24 ч", EN:"Vital signs · last 24 h" },
    dc_s_skor24:{ AZ:"Şkalalar və dəyişim", TR:"Skorlar ve değişim", RU:"Шкалы и изменение", EN:"Scores and change" },
    dc_s_sivi24:{ AZ:"Maye balansı", TR:"Sıvı dengesi", RU:"Водный баланс", EN:"Fluid balance" },
    dc_s_sonuc24:{ AZ:"Yeni nəticələr", TR:"Yeni sonuçlar", RU:"Новые результаты", EN:"New results" },
    dc_s_olay24:{ AZ:"Siqnallar və hadisələr", TR:"Alarmlar ve olaylar", RU:"Тревоги и события", EN:"Alarms and events" },
    dc_s_fizik:{ AZ:"Fiziki müayinə", TR:"Fizik muayene", RU:"Физикальный осмотр", EN:"Physical examination" },
    dc_s_deger:{ AZ:"Qiymətləndirmə", TR:"Değerlendirme", RU:"Оценка", EN:"Assessment" },
    dc_s_plan:{ AZ:"Plan", TR:"Plan", RU:"План", EN:"Plan" },
    dc_s_tkim:{ AZ:"Xəstə və yatış", TR:"Hasta ve yatış", RU:"Пациент и госпитализация", EN:"Patient and admission" },
    dc_s_tskor:{ AZ:"Şkala meyli · yatış boyu", TR:"Skor eğilimi · yatış boyunca", RU:"Динамика шкал за госпитализацию", EN:"Score trend · whole stay" },
    dc_s_tolay:{ AZ:"Mühüm hadisələr · siqnallar və eskalasiyalar", TR:"Önemli olaylar · alarmlar ve eskalasyonlar", RU:"Важные события · тревоги и эскалации", EN:"Key events · alarms and escalations" },
    dc_s_tcihaz:{ AZ:"Cihaz və kateter günləri", TR:"Cihaz ve kateter günleri", RU:"Устройства и дни катетеров", EN:"Devices and line days" },
    dc_s_tbakim:{ AZ:"Qulluq planı diaqnozları", TR:"Bakım planı tanıları", RU:"Диагнозы плана ухода", EN:"Care plan diagnoses" },
    dc_s_tsonuc:{ AZ:"İstinaddan kənar nəticələr", TR:"Referans dışı sonuçlar", RU:"Результаты вне референса", EN:"Out-of-range results" },
    dc_s_tilac:{ AZ:"Antibiotik və allergiya", TR:"Antibiyotik ve alerji", RU:"Антибиотики и аллергия", EN:"Antibiotics and allergy" },
    dc_s_tsivi:{ AZ:"Maye balansı · növbə günü", TR:"Sıvı dengesi · nöbet günü", RU:"Водный баланс · сутки дежурства", EN:"Fluid balance · duty day" },
    dc_s_tneden:{ AZ:"Transfer səbəbi və həkim qeydi", TR:"Transfer nedeni ve hekim notu", RU:"Причина перевода и заметка врача", EN:"Reason for transfer and physician note" },
    dc_ph_tneden:{ AZ:"Transfer səbəbi və qəbul edən şöbəyə qeydiniz · sistem bu bölməyə yazmır", TR:"Transfer nedeni ve alıcı birime notunuz · sistem bu bölüme yazmaz", RU:"Причина перевода и заметка для принимающего отделения · система сюда не пишет", EN:"Reason for transfer and your note to the receiving unit · the system does not write here" },
    dc_info_izlem:{ AZ:"<b>Son 24 saat hazır gəldi.</b> Vital, şkala, maye balansı və yeni nəticələr qeyddən düzüldü; hər sətir mənbəyini və saatını daşıyır. Sistem şərh cümləsi yazmır. Qiymətləndirməni siz yazmadan qeyd möhürlənmir.",
      TR:"<b>Son 24 saat hazır geldi.</b> Vital, skor, sıvı dengesi ve yeni sonuçlar kayıttan dizildi; her satır kaynağını ve saatini taşır. Sistem yorum cümlesi yazmaz. Değerlendirmeyi siz yazmadan not mühürlenmez.",
      RU:"<b>Последние 24 часа уже подставлены.</b> Витальные, шкалы, водный баланс и новые результаты взяты из записей; у каждой строки есть источник и время. Система не пишет выводов. Без вашей оценки запись не запечатывается.",
      EN:"<b>The last 24 hours are ready.</b> Vitals, scores, fluid balance and new results are laid out from the record; every line carries its source and time. The system writes no interpretation. The note cannot be sealed until you write the assessment." },
    dc_info_tr:{ AZ:"<b>Transfer xülasəsi tək səhifədir.</b> Yatış boyu şkala meyli, mühüm hadisələr, cihaz və kateter günləri və qulluq planı diaqnozları qeyddən toplanır. Diaqnoz yazılmır; transfer səbəbini həkim yazır. Epikrizi xəstəxana sistemi yazır.",
      TR:"<b>Transfer özeti tek sayfadır.</b> Yatış boyunca skor eğilimi, önemli olaylar, cihaz ve kateter günleri ve bakım planı tanıları kayıttan derlenir. Tanı yazılmaz; transfer nedenini hekim yazar. Epikrizi hastane sistemi yazar.",
      RU:"<b>Сводка при переводе — одна страница.</b> Динамика шкал, важные события, дни устройств и катетеров и диагнозы плана ухода собираются из записей. Диагноз не пишется; причину перевода пишет врач. Эпикриз пишет больничная система.",
      EN:"<b>The transfer summary is one page.</b> Score trend over the stay, key events, device and line days and care plan diagnoses are compiled from the record. No diagnosis is written; the physician writes the reason for transfer. The discharge summary is written by the hospital system." },
    dc_send:{ AZ:"Xəstəxana qeydinə göndər", TR:"Hastane kaydına gönder", RU:"Отправить в больничную запись", EN:"Send to hospital record" },
    dc_sent_tpl:{ AZ:"{d} xəstəxana qeydinə göndərildi · {t}", TR:"{d} hastane kaydına gönderildi · {t}", RU:"{d} отправлено в больничную запись · {t}", EN:"{d} sent to the hospital record · {t}" },
    dc_sent_at_tpl:{ AZ:"Son göndərmə · {t}", TR:"Son gönderim · {t}", RU:"Последняя отправка · {t}", EN:"Last sent · {t}" },
    dc_page_on:{ AZ:"Tək səhifə", TR:"Tek sayfa", RU:"Одна страница", EN:"Single page" },
    dc_page_off:{ AZ:"Redaktəyə qayıt", TR:"Düzenlemeye dön", RU:"К редактированию", EN:"Back to editing" },
    dc_new_tr:{ AZ:"Transfer xülasəsi", TR:"Transfer özeti", RU:"Сводка при переводе", EN:"Transfer summary" },
    dc_need_deger:{ AZ:"Qiymətləndirmə boşdur: həkim yazmadan izləm qeydi möhürlənmir", TR:"Değerlendirme boş: hekim yazmadan izlem notu mühürlenmez", RU:"Оценка пуста: без записи врача заметка не запечатывается", EN:"Assessment is empty: the note cannot be sealed until the physician writes it" },
    dc_need_neden:{ AZ:"Transfer səbəbi boşdur: həkim yazmadan möhürlənmir", TR:"Transfer nedeni boş: hekim yazmadan mühürlenmez", RU:"Причина перевода пуста: без записи врача не запечатывается", EN:"Reason for transfer is empty: it cannot be sealed until the physician writes it" },
    dc_sys_tag:{ AZ:"sistem topladı · qaralama", TR:"sistem derledi · taslak", RU:"собрано системой · черновик", EN:"compiled by system · draft" },
    dc_page_by:{ AZ:"Toplayan Homunculus · redaktə edən həkim", TR:"Derleyen Homunculus · düzenleyen hekim", RU:"Собрал Homunculus · редактирует врач", EN:"Compiled by Homunculus · edited by the physician" },
    dc_page_foot:{ AZ:"Sətirlərdəki kvadrat mötərizə mənbəni və saatı göstərir. Bu xülasə diaqnoz və ya göstəriş deyil.", TR:"Satırlardaki köşeli parantez kaynağı ve saati gösterir. Bu özet tanı ya da talimat değildir.", RU:"Квадратные скобки в строках указывают источник и время. Сводка не является диагнозом или назначением.", EN:"Square brackets on each line show source and time. This summary is not a diagnosis or an order." },
    dc_bed:{ AZ:"Çarpayı", TR:"Yatak", RU:"Койка", EN:"Bed" },
    dc_admit:{ AZ:"Yatış", TR:"Yatış", RU:"Поступление", EN:"Admitted" },
    dc_day_tpl:{ AZ:"{n}. gün", TR:"{n}. gün", RU:"{n}-й день", EN:"day {n}" },
    dc_compiled_tpl:{ AZ:"Toplanıb · {t}", TR:"Derlendi · {t}", RU:"Собрано · {t}", EN:"Compiled · {t}" },
    // satır kaynakları
    dc_src_mon:{ AZ:"Monitor", TR:"Monitör", RU:"Монитор", EN:"Monitor" },
    dc_src_vit:{ AZ:"Vital qeydləri", TR:"Vital kayıtları", RU:"Записи витальных", EN:"Vital records" },
    dc_src_score:{ AZ:"Şkala modulu", TR:"Skor modülü", RU:"Модуль шкал", EN:"Score module" },
    dc_src_io:{ AZ:"Maye izləm cədvəli", TR:"Sıvı izlem ızgarası", RU:"Сетка водного баланса", EN:"Fluid chart" },
    dc_src_lab:{ AZ:"Laboratoriya", TR:"Laboratuvar", RU:"Лаборатория", EN:"Laboratory" },
    dc_src_alarm:{ AZ:"Siqnal qeydi", TR:"Alarm kaydı", RU:"Журнал тревог", EN:"Alarm log" },
    dc_src_line:{ AZ:"Tibb bacısı qeydi · davam edən", TR:"Hemşirelik kaydı · devam eden", RU:"Сестринская запись · текущие", EN:"Nursing record · ongoing" },
    dc_src_dev:{ AZ:"Cihaz inventarı", TR:"Cihaz envanteri", RU:"Реестр устройств", EN:"Device inventory" },
    dc_src_cp:{ AZ:"Qulluq planı", TR:"Bakım planı", RU:"План ухода", EN:"Care plan" },
    dc_src_rec:{ AZ:"Xəstəxana qeydi", TR:"Hastane kaydı", RU:"Больничная запись", EN:"Hospital record" },
    dc_src_med:{ AZ:"Dərman təyinatı", TR:"İlaç order'ı", RU:"Назначение", EN:"Medication order" },
    // satır kalıpları (yalnız ölçülmüş değer; yorum yok)
    dc_l_vit_tpl:{ AZ:"{k}: ən aşağı {lo} · ən yuxarı {hi} · indi {now}{u}", TR:"{k}: en düşük {lo} · en yüksek {hi} · şimdi {now}{u}", RU:"{k}: мин {lo} · макс {hi} · сейчас {now}{u}", EN:"{k}: lowest {lo} · highest {hi} · now {now}{u}" },
    dc_l_vit_now_tpl:{ AZ:"Son ölçmə: O₂ {o2} · şüur {loc}", TR:"Son ölçüm: O₂ {o2} · bilinç {loc}", RU:"Последнее измерение: O₂ {o2} · сознание {loc}", EN:"Last reading: O₂ {o2} · consciousness {loc}" },
    dc_l_sc24_tpl:{ AZ:"{s}: {d1} {a} → indi {b} · dəyişim {x}", TR:"{s}: {d1} {a} → şimdi {b} · değişim {x}", RU:"{s}: {d1} {a} → сейчас {b} · изменение {x}", EN:"{s}: {d1} {a} → now {b} · change {x}" },
    dc_l_sc1_tpl:{ AZ:"{s}: indi {b} (yatışın 1-ci günü, müqayisə yoxdur)", TR:"{s}: şimdi {b} (yatışın 1. günü, karşılaştırma yok)", RU:"{s}: сейчас {b} (1-й день, сравнения нет)", EN:"{s}: now {b} (day 1 of stay, no comparison)" },
    dc_l_scst_tpl:{ AZ:"{s}: {seq} · yatışdan bəri dəyişim {x}", TR:"{s}: {seq} · baştan bu yana değişim {x}", RU:"{s}: {seq} · изменение с начала {x}", EN:"{s}: {seq} · change since start {x}" },
    dc_l_noscore:{ AZ:"Bu şöbədə klinik şkala aparılmır.", TR:"Bu birimde klinik skor tutulmuyor.", RU:"В этом отделении клинические шкалы не ведутся.", EN:"No clinical score is kept in this unit." },
    dc_l_io_tpl:{ AZ:"Aldığı {i} mL · çıxardığı {o} mL · sidik {u} mL ({uk} mL/kq/saat) · balans {n} mL", TR:"Aldığı {i} mL · çıkardığı {o} mL · idrar {u} mL ({uk} mL/kg/saat) · denge {n} mL", RU:"Поступило {i} мл · выделено {o} мл · диурез {u} мл ({uk} мл/кг/ч) · баланс {n} мл", EN:"Intake {i} mL · output {o} mL · urine {u} mL ({uk} mL/kg/h) · balance {n} mL" },
    dc_l_io_irr_tpl:{ AZ:"İriqasiya ayrıca: verilən {a} mL · gələn {b} mL (cəmə daxil deyil)", TR:"İrigasyon ayrı: verilen {a} mL · gelen {b} mL (toplama katılmadı)", RU:"Ирригация отдельно: введено {a} мл · получено {b} мл (в сумму не входит)", EN:"Irrigation separate: in {a} mL · out {b} mL (not in totals)" },
    dc_l_io_none:{ AZ:"Bu növbə günü üçün maye qeydi yoxdur.", TR:"Bu nöbet günü için sıvı kaydı yok.", RU:"За эти сутки записей баланса нет.", EN:"No fluid entries for this duty day." },
    dc_l_lab_tpl:{ AZ:"{n} {v} {u}{ar} (ist. {r})", TR:"{n} {v} {u}{ar} (ref {r})", RU:"{n} {v} {u}{ar} (реф. {r})", EN:"{n} {v} {u}{ar} (ref {r})" },
    dc_l_crit:{ AZ:"kritik", TR:"kritik", RU:"критич.", EN:"critical" },
    dc_l_prev_tpl:{ AZ:"əvvəlki {v} ({t})", TR:"önceki {v} ({t})", RU:"ранее {v} ({t})", EN:"previous {v} ({t})" },
    dc_l_nolab:{ AZ:"Son 24 saatda nəticə qeydi yoxdur.", TR:"Son 24 saatte sonuç kaydı yok.", RU:"За 24 ч результатов нет.", EN:"No results recorded in the last 24 h." },
    dc_l_labok:{ AZ:"Son nəticələr istinad aralığındadır.", TR:"Son sonuçlar referans aralığında.", RU:"Последние результаты в пределах референса.", EN:"Latest results within reference range." },
    dc_l_alarm_tpl:{ AZ:"{txt} · {sev} · {st}", TR:"{txt} · {sev} · {st}", RU:"{txt} · {sev} · {st}", EN:"{txt} · {sev} · {st}" },
    dc_al_open:{ AZ:"cavab gözləyir", TR:"yanıt bekliyor", RU:"ожидает ответа", EN:"awaiting response" },
    dc_al_esc_tpl:{ AZ:"eskalasiya {n}-ci addım", TR:"eskalasyon {n}. adım", RU:"эскалация, шаг {n}", EN:"escalation step {n}" },
    dc_al_seen:{ AZ:"görüldü", TR:"görüldü", RU:"просмотрено", EN:"seen" },
    dc_al_closed:{ AZ:"bağlandı", TR:"kapandı", RU:"закрыто", EN:"closed" },
    dc_l_noalarm:{ AZ:"Qeydə alınmış siqnal yoxdur.", TR:"Kayıtlı alarm yok.", RU:"Зарегистрированных тревог нет.", EN:"No alarms recorded." },
    dc_l_esc_sum_tpl:{ AZ:"{n} siqnal eskalasiyaya getdi (ən yuxarı {s}-ci addım).", TR:"{n} alarm eskalasyona gitti (en üst {s}. adım).", RU:"{n} тревог(и) ушли в эскалацию (макс. шаг {s}).", EN:"{n} alarm(s) escalated (highest step {s})." },
    dc_l_line_tpl:{ AZ:"{n} · taxılma {d} · bu gün {k}-ci gün", TR:"{n} · takılma {d} · bugün {k}. gün", RU:"{n} · установлен {d} · сегодня {k}-й день", EN:"{n} · placed {d} · today day {k}" },
    dc_l_noline:{ AZ:"Davam edən kateter / boru qeydi yoxdur.", TR:"Devam eden kateter / tüp kaydı yok.", RU:"Текущих катетеров / трубок нет.", EN:"No ongoing lines or tubes recorded." },
    dc_l_dev_tpl:{ AZ:"Çarpayıya bağlı: {l}", TR:"Yatağa bağlı: {l}", RU:"Подключено к койке: {l}", EN:"Attached to bed: {l}" },
    dc_l_cp_tpl:{ AZ:"{n} · başlanğıc {at}", TR:"{n} · başlangıç {at}", RU:"{n} · начало {at}", EN:"{n} · started {at}" },
    dc_l_cp_end_tpl:{ AZ:"{n} · bitdi", TR:"{n} · sonlandı", RU:"{n} · завершён", EN:"{n} · ended" },
    dc_l_nocp:{ AZ:"Qulluq planında diaqnoz yoxdur.", TR:"Bakım planında tanı yok.", RU:"В плане ухода диагнозов нет.", EN:"No diagnoses in the care plan." },
    dc_l_opunit:{ AZ:"Əməliyyat şöbəsi: qulluq planı aparılmır.", TR:"Operasyonel birim: bakım planı tutulmuyor.", RU:"Операционное отделение: план ухода не ведётся.", EN:"Operational unit: no care plan kept." },
    dc_l_admit_tpl:{ AZ:"Yatış {d} · bu gün yatışın {n}-ci günü · {u}", TR:"Yatış {d} · bugün yatışın {n}. günü · {u}", RU:"Поступление {d} · сегодня {n}-й день · {u}", EN:"Admitted {d} · today day {n} of stay · {u}" },
    dc_l_dx_tpl:{ AZ:"Yatış diaqnozu (qeyd): {x}", TR:"Yatış tanısı (kayıt): {x}", RU:"Диагноз при поступлении (запись): {x}", EN:"Admission diagnosis (record): {x}" },
    dc_l_allergy_tpl:{ AZ:"Allergiya: {x}", TR:"Alerji: {x}", RU:"Аллергия: {x}", EN:"Allergy: {x}" },
    dc_l_noallergy:{ AZ:"Məlum allergiya yoxdur.", TR:"Bilinen alerji yok.", RU:"Известной аллергии нет.", EN:"No known allergy." },
    dc_l_abx_tpl:{ AZ:"{m} · başlanğıc {d} · bu gün {n}-ci gün", TR:"{m} · başlangıç {d} · bugün {n}. gün", RU:"{m} · начало {d} · сегодня {n}-й день", EN:"{m} · started {d} · today day {n}" },
    dc_l_noabx:{ AZ:"Antibiotik qeydi yoxdur.", TR:"Antibiyotik kaydı yok.", RU:"Записей об антибиотиках нет.", EN:"No antibiotic recorded." },
    dc_l_abx:{ AZ:"Antibiotik", TR:"Antibiyotik", RU:"Антибиотик", EN:"Antibiotic" },
    dc_l_iso_tpl:{ AZ:"İzolyasiya: {x}", TR:"İzolasyon: {x}", RU:"Изоляция: {x}", EN:"Isolation: {x}" },
    dc_v_temp:{ AZ:"Hərarət", TR:"Ateş", RU:"Темп.", EN:"Temp" },
    dc_duty:{ AZ:"növbə günü", TR:"nöbet günü", RU:"сутки дежурства", EN:"duty day" },
    dc_daily:{ AZ:"gündəlik", TR:"günlük", RU:"ежедневно", EN:"daily" },
  });
  const t = (k) => H.t(k);
  const tp = (k, o) => H.t(k).replace(/\{(\w+)\}/g, (m, x) => (o[x] != null ? o[x] : m));

  /* ================= stil ================= */
  const CSS = `
.dc-root{display:grid;grid-template-columns:270px minmax(0,1fr);gap:12px;align-items:start;min-width:0;max-width:100%}
.dc-root *{min-width:0}
.dc-list{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px;position:sticky;top:0}
.dc-lh{display:flex;align-items:center;gap:8px;padding:2px 4px 4px}
.dc-lh b{font:700 14px "Space Grotesk"} .dc-lh span{margin-left:auto;font:600 11.5px Figtree;color:var(--mute)}
.dc-new{display:flex;flex-direction:column;gap:6px;padding-bottom:8px;border-bottom:1px solid var(--line);margin-bottom:2px}
.dc-new .btn{justify-content:center}
.dc-it{display:grid;grid-template-columns:30px minmax(0,1fr);gap:2px 9px;text-align:left;background:none;border:1px solid transparent;border-radius:11px;padding:8px;cursor:pointer;width:100%}
.dc-it:hover{background:var(--card2)}
.dc-it.on{background:var(--priSoft);border-color:color-mix(in srgb,var(--pri) 45%,transparent)}
.dc-it .dc-ic{grid-row:span 3;width:30px;height:30px;border-radius:9px;background:var(--card2);color:var(--mute);display:grid;place-items:center}
.dc-it.on .dc-ic{background:var(--pri);color:var(--onpri)}
.dc-it .dc-ic svg{width:16px;height:16px}
.dc-it b{font:700 13px Figtree;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-it small{font:600 11px "JetBrains Mono";color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-st{justify-self:start;font:700 10px Figtree;letter-spacing:.03em;padding:1px 7px;border-radius:999px;display:inline-flex;gap:4px;align-items:center}
.dc-st svg{width:11px;height:11px}
.dc-st.t{color:var(--attInk);background:var(--att);border:1px solid var(--attLine)}
.dc-st.m{color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,transparent)}
.dc-st.s{color:var(--pri);background:var(--priSoft)}
.dc-ed{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:12px}
.dc-eh{display:flex;gap:8px 12px;align-items:flex-start;flex-wrap:wrap}
.dc-eh h4{margin:0;font:700 18px/1.2 "Space Grotesk"}
.dc-eh .dc-meta{font-size:12.5px;color:var(--mute);margin-top:3px}
.dc-eh .dc-meta b{color:var(--ink);font-weight:600}
.dc-eh .r{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.dc-info{display:flex;gap:8px;align-items:flex-start;font:600 12px/1.45 Figtree;border-radius:10px;padding:8px 10px;background:var(--priSoft);color:var(--ink);border:1px solid color-mix(in srgb,var(--pri) 35%,transparent)}
.dc-info svg{width:15px;height:15px;flex:none;margin-top:1px;color:var(--pri)}
.dc-info b{color:var(--pri)}
.dc-info.w{background:var(--att);border-color:var(--attLine)} .dc-info.w svg,.dc-info.w b{color:var(--attInk)}
.dc-sec{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--card)}
.dc-sec.live{border-color:var(--pri);box-shadow:0 0 0 3px var(--priSoft)}
.dc-sh{display:flex;align-items:center;gap:6px 8px;flex-wrap:wrap;margin-bottom:8px}
.dc-sh > b{font:700 11px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.dc-sh .r{margin-left:auto;display:flex;gap:6px;align-items:center}
.dc-src{font:600 10.5px Figtree;color:var(--mute);background:var(--card2);border-radius:6px;padding:2px 6px;display:inline-flex;gap:4px;align-items:center;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.dc-src svg{width:11px;height:11px}
.dc-sec textarea{min-height:74px;line-height:1.5;font-size:13.5px}
.dc-sec textarea[disabled]{opacity:.75;cursor:not-allowed}
.dc-mic{width:34px;height:34px;border-radius:50%;border:1px solid var(--line2);background:var(--card2);color:var(--ink);display:grid;place-items:center;cursor:pointer;position:relative;flex:none;padding:0}
.dc-mic:hover{border-color:var(--pri);color:var(--pri)}
.dc-mic svg{width:17px;height:17px}
.dc-mic.on{background:var(--crit);border-color:transparent;color:#fff}
.dc-mic.on::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--crit);animation:dcPulse 1.3s ease-out infinite}
.dc-mic[disabled]{opacity:.4;cursor:not-allowed}
@keyframes dcPulse{0%{transform:scale(.9);opacity:.9}100%{transform:scale(1.45);opacity:0}}
.dc-live{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;padding:7px 10px;border-radius:10px;background:var(--card2);font-size:12.5px}
.dc-live .dc-dot{width:9px;height:9px;border-radius:50%;background:var(--crit);flex:none;animation:dcBlink 1s infinite}
@keyframes dcBlink{50%{opacity:.25}}
.dc-live b{font:700 12.5px Figtree}
.dc-live .dc-mode{color:var(--mute);font-size:11.5px}
.dc-live .btn{margin-left:auto}
.dc-int{flex-basis:100%;color:var(--mute);font-style:italic;min-height:18px;overflow-wrap:anywhere}
.dc-vg{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;margin-bottom:8px}
.dc-vf{background:var(--card2);border:1px solid transparent;border-radius:10px;padding:6px 8px;display:flex;flex-direction:column;gap:3px}
.dc-vf small{font:700 10px Figtree;color:var(--c,var(--mute));display:flex;justify-content:space-between;gap:4px}
.dc-vf small i{font-style:normal;color:var(--mute);font-weight:600}
.dc-vf input{padding:5px 7px;font:700 15px "JetBrains Mono";background:var(--card);border-radius:8px}
.dc-vf.wide{grid-column:span 2}
.dc-vf.wide input{font:600 13px Figtree}
.dc-vf.ed{border-color:var(--attLine);background:var(--att)}
.dc-vf .dc-edt{display:none;font:700 9.5px Figtree;color:var(--attInk)}
.dc-vf.ed .dc-edt{display:inline}
.dc-vsrc{display:flex;gap:6px 10px;align-items:center;flex-wrap:wrap;font-size:11.5px;color:var(--mute);margin-bottom:8px}
.dc-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--line)}
.dc-bar .dc-stat{font-size:12px;color:var(--mute)}
.dc-bar .dc-stat.dirty{color:var(--attInk);font-weight:600}
.dc-why{font-size:11.5px;color:var(--mute);line-height:1.45;flex-basis:100%}
.dc-ro{white-space:pre-wrap;font-size:13.5px;line-height:1.55;overflow-wrap:anywhere}
.dc-ro.empty{color:var(--mute);font-style:italic}
.dc-seal{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-radius:10px;padding:8px 10px;background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok);font:700 12.5px Figtree}
.dc-seal svg{width:16px;height:16px}
.dc-seal span{color:var(--mute);font-weight:600}
.dc-add{border-left:3px solid var(--pri);padding:6px 10px;background:var(--card2);border-radius:0 10px 10px 0;margin-top:6px}
.dc-add small{display:block;font:600 11px "JetBrains Mono";color:var(--mute);margin-bottom:3px}
.dc-demo{font:700 9.5px Figtree;letter-spacing:.04em;color:var(--mute);border:1px dashed var(--line2);border-radius:999px;padding:1px 7px;white-space:nowrap}
.dc-empty{color:var(--mute);font-size:13px;padding:22px 10px;text-align:center;border:1.5px dashed var(--line2);border-radius:14px}
.dc-page{background:var(--card);border:1px solid var(--line2);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.dc-ph{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;border-bottom:2px solid var(--line2);padding-bottom:8px}
.dc-ph h5{margin:0;font:700 17px/1.2 "Space Grotesk";flex-basis:100%}
.dc-ph span{font-size:12px;color:var(--mute);overflow-wrap:anywhere} .dc-ph span b{color:var(--ink);font-weight:600}
.dc-pg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px}
.dc-pb{min-width:0;border-top:1px solid var(--line);padding-top:6px}
.dc-pb.full{grid-column:1 / -1}
.dc-pb h6{margin:0 0 4px;font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.dc-pb div{white-space:pre-wrap;font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
.dc-pb div.empty{color:var(--mute);font-style:italic}
.dc-pf{font-size:11px;color:var(--mute);border-top:1px dashed var(--line2);padding-top:6px}
.dc-sent{font-size:11.5px;color:var(--ok);font-weight:600}
@media (max-width:640px){.dc-pg{grid-template-columns:1fr}.dc-page{padding:10px}}
@media (max-width:820px){.dc-root{grid-template-columns:1fr}.dc-list{position:static}.dc-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px}}
@media (max-width:640px){.dc-ed{padding:10px}.dc-sec{padding:9px}.dc-vf.wide{grid-column:1 / -1}.dc-eh .r{margin-left:0}.dc-bar .btn{flex:1 1 auto;justify-content:center}}
`;
  const ensureCss = () => { if (document.getElementById("dc-css")) return; const s = document.createElement("style"); s.id = "dc-css"; s.textContent = CSS; document.head.appendChild(s); };
  const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg>`;

  /* ================= yardımcılar ================= */
  const unitOf = (p) => H.unit(H.bed(p.bed).unitId);
  const bedNo = (p) => H.bed(p.bed).no;
  const me = () => (H.state.user ? H.state.user.u : "");
  const short = (u) => { if (u === "sistem") return "Homunculus (sistem)"; const x = H.userBy(u); if (!x) return u || "—"; const w = x.name.split(" "); return w.length > 1 ? `${w.slice(0, -1).join(" ")} ${w[w.length - 1][0]}.` : x.name; };
  const isDoc = () => H.can("scores_sign");                        // hekim
  const isNurse = () => H.can("forms") && !isDoc();                // hemşire
  const admitOff = (p) => -Math.max(0, p.admitDays - 1);           // patient.js ile aynı: "Yatış 2. gün" → dün yatış
  const vitalAt = (p) => p.monitored ? { src:"Monitör · canlı", at:H.nowFull() } : { src:"Vital formu", at:H.entryFull(H.lastEntry && H.lastEntry(p.id, "vitals")) };   // 30.09c: son gerçek vital kaydı

  /* ---------- laboratuvar: patient.js'in sentetik tablosunun aynası (H.labs varsa o) ---------- */
  const LABDEF = [
    { k:"lac", n:"Laktat", u:"mmol/L", ref:[0.5, 2.0], crit:[null, 4] }, { k:"cre", n:"Kreatinin", u:"mg/dL", ref:[0.6, 1.2] },
    { k:"k", n:"Potasyum", u:"mmol/L", ref:[3.5, 5.1], crit:[2.8, 6.0] }, { k:"na", n:"Sodyum", u:"mmol/L", ref:[136, 145], crit:[120, 160] },
    { k:"crp", n:"CRP", u:"mg/L", ref:[0, 5] }, { k:"hb", n:"Hemoglobin", u:"g/dL", ref:[12, 16], crit:[7, null] },
    { k:"plt", n:"Trombosit", u:"×10³/µL", ref:[150, 400], crit:[50, null] }, { k:"aptt", n:"aPTT", u:"sn", ref:[25, 35], crit:[null, 100] },
    { k:"glu", n:"Glukoz", u:"mg/dL", ref:[70, 110], crit:[50, 400] }, { k:"bil", n:"Total bilirubin", u:"mg/dL", ref:[0.3, 1.2], only:["p14"] },
  ];
  const PV = {
    p1:{ lac:4.1, cre:1.9, k:4.9, na:138, crp:212, hb:11.2, plt:96, aptt:41.2, glu:168 }, p2:{ lac:2.3, cre:1.4, k:4.4, na:141, crp:96, hb:13.1, plt:210, aptt:31, glu:212 },
    p3:{ lac:1.6, cre:3.1, k:5.8, na:134, crp:18, hb:10.9, plt:140, aptt:33, glu:118 }, p4:{ lac:1.3, cre:0.8, k:4.0, na:139, crp:64, hb:11.6, plt:232, aptt:29, glu:132 },
    p5:{ lac:1.1, cre:1.2, k:4.2, na:140, crp:7, hb:14.2, plt:245, aptt:34, glu:124 }, p6:{ lac:2.4, cre:1.5, k:3.4, na:132, crp:148, hb:11.8, plt:188, aptt:30, glu:104 },
    p7:{ lac:1.4, cre:1.6, k:3.6, na:133, crp:12, hb:12.4, plt:201, aptt:32, glu:110 }, p8:{ lac:1.8, cre:0.9, k:4.6, na:134, crp:6, hb:13.6, plt:280, aptt:28, glu:286 },
    p9:{ lac:1.9, cre:1.1, k:4.1, na:137, crp:124, hb:13.2, plt:219, aptt:30, glu:121 }, p10:{ lac:1.0, cre:0.7, k:4.0, na:140, crp:22, hb:12.8, plt:260, aptt:28, glu:98 },
    p11:{ lac:1.5, cre:0.4, k:4.3, na:138, crp:34, hb:12.1, plt:310, aptt:32, glu:96 }, p12:{ lac:1.9, cre:0.6, k:3.3, na:133, crp:8, hb:12.6, plt:290, aptt:31, glu:72 },
    p13:{ lac:2.6, cre:0.9, k:5.2, na:134, crp:14, hb:13.2, plt:118, aptt:48, glu:58 }, p14:{ lac:1.2, cre:0.6, k:4.8, na:139, crp:2, hb:17.9, plt:240, aptt:38, glu:72, bil:16.8 },
  };
  const PREV = { p1:{ lac:[2.2, H.atFull("15:30")] } };   // 30.09c: olay saatleri gerçek saate kaydırılır (core.js H.at)
  const refFor = (p, d) => {
    if (p.ageGroup === "neonate") return ({ cre:[0.3, 1.0], hb:[13.5, 21.5], glu:[50, 110], bil:[1, 12], aptt:[30, 50] })[d.k] || d.ref;
    if (p.ageGroup === "child") return ({ cre:[0.3, 0.7], hb:[11.5, 15.5] })[d.k] || d.ref;
    if (d.k === "hb") return p.sex === "E" ? [13.5, 17.5] : [12, 15.5];
    return d.ref;
  };
  const labTime = (p, k) => k === "lac" && (p.risk === "crit" || p.risk === "high") ? H.atFull("21:30") : p.id === "p3" && k === "k" ? H.atFull("21:10") : `${H.dm(0)} · 06:10`;   // 06:10 sabah laboratuvarı (takvim)
  // → [{ n, v, u, ref, arrow, crit, at, prev }] bu hastanın bugünkü tüm sonuçları (hepsi son 24 saat içinde alındı)
  const allLabs = (p) => {
    if (H.labs && H.labs.all) return H.labs.all(p);
    const V = PV[p.id]; if (!V) return null;                        // bu hasta için laboratuvar kaydı yok
    return LABDEF.filter(d => (!d.only || d.only.includes(p.id)) && V[d.k] != null).map(d => {
      const v = V[d.k], r = refFor(p, d), c = d.crit || [];
      const crit = (c[0] != null && v <= c[0]) || (c[1] != null && v >= c[1]);
      const arrow = v > r[1] ? (crit ? "↑↑" : "↑") : v < r[0] ? (crit ? "↓↓" : "↓") : "";
      return { n:d.n, v, u:d.u, ref:r, arrow, crit, at:labTime(p, d.k), prev:PREV[p.id] && PREV[p.id][d.k] };
    });
  };
  // yalnız referans dışı olanlar
  const abnormalLabs = (p) => {
    if (H.labs && H.labs.abnormal) return H.labs.abnormal(p);
    const A = allLabs(p); return A == null ? null : A.filter(x => x.arrow);
  };

  /* ---------- #8 / #9 · ölçülmüş değer dizicileri (yorum cümlesi YOK; her satır kaynak + saat) ---------- */
  const L2 = (srcK, at, txt) => `[${t(srcK)}${at ? " · " + at : ""}] ${txt}`;
  const sgn = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x);
  const nowMin = () => { const [h, m] = String(H.now()).split(":").map(Number); return h * 60 + m; };
  // Skor geçmişi: grafik.js "Birim panosu"ndaki deterministik geçmişin aynası (orada dışa verilmiyor) → iki ekran aynı sayıyı gösterir.
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 2147483646 + 1; };
  const rnd = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const SCORE_KEYS = [["news2", "NEWS2"], ["sofa", "SOFA"], ["pews", "PEWS"], ["nsofa", "nSOFA"]];
  const scoreHist = (p, key) => {
    const d0 = p[key]; if (d0 == null) return null;
    const r = rnd(hash(p.id + ":" + key)), j = () => Math.floor(r() * 2), s = () => [-1, 0, 1][Math.floor(r() * 3)];
    let d1, d2;
    if (p.risk === "crit") { d1 = d0 - 2 - j(); d2 = d1 - 1 - j(); }
    else if (p.risk === "high") { d1 = d0 - 1 - j(); d2 = d1 - j(); }
    else if (p.risk === "mid") { d1 = d0 + s(); d2 = d1 + s(); }
    else { d1 = d0 + j(); d2 = d1 + j(); }
    const c = (v) => Math.max(0, v); return [c(d2), c(d1), d0];
  };
  const scoresOf = (p) => H.isClinical(unitOf(p)) ? SCORE_KEYS.filter(([k]) => p[k] != null) : [];
  // son 24 saat: dünkü günlük değer → şimdiki değer
  const score24Lines = (p) => { const S = scoresOf(p); if (!S.length) return [L2("dc_src_score", "", t("dc_l_noscore"))];
    return S.map(([k, n]) => { const h = scoreHist(p, k);
      return p.admitDays < 2 ? L2("dc_src_score", H.nowFull(), tp("dc_l_sc1_tpl", { s:n, b:h[2] }))
        : L2("dc_src_score", `${H.dm(-1)} → ${H.nowFull()}`, tp("dc_l_sc24_tpl", { s:n, d1:H.dm(-1), a:h[1], b:h[2], x:sgn(h[2] - h[1]) })); }); };
  // yatış boyunca (kayıtta en çok 3 günlük değer var): 22.09 9 → 23.09 11 → 24.09 14
  const scoreStayLines = (p) => { const S = scoresOf(p); if (!S.length) return [L2("dc_src_score", "", t("dc_l_noscore"))];
    const n = Math.min(3, Math.max(1, p.admitDays));
    return S.map(([k, nm]) => { const h = scoreHist(p, k).slice(3 - n), days = h.map((v, i) => `${H.dm(i - (n - 1))} ${v}`);
      return L2("dc_src_score", t("dc_daily"), n === 1 ? tp("dc_l_sc1_tpl", { s:nm, b:h[0] }) : tp("dc_l_scst_tpl", { s:nm, seq:days.join(" → "), x:sgn(h[h.length - 1] - h[0]) })); }); };
  // vital: 24 saatlik seri → en düşük / en yüksek / şimdi
  const VIT24 = ["hr", "map", "spo2", "rr", "temp"];
  const vit24Lines = (p) => { const src = p.monitored ? "dc_src_mon" : "dc_src_vit", at = `${H.clockTF(H.nowT() - 24)} → ${H.nowFull()}`;
    const out = VIT24.map(k => { const S = H.series(p.id, k, 24).map(x => +x.v), V = H.VITAL[k], lo = Math.min(...S), hi = Math.max(...S), f = (v) => (k === "temp" ? (+v).toFixed(1) : v);
      return L2(src, at, tp("dc_l_vit_tpl", { k:k === "temp" ? t("dc_v_temp") : V.s, lo:f(lo), hi:f(hi), now:f(p.v[k]), u:V.u === "%" || V.u[0] === "/" ? V.u : " " + (k === "temp" ? "°C" : V.u) })); });
    const a = vitalAt(p); out.push(L2(src, a.at, tp("dc_l_vit_now_tpl", { o2:p.v.o2, loc:p.v.loc }))); return out; };
  // sıvı: careplan.js'in sıvı izlem ızgarası (H.data.ioGrid). Izgara henüz çizilmediyse bir kez çizdirip tohumlanmasını sağlarız.
  const IO_OUT = new Set(["uri", "nefro", "uro", "sisto", "dr1", "dr2", "kusma", "gaita", "ngd", "kan", "irrout", "outoth"]);
  const IO_URI = new Set(["uri", "nefro", "uro", "sisto"]), IO_IRR = new Set(["irrin", "irrout"]);
  const ioOf = (p) => { if (!H.data.ioGrid) return null; if (!H.data.ioGrid[p.id] && H.fluidGrid) { try { H.fluidGrid.html(p); } catch (e) { /* ızgara çizilemezse sıvı satırı "kayıt yok" der */ } } return H.data.ioGrid[p.id] || null; };
  const ioLines = (p) => {
    const D = ioOf(p), at = `${H.dm(0)} 08:00 → ${H.now()}`;
    if (!D) return [L2("dc_src_io", "", t("dc_l_io_none"))];
    let i = 0, o = 0, u = 0, ri = 0, ro = 0, any = false;
    Object.keys(D).forEach(k => Object.values(D[k] || {}).forEach(list => (list || []).forEach(e => { const ml = +e.ml || 0; any = true;
      if (IO_IRR.has(k)) { if (k === "irrin") ri += ml; else ro += ml; return; }
      if (IO_OUT.has(k)) { o += ml; if (IO_URI.has(k)) u += ml; } else i += ml; })));
    if (!any) return [L2("dc_src_io", at, t("dc_l_io_none"))];
    const neo = p.ageGroup === "neonate", r = (v) => neo ? String(Math.round(v * 10) / 10) : String(Math.round(v));
    const hrs = Math.max(1, (nowMin() - 8 * 60) / 60), uk = p.weight ? (u / p.weight / hrs).toFixed(1) : "—";
    const out = [L2("dc_src_io", `${at} · ${t("dc_duty")}`, tp("dc_l_io_tpl", { i:r(i), o:r(o), u:r(u), uk, n:(i - o >= 0 ? "+" : "−") + r(Math.abs(i - o)) }) + ".")];
    if (ri || ro) out.push(L2("dc_src_io", at, tp("dc_l_io_irr_tpl", { a:r(ri), b:r(ro) })));
    return out; };
  const labFmt = (x) => tp("dc_l_lab_tpl", { n:x.n, v:x.v, u:x.u, ar:x.arrow ? " " + x.arrow + (x.crit ? " " + t("dc_l_crit") : "") : "", r:`${x.ref[0]}–${x.ref[1]}` }) + (x.prev ? " · " + tp("dc_l_prev_tpl", { v:x.prev[0], t:x.prev[1] }) : "");
  const newResultLines = (p) => { const A = allLabs(p); if (!A || !A.length) return [L2("dc_src_lab", "", t("dc_l_nolab"))];
    const by = {}; A.forEach(x => { (by[x.at] = by[x.at] || []).push(x); });
    return Object.keys(by).sort().reverse().map(at => L2("dc_src_lab", at, by[at].map(labFmt).join(" · ") + ".")); };
  const abnLines = (p) => { const A = abnormalLabs(p); if (A == null) return [L2("dc_src_lab", "", t("dc_l_nolab"))];
    return A.length ? A.map(x => L2("dc_src_lab", x.at, labFmt(x) + ".")) : [L2("dc_src_lab", `${H.dm(0)} · 06:10`, t("dc_l_labok"))]; };
  const alarmLines2 = (p) => { const A = H.data.alarms.filter(a => a.pid === p.id); if (!A.length) return [L2("dc_src_alarm", "", t("dc_l_noalarm"))];
    return A.map(a => L2("dc_src_alarm", clockAgo(a.ageMin), tp("dc_l_alarm_tpl", { txt:a.txt, sev:(H.SEV[a.sev] || {}).l || a.sev,
      st:a.state === "open" ? t("dc_al_open") + (a.step ? " · " + tp("dc_al_esc_tpl", { n:a.step }) : "") : a.state === "seen" ? t("dc_al_seen") : t("dc_al_closed") }) + ".")); };
  const eventLines = (p) => { const A = H.data.alarms.filter(a => a.pid === p.id), esc = A.filter(a => a.step);
    return alarmLines2(p).concat(esc.length ? [L2("dc_src_alarm", H.nowFull(), tp("dc_l_esc_sum_tpl", { n:esc.length, s:Math.max(...esc.map(a => a.step)) }))] : []); };
  const lineLines = (p) => { const O = ((H.data.nursing || {}).ongoing || []).filter(o => o.pid === p.id);
    const out = O.length ? O.map(o => L2("dc_src_line", "", tp("dc_l_line_tpl", { n:o.name, d:H.dm(-(o.day - 1)), k:o.day }) + ".")) : [L2("dc_src_line", "", t("dc_l_noline"))];
    const dv = (H.data.devices || []).filter(d => d.bedId === p.bed && d.status !== "kullanim_disi");
    if (dv.length) out.push(L2("dc_src_dev", "", tp("dc_l_dev_tpl", { l:dv.map(d => `${H.t("dev_kind_" + d.kind)} (${d.id})`).join(", ") }) + "."));
    return out; };
  const carePlanLines = (p) => { if (!H.isClinical(unitOf(p))) return [L2("dc_src_cp", "", t("dc_l_opunit"))];
    if (!H.carePlan || !H.carePlan.plans) return [L2("dc_src_cp", "", t("dc_l_nocp"))];
    const P = H.carePlan.plans(p.id) || []; if (!P.length) return [L2("dc_src_cp", "", t("dc_l_nocp"))];
    const nm = (pl) => (pl.snap && pl.snap.name) || ((H.CARE_CATALOG || []).find(c => c.key === pl.key) || {}).name || pl.key;
    return P.map(pl => L2("dc_src_cp", "",pl.status === "active" ? tp("dc_l_cp_tpl", { n:nm(pl), at:(pl.start && pl.start.at) || "—" }) : tp("dc_l_cp_end_tpl", { n:nm(pl) })))
      .concat(H.carePlan.summary ? [L2("dc_src_cp", H.nowFull(), H.carePlan.summary(p.id) + ".")] : []); };
  const abxLines2 = (p) => { const out = [];
    if (!p.antibioticDay) out.push(L2("dc_src_med", "", t("dc_l_noabx")));
    else { const m = H.data.tasks.find(x => x.pid === p.id && x.kind === "med" && !x.med); out.push(L2("dc_src_med", "", tp("dc_l_abx_tpl", { m:m ? m.label : t("dc_l_abx"), d:H.dm(-(p.antibioticDay - 1)), n:p.antibioticDay }) + ".")); }
    out.push(L2("dc_src_rec", "", p.allergies.length ? tp("dc_l_allergy_tpl", { x:p.allergies.join(", ") }) + "." : t("dc_l_noallergy")));
    return out; };
  const idLines = (p) => { const u = unitOf(p), who = H.showNames() ? `${p.name} · ` : "";
    const out = [`${who}${H.ageText(p)} · ${p.sex === "E" ? "E" : "K"} · ${t("dc_bed")} ${bedNo(p)}${p.weight ? ` · ${p.weight} kg` : ""}`,
      L2("dc_src_rec", "", tp("dc_l_admit_tpl", { d:H.dmy(admitOff(p)), n:p.admitDays, u:u.tr })),
      L2("dc_src_rec", "", tp("dc_l_dx_tpl", { x:`${p.dx} (${p.icd})` }))];
    if (p.isolation) out.push(L2("dc_src_rec", "", tp("dc_l_iso_tpl", { x:p.isolation })));
    return out; };

  /* ---------- sistemden gelen bulgular (kaynaklı satırlar; TANI YOK) ---------- */
  const L = (src, at, txt) => `[${src}${at ? " · " + at : ""}] ${txt}`;
  const vitLine = (p) => { const v = p.v, a = vitalAt(p); return L(a.src, a.at, `Nabız ${v.hr}/dk · TA ${v.sbp}/${v.dbp} (MAP ${v.map}) · SpO₂ %${v.spo2} (${v.o2}) · solunum ${v.rr}/dk · ateş ${(+v.temp).toFixed(1)} °C · bilinç: ${v.loc}.`); };
  const scoreLine = (p) => H.isClinical(unitOf(p)) ? L("Skor modülü", H.nowFull(), `${H.scoreLabel(p)} (şu anki değer).`) : null;
  const labLines = (p) => { const A = abnormalLabs(p); if (A == null) return [L("Laboratuvar kaydı", "", "Bu hasta için sonuç kaydı yok.")];
    if (!A.length) return [L("Laboratuvar kaydı", `${H.dm(0)} · 06:10`, "Son sonuçlar referans aralığında.")];
    return A.map(x => L("Laboratuvar", x.at, `${x.n} ${x.v} ${x.u} ${x.arrow}${x.crit ? " kritik" : ""} (ref ${x.ref[0]}–${x.ref[1]})${x.prev ? ` · önceki ${x.prev[0]} (${x.prev[1]})` : ""}.`)); };
  const alarmLines = (p, all) => H.data.alarms.filter(a => a.pid === p.id && (all || a.state === "open")).map(a =>
    L("Alarm", clockAgo(a.ageMin), `${a.txt} · ${(H.SEV[a.sev] || {}).l || a.sev} · ${a.state === "open" ? `yanıt bekliyor${a.step ? ` (eskalasyon ${a.step}. adım)` : ""}` : a.state === "seen" ? "görüldü" : "kapandı"}.`));
  const clockAgo = (min) => H.clockTF(H.NOW_T0 - Math.round(min) / 60);   // 30.09c: gerçek saatten geriye, tarihli
  const openTasks = (p, n = 4) => H.data.tasks.filter(t => t.pid === p.id && t.state !== "done" && t.t < 26).sort((a, b) => a.t - b.t).slice(0, n).map(t => `${H.when(Math.floor(t.t % 24), Math.round((t.t % 1) * 60))} ${t.label}`);
  const doneTasks = (p) => { const c = {}; H.data.tasks.filter(t => t.pid === p.id && t.state === "done").forEach(t => { c[t.label] = (c[t.label] || 0) + 1; }); return Object.entries(c).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`); };
  const abxLine = (p) => { if (!p.antibioticDay) return L("İlaç order'ı", "", "Antibiyotik kaydı yok.");
    const m = H.data.tasks.find(t => t.pid === p.id && t.kind === "med" && !t.med);
    return L("İlaç order'ı · hastane kaydı", "", `${m ? m.label : "Antibiyotik"} · başlangıç ${H.dm(-(p.antibioticDay - 1))} · bugün ${p.antibioticDay}. gün.`); };
  const careLine = (p) => H.carePlan && H.carePlan.summary ? L("Bakım planı", H.nowFull(), H.carePlan.summary(p.id) + ".") : L("Bakım planı", "", "Bakım planı modülü yüklenmedi.");
  // Ateş yok: core.js H.series ateşin başlangıcını da risk katsayısıyla ölçekliyor (kritik hastada ~28 °C) — düzelene kadar gidişe alınmaz.
  const TREND_KEYS = ["hr", "map", "spo2", "rr"];
  const trendLine = (p) => { const parts = TREND_KEYS.map(k => { const s = H.series(p.id, k, 24), a = s[0].v, b = p.v[k], V = H.VITAL[k]; return `${V.n} ${a}→${b}${V.u === "%" ? "%" : " " + V.u}`; });
    return L(p.monitored ? "Monitör" : "Vital kayıtları", `${H.clockTF(H.nowT() - 24)} → ${H.nowFull()}`, `24 saatte: ${parts.join(" · ")}.`); };
  const recordLines = (p) => { const u = unitOf(p);
    return [L("Hastane kaydı", "", `Yatış tanısı: ${p.dx} (${p.icd}) · ${u.tr} · yatışın ${p.admitDays}. günü.`),
      L("Hastane kaydı", "", `${p.chronic.length ? "Kronik: " + p.chronic.join(", ") + ". " : "Kronik hastalık kaydı yok. "}${p.allergies.length ? "Alerji: " + p.allergies.join(", ") + "." : "Bilinen alerji yok."}${p.isolation ? ` İzolasyon: ${p.isolation}.` : ""}`)]; };
  const flagLine = (p) => { const f = p.flags || {}, x = [];
    if (f.pain != null) x.push(`ağrı puanı ${f.pain}/10`); if (f.fall) x.push(`düşme riski ${f.fall}`); if (f.braden) x.push(`bası yarası riski ${f.braden}`);
    return x.length ? L("Hemşirelik formları", painAt(p), x.join(" · ") + ".") : null; };
  // 30.09 · kontrol §4-6: sabit "09:00" yerine son gerçek ağrı kaydının saati
  const painAt = (p) => { const e = H.lastEntry && H.lastEntry(p.id, "pain"); return e ? H.entryFull(e) : H.dm(0); };

  // Bölüm → sistemden doldurulacak satırlar. Boş dizi = sistemde bu bölüme ait kayıt yok.
  const FILL = {
    yakinma:(p) => [p.flags && p.flags.pain != null ? L("Ağrı formu", painAt(p), `Ağrı puanı ${p.flags.pain}/10.`) : null],
    oyku:(p) => [...recordLines(p), p.antibioticDay ? abxLine(p) : null],
    seyir:(p) => [trendLine(p), scoreLine(p), ...alarmLines(p, true)],
    fizik:(p) => [vitLine(p), flagLine(p)],
    deger:(p) => ["Sistem bulguları (tanı değildir; değerlendirme hekimindir):", scoreLine(p), ...labLines(p), ...alarmLines(p, false)],
    plan:(p) => { const o = openTasks(p); return [o.length ? L("Görev planı", "", "Sıradaki işler: " + o.join(" · ") + ".") : null, H.isClinical(unitOf(p)) ? careLine(p) : null, p.antibioticDay ? abxLine(p) : null]; },
    gozlem:(p) => [vitLine(p), flagLine(p), ...alarmLines(p, false)],
    bakim:(p) => { const d = doneTasks(p); return [d.length ? L("Görev planı", `${H.dm(0)} · 08:00 → ${H.now()}`, "Tamamlanan: " + d.join(" · ") + ".") : null, H.isClinical(unitOf(p)) ? careLine(p) : null]; },
    teslim:(p) => { const o = openTasks(p); return [o.length ? L("Görev planı", "", "Açık işler: " + o.join(" · ") + ".") : L("Görev planı", "", "Açık iş yok.")]; },
    // #8 günlük izlem iskeleti · yalnız ölçülmüş değer
    vit24:vit24Lines, skor24:score24Lines, sivi24:ioLines, sonuc24:newResultLines, olay24:alarmLines2,
  };
  const AUTO = { izlem:["vit24", "skor24", "sivi24", "sonuc24", "olay24"] };   // yeni notta hazır gelen bölümler
  const SRC_TAGS = { yakinma:["Ağrı formu"], oyku:["Hastane kaydı", "İlaç order'ı"], seyir:["Monitör", "Skor", "Alarmlar"], fizik:["Vital", "Hemşirelik formları"], deger:["Skor", "Laboratuvar", "Açık alarmlar"],
    plan:["Görevler", "Bakım planı"], gozlem:["Vital", "Formlar", "Alarmlar"], bakim:["Görevler", "Bakım planı"], teslim:["Görevler"],
    yatis:["Hastane kaydı"], izlem:["Monitör", "Skor"], alarm:["Alarm kaydı"], sonuc:["Laboratuvar"], abx:["İlaç order'ı"], bakimp:["Bakım planı", "Teslim notları"], taburcu:["Hekim yazar"],
    vit24:["dc_src_mon"], skor24:["dc_src_score"], sivi24:["dc_src_io"], sonuc24:["dc_src_lab"], olay24:["dc_src_alarm"],
    tkim:["dc_src_rec"], tskor:["dc_src_score"], tolay:["dc_src_alarm"], tcihaz:["dc_src_line", "dc_src_dev"], tbakim:["dc_src_cp"], tsonuc:["dc_src_lab"],
    tilac:["dc_src_med", "dc_src_rec"], tsivi:["dc_src_io"] };
  const tagText = (x) => (/^dc_/.test(x) ? t(x) : x);

  /* ---------- epikriz derleme ---------- */
  function compileEpi(p) {
    const u = unitOf(p), off = admitOff(p);
    const who = H.showNames() ? `${p.name} · ` : "";
    const hand = H.data.handovers.filter(h => h.pid === p.id);
    const A = abnormalLabs(p);
    return {
      yatis:[`${who}${H.ageText(p)} · ${p.sex === "E" ? "Erkek" : "Kadın"} · yatak ${bedNo(p)} · ${u.tr}.`,
        L("Hastane kaydı", "", `Yatış tarihi ${H.dmy(off)} · bugün ${H.dmy(0)}, yatışın ${p.admitDays}. günü.`),
        ...recordLines(p)].join("\n"),
      izlem:[...scoreStayLines(p), trendLine(p)].filter(Boolean).join("\n"),
      alarm:(alarmLines(p, true).join("\n") || L("Alarm kaydı", "", "Yatış boyunca kayıtlı alarm yok.")),
      sonuc:(A == null ? L("Laboratuvar kaydı", "", "Sonuç kaydı yok.") : A.length ? A.map(x => L("Laboratuvar", x.at, `${x.n}: ${x.prev ? `${x.prev[0]} (${x.prev[1]}) → ` : ""}${x.v} ${x.u} ${x.arrow}${x.crit ? " kritik" : ""} · ref ${x.ref[0]}–${x.ref[1]}.`)).join("\n")
        : L("Laboratuvar kaydı", `${H.dm(0)} · 06:10`, "Son sonuçlar referans aralığında.")),
      abx:abxLine(p),
      bakimp:[H.isClinical(u) ? careLine(p) : L("Bakım planı", "", "Operasyonel birim; bakım planı tutulmuyor."),
        L("Teslim notları", "", hand.length ? `${hand.length} teslim kaydı (${hand.filter(h => h.state === "waiting").length} teslim alınmayı bekliyor).` : "Teslim kaydı yok.")].join("\n"),
      taburcu:"",
    };
  }

  /* ---------- #9 transfer özeti derleme (tek sayfa; tanı yok, transfer nedenini hekim yazar) ---------- */
  function compileTr(p) {
    const j = (a) => a.filter(Boolean).join("\n");
    return { tkim:j(idLines(p)), tskor:j(scoreStayLines(p)), tolay:j(eventLines(p)), tcihaz:j(lineLines(p)), tbakim:j(carePlanLines(p)),
      tsonuc:j(abnLines(p)), tilac:j(abxLines2(p)), tsivi:j(ioLines(p)), tneden:"" };
  }
  const SYS = { epikriz:compileEpi, transfer:compileTr };        // sistemin derlediği belgeler
  const KEEP = { epikriz:"taburcu", transfer:"tneden" };         // yeniden derlemede korunan hekim bölümü
  const isSys = (d) => !!SYS[d.type];

  /* ================= belge türleri ================= */
  const TYPES = {
    muayene:{ name:"Muayene notu", icon:"user", role:"hekim", secs:[["yakinma", "Yakınma"], ["oyku", "Öykü"], ["fizik", "Fizik muayene"], ["deger", "Değerlendirme"], ["plan", "Plan"]] },
    izlem:{ name:"Günlük izlem notu", nameK:"dc_t_izlem", icon:"activity", role:"hekim", secs:[["vit24", "dc_s_vit24"], ["skor24", "dc_s_skor24"], ["sivi24", "dc_s_sivi24"], ["sonuc24", "dc_s_sonuc24"],
      ["olay24", "dc_s_olay24"], ["fizik", "dc_s_fizik"], ["deger", "dc_s_deger"], ["plan", "dc_s_plan"]] },
    transfer:{ name:"Transfer özeti", nameK:"dc_t_transfer", icon:"swap", role:"hekim", page:true, secs:[["tkim", "dc_s_tkim"], ["tskor", "dc_s_tskor"], ["tolay", "dc_s_tolay"], ["tcihaz", "dc_s_tcihaz"],
      ["tbakim", "dc_s_tbakim"], ["tsonuc", "dc_s_tsonuc"], ["tilac", "dc_s_tilac"], ["tsivi", "dc_s_tsivi"], ["tneden", "dc_s_tneden"]] },
    hemsire:{ name:"Hemşirelik notu", icon:"clip", role:"hemsire", secs:[["gozlem", "Gözlem"], ["bakim", "Yapılan bakım"], ["teslim", "Teslim / plan"]] },
    epikriz:{ name:"Epikriz taslağı", icon:"file", role:"hekim", secs:[["yatis", "Yatış bilgisi"], ["izlem", "İzlem özeti"], ["alarm", "Önemli alarmlar ve yanıtları"], ["sonuc", "Referans dışı sonuç gidişi"], ["abx", "Antibiyotik günleri"], ["bakimp", "Bakım planı ve teslim özeti"], ["taburcu", "Taburcu durumu ve öneriler"]] },
  };
  const tName = (type) => (TYPES[type].nameK ? t(TYPES[type].nameK) : TYPES[type].name);
  const sLabel = (l) => (/^dc_/.test(l) ? t(l) : l);
  const VKEYS = [["hr", "Nabız", "/dk", "--v-hr"], ["sbp", "Sistolik", "mmHg", "--v-map"], ["dbp", "Diyastolik", "mmHg", "--v-map"], ["map", "MAP", "mmHg", "--v-map"], ["spo2", "SpO₂", "%", "--v-spo"], ["rr", "Solunum", "/dk", "--v-rr"], ["temp", "Ateş", "°C", "--v-t"]];
  const VTEXT = [["o2", "Oksijen"], ["loc", "Bilinç"]];

  let seq = 0;
  const newDoc = (p, type, o = {}) => { const d = Object.assign({ id:"doc" + (++seq), pid:p.id, type, at:H.nowFull(), by:me(), status:"taslak", sec:{}, addenda:[], savedAt:null, dirty:false }, o);
    TYPES[type].secs.forEach(([k]) => { if (d.sec[k] == null) d.sec[k] = ""; });
    if (TYPES[type].secs.some(([k]) => k === "fizik") && !d.vit) { const a = vitalAt(p); d.vit = Object.assign({}, p.v); d.vitSrc = a; d.vitEd = {}; }
    H.data.docs.push(d); return d; };

  // Yeni izlem notunda son 24 saat hazır gelir (#8). Her bölümün sistemden gelen metni d.auto'da tutulur:
  // hekim dokunmadıysa "Sistemden doldur" yeniler, dokunduysa sonuna ekler.
  const prefill = (p, d) => { (AUTO[d.type] || []).forEach(k => { const v = FILL[k](p).filter(Boolean).join("\n"); d.sec[k] = v; (d.auto = d.auto || {})[k] = v; }); };

  // İlk açılışta kayıttaki belgeler. İçerikleri yalnız kayıttan türetilir (kodda: sentetik; ekranda etiket yok — Ozan kararı).
  function seed(p) {
    if (H.data.docs.some(d => d.pid === p.id && d.type === "epikriz")) return;
    const clinical = H.isClinical(unitOf(p));
    if (clinical && p.admitDays >= 2 && p.attending) {
      const d = newDoc(p, "izlem", { by:p.attending, at:H.atFull("09:20", -1), status:"muhur", sealedBy:p.attending, sealedAt:H.atFull("09:48", -1) });
      // Dünkü not: yalnız dünün kayıtta olan değeri (günlük skor) yazılır; dünkü vital/sıvı dizisi bellekte yok, boş kalır.
      const S = scoresOf(p);
      d.sec.skor24 = S.length ? S.map(([k, n]) => { const h = scoreHist(p, k); return p.admitDays >= 3 ? L2("dc_src_score", `${H.dm(-2)} → ${H.dm(-1)}`, `${n}: ${H.dm(-2)} ${h[0]} → ${H.dm(-1)} ${h[1]} · ${sgn(h[1] - h[0])}`) : L2("dc_src_score", H.dm(-1), `${n}: ${h[1]}`); }).join("\n") : "";
      d.sec.fizik = "Sabah viziti · muayene bulguları hastane kaydındaki muayene notunda.";
      d.sec.deger = "Değerlendirme hastane kaydındaki muayene notunda."; d.sec.plan = L("Görev planı", "", "Vital izlem hemşirelik planında; order'lar hastane kaydında.");
      d.vit = null;   // dünkü vital değerleri bellekte yok; bugünküleri dünün belgesine koymayız
    }
    if (clinical && p.nurse) {
      const d = newDoc(p, "hemsire", { by:p.nurse, at:H.atFull("20:10"), status:"muhur", sealedBy:p.nurse, sealedAt:H.atFull("20:14"), demo:true });
      d.sec.gozlem = L("Vital formu", H.atFull("20:00"), "Vital bulgular kaydedildi (form)."); d.sec.bakim = (FILL.bakim(p).filter(Boolean).join("\n"));
      d.sec.teslim = FILL.teslim(p).filter(Boolean).join("\n");
    }
    const e = newDoc(p, "epikriz", { by:"sistem", at:H.nowFull() }); Object.assign(e.sec, compileEpi(p)); e.compiledAt = H.nowFull();
    const tr = newDoc(p, "transfer", { by:"sistem", at:H.nowFull() }); Object.assign(tr.sec, compileTr(p)); tr.compiledAt = H.nowFull();
  }
  const RANK = { epikriz:0, transfer:1 };
  const docsOf = (pid) => H.data.docs.filter(d => d.pid === pid).sort((a, b) => ((RANK[a.type] ?? 9) - (RANK[b.type] ?? 9)) || (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
  const UI = {};
  const ui = (pid) => UI[pid] || (UI[pid] = { sel:null });

  const canEdit = (d) => d.status === "taslak" && (d.type === "hemsire" ? isNurse() : isDoc());
  const canSeal = (d) => d.status === "taslak" && d.type !== "epikriz" && (d.type === "hemsire" ? isNurse() : isDoc());
  const canAdd = (d) => d.status === "muhur" && (d.type === "hemsire" ? isNurse() || isDoc() : isDoc());
  const canSend = (d) => isSys(d) && isDoc();

  /* ================= görünüm ================= */
  const stTag = (d) => isSys(d) && d.status === "taslak" ? `<span class="dc-st s">${H.icon("zap")}${esc(t("dc_sys_tag"))}</span>`
    : d.status === "muhur" ? `<span class="dc-st m">${H.icon("lock")}mühürlendi</span>` : `<span class="dc-st t">${H.icon("edit")}taslak</span>`;

  function listHtml(p, sel) {
    const L0 = docsOf(p.id);
    return `<aside class="dc-list"><div class="dc-lh"><b>Belgeler</b><span>${L0.length} belge</span></div>
      <div class="dc-new">${isDoc() ? `<button class="btn p" data-dc-new="muayene">${H.icon("plus")}Yeni muayene notu</button><button class="btn sm" data-dc-new="izlem">${H.icon("plus")}${esc(t("dc_t_izlem"))}</button>`
        : isNurse() ? `<button class="btn p" data-dc-new="hemsire">${H.icon("plus")}Yeni hemşirelik notu</button>` : `<span class="mute" style="font-size:12px">Belge yazma yetkiniz yok; yalnız okuyabilirsiniz.</span>`}</div>
      <div class="dc-items">${L0.map(d => `<button class="dc-it ${d.id === sel ? "on" : ""}" data-dc-open="${d.id}"><span class="dc-ic">${H.icon(TYPES[d.type].icon)}</span>
        <b>${esc(tName(d.type))}</b><small>${esc(d.at)} · ${esc(short(d.by))}</small>${stTag(d)}</button>`).join("")}</div></aside>`;
  }

  const DICT_NOTE = `<div class="dc-info">${MIC}<div><b>Sesle yazdırma.</b> Bölümün yanındaki mikrofona basın, konuşun; söyledikleriniz o bölüme yazılır. Komutlar: <b>“yeni satır”</b>, <b>“nokta”</b>, <b>“virgül”</b>.
    Ses şu an tarayıcının ses tanımasıyla metne çevrilir (Chrome'da ses Google'a gider). Hastane sunucusunda çalışan sürüme geçilene kadar hasta kimliği söylemeyin.</div></div>`;

  function secHtml(p, d, k, label, edit) {
    const val = d.sec[k] || "";
    const tags = (SRC_TAGS[k] || []).map(x => `<span class="dc-src">${H.icon("link")}${esc(tagText(x))}</span>`).join("");
    const canFill = edit && k !== "taburcu" && k !== "tneden";
    let vit = "";
    if (k === "fizik" && d.vit) {
      const f = (key, lab, u, c, wide) => `<label class="dc-vf ${wide ? "wide" : ""} ${d.vitEd && d.vitEd[key] ? "ed" : ""}" style="${c ? `--c:var(${c})` : ""}" data-dc-vf="${key}"><small>${lab}<i>${u || ""}</i></small>
        <input ${wide ? "" : 'inputmode="decimal"'} data-dc-v="${key}" value="${esc(d.vit[key])}" ${edit ? "" : "disabled"}><span class="dc-edt">hekim düzeltti</span></label>`;
      vit = `<div class="dc-vg">${VKEYS.map(([a, b, c, e]) => f(a, b, c, e)).join("")}${VTEXT.map(([a, b]) => f(a, b, "", "", true)).join("")}</div>
        <div class="dc-vsrc">${H.icon("link")}<span>Vital bulgular sistemden dolduruldu · <b>${esc(d.vitSrc.src)}</b> · ${esc(d.vitSrc.at)}. Düzelttiğiniz alan sarı işaretlenir ve belgeye “hekim düzeltti” diye geçer.</span>
        ${edit ? `<button class="btn g sm" data-dc-vref>${H.icon("swap")}Güncel değerlerle yenile</button>` : ""}</div>`;
    }
    if (!edit) return `<div class="dc-sec"><div class="dc-sh"><b>${label}</b></div>${vit}<div class="dc-ro ${val ? "" : "empty"}">${val ? esc(val) : "— boş —"}</div></div>`;
    return `<div class="dc-sec" data-dc-sec="${k}"><div class="dc-sh"><b>${label}</b>${tags}<span class="r">
        ${canFill ? `<button class="btn g sm" data-dc-fill="${k}" title="Kayıttaki bulguları kaynağı ve saatiyle ekler; tanı yazmaz">${H.icon("zap")}Sistemden doldur</button>` : ""}
        <button class="dc-mic" data-dc-mic="${k}" title="Sesle yazdır" aria-label="${label} · sesle yazdır">${MIC}</button></span></div>
      ${vit}<textarea data-dc-ta="${k}" rows="${Math.min(12, Math.max(3, val.split("\n").length + 1))}" placeholder="${k === "deger" ? "Hekimin değerlendirmesi · sistem bu bölüme tanı yazmaz" : k === "tneden" ? esc(t("dc_ph_tneden")) : "Yazın ya da mikrofona basıp söyleyin"}">${esc(val)}</textarea>
      <div class="dc-live hidden" data-dc-live="${k}"><span class="dc-dot"></span><b>Dinliyorum…</b><span class="dc-mode"></span><button class="btn sm" data-dc-stop>${H.icon("x")}Durdur</button><div class="dc-int"></div></div></div>`;
  }

  function editorHtml(p, d) {
    if (!d) return `<div class="dc-ed"><div class="dc-empty">Soldan bir belge seçin ya da yeni not başlatın.</div></div>`;
    const T = TYPES[d.type], edit = canEdit(d), epi = d.type === "epikriz", sys = isSys(d), U = ui(p.id);
    const pageBtn = T.page ? `<button class="btn sm" data-dc-page>${H.icon(U.page ? "edit" : "file")}${esc(t(U.page ? "dc_page_off" : "dc_page_on"))}</button>` : "";
    const head = `<div class="dc-eh"><div><h4>${esc(tName(d.type))} </h4>
      <div class="dc-meta">Yatak <b>${esc(bedNo(p))}</b>${H.showNames() ? ` · <b>${esc(p.name)}</b>` : ""} · ${esc(d.at)} · ${sys ? `derleyen <b>Homunculus</b> · düzenleyen hekim` : `yazan <b>${esc(short(d.by))}</b>`}</div></div>
      <div class="r">${pageBtn}${stTag(d)}${d.status === "taslak" && d.by === me() && !sys ? `<button class="btn g sm" data-dc-del>${H.icon("trash")}Taslağı sil</button>` : ""}</div></div>`;
    const sendBar = canSend(d) ? `<button class="btn ${d.status === "muhur" ? "p" : ""}" data-dc-send>${H.icon("link")}${esc(t("dc_send"))}</button>${d.sentAt ? `<span class="dc-sent">${esc(tp("dc_sent_at_tpl", { t:d.sentAt }))}</span>` : ""}` : "";
    const sendNote = canSend(d) ? H.adminNote("Hastane kaydı (HBYS) bağlantısı kurulmadı: “Hastane kaydına gönder” şimdilik yalnız bildirim gösterir ve denetim kaydına yazar.", "div") : "";
    if (T.page && U.page) return `<div class="dc-ed">${head}${pageHtml(p, d)}<div class="dc-bar">${sendBar}<span class="dc-stat">${esc(tp("dc_compiled_tpl", { t:d.compiledAt || d.at }))}</span></div>${sendNote}</div>`;
    const infos = [];
    if (epi) infos.push(`<div class="dc-info w">${H.icon("alert")}<div><b>Epikriz hastanenin resmî belgesidir.</b> Homunculus yatış boyunca kaydedilen veriden taslak hazırlar, hekim düzenler ve <b>hastane kaydında sonlandırır</b>. Taslak tanı içermez; köşeli parantezdeki her satır kaynağını ve saatini taşır.</div></div>`);
    if (d.type === "transfer") infos.push(`<div class="dc-info">${H.icon("swap")}<div>${t("dc_info_tr")}</div></div>`);
    if (d.type === "izlem" && d.status === "taslak") infos.push(`<div class="dc-info">${H.icon("activity")}<div>${t("dc_info_izlem")}</div></div>`);
    if (edit) infos.push(DICT_NOTE);
    else if (d.status === "taslak") infos.push(`<div class="dc-info">${H.icon("eye")}<div>Bu taslağı yalnız görüntüleyebilirsiniz; ${d.type === "hemsire" ? "hemşirelik notunu hemşire" : "hekim belgesini hekim"} düzenler.</div></div>`);
    let body = T.secs.map(([k, l]) => secHtml(p, d, k, sLabel(l), edit)).join("");
    let foot = "";
    if (d.status === "muhur") {
      foot = `<div class="dc-seal">${H.icon("lock")}Mühürlendi · ${esc(short(d.sealedBy))} · ${esc(d.sealedAt)} <span>· değiştirilemez, yalnız ek not eklenir</span></div>
        ${d.addenda.map(a => `<div class="dc-add"><small>Ek not · ${esc(short(a.by))} · ${esc(a.at)} · mühürlü</small><div class="dc-ro">${esc(a.text)}</div></div>`).join("")}
        ${canAdd(d) ? `<div class="dc-sec" data-dc-sec="ek"><div class="dc-sh"><b>Ek not</b><span class="r"><button class="dc-mic" data-dc-mic="ek" title="Sesle yazdır">${MIC}</button></span></div>
          <textarea data-dc-ta="ek" placeholder="Mühürlü belgeye ek not · yazın ya da söyleyin">${esc(d.addDraft || "")}</textarea>
          <div class="dc-live hidden" data-dc-live="ek"><span class="dc-dot"></span><b>Dinliyorum…</b><span class="dc-mode"></span><button class="btn sm" data-dc-stop>${H.icon("x")}Durdur</button><div class="dc-int"></div></div>
          <div class="dc-bar" style="border:0;padding-top:8px"><button class="btn p" data-dc-addok>${H.icon("lock")}Ek notu mühürle</button><span class="dc-stat">Ek not da mühürlenir; asıl belge değişmez.</span></div></div>` : ""}
        ${sendBar ? `<div class="dc-bar">${sendBar}</div>${sendNote}` : ""}`;
    } else if (epi) {
      foot = `<div class="dc-bar">${edit ? `<button class="btn p" data-dc-save>${H.icon("file")}Taslağı sakla</button><button class="btn" data-dc-recomp>${H.icon("swap")}Veriden yeniden derle</button>` : ""}
        ${sendBar}
        <span class="dc-stat ${d.dirty ? "dirty" : ""}" data-dc-stat>${statText(d)}</span>
        <span class="dc-why">Gönderilen taslak hastane kaydının epikriz ekranına düşer, hekim orada sonlandırır. Sistem son derleme: ${esc(d.compiledAt || d.at)}.</span></div>${sendNote}`;
    } else if (edit) {
      foot = `<div class="dc-bar"><button class="btn" data-dc-save>${H.icon("file")}Taslağı sakla</button>
        ${canSeal(d) ? `<button class="btn p" data-dc-seal>${H.icon("lock")}Mühürle</button>` : ""}
        ${sys ? `<button class="btn" data-dc-recomp>${H.icon("swap")}Veriden yeniden derle</button>` : ""}${sendBar}
        <span class="dc-stat ${d.dirty ? "dirty" : ""}" data-dc-stat>${statText(d)}</span>
        <span class="dc-why">Mühürlenen belge değiştirilemez; sonradan yalnız ek not eklenir. ${d.type === "hemsire" ? "Hemşirelik notunu hemşire mühürler." : "Hekim belgesini yalnız hekim mühürler."}${sys ? ` Sistem son derleme: ${esc(d.compiledAt || d.at)}.` : ""}</span></div>${sendNote}`;
    } else if (d.status === "taslak") {
      foot = `<div class="dc-bar"><span class="dc-stat">${d.type === "hemsire" ? "Hemşire mühürleyince kesinleşir." : "Hekim mühürleyince kesinleşir."}</span></div>`;
    }
    return `<div class="dc-ed">${head}${infos.join("")}${body}${foot}</div>`;
  }
  // #9 · tek sayfa: başlık + iki sütunlu bölümler; 640px altında tek sütun
  function pageHtml(p, d) {
    const T = TYPES[d.type], u = unitOf(p);
    const blk = ([k, l]) => { const v = d.sec[k] || "", full = k === "tkim" || k === "tskor" || k === "tolay";
      return `<section class="dc-pb ${full ? "full" : ""}"><h6>${esc(sLabel(l))}</h6><div class="${v ? "" : "empty"}">${v ? esc(v) : "—"}</div></section>`; };
    return `<article class="dc-page"><header class="dc-ph"><h5>${esc(tName(d.type))}</h5>
        <span>${esc(t("dc_bed"))} <b>${esc(bedNo(p))}</b></span><span><b>${esc(u.tr)}</b></span>
        <span>${esc(t("dc_admit"))} <b>${esc(H.dmy(admitOff(p)))}</b> · ${esc(tp("dc_day_tpl", { n:p.admitDays }))}</span>
        <span>${esc(tp("dc_compiled_tpl", { t:d.compiledAt || d.at }))}</span>
        <span>${d.status === "muhur" ? `${H.icon("lock")} <b>${esc(short(d.sealedBy))}</b> · ${esc(d.sealedAt)}` : esc(t("dc_page_by"))}</span></header>
      <div class="dc-pg">${T.secs.map(blk).join("")}</div>
      <div class="dc-pf">${esc(t("dc_page_foot"))}</div></article>`;
  }
  const statText = (d) => d.dirty ? "Saklanmamış değişiklik var" : d.savedAt ? `Taslak saklandı · ${d.savedAt}` : "Henüz saklanmadı";

  function inner(p) {
    seed(p);
    const U = ui(p.id), L0 = docsOf(p.id);
    if (!U.sel || !L0.some(d => d.id === U.sel)) U.sel = (L0.find(d => d.type !== "epikriz" && d.status === "taslak" && d.by === me()) || L0[0] || {}).id || null;
    const d = L0.find(x => x.id === U.sel);
    return listHtml(p, U.sel) + editorHtml(p, d);
  }

  /* ================= sesle yazdırma ================= */
  const LANGMAP = { AZ:"az-AZ", TR:"tr-TR", RU:"ru-RU", EN:"en-US" };
  const CMDS = { TR:[["yeni satır", "\n"], ["nokta", "."], ["virgül", ","]], AZ:[["yeni sətir", "\n"], ["nöqtə", "."], ["vergül", ","]],
    RU:[["новая строка", "\n"], ["точка", "."], ["запятая", ","]], EN:[["new line", "\n"], ["full stop|period", "."], ["comma", ","]] };
  const applyCmd = (raw) => {
    let t = " " + raw.trim() + " ";
    const list = (CMDS[H.state.lang] || []).concat(H.state.lang === "TR" ? [] : CMDS.TR);
    list.forEach(([w, r]) => { t = t.replace(new RegExp(`\\s+(?:${w})(?=[\\s.,!?]|$)`, "giu"), r === "\n" ? "\n" : r); });
    t = t.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/([.,])(?=[^\s\n.,])/g, "$1 ").replace(/^ +| +$/g, "");
    return t.replace(/([.!?]\s+|\n)(\p{Ll})/gu, (m, a, c) => a + c.toLocaleUpperCase("tr"));
  };
  const SAMPLE = {
    yakinma:"hastanın kendi ifadesiyle yakınması buraya yazılır nokta",
    oyku:"yatıştan bu yana seyir buraya yazılır nokta yeni satır önceki hastalıklar hastane kaydında nokta",
    seyir:"son yirmi dört saatin özeti buraya yazılır nokta",
    fizik:(p) => `bilinç ${String(p.v.loc).toLowerCase()} virgül solunum sayısı dakikada ${p.v.rr} nokta yeni satır sistem muayenesi bulguları buraya yazılır nokta`,
    deger:"hekimin değerlendirmesi buraya yazılır nokta",
    plan:"izlem ve tetkik planı buraya yazılır nokta",
    gozlem:"vardiya gözlemi buraya yazılır nokta", bakim:"yapılan bakım buraya yazılır nokta", teslim:"teslim edilecek konular buraya yazılır nokta",
    taburcu:"taburcu durumu ve önerileri buraya yazılır nokta", ek:"ek not buraya yazılır nokta",
  };
  const sampleFor = (p, k) => { const s = SAMPLE[k] || "not buraya yazılır nokta"; return typeof s === "function" ? s(p) : s; };

  let DICT = null;                   // { doc, k, ta, live, btn, rec, timer }
  function stopDict() {
    const D = DICT; DICT = null; if (!D) return;
    if (D.timer) clearInterval(D.timer);
    if (D.rec) { const r = D.rec; D.rec = null; try { r.onend = null; r.stop(); } catch (e) {} }
    if (D.live && D.live.isConnected) { D.live.classList.add("hidden"); const i = D.live.querySelector(".dc-int"); if (i) i.textContent = ""; }
    if (D.btn && D.btn.isConnected) D.btn.classList.remove("on");
    if (D.sec && D.sec.isConnected) D.sec.classList.remove("live");
  }
  function appendText(D, raw) {
    const txt = applyCmd(raw); if (!txt) return;
    const ta = D.ta, cur = ta.value;
    const sep = !cur || /\s$/.test(cur) || /^[\n.,]/.test(txt) ? "" : " ";
    let add = txt; if (!cur || /[.!?]\s*$|\n$/.test(cur)) add = add.replace(/^\p{Ll}/u, c => c.toLocaleUpperCase("tr"));
    ta.value = cur + sep + add;
    setSec(D.doc, D.k, ta.value); markDirty(D.root, D.doc);
  }
  const setSec = (d, k, v) => { if (k === "ek") d.addDraft = v; else d.sec[k] = v; };
  const markDirty = (root, d) => { if (d.status !== "taslak") return; d.dirty = true; const s = root && root.querySelector("[data-dc-stat]"); if (s) { s.textContent = statText(d); s.classList.add("dirty"); } };

  function simulate(D, why) {
    D.rec = null; D.mode.textContent = why; const text = sampleFor(D.p, D.k); let i = 0, buf = "";
    const cmdEnd = new RegExp(`(?:${(CMDS.TR).map(c => c[0]).join("|")})$`, "iu");
    D.timer = setInterval(() => {
      if (!D.ta.isConnected || DICT !== D) { clearInterval(D.timer); return; }
      buf += text[i++] || ""; D.int.textContent = buf;
      if (i >= text.length || (cmdEnd.test(buf) && (text[i] === " " || i >= text.length))) { appendText(D, buf); buf = ""; D.int.textContent = ""; }
      if (i >= text.length) { clearInterval(D.timer); D.timer = null; setTimeout(() => { if (DICT === D) stopDict(); }, 700); }
    }, 38);
  }
  function startDict(root, p, doc, k) {
    const same = DICT && DICT.doc === doc && DICT.k === k; stopDict(); if (same) return;
    const sec = root.querySelector(`[data-dc-sec="${k}"]`); if (!sec) return;
    const D = { root, p, doc, k, sec, ta:sec.querySelector("textarea"), live:sec.querySelector(".dc-live"), btn:sec.querySelector("[data-dc-mic]") };
    D.int = D.live.querySelector(".dc-int"); D.mode = D.live.querySelector(".dc-mode");
    D.live.classList.remove("hidden"); D.btn.classList.add("on"); sec.classList.add("live"); DICT = D;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { simulate(D, "· Bu tarayıcıda ses tanıma yok — örnek dikte"); H.log("Sesle yazdırma (örnek dikte)", `${bedNo(p)} · ${TYPES[doc.type].name}`); return; }
    try {
      const rec = new SR(); rec.lang = LANGMAP[H.state.lang] || "tr-TR"; rec.continuous = true; rec.interimResults = true; D.rec = rec;
      rec.onresult = (e) => { if (DICT !== D || !D.ta.isConnected) { stopDict(); return; } let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) appendText(D, r[0].transcript); else interim += r[0].transcript; }
        D.int.textContent = interim; };
      rec.onerror = (e) => { if (DICT !== D) return; if (["not-allowed", "service-not-allowed", "audio-capture", "network"].includes(e.error)) { const r = D.rec; D.rec = null; try { r.onend = null; r.abort(); } catch (x) {}
        simulate(D, e.error === "not-allowed" || e.error === "service-not-allowed" ? "· Mikrofon izni verilmedi — örnek dikte" : "· Ses tanıma kullanılamadı — örnek dikte"); } };
      rec.onend = () => { if (DICT === D && D.rec === rec) stopDict(); };
      rec.start(); D.mode.textContent = `· tarayıcının ses tanıması · ${rec.lang}`;
      H.log("Sesle yazdırma başladı", `${bedNo(p)} · ${TYPES[doc.type].name} · ${rec.lang}`);
    } catch (err) { simulate(D, "· Ses tanıma başlatılamadı — örnek dikte"); }
  }

  /* ================= olaylar ================= */
  function after(el, p) {
    const root = el && (el.matches && el.matches(".dc-root") ? el : el.querySelector(".dc-root"));
    if (!root) return;
    const cur = () => H.data.docs.find(d => d.id === ui(p.id).sel);
    const rerender = () => { stopDict(); root.innerHTML = inner(p); };
    root.onclick = (e) => {
      const T = e.target;
      const op = T.closest("[data-dc-open]"); if (op) { ui(p.id).sel = op.dataset.dcOpen; rerender(); return; }
      const nw = T.closest("[data-dc-new]"); if (nw) { const t = nw.dataset.dcNew; if (t === "hemsire" ? !isNurse() : !isDoc()) return;
        const d = newDoc(p, t); prefill(p, d); ui(p.id).sel = d.id; ui(p.id).page = false; H.log(`${TYPES[t].name} başlatıldı`, bedNo(p)); rerender(); return; }
      const d = cur(); if (!d) return;
      if (T.closest("[data-dc-page]")) { ui(p.id).page = !ui(p.id).page; rerender(); return; }
      if (T.closest("[data-dc-send]")) { if (!canSend(d)) return; d.sentAt = H.nowFull();
        H.log(`${TYPES[d.type].name} hastane kaydına gönderildi`, `${bedNo(p)} · ${d.status}`); H.toast(tp("dc_sent_tpl", { d:tName(d.type), t:d.sentAt })); rerender(); return; }
      const mic = T.closest("[data-dc-mic]"); if (mic) { startDict(root, p, d, mic.dataset.dcMic); return; }
      if (T.closest("[data-dc-stop]")) { stopDict(); return; }
      const fl = T.closest("[data-dc-fill]"); if (fl) { if (!canEdit(d)) return; const k = fl.dataset.dcFill, lines = (SYS[d.type] ? [SYS[d.type](p)[k]] : FILL[k] ? FILL[k](p) : []).filter(Boolean);
        if (!lines.length) { H.toast("Sistemde bu bölüme ait kayıt yok; yazın ya da söyleyin", "w"); return; }
        const ta = root.querySelector(`[data-dc-ta="${k}"]`), fresh = lines.join("\n");
        const untouched = d.auto && d.auto[k] != null && ta.value === d.auto[k];     // hekim dokunmadıysa yenile, dokunduysa ekle
        ta.value = untouched || !ta.value.trim() ? fresh : ta.value.replace(/\s+$/, "") + "\n" + fresh;
        if (untouched) d.auto[k] = fresh;
        setSec(d, k, ta.value); markDirty(root, d); H.log("Belgeye sistemden bulgu eklendi", `${bedNo(p)} · ${TYPES[d.type].name} · ${k}`); H.toast("Kayıttaki bulgular kaynağıyla eklendi · tanı eklenmez"); return; }
      if (T.closest("[data-dc-vref]")) { if (!canEdit(d)) return; d.vit = Object.assign({}, p.v); d.vitSrc = vitalAt(p); d.vitEd = {}; markDirty(root, d); rerender(); H.toast("Vital bulgular güncel değerlerle yenilendi"); return; }
      if (T.closest("[data-dc-save]")) { if (!canEdit(d)) return; d.savedAt = H.nowFull(); d.dirty = false; H.log("Belge taslağı saklandı", `${bedNo(p)} · ${TYPES[d.type].name}`); H.toast("Taslak saklandı · " + d.savedAt); rerender(); return; }
      if (T.closest("[data-dc-recomp]")) { if (!canEdit(d) || !SYS[d.type]) return; const kk = KEEP[d.type], keep = d.sec[kk]; Object.assign(d.sec, SYS[d.type](p), { [kk]:keep }); d.compiledAt = H.nowFull(); markDirty(root, d);
        H.toast("Taslak güncel veriden yeniden derlendi · yazdığınız hekim bölümü korundu"); rerender(); return; }
      if (T.closest("[data-dc-del]")) { if (d.by !== me() || d.status !== "taslak") return; H.data.docs.splice(H.data.docs.indexOf(d), 1); ui(p.id).sel = null; H.log("Belge taslağı silindi", bedNo(p)); H.toast("Taslak silindi", "w"); rerender(); return; }
      if (T.closest("[data-dc-seal]")) { if (!canSeal(d)) return; stopDict();
        if (!TYPES[d.type].secs.some(([k]) => (d.sec[k] || "").trim())) { H.toast("Boş belge mühürlenemez", "e"); return; }
        // #8/#9 · sistemin dizdiği taslak hekim yazmadan kesinleşmez
        if (d.type === "izlem" && !(d.sec.deger || "").trim()) { H.toast(t("dc_need_deger"), "e"); const x = root.querySelector('[data-dc-ta="deger"]'); if (x) x.focus(); return; }
        if (d.type === "transfer" && !(d.sec.tneden || "").trim()) { H.toast(t("dc_need_neden"), "e"); const x = root.querySelector('[data-dc-ta="tneden"]'); if (x) x.focus(); return; }
        const ed = Object.keys(d.vitEd || {});
        H.modal({ title:`${esc(tName(d.type))} · mühürle`, body:`<p style="margin:0 0 10px">Mühürlenen belge <b>değiştirilemez</b>; sonradan yalnız ek not eklenebilir. Mühür adınız ve saatle denetim kaydına yazılır.</p>
            ${ed.length ? `<div class="note" style="margin-bottom:8px">Düzelttiğiniz vital alanlar belgeye “hekim düzeltti” notuyla geçer: ${ed.map(esc).join(", ")}</div>` : ""}
            <div class="mute" style="font-size:12.5px">${esc(bedNo(p))} · ${esc(d.at)} · ${esc(short(me()))}</div>`,
          actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-dc-sealok>${H.icon("lock")}Mühürle</button>`,
          onMount(m) { m.querySelector("[data-dc-sealok]").onclick = () => { d.status = "muhur"; d.sealedBy = me(); d.sealedAt = H.nowFull(); d.dirty = false;
            H.log(`${TYPES[d.type].name} mühürlendi`, `${bedNo(p)}${ed.length ? " · düzeltilen vital: " + ed.join(",") : ""}`); H.closeModal(); H.toast("Mühürlendi · artık değiştirilemez"); rerender(); }; } });
        return; }
      if (T.closest("[data-dc-addok]")) { if (!canAdd(d)) return; const txt = (d.addDraft || "").trim(); if (!txt) { H.toast("Ek not boş", "e"); return; }
        d.addenda.push({ by:me(), at:H.nowFull(), text:txt }); d.addDraft = ""; H.log("Mühürlü belgeye ek not", `${bedNo(p)} · ${TYPES[d.type].name}`); H.toast("Ek not mühürlendi"); rerender(); return; }
    };
    root.oninput = (e) => {
      const T = e.target, d = cur(); if (!d) return;
      if (T.matches("[data-dc-ta]")) { setSec(d, T.dataset.dcTa, T.value); if (T.dataset.dcTa !== "ek") markDirty(root, d); return; }
      if (T.matches("[data-dc-v]")) { const k = T.dataset.dcV; d.vit[k] = T.value; d.vitEd = d.vitEd || {}; d.vitEd[k] = String(T.value) !== String(p.v[k]);
        const f = T.closest("[data-dc-vf]"); if (f) f.classList.toggle("ed", d.vitEd[k]); markDirty(root, d); }
    };
  }

  function html(p) {
    ensureCss();
    if (DICT && !DICT.ta.isConnected) stopDict();
    return `<div class="dc-root">${inner(p)}</div>`;
  }

  H.docs = { html, after, stop:stopDict };
})();
