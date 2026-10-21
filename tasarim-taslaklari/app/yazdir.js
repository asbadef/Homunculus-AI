/* Homunculus · yazdırma (yazdir.js) — 24.09.2026
 * Ürün sahibinin onayladığı karar: her çıktı önce ÖNİZLEME penceresinde açılır (A4 sayfa görünümü, sayfa sayısı,
 * "Yazıcıya gönder" / "Kapat"). "Yazıcıya gönder" window.print() çağırır; @media print yalnız belgeyi basar.
 *
 * Belgeler: sum (hasta özeti) · vit (24 saatlik vital çizelgesi) · tasks (vardiya iş listesi) · cp (bakım planı)
 *           hand (teslim notu) · band (kol bandı, dar etiket) · unit (birim hasta listesi, yatak sırasıyla, yatay A4)
 *   24.09 · barkod (barkod.js, Code 128): hasta kimlik bandında protokol + hasta no, kol bandında protokol.
 *           Etiketler (her etiket ayrı sayfa, etiket boyutunda @page): tube (tüp etiketi 60×30, bekleyen numune işinden) ·
 *           iv (infüzyon etiketi 80×40, süren infüzyon order'ından; H.ptMeds patient.js'ten) · dev (cihaz etiketi 70×40, envanterden).
 *           pm (biyomedikal bakım iş listesi, A4): gecikmiş + 30 gün içindeki bakım/kalibrasyon. dev/pm hasta bilgisi taşımaz,
 *           bu yüzden ad yetkisi değil "devices" yetkisi aranır. Kabul'ün "Kol bandı yazdır" düğmesi de bu önizlemeyi açar.
 *   24.09 (2. parti) · hnlbl / prlbl (Hasta no ve Protokol barkod etiketi; 1–24 adet; etiket yazıcı 50×25 ya da A4 3×8 yaprak) ·
 *           occ (yatak doluluğu A4; ad yalnız adı görebilen rolde) · iso (izolasyon kapı kartı; ad yok, önlem metni uydurulmaz) ·
 *           wo (arıza iş emri; cihaz no barkodlu) · abx (eczane antibiyotik gözden geçirme; kültür sonucu yok) ·
 *           form (hemşirelik formu; nursing.js ekrandaki formdan alan/değer listesini verir, boş form da basılır).
 * Şablon: üstte hastane adı + belge adı + hasta kimlik bandı (ALERJİ kırmızı kutuda); altta yazdıran, tarih-saat,
 *         "Sayfa x / y", "Kontrollü çıktı". Aynı belgenin 2. ve sonraki çıktısında "KOPYA n" damgası.
 * Denetim: her "Yazıcıya gönder" H.log'a düşer (kim, ne, hangi hasta, kaçıncı kopya, kaç sayfa; saat H.log'dan).
 * Yetki: hasta adı görmeyen roller (H.showNames() false: biyomedikal, kalite, yönetici, BT) düğmeyi hiç görmez,
 *        önizleme de açılmaz.
 * Yerleşim: başka dosyaya dokunmadan — H.renderApp sarmalanır + MutationObserver; sayfa çizildikten sonra
 *        hasta ekranının .pt-bar'ına "Yazdır" menüsü, Görevlerim ve Yataklar'ın .ph .r alanına düğme eklenir.
 * Veri yalnız OKUNUR: H.data.*, H.series, H.carePlan.plans(pid). Bu modül hiçbir kayda yazmaz (H.log hariç).
 * Klinik içerik Türkçe; arayüz ve şablon etiketleri 4 dilde (pr_ önekli anahtarlar). */
(function () {
  const H = window.H;
  if (!H) return;
  const E = (s) => H.esc(s);
  const I = (k) => H.icon(k);
  const L = (k) => H.t(k);
  const tpl = (k, o) => L(k).replace(/\{(\w+)\}/g, (_, x) => (o[x] ?? ""));

  H.addT({
    pr_print:{ AZ:"Çap et", TR:"Yazdır", RU:"Печать", EN:"Print" },
    pr_preview:{ AZ:"Çap önizləməsi", TR:"Yazdırma önizlemesi", RU:"Предпросмотр печати", EN:"Print preview" },
    pr_send:{ AZ:"Printerə göndər", TR:"Yazıcıya gönder", RU:"Отправить на печать", EN:"Send to printer" },
    pr_close:{ AZ:"Bağla", TR:"Kapat", RU:"Закрыть", EN:"Close" },
    pr_doc:{ AZ:"Sənəd", TR:"Belge", RU:"Документ", EN:"Document" },
    pr_pages:{ AZ:"{n} səhifə", TR:"{n} sayfa", RU:"Страниц: {n}", EN:"{n} page(s)" },
    pr_page_of:{ AZ:"Səhifə {x} / {y}", TR:"Sayfa {x} / {y}", RU:"Стр. {x} / {y}", EN:"Page {x} / {y}" },
    pr_controlled:{ AZ:"Nəzarətli çıxış", TR:"Kontrollü çıktı", RU:"Контролируемая копия", EN:"Controlled copy" },
    pr_copy:{ AZ:"SURƏT", TR:"KOPYA", RU:"КОПИЯ", EN:"COPY" },
    pr_first:{ AZ:"İlk çıxış", TR:"İlk çıktı", RU:"Первый экземпляр", EN:"First print" },
    pr_this:{ AZ:"Bu çıxış", TR:"Bu çıktı", RU:"Этот экземпляр", EN:"This print" },
    pr_by:{ AZ:"Çap edən", TR:"Yazdıran", RU:"Напечатал(а)", EN:"Printed by" },
    pr_bed:{ AZ:"Çarpayı", TR:"Yatak", RU:"Койка", EN:"Bed" },
    pr_name:{ AZ:"Ad, soyad", TR:"Ad soyad", RU:"ФИО", EN:"Name" },
    pr_agesex:{ AZ:"Yaş / cins", TR:"Yaş / cinsiyet", RU:"Возраст / пол", EN:"Age / sex" },
    pr_proto:{ AZ:"Protokol", TR:"Protokol", RU:"Протокол", EN:"Protocol" },
    pr_hn:{ AZ:"Xəstə no", TR:"Hasta no", RU:"№ пациента", EN:"Patient no" },
    pr_blood:{ AZ:"Qan qrupu", TR:"Kan grubu", RU:"Группа крови", EN:"Blood group" },
    pr_allergy:{ AZ:"ALLERGİYA", TR:"ALERJİ", RU:"АЛЛЕРГИЯ", EN:"ALLERGY" },
    pr_no_allergy:{ AZ:"Məlum allergiya yoxdur", TR:"Bilinen alerji yok", RU:"Аллергия не известна", EN:"No known allergy" },
    pr_male:{ AZ:"Kişi", TR:"Erkek", RU:"Муж.", EN:"Male" },
    pr_female:{ AZ:"Qadın", TR:"Kadın", RU:"Жен.", EN:"Female" },
    pr_unit:{ AZ:"Şöbə", TR:"Birim", RU:"Отделение", EN:"Unit" },
    pr_nurse:{ AZ:"Tibb bacısı", TR:"Hemşire", RU:"Медсестра", EN:"Nurse" },
    pr_shift:{ AZ:"Növbə", TR:"Nöbet", RU:"Смена", EN:"Shift" },
    pr_npt:{ AZ:"{n} xəstə", TR:"{n} hasta", RU:"Пациентов: {n}", EN:"{n} patient(s)" },
    pr_occ:{ AZ:"{a} / {b} dolu", TR:"{a} / {b} dolu", RU:"Занято {a} / {b}", EN:"{a} / {b} occupied" },
    pr_d_sum:{ AZ:"Xəstə xülasəsi", TR:"Hasta özeti", RU:"Сводка по пациенту", EN:"Patient summary" },
    pr_d_vit:{ AZ:"24 saatlıq vital cədvəli", TR:"24 saatlik vital çizelgesi", RU:"Витальные показатели за 24 ч", EN:"24-hour vital chart" },
    pr_d_tasks:{ AZ:"Növbə iş siyahısı", TR:"Vardiya iş listesi", RU:"Список задач смены", EN:"Shift work list" },
    pr_d_cp:{ AZ:"Qulluq planı", TR:"Bakım planı", RU:"План ухода", EN:"Care plan" },
    pr_d_hand:{ AZ:"Təhvil qeydi", TR:"Teslim notu", RU:"Записка о передаче", EN:"Handover note" },
    pr_d_band:{ AZ:"Qol bandı", TR:"Kol bandı", RU:"Браслет пациента", EN:"Wristband" },
    pr_d_unit:{ AZ:"Şöbə xəstə siyahısı", TR:"Birim hasta listesi", RU:"Список пациентов отделения", EN:"Unit patient list" },
    pr_btn_tasks:{ AZ:"İş siyahısını çap et", TR:"İş listesini yazdır", RU:"Печать списка задач", EN:"Print work list" },
    pr_btn_unit:{ AZ:"Şöbə siyahısını çap et", TR:"Birim listesini yazdır", RU:"Печать списка отделения", EN:"Print unit list" },
    pr_shortcut:{ AZ:"Qısayol: Ctrl+P", TR:"Kısayol: Ctrl+P", RU:"Сочетание: Ctrl+P", EN:"Shortcut: Ctrl+P" },
    pr_logged:{ AZ:"Çap audit jurnalına yazıldı", TR:"Yazdırma denetim kaydına yazıldı", RU:"Печать записана в журнал аудита", EN:"Print recorded in the audit log" },
    pr_denied:{ AZ:"Bu sənədi çap etməyə icazəniz yoxdur", TR:"Bu belgeyi yazdırma yetkiniz yok", RU:"Нет прав на печать этого документа", EN:"You are not allowed to print this document" },
    pr_sig_give:{ AZ:"Təhvil verən", TR:"Teslim eden", RU:"Сдал(а)", EN:"Handed over by" },
    pr_sig_take:{ AZ:"Təhvil alan", TR:"Teslim alan", RU:"Принял(а)", EN:"Received by" },
    pr_sign:{ AZ:"İmza", TR:"İmza", RU:"Подпись", EN:"Signature" },
    pr_time:{ AZ:"Saat", TR:"Saat", RU:"Время", EN:"Time" },
    pr_hand_edit:{ AZ:"Mətn “Təhvil qeydi” sekmesindən götürülür; orada dəyişə bilərsiniz.", TR:"Metin “Teslim notu” sekmesinden alınır; orada düzenleyebilirsiniz.", RU:"Текст берётся со вкладки «Записка о передаче»; там его можно изменить.", EN:"Text is taken from the Handover tab; you can edit it there." },
    // 24.09 · barkod, etiketler, biyomedikal listesi
    pr_d_tube:{ AZ:"Sınaq şüşəsi etiketi", TR:"Tüp etiketi", RU:"Этикетка пробирки", EN:"Tube label" },
    pr_d_iv:{ AZ:"İnfuziya etiketi", TR:"İnfüzyon etiketi", RU:"Этикетка инфузии", EN:"Infusion label" },
    pr_d_dev:{ AZ:"Cihaz etiketi", TR:"Cihaz etiketi", RU:"Этикетка прибора", EN:"Device label" },
    pr_d_pm:{ AZ:"Texniki xidmət iş siyahısı", TR:"Bakım iş listesi", RU:"Список работ по обслуживанию", EN:"Maintenance work list" },
    pr_btn_tubes:{ AZ:"Sınaq şüşəsi etiketləri", TR:"Tüp etiketleri", RU:"Этикетки пробирок", EN:"Tube labels" },
    pr_btn_pm:{ AZ:"Xidmət siyahısını çap et", TR:"Bakım listesini yazdır", RU:"Печать списка обслуживания", EN:"Print maintenance list" },
    pr_btn_devlabel:{ AZ:"Etiket çap et", TR:"Etiket yazdır", RU:"Печать этикетки", EN:"Print label" },
    pr_label_of:{ AZ:"Etiket {x} / {y}", TR:"Etiket {x} / {y}", RU:"Этикетка {x} / {y}", EN:"Label {x} / {y}" },
    pr_labels:{ AZ:"{n} etiket", TR:"{n} etiket", RU:"Этикеток: {n}", EN:"{n} label(s)" },
    pr_specimen:{ AZ:"Material", TR:"Numune", RU:"Материал", EN:"Specimen" },
    pr_planned:{ AZ:"Plan", TR:"Plan", RU:"План", EN:"Planned" },
    pr_taken_by:{ AZ:"Götürən", TR:"Alan", RU:"Взял(а)", EN:"Taken by" },
    pr_start:{ AZ:"Başlanğıc", TR:"Başlangıç", RU:"Начало", EN:"Start" },
    pr_ordered_by:{ AZ:"Təyin edən", TR:"İsteyen", RU:"Назначил(а)", EN:"Ordered by" },
    pr_prepared_by:{ AZ:"Hazırlayan", TR:"Hazırlayan", RU:"Приготовил(а)", EN:"Prepared by" },
    pr_line_change:{ AZ:"Xətt dəyişimi", TR:"Hat değişimi", RU:"Смена линии", EN:"Line change" },
    pr_serial:{ AZ:"Seriya no", TR:"Seri no", RU:"Серийный №", EN:"Serial no" },
    pr_loc:{ AZ:"Yer", TR:"Konum", RU:"Расположение", EN:"Location" },
    pr_last_pm:{ AZ:"Son xidmət", TR:"Son bakım", RU:"Последнее ТО", EN:"Last maintenance" },
    pr_next_pm:{ AZ:"Növbəti xidmət", TR:"Sonraki bakım", RU:"Следующее ТО", EN:"Next maintenance" },
    pr_next_cal:{ AZ:"Növbəti kalibrləmə", TR:"Sonraki kalibrasyon", RU:"Следующая калибровка", EN:"Next calibration" },
    pr_cert:{ AZ:"Sertifikat", TR:"Sertifika", RU:"Сертификат", EN:"Certificate" },
    pr_no_cal:{ AZ:"Tələb olunmur", TR:"Gerekmez", RU:"Не требуется", EN:"Not required" },
    pr_biomed:{ AZ:"Biotibbi mühəndislik", TR:"Biyomedikal", RU:"Биомедицинская служба", EN:"Biomedical engineering" },
    pr_period:{ AZ:"Dövr", TR:"Dönem", RU:"Период", EN:"Period" },
    pr_jobs:{ AZ:"{n} iş · {late} gecikmiş", TR:"{n} iş · {late} gecikmiş", RU:"Работ: {n} · просрочено: {late}", EN:"{n} job(s) · {late} overdue" },
    pr_g_late:{ AZ:"Gecikmiş", TR:"Gecikmiş", RU:"Просрочено", EN:"Overdue" },
    pr_g_week:{ AZ:"Bu həftə · 7 gün", TR:"Bu hafta · 7 gün", RU:"Эта неделя · 7 дней", EN:"This week · 7 days" },
    pr_g_next:{ AZ:"Növbəti 30 gün", TR:"Sonraki 30 gün", RU:"Следующие 30 дней", EN:"Next 30 days" },
    pr_c_dev:{ AZ:"Cihaz no", TR:"Cihaz no", RU:"№ прибора", EN:"Device no" },
    pr_c_kind:{ AZ:"Növ", TR:"Tür", RU:"Тип", EN:"Type" },
    pr_c_job:{ AZ:"İş", TR:"İş", RU:"Работа", EN:"Job" },
    pr_c_due:{ AZ:"Plan tarixi", TR:"Plan tarihi", RU:"Плановая дата", EN:"Due date" },
    pr_c_state:{ AZ:"Vəziyyət", TR:"Durum", RU:"Статус", EN:"Status" },
    pr_c_done:{ AZ:"Edildi", TR:"Yapıldı", RU:"Выполнено", EN:"Done" },
    pr_c_date:{ AZ:"Tarix", TR:"Tarih", RU:"Дата", EN:"Date" },
    pr_c_init:{ AZ:"İmza", TR:"Paraf", RU:"Подпись", EN:"Initials" },
    pr_on_time:{ AZ:"Vaxtında", TR:"Zamanında", RU:"В срок", EN:"On time" },
    pr_late_d:{ AZ:"{n} gün gecikib", TR:"{n} gün gecikti", RU:"Просрочено на {n} дн.", EN:"{n} day(s) overdue" },
    pr_no_pm:{ AZ:"Bu dövrdə xidmət işi yoxdur.", TR:"Bu dönemde bakım işi yok.", RU:"В этот период работ нет.", EN:"No maintenance jobs in this period." },
    // 24.09 (2. parti) · barkod etiketleri, doluluk, izolasyon kartı, iş emri, antibiyotik listesi, form çıktısı
    pr_d_hnlbl:{ AZ:"Xəstə barkodu", TR:"Hasta barkodu", RU:"Штрихкод пациента", EN:"Patient barcode" },
    pr_d_prlbl:{ AZ:"Protokol barkodu", TR:"Protokol barkodu", RU:"Штрихкод протокола", EN:"Protocol barcode" },
    pr_d_occ:{ AZ:"Çarpayı doluluğu", TR:"Yatak doluluğu", RU:"Занятость коек", EN:"Bed occupancy" },
    pr_d_iso:{ AZ:"İzolyasiya qapı kartı", TR:"İzolasyon kapı kartı", RU:"Карточка изоляции на дверь", EN:"Isolation door card" },
    pr_d_wo:{ AZ:"Nasazlıq iş əmri", TR:"Arıza iş emri", RU:"Наряд на ремонт", EN:"Repair work order" },
    pr_d_abx:{ AZ:"Antibiotik nəzərdən keçirmə siyahısı", TR:"Antibiyotik gözden geçirme listesi", RU:"Список пересмотра антибиотиков", EN:"Antibiotic review list" },
    pr_d_form:{ AZ:"Tibb bacısı forması", TR:"Hemşirelik formu", RU:"Сестринская форма", EN:"Nursing form" },
    pr_sk_hn:{ AZ:"XƏSTƏ NO · şəxsə aid", TR:"HASTA NO · kişiye ait", RU:"№ ПАЦИЕНТА · личный", EN:"PATIENT NO · per person" },
    pr_sk_pr:{ AZ:"PROTOKOL · bu yatışa aid", TR:"PROTOKOL · bu yatışa ait", RU:"ПРОТОКОЛ · эта госпитализация", EN:"PROTOCOL · this admission" },
    pr_qty:{ AZ:"Say", TR:"Adet", RU:"Кол-во", EN:"Copies" },
    pr_paper:{ AZ:"Kağız", TR:"Kâğıt", RU:"Бумага", EN:"Paper" },
    pr_roll:{ AZ:"Etiket printeri · 50×25", TR:"Etiket yazıcı · 50×25", RU:"Принтер этикеток · 50×25", EN:"Label printer · 50×25" },
    pr_a4sheet:{ AZ:"A4 vərəq · 3×8 (70×37)", TR:"A4 yaprak · 3×8 (70×37)", RU:"Лист A4 · 3×8 (70×37)", EN:"A4 sheet · 3×8 (70×37)" },
    pr_stickers:{ AZ:"{n} etiket", TR:"{n} etiket", RU:"Этикеток: {n}", EN:"{n} sticker(s)" },
    pr_bs_dolu:{ AZ:"Dolu", TR:"Dolu", RU:"Занята", EN:"Occupied" },
    pr_bs_bos:{ AZ:"Boş", TR:"Boş", RU:"Свободна", EN:"Free" },
    pr_bs_temizlik:{ AZ:"Təmizlikdə", TR:"Temizlikte", RU:"Уборка", EN:"Cleaning" },
    pr_bs_bloke:{ AZ:"Bloklanıb", TR:"Bloke", RU:"Заблокирована", EN:"Blocked" },
    pr_bs_rezerve:{ AZ:"Rezerv", TR:"Rezerve", RU:"Резерв", EN:"Reserved" },
    pr_oos:{ AZ:"istifadədən kənar", TR:"kullanım dışı", RU:"вне эксплуатации", EN:"out of service" },
    pr_c_room:{ AZ:"Otaq", TR:"Oda", RU:"Палата", EN:"Room" },
    pr_c_btype:{ AZ:"Çarpayı növü", TR:"Yatak tipi", RU:"Тип койки", EN:"Bed type" },
    pr_c_isoroom:{ AZ:"İzolyasiya otağı", TR:"İzolasyon odası", RU:"Изоляц. палата", EN:"Isolation room" },
    pr_c_pt:{ AZ:"Xəstə", TR:"Hasta", RU:"Пациент", EN:"Patient" },
    pr_c_note:{ AZ:"Qeyd", TR:"Not", RU:"Примечание", EN:"Note" },
    pr_c_dx:{ AZ:"Diaqnoz", TR:"Tanı", RU:"Диагноз", EN:"Diagnosis" },
    pr_c_abx:{ AZ:"Antibiotik (təyinat)", TR:"Antibiyotik (order)", RU:"Антибиотик (назначение)", EN:"Antibiotic (order)" },
    pr_c_day:{ AZ:"Gün", TR:"Gün", RU:"День", EN:"Day" },
    pr_c_alg:{ AZ:"Allergiya", TR:"Alerji", RU:"Аллергия", EN:"Allergy" },
    pr_c_iso:{ AZ:"İzolyasiya", TR:"İzolasyon", RU:"Изоляция", EN:"Isolation" },
    pr_c_review:{ AZ:"Qiymətləndirmə", TR:"Değerlendirme", RU:"Оценка", EN:"Review" },
    pr_review_due:{ AZ:"nəzərdən keçir", TR:"gözden geçir", RU:"пересмотреть", EN:"review" },
    pr_abx_foot:{ AZ:"Siyahı təyinat qeydlərindən hazırlanır; doza və ya dərman təklif etmir. Kultura nəticəsi bu çıxışda yoxdur (laboratoriya inteqrasiyası ilə gələcək).", TR:"Liste order kayıtlarından hazırlanır; doz ya da ilaç önermez. Kültür sonucu bu çıktıda yok (laboratuvar entegrasyonuyla gelecek).", RU:"Список формируется из назначений; дозы и препараты не предлагаются. Результатов посевов в этой печати нет (появятся с интеграцией лаборатории).", EN:"Built from order records; it does not suggest drugs or doses. Culture results are not included (they will come with the lab integration)." },
    pr_iso_title:{ AZ:"İZOLYASİYA", TR:"İZOLASYON", RU:"ИЗОЛЯЦИЯ", EN:"ISOLATION" },
    pr_iso_ask:{ AZ:"Otağa girməzdən əvvəl məsul tibb bacısına müraciət edin.", TR:"Odaya girmeden önce sorumlu hemşireye başvurunuz.", RU:"Перед входом в палату обратитесь к ответственной медсестре.", EN:"Please check with the nurse in charge before entering the room." },
    pr_iso_meas:{ AZ:"Tədbirlər (infeksiya nəzarəti komandası doldurur)", TR:"Önlemler (enfeksiyon kontrol ekibi doldurur)", RU:"Меры (заполняет команда инфекционного контроля)", EN:"Precautions (filled in by the infection control team)" },
    pr_iso_start:{ AZ:"Başlanğıc tarixi", TR:"Başlangıç tarihi", RU:"Дата начала", EN:"Start date" },
    pr_iso_nm:{ AZ:"Bu kartda xəstə adı yoxdur.", TR:"Bu kartta hasta adı yer almaz.", RU:"Имя пациента на карточке не указывается.", EN:"This card does not show the patient's name." },
    pr_btn_iso:{ AZ:"İzolyasiya kartları", TR:"İzolasyon kartları", RU:"Карточки изоляции", EN:"Isolation cards" },
    pr_btn_occ:{ AZ:"Doluluğu çap et", TR:"Doluluğu yazdır", RU:"Печать занятости", EN:"Print occupancy" },
    pr_btn_abx:{ AZ:"Siyahını çap et", TR:"Listeyi yazdır", RU:"Печать списка", EN:"Print list" },
    pr_btn_wo:{ AZ:"İş əmrini çap et", TR:"İş emrini yazdır", RU:"Печать наряда", EN:"Print work order" },
    pr_btn_stk:{ AZ:"Barkod etiketləri", TR:"Barkod etiketleri", RU:"Штрихкод-этикетки", EN:"Barcode stickers" },
    pr_wo_desc:{ AZ:"Nasazlığın təsviri", TR:"Arıza tanımı", RU:"Описание неисправности", EN:"Fault description" },
    pr_wo_open:{ AZ:"Açan", TR:"Açan", RU:"Открыл(а)", EN:"Opened by" },
    pr_wo_asg:{ AZ:"İcraçı", TR:"Atanan", RU:"Исполнитель", EN:"Assignee" },
    pr_wo_pri:{ AZ:"Prioritet", TR:"Öncelik", RU:"Приоритет", EN:"Priority" },
    pr_wo_done:{ AZ:"Görülən iş", TR:"Yapılan işlem", RU:"Выполненные работы", EN:"Work performed" },
    pr_wo_parts:{ AZ:"Dəyişdirilən hissə", TR:"Değişen parça", RU:"Заменённые детали", EN:"Parts replaced" },
    pr_wo_test:{ AZ:"Test nəticəsi", TR:"Test sonucu", RU:"Результат проверки", EN:"Test result" },
    pr_wo_ok:{ AZ:"Uyğun", TR:"Uygun", RU:"Соответствует", EN:"Pass" },
    pr_wo_nok:{ AZ:"Uyğun deyil", TR:"Uygun değil", RU:"Не соответствует", EN:"Fail" },
    pr_wo_tech:{ AZ:"Texnik", TR:"Teknisyen", RU:"Техник", EN:"Technician" },
    pr_wo_unit:{ AZ:"Şöbə məsulu", TR:"Birim sorumlusu", RU:"Ответственный отделения", EN:"Unit lead" },
    pr_wo_close:{ AZ:"Bağlanma qeydi", TR:"Kapanış notu", RU:"Заметка о закрытии", EN:"Closing note" },
    pr_f_sealed:{ AZ:"Möhürləndi", TR:"Mühürlendi", RU:"Подписано", EN:"Sealed" },
    pr_f_blank:{ AZ:"Boş forma · kağız ehtiyatı; sonra sistemə daxil edilir", TR:"Boş form · kâğıt yedek; sonra sisteme işlenir", RU:"Пустая форма · бумажный резерв; затем вносится в систему", EN:"Blank form · paper fallback; entered into the system later" },
    pr_f_by:{ AZ:"Qiymətləndirən", TR:"Değerlendiren", RU:"Оценил(а)", EN:"Assessed by" },
    pr_f_field:{ AZ:"Sahə", TR:"Alan", RU:"Поле", EN:"Field" },
    pr_f_value:{ AZ:"Qeyd", TR:"Kayıt", RU:"Запись", EN:"Entry" },
    pr_nunits:{ AZ:"{n} şöbə", TR:"{n} birim", RU:"Отделений: {n}", EN:"{n} units" },
    pr_total:{ AZ:"Cəmi", TR:"Toplam", RU:"Итого", EN:"Total" },
    pr_f_regions:{ AZ:"Bölgələr", TR:"Bölgeler", RU:"Области", EN:"Regions" },
    pr_pm_foot:{ AZ:"İstifadədən çıxarılmış cihazlar siyahıya daxil deyil. Görülən iş sistemdə ayrıca qeyd olunur.", TR:"Kullanım dışı cihazlar listede yer almaz. Yapılan iş sisteme ayrıca işlenir.", RU:"Выведенные из эксплуатации приборы не включены. Выполненная работа отмечается в системе отдельно.", EN:"Devices out of service are not listed. Completed work is recorded in the system separately." },
  });

  const DOC_T = { sum:"pr_d_sum", vit:"pr_d_vit", tasks:"pr_d_tasks", cp:"pr_d_cp", hand:"pr_d_hand", band:"pr_d_band", unit:"pr_d_unit", tube:"pr_d_tube", iv:"pr_d_iv", dev:"pr_d_dev", pm:"pr_d_pm" };
  const DOC_TR = { sum:"Hasta özeti", vit:"24 saatlik vital çizelgesi", tasks:"Vardiya iş listesi", cp:"Bakım planı", hand:"Teslim notu", band:"Kol bandı", unit:"Birim hasta listesi", tube:"Tüp etiketi", iv:"İnfüzyon etiketi", dev:"Cihaz etiketi", pm:"Bakım iş listesi" };
  const DOC_I = { sum:"file", vit:"activity", tasks:"list", cp:"clip", hand:"swap", band:"qr", unit:"bed", tube:"flask", iv:"drop", dev:"tablet", pm:"clock" };
  Object.assign(DOC_T, { hnlbl:"pr_d_hnlbl", prlbl:"pr_d_prlbl", occ:"pr_d_occ", iso:"pr_d_iso", wo:"pr_d_wo", abx:"pr_d_abx", form:"pr_d_form" });
  Object.assign(DOC_TR, { hnlbl:"Hasta barkodu etiketi", prlbl:"Protokol barkodu etiketi", occ:"Yatak doluluğu", iso:"İzolasyon kapı kartı", wo:"Arıza iş emri", abx:"Antibiyotik gözden geçirme listesi", form:"Hemşirelik formu" });
  Object.assign(DOC_I, { hnlbl:"qr", prlbl:"qr", occ:"bed", iso:"shield", wo:"alert", abx:"pill", form:"clip" });
  const PT_DOCS = ["sum", "vit", "cp", "hand", "band", "hnlbl", "prlbl", "tube", "iv", "iso"];
  const STK = ["hnlbl", "prlbl"];

  /* ================= yetki ================= */
  const me = () => H.state.user;
  const canPrintPt = () => !!me() && H.showNames() && H.can("patient");
  const canDoc = (k) => {
    if (!me()) return false;
    // Biyomedikal belgeleri hasta bilgisi taşımaz: ad görme yetkisi aranmaz, cihaz yetkisi yeter.
    if (k === "dev" || k === "pm" || k === "wo") return H.can("devices");
    if (k === "iso") return H.can("patient") || H.can("beds") || H.can("quality");   // kapı kartında ad yok
    if (k === "occ") return H.can("occupancy");                                         // ad yalnız adı görebilen rolde basılır
    if (!H.showNames()) return false;
    if (k === "hnlbl" || k === "prlbl") return (H.can("patient") && (H.can("tasks") || H.can("orders"))) || H.can("admission");
    if (k === "abx") return H.can("pharmacy");
    if (k === "form") return H.can("patient") && (H.can("forms") || H.can("tasks") || H.can("orders"));
    if (k === "sum") return H.can("patient");
    if (k === "vit") return H.can("patient") && H.can("pt_trend");
    if (k === "cp") return H.can("patient") && H.can("pt_bakim") && !!H.carePlan;
    if (k === "hand") return H.can("patient") && H.can("pt_devir");
    if (k === "band") return (H.can("patient") && (H.can("tasks") || H.can("orders"))) || H.can("admission");   // hemşire, hekim, kabul
    if (k === "tube") return H.can("patient") && (H.can("tasks") || H.can("orders"));
    if (k === "iv") return H.can("patient") && H.can("pt_ilac") && (H.can("tasks") || H.can("orders")) && typeof H.ptMeds === "function";
    if (k === "tasks") return H.can("tasks");
    if (k === "unit") return H.can("beds") && (me().role === "hekim" || (me().extras || []).includes("charge"));   // sorumlu hemşire / hekim
    return false;
  };
  // Etiket belgesi yalnız verisi olan hastada listelenir (tüp: bekleyen numune işi · infüzyon: süren infüzyon order'ı).
  const pendingLabs = (pid) => H.data.tasks.filter(t => t.pid === pid && t.kind === "lab" && t.state !== "done" && t.state !== "miss").sort((a, b) => a.t - b.t);
  const infusions = (pid) => { const p = H.pt(pid); return p && typeof H.ptMeds === "function" ? H.ptMeds(p).filter(m => m.kind === "inf") : []; };
  const ptHas = (k, pid) => k === "tube" ? pendingLabs(pid).length > 0 : k === "iv" ? infusions(pid).length > 0 : k === "iso" ? !!(H.pt(pid) || {}).isolation : true;
  const BC = (t, o) => (H.barcode ? H.barcode.svg(t, o) : `<span class="bc bc-none"><span class="bc-t">${E(t)}</span></span>`);

  /* ================= yardımcılar ================= */
  const p2 = (n) => String(n).padStart(2, "0");
  const idNum = (p) => +String(p.id).replace(/\D/g, "") || 1;
  // patient.js başlığıyla aynı formül (hnOf / protoOf orada dışa verilmiyor): kayıttan gelen numara varsa o, yoksa kimliğe bağlı sabit.
  const hnOf = (p) => p.hn || "HN-" + String(250000 + idNum(p) * 137).padStart(7, "0");
  const protoOf = (p) => p.proto || "2026-" + String(103900 + idNum(p) * 29);
  const bedNo = (p) => { const b = H.bed(p.bed); return b ? b.no : p.bed; };
  const unitOfP = (p) => { const b = H.bed(p.bed); return b ? H.unit(b.unitId) : null; };
  const sexT = (p) => L(p.sex === "E" ? "pr_male" : "pr_female");
  const sexTR = (p) => (p.sex === "E" ? "Erkek" : "Kadın");
  const uname = (u) => { const x = H.userBy(u); return x ? x.name : "—"; };
  const stampNow = () => `${H.dmy(H.calOff())} ${H.now()}`;
  const NOWH = H.NOW_T0;   // 30.09c: nöbet saati (gece yarısından sonra 24+) — veriler bu ana göre kuruldu
  // göreli saat (t ≤ 0, saat) → "23.09 22:42"
  const clockOf = (t) => { let x = NOWH + t, off = 0; while (x < 0) { x += 24; off--; } while (x >= 24) { x -= 24; off++; } const h = Math.floor(x + 1e-6), m = Math.round((x - h) * 60) % 60; return { d:H.dm(off), hm:`${p2(h)}:${p2(m)}`, off }; };
  // nöbet ızgarası saati (8…32) → "22:30" / "25.09 02:00"
  const shiftClock = (t) => { const h = Math.floor(t), m = Math.round((t - h) * 60); return `${h >= 24 ? H.dm(1) + " " : ""}${p2(h % 24)}:${p2(m)}`; };
  const allergyBox = (p, cls = "") => p.allergies && p.allergies.length
    ? `<div class="pr-alg ${cls}"><small>${L("pr_allergy")}</small><b>${E(p.allergies.join(", "))}</b></div>`
    : `<div class="pr-alg none ${cls}"><small>${L("pr_allergy")}</small><b>${L("pr_no_allergy")}</b></div>`;
  const kv = (k, v) => `<div class="pr-kv"><span>${E(k)}</span><b>${v}</b></div>`;
  const h3 = (t) => ({ html:`<h3 class="pr-h">${t}</h3>`, keep:true });

  /* ================= belge içerikleri =================
   * Her belge { band:html, blocks:[{html,keep?} | {table:{head,rows[],cls,cols}}], unitLine, land?, label? } döner. */
  function ptBand(p) {
    const u = unitOfP(p);
    return `<div class="pr-id">
      <div class="pr-bedc"><small>${L("pr_bed")}</small><b class="mono">${E(bedNo(p))}</b></div>
      <div class="pr-nmc"><small>${L("pr_name")}</small><b>${E(p.name)}</b></div>
      <div><small>${L("pr_agesex")}</small><b>${E(H.ageText(p))} · ${E(sexT(p))}</b></div>
      ${allergyBox(p)}
      <div class="pr-bcs"><div><small>${L("pr_proto")}</small>${BC(protoOf(p), { h:7 })}</div><div><small>${L("pr_hn")}</small>${BC(hnOf(p), { h:7 })}</div></div></div>`;
  }
  const unitLineP = (p) => { const u = unitOfP(p); return u ? `${u.tr} · ${H.floorText(u.floor)}` : ""; };

  function docSum(p) {
    const v = p.v, u = unitOfP(p), bl = [];
    const wt = p.weight ? (p.ageGroup === "neonate" ? `${Math.round(p.weight * 1000)} g` : `${p.weight} kg`) : "—";
    bl.push({ html:`<div class="pr-grid">
      ${kv("Tanı", `${E(p.dx)} <span class="mono">${E(p.icd)}</span>`)}
      ${kv("Birim · oda", `${E(u ? u.tr : "—")} · ${E((H.bed(p.bed) || {}).room || "—")}`)}
      ${kv("Yatış", `${p.admitDays}. gün`)}
      ${kv("Sorumlu hekim", E(uname(p.attending)))}
      ${kv("Hemşire", E(p.nurse ? uname(p.nurse) : "—"))}
      ${kv("Kan grubu", E(p.blood))}
      ${kv("Kilo · boy", `${wt}${p.height ? " · " + p.height + " cm" : ""}`)}
      ${kv("İzolasyon", E(p.isolation || "Yok"))}
      ${kv("Kod durumu", E(p.codeStatus || "—"))}
      ${kv("Kronik hastalıklar", E(p.chronic.length ? p.chronic.join(", ") : "Yok"))}
      ${kv("Antibiyotik", p.antibioticDay ? `${p.antibioticDay}. gün` : "Yok")}
      ${p.ageGroup === "neonate" && p.gestWeeks ? kv("Gestasyon · doğum ağırlığı", `${p.gestWeeks} hf · ${p.birthWeight} g`) : ""}
    </div>` });
    bl.push(h3(`Son vital bulgular · ${H.dm(0)} ${H.now()}`));
    bl.push({ table:{ cls:"pr-cen", head:`<tr><th>Nabız</th><th>KB</th><th>MAP</th><th>SpO₂</th><th>Solunum</th><th>Ateş</th><th>Oksijen</th><th>Bilinç</th></tr>`,
      rows:[`<tr><td>${v.hr} /dk</td><td>${v.sbp}/${v.dbp}</td><td>${v.map}</td><td>%${v.spo2}</td><td>${v.rr} /dk</td><td>${(+v.temp).toFixed(1)} °C</td><td>${E(v.o2)}</td><td>${E(v.loc)}</td></tr>`] } });
    const f = p.flags || {};
    bl.push(h3("Skorlar ve riskler"));
    bl.push({ html:`<div class="pr-grid">${kv("Skor", E(H.scoreLabel(p)))}${kv("Genel risk", E((H.SEV[p.risk] || H.SEV.stable).l))}
      ${kv("Düşme riski", E(f.fall || "—"))}${kv("Bası yarası riski", E(f.braden || "—"))}${kv("Son ağrı puanı", f.pain != null ? E(f.pain) + " / 10" : "—")}</div>` });
    const al = H.data.alarms.filter(a => a.pid === p.id && a.state !== "closed");
    bl.push(h3("Açık alarmlar"));
    bl.push({ html:al.length ? `<ul class="pr-ul">${al.map(a => `<li><b>${E((H.SEV[a.sev] || {}).l || a.sev)}</b> · ${E(a.txt)} · ${Math.round(a.ageMin)} dk${a.state === "seen" ? " · görüldü" : ""}</li>`).join("")}</ul>` : `<p class="pr-mute">Açık alarm yok.</p>` });
    if (H.carePlan && H.can("pt_bakim")) {
      const act = H.carePlan.plans(p.id).filter(x => x.status === "active");
      bl.push(h3("Bakım planı · aktif hemşirelik tanıları"));
      bl.push({ html:act.length ? `<ul class="pr-ul">${act.map(pl => `<li>${E((pl.snap || {}).name || pl.key)}${pl.opt ? " (" + E(pl.opt) + ")" : ""} · başlangıç ${E(pl.start.label)}</li>`).join("")}</ul>` : `<p class="pr-mute">Aktif bakım planı yok.</p>` });
    }
    const next = H.data.tasks.filter(t => t.pid === p.id && t.state !== "done" && t.state !== "miss").sort((a, b) => a.t - b.t).slice(0, 8);
    bl.push(h3("Sıradaki işler"));
    bl.push({ html:next.length ? `<ul class="pr-ul">${next.map(t => `<li><span class="mono">${shiftClock(t.t)}</span> · ${E(t.label)}${t.state === "late" ? " · <b>gecikti</b>" : ""}</li>`).join("")}</ul>` : `<p class="pr-mute">Bekleyen iş yok.</p>` });
    bl.push({ html:`<p class="pr-foot">Bu özet kayıtlı verilerden hazırlanır; tanı ya da tedavi kararı içermez. Karar hekimindir.</p>` });
    return { band:ptBand(p), blocks:bl, unitLine:unitLineP(p) };
  }

  const VK = ["hr", "map", "sbp", "spo2", "rr", "temp"];
  function chartSvg(p, S) {
    const keys = ["hr", "map", "spo2", "rr", "temp"], W = 720, SH = 78, top = 6, xl = 92, xr = 710, adult = p.ageGroup === "adult";
    const x = (t) => xl + (t + 24) / 24 * (xr - xl);
    let s = "";
    keys.forEach((k, i) => {
      const V = H.VITAL[k], pts = S[k], vals = pts.map(q => q.v), y0 = top + i * SH, y1 = y0 + SH - 14;
      const lim = adult ? V.al.filter(a => a > V.lo && a < V.hi) : [];
      let mn = Math.min(...vals, ...lim), mx = Math.max(...vals, ...lim); const pad = Math.max((mx - mn) * .12, k === "temp" ? .3 : 2); mn -= pad; mx += pad;
      const y = (v) => y1 - (v - mn) / (mx - mn) * (y1 - y0);
      const dec = k === "temp" ? 1 : 0, last = vals[vals.length - 1];
      s += `<rect x="${xl}" y="${y0}" width="${xr - xl}" height="${y1 - y0}" fill="none" stroke="#000" stroke-width=".6"/>`;
      for (let h = -20; h < 0; h += 4) s += `<line x1="${x(h)}" x2="${x(h)}" y1="${y0}" y2="${y1}" stroke="#999" stroke-width=".4" stroke-dasharray="1 2"/>`;
      [mn + pad, (mn + mx) / 2, mx - pad].forEach(v => { s += `<text x="${xl - 4}" y="${y(v) + 3}" text-anchor="end" font-size="8.5">${v.toFixed(dec)}</text>`; });
      lim.forEach(a => { s += `<line x1="${xl}" x2="${xr}" y1="${y(a)}" y2="${y(a)}" stroke="#000" stroke-width=".7" stroke-dasharray="5 3"/>`; });
      s += `<text x="4" y="${y0 + 12}" font-size="11" font-weight="700">${E(V.s)}</text><text x="4" y="${y0 + 24}" font-size="8.5">${E(V.u)}</text>`
        + `<text x="4" y="${y0 + 40}" font-size="12" font-weight="700">${(+last).toFixed(dec)}</text>`;
      s += `<polyline fill="none" stroke="#000" stroke-width="1.3" stroke-linejoin="round" points="${pts.map(q => `${x(q.t).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ")}"/>`;
      if (adult) pts.forEach(q => { if (q.v < V.al[0] || q.v > V.al[1]) s += `<circle cx="${x(q.t).toFixed(1)}" cy="${y(q.v).toFixed(1)}" r="1.9" fill="#000"/>`; });
    });
    const yb = top + keys.length * SH - 8;
    for (let h = -24; h <= 0; h += 4) { const c = clockOf(h); s += `<text x="${x(h)}" y="${yb}" text-anchor="${h === 0 ? "end" : "middle"}" font-size="8.5">${c.off ? c.d + " " : ""}${c.hm}</text>`; }
    return `<svg class="pr-chart" viewBox="0 0 ${W} ${yb + 4}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
  }
  function docVit(p) {
    const S = {}; VK.forEach(k => { S[k] = H.series(p.id, k, 24, 15); });
    const adult = p.ageGroup === "adult", bl = [];
    bl.push({ html:chartSvg(p, S) });
    bl.push({ html:`<p class="pr-foot">Çizgi: 15 dakikalık kayıtlar. ${adult ? "Kesikli çizgi: sistemde tanımlı alarm sınırı; ● sınır dışı kayıt. " : ""}Tabloda saat başı değerler${adult ? "; ▲/▼ sınır dışı" : ""}.</p>` });
    const flag = (k, v) => { if (!adult || !H.VITAL[k]) return ""; const a = H.VITAL[k].al; return v > a[1] ? " ▲" : v < a[0] ? " ▼" : ""; };
    const rows = [];
    for (let i = 0; i < S.hr.length; i += 4) {
      const t = S.hr[i].t, c = clockOf(t);
      rows.push(`<tr><td class="mono">${c.d} ${c.hm}</td>${["hr", "sbp", "map", "spo2", "rr", "temp"].map(k => { const v = S[k][i].v, f = flag(k === "sbp" ? "" : k, v); return `<td class="${f ? "hi" : ""}">${k === "temp" ? (+v).toFixed(1) : v}${f}</td>`; }).join("")}</tr>`);
    }
    bl.push(h3("Saat başı değerler"));
    bl.push({ table:{ cls:"pr-cen pr-z", head:`<tr><th>Tarih · saat</th><th>Nabız /dk</th><th>KB sist. mmHg</th><th>MAP mmHg</th><th>SpO₂ %</th><th>Solunum /dk</th><th>Ateş °C</th></tr>`, rows } });
    return { band:ptBand(p), blocks:bl, unitLine:unitLineP(p) };
  }

  const KIND_TR = { form:"Form", med:"İlaç", care:"Bakım", lab:"Lab" };
  const ST_TR = { done:"Yapıldı", late:"Gecikti", due:"Şimdi", plan:"Planlı", miss:"Uygulanmadı" };
  function tasksScope() {
    const pr = H.state.page === "tasks" ? (H.state.params || {}) : {};
    return (pr.pid ? [H.pt(pr.pid)] : H.myPatients()).filter(Boolean).filter(p => !H.state.unitId || H.bed(p.bed).unitId === H.state.unitId);
  }
  function docTasks(pts) {
    const bl = [], ids = new Set(pts.map(p => p.id)), units = [...new Set(pts.map(p => (unitOfP(p) || {}).tr).filter(Boolean))];
    let n = 0;
    pts.forEach(p => {
      const ts = H.data.tasks.filter(t => t.pid === p.id).sort((a, b) => a.t - b.t || a.label.localeCompare(b.label, "tr"));
      if (!ts.length) return; n++;
      bl.push({ html:`<div class="pr-ph"><b class="mono">${E(bedNo(p))}</b><b>${E(p.name)}</b><span>${E(H.ageText(p))} · ${E(sexTR(p))} · ${E(p.dx)}</span>${allergyBox(p, "sm")}</div>`, keep:true });
      bl.push({ table:{ cls:"pr-tk", head:`<tr><th>Saat</th><th>İş</th><th>Tür</th><th>Durum</th><th>Yapıldı</th><th>Saat</th><th>Paraf</th></tr>`,
        rows:ts.map(t => `<tr class="${t.state === "done" ? "dn" : ""}"><td class="mono">${shiftClock(t.t)}</td><td>${E(t.label)}</td><td>${KIND_TR[t.kind] || E(t.kind)}</td><td>${t.state === "late" ? "<b>Gecikti</b>" : ST_TR[t.state] || E(t.state)}</td><td class="bx">${t.state === "done" ? "✓" : "☐"}</td><td></td><td></td></tr>`) } });
    });
    if (!bl.length) bl.push({ html:`<p class="pr-mute">Bu nöbette iş yok.</p>` });
    const band = `<div class="pr-id scope"><div class="pr-nmc"><small>${L("pr_nurse")}</small><b>${E(me().name)}</b></div>
      <div><small>${L("pr_shift")}</small><b class="mono">${E(H.SHIFT.start)} → ${E(H.SHIFT.end)}</b></div>
      <div><small>${L("pr_unit")}</small><b>${E(units.join(", ") || "—")}</b></div>
      <div><small>&nbsp;</small><b>${E(tpl("pr_npt", { n:ids.size }))}</b></div></div>`;
    return { band, blocks:bl, unitLine:units.join(" · ") };
  }

  // 30.09c · bakım planı vardiyaları careplan.js'ten (gerçek saate göre: şimdiki vardiya en başta)
  const SHIFTS = () => ((H.carePlan && H.carePlan.shifts) || []).map(s => ({ k:s.k, l:`${s.d} ${s.n}` }));
  const GOAL_S = { met:"✓", partial:"◐", unmet:"✕" };
  function docCp(p) {
    const bl = [], plans = H.carePlan ? H.carePlan.plans(p.id).slice().sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1)) : [];
    const fq = (f) => (H.careCatalog && H.careCatalog.freqName) ? H.careCatalog.freqName(f) : f;
    if (!plans.length) bl.push({ html:`<p class="pr-mute">Bu hastada kayıtlı bakım planı yok.</p>` });
    plans.forEach((pl, n) => {
      const c = pl.snap || {}, act = pl.status === "active";
      const endTxt = pl.end ? ` · sonlandı ${E(pl.end.at || "")}${pl.end.reason ? " · " + E(H.t("cp_end_" + pl.end.reason) !== "cp_end_" + pl.end.reason ? H.t("cp_end_" + pl.end.reason) : pl.end.reason) : ""}` : "";
      bl.push({ html:`<div class="pr-cph"><b>${n + 1}. ${E(c.name || pl.key)}</b>${pl.opt ? ` <span>(${E(pl.opt)})</span>` : ""}<span>Başlangıç ${E(pl.start.label)} · ${E(pl.start.by || "")}${act ? " · sürüyor" : endTxt} · katalog v${E(pl.cv)}</span></div>`, keep:true });
      const li = (arr) => arr.length ? `<ul class="pr-ul">${arr.join("")}</ul>` : `<p class="pr-mute">Seçilmedi</p>`;
      bl.push({ html:`<div class="pr-cp3">
        <div><h4>Nedenler</h4>${li(pl.causes.map(i => `<li>${E((c.causes || [])[i])}</li>`))}</div>
        <div><h4>Hedefler</h4>${li(pl.goals.map(i => `<li>${E((c.goals || [])[i])}</li>`))}</div>
        <div><h4>Faaliyetler</h4>${li(pl.acts.map(i => { const a = (c.acts || [])[i] || {}; return `<li>${E(a.t)} <span class="pr-mute">· ${E(fq((pl.freq || {})[i] || a.f || "shift"))}</span></li>`; }))}</div></div>
        ${pl.note ? `<p><b>Not:</b> ${E(pl.note)}</p>` : ""}` });
      bl.push({ table:{ cls:"pr-ev", head:`<tr><th>Vardiya</th><th>Hedef</th><th>Değerlendiren</th><th>Saat</th><th>Not</th></tr>`,
        rows:SHIFTS().map((s, i) => { const e = (pl.evals || {})[s.k], na = i > pl.start.idx;
          return `<tr><td class="mono">${s.l}</td><td>${na ? "—" : e ? `${GOAL_S[e.goal] || ""} ${E(H.t("cp_g_" + e.goal))}` : "<b>Değerlendirilmedi</b>"}</td><td>${e ? E(e.by) : ""}</td><td class="mono">${e ? E(e.at) : ""}</td><td>${e ? E(e.note || "") : ""}</td></tr>`; }) } });
    });
    bl.push({ html:`<p class="pr-foot">Hemşirelik tanısı hemşirenin kararıdır; sistem yalnız öneri sunar. ✓ karşılandı · ◐ kısmen · ✕ karşılanmadı.</p>` });
    return { band:ptBand(p), blocks:bl, unitLine:unitLineP(p) };
  }

  // Teslim notu metni: hasta ekranındaki "Teslim notu" sekmesi açıksa oradaki (hemşirenin düzenlediği) metin; değilse son mühürlü not.
  function handText(p) {
    const box = document.querySelector(".content .pt-dv");
    if (box && H.state.page === "patient" && (H.state.params || {}).pid === p.id) {
      const g = (k) => { const el = box.querySelector(`[data-dv="${k}"]`); return el ? el.value : ""; };
      return { src:"draft", d:g("d"), o:g("o"), g:g("g"), n:g("n") };
    }
    const h = H.data.handovers.filter(x => x.pid === p.id && x.text).slice(-1)[0];
    if (h) { const parts = h.text.split("\n").map(s => s.replace(/^[DÖ]:\s*/, "")); return { src:"sealed", at:h.at, from:h.from, d:parts[0] || "", o:parts[1] || "", g:parts[2] || "", n:parts[3] || "" }; }
    return null;
  }
  function docHand(p) {
    const tx = handText(p) || { src:"none", d:"", o:"", g:"", n:"" }, bl = [];
    const sealed = H.data.handovers.filter(x => x.pid === p.id && x.text).slice(-1)[0];
    bl.push({ html:`<p class="pr-state">${tx.src === "sealed" ? `Mühürlü not · ${E(tx.from || "")} · ${E(tx.at || "")}` : sealed ? `Taslak · son mühürlü not ${E(sealed.at || "")}` : "Taslak · henüz mühürlenmedi"}</p>` });
    const crit = H.data.alarms.filter(a => a.pid === p.id && a.state === "open" && a.sev === "crit");
    if (crit.length) bl.push({ html:`<div class="pr-warn">Açık kritik alarm: ${E(crit[0].txt)}</div>` });
    [["d", "D · Durum"], ["o", "Ö · Öykü"], ["g", "D · Değerlendirme"], ["n", "Ö · Öneri"]].forEach(([k, l]) => {
      bl.push({ html:`<div class="pr-sbar"><h4>${l}</h4><div class="pr-txt">${tx[k] ? E(tx[k]).replace(/\n/g, "<br>") : "&nbsp;"}</div></div>` });
    });
    bl.push({ html:`<div class="pr-sig"><div><small>${L("pr_sig_give")}</small><b>${E(me().name)}</b><span>${L("pr_sign")}</span><span>${L("pr_time")}</span></div>
      <div><small>${L("pr_sig_take")}</small><b>&nbsp;</b><span>${L("pr_sign")}</span><span>${L("pr_time")}</span></div></div>` });
    bl.push({ html:`<p class="pr-foot">D-Ö-D-Ö: Durum · Öykü · Değerlendirme · Öneri. Taslak sistemin hazırladığı özettir; tanı içermez.</p>` });
    return { band:ptBand(p), blocks:bl, unitLine:unitLineP(p) };
  }

  function docBand(p) {
    return { band:"", blocks:[], unitLine:unitLineP(p), special:"band" };
  }

  /* ================= etiketler =================
   * Etiket yazıcısı her etiketi ayrı sayfa olarak basar: { special:"labels", size:"60mm 30mm", cls, labels:[html] }.
   * Hasta etiketlerinde (tüp, infüzyon) iki kimlik: protokol (barkod) + hasta no. Ad bu etiketlere bilerek konmaz.
   * Klinik içerik (numune adı, ilaç ve order metni) yalnız kayıttan okunur; sistem doz, hız ya da numune önermez. */
  const lbFt = () => `<div class="lb-ft"><b>${E(H.data.hospital.short || "")}</b><span>${E(me().name)} · ${E(stampNow())}</span><span data-copy></span><span data-pno></span></div>`;
  const line = (k, v) => `<span class="lb-f"><small>${L(k)}</small>${v ? `<b>${E(v)}</b>` : `<i></i>`}</span>`;
  function tubeLabel(p, t) {
    const u = unitOfP(p);
    return `<div class="lb-top"><b class="lb-bed mono">${E(bedNo(p))}</b><span class="lb-u">${E(u ? u.tr : "")}</span><span class="lb-r"><small>${L("pr_planned")}</small><b class="mono">${E(shiftClock(t.t))}</b></span></div>
      <div class="lb-bc">${BC(protoOf(p), { h:7 })}</div>
      <div class="lb-mid"><span class="lb-sp"><small>${L("pr_specimen")}</small><b>${E(t.label.replace(/^Numune:\s*/i, ""))}</b></span><b class="lb-r mono">${E(hnOf(p))}</b></div>
      <div class="lb-row">${line("pr_taken_by", t.state === "done" && typeof t.by === "string" ? t.by : "")}${line("pr_time", t.state === "done" ? t.doneAt : "")}</div>${lbFt()}`;
  }
  function docTube(pts) {
    const labels = [];
    pts.forEach(p => pendingLabs(p.id).forEach(t => labels.push(tubeLabel(p, t))));
    const units = [...new Set(pts.map(p => (unitOfP(p) || {}).tr).filter(Boolean))];
    return { special:"labels", size:"60mm 30mm", cls:"tube", labels, unitLine:units.join(" · "), n:labels.length };
  }
  function docIv(p) {
    const u = unitOfP(p);
    const labels = infusions(p.id).map(m => `<div class="lb-top"><b class="lb-bed mono">${E(bedNo(p))}</b><span class="lb-u">${E(u ? u.tr : "")}</span><b class="lb-tag">IV</b></div>
      <div class="lb-drug">${E(m.name)}</div><div class="lb-ord">${E(m.freq)}</div>
      <div class="lb-meta">${L("pr_start")}: <b>${E(m.start || "")}${m.since && m.since !== m.start ? " · " + E(m.since) : ""}</b> · ${L("pr_ordered_by")}: <b>${E(uname(m.by))}</b></div>
      <div class="lb-iv2"><div class="lb-bc">${BC(protoOf(p), { h:7 })}</div><div class="lb-col">${line("pr_prepared_by", "")}${line("pr_time", "")}${line("pr_line_change", "")}</div></div>
      <div class="lb-hn">${L("pr_hn")} <b class="mono">${E(hnOf(p))}</b></div>${lbFt()}`);
    return { special:"labels", size:"80mm 40mm", cls:"iv", labels, unitLine:unitLineP(p), n:labels.length };
  }

  /* ---------- biyomedikal: cihaz etiketi ve bakım iş listesi (hasta bilgisi yok) ---------- */
  const DEV_TODAY = H.isoD(H.clockDate());              // devices.js ile aynı gün (30.09c: gerçek takvim)
  const isoD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const dayDiff = (s) => Math.round((isoD(s) - isoD(DEV_TODAY)) / 864e5);
  const fmtD = (s) => s ? s.split("-").reverse().join(".") : "—";
  const DEV_ROOM = { "Hemşire istasyonu":"dev_rm_nurse", "Depo":"dev_rm_store", "Koridor · acil arabası":"dev_rm_cart", "Müşahidə":"dev_rm_obs" };
  const devRoom = (rm) => /^\d+$/.test(rm) ? L("dev_room_word") + " " + rm : DEV_ROOM[rm] ? L(DEV_ROOM[rm]) : rm;
  const devLoc = (d) => { const u = H.unit(d.unitId), b = d.bedId && H.bed(d.bedId); return `${u ? u.tr : d.unitId} · ${devRoom(d.room)}${b ? " · " + b.no : ""}`; };
  const devKind = (d) => L("dev_kind_" + d.kind);
  const kv2 = (k, v, span) => `<span class="lb-kv2" style="grid-column:span ${span}"><small>${L(k)}</small><b>${E(v)}</b></span>`;
  function docDev(d) {
    const html = `<div class="lb-top"><b class="lb-u">${E(H.data.hospital.short || "")} · ${L("pr_biomed")}</b><b class="lb-r lb-kind">${E(devKind(d))}</b></div>
      <div class="lb-bc">${BC(d.id, { h:8 })}</div>
      <div class="lb-kv">${kv2("pr_serial", d.serial, 3)}${kv2("pr_cert", d.certNo || "—", 3)}${kv2("pr_loc", devLoc(d), 6)}
        ${kv2("pr_last_pm", fmtD(d.lastPM), 2)}${kv2("pr_next_pm", fmtD(d.nextPM), 2)}${kv2("pr_next_cal", d.nextCal ? fmtD(d.nextCal) : L("pr_no_cal"), 2)}</div>${lbFt()}`;
    return { special:"labels", size:"70mm 40mm", cls:"dev", labels:[html], unitLine:L("pr_biomed"), n:1 };
  }
  function docPm() {
    const items = [];
    (H.data.devices || []).filter(d => d.status !== "kullanim_disi").forEach(d => {
      [["pm", d.nextPM], ["cal", d.nextCal]].forEach(([type, date]) => { if (date && dayDiff(date) <= 30) items.push({ d, type, date, n:dayDiff(date) }); });
    });
    items.sort((a, b) => a.date.localeCompare(b.date) || a.d.id.localeCompare(b.d.id));
    const groups = [["pr_g_late", items.filter(x => x.n < 0)], ["pr_g_week", items.filter(x => x.n >= 0 && x.n <= 6)], ["pr_g_next", items.filter(x => x.n > 6)]];
    const bl = [], head = `<tr><th>${L("pr_c_dev")}</th><th>${L("pr_c_kind")}</th><th>${L("pr_loc")}</th><th>${L("pr_c_job")}</th><th>${L("pr_c_due")}</th><th>${L("pr_c_state")}</th><th>${L("pr_c_done")}</th><th>${L("pr_c_date")}</th><th>${L("pr_c_init")}</th></tr>`;
    groups.forEach(([k, list]) => {
      if (!list.length) return;
      bl.push(h3(`${L(k)} · ${list.length}`));
      bl.push({ table:{ cls:"pr-pm", head, rows:list.map(x => `<tr class="${x.n < 0 ? "lt" : ""}"><td class="mono"><b>${E(x.d.id)}</b><br><span class="pr-sm">${E(x.d.serial)}</span></td><td>${E(devKind(x.d))}</td><td>${E(devLoc(x.d))}</td><td>${L(x.type === "pm" ? "dev_ht_pm" : "dev_ht_cal")}</td><td class="mono">${fmtD(x.date)}</td><td>${x.n < 0 ? `<b>${E(tpl("pr_late_d", { n:-x.n }))}</b>` : L("pr_on_time")}</td><td class="bx">☐</td><td></td><td></td></tr>`) } });
    });
    if (!items.length) bl.push({ html:`<p class="pr-mute">${L("pr_no_pm")}</p>` });
    bl.push({ html:`<p class="pr-foot">${L("pr_pm_foot")}</p>` });
    const late = items.filter(x => x.n < 0).length;
    const end = (() => { const t = isoD(DEV_TODAY); t.setDate(t.getDate() + 30); return `${p2(t.getDate())}.${p2(t.getMonth() + 1)}.${t.getFullYear()}`; })();
    const band = `<div class="pr-id scope"><div class="pr-nmc"><small>${L("pr_unit")}</small><b>${L("pr_biomed")}</b></div>
      <div><small>${L("pr_period")}</small><b class="mono">${fmtD(DEV_TODAY)} → ${end}</b></div>
      <div><small>&nbsp;</small><b>${E(tpl("pr_jobs", { n:items.length, late }))}</b></div></div>`;
    return { band, blocks:bl, unitLine:L("pr_biomed") };
  }

  const unitsInView = () => (H.state.unitId ? [H.unit(H.state.unitId)] : me().units.map(H.unit)).filter(u => u && u.live !== false);
  const BST = { bos:"Boş", temizlik:"Temizlikte", bloke:"Bloke", rezerve:"Rezerve" };
  function docUnit(units) {
    const bl = []; let occ = 0, tot = 0;
    units.forEach(u => {
      const o = u.beds.filter(b => b.status === "dolu").length; occ += o; tot += u.beds.length;
      bl.push({ html:`<div class="pr-cph"><b>${E(u.tr)}</b><span>${E(H.kindName(u.kind))} · ${E(H.floorText(u.floor))} · ${E(tpl("pr_occ", { a:o, b:u.beds.length }))} · yatak sırasıyla</span></div>`, keep:true });
      bl.push({ table:{ cls:"pr-un", head:`<tr><th>Yatak</th><th>Oda</th><th>Hasta</th><th>Yaş · cins.</th><th>Tanı</th><th>Gün</th><th>Hekim</th><th>Hemşire</th><th>Skor</th><th>Risk</th><th>Alerji · izolasyon</th><th class="pr-nt">Not</th></tr>`,
        rows:u.beds.map(b => { const p = b.status === "dolu" && b.pid ? H.pt(b.pid) : null;
          if (!p) return `<tr class="pr-em"><td class="mono">${E(b.no)}</td><td>${E(b.room)}</td><td colspan="9">${E(BST[b.status] || b.status)}${b.oos ? " · kullanım dışı" + (b.oosWhy ? ": " + E(b.oosWhy) : "") : ""}</td><td></td></tr>`;
          return `<tr><td class="mono"><b>${E(b.no)}</b></td><td>${E(b.room)}</td><td><b>${E(p.name)}</b><br><span class="mono pr-sm">${E(protoOf(p))}</span></td><td>${E(H.ageText(p))} · ${p.sex}</td><td>${E(p.dx)}</td><td>${p.admitDays}</td><td>${E(uname(p.attending))}</td><td>${E(p.nurse ? uname(p.nurse) : "—")}</td><td>${E(H.isClinical(u) ? H.scoreLabel(p) : "—")}</td><td>${E((H.SEV[p.risk] || H.SEV.stable).l)}</td>
            <td>${p.allergies.length ? `<span class="pr-alg in">${L("pr_allergy")}: ${E(p.allergies.join(", "))}</span>` : ""}${p.isolation ? `<div>İzolasyon: ${E(p.isolation)}</div>` : ""}</td><td></td></tr>`; }) } });
    });
    const band = `<div class="pr-id scope"><div class="pr-nmc"><small>${L("pr_unit")}</small><b>${E(units.map(u => u.tr).join(", "))}</b></div>
      <div><small>&nbsp;</small><b>${E(tpl("pr_occ", { a:occ, b:tot }))}</b></div>
      <div><small>${L("pr_shift")}</small><b class="mono">${E(H.SHIFT.start)} → ${E(H.SHIFT.end)}</b></div></div>`;
    return { band, blocks:bl, unitLine:units.length === 1 ? `${units[0].tr} · ${H.floorText(units[0].floor)}` : units.map(u => u.tr).join(" · "), land:true };
  }

  /* ================= 24.09 (2. parti) =================
   * Barkod etiketleri: hnlbl (Hasta no, kişiye ait) · prlbl (Protokol, bu yatışa ait). Aynı etiketten N adet (1–24).
   *   Karışmasın diye iki ayrı işaret: Hasta no = SİYAH DOLU şerit + daire içinde "H" + ters (siyah zemin) alt yazı;
   *   Protokol = TARALI şerit + kare içinde "P" + çift çerçeve + kesikli alt yazı. Siyah-beyaz yazıcıda da ayırt edilir.
   *   Kâğıt: etiket yazıcı (50×25, her etiket ayrı sayfa) ya da A4 yaprak (3×8 = 24 hücre, 70×37).
   * Hasta adı bu etiketlere konmaz (kimlik = barkodlu numara + yatak). */
  function sticker(kind, p) {
    const hn = kind === "hnlbl", u = unitOfP(p);
    return `<div class="sk ${hn ? "hn" : "pr"}"><div class="sk-mk"><b>${hn ? "H" : "P"}</b></div><div class="sk-c">
      <div class="sk-top"><b class="mono">${E(bedNo(p))}</b><span>${E(u ? u.tr : "")}</span><span class="sk-d mono">${E(H.dmy(0))}</span></div>
      <div class="sk-bc">${BC(hn ? hnOf(p) : protoOf(p), { h:8.5 })}</div>
      <div class="sk-k">${L(hn ? "pr_sk_hn" : "pr_sk_pr")}</div></div></div>`;
  }
  function docStk(kind, p, ctx) {
    const n = Math.max(1, Math.min(24, +ctx.n || 1)), one = sticker(kind, p);
    if (ctx.lay === "a4") return { special:"sheet", html:Array.from({ length:24 }, (_, i) => `<div class="skc">${i < n ? one : ""}</div>`).join(""), n, unitLine:unitLineP(p) };
    return { special:"labels", size:"50mm 25mm", cls:"stk", labels:Array.from({ length:n }, () => one), unitLine:unitLineP(p), n };
  }

  /* ---------- yatak doluluğu (kabul, sorumlu hemşire, yönetim): klinik bilgi yok; ad yalnız adı görebilen rolde ---------- */
  function docOcc(units) {
    const names = H.showNames(), bl = [], tot = { dolu:0, bos:0, temizlik:0, bloke:0, rezerve:0 };
    units.forEach(u => {
      u.beds.forEach(b => { tot[b.status] = (tot[b.status] || 0) + 1; });
      const c = (s) => u.beds.filter(b => b.status === s).length;
      bl.push({ html:`<div class="pr-cph"><b>${E(u.tr)}</b><span>${E(H.kindName(u.kind))} · ${E(H.floorText(u.floor))} · ${L("pr_bs_dolu")} ${c("dolu")} · ${L("pr_bs_bos")} ${c("bos")} · ${L("pr_bs_temizlik")} ${c("temizlik")} · ${L("pr_bs_bloke")} ${c("bloke")} · ${L("pr_bs_rezerve")} ${c("rezerve")}</span></div>`, keep:true });
      bl.push({ table:{ cls:"pr-oc", head:`<tr><th>${L("pr_bed")}</th><th>${L("pr_c_room")}</th><th>${L("pr_c_btype")}</th><th>${L("pr_c_state")}</th><th>${L("pr_c_isoroom")}</th><th>${L("pr_c_pt")}</th>${names ? `<th>${L("pr_proto")}</th>` : ""}<th class="pr-nt">${L("pr_c_note")}</th></tr>`,
        rows:u.beds.map(b => { const p = b.status === "dolu" && b.pid ? H.pt(b.pid) : null;
          return `<tr class="${b.status === "bos" && !b.oos ? "fr" : ""}"><td class="mono"><b>${E(b.no)}</b></td><td>${E(b.room)}</td><td>${E(b.type || "")}</td><td>${L("pr_bs_" + b.status)}${b.oos ? ` · ${L("pr_oos")}${b.oosWhy ? ": " + E(b.oosWhy) : ""}` : ""}</td><td>${b.iso ? "✓" : ""}</td>
            <td>${p ? (names ? E(p.name) : L("pr_bs_dolu")) : ""}</td>${names ? `<td class="mono">${p ? E(protoOf(p)) : ""}</td>` : ""}<td></td></tr>`; }) } });
    });
    const all = Object.values(tot).reduce((a, b) => a + b, 0);
    const band = `<div class="pr-id scope"><div class="pr-nmc"><small>${L("pr_unit")}</small><b>${E(units.length > 3 ? tpl("pr_nunits", { n:units.length }) : units.map(u => u.tr).join(", "))}</b></div>
      <div><small>${L("pr_bs_dolu")}</small><b class="mono">${tot.dolu} / ${all}</b></div><div><small>${L("pr_bs_bos")}</small><b class="mono">${tot.bos}</b></div>
      <div><small>${L("pr_bs_temizlik")}</small><b class="mono">${tot.temizlik}</b></div><div><small>${L("pr_bs_bloke")}</small><b class="mono">${tot.bloke}</b></div><div><small>${L("pr_bs_rezerve")}</small><b class="mono">${tot.rezerve}</b></div></div>`;
    return { band, blocks:bl, unitLine:units.map(u => u.tr).join(" · ") };
  }
  const occUnits = () => H.units().filter(u => me().units.includes(u.id) && (!H.state.unitId || u.id === H.state.unitId));

  /* ---------- izolasyon kapı kartı: yalnız izolasyon türü + yer; ad yok, önlem metni uydurulmaz (ekip doldurur) ---------- */
  const isoName = (v) => { const k = "bu_iso_" + v, r = H.t(k); return r === k ? v : r; };
  function docIso(pts) {
    const pages = pts.map(p => { const b = H.bed(p.bed) || {}, u = unitOfP(p);
      return `<div class="ic-top">${L("pr_iso_title")}</div><div class="ic-type">${E(isoName(p.isolation))}</div>
        <div class="ic-loc"><div><small>${L("pr_unit")}</small><b>${E(u ? u.tr : "")}</b></div><div><small>${L("pr_c_room")}</small><b>${E(b.room || "")}</b></div><div><small>${L("pr_bed")}</small><b class="mono">${E(b.no || "")}</b></div></div>
        <div class="ic-ask">${L("pr_iso_ask")}</div>
        <div class="ic-meas"><h4>${L("pr_iso_meas")}</h4>${Array.from({ length:6 }, () => `<div class="ic-ln"><i>☐</i><span></span></div>`).join("")}</div>
        <div class="ic-sig"><div><small>${L("pr_iso_start")}</small><span></span></div><div><small>${L("pr_prepared_by")}</small><span></span></div><div><small>${L("pr_sign")}</small><span></span></div></div>
        <p class="pr-foot">${L("pr_iso_nm")}</p>`; });
    return { special:"cards", pages, unitLine:[...new Set(pts.map(p => (unitOfP(p) || {}).tr))].join(" · ") };
  }

  /* ---------- arıza iş emri (biyomedikal): cihaz no barkodlu; iş emri no ekranda Türkçe "İ" içerdiği için barkoda değil yazıya konur ---------- */
  const PRI_K = { "yüksek":"dev_pri_yuksek", orta:"dev_pri_orta", "düşük":"dev_pri_dusuk" };
  const whoDev = (u) => u === "sistem" ? L("dev_system_auto") : u === "Yetkili servis" ? L("dev_auth_service") : H.userBy(u) ? H.userBy(u).name : (u || "—");
  function docWo(w) {
    const d = H.data.devices.find(x => x.id === w.deviceId) || { id:w.deviceId, serial:"—", kind:"", room:"", unitId:"" }, bl = [];
    bl.push({ html:`<div class="wo-dev"><div>${BC(d.id, { h:10 })}</div><div class="pr-grid" style="flex:1">${kv(L("pr_c_kind"), E(devKind(d)))}${kv(L("pr_serial"), `<span class="mono">${E(d.serial)}</span>`)}${kv(L("pr_loc"), E(devLoc(d)))}</div></div>` });
    bl.push(h3(L("pr_wo_desc")));
    bl.push({ html:`<div class="pr-sbar"><div class="pr-txt">${E(w.text)}</div></div>
      <div class="pr-grid">${kv(L("pr_wo_open"), `${E(whoDev(w.by))} · <span class="mono">${E(fmtD(w.date))} ${E(w.time)}</span>`)}${kv(L("pr_wo_asg"), E(w.assignee ? whoDev(w.assignee) : "—"))}${kv(L("pr_wo_pri"), E(L(PRI_K[w.priority] || "")))}</div>` });
    if (w.closeNote) { bl.push(h3(L("pr_wo_close"))); bl.push({ html:`<p>${E(w.closeNote)}${w.closedAt ? ` · <span class="mono">${E(fmtD(w.closedAt))}</span>` : ""}</p>` }); }
    bl.push(h3(L("pr_wo_done"))); bl.push({ html:`<div class="pr-sbar"><div class="pr-txt" style="min-height:26mm">&nbsp;</div></div>` });
    bl.push(h3(L("pr_wo_parts"))); bl.push({ html:`<div class="pr-sbar"><div class="pr-txt">&nbsp;</div></div>` });
    bl.push({ html:`<p class="wo-test"><b>${L("pr_wo_test")}:</b> ☐ ${L("pr_wo_ok")} &nbsp; ☐ ${L("pr_wo_nok")}</p>` });
    bl.push({ html:`<div class="pr-sig"><div><small>${L("pr_wo_tech")}</small><b>&nbsp;</b><span>${L("pr_sign")}</span><span>${L("pr_c_date")} · ${L("pr_time")}</span></div>
      <div><small>${L("pr_wo_unit")}</small><b>&nbsp;</b><span>${L("pr_sign")}</span><span>${L("pr_c_date")} · ${L("pr_time")}</span></div></div>` });
    const band = `<div class="pr-id scope"><div class="pr-nmc"><small>${L("pr_d_wo")}</small><b class="mono">${E(w.id)}</b></div>
      <div><small>${L("pr_c_state")}</small><b>${E(L("dev_wst_" + w.state))}</b></div><div><small>${L("pr_wo_pri")}</small><b>${E(L(PRI_K[w.priority] || ""))}</b></div>
      <div><small>${L("pr_c_date")}</small><b class="mono">${E(fmtD(w.date))} ${E(w.time)}</b></div></div>`;
    return { band, blocks:bl, unitLine:L("pr_biomed") };
  }

  /* ---------- eczane: antibiyotik gözden geçirme listesi (order kaydından; kültür sonucu uydurulmaz) ---------- */
  function docAbx() {
    const pts = H.myPatients().filter(p => p.antibioticDay).sort((a, b) => b.antibioticDay - a.antibioticDay);
    const abxOf = (p) => [...new Set(H.data.tasks.filter(t => t.pid === p.id && t.kind === "med" && !t.med).map(t => t.label))].join(", ") || "—";
    const bl = [{ table:{ cls:"pr-ab", head:`<tr><th>${L("pr_bed")}</th><th>${L("pr_c_pt")}</th><th>${L("pr_unit")}</th><th>${L("pr_c_dx")}</th><th>${L("pr_c_abx")}</th><th>${L("pr_c_day")}</th><th>${L("pr_c_alg")}</th><th>${L("pr_c_iso")}</th><th class="pr-nt">${L("pr_c_review")}</th><th>${L("pr_c_init")}</th></tr>`,
      rows:pts.map(p => `<tr><td class="mono"><b>${E(bedNo(p))}</b></td><td><b>${E(p.name)}</b><br><span class="mono pr-sm">${E(protoOf(p))}</span></td><td>${E((unitOfP(p) || {}).tr || "")}</td><td>${E(p.dx)}</td><td>${E(abxOf(p))}</td>
        <td class="mono"><b>${p.antibioticDay}</b>${p.antibioticDay >= 3 ? `<br><span class="pr-sm">${L("pr_review_due")}</span>` : ""}</td><td>${p.allergies.length ? `<span class="pr-alg in">${E(p.allergies.join(", "))}</span>` : "—"}</td><td>${p.isolation ? E(isoName(p.isolation)) : "—"}</td><td></td><td></td></tr>`) } }];
    if (!pts.length) bl.push({ html:`<p class="pr-mute">—</p>` });
    bl.push({ html:`<p class="pr-foot">${L("pr_abx_foot")}</p>` });
    const band = `<div class="pr-id scope"><div class="pr-nmc"><small>${L("pr_c_abx")}</small><b>${E(tpl("pr_npt", { n:pts.length }))}</b></div>
      <div><small>${L("pr_review_due")}</small><b class="mono">${pts.filter(p => p.antibioticDay >= 3).length}</b></div></div>`;
    return { band, blocks:bl, unitLine:[...new Set(pts.map(p => (unitOfP(p) || {}).tr))].join(" · "), land:true };
  }

  /* ---------- hemşirelik formu: nursing.js ekrandaki formdan alan/seçenek/değer listesi verir (ctx.sections) ---------- */
  function docForm(p, ctx) {
    const bl = [], blank = !!ctx.blank;
    bl.push({ html:`<p class="pr-state">${blank ? L("pr_f_blank") : `${L("pr_f_sealed")} · ${E(ctx.at || "")} · ${E(ctx.by || "")}${ctx.summary ? " · " + E(ctx.summary) : ""}`}</p>` });
    const val = (r) => {
      let h = "";
      if (r.opts.length) h += blank ? `<span class="fo-op">${r.opts.map(o => `<span>☐ ${E(o.l)}${o.pt ? ` <i>(${E(o.pt)})</i>` : ""}</span>`).join("")}</span>`
        : (r.opts.filter(o => o.on).map(o => `<b>${E(o.l)}</b>${o.pt ? ` <i>(${E(o.pt)})</i>` : ""}`).join(", ") || `<span class="pr-mute">—</span>`);
      r.parts.forEach(x => { if (x.chk != null) h += `<span class="fo-ck">${x.on ? "☑" : "☐"} ${E(x.chk)}</span>`;
        else h += (h ? " " : "") + (x.v ? `<b>${E(x.v)}</b>${x.u ? " " + E(x.u) : ""}` : `<span class="fo-ln${x.area ? " ar" : ""}"></span>${x.u ? " " + E(x.u) : ""}`); });
      return h || `<span class="fo-ln"></span>`;
    };
    (ctx.sections || []).forEach(s => {
      if (s.t) bl.push(h3(E(s.t)));
      if (s.rows.length) bl.push({ table:{ cls:"pr-fo", head:`<tr><th>${L("pr_f_field")}</th><th>${L("pr_f_value")}</th></tr>`, rows:s.rows.map(r => `<tr><td>${E(r.l)}</td><td>${val(r)}</td></tr>`) } });
      if (s.chips.length) bl.push({ html:`<p><b>${L("pr_f_regions")}:</b> ${E(s.chips.join(", "))}</p>` });
      if (!blank && s.tot.length) bl.push({ html:`<p class="fo-tot">${E(s.tot.join(" · "))}</p>` });
      if (blank && s.tot.length) bl.push({ html:`<p class="fo-tot">${L("pr_total")}: <span class="fo-ln"></span></p>` });
      s.notes.forEach(n => bl.push({ html:`<p class="pr-foot">${E(n)}</p>` }));
    });
    bl.push({ html:`<div class="pr-sig"><div><small>${L("pr_f_by")}</small><b>${blank ? "&nbsp;" : E(ctx.by || "")}</b><span>${L("pr_sign")}</span><span>${L("pr_c_date")} · ${L("pr_time")}</span></div><div style="visibility:hidden"></div></div>` });
    return { band:ptBand(p), blocks:bl, unitLine:unitLineP(p), title:ctx.title };
  }

  /* ================= kopya sayacı ve denetim ================= */
  const COPIES = {};                                   // belge anahtarı → basılan çıktı sayısı (bellekte; sayfa yenilenince sıfırlanır)

  /* ================= önizleme ================= */
  const PV = { key:null, ctx:null, pages:0 };
  const docKeyOf = (key, ctx) => key + "|" + (ctx.form ? ctx.form + (ctx.blank ? ":bos" : "") + "|" : "") + (ctx.wo || ctx.dev || ctx.pid || (ctx.units ? ctx.units.map(u => u.id).join(",") : "") || (ctx.pids ? me().u + ":" + ctx.pids.join(",") : "") || "all");

  function build(key, ctx) {
    if (STK.includes(key)) return docStk(key, H.pt(ctx.pid), ctx);
    if (key === "occ") return docOcc(ctx.units);
    if (key === "iso") return docIso((ctx.pids || [ctx.pid]).map(H.pt).filter(Boolean));
    if (key === "wo") return docWo(H.data.workOrders.find(w => w.id === ctx.wo));
    if (key === "abx") return docAbx();
    if (key === "form") return docForm(H.pt(ctx.pid), ctx);
    if (key === "tasks") return docTasks(ctx.pids.map(H.pt).filter(Boolean));
    if (key === "unit") return docUnit(ctx.units);
    if (key === "pm") return docPm();
    if (key === "dev") return docDev(H.data.devices.find(d => d.id === ctx.dev));
    if (key === "tube") return docTube((ctx.pids || [ctx.pid]).map(H.pt).filter(Boolean));
    const p = H.pt(ctx.pid);
    return { sum:docSum, vit:docVit, cp:docCp, hand:docHand, band:docBand, iv:docIv }[key](p);
  }

  function pageShell(key, d, copyN, hospital) {
    const stamp = copyN > 1 ? `<div class="pr-copy">${L("pr_copy")} ${copyN}</div>` : "";
    const wm = copyN > 1 ? `<div class="pr-wm">${L("pr_copy")} ${copyN}</div>` : "";
    return `<div class="pr-page${d.land ? " land" : ""}">${wm}
      <div class="pr-hd"><div class="pr-hos"><b>${E(hospital.name)}</b><span>${E(d.unitLine || "")}</span></div>
        <div class="pr-dt"><b>${d.title ? E(d.title) : L(DOC_T[key])}</b><span>${E(H.wd(0))} ${E(H.dmy(0))}</span></div>${stamp}</div>
      ${d.band || ""}
      <div class="pr-body"></div>
      <div class="pr-ft"><span>${L("pr_by")}: <b>${E(me().name)}</b> (${E(me().u)}) · ${E(stampNow())}</span><span class="pr-cc">${L("pr_controlled")}</span><span data-pno></span></div></div>`;
  }

  function bandPage(p, copyN, hospital) {
    return `<div class="pr-page band">
      <div class="bb-bed"><small>${L("pr_bed")}</small><b class="mono">${E(bedNo(p))}</b></div>
      <div class="bb-mid"><b class="bb-nm">${E(p.name)}</b><span>${E(H.ageText(p))} · ${E(sexT(p))} · ${L("pr_blood")}: ${E(p.blood)} · ${L("pr_hn")} <span class="mono">${E(hnOf(p))}</span></span>
        ${p.allergies.length ? `<span class="bb-alg">${L("pr_allergy")}: ${E(p.allergies.join(", "))}</span>` : `<span class="bb-na">${L("pr_no_allergy")}</span>`}</div>
      <div class="bb-pr"><small>${L("pr_proto")}</small>${BC(protoOf(p), { h:10 })}</div>
      <div class="bb-ft"><b>${E(hospital.short || hospital.name)}</b><span>${E(me().name)}</span><span>${E(stampNow())}</span>${copyN > 1 ? `<b class="bb-cp">${L("pr_copy")} ${copyN}</b>` : ""}<span>${L("pr_controlled")}</span><span data-pno></span></div></div>`;
  }

  // Blokları ölçerek sayfalara dağıtır: sayfa gövdesi taşarsa yeni sayfa; tablo satır satır bölünür, başlık her sayfada tekrarlanır;
  // "keep" işaretli başlık kendinden sonraki blokla aynı sayfada kalır.
  function paginate(sheets, key, d, copyN, hospital) {
    let page, body;
    const newPage = () => { sheets.insertAdjacentHTML("beforeend", pageShell(key, d, copyN, hospital)); page = sheets.lastElementChild; body = page.querySelector(".pr-body"); };
    const over = () => body.scrollHeight > body.clientHeight + 1;
    const carry = () => { const last = body.lastElementChild; if (last && last.dataset.keep && body.children.length > 1) { last.remove(); newPage(); body.appendChild(last); } else newPage(); };
    newPage();
    d.blocks.forEach(b => {
      if (b.table) {
        const mkT = () => { const t = document.createElement("table"); t.className = "pr-t " + (b.table.cls || ""); t.innerHTML = `<thead>${b.table.head}</thead><tbody></tbody>`; body.appendChild(t); return t; };
        let t = mkT();
        if (over()) { t.remove(); carry(); t = mkT(); }
        b.table.rows.forEach(r => {
          const tb = t.tBodies[0]; tb.insertAdjacentHTML("beforeend", r);
          if (over()) { const row = tb.lastElementChild; row.remove(); if (!tb.children.length) { t.remove(); carry(); } else newPage(); t = mkT(); t.tBodies[0].appendChild(row); }
        });
      } else {
        const el = document.createElement("div"); el.className = "pr-blk"; el.innerHTML = b.html; if (b.keep) el.dataset.keep = "1";
        body.appendChild(el);
        if (over() && body.children.length > 1) { el.remove(); carry(); body.appendChild(el); }
      }
    });
    // son sayfada yalnız "keep" başlığı kalmışsa (içerik yok) sil — olmaz ama güvenlik için
    return sheets.querySelectorAll(".pr-page").length;
  }

  function setPageSize(size) {
    let st = document.getElementById("pr-at-page");
    if (!st) { st = document.createElement("style"); st.id = "pr-at-page"; document.head.appendChild(st); }
    st.textContent = `@page { size:${size}; margin:0; }`;
  }

  function renderSheets() {
    const ov = document.getElementById("prOv"); if (!ov) return;
    const key = PV.key, ctx = PV.ctx, hospital = H.data.hospital;
    const copyN = (COPIES[docKeyOf(key, ctx)] || 0) + 1;
    const d = build(key, ctx);
    const sheets = ov.querySelector(".pr-sheets"); sheets.style.zoom = ""; sheets.innerHTML = "";
    let n;
    if (d.special === "band") { sheets.innerHTML = bandPage(H.pt(ctx.pid), copyN, hospital); n = 1; setPageSize("250mm 30mm"); }
    else if (d.special === "labels") {
      const [w, h] = d.size.split(" ");
      sheets.innerHTML = d.labels.map(x => `<div class="pr-page lbl ${d.cls}" style="width:${w};height:calc(${h} - .4mm)">${x}</div>`).join("");
      n = d.labels.length; setPageSize(d.size);
      sheets.querySelectorAll("[data-copy]").forEach(el => { if (copyN > 1) { el.textContent = `${L("pr_copy")} ${copyN}`; el.className = "lb-cp"; } });
    }
    else if (d.special === "sheet") {                    // A4 etiket yaprağı: 3×8 hücre, kenar boşluğu yok
      sheets.innerHTML = `<div class="pr-page sheet">${d.html}</div>`; n = 1; setPageSize("A4 portrait");
    }
    else if (d.special === "cards") {                    // her kart ayrı A4; şablon başlık/altlık aynı
      d.pages.forEach(h => { sheets.insertAdjacentHTML("beforeend", pageShell(key, d, copyN, hospital)); sheets.lastElementChild.classList.add("card"); sheets.lastElementChild.querySelector(".pr-body").innerHTML = h; });
      n = d.pages.length; setPageSize("A4 portrait");
    }
    else { n = paginate(sheets, key, d, copyN, hospital); setPageSize(d.land ? "A4 landscape" : "A4 portrait"); }
    const lbl = d.special === "labels";
    if (d.special === "sheet" || lbl) PV.stk = d.n || n;
    sheets.querySelectorAll("[data-pno]").forEach((el, i) => { el.textContent = n > 1 || !lbl ? tpl(lbl ? "pr_label_of" : "pr_page_of", { x:i + 1, y:n }) : ""; });
    PV.pages = n;
    const first = sheets.querySelector(".pr-page"), avail = ov.querySelector(".pr-scroll").clientWidth - 24;
    if (first && avail > 0 && first.offsetWidth > avail) sheets.style.zoom = String(Math.max(.3, avail / first.offsetWidth));
    ov.querySelector("[data-pr-info]").innerHTML = `${E(STK.includes(key) ? tpl("pr_stickers", { n:PV.stk }) : tpl(lbl ? "pr_labels" : "pr_pages", { n }))} ·${L("pr_this")}: <b>${copyN > 1 ? `${L("pr_copy")} ${copyN}` : L("pr_first")}</b>`;
  }

  function open(key, ctx) {
    ensureCss();
    if (!canDoc(key) || (ctx.pid && !H.inScope(ctx.pid))) { H.toast(L("pr_denied"), "e"); H.log("Yetkisiz yazdırma denemesi", `${DOC_TR[key] || key}${ctx.pid ? " · " + ctx.pid : ""}`); return; }
    // Teslim notu: hasta ekranındaysak ve sekme açık değilse önce sekmeye geç (hemşirenin taslağı oradan okunur).
    if (key === "hand" && H.state.page === "patient" && (H.state.params || {}).pid === ctx.pid && (H.state.params || {}).tab !== "devir") H.go("patient", { pid:ctx.pid, tab:"devir" });
    PV.key = key; PV.ctx = ctx;
    let ov = document.getElementById("prOv");
    const ptDocs = ctx.pid ? PT_DOCS.filter(k => canDoc(k) && ptHas(k, ctx.pid)) : [];
    if (STK.includes(key)) { ctx.n = Math.max(1, Math.min(24, +ctx.n || 1)); ctx.lay = ctx.lay === "a4" ? "a4" : "roll"; }
    const stkCtl = STK.includes(key) ? `<label class="pr-sel"><span>${L("pr_qty")}</span><input type="number" min="1" max="24" step="1" value="${ctx.n}" data-pr-n style="width:68px;padding:6px 8px"></label>
        <label class="pr-sel"><span>${L("pr_paper")}</span><select data-pr-lay><option value="roll"${ctx.lay === "roll" ? " selected" : ""}>${L("pr_roll")}</option><option value="a4"${ctx.lay === "a4" ? " selected" : ""}>${L("pr_a4sheet")}</option></select></label>` : "";
    const barHtml = `<div class="pr-bar"><b class="pr-ttl">${I("print")}${L("pr_preview")}</b>
        ${ptDocs.length > 1 && ptDocs.includes(key) ? `<label class="pr-sel"><span>${L("pr_doc")}</span><select data-pr-sel>${ptDocs.map(k => `<option value="${k}"${k === key ? " selected" : ""}>${L(DOC_T[k])}</option>`).join("")}</select></label>` : `<span class="pr-one">${ctx.title ? E(ctx.title) : L(DOC_T[key])}</span>`}${stkCtl}
        <span class="pr-info" data-pr-info></span><span class="pr-spc"></span>
        <button type="button" class="btn p" data-pr-send>${I("print")}${L("pr_send")}</button><button type="button" class="btn" data-pr-close>${I("x")}${L("pr_close")}</button></div>
      ${key === "hand" ? `<div class="pr-tip">${L("pr_hand_edit")}</div>` : ""}`;
    if (!ov) {
      ov = document.createElement("div"); ov.id = "prOv"; ov.className = "pr-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
      ov.innerHTML = `<div class="pr-top"></div><div class="pr-scroll"><div class="pr-sheets"></div></div>`;
      document.body.appendChild(ov);
      ov.addEventListener("click", (e) => {
        if (e.target.closest("[data-pr-close]")) return close();
        if (e.target.closest("[data-pr-send]")) return send();
      });
      ov.addEventListener("change", (e) => {
        const s = e.target.closest("[data-pr-sel]"); if (s) return open(s.value, { pid:PV.ctx.pid });
        const nn = e.target.closest("[data-pr-n]"); if (nn) { PV.ctx.n = Math.max(1, Math.min(24, Math.round(+nn.value) || 1)); nn.value = PV.ctx.n; return renderSheets(); }
        const ly = e.target.closest("[data-pr-lay]"); if (ly) { PV.ctx.lay = ly.value; return renderSheets(); }
      });
    }
    ov.querySelector(".pr-top").innerHTML = barHtml;
    ov.setAttribute("aria-label", L(DOC_T[key]));
    // büyük harfe çevirme dile göre yapılır (EN'de "PATİENT" değil "PATIENT")
    ov.setAttribute("lang", ({ AZ:"az", TR:"tr", RU:"ru", EN:"en" })[H.state.lang] || "az");
    document.body.classList.add("pr-open");
    const go = () => renderSheets();
    if (document.fonts && document.fonts.status !== "loaded") { go(); document.fonts.ready.then(() => { if (document.getElementById("prOv") && PV.key === key) go(); }); } else go();
  }

  function close() { const ov = document.getElementById("prOv"); if (ov) ov.remove(); document.body.classList.remove("pr-open"); PV.key = null; }

  function send() {
    const key = PV.key, ctx = PV.ctx; if (!key) return;
    if (!canDoc(key)) { H.toast(L("pr_denied"), "e"); return; }
    const dk = docKeyOf(key, ctx), n = (COPIES[dk] || 0) + 1;
    let who = "";
    if (ctx.dev) { const d = H.data.devices.find(x => x.id === ctx.dev); who = d ? `${d.id} · ${d.serial}` : ctx.dev; }
    else if (key === "pm") who = "biyomedikal · 30 gün";
    else if (ctx.wo) who = `${ctx.wo}`;
    else if (key === "abx") who = "eczane · antibiyotik kullanan hastalar";
    else if (key === "iso" && ctx.pids) who = `${ctx.pids.length} kart · ${ctx.pids.map(id => bedNo(H.pt(id))).join(", ")}`;
    else if (ctx.pid) { const p = H.pt(ctx.pid); who = `${bedNo(p)} · ${p.name} · Protokol ${protoOf(p)}`; }
    else if (ctx.units) who = ctx.units.map(u => u.tr).join(", ");
    else if (ctx.pids) who = `${ctx.pids.length} hasta · ${ctx.pids.map(id => bedNo(H.pt(id))).join(", ")}`;
    const lbl = ["tube", "iv", "dev"].includes(key);
    const extra = STK.includes(key) ? ` · ${PV.stk} adet · ${ctx.lay === "a4" ? "A4 yaprak" : "etiket yazıcı"}` : key === "form" ? ` · ${ctx.title}${ctx.blank ? " (boş form)" : ""}` : "";
    H.log("Belge yazdırıldı", `${DOC_TR[key]} · ${who}${extra} · ${n > 1 ? "KOPYA " + n : "ilk çıktı"} · ${PV.pages} ${lbl || (STK.includes(key) && ctx.lay !== "a4") ? "etiket" : "sayfa"}`);
    COPIES[dk] = n;
    H.toast(L("pr_logged"));
    try { window.print(); } catch (e) { /* yazıcı penceresi açılamadıysa kayıt yine düşmüştür */ }
    close();
  }

  H.print = { open, close, copies:COPIES, docs:Object.keys(DOC_T), canDoc };

  /* ================= düğmeleri yerleştir ================= */
  function ddHtml() {
    const pid = (H.state.params || {}).pid;
    const items = PT_DOCS.filter(k => canDoc(k) && ptHas(k, pid));
    if (!items.length) return "";
    return `<div class="pt-dd pr-dd" data-pr-dd><button type="button" class="btn sm" data-pr-open>${I("print")}${L("pr_print")} ${I("chevD")}</button>
      <div class="menu hidden" data-pr-menu>${items.map(k => `<a data-pr-doc="${k}">${I(DOC_I[k])}${L(DOC_T[k])}</a>`).join("")}<hr><span class="pr-kbd">${L("pr_shortcut")}</span></div></div>`;
  }
  function inject() {
    if (!me()) return;
    const c = document.querySelector(".shell .content"); if (!c) return;
    const pg = H.state.page;
    if (pg === "patient" && canPrintPt()) {
      const bar = c.querySelector(".pt-bar");
      if (bar && !bar.querySelector("[data-pr-dd]")) { const h = ddHtml(); if (h) bar.insertAdjacentHTML("beforeend", h); }
    } else if (pg === "tasks" && canDoc("tasks")) {
      const r = c.querySelector(".ph .r");
      if (r && !r.querySelector("[data-pr-tasks]")) r.insertAdjacentHTML("afterbegin", `<button type="button" class="btn" data-pr-tasks>${I("print")}${L("pr_btn_tasks")}</button>`);
      // Bu nöbette bekleyen numune işi varsa: tüp etiketlerini topluca bas (tur öncesi)
      if (r && canDoc("tube") && !r.querySelector("[data-pr-tubes]") && tasksScope().some(p => pendingLabs(p.id).length)) {
        const b = r.querySelector("[data-pr-tasks]"); b.insertAdjacentHTML("afterend", `<button type="button" class="btn" data-pr-tubes>${I("flask")}${L("pr_btn_tubes")}</button>`);
      }
    } else if (pg === "devices" && canDoc("pm")) {
      const r = c.querySelector(".ph .r");
      if (r && !r.querySelector("[data-pr-pm]")) r.insertAdjacentHTML("afterbegin", `<button type="button" class="btn" data-pr-pm>${I("print")}${L("pr_btn_pm")}</button>`);
    } else if (pg === "beds" && canDoc("unit")) {
      const r = c.querySelector(".ph .r");
      if (r && !r.querySelector("[data-pr-unit]")) r.insertAdjacentHTML("afterbegin", `<button type="button" class="btn" data-pr-unit>${I("print")}${L("pr_btn_unit")}</button>`);
    } else if (pg === "occupancy" && canDoc("occ")) {
      const r = c.querySelector(".ph .r");
      if (r && !r.querySelector("[data-pr-occ]")) r.insertAdjacentHTML("afterbegin", `<button type="button" class="btn" data-pr-occ>${I("print")}${L("pr_btn_occ")}</button>`);
    } else if (pg === "infection" && canDoc("iso") && isoPts().length) {
      const r = c.querySelector(".ph .r");
      if (r && !r.querySelector("[data-pr-iso]")) r.insertAdjacentHTML("afterbegin", `<button type="button" class="btn" data-pr-iso>${I("print")}${L("pr_btn_iso")}</button>`);
    } else if (pg === "pharmacy" && canDoc("abx")) {
      const ph = c.querySelector(".ph");
      if (ph && !ph.querySelector("[data-pr-abx]")) { let r = ph.querySelector(":scope>.r"); if (!r) { ph.insertAdjacentHTML("beforeend", `<div class="r"></div>`); r = ph.querySelector(":scope>.r"); }
        r.insertAdjacentHTML("afterbegin", `<button type="button" class="btn" data-pr-abx>${I("print")}${L("pr_btn_abx")}</button>`); }
    }
  }
  const isoPts = () => H.myPatients().filter(p => p.isolation);
  const orig = H.renderApp;
  if (typeof orig === "function") H.renderApp = function () { const r = orig.apply(this, arguments); try { inject(); } catch (e) { console.warn("yazdir", e); } return r; };
  let queued = false;
  const root = document.getElementById("root");
  if (root && window.MutationObserver) new MutationObserver(() => { if (queued) return; queued = true; Promise.resolve().then(() => { queued = false; try { inject(); } catch (e) { console.warn("yazdir", e); } }); }).observe(root, { childList:true, subtree:true });
  try { inject(); } catch (e) { /* ilk çizim henüz yok */ }

  document.addEventListener("click", (e) => {
    const t = e.target;
    const menu = document.querySelector("[data-pr-menu]");
    if (t.closest("[data-pr-open]")) { if (menu) menu.classList.toggle("hidden"); return; }
    const d = t.closest("[data-pr-doc]");
    if (d) { e.preventDefault(); if (menu) menu.classList.add("hidden"); const pid = (H.state.params || {}).pid; if (pid) open(d.dataset.prDoc, { pid }); return; }
    if (menu && !menu.classList.contains("hidden") && !t.closest("[data-pr-menu]")) menu.classList.add("hidden");
    if (t.closest("[data-pr-tasks]")) return open("tasks", { pids:tasksScope().map(p => p.id) });
    if (t.closest("[data-pr-tubes]")) return open("tube", { pids:tasksScope().filter(p => pendingLabs(p.id).length).map(p => p.id) });
    if (t.closest("[data-pr-pm]")) return open("pm", {});
    if (t.closest("[data-pr-occ]")) return open("occ", { units:occUnits() });
    if (t.closest("[data-pr-iso]")) return open("iso", { pids:isoPts().map(p => p.id) });
    if (t.closest("[data-pr-abx]")) return open("abx", {});
    if (t.closest("[data-pr-unit]")) return open("unit", { units:unitsInView() });
  });
  document.addEventListener("keydown", (e) => {
    const ov = document.getElementById("prOv");
    if (ov && e.key === "Escape") { e.preventDefault(); close(); return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key || "").toLowerCase() !== "p") return;
    if (ov) { e.preventDefault(); send(); return; }
    const pid = (H.state.params || {}).pid;
    if (me() && H.state.page === "patient" && pid && H.pt(pid)) {
      e.preventDefault();
      if (canDoc("sum")) open("sum", { pid }); else { H.toast(L("pr_denied"), "e"); H.log("Yetkisiz yazdırma denemesi", `Ctrl+P · ${pid}`); }
    }
  }, true);

  /* ================= stil =================
   * Kâğıt her temada beyaz, mürekkep siyah: bu yüzden sayfa (.pr-page) içinde bilerek sabit #fff / #000 / gri kullanılır;
   * önizleme çubuğu uygulama temasının değişkenleriyle çizilir. Alerji kutusu kırmızı ama siyah-beyazda kalın çerçeveyle okunur. */
  const CSS = `
.pr-ov{position:fixed;inset:0;z-index:110;background:rgba(2,6,14,.72);display:flex;flex-direction:column}
.pr-top{background:var(--card);border-bottom:1px solid var(--line2);box-shadow:var(--shadow)}
.pr-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px}
.pr-bar .pr-ttl{display:flex;align-items:center;gap:8px;font:700 15px 'Space Grotesk',Figtree,sans-serif}
.pr-bar .pr-ttl svg{width:18px;height:18px;color:var(--pri)}
.pr-bar .pr-spc{flex:1}
.pr-sel{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--mute)}
.pr-sel select{width:auto;padding:6px 9px}
.pr-one{font-weight:700}
.pr-info{font-size:12.5px;color:var(--mute)}
.pr-info b{color:var(--ink)}
.pr-tip{padding:0 14px 10px;font-size:12px;color:var(--mute)}
.pr-scroll{flex:1;overflow:auto;padding:18px 12px 40px}
.pr-sheets{display:flex;flex-direction:column;align-items:center;gap:16px}
.pr-kbd{display:block;padding:4px 10px;font-size:11.5px;color:var(--mute)}
.pr-dd .menu{min-width:240px}
.pr-page{position:relative;width:210mm;height:296mm;background:#fff;color:#000;box-shadow:0 6px 24px rgba(0,0,0,.35);padding:9mm 11mm 7mm;display:flex;flex-direction:column;overflow:hidden;
  font:9.5pt/1.35 Figtree,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pr-page.land{width:297mm;height:209mm}
.pr-page .mono{font-family:'JetBrains Mono',monospace}
.pr-wm{position:absolute;left:0;right:0;top:40%;text-align:center;font:800 64pt Figtree,sans-serif;color:#000;opacity:.07;transform:rotate(-24deg);pointer-events:none;letter-spacing:6px}
.pr-hd{display:flex;align-items:flex-start;gap:10px;border-bottom:1.6pt solid #000;padding-bottom:2.5mm}
.pr-hos{flex:1;min-width:0;display:flex;flex-direction:column}
.pr-hos b{font:700 11.5pt Figtree,sans-serif}
.pr-hos span,.pr-dt span{font-size:8.5pt;color:#333}
.pr-dt{display:flex;flex-direction:column;align-items:flex-end;text-align:right}
.pr-dt b{font:800 13pt 'Space Grotesk',Figtree,sans-serif;text-transform:uppercase;letter-spacing:.3px}
.pr-copy{border:2pt solid #000;padding:1.2mm 3mm;font:800 12pt Figtree,sans-serif;letter-spacing:1px;align-self:center}
.pr-id{display:flex;gap:4mm;align-items:stretch;border:1pt solid #000;border-top:0;padding:2mm 3mm;margin-bottom:3mm;flex-wrap:wrap}
.pr-id>div{display:flex;flex-direction:column;min-width:0}
.pr-id small,.pr-kv span,.pr-sig small{font-size:7pt;text-transform:uppercase;letter-spacing:.4px;color:#444}
.pr-id b{font-size:10.5pt}
.pr-id .pr-bedc b{font-size:15pt;line-height:1.1}
.pr-id .pr-nmc{flex:1 1 40mm}
.pr-id .pr-nmc b{font-size:12pt}
.pr-alg{border:2pt solid #c00;color:#c00;padding:1mm 2.5mm;display:flex;flex-direction:column;justify-content:center;max-width:60mm}
.pr-alg small{color:#c00 !important;font-weight:800}
.pr-alg b{font-size:10.5pt}
.pr-alg.none{border:1pt solid #777;color:#333}
.pr-alg.none small{color:#555 !important}
.pr-alg.none b{font-size:9pt;font-weight:600}
.pr-alg.sm{padding:.5mm 2mm;margin-left:auto}
.pr-alg.sm b{font-size:9pt}
.pr-alg.in{display:inline-block;border-width:1.3pt;padding:0 1.5mm;font-weight:700;font-size:8pt}
.pr-id.scope{border-top:1pt solid #000;border-width:0 0 1pt;padding:1.5mm 0}
.pr-body{flex:1;min-height:0;overflow:hidden}
.pr-blk{margin-bottom:2mm}
.pr-h{font:700 10.5pt Figtree,sans-serif;margin:3mm 0 1.2mm;border-bottom:.8pt solid #000;padding-bottom:.6mm}
.pr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.5mm 5mm}
.pr-kv{display:flex;flex-direction:column;border-bottom:.4pt solid #bbb;padding-bottom:.8mm}
.pr-kv b{font-weight:600}
.pr-ul{margin:0;padding-left:5mm}
.pr-ul li{margin:.4mm 0}
.pr-mute{color:#555;margin:0}
.pr-foot{font-size:7.8pt;color:#333;margin:2mm 0 0}
.pr-t{width:100%;border-collapse:collapse;margin-bottom:2mm;font-size:8.8pt}
.pr-t th{background:#e6e6e6;text-align:left;font-size:7.8pt;text-transform:uppercase;letter-spacing:.2px;border:.6pt solid #000;padding:1mm 1.5mm}
.pr-t td{border:.5pt solid #555;padding:.9mm 1.5mm;vertical-align:top}
.pr-t.pr-cen td,.pr-t.pr-cen th{text-align:center}
.pr-t.pr-z td{padding:.55mm 1.5mm}
.pr-t td.hi{font-weight:800}
.pr-t tr.dn td{color:#555}
.pr-t td.bx{text-align:center;font-size:11pt;width:14mm}
.pr-t.pr-tk td:nth-child(6),.pr-t.pr-tk td:nth-child(7){width:16mm}
.pr-t.pr-tk td:first-child{width:22mm}
.pr-t.pr-un{font-size:8.2pt}
.pr-t.pr-un th.pr-nt{width:30mm}
.pr-t.pr-un tr.pr-em td{color:#555;font-style:italic}
.pr-t .pr-sm{font-size:7pt;color:#333}
.pr-ph{display:flex;align-items:center;gap:3mm;margin:3mm 0 1.2mm;padding:1.2mm 2mm;border:1pt solid #000;background:#f0f0f0;flex-wrap:wrap}
.pr-ph b{font-size:10.5pt}
.pr-ph span{font-size:8.5pt}
.pr-cph{display:flex;flex-direction:column;margin:3mm 0 1.2mm;border-bottom:.8pt solid #000;padding-bottom:.6mm}
.pr-cph b{font-size:10.5pt}
.pr-cph span{font-size:8.2pt;color:#333}
.pr-cp3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4mm}
.pr-cp3 h4,.pr-sbar h4{margin:0 0 .8mm;font-size:8pt;text-transform:uppercase;letter-spacing:.3px}
.pr-state{font-weight:700;margin:1mm 0 2mm}
.pr-warn{border:2pt solid #c00;color:#c00;padding:1.5mm 3mm;font-weight:700;margin-bottom:2mm}
.pr-sbar{border:.8pt solid #000;padding:2mm 3mm;margin-bottom:2mm}
.pr-txt{min-height:14mm;font-size:10pt;line-height:1.45}
.pr-sig{display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:4mm}
.pr-sig>div{display:flex;flex-direction:column;gap:3mm;border:.8pt solid #000;padding:2mm 3mm}
.pr-sig span{border-bottom:.6pt solid #000;padding-top:4mm;font-size:7.5pt;color:#444}
.pr-chart{width:100%;height:auto;display:block}
.pr-chart text{font-family:'JetBrains Mono',monospace;fill:#000}
.pr-ft{display:flex;gap:4mm;align-items:center;border-top:.8pt solid #000;padding-top:1.5mm;margin-top:2mm;font-size:7.8pt}
.pr-ft span:first-child{flex:1}
.pr-ft .pr-cc{font-weight:800;text-transform:uppercase;letter-spacing:.4px;border:.8pt solid #000;padding:.2mm 1.5mm}
.pr-page.band{width:250mm;height:29.6mm;padding:2mm 4mm;display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:1fr auto;gap:0 5mm;align-items:center}
.bb-bed,.bb-pr{display:flex;flex-direction:column;align-items:center;border:1.6pt solid #000;padding:.5mm 3mm}
.bb-bed small,.bb-pr small{font-size:6.5pt;text-transform:uppercase}
.bb-bed b{font-size:20pt;line-height:1}
.bb-pr b{font-size:16pt;line-height:1.05;letter-spacing:.5px}
.bb-mid{display:flex;flex-direction:column;min-width:0;gap:.4mm}
.bb-nm{font-size:13pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bb-mid span{font-size:8pt}
.bb-alg{border:1.8pt solid #c00;color:#c00;font-weight:800;padding:0 2mm;align-self:flex-start;font-size:9pt !important}
.bb-na{color:#444}
.bb-ft{grid-column:1 / -1;display:flex;gap:3mm;font-size:6.3pt;color:#333;border-top:.5pt solid #777;padding-top:.4mm;margin-top:.8mm}
.bb-ft .bb-cp{border:1pt solid #000;padding:0 1.2mm;color:#000}
.bb-ft span[data-pno]{margin-left:auto}
.pr-page .bc{display:inline-flex;flex-direction:column;align-items:center;line-height:1}
.pr-page .bc-s{display:block}
.pr-page .bc-t{font:600 8pt/1.15 'JetBrains Mono',monospace;letter-spacing:.6px;color:#000}
.pr-id>.pr-bcs{flex:1 1 100%;flex-direction:row;gap:8mm;align-items:flex-end;border-top:.5pt dashed #888;padding-top:1.4mm;margin-top:.4mm}
.pr-bcs>div{display:flex;align-items:flex-end;gap:2mm}
.pr-bcs small{padding-bottom:1mm}
.pr-page.band .bb-pr{padding:.4mm 1.5mm}
.bb-pr .bc-t{font-size:9.5pt;font-weight:700}
.pr-t.pr-pm{font-size:8.3pt}
.pr-t.pr-pm tr.lt td{font-weight:600}
.pr-t.pr-pm td:first-child,.pr-t.pr-pm td:nth-child(5){white-space:nowrap}
.pr-t.pr-pm td:nth-child(8),.pr-t.pr-pm td:nth-child(9){width:16mm}
.pr-page.lbl{padding:1.6mm 2.2mm 1.2mm;display:flex;flex-direction:column;gap:.5mm;font:7.5pt/1.2 Figtree,Arial,sans-serif}
.lbl small{font-size:5.6pt;text-transform:uppercase;letter-spacing:.3px;color:#333;display:block}
.lb-top{display:flex;align-items:baseline;gap:2mm;border-bottom:.6pt solid #000;padding-bottom:.4mm}
.lb-bed{font-size:12pt;line-height:1}
.lb-u{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:7pt}
.lb-r{margin-left:auto;text-align:right}
.lb-top .lb-r b{font-size:9pt}
.lb-top .lb-r small{display:inline;margin-right:1mm}
.lb-tag{border:1pt solid #000;padding:0 1.2mm;font-size:8pt}
.lb-kind{font-size:8.5pt}
.lb-bc{display:flex;justify-content:center}
.lb-mid{display:flex;gap:2mm;align-items:flex-end}
.lb-mid b{font-size:8.5pt;white-space:nowrap}
.lb-sp{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.lb-sp small{display:inline;margin-right:1mm}
.lbl.tube .lb-bed{font-size:10.5pt}
.lbl.tube .bc-t{font-size:7pt}
.lb-row,.lb-col{display:flex;gap:2mm}
.lb-col{flex-direction:column;gap:.8mm;flex:1;min-width:0}
.lb-f{flex:1;min-width:0;display:flex;align-items:baseline;gap:1mm}
.lb-f small{display:inline;white-space:nowrap}
.lb-f b{font-size:7.5pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-f i{flex:1;border-bottom:.5pt solid #000;min-width:6mm;height:2.6mm}
.lb-kv{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.5mm 2mm}
.lb-kv2{display:flex;flex-direction:column;min-width:0}
.lb-kv2 small{font-size:4.9pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-kv2 b{font-size:7.2pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.15}
.lb-drug{font-size:10.5pt;font-weight:800;line-height:1.1}
.lb-ord{font-size:7.5pt}
.lb-meta{font-size:6.8pt;color:#222}
.lb-iv2{display:flex;gap:2mm;align-items:flex-end}
.lb-hn{font-size:6.8pt}
.lb-ft{margin-top:auto;display:flex;gap:1.5mm;font-size:5.4pt;color:#333;border-top:.4pt solid #777;padding-top:.3mm;white-space:nowrap;overflow:hidden}
.lb-ft span[data-pno]{margin-left:auto}
.lb-ft .lb-cp{border:.8pt solid #000;padding:0 .8mm;color:#000;font-weight:800}
.pr-sheets .pr-page.lbl{box-shadow:0 4px 14px rgba(0,0,0,.35)}
.pr-page.lbl.stk{padding:1mm 1.2mm}
.sk{display:flex;gap:1.2mm;width:100%;height:100%;min-height:0}
.sk-mk{flex:none;width:5.5mm;display:flex;align-items:center;justify-content:center}
.sk.hn .sk-mk{background:#000}
.sk.pr .sk-mk{background:repeating-linear-gradient(45deg,#000 0 .45mm,#fff .45mm 1.3mm);border:.6pt solid #000}
.sk-mk b{display:grid;place-items:center;width:4.3mm;height:4.3mm;font:900 8pt/1 Figtree,Arial,sans-serif}
.sk.hn .sk-mk b{background:#fff;color:#000;border-radius:50%}
.sk.pr .sk-mk b{background:#fff;color:#000;border:.8pt solid #000}
.sk-c{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between}
.sk.pr .sk-c{outline:.6pt solid #000;outline-offset:-.1mm;padding:0 .6mm}
.sk-top{display:flex;align-items:baseline;gap:1.2mm;font-size:6pt;white-space:nowrap;overflow:hidden}
.sk-top b{font-size:8.5pt}
.sk-top span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.sk-top .sk-d{margin-left:auto;flex:none}
.sk-bc{display:flex;justify-content:center}
.sk-bc .bc-t{font-size:7.5pt;font-weight:700}
.sk-k{font:800 5.6pt/1.3 Figtree,Arial,sans-serif;letter-spacing:.3px;text-align:center;white-space:nowrap;overflow:hidden}
.sk.hn .sk-k{background:#000;color:#fff}
.sk.pr .sk-k{border:.6pt dashed #000}
.pr-page.sheet{padding:0;display:grid;grid-template-columns:repeat(3,70mm);grid-auto-rows:37mm;align-content:start}
.skc{padding:3mm 4mm;box-sizing:border-box;outline:.3pt dashed #bbb;outline-offset:-.15mm;display:flex}
.skc .sk-mk{width:7mm}
.skc .sk-mk b{width:5.5mm;height:5.5mm;font-size:10pt}
.skc .sk-top b{font-size:10pt}
.skc .sk-top{font-size:7pt}
.skc .sk-k{font-size:6.5pt}
.pr-t.pr-oc tr.fr td{font-weight:600}
.pr-t.pr-oc th.pr-nt,.pr-t.pr-ab th.pr-nt{width:34mm}
.pr-t.pr-ab{font-size:8.2pt}
.pr-page.card .pr-body{display:flex;flex-direction:column;gap:5mm}
.ic-top{background:#000;color:#fff;text-align:center;font:900 30pt/1.3 'Space Grotesk',Figtree,sans-serif;letter-spacing:6px;padding:2mm 0}
.ic-type{text-align:center;font:900 44pt/1.1 'Space Grotesk',Figtree,sans-serif;border:3pt solid #000;padding:6mm 2mm;text-transform:uppercase}
.ic-loc{display:grid;grid-template-columns:2fr 1fr 1fr;gap:4mm}
.ic-loc>div{border:1pt solid #000;padding:2mm 3mm;display:flex;flex-direction:column}
.ic-loc small,.ic-sig small{font-size:7.5pt;text-transform:uppercase;letter-spacing:.4px;color:#444}
.ic-loc b{font-size:16pt}
.ic-ask{font:700 15pt/1.35 Figtree,sans-serif;text-align:center;border-top:1.2pt solid #000;border-bottom:1.2pt solid #000;padding:3mm 0}
.ic-meas h4{margin:0 0 2mm;font-size:10pt;text-transform:uppercase;letter-spacing:.3px}
.ic-ln{display:flex;gap:3mm;align-items:flex-end;height:9mm}
.ic-ln i{font-style:normal;font-size:14pt}
.ic-ln span{flex:1;border-bottom:.8pt solid #000}
.ic-sig{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.ic-sig>div{display:flex;flex-direction:column;gap:6mm}
.ic-sig span{border-bottom:.8pt solid #000}
.wo-dev{display:flex;gap:6mm;align-items:center;border:1pt solid #000;padding:2mm 3mm}
.wo-test{font-size:10.5pt;margin:3mm 0}
.pr-t.pr-fo td:first-child{width:62mm;font-weight:600}
.pr-t.pr-fo i{font-style:normal;color:#444}
.fo-op{display:flex;flex-wrap:wrap;gap:1mm 4mm}
.fo-ck{display:inline-block;margin-right:4mm}
.fo-ln{display:inline-block;min-width:40mm;border-bottom:.6pt solid #000;height:3.6mm;vertical-align:bottom}
.fo-ln.ar{display:block;min-width:0;height:12mm}
.fo-tot{font-weight:700;font-size:10.5pt;margin:1mm 0 2mm}
@media (max-width:640px){.pr-bar{gap:8px}.pr-bar .pr-spc{display:none}.pr-bar .btn{flex:1;justify-content:center}}
@media print{
  html,body{height:auto !important;background:#fff !important}
  body.pr-open>*:not(#prOv){display:none !important}
  body.pr-open #prOv{position:static;inset:auto;background:#fff;display:block}
  body.pr-open .pr-top{display:none}
  body.pr-open .pr-scroll{overflow:visible;padding:0}
  body.pr-open .pr-sheets{zoom:1 !important;display:block}
  body.pr-open .pr-page{box-shadow:none;margin:0;break-after:page;page-break-after:always}
  body.pr-open .pr-page:last-child{break-after:auto;page-break-after:auto}
}`;
  function ensureCss() { if (document.getElementById("pr-css")) return; const s = document.createElement("style"); s.id = "pr-css"; s.textContent = CSS; document.head.appendChild(s); }
  ensureCss();
})();
