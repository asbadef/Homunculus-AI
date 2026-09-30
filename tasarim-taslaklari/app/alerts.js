/* Homunculus prototip v1 — hasta uyarıları (alerts.js).
 * Dışa verir: H.ALERT_CATS, H.ALERT_TYPES, H.alerts = { of, chips, bar, open, types, type }.
 * 24.09: Ozan'ın paylaştığı HBYS "Hasta Uyarıları" ekranı örnek alındı; oradan farkı:
 *   - kayıttan/formdan gelen uyarılar kendiliğinden görünür, kaynağı yazılıdır ve buradan kaldırılamaz,
 *   - elle eklenen her uyarıda kim/ne zaman/not; kaldırırken gerekçe; tarihçe sekmesi; her işlem H.log.
 * Sistem tanı koymaz, emir vermez. Canlandırma kararı yalnız hekim kaydından gelir, burada önerilmez/değiştirilmez.
 * Veri SENTETİKTİR. Bu modül başka dosyaya dokunmaz; bağlantı (başlık, yatak kartı) dışarıdan yapılır:
 *   H.alerts.chips(p, 4) → yatak kartı · H.alerts.bar(p) → hasta başlığı · tıklayınca H.alerts.open(pid).
 * Değişiklikte document'a "h:alerts" olayı ({detail:{pid}}) gönderilir. */
(function () {
  const H = window.H;
  const esc = (s) => H.esc(s);
  // 30.09c · gerçek saat: damga takvim gününü taşır (gece yarısından sonra ertesi gün); başlangıç tarihi bugünden ileri seçilemez
  const TODAY_ISO = H.isoD(H.clockDate());
  const stamp = () => `${H.dm(H.calOff())} ${H.now()}`;
  const tStamp = (t) => `${H.dm(Math.floor(t / 24))} ${clk(t)}`;   // nöbet saati → "dd.mm HH:MM"
  const stampNum = (s) => { const m = /^(\d\d)\.(\d\d) (\d\d):(\d\d)$/.exec(s || ""); return m ? ((+m[2] * 31 + +m[1]) * 1440 + +m[3] * 60 + +m[4]) : 0; };
  const clk = (h) => { h = ((h % 24) + 24) % 24; const a = Math.floor(h), m = Math.round((h - a) * 60); return `${String(a).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const who = (u) => { const x = H.userBy(u); return x ? x.name : (u || "—"); };
  /* 24.09 (3. oturum) · dil sözlüğü: ekran iskeleti (başlık, sekme, düğme, boş durum, toast). Katalog içeriği
   * (H.ALERT_TYPES'ın 25 uyarı türü adı/kısa adı) kapsam dışı — careplan.js'teki hemşirelik tanısı kataloğuyla
   * aynı gerekçe: hastanenin onayladığı uzun katalog içeriği, ekran iskeleti değil. */
  H.addT({
    al_cat_izo:{ AZ:"İzolyasiya", TR:"İzolasyon", RU:"Изоляция", EN:"Isolation" },
    al_cat_guv:{ AZ:"Təhlükəsizlik", TR:"Güvenlik", RU:"Безопасность", EN:"Safety" },
    al_cat_bak:{ AZ:"Qulluq", TR:"Bakım", RU:"Уход", EN:"Care" },
    al_cat_kli:{ AZ:"Klinik vəziyyət", TR:"Klinik durum", RU:"Клинический статус", EN:"Clinical status" },
    al_cat_ida:{ AZ:"İnzibati", TR:"İdari", RU:"Административный", EN:"Administrative" },
    al_role_hekim:{ AZ:"Həkim", TR:"Hekim", RU:"Врач", EN:"Physician" },
    al_role_hemsire:{ AZ:"Tibb bacısı", TR:"Hemşire", RU:"Медсестра", EN:"Nurse" },
    al_src_kayit:{ AZ:"Xəstə qeydindən avtomatik", TR:"Hasta kaydından otomatik", RU:"Автоматически из карты пациента", EN:"Automatic from patient record" },
    al_src_form:{ AZ:"Risk formundan avtomatik", TR:"Risk formundan otomatik", RU:"Автоматически из формы риска", EN:"Automatic from risk form" },
    al_src_kayitElle:{ AZ:"Qeyddən avtomatik ya da əl ilə", TR:"Kayıttan otomatik ya da elle", RU:"Из записи автоматически или вручную", EN:"Automatic from record, or manual" },
    al_src_elle:{ AZ:"Əl ilə əlavə olunur", TR:"Elle eklenir", RU:"Добавляется вручную", EN:"Added manually" },
    al_modal_title:{ AZ:"Xəstə xəbərdarlıqları", TR:"Hasta uyarıları", RU:"Оповещения пациента", EN:"Patient alerts" },
    al_tab_list:{ AZ:"Xəbərdarlıqlar", TR:"Uyarılar", RU:"Оповещения", EN:"Alerts" },
    al_tab_hist:{ AZ:"Tarixçə", TR:"Tarihçe", RU:"История", EN:"History" },
    al_lock_note:{ AZ:"Kilidli olanlar xəstə qeydindən ya da risk formundan gəlir; buradan silinmir, mənbəyində düzəldilir. Əl ilə əlavə edilənlərdə kimin nə vaxt əlavə etdiyi görünür.",
      TR:"Kilitli olanlar hasta kaydından ya da risk formundan gelir; buradan kaldırılmaz, kaynağında düzeltilir. Elle eklenenlerde kim ve ne zaman ekledi görünür.",
      RU:"Заблокированные оповещения приходят из карты пациента или формы риска; отсюда их нельзя удалить, только исправить в источнике. У добавленных вручную видно, кто и когда добавил.",
      EN:"Locked ones come from the patient record or a risk form; they can't be removed here, only corrected at the source. Manually added ones show who added them and when." },
    al_active_h:{ AZ:"Aktiv xəbərdarlıqlar", TR:"Aktif uyarılar", RU:"Активные оповещения", EN:"Active alerts" },
    al_count_uyari:{ AZ:"xəbərdarlıq", TR:"uyarı", RU:"оповещения", EN:"alerts" },
    al_empty_active:{ AZ:"Aktiv xəbərdarlıq yoxdur.", TR:"Aktif uyarı yok.", RU:"Активных оповещений нет.", EN:"No active alerts." },
    al_src_kayit_prefix:{ AZ:"Qeyddən · ", TR:"Kayıttan · ", RU:"Из записи · ", EN:"From record · " },
    al_chip_auto:{ AZ:"Qeyddən", TR:"Kayıttan", RU:"Из записи", EN:"From record" },
    al_chip_manual:{ AZ:"Əl ilə", TR:"Elle", RU:"Вручную", EN:"Manual" },
    al_search_ph:{ AZ:"Xəbərdarlıq axtar: izolyasiya, NPO, yıxılma…", TR:"Uyarı ara: izolasyon, NPO, düşme…", RU:"Поиск оповещения: изоляция, NPO, падение…", EN:"Search alerts: isolation, NPO, fall…" },
    al_no_match_tpl:{ AZ:"“{q}” ilə uyğun gələn xəbərdarlıq növü yoxdur.", TR:"“{q}” ile eşleşen uyarı türü yok.", RU:"Нет типа оповещения, соответствующего «{q}».", EN:"No alert type matches “{q}”." },
    al_code_policy_note:{ AZ:"Bu kodun mənası xəstəxananın kod siyasətində müəyyən edilir · qurulum zamanı doldurulacaq.", TR:"Bu kodun anlamı hastanenin kod politikasında tanımlanır · kurulumda doldurulacak.", RU:"Значение этого кода определяется политикой кодов больницы · будет заполнено при настройке.", EN:"The meaning of this code is defined by the hospital's code policy · to be filled in during setup." },
    al_label_source:{ AZ:"Mənbə", TR:"Kaynak", RU:"Источник", EN:"Source" },
    al_label_record:{ AZ:"Qeyd", TR:"Kayıt", RU:"Запись", EN:"Record" },
    al_label_detail:{ AZ:"Ətraflı", TR:"Ayrıntı", RU:"Подробности", EN:"Detail" },
    al_entered_by_doctor:{ AZ:"Qeydi daxil edən həkim", TR:"Kaydı giren hekim", RU:"Врач, внёсший запись", EN:"Physician who entered the record" },
    al_form_filled_by:{ AZ:"Formanı dolduran", TR:"Formu dolduran", RU:"Кто заполнил форму", EN:"Form completed by" },
    al_btn_refill_form:{ AZ:"Formanı yenidən doldur", TR:"Formu yeniden doldur", RU:"Заполнить форму заново", EN:"Refill the form" },
    al_btn_fill_form:{ AZ:"Formanı doldur", TR:"Formu doldur", RU:"Заполнить форму", EN:"Fill in the form" },
    al_label_added_by:{ AZ:"Əlavə edən", TR:"Ekleyen", RU:"Кто добавил", EN:"Added by" },
    al_label_time:{ AZ:"Vaxt", TR:"Zaman", RU:"Время", EN:"Time" },
    al_label_start:{ AZ:"Başlanğıc", TR:"Başlangıç", RU:"Начало", EN:"Start" },
    al_label_note:{ AZ:"Qeyd", TR:"Not", RU:"Заметка", EN:"Note" },
    al_reason_end:{ AZ:"Vəziyyət sona çatdı", TR:"Durum sona erdi", RU:"Состояние завершилось", EN:"Condition resolved" },
    al_reason_doctor:{ AZ:"Həkim qərarı ilə", TR:"Hekim kararıyla", RU:"По решению врача", EN:"By physician's decision" },
    al_reason_error:{ AZ:"Səhv daxiletmə", TR:"Hatalı giriş", RU:"Ошибочный ввод", EN:"Entry error" },
    al_reason_transfer:{ AZ:"Xəstə başqa bölməyə keçdi", TR:"Hasta başka birime geçti", RU:"Пациент переведён в другое отделение", EN:"Patient moved to another unit" },
    al_reasons_label:{ AZ:"Silmə səbəbi", TR:"Kaldırma gerekçesi", RU:"Причина удаления", EN:"Reason for removal" },
    al_or_write_short:{ AZ:"Ya da qısaca yazın", TR:"Ya da kısaca yazın", RU:"Или напишите кратко", EN:"Or write briefly" },
    al_iso_end_note:{ AZ:"İzolyasiyanın sonlandırılması xəstəxananın infeksiyaya nəzarət siyasətinə uyğun aparılır.", TR:"İzolasyonun sonlandırılması hastanenin enfeksiyon kontrol politikasına göre yapılır.", RU:"Прекращение изоляции проводится согласно политике инфекционного контроля больницы.", EN:"Ending isolation follows the hospital's infection control policy." },
    al_btn_remove:{ AZ:"Xəbərdarlığı sil", TR:"Uyarıyı kaldır", RU:"Удалить оповещение", EN:"Remove alert" },
    al_lock_remove_tpl:{ AZ:"Bu xəbərdarlığı {who} silə bilər.", TR:"Bu uyarıyı {who} kaldırabilir.", RU:"Это оповещение может удалить: {who}.", EN:"Only {who} can remove this alert." },
    al_lock_add_tpl:{ AZ:"Bu xəbərdarlığı {who} əlavə edir.", TR:"Bu uyarıyı {who} ekler.", RU:"Это оповещение добавляет: {who}.", EN:"Only {who} can add this alert." },
    al_field_short_note:{ AZ:"Qısa qeyd", TR:"Kısa not", RU:"Краткая заметка", EN:"Short note" },
    al_field_start_date:{ AZ:"Başlanğıc tarixi", TR:"Başlangıç tarihi", RU:"Дата начала", EN:"Start date" },
    al_restraint_note:{ AZ:"Kısıtlama həkim istəyi ilə tətbiq olunur; burada yalnız komandanın görməsi üçün işarələnir.", TR:"Kısıtlama hekim istemiyle uygulanır; burada yalnız ekibin görmesi için işaretlenir.", RU:"Ограничение применяется по назначению врача; здесь оно только отмечается для команды.", EN:"Restraint is applied per physician's order; here it is only flagged for the team to see." },
    al_added_as_tpl:{ AZ:"Əlavə edən kimi {name} və saat {time} qeyd olunur.", TR:"Ekleyen olarak {name} ve saat {time} kaydedilir.", RU:"Будет записано: добавил(а) {name}, время {time}.", EN:"Recorded as added by {name} at {time}." },
    al_btn_add:{ AZ:"Xəbərdarlıq əlavə et", TR:"Uyarıyı ekle", RU:"Добавить оповещение", EN:"Add alert" },
    al_hist_note:{ AZ:"Kim, nə vaxt əlavə etdi ya da sildi. Qeyddən gələnlər mənbəyi ilə birlikdə göstərilir. Qeydlər silinmir.", TR:"Kim, ne zaman ekledi ya da kaldırdı. Kayıttan gelenler kaynağıyla birlikte gösterilir. Kayıtlar silinmez.", RU:"Кто и когда добавил или удалил. Записи из карты показываются вместе с источником. Записи не удаляются.", EN:"Who added or removed it, and when. Entries from the record are shown with their source. Entries are never deleted." },
    al_hist_empty:{ AZ:"Hələ qeyd yoxdur.", TR:"Henüz kayıt yok.", RU:"Записей пока нет.", EN:"No entries yet." },
    al_hist_add:{ AZ:"Əlavə edildi", TR:"Eklendi", RU:"Добавлено", EN:"Added" },
    al_hist_rm:{ AZ:"Silindi", TR:"Kaldırıldı", RU:"Удалено", EN:"Removed" },
    al_hist_oto:{ AZ:"Qeyddən", TR:"Kayıttan", RU:"Из записи", EN:"From record" },
    al_hist_reason_prefix:{ AZ:"səbəb: ", TR:"gerekçe: ", RU:"причина: ", EN:"reason: " },
    al_toast_notfound:{ AZ:"Xəstə tapılmadı", TR:"Hasta bulunamadı", RU:"Пациент не найден", EN:"Patient not found" },
    al_toast_added_tpl:{ AZ:"{name} əlavə edildi", TR:"{name} eklendi", RU:"{name} добавлено", EN:"{name} added" },
    al_toast_removed_tpl:{ AZ:"{name} silindi", TR:"{name} kaldırıldı", RU:"{name} удалено", EN:"{name} removed" },
    al_toast_note_required:{ AZ:"Bu xəbərdarlıq üçün qısa qeyd tələb olunur", TR:"Bu uyarı için kısa not gerekli", RU:"Для этого оповещения нужна краткая заметка", EN:"A short note is required for this alert" },
    al_toast_reason_required:{ AZ:"Silmə səbəbi tələb olunur", TR:"Kaldırma gerekçesi gerekli", RU:"Нужна причина удаления", EN:"A reason for removal is required" },
    al_bar_empty:{ AZ:"Xəstə xəbərdarlığı yoxdur", TR:"Hasta uyarısı yok", RU:"У пациента нет оповещений", EN:"No patient alerts" },
    al_tooltip_prefix:{ AZ:"Xəstə xəbərdarlıqları: ", TR:"Hasta uyarıları: ", RU:"Оповещения пациента: ", EN:"Patient alerts: " },
    al_no_record:{ AZ:"qeyd yoxdur", TR:"kayıt yok", RU:"записи нет", EN:"no record" },
    al_cpr_lock_tpl:{ AZ:"Canlandırma qərarı həkim tərəfindən xəstə qeydinə daxil edilir və burada özü görünür. Buradan əlavə edilmir; sistem bu qərarı təklif etmir. Qeyddə hazırda: <b>{status}</b>.",
      TR:"Canlandırma kararı hekim tarafından hasta kaydına girilir ve burada kendiliğinden görünür. Buradan eklenmez; sistem bu kararı önermez. Kayıtta şu an: <b>{status}</b>.",
      RU:"Решение о реанимации вносит врач в карту пациента, и оно появляется здесь автоматически. Отсюда не добавляется; система это решение не предлагает. Сейчас в карте: <b>{status}</b>.",
      EN:"The resuscitation decision is entered by the physician in the patient record and appears here automatically. It cannot be added here; the system never suggests this decision. Currently on record: <b>{status}</b>." },
    al_allergy_lock:{ AZ:"Allergiya xəstə qeydində saxlanılır; qeyddəki allergiya sahəsi yenilənəndə burada özü görünür. Qeyddə hazırda: <b>bilinən allergiya yoxdur</b>.",
      TR:"Alerji hasta kaydında tutulur; kayıttaki alerji alanı güncellenince burada kendiliğinden görünür. Kayıtta şu an: <b>bilinen alerji yok</b>.",
      RU:"Аллергия хранится в карте пациента; при обновлении поля аллергии в карте это отражается здесь автоматически. Сейчас в карте: <b>известной аллергии нет</b>.",
      EN:"Allergies are kept in the patient record; when the allergy field there is updated, it appears here automatically. Currently on record: <b>no known allergy</b>." },
    al_form_lock_tpl:{ AZ:"Bu xəbərdarlıq risk formundan gəlir: {rule} avtomatik görünür. Son qiymətləndirmə: <b>{lv}</b>.",
      TR:"Bu uyarı risk formundan gelir: {rule} kendiliğinden görünür. Son değerlendirme: <b>{lv}</b>.",
      RU:"Это оповещение приходит из формы риска; оно появляется автоматически {rule}. Последняя оценка: <b>{lv}</b>.",
      EN:"This alert comes from a risk form; it appears automatically {rule}. Last assessment: <b>{lv}</b>." },
    al_form_rule_fall:{ AZ:"risk yüksək olduqda", TR:"risk yüksekse", RU:"при высоком риске", EN:"when the risk is high" },
    al_form_rule_other:{ AZ:"risk orta ya da yüksək olduqda", TR:"risk orta ya da yüksekse", RU:"при среднем или высоком риске", EN:"when the risk is moderate or high" },
  });
  const tpl = (key, vals) => Object.entries(vals || {}).reduce((s, [k, v]) => s.split("{" + k + "}").join(v), H.t(key));
  const locTag = () => ({ AZ:"az", TR:"tr", RU:"ru", EN:"en" }[H.state.lang] || "tr");
  const roleLbl = (r) => H.t("al_role_" + r) !== "al_role_" + r ? H.t("al_role_" + r) : r;
  const REASON_KEYS = ["end", "doctor", "error", "transfer"];
  const REASONS = () => REASON_KEYS.map(k => H.t("al_reason_" + k));

  /* ================= stil (yalnız "al-" sınıfları; renkler değişkenden) ================= */
  const CSS = `
.al-ic{--c:var(--mute);display:inline-grid;place-items:center;flex:none;width:22px;height:22px;border-radius:50%;color:var(--c);background:color-mix(in srgb,var(--c) 17%,transparent);border:1.5px solid color-mix(in srgb,var(--c) 55%,transparent)}
.al-ic svg{width:13px;height:13px}
.al-ic.lg{width:38px;height:38px}.al-ic.lg svg{width:20px;height:20px}
.al-chips{display:inline-flex;gap:3px;align-items:center;flex-wrap:wrap;cursor:pointer;vertical-align:middle}
.al-chips .al-ic{width:20px;height:20px}.al-chips .al-ic svg{width:12px;height:12px}
.al-more{font:700 10.5px Figtree;color:var(--mute);background:var(--card2);border-radius:999px;padding:2px 6px}
.al-bar{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:7px;cursor:pointer}
.al-it{--c:var(--mute);display:inline-flex;align-items:center;gap:5px;font:700 11.5px Figtree;padding:2px 9px 2px 2px;border-radius:999px;color:var(--c);background:color-mix(in srgb,var(--c) 11%,transparent);border:1px solid color-mix(in srgb,var(--c) 38%,transparent);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.al-it .al-ic{width:20px;height:20px;border:0}.al-it .al-ic svg{width:12px;height:12px}
.al-it .lk svg{width:10px;height:10px;opacity:.7;vertical-align:-1px}
.al-edit{display:inline-flex;align-items:center;gap:5px;font:600 11.5px Figtree;color:var(--mute);background:none;border:1px dashed var(--line2);border-radius:999px;padding:3px 9px;cursor:pointer}
.al-edit:hover{color:var(--ink);border-color:var(--pri)}.al-edit svg{width:12px;height:12px}
.al-m{min-width:0}.al-m *{min-width:0}
.al-m .seg{margin-bottom:12px}.al-m .seg em{font-style:normal;font:700 10px Figtree;margin-left:5px;opacity:.8}
.al-src{font-size:12px;color:var(--mute);margin:0 0 12px;line-height:1.45}
.al-h{font:700 11px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:14px 0 7px;display:flex;gap:8px;align-items:center}
.al-h small{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:600}
.al-act{display:grid;gap:6px}
.al-row{--c:var(--mute);display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 10px;align-items:center;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:12px;padding:8px 10px;cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}
.al-row:hover{border-color:var(--line2)}.al-row.sel{box-shadow:0 0 0 2px color-mix(in srgb,var(--c) 45%,transparent)}
.al-row b{font-size:13.5px;display:block;overflow-wrap:anywhere}
.al-row small{display:block;font-size:11.5px;color:var(--mute);overflow-wrap:anywhere}
.al-row .st{font:700 10px Figtree;padding:2px 7px;border-radius:999px;white-space:nowrap;display:inline-flex;gap:4px;align-items:center}
.al-row .st svg{width:11px;height:11px}
.al-row .st.o{background:var(--card2);color:var(--mute)}.al-row .st.e{background:var(--priSoft);color:var(--pri)}
.al-q{display:flex;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--line2);border-radius:10px;padding:0 10px;color:var(--mute);margin-top:14px}
.al-q:focus-within{border-color:var(--pri);box-shadow:0 0 0 3px var(--priSoft)}
.al-q input{border:0;background:transparent;box-shadow:none!important;padding:9px 0}
.al-q svg{width:16px;height:16px}
.al-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px}
.al-t{--c:var(--mute);display:flex;align-items:center;gap:8px;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:11px;padding:7px 8px;cursor:pointer;font:600 12.5px/1.2 Figtree;color:var(--ink);position:relative}
.al-t:hover{border-color:var(--c)}
.al-t span{overflow-wrap:anywhere}
.al-t.on{background:color-mix(in srgb,var(--c) 13%,var(--card));border-color:color-mix(in srgb,var(--c) 60%,transparent);font-weight:700}
.al-t.on::after{content:"";position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:var(--c)}
.al-t.sel{box-shadow:0 0 0 2px var(--pri)}
.al-t .lk{margin-left:auto;color:var(--mute)}.al-t .lk svg{width:12px;height:12px}
.al-det{--c:var(--mute);background:var(--card);border:1px solid var(--line2);border-top:4px solid var(--c);border-radius:14px;padding:12px 14px;margin-top:12px}
.al-det .hd{display:flex;gap:10px;align-items:center;margin-bottom:8px}
.al-det .hd b{font:700 16px "Space Grotesk";display:block;overflow-wrap:anywhere}
.al-det .hd small{color:var(--mute);font-size:12px;display:block}
.al-det .hd .x{margin-left:auto}
.al-det p{margin:6px 0;font-size:13px;overflow-wrap:anywhere}
.al-det .kv b{font-family:Figtree;text-align:right;overflow-wrap:anywhere}
.al-det .fl{display:block;font:700 11px Figtree;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:10px 0 4px}
.al-det .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.al-lock{display:flex;gap:8px;align-items:flex-start;background:var(--card2);border-radius:10px;padding:8px 10px;font-size:12.5px;margin-top:6px}
.al-lock svg{width:15px;height:15px;flex:none;margin-top:2px;color:var(--mute)}
.al-hist{display:grid;gap:0}
.al-hi{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;padding:9px 2px;border-bottom:1px solid var(--line);align-items:start}
.al-hi:last-child{border-bottom:0}
.al-hi b{font-size:13px}.al-hi small{display:block;color:var(--mute);font-size:11.5px;overflow-wrap:anywhere}
.al-hi time{font:600 11px "JetBrains Mono";color:var(--mute)}
.al-hi .ac{font:700 10px Figtree;padding:1px 6px;border-radius:6px;margin-right:4px}
.al-hi .ac.add{background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok)}
.al-hi .ac.rm{background:var(--critSoft);color:var(--crit)}
.al-hi .ac.oto{background:var(--card2);color:var(--mute)}
@media (max-width:640px){.al-grid{grid-template-columns:1fr 1fr}.al-t{font-size:12px;padding:6px 7px}.al-row{grid-template-columns:auto minmax(0,1fr)}.al-row .st{grid-column:2;justify-self:start}}
`;
  const ensureCss = () => { if (document.getElementById("al-css")) return; const s = document.createElement("style"); s.id = "al-css"; s.textContent = CSS; document.head.appendChild(s); };
  ensureCss();

  /* ================= renkler (yalnız tema değişkenleri) ================= */
  const C = {
    crit:"var(--crit)", high:"var(--high)", mid:"var(--mid)", low:"var(--low)", ok:"var(--ok)", pri:"var(--pri)", mute:"var(--mute)",
    vio:"color-mix(in srgb, var(--low) 50%, var(--crit))",
    teal:"color-mix(in srgb, var(--low) 55%, var(--ok))",
    rust:"color-mix(in srgb, var(--high) 60%, var(--crit))",
    blood:"color-mix(in srgb, var(--crit) 70%, var(--mute))",
  };

  /* ================= kendi simgeleri (24×24, stroke; core.js simge diliyle) ================= */
  const I = {
    hand:'<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L6 15"/>',
    gown:'<path d="M9 3h6l5 5-3 2v11H7V10L4 8z"/><path d="M9 3a3 3 0 0 0 6 0M12 6v15"/>',
    drops:'<path d="M7 16.3c2.2 0 4-1.8 4-4 0-1.1-.6-2.2-1.7-3.1S7.4 7 7 5.5c-.3 1.5-1.2 2.9-2.3 3.8S3 11.2 3 12.3c0 2.2 1.8 4 4 4z"/><path d="M12.6 6.6A11 11 0 0 0 14 3.5c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 0 1-11.9 5"/>',
    mask:'<path d="M4 9c3-2.2 13-2.2 16 0v4c0 3-3.6 6-8 6s-8-3-8-6z"/><path d="M4 11H2M22 11h-2M9 12h6M9 15h6"/>',
    virus:'<circle cx="12" cy="12" r="5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M4.9 4.9l3.6 3.6M15.5 15.5l3.6 3.6M4.9 19.1l3.6-3.6M15.5 8.5l3.6-3.6"/>',
    shieldOk:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    fall:'<circle cx="15" cy="4" r="2"/><path d="m14 7-4 5 4 3-1 6M10 12l-5-1.5M14 9.5l5 2.5M3 21h8"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    strap:'<rect x="3" y="9" width="18" height="6" rx="2"/><path d="M9 9v6M15 9v6M12 5v4M12 15v4"/>',
    airway:'<path d="M12 3v7M12 10l-4 3c-2 1.5-3 3.5-3 6v1h5v-5M12 10l4 3c2 1.5 3 3.5 3 6v1h-5v-5"/>',
    cpr:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/><path d="M3.5 11.5H8l2-3 3 6 2-3h5.5"/>',
    cell:'<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.6"/><circle cx="14.5" cy="9" r="1"/><circle cx="13.5" cy="14.5" r="1.8"/>',
    npo:'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/><path d="M2 2l20 20"/>',
    pump:'<rect x="3" y="3" width="12" height="15" rx="2"/><path d="M6 7h6M6 11h6M15 12h3a3 3 0 0 1 3 3v6"/><circle cx="9" cy="15" r=".6"/>',
    shieldX:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v5M12 16.5h.01"/>',
    stoma:'<rect x="5" y="3" width="14" height="18" rx="7"/><circle cx="12" cy="11" r="3"/>',
    bag:'<path d="M7 3h10v11a5 5 0 0 1-10 0z"/><path d="M12 19v3M10 7h4M10 10h4"/>',
    flag:'<path d="M5 22V3M5 4h13l-2.5 4.5L18 13H5"/>',
    luggage:'<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    eyeOff:'<path d="M2 12s3.5-7 10-7c2 0 3.8.7 5.3 1.7M22 12s-3.5 7-10 7c-2 0-3.8-.7-5.3-1.7M3 3l18 18"/>',
  };

  /* ================= katalog =================
   * src: "kayıt" (yalnız hasta kaydından), "form" (risk formundan), "kayıt+elle" (kayıttan gelir, ayrıca elle eklenebilir), "elle".
   * who: elle ekleyebilen roller. w: önem sırası (kartta ilk görünenler). iso: izolasyon (başlangıç tarihi sorulur).
   * need: elle eklerken not zorunlu. def:false → anlamı hastanenin kod politikasından doldurulacak. */
  H.ALERT_CATS = [["izo", "İzolasyon"], ["guv", "Güvenlik"], ["bak", "Bakım"], ["kli", "Klinik durum"], ["ida", "İdari"]];
  const T = (key, name, short, cat, color, icon, src, w, x = {}) => Object.assign({ key, name, short, cat, color, icon, src, w, who:["hemsire", "hekim"], iso:cat === "izo", need:false, def:true, kw:"" }, x);
  H.ALERT_TYPES = [
    // İzolasyon
    T("temas",     "Temas izolasyonu",          "Temas izol.",   "izo", C.high, I.hand,    "kayıt+elle", 80, { kw:"eldiven önlük mrsa vre" }),
    T("sikiTemas", "Sıkı temas izolasyonu",     "Sıkı temas",    "izo", C.rust, I.gown,    "kayıt+elle", 82, { kw:"genişletilmiş temas c. difficile cdi sporlu" }),
    T("damlacik",  "Damlacık izolasyonu",       "Damlacık",      "izo", C.low,  I.drops,   "kayıt+elle", 81, { kw:"cerrahi maske influenza" }),
    T("solunum",   "Solunum izolasyonu",        "Solunum izol.", "izo", C.vio,  I.mask,    "kayıt+elle", 83, { kw:"havayolu n95 ffp2 tüberküloz tb negatif basınç" }),
    T("rsv",       "RSV izolasyonu",            "RSV izol.",     "izo", C.teal, I.virus,   "kayıt+elle", 79, { kw:"respiratuvar sinsityal virüs bronşiolit" }),
    T("koruyucu",  "Koruyucu izolasyon",        "Koruyucu izol.","izo", C.ok,   I.shieldOk,"kayıt+elle", 78, { kw:"ters izolasyon bağışıklık nakil" }),
    // Güvenlik
    T("alerji",    "Alerji",                    "Alerji",        "guv", C.crit, "alert",   "kayıt",      95, { who:[], kw:"allerji ilaç lateks" }),
    T("zorHava",   "Zor hava yolu",             "Zor hava yolu", "guv", C.crit, I.airway,  "elle",       90, { who:["hekim", "hemsire"], need:true, kw:"entübasyon difficult airway" }),
    T("dusme",     "Düşme riski",               "Düşme",         "guv", C.mid,  I.fall,    "form",       60, { who:[], form:"fall", kw:"morse fall" }),
    T("kisitlama", "Kısıtlama uygulanıyor",     "Kısıtlama",     "guv", C.mute, I.strap,   "elle",       58, { need:true, kw:"fiziksel kısıtlama bağlama restraint" }),
    T("sariKod",   "Sarı kod",                  "Sarı kod",      "guv", C.mid,  I.flag,    "elle",       40, { def:false, kw:"kod" }),
    T("turuncuKod","Turuncu kod",               "Turuncu kod",   "guv", C.high, I.flag,    "elle",       41, { def:false, kw:"kod" }),
    // Bakım
    T("basi",      "Bası yarası riski",         "Bası yarası",   "bak", C.high, I.target,  "form",       55, { who:[], form:"braden", kw:"braden dekübit pozisyon" }),
    T("npo",       "Aç (NPO)",                  "Aç (NPO)",      "bak", C.mid,  I.npo,     "elle",       70, { kw:"ağızdan bir şey verilmez oral kapalı npo" }),
    T("beslenme",  "Özel beslenme",             "Beslenme",      "bak", C.ok,   "food",    "elle",       45, { need:true, kw:"diyet enteral gavaj anne sütü nötropenik diyet" }),
    T("pca",       "PCA takılı",                "PCA",           "bak", C.low,  I.pump,    "elle",       50, { kw:"hasta kontrollü analjezi pompa ağrı" }),
    T("stoma",     "Stoma",                     "Stoma",         "bak", C.mute, I.stoma,   "elle",       35, { kw:"kolostomi ileostomi ürostomi" }),
    // Klinik durum
    T("cpr",       "Canlandırma kararı",        "Canlandırma",   "kli", C.vio,  I.cpr,     "kayıt",      100,{ who:[], kw:"cpr kod durumu dnr resüsitasyon" }),
    T("notropeni", "Nötropenik",                "Nötropenik",    "kli", C.teal, I.cell,    "kayıt+elle", 75, { who:["hekim"], kw:"nötropeni anc bağışıklık" }),
    T("yuksekRisk","Yüksek riskli hasta",       "Yüksek risk",   "kli", C.crit, I.shieldX, "elle",       65, { who:["hekim"], need:true, kw:"dikkat" }),
    T("otologKan", "Otolog kan hazır",          "Otolog kan",    "kli", C.blood,I.bag,     "elle",       48, { kw:"kendi kanı transfüzyon kan bankası" }),
    // İdari
    T("izinli",    "Hasta izinli (serviste değil)", "İzinli",    "ida", C.mute, "out",     "elle",       38, { need:true, kw:"izin dışarıda ev" }),
    T("esya",      "Hastaya ait eşya",          "Eşya",          "ida", C.mute, I.luggage, "elle",       30, { need:true, kw:"protez gözlük işitme cihazı değerli" }),
    T("korunakli", "Korunaklı hasta (bilgi paylaşımı kısıtlı)", "Korunaklı", "ida", C.vio, I.eyeOff, "elle", 42, { who:["hekim"], need:true, kw:"gizli kişisel koruma vip adli" }),
  ];
  const TYPE = Object.fromEntries(H.ALERT_TYPES.map(t => [t.key, t]));
  const SRC_KEY = { "kayıt":"al_src_kayit", form:"al_src_form", "kayıt+elle":"al_src_kayitElle", elle:"al_src_elle" };
  const SRC_TXT = new Proxy({}, { get:(_, k) => H.t(SRC_KEY[k]) });
  const CAT_T = { izo:"al_cat_izo", guv:"al_cat_guv", bak:"al_cat_bak", kli:"al_cat_kli", ida:"al_cat_ida" };
  const catLabel = (ck) => H.t(CAT_T[ck] || "");
  const ic = (t, cls = "") => `<span class="al-ic ${cls}" style="--c:${t.color}">${t.icon.startsWith("<") ? svg(t.icon) : H.icon(t.icon)}</span>`;

  /* ================= kayıttan türetilenler ================= */
  const ISO_MAP = [[/sıkı|genişletilmiş/i, "sikiTemas"], [/rsv/i, "rsv"], [/damlac/i, "damlacik"], [/solunum|hava ?yolu|havayolu/i, "solunum"], [/koruyucu|ters/i, "koruyucu"], [/temas/i, "temas"]];
  const isoKey = (s) => { if (!s) return null; for (const [re, k] of ISO_MAP) if (re.test(s)) return k; return null; };
  const lastForm = (pid, form) => { const d = (H.data.tasks || []).filter(x => x.pid === pid && x.form === form && x.state === "done"); if (!d.length) return null; return Math.max(...d.map(x => x.t)); };
  const autoOf = (p) => {
    const out = [], f = p.flags || {};
    if (p.allergies && p.allergies.length) out.push({ type:"alerji", source:"oto", by:null, at:null, from:"Hasta kaydı · alerji alanı", note:p.allergies.join(", ") });
    const ik = isoKey(p.isolation);
    if (ik) out.push({ type:ik, source:"oto", by:null, at:null, from:`Hasta kaydı · izolasyon: ${p.isolation}`, note:"" });
    if (f.fall === "yüksek") { const t = lastForm(p.id, "fall"); out.push({ type:"dusme", source:"oto", by:p.nurse, at:t != null ? tStamp(t) : null, from:t != null ? `Düşme riski formu ${clk(t)}` : "Düşme riski değerlendirmesi", note:"Risk düzeyi: yüksek" }); }
    if (f.braden === "yüksek" || f.braden === "orta") { const t = lastForm(p.id, "braden"); out.push({ type:"basi", source:"oto", by:p.nurse, at:t != null ? tStamp(t) : null, from:t != null ? `Bası yarası riski formu ${clk(t)}` : "Bası yarası riski değerlendirmesi", note:`Risk düzeyi: ${f.braden}` }); }
    if (p.codeStatus && p.codeStatus !== "Tam") out.push({ type:"cpr", source:"oto", by:p.attending, at:null, from:"Hekim kaydı · kod durumu", note:`Canlandırma kararı: ${p.codeStatus} · karar hekimindir` });
    if (/nötropeni/i.test(p.dx || "")) out.push({ type:"notropeni", source:"oto", by:null, at:null, from:"Hasta kaydı · tanı metninde “nötropeni” geçiyor", note:"" });
    return out;
  };

  /* ================= elle eklenenler + tarihçe (modül içi durum; sayfa yenilenince başa döner) ================= */
  const ST = {};
  const st = (pid) => ST[pid] || (ST[pid] = { man:[], hist:[] });
  // 30.09c · tohum zamanları "24.09 21:42" varsayımıyla yazıldı → H.ts ile gerçek saate kaydırılır (başlangıç tarihi aynı andan)
  const seedAdd = (pid, type, by, at0, note, start0) => { if (!H.pt(pid)) return; const at = H.ts(at0), start = start0 ? H.ts(start0 + "T" + at0.slice(-5)).slice(0, 10) : null; const s = st(pid); s.man.push({ type, source:"elle", by, at, note, start:start || null }); s.hist.push({ act:"add", type, by, at, note, start:start || null }); };
  const seedRm = (pid, type, by, at0, why) => { if (!H.pt(pid)) return; const at = H.ts(at0); const s = st(pid); s.man = s.man.filter(a => a.type !== type); s.hist.push({ act:"rm", type, by, at, note:why }); };
  // Uydurma demo (kişiler core.js'teki uydurma kullanıcılar)
  seedAdd("p1", "zorHava", "dr.kamran", "22.09 03:15", "Entübasyon zor geçti · video laringoskopla, 2. denemede");
  seedAdd("p1", "npo", "hs.sevda", "22.09 07:00", "Girişim öncesi · hekim istemi");
  seedRm("p1", "npo", "hs.sevda", "22.09 14:30", "Girişim tamamlandı");
  seedAdd("p1", "npo", "hs.sevda", "23.09 18:20", "Olası girişim öncesi · hekim istemi");
  seedAdd("p13", "beslenme", "hs.nuray", "22.09 09:10", "Gavajla anne sütü · beslenme planına bakınız");
  seedAdd("p19", "beslenme", "hs.gulnar", "18.09 11:00", "Nötropenik diyet · diyetisyen planı");
  seedAdd("p11", "rsv", "hs.nuray", "23.09 10:40", "RSV testi bekleniyor · önlem sonuca kadar", "2026-09-23");
  seedAdd("p6", "esya", "hs.gulnar", "21.09 15:20", "İşitme cihazı (sağ) · alt protez");
  seedAdd("p16", "pca", "hs.sevda", "23.09 06:30", "Ameliyat sonrası analjezi pompası");

  const of = (p) => {
    if (typeof p === "string") p = H.pt(p);
    if (!p) return [];
    const au = autoOf(p), have = new Set(au.map(a => a.type));
    const man = st(p.id).man.filter(a => !have.has(a.type));
    return [...au, ...man].filter(a => TYPE[a.type]).sort((a, b) => TYPE[b.type].w - TYPE[a.type].w);
  };
  const tip = (list) => list.map(a => TYPE[a.type].name + (a.source === "oto" ? " (kayıttan)" : "")).join(" · ");

  /* ================= kart ve başlık için HTML ================= */
  const chips = (p, max = 4) => {
    if (typeof p === "string") p = H.pt(p);
    const list = of(p); if (!list.length) return "";
    const shown = list.slice(0, max), rest = list.length - shown.length;
    const tt = H.t("al_tooltip_prefix") + tip(list);
    return `<span class="al-chips" data-al-pid="${esc(p.id)}" title="${esc(tt)}" role="button" aria-label="${esc(tt)}">${shown.map(a => ic(TYPE[a.type])).join("")}${rest > 0 ? `<span class="al-more">+${rest}</span>` : ""}</span>`;
  };
  const bar = (p) => {
    if (typeof p === "string") p = H.pt(p);
    if (!p) return "";
    const list = of(p);
    const items = list.map(a => { const t = TYPE[a.type];
      const title = `${t.name}${a.note ? " · " + a.note : ""} · ${a.source === "oto" ? H.t("al_label_source").toLocaleLowerCase(locTag()) + ": " + a.from : H.t("al_chip_manual").toLocaleLowerCase(locTag()) + ": " + who(a.by) + " " + a.at}`;
      return `<span class="al-it" style="--c:${t.color}" title="${esc(title)}">${ic(t)}${esc(t.short)}${a.source === "oto" ? `<span class="lk">${H.icon("lock")}</span>` : ""}</span>`; }).join("");
    return `<div class="al-bar" data-al-pid="${esc(p.id)}">${items || `<span class="mute" style="font-size:12px">${H.t("al_bar_empty")}</span>`}<button type="button" class="al-edit">${H.icon(list.length ? "edit" : "plus")}${list.length ? H.t("al_tab_list") : H.t("al_btn_add")}</button></div>`;
  };
  // Kart/başlık içindeki tıklama, kartın kendi tıklamasından önce yakalanır.
  document.addEventListener("click", (e) => { const el = e.target.closest && e.target.closest("[data-al-pid]"); if (!el || el.closest(".modal")) return; e.stopPropagation(); e.preventDefault(); open(el.getAttribute("data-al-pid")); }, true);

  /* ================= yönetim modalı ================= */
  const role = () => (H.state.user ? H.state.user.role : null);
  const canAdd = (t) => !!role() && t.who.includes(role());
  const whoTxt = (t) => t.who.length ? t.who.map(roleLbl).join(" / ") : "—";
  const dmy = (iso) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };
  const label = (p) => { const b = H.bed(p.bed); return H.showNames() ? `${b ? b.no : ""} · ${p.name}` : (b ? b.no : p.id); };
  const emit = (pid) => { try { document.dispatchEvent(new CustomEvent("h:alerts", { detail:{ pid } })); } catch (e) {} };

  function open(pid) {
    const p = H.pt(pid); if (!p) { H.toast(H.t("al_toast_notfound"), "e"); return; }
    ensureCss();
    const ui = { tab:"list", q:"", sel:null, reason:"", changed:false };
    H.log("Hasta uyarıları açıldı", label(p));
    H.modal({ title:`${H.t("al_modal_title")} · ${esc(label(p))}`, body:`<div class="al-m"></div>`,
      onMount:(m) => { ui.root = m.querySelector(".al-m"); draw(); },
      onClose:() => { if (ui.changed && typeof H.renderApp === "function" && H.state.user) H.renderApp(); } });

    function draw() {
      const list = of(p), s = st(pid), active = new Map(list.map(a => [a.type, a]));
      const histN = s.hist.length + list.filter(a => a.source === "oto").length;
      let h = `<div class="seg"><button data-tab="list" class="${ui.tab === "list" ? "on" : ""}">${H.t("al_tab_list")}<em>${list.length}</em></button><button data-tab="hist" class="${ui.tab === "hist" ? "on" : ""}">${H.t("al_tab_hist")}<em>${histN}</em></button></div>`;
      if (ui.tab === "hist") { ui.root.innerHTML = h + histView(list); return bind(); }
      h += `<p class="al-src">${H.icon("lock")} ${H.t("al_lock_note")}</p>`;
      h += `<div class="al-h">${H.t("al_active_h")}<small>${list.length ? list.length + " " + H.t("al_count_uyari") : ""}</small></div>`;
      h += list.length ? `<div class="al-act">${list.map(a => { const t = TYPE[a.type];
        const sub = a.source === "oto" ? `${H.t("al_src_kayit_prefix")}${esc(a.from)}` : `${esc(who(a.by))} · ${esc(a.at)}${a.start ? ` · ${H.t("al_label_start").toLocaleLowerCase(locTag())} ${dmy(a.start)}` : ""}`;
        return `<button type="button" class="al-row ${ui.sel === a.type ? "sel" : ""}" style="--c:${t.color}" data-sel="${t.key}">${ic(t)}<span><b>${esc(t.name)}</b><small>${a.note ? esc(a.note) + " · " : ""}${sub}</small></span>${a.source === "oto" ? `<span class="st o">${H.icon("lock")}${H.t("al_chip_auto")}</span>` : `<span class="st e">${H.t("al_chip_manual")}</span>`}</button>`; }).join("")}</div>`
        : `<div class="empty" style="padding:14px">${H.t("al_empty_active")}</div>`;
      if (ui.sel) h += detail(TYPE[ui.sel], active.get(ui.sel));
      h += `<label class="al-q">${H.icon("search")}<input type="search" placeholder="${esc(H.t("al_search_ph"))}" value="${esc(ui.q)}" data-q></label>`;
      const q = ui.q.trim().toLocaleLowerCase(locTag());
      const match = (t) => !q || (t.name + " " + t.short + " " + t.kw + " " + catLabel((H.ALERT_CATS.find(c => c[0] === t.cat) || [])[0])).toLocaleLowerCase(locTag()).includes(q);
      let any = false;
      H.ALERT_CATS.forEach(([ck]) => { const ts = H.ALERT_TYPES.filter(t => t.cat === ck && match(t)); if (!ts.length) return; any = true;
        h += `<div class="al-h">${esc(catLabel(ck))}<small>${ts.filter(t => active.has(t.key)).length || ""}</small></div><div class="al-grid">${ts.map(t => { const a = active.get(t.key);
          return `<button type="button" class="al-t ${a ? "on" : ""} ${ui.sel === t.key ? "sel" : ""}" style="--c:${t.color}" data-sel="${t.key}" title="${esc(t.name + " · " + SRC_TXT[t.src])}">${ic(t)}<span>${esc(t.name)}</span>${a && a.source === "oto" ? `<i class="lk">${H.icon("lock")}</i>` : ""}</button>`; }).join("")}</div>`; });
      if (!any) h += `<div class="empty" style="margin-top:10px;padding:14px">${esc(tpl("al_no_match_tpl", { q:ui.q }))}</div>`;
      ui.root.innerHTML = h; bind();
      if (ui.focusQ) { const i = ui.root.querySelector("[data-q]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); ui.focusQ = false; }
      if (ui.scroll) { const d = ui.root.querySelector(".al-det"); if (d && d.scrollIntoView) d.scrollIntoView({ block:"nearest", behavior:"smooth" }); ui.scroll = false; }
    }

    function detail(t, a) {
      const cat = catLabel(t.cat);
      let h = `<div class="al-det" style="--c:${t.color}"><div class="hd">${ic(t, "lg")}<div><b>${esc(t.name)}</b><small>${esc(cat)} · ${esc(SRC_TXT[t.src])}${t.who.length ? " · " + H.t("al_chip_manual").toLocaleLowerCase(locTag()) + " (" + H.t("al_label_added_by").toLocaleLowerCase(locTag()) + "): " + esc(whoTxt(t)) : ""}</small></div><button type="button" class="ib x" data-close>${H.icon("x")}</button></div>`;
      if (!t.def) h += `<div class="note" style="margin:4px 0 8px">${H.t("al_code_policy_note")}</div>`;
      if (a && a.source === "oto") {
        h += `<div class="kv"><span>${H.t("al_label_source")}</span><b>${esc(a.from)}</b></div>`;
        if (a.note) h += `<div class="kv"><span>${t.key === "cpr" ? H.t("al_label_record") : H.t("al_label_detail")}</span><b>${esc(a.note)}</b></div>`;
        if (a.by) h += `<div class="kv"><span>${t.key === "cpr" ? H.t("al_entered_by_doctor") : H.t("al_form_filled_by")}</span><b>${esc(who(a.by))}</b></div>`;
        h += `<div class="al-lock">${H.icon("lock")}<span>${H.t("al_chip_auto")}: <b>${esc(a.from)}</b>. ${t.form ? H.t("al_form_filled_by") : t.key === "cpr" ? H.t("al_entered_by_doctor") : H.t("al_label_source")}</span></div>`;
        if (t.form && H.can("forms")) h += `<div class="row"><button type="button" class="btn sm" data-form="${t.form}">${H.icon("clip")}${H.t("al_btn_refill_form")}</button></div>`;
      } else if (a) {
        h += `<div class="kv"><span>${H.t("al_label_added_by")}</span><b>${esc(who(a.by))}</b></div><div class="kv"><span>${H.t("al_label_time")}</span><b>${esc(a.at)}</b></div>`;
        if (a.start) h += `<div class="kv"><span>${H.t("al_label_start")}</span><b>${dmy(a.start)}</b></div>`;
        if (a.note) h += `<div class="kv"><span>${H.t("al_label_note")}</span><b>${esc(a.note)}</b></div>`;
        if (canAdd(t)) {
          const reasons = REASONS();
          h += `<span class="fl">${H.t("al_reasons_label")} <span style="color:var(--crit)">*</span></span><div class="opts">${reasons.map(r => `<i class="${ui.reason === r ? "on" : ""}" data-rs="${esc(r)}">${esc(r)}</i>`).join("")}</div>
            <input style="margin-top:6px" maxlength="120" placeholder="${esc(H.t("al_or_write_short"))}" value="${reasons.includes(ui.reason) ? "" : esc(ui.reason)}" data-rtxt>
            ${t.iso ? `<p class="mute" style="font-size:12px">${H.t("al_iso_end_note")}</p>` : ""}
            <div class="row"><button type="button" class="btn d sm" data-rm>${H.icon("trash")}${H.t("al_btn_remove")}</button></div>`;
        } else h += `<div class="al-lock">${H.icon("lock")}<span>${esc(tpl("al_lock_remove_tpl", { who:whoTxt(t).toLocaleLowerCase(locTag()) }))}</span></div>`;
      } else if (t.src === "kayıt") {
        h += `<div class="al-lock">${H.icon("lock")}<span>${t.key === "cpr" ? tpl("al_cpr_lock_tpl", { status:esc(p.codeStatus || "—") }) : H.t("al_allergy_lock")}</span></div>`;
      } else if (t.src === "form") {
        const lv = (p.flags || {})[t.form];
        h += `<div class="al-lock">${H.icon("clip")}<span>${tpl("al_form_lock_tpl", { rule:H.t(t.form === "fall" ? "al_form_rule_fall" : "al_form_rule_other"), lv:esc(lv || H.t("al_no_record")) })}</span></div>`;
        if (H.can("forms")) h += `<div class="row"><button type="button" class="btn sm" data-form="${t.form}">${H.icon("clip")}${H.t("al_btn_fill_form")}</button></div>`;
      } else if (!canAdd(t)) {
        h += `<div class="al-lock">${H.icon("lock")}<span>${esc(tpl("al_lock_add_tpl", { who:whoTxt(t).toLocaleLowerCase(locTag()) }))}</span></div>`;
      } else {
        h += `<span class="fl">${H.t("al_field_short_note")}${t.need ? ` <span style="color:var(--crit)">*</span>` : ""}</span><input maxlength="120" data-note placeholder="${t.iso ? "Etken ya da gerekçe (ör. test bekleniyor)" : t.key === "kisitlama" ? "İstemi veren hekim ve türü" : "En fazla 120 karakter"}">`;
        if (t.iso) h += `<span class="fl">${H.t("al_field_start_date")}</span><input type="date" data-start value="${TODAY_ISO}" max="${TODAY_ISO}">`;
        if (t.key === "kisitlama") h += `<p class="mute" style="font-size:12px">${H.t("al_restraint_note")}</p>`;
        h += `<p class="mute" style="font-size:12px">${tpl("al_added_as_tpl", { name:"<b>" + esc(H.state.user.name) + "</b>", time:esc(H.now()) })}</p><div class="row"><button type="button" class="btn p sm" data-add>${H.icon("plus")}${H.t("al_btn_add")}</button><button type="button" class="btn g sm" data-close>${H.t("cancel")}</button></div>`;
      }
      return h + `</div>`;
    }

    function histView(list) {
      const s = st(pid);
      const rows = [...s.hist.map((e, i) => ({ ...e, i })), ...list.filter(a => a.source === "oto").map(a => ({ act:"oto", type:a.type, by:a.by, at:a.at, note:a.from, i:-1 }))];
      rows.sort((x, y) => stampNum(y.at) - stampNum(x.at) || y.i - x.i);   // aynı dakikada: sonra yapılan üstte
      if (!rows.length) return `<div class="empty">${H.t("al_hist_empty")}</div>`;
      const A = { add:["add", H.t("al_hist_add")], rm:["rm", H.t("al_hist_rm")], oto:["oto", H.t("al_hist_oto")] };
      return `<p class="al-src">${H.t("al_hist_note")}</p><div class="al-hist">${rows.map(e => { const t = TYPE[e.type], a = A[e.act];
        return `<div class="al-hi">${ic(t)}<div><b><span class="ac ${a[0]}">${a[1]}</span>${esc(t.name)}</b><small>${e.at ? `<time>${esc(e.at)}</time> · ` : ""}${e.act === "oto" ? esc(e.note) + (e.by ? " · " + esc(who(e.by)) : "") : esc(who(e.by)) + (e.act === "rm" ? " · " + H.t("al_hist_reason_prefix") : e.note ? " · " : "") + esc(e.note || "")}${e.start ? " · " + H.t("al_label_start").toLocaleLowerCase(locTag()) + " " + dmy(e.start) : ""}</small></div></div>`; }).join("")}</div>`;
    }

    function bind() {
      const r = ui.root;
      r.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; draw(); });
      r.querySelectorAll("[data-sel]").forEach(b => b.onclick = () => { ui.sel = ui.sel === b.dataset.sel ? null : b.dataset.sel; ui.reason = ""; ui.scroll = !!ui.sel; draw(); });
      r.querySelectorAll("[data-close]").forEach(b => b.onclick = () => { ui.sel = null; draw(); });
      const q = r.querySelector("[data-q]"); if (q) q.oninput = () => { ui.q = q.value; ui.focusQ = true; draw(); };
      r.querySelectorAll("[data-form]").forEach(b => b.onclick = () => { const k = b.dataset.form; H.closeModal(); H.forms.open(k, pid); });
      r.querySelectorAll("[data-rs]").forEach(b => b.onclick = () => { ui.reason = b.dataset.rs; draw(); });
      const rt = r.querySelector("[data-rtxt]"); if (rt) rt.oninput = () => { ui.reason = rt.value; r.querySelectorAll("[data-rs]").forEach(x => x.classList.remove("on")); };
      const add = r.querySelector("[data-add]");
      if (add) add.onclick = () => { const t = TYPE[ui.sel]; if (!canAdd(t)) return;
        const note = (r.querySelector("[data-note]").value || "").trim(), sEl = r.querySelector("[data-start]"), start = sEl ? sEl.value : null;
        if (t.need && note.length < 3) { H.toast(H.t("al_toast_note_required"), "w"); r.querySelector("[data-note]").focus(); return; }
        const at = stamp(), u = H.state.user.u, s = st(pid);
        s.man.push({ type:t.key, source:"elle", by:u, at, note, start }); s.hist.push({ act:"add", type:t.key, by:u, at, note, start });
        H.log("Hasta uyarısı eklendi", `${label(p)} · ${t.name}${note ? " · " + note : ""}${start ? " · başlangıç " + dmy(start) : ""}`);
        H.toast(tpl("al_toast_added_tpl", { name:t.name })); ui.changed = true; ui.sel = null; emit(pid); draw(); };
      const rm = r.querySelector("[data-rm]");
      if (rm) rm.onclick = () => { const t = TYPE[ui.sel]; const why = (ui.reason || "").trim();
        if (why.length < 3) { H.toast(H.t("al_toast_reason_required"), "w"); return; }
        const at = stamp(), u = H.state.user.u, s = st(pid);
        s.man = s.man.filter(a => a.type !== t.key); s.hist.push({ act:"rm", type:t.key, by:u, at, note:why });
        H.log("Hasta uyarısı kaldırıldı", `${label(p)} · ${t.name} · gerekçe: ${why}`);
        H.toast(tpl("al_toast_removed_tpl", { name:t.name })); ui.changed = true; ui.sel = null; ui.reason = ""; emit(pid); draw(); };
    }
  }

  H.alerts = { of, chips, bar, open, types:() => H.ALERT_TYPES, type:(k) => TYPE[k] };
})();
