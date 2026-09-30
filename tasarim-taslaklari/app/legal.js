/* Homunculus · yasal ve destek sayfaları (giriş gerektirmez)
   H.legal.open("privacy" | "terms" | "notice" | "support") — tam ekran katman.
   Belgede [data-legal="..."] olan her öğe tıklanınca ilgili sayfayı açar.
   Metin kuralları: uydurma yasa adı / madde no / telefon / e-posta adresi yok; tek iletişim "hastanenin bilgi işlem birimi" (24.09 Ozan: dahili numara yazılmaz).
   Sürüm tarihi bilerek sabit yazılır (yasal metnin sürümü değişmedikçe tarih de değişmez).
   24.09 (yenileme): tam genişlik düzen — üstte kahraman şeridi, altında 3 sütun (içindekiler · metin · yan panel), altta belge kartları.
   İçerik ekranlara ve rollere göre ayrıntılandırıldı; TR ana metin, AZ / RU / EN ondan.
   24.09 (5. tur · Ozan): tam genişlik üç sütun — solda yapışkan içindekiler, ortada metin (satır ~72ch, sütun ekranı doldurur),
   sağda yapışkan "Kısaca" kartı (5 madde, tarih, sorumlu birim, Yazdır/PDF). Üstte 5 sekme. Yeni sayfa "cookies"
   (tarayıcıda saklanan anahtarların TAM listesi — app/*.js taranarak çıkarıldı; yeni bir hmc.* anahtarı eklenirse STORE'a da ekleyin).
   Destek: SSS gruplandı (+6 soru) ve "Sorun bildir" formu (yalnız ekranda teşekkür gösterir, hiçbir yere göndermez).
   Hukukçunun okuduğu metinler anlamca değişmedi; eklemeler EXTRA / SUP / C.cookies içinde. */
(function () {
  const H = window.H;
  if (!H) return;
  const KEYS = ["privacy", "terms", "notice", "cookies", "support"];
  const ICON = { privacy:"shield", terms:"file", notice:"eye", cookies:"key", support:"bell" };

  H.addT({
    lgl_tab_privacy:{ AZ:"Məxfilik", TR:"Gizlilik", RU:"Конфиденциальность", EN:"Privacy" },
    lgl_tab_terms:  { AZ:"İstifadə şərtləri", TR:"Kullanım koşulları", RU:"Условия", EN:"Terms" },
    lgl_tab_notice: { AZ:"Məlumatlandırma", TR:"Aydınlatma", RU:"Уведомление", EN:"Data notice" },
    lgl_tab_cookies:{ AZ:"Kukilər", TR:"Çerezler", RU:"Cookie", EN:"Cookies" },
    lgl_tab_support:{ AZ:"Dəstək", TR:"Destek", RU:"Поддержка", EN:"Support" },
    lgl_docs:    { AZ:"Sənədlər", TR:"Belgeler", RU:"Документы", EN:"Documents" },
    lgl_cookies: { AZ:"Kukilər və yerli yaddaş", TR:"Çerezler ve Yerel Depolama", RU:"Cookie и локальное хранилище", EN:"Cookies and Local Storage" },
    lgl_cookies_s:{ AZ:"Brauzerdə nə saxlanılır, nə üçün və necə silinir", TR:"Tarayıcıda ne saklanır, neden ve nasıl silinir", RU:"Что хранится в браузере, зачем и как это удалить", EN:"What is stored in your browser, why, and how to delete it" },
    lgl_brief:   { AZ:"Qısaca", TR:"Kısaca", RU:"Коротко", EN:"In short" },
    lgl_upd_l:   { AZ:"Son yenilənmə", TR:"Son güncelleme", RU:"Последнее обновление", EN:"Last updated" },
    lgl_upd_v:   { AZ:"Sentyabr 2026", TR:"Eylül 2026", RU:"Сентябрь 2026", EN:"September 2026" },
    lgl_owner_l: { AZ:"Məsul bölmə", TR:"Sorumlu birim", RU:"Ответственное подразделение", EN:"Responsible unit" },
    lgl_owner_mgmt:{ AZ:"Xəstəxana rəhbərliyi", TR:"Hastane yönetimi", RU:"Администрация больницы", EN:"Hospital management" },
    lgl_print:   { AZ:"Çap et / PDF", TR:"Yazdır / PDF", RU:"Печать / PDF", EN:"Print / PDF" },
    lgl_print_s: { AZ:"Çap pəncərəsində “PDF kimi saxla” seçsəniz, fayl kimi alırsınız.", TR:"Yazdırma penceresinde “PDF olarak kaydet”i seçerseniz dosya olarak alırsınız.", RU:"В окне печати выберите «Сохранить как PDF», чтобы получить файл.", EN:"Choose “Save as PDF” in the print dialog to get a file." },
    lgl_f_topic: { AZ:"Mövzu", TR:"Konu", RU:"Тема", EN:"Topic" },
    lgl_f_t1:    { AZ:"Giriş və hesab", TR:"Giriş ve hesap", RU:"Вход и учётная запись", EN:"Sign-in and account" },
    lgl_f_t2:    { AZ:"Bildiriş və səs", TR:"Bildirim ve ses", RU:"Уведомления и звук", EN:"Notifications and sound" },
    lgl_f_t3:    { AZ:"Cihaz məlumatı", TR:"Cihaz verisi", RU:"Данные приборов", EN:"Device data" },
    lgl_f_t4:    { AZ:"Ekran, çap və ya səlahiyyət", TR:"Ekran, yazdırma ya da yetki", RU:"Экран, печать или доступ", EN:"Screen, printing or access" },
    lgl_f_t5:    { AZ:"Digər", TR:"Diğer", RU:"Другое", EN:"Other" },
    lgl_f_where: { AZ:"Hansı ekranda?", TR:"Hangi ekranda?", RU:"На каком экране?", EN:"Which screen?" },
    lgl_f_where_ph:{ AZ:"Çarpayı paneli, xəstə ekranı, sənədlər…", TR:"Yatak paneli, hasta ekranı, belgeler…", RU:"Панель коек, экран пациента, документы…", EN:"Bed panel, patient screen, documents…" },
    lgl_f_bed:   { AZ:"Çarpayı nömrəsi", TR:"Yatak numarası", RU:"Номер койки", EN:"Bed number" },
    lgl_f_opt:   { AZ:"istəyə bağlı", TR:"isteğe bağlı", RU:"необязательно", EN:"optional" },
    lgl_f_what:  { AZ:"Nə baş verdi?", TR:"Ne oldu?", RU:"Что произошло?", EN:"What happened?" },
    lgl_f_what_ph:{ AZ:"Nə etdiniz, nə gözləyirdiniz, nə baş verdi? Ekranda xəta mesajı varsa, olduğu kimi yazın.", TR:"Ne yaptınız, ne bekliyordunuz, ne oldu? Ekranda hata mesajı varsa aynen yazın.", RU:"Что вы сделали, что ожидали и что произошло? Если на экране есть сообщение об ошибке, перепишите его дословно.", EN:"What did you do, what did you expect, and what happened? If there is an error message, copy it word for word." },
    lgl_f_impact:{ AZ:"Xəstəyə qulluğa təsir edirmi?", TR:"Hasta bakımını etkiliyor mu?", RU:"Влияет ли это на уход за пациентом?", EN:"Does it affect patient care?" },
    lgl_f_yes:   { AZ:"Bəli, təsir edir", TR:"Evet, etkiliyor", RU:"Да, влияет", EN:"Yes, it does" },
    lgl_f_no:    { AZ:"Xeyr", TR:"Hayır", RU:"Нет", EN:"No" },
    lgl_f_urgent:{ AZ:"Gözləməyin: əvvəlcə klinik təcili hal addımlarını tətbiq edin və vəziyyəti dərhal İT şöbəsinə bildirin.", TR:"Beklemeyin: önce klinik acil durum adımlarını uygulayın ve durumu hemen bilgi işleme bildirin.", RU:"Не ждите: сначала выполните шаги экстренной ситуации и сразу сообщите в ИТ-отдел.", EN:"Do not wait: follow the clinical emergency steps first and tell IT straight away." },
    lgl_f_noname:{ AZ:"Xəstənin adını, şəxsiyyət və ya protokol nömrəsini yazmadım.", TR:"Hasta adı, kimlik ya da protokol numarası yazmadım.", RU:"Я не указал имя пациента, номер документа или протокола.", EN:"I have not written a patient name, ID or record number." },
    lgl_f_send:  { AZ:"Bildirişi göndər", TR:"Bildirimi gönder", RU:"Отправить сообщение", EN:"Send report" },
    lgl_f_need:  { AZ:"Nə baş verdiyini yazın və xəstə adını yazmadığınızı təsdiqləyin.", TR:"Ne olduğunu yazın ve hasta adı yazmadığınızı onaylayın.", RU:"Опишите, что произошло, и подтвердите, что не указали имя пациента.", EN:"Describe what happened and confirm you have not written a patient name." },
    lgl_f_thx_h: { AZ:"Təşəkkürlər, bildirişiniz qəbul olundu", TR:"Teşekkürler, bildiriminiz alındı", RU:"Спасибо, сообщение принято", EN:"Thank you, your report has been received" },
    lgl_f_thx_p: { AZ:"Xəstəxananızın İT şöbəsi onu araşdıracaq. Vəziyyəti İT şöbəsindən öyrənə bilərsiniz.", TR:"Hastanenizin bilgi işlem birimi inceleyecek. Durumunu bilgi işlemden öğrenebilirsiniz.", RU:"ИТ-отдел вашей больницы рассмотрит его. О статусе можно узнать в ИТ-отделе.", EN:"Your hospital IT department will look into it. You can ask IT about its status." },
    lgl_f_again: { AZ:"Yeni bildiriş", TR:"Yeni bildirim", RU:"Новое сообщение", EN:"New report" },
    lgl_p_count: { AZ:"Bu brauzerdə hazırda {n} Homunculus seçimi saxlanılıb.", TR:"Bu tarayıcıda şu an {n} Homunculus tercihi kayıtlı.", RU:"Сейчас в этом браузере сохранено настроек Homunculus: {n}.", EN:"{n} Homunculus preferences are currently stored in this browser." },
    lgl_p_none:  { AZ:"Bu brauzerdə saxlanılmış Homunculus seçimi yoxdur.", TR:"Bu tarayıcıda kayıtlı Homunculus tercihi yok.", RU:"В этом браузере нет сохранённых настроек Homunculus.", EN:"No Homunculus preferences are stored in this browser." },
    lgl_p_btn:   { AZ:"Seçimlərimi sil", TR:"Tercihlerimi sil", RU:"Удалить мои настройки", EN:"Delete my preferences" },
    lgl_p_ask:   { AZ:"Bu brauzerdəki {n} Homunculus seçimi silinəcək: dil, tema, şrift ölçüsü, bildiriş və səs seçimləri, yadda saxlanmış istifadəçi adı. Səhifə yenilənəcək; yenidən daxil olmağınız lazım ola bilər. Davam edilsin?", TR:"Bu tarayıcıdaki {n} Homunculus tercihi silinecek: dil, tema, yazı boyu, bildirim ve ses tercihleri, hatırlanan kullanıcı adı. Sayfa yenilenecek; yeniden giriş yapmanız gerekebilir. Devam edilsin mi?", RU:"Будут удалены настройки Homunculus в этом браузере ({n}): язык, тема, размер шрифта, настройки уведомлений и звука, запомненное имя пользователя. Страница перезагрузится; возможно, потребуется войти снова. Продолжить?", EN:"The {n} Homunculus preferences in this browser will be deleted: language, theme, text size, notification and sound settings, and the remembered username. The page will reload; you may need to sign in again. Continue?" },
    lgl_p_yes:   { AZ:"Bəli, sil", TR:"Evet, sil", RU:"Да, удалить", EN:"Yes, delete" },
    lgl_p_no:    { AZ:"İmtina", TR:"Vazgeç", RU:"Отмена", EN:"Cancel" },
    lgl_p_done:  { AZ:"Seçimləriniz silindi. Standart ayarlar istifadə olunur.", TR:"Tercihleriniz silindi. Varsayılan ayarlar kullanılıyor.", RU:"Ваши настройки удалены. Используются настройки по умолчанию.", EN:"Your preferences have been deleted. Default settings are in use." },
    lgl_p_keys:  { AZ:"Saxlanılmış açarlar", TR:"Kayıtlı anahtarlar", RU:"Сохранённые ключи", EN:"Stored keys" },
    lgl_back:    { AZ:"Geri", TR:"Geri", RU:"Назад", EN:"Back" },
    lgl_updated: { AZ:"Son yenilənmə: sentyabr 2026", TR:"Son güncelleme: Eylül 2026", RU:"Последнее обновление: сентябрь 2026", EN:"Last updated: September 2026" },
    lgl_toc:     { AZ:"Bu səhifədə", TR:"Bu sayfada", RU:"На этой странице", EN:"On this page" },
    lgl_more:    { AZ:"Digər sənədlər", TR:"Diğer belgeler", RU:"Другие документы", EN:"Other documents" },
    lgl_lang:    { AZ:"Dil", TR:"Dil", RU:"Язык", EN:"Language" },
    lgl_crumb:   { AZ:"Hüquqi məlumat və dəstək", TR:"Yasal ve destek", RU:"Правовая информация и поддержка", EN:"Legal and support" },
    lgl_contact: { AZ:"Xəstəxananın İT şöbəsi", TR:"Hastanenin bilgi işlem birimi", RU:"ИТ-отдел больницы", EN:"The hospital IT department" },
    lgl_contact_s:{ AZ:"Bütün dəstək, hesab və səlahiyyət sorğuları üçün", TR:"Tüm destek, hesap ve yetki talepleri için", RU:"По всем вопросам поддержки, учётных записей и прав", EN:"For all support, account and access requests" },
    lgl_keys:    { AZ:"Xülasə: bu sənədin 3 əsas məqamı", TR:"Özet: bu belgenin 3 ana noktası", RU:"Кратко: 3 главных пункта документа", EN:"Summary: the 3 key points of this document" },
    lgl_related: { AZ:"Əlaqəli sənədlər", TR:"İlgili belgeler", RU:"Связанные документы", EN:"Related documents" },
    lgl_help_h:  { AZ:"Dəstək", TR:"Destek", RU:"Поддержка", EN:"Support" },
    lgl_help_p:  { AZ:"Giriş, nasazlıq və ya səlahiyyət problemlərində xəstəxananın İT şöbəsinə müraciət edin.", TR:"Giriş, arıza ya da yetki sorunlarında hastanenin bilgi işlem birimine başvurun.", RU:"При проблемах со входом, сбоях или правах доступа обращайтесь в ИТ-отдел больницы.", EN:"For sign-in, fault or access problems, contact the hospital IT department." },
    lgl_help_em: { AZ:"Sistem işləmirsə, qulluq dayanmır: çarpayı başı monitor və ehtiyat prosedur.", TR:"Sistem çalışmıyorsa bakım durmaz: yatak başı monitör ve yedek prosedür.", RU:"Если система не работает, уход не прекращается: прикроватный монитор и резервная процедура.", EN:"If the system is down, care does not stop: bedside monitor and backup procedure." },
    lgl_help_go: { AZ:"Dəstək səhifəsini aç", TR:"Destek sayfasını aç", RU:"Открыть страницу поддержки", EN:"Open the support page" },
    lgl_help_em_go:{ AZ:"Klinik təcili hala keç", TR:"Klinik acil duruma git", RU:"К экстренной ситуации", EN:"Go to clinical emergency" },
    lgl_read:    { AZ:"{n} dəq oxu", TR:"{n} dk okuma", RU:"{n} мин чтения", EN:"{n} min read" },
    lgl_secs:    { AZ:"{n} bölmə", TR:"{n} bölüm", RU:"{n} разделов", EN:"{n} sections" },
    lgl_langs4:  { AZ:"4 dildə", TR:"4 dilde", RU:"На 4 языках", EN:"In 4 languages" },
    lgl_totop:   { AZ:"Yuxarı qayıt", TR:"Başa dön", RU:"Наверх", EN:"Back to top" },
    lgl_privacy: { AZ:"Məxfilik siyasəti", TR:"Gizlilik Politikası", RU:"Политика конфиденциальности", EN:"Privacy Policy" },
    lgl_terms:   { AZ:"İstifadə şərtləri", TR:"Kullanım Koşulları", RU:"Условия использования", EN:"Terms of Use" },
    lgl_notice:  { AZ:"Fərdi məlumatların qorunması üzrə məlumatlandırma bildirişi", TR:"Kişisel Verilerin Korunması Aydınlatma Metni", RU:"Уведомление об обработке персональных данных", EN:"Personal Data Protection Notice" },
    lgl_support: { AZ:"Dəstək və əlaqə", TR:"Destek ve İletişim", RU:"Поддержка и контакты", EN:"Support and Contact" },
    lgl_privacy_s: { AZ:"Hansı məlumat hansı ekranda, kim nəyi görür, necə qorunur", TR:"Hangi veri hangi ekranda, kim neyi görür, nasıl korunur", RU:"Какие данные на каком экране, кто что видит, как защищено", EN:"Which data on which screen, who sees what, how it is protected" },
    lgl_terms_s:   { AZ:"Tibbi məsuliyyət, sistemin sərhədləri və iş yeri qaydaları", TR:"Tıbbi sorumluluk, sistemin sınırları ve istasyon kuralları", RU:"Медицинская ответственность, границы системы и правила рабочего места", EN:"Medical responsibility, system limits and workstation rules" },
    lgl_notice_s:  { AZ:"Əhatə, məlumat kateqoriyaları, məqsədlər, saxlama və hüquqlar", TR:"Kapsam, veri kategorileri, amaçlar, saklama ve haklar", RU:"Сфера, категории данных, цели, хранение и права", EN:"Scope, data categories, purposes, retention and rights" },
    lgl_support_s: { AZ:"Tez-tez verilən suallar, nasazlıq və təcili hallar", TR:"Sık sorulan sorular, arıza ve acil durum", RU:"Частые вопросы, сбои и экстренные ситуации", EN:"Frequent questions, faults and emergencies" },
  });

  /* ---------- içerik ----------
     Her belge × dil: { lede, keys:[3], secs:[[başlık, bloklar, bayrak]] }
     Blok: "metin" → paragraf · ["a","b"] → madde listesi · "{C}" → iletişim kartı
           {tb:[başlıklar], rows:[[hücre]]} → tablo (hücre "+x" yeşil rozet, "-x" gri rozet, "~x" sarı rozet)
           {duo:[[başlık, [maddeler]], [başlık, [maddeler]]]} → yapar / yapmaz
           {faq:[[soru, [bloklar]]]} → açılır sorular · {ol:[adımlar]} → numaralı adımlar · {note:"metin"} → bilgi kutusu
     Metinde **kalın** ve {H} (hastane adı) kullanılabilir. Bayrak "warn" → vurgulu uyarı bölümü. */
  const C = {
    privacy: {
      TR: {
        lede:"Homunculus'ta hangi verinin hangi ekranda kullanıldığını, kimin neyi görebildiğini ve verinin nasıl korunduğunu anlatır.",
        keys:["Veriler hastanenin kendi sunucularında tutulur; bugünkü tek istisna tarayıcıda çalışan sesle yazdırmadır.",
              "Herkes yalnız görevinin gerektirdiğini görür; biyomedikal, kalite, yönetim ve bilgi işlem hasta adını görmez.",
              "Her erişim değiştirilemez denetim kaydına yazılır; kamera görüntüsü kaydedilmez, telefona giden bildirimde hasta adı yoktur."],
        secs:[
          ["Veri sorumlusu ve kapsam", ["Homunculus, yoğun bakım birimlerinde kullanılan bir klinik karar destek sistemidir. Bu sistemde işlenen kişisel verilerin sorumlusu, sistemi kullanan hastanedir: {H}.",
            "Sistem, hastanenin belirlediği amaçlar ve talimatlar doğrultusunda, yalnızca hizmetin yürütülmesi için gereken ölçüde veri işler. Bu politika sistemi kullanan çalışanlar içindir; hastalar ve hasta yakınları için ayrıca Aydınlatma Metni vardır."]],
          ["Hangi veri, hangi ekranda", ["Her ekran yalnız kendi işi için gereken veriyi gösterir. Aşağıdaki tablo, verinin nerede kullanıldığını ve nereden geldiğini özetler.",
            {tb:["Ekran", "Kullanılan veri", "Kaynağı"], rows:[
              ["Yatak paneli", "Yatak numarası, hasta adı (yetkili rollerde), yaşamsal bulguların son değerleri, erken uyarı skoru, açık uyarılar", "Yatak başı cihazlar, hastane kayıt sistemi"],
              ["Monitör ve duvar görünümü", "Anlık dalga formları ve sayısal değerler, cihaz alarmları, bağlantı durumu", "Yatak başı monitör, ventilatör, infüzyon pompası"],
              ["Hasta ekranı ve bakım planı", "Yatış ve tanı bilgisi, ilaç ve sıvı kayıtları, laboratuvar sonuçları, bakım hedefleri, görevler, teslim notları", "Hastane kayıt sistemi, ekibin girdiği kayıtlar"],
              ["Belgeler", "Epikriz, konsültasyon ve bakım notları, sesle yazdırılan metin", "Ekibin girdiği kayıtlar"],
              ["Kamera", "Yalnız canlı görüntü; kayıt tutulmaz", "Yatak başı kamera (hastane ağı)"],
              ["Denetim kaydı", "Kim, ne zaman, hangi kayda, hangi işlemi, hangi istasyondan yaptı", "Sistemin kendisi"],
              ["Hesap ve ayarlar", "Ad-soyad, unvan, birim, rol, bildirim tercihleri, açık oturumlar", "Bilgi işlem, kullanıcının kendisi"]]}]],
          ["Kim neyi görür", ["Erişim role göre verilir. Herkes yalnız kendi birimindeki hastaları ve görevinin gerektirdiği ekranları görür.",
            {tb:["Rol", "Gördükleri", "Hasta adı"], rows:[
              ["Hekim", "Birimindeki yataklar, hasta ekranının tüm sekmeleri, skorlar ve onay, gerekçe yazarak kamera", "+Görür"],
              ["Hemşire", "Birimindeki yataklar, görevler, bakım planı, yatak başı kayıtlar; skor, ilaç ve sonuçları görüntüler", "+Görür"],
              ["Eczacı", "Hasta özeti, ilaç ve sonuç sekmeleri", "+Görür"],
              ["Biyomedikal", "Cihaz listesi, bağlantı durumu, bakım kayıtları", "-Görmez"],
              ["Kalite", "Kalite göstergeleri ve denetim kaydı; hastalar yatak numarasıyla, ad maskeli", "~Yatak no ile maskeli"],
              ["Başhekim / yönetici", "Birim özetleri, doluluk, kalite göstergeleri", "-Görmez"],
              ["Bilgi işlem", "Hesaplar, roller, birimler, entegrasyon ve sistem ayarları; klinik içerik yok", "-Görmez"]]},
            "Bir kişiye rolünün ötesinde ek yetki verilebilir ya da yetkisi kısılabilir. Her değişiklik, kimin yaptığıyla birlikte denetim kaydına yazılır."]],
          ["Kamera görüntüsü", [[
            "Kamera yalnız canlı görüntü verir. **Görüntü kaydedilmez ve saklanmaz.**",
            "İzlemeyi açmak için gerekçe yazılır; izleme süresi sınırlıdır ve süre dolunca kendiliğinden kapanır.",
            "Yatak başındaki ekip mahremiyet perdesini açtığında görüntü kapanır.",
            "Her açılış, kimin hangi yatağa ne kadar süre baktığıyla birlikte denetim kaydına yazılır.",
            "Görüntü hastane ağı içinde kalır."]]],
          ["Bildirimler", [[
            "Size yalnız rolünüzü ve birimlerinizi ilgilendiren bildirimler gelir.",
            "Telefona yalnız kritik alarm gider ve **bildirimde hasta adı yoktur**; yatak numarası ve alarm türü yer alır.",
            "Kritik alarm ve kritik laboratuvar sonucu bildirimleri kişi tarafından kapatılamaz; kimin ne zaman gördüğü kayda geçer.",
            "Telefon bildirimi yatak başı monitör alarmının yerini tutmaz."]]],
          ["Sesle yazdırma", ["Sesle yazdırma bugün **tarayıcının kendi ses tanıma özelliğiyle** çalışır. Bu özellik Homunculus sunucusunda değil tarayıcıda çalışır; kullandığınız tarayıcıya göre ses, metne çevrilmek üzere tarayıcı üreticisinin hizmetine gönderilebilir. Bu, verinin hastane dışına çıkmaması kuralının bugünkü tek istisnasıdır.", [
            "Dikte ederken hasta adı, kimlik ya da protokol numarası söylemeyin; yatak numarası yeterlidir.",
            "Ses kaydı Homunculus'ta saklanmaz; belgeye yalnız ekranda gördüğünüz ve kaydettiğiniz metin girer.",
            "Dikteyi başlatmak denetim kaydına yazılır.",
            "Sesle yazdırmayı kullanmak zorunda değilsiniz; aynı alana klavyeyle yazabilirsiniz."],
            {note:"Hastane içinde çalışan bir ses tanıma hizmeti devreye alındığında bu bölüm güncellenecektir."}]],
          ["Verinin nerede tutulduğu", ["Tüm veriler {H} bünyesindeki sunucularda tutulur ve işlenir.",
            "Sistemin çalışması için veri hastane dışındaki bir hizmete gönderilmez; tek istisna, yukarıda anlatılan tarayıcıdaki sesle yazdırmadır. Yedekleme hastanenin kendi yedekleme politikasına göre yapılır."]],
          ["Güvenlik", [[
            "Tüm bağlantılar şifrelidir.",
            "Oturum açmak için şifreye ek olarak doğrulayıcı uygulamadaki kod istenir (iki adımlı doğrulama).",
            "Hareketsiz kalan ekran kendiliğinden kilitlenir; kilitlenmeden önce uyarı çıkar. Ekranı istediğiniz an Alt+L ile kilitleyebilirsiniz.",
            "Açık oturumlarınızı Ayarlar → Güvenlik bölümünde görür, istemediğinizi kapatabilirsiniz.",
            "Değiştirilemez denetim kaydı: her erişim ve her işlem, kim tarafından ve ne zaman yapıldığıyla birlikte kaydedilir; bu kayıt sonradan değiştirilemez ve silinemez."]]],
          ["Saklama süresi", ["Veriler, hastanenin tabi olduğu mevzuatın ve hastanenin kayıt saklama politikasının öngördüğü süre boyunca saklanır.",
            "Süre dolduğunda veriler aynı politikaya göre silinir, yok edilir ya da anonim hâle getirilir. Denetim kaydı da aynı politikaya tabidir."]],
          ["Haklarınız", ["Hastanenin tabi olduğu kişisel veri koruma mevzuatı kapsamında şu haklara sahipsiniz:", [
            "Verilerinizin işlenip işlenmediğini öğrenme ve işlenmişse bilgi isteme,",
            "Eksik ya da yanlış işlenmiş verilerin düzeltilmesini isteme,",
            "Mevzuatın öngördüğü koşullarda verilerin silinmesini isteme,",
            "İşlemeye itiraz etme."],
            "Başvuru yolu Aydınlatma Metni'nde ayrıntılı anlatılır."]],
          ["İletişim", ["Bu politika ve kişisel verilerinizle ilgili sorularınız için hastanenin bilgi işlem birimine başvurabilirsiniz.", "{C}"]],
        ],
      },
      AZ: {
        lede:"Homunculus-da hansı məlumatın hansı ekranda istifadə olunduğunu, kimin nəyi görə bildiyini və məlumatın necə qorunduğunu izah edir.",
        keys:["Məlumatlar xəstəxananın öz serverlərində saxlanılır; bu gün yeganə istisna brauzerdə işləyən səslə yazdırmadır.",
              "Hər kəs yalnız vəzifəsinin tələb etdiyini görür; biotibbi mühəndis, keyfiyyət, rəhbərlik və İT xəstənin adını görmür.",
              "Hər giriş dəyişdirilə bilməyən audit jurnalına yazılır; kamera görüntüsü qeydə alınmır, telefona gedən bildirişdə xəstə adı olmur."],
        secs:[
          ["Məlumatlara cavabdeh qurum və əhatə", ["Homunculus reanimasiya və intensiv terapiya şöbələrində istifadə olunan klinik qərar dəstəyi sistemidir. Bu sistemdə emal olunan fərdi məlumatlara görə sistemi istifadə edən xəstəxana cavabdehdir: {H}.",
            "Sistem məlumatları xəstəxananın müəyyən etdiyi məqsədlərə və göstərişlərə uyğun olaraq, yalnız xidmətin göstərilməsi üçün lazım olan həcmdə emal edir. Bu siyasət sistemi istifadə edən əməkdaşlar üçündür; xəstələr və onların yaxınları üçün ayrıca məlumatlandırma bildirişi var."]],
          ["Hansı məlumat, hansı ekranda", ["Hər ekran yalnız öz işi üçün lazım olan məlumatı göstərir. Aşağıdakı cədvəl məlumatın harada istifadə olunduğunu və haradan gəldiyini ümumiləşdirir.",
            {tb:["Ekran", "İstifadə olunan məlumat", "Mənbə"], rows:[
              ["Çarpayı paneli", "Çarpayı nömrəsi, xəstənin adı (səlahiyyətli rollarda), həyati göstəricilərin son dəyərləri, erkən xəbərdarlıq şkalası, açıq xəbərdarlıqlar", "Çarpayı başı cihazlar, xəstəxana qeyd sistemi"],
              ["Monitor və divar görünüşü", "Canlı dalğa formaları və rəqəmsal dəyərlər, cihaz siqnalları, bağlantı vəziyyəti", "Çarpayı başı monitor, süni tənəffüs aparatı, infuziya pompası"],
              ["Xəstə ekranı və qulluq planı", "Yatış və diaqnoz məlumatı, dərman və maye qeydləri, laborator nəticələr, qulluq məqsədləri, tapşırıqlar, növbə təhvil qeydləri", "Xəstəxana qeyd sistemi, komandanın daxil etdiyi qeydlər"],
              ["Sənədlər", "Epikriz, konsultasiya və qulluq qeydləri, səslə yazdırılan mətn", "Komandanın daxil etdiyi qeydlər"],
              ["Kamera", "Yalnız canlı görüntü; qeyd aparılmır", "Çarpayı başı kamera (xəstəxana şəbəkəsi)"],
              ["Audit jurnalı", "Kim, nə vaxt, hansı qeydə, hansı əməliyyatı, hansı iş yerindən etdi", "Sistemin özü"],
              ["Hesab və ayarlar", "Ad və soyad, vəzifə, şöbə, rol, bildiriş seçimləri, açıq sessiyalar", "İT şöbəsi, istifadəçinin özü"]]}]],
          ["Kim nəyi görür", ["Giriş rola görə verilir. Hər kəs yalnız öz şöbəsindəki xəstələri və vəzifəsinin tələb etdiyi ekranları görür.",
            {tb:["Rol", "Gördükləri", "Xəstənin adı"], rows:[
              ["Həkim", "Şöbəsindəki çarpayılar, xəstə ekranının bütün bölmələri, şkalalar və təsdiq, səbəb yazmaqla kamera", "+Görür"],
              ["Tibb bacısı", "Şöbəsindəki çarpayılar, tapşırıqlar, qulluq planı, çarpayı başı qeydlər; şkala, dərman və nəticələrə baxır", "+Görür"],
              ["Əczaçı", "Xəstənin xülasəsi, dərman və nəticə bölmələri", "+Görür"],
              ["Biotibbi mühəndis", "Cihaz siyahısı, bağlantı vəziyyəti, texniki xidmət qeydləri", "-Görmür"],
              ["Keyfiyyət", "Keyfiyyət göstəriciləri və audit jurnalı; xəstələr çarpayı nömrəsi ilə, ad gizlədilib", "~Çarpayı nömrəsi ilə gizlədilib"],
              ["Baş həkim / rəhbər", "Şöbə xülasələri, doluluq, keyfiyyət göstəriciləri", "-Görmür"],
              ["İT şöbəsi", "Hesablar, rollar, şöbələr, inteqrasiya və sistem ayarları; klinik məzmun yoxdur", "-Görmür"]]},
            "Bir şəxsə rolundan artıq əlavə səlahiyyət verilə və ya səlahiyyəti məhdudlaşdırıla bilər. Hər dəyişiklik kimin etdiyi ilə birlikdə audit jurnalına yazılır."]],
          ["Kamera görüntüsü", [[
            "Kamera yalnız canlı görüntü verir. **Görüntü qeydə alınmır və saxlanılmır.**",
            "İzləməni açmaq üçün səbəb yazılır; izləmə müddəti məhduddur və müddət bitəndə özü bağlanır.",
            "Çarpayı başındakı komanda məxfilik pərdəsini açdıqda görüntü bağlanır.",
            "Hər açılış kimin hansı çarpayıya nə qədər baxdığı ilə birlikdə audit jurnalına yazılır.",
            "Görüntü xəstəxana şəbəkəsi daxilində qalır."]]],
          ["Bildirişlər", [[
            "Sizə yalnız rolunuza və şöbələrinizə aid bildirişlər gəlir.",
            "Telefona yalnız kritik siqnal gedir və **bildirişdə xəstənin adı olmur**; çarpayı nömrəsi və siqnalın növü göstərilir.",
            "Kritik siqnal və kritik laborator nəticə bildirişlərini şəxs özü söndürə bilməz; kimin nə vaxt gördüyü qeydə alınır.",
            "Telefon bildirişi çarpayı başı monitorun siqnalını əvəz etmir."]]],
          ["Səslə yazdırma", ["Səslə yazdırma bu gün **brauzerin öz nitq tanıma funksiyası** ilə işləyir. Bu funksiya Homunculus serverində deyil, brauzerdə işləyir; istifadə etdiyiniz brauzerdən asılı olaraq səs mətnə çevrilmək üçün brauzer istehsalçısının xidmətinə göndərilə bilər. Bu, məlumatın xəstəxanadan kənara çıxmaması qaydasının bu günkü yeganə istisnasıdır.", [
            "Diktə edərkən xəstənin adını, şəxsiyyət və ya protokol nömrəsini deməyin; çarpayı nömrəsi kifayətdir.",
            "Səs yazısı Homunculus-da saxlanılmır; sənədə yalnız ekranda gördüyünüz və yadda saxladığınız mətn düşür.",
            "Diktənin başlanması audit jurnalına yazılır.",
            "Səslə yazdırmadan istifadə etmək məcburi deyil; eyni sahəyə klaviatura ilə yaza bilərsiniz."],
            {note:"Xəstəxana daxilində işləyən nitq tanıma xidməti istifadəyə veriləndə bu bölmə yenilənəcək."}]],
          ["Məlumatların saxlandığı yer", ["Bütün məlumatlar {H} daxilindəki serverlərdə saxlanılır və emal olunur.",
            "Sistemin işləməsi üçün məlumat xəstəxanadan kənar heç bir xidmətə göndərilmir; yeganə istisna yuxarıda izah olunan brauzerdəki səslə yazdırmadır. Ehtiyat nüsxələr xəstəxananın öz ehtiyat siyasətinə uyğun çıxarılır."]],
          ["Təhlükəsizlik", [[
            "Bütün bağlantılar şifrələnir.",
            "Sistemə girmək üçün şifrədən əlavə təsdiqləmə tətbiqindəki kod tələb olunur (iki mərhələli təsdiqləmə).",
            "Hərəkətsiz qalan ekran özü kilidlənir; kilidlənmədən əvvəl xəbərdarlıq çıxır. Ekranı istənilən an Alt+L ilə kilidləyə bilərsiniz.",
            "Açıq sessiyalarınızı Ayarlar → Təhlükəsizlik bölməsində görür, istəmədiyinizi bağlaya bilərsiniz.",
            "Dəyişdirilə bilməyən audit jurnalı: hər giriş və hər əməliyyat kim tərəfindən və nə vaxt edildiyi ilə birlikdə qeydə alınır; bu qeyd sonradan dəyişdirilə və silinə bilməz."]]],
          ["Saxlama müddəti", ["Məlumatlar xəstəxananın tabe olduğu qanunvericiliyin və xəstəxananın qeydlərin saxlanması siyasətinin nəzərdə tutduğu müddət ərzində saxlanılır.",
            "Müddət bitdikdə məlumatlar həmin siyasətə uyğun olaraq silinir, məhv edilir və ya anonimləşdirilir. Audit jurnalı da eyni siyasətə tabedir."]],
          ["Hüquqlarınız", ["Xəstəxananın tabe olduğu fərdi məlumatların qorunması qanunvericiliyinə əsasən aşağıdakı hüquqlara maliksiniz:", [
            "Məlumatlarınızın emal olunub-olunmadığını öyrənmək və emal olunubsa, məlumat istəmək,",
            "Natamam və ya səhv emal olunmuş məlumatların düzəldilməsini tələb etmək,",
            "Qanunvericiliyin nəzərdə tutduğu hallarda məlumatların silinməsini tələb etmək,",
            "Emala etiraz etmək."],
            "Müraciət qaydası məlumatlandırma bildirişində ətraflı izah olunur."]],
          ["Əlaqə", ["Bu siyasət və fərdi məlumatlarınızla bağlı suallar üçün xəstəxananın İT şöbəsinə müraciət edə bilərsiniz.", "{C}"]],
        ],
      },
      RU: {
        lede:"Какие данные используются на каком экране Homunculus, кто что может видеть и как данные защищены.",
        keys:["Данные хранятся на собственных серверах больницы; сегодня единственное исключение — голосовой ввод, работающий в браузере.",
              "Каждый видит только то, что нужно по должности; биомедицинский инженер, служба качества, руководство и ИТ не видят имени пациента.",
              "Каждый доступ записывается в неизменяемый журнал аудита; видео с камеры не записывается, в уведомлении на телефон нет имени пациента."],
        secs:[
          ["Ответственный за данные и сфера действия", ["Homunculus — система поддержки клинических решений для отделений реанимации и интенсивной терапии. Ответственным за персональные данные, обрабатываемые в системе, является больница, которая её использует: {H}.",
            "Система обрабатывает данные в целях и по указаниям больницы и только в объёме, необходимом для работы сервиса. Эта политика предназначена для сотрудников, работающих в системе; для пациентов и их близких есть отдельное уведомление об обработке данных."]],
          ["Какие данные на каком экране", ["Каждый экран показывает только данные, нужные для его задачи. Таблица ниже показывает, где используются данные и откуда они поступают.",
            {tb:["Экран", "Используемые данные", "Источник"], rows:[
              ["Панель коек", "Номер койки, имя пациента (для уполномоченных ролей), последние значения витальных показателей, шкала раннего предупреждения, открытые предупреждения", "Прикроватные устройства, больничная система учёта"],
              ["Монитор и настенный вид", "Кривые и числовые значения в реальном времени, тревоги устройств, состояние связи", "Прикроватный монитор, аппарат ИВЛ, инфузионный насос"],
              ["Карта пациента и план ухода", "Сведения о госпитализации и диагнозе, записи о лекарствах и жидкостях, результаты анализов, цели ухода, задачи, записи о передаче смены", "Больничная система учёта, записи команды"],
              ["Документы", "Выписной эпикриз, консультации и записи об уходе, текст голосового ввода", "Записи команды"],
              ["Камера", "Только изображение в реальном времени; запись не ведётся", "Прикроватная камера (сеть больницы)"],
              ["Журнал аудита", "Кто, когда, к какой записи, какое действие, с какого рабочего места", "Сама система"],
              ["Учётная запись и настройки", "Фамилия и имя, должность, отделение, роль, настройки уведомлений, открытые сеансы", "ИТ-отдел, сам пользователь"]]}]],
          ["Кто что видит", ["Доступ предоставляется по ролям. Каждый видит только пациентов своего отделения и экраны, нужные по должности.",
            {tb:["Роль", "Что видит", "Имя пациента"], rows:[
              ["Врач", "Койки своего отделения, все вкладки карты пациента, шкалы и их подтверждение, камеру с указанием причины", "+Видит"],
              ["Медсестра", "Койки своего отделения, задачи, план ухода, прикроватные записи; просматривает шкалы, лекарства и результаты", "+Видит"],
              ["Фармацевт", "Сводка пациента, вкладки лекарств и результатов", "+Видит"],
              ["Биомедицинский инженер", "Список устройств, состояние связи, записи о техобслуживании", "-Не видит"],
              ["Служба качества", "Показатели качества и журнал аудита; пациенты по номеру койки, имя скрыто", "~Скрыто, по номеру койки"],
              ["Главный врач / руководитель", "Сводки по отделениям, занятость коек, показатели качества", "-Не видит"],
              ["ИТ-отдел", "Учётные записи, роли, отделения, интеграции и настройки системы; без клинического содержания", "-Не видит"]]},
            "Сотруднику можно выдать дополнительные права сверх роли или ограничить их. Каждое изменение записывается в журнал аудита с указанием, кто его внёс."]],
          ["Изображение с камеры", [[
            "Камера даёт только изображение в реальном времени. **Изображение не записывается и не хранится.**",
            "Чтобы открыть наблюдение, указывается причина; время наблюдения ограничено, по его истечении сеанс закрывается сам.",
            "Когда команда у постели включает шторку приватности, изображение отключается.",
            "Каждое открытие записывается в журнал аудита: кто, какую койку и как долго смотрел.",
            "Изображение не покидает сеть больницы."]]],
          ["Уведомления", [[
            "Вы получаете только уведомления, относящиеся к вашей роли и вашим отделениям.",
            "На телефон уходит только критическая тревога, и **в уведомлении нет имени пациента** — только номер койки и тип тревоги.",
            "Уведомления о критической тревоге и критическом результате анализа нельзя отключить самостоятельно; фиксируется, кто и когда их увидел.",
            "Уведомление на телефоне не заменяет тревогу прикроватного монитора."]]],
          ["Голосовой ввод", ["Голосовой ввод сегодня работает через **встроенное распознавание речи браузера**. Эта функция работает не на сервере Homunculus, а в браузере; в зависимости от браузера звук может передаваться в сервис производителя браузера для преобразования в текст. Это сегодня единственное исключение из правила, что данные не покидают больницу.", [
            "Диктуя, не называйте имя пациента, номер документа или протокола — достаточно номера койки.",
            "Аудиозапись в Homunculus не хранится; в документ попадает только текст, который вы видите на экране и сохраняете.",
            "Начало диктовки записывается в журнал аудита.",
            "Пользоваться голосовым вводом не обязательно — в то же поле можно печатать с клавиатуры."],
            {note:"Когда будет подключён сервис распознавания речи, работающий внутри больницы, этот раздел будет обновлён."}]],
          ["Где хранятся данные", ["Все данные хранятся и обрабатываются на серверах {H}.",
            "Для работы системы данные не передаются во внешние сервисы; единственное исключение — описанный выше голосовой ввод в браузере. Резервное копирование выполняется по собственной политике больницы."]],
          ["Безопасность", [[
            "Все соединения зашифрованы.",
            "Для входа кроме пароля требуется код из приложения-аутентификатора (двухэтапная проверка).",
            "При бездействии экран блокируется автоматически, перед этим появляется предупреждение. Заблокировать экран в любой момент можно сочетанием Alt+L.",
            "Свои открытые сеансы вы видите в разделе Настройки → Безопасность и можете закрыть лишние.",
            "Неизменяемый журнал аудита: каждый доступ и каждое действие записываются с указанием, кто и когда их выполнил; эту запись нельзя изменить или удалить."]]],
          ["Срок хранения", ["Данные хранятся в течение срока, установленного применимым к больнице законодательством и политикой больницы по хранению записей.",
            "По истечении срока данные удаляются, уничтожаются или обезличиваются в соответствии с той же политикой. Журнал аудита подчиняется той же политике."]],
          ["Ваши права", ["В соответствии с законодательством о защите персональных данных, применимым к больнице, вы имеете право:", [
            "узнать, обрабатываются ли ваши данные, и получить сведения об этом;",
            "потребовать исправления неполных или неверных данных;",
            "потребовать удаления данных в случаях, предусмотренных законодательством;",
            "возразить против обработки."],
            "Порядок обращения подробно описан в уведомлении об обработке персональных данных."]],
          ["Контакты", ["С вопросами об этой политике и о ваших персональных данных обращайтесь в ИТ-отдел больницы.", "{C}"]],
        ],
      },
      EN: {
        lede:"Which data Homunculus uses on which screen, who can see what, and how the data is protected.",
        keys:["Data stays on the hospital's own servers; the one exception today is voice dictation, which runs in the browser.",
              "Everyone sees only what their duties require; biomedical, quality, management and IT staff do not see patient names.",
              "Every access is written to a tamper-proof audit log; camera video is not recorded, and phone notifications carry no patient name."],
        secs:[
          ["Data controller and scope", ["Homunculus is a clinical decision support system used in intensive care units. The controller of the personal data processed in this system is the hospital that uses it: {H}.",
            "The system processes data for the purposes and under the instructions set by the hospital, and only to the extent needed to run the service. This policy is for the staff who use the system; patients and their relatives have a separate Personal Data Protection Notice."]],
          ["Which data, on which screen", ["Each screen shows only the data its job needs. The table below summarises where data is used and where it comes from.",
            {tb:["Screen", "Data used", "Source"], rows:[
              ["Bed board", "Bed number, patient name (for authorised roles), latest vital sign values, early warning score, open alerts", "Bedside devices, hospital records system"],
              ["Monitor and wall view", "Live waveforms and numeric values, device alarms, connection status", "Bedside monitor, ventilator, infusion pump"],
              ["Patient screen and care plan", "Admission and diagnosis details, medication and fluid records, laboratory results, care goals, tasks, handover notes", "Hospital records system, entries made by the team"],
              ["Documents", "Discharge summaries, consultation and care notes, dictated text", "Entries made by the team"],
              ["Camera", "Live picture only; nothing is recorded", "Bedside camera (hospital network)"],
              ["Audit log", "Who did what, to which record, when, and from which workstation", "The system itself"],
              ["Account and settings", "Name, title, unit, role, notification preferences, open sessions", "IT department, the user"]]}]],
          ["Who sees what", ["Access is granted by role. Everyone sees only the patients in their own unit and the screens their duties require.",
            {tb:["Role", "What they see", "Patient name"], rows:[
              ["Physician", "Beds in their unit, every tab of the patient screen, scores and sign-off, camera with a stated reason", "+Sees"],
              ["Nurse", "Beds in their unit, tasks, care plan, bedside records; views scores, medication and results", "+Sees"],
              ["Pharmacist", "Patient summary, medication and results tabs", "+Sees"],
              ["Biomedical", "Device list, connection status, maintenance records", "-Does not see"],
              ["Quality", "Quality indicators and audit log; patients by bed number, name masked", "~Masked, bed number only"],
              ["Medical director / manager", "Unit summaries, occupancy, quality indicators", "-Does not see"],
              ["IT", "Accounts, roles, units, integrations and system settings; no clinical content", "-Does not see"]]},
            "A person can be granted extra access beyond their role, or have access restricted. Every change is written to the audit log together with who made it."]],
          ["Camera picture", [[
            "The camera provides a live picture only. **The picture is not recorded or stored.**",
            "Opening a view requires a stated reason; viewing time is limited and the session closes by itself when it runs out.",
            "When the bedside team turns on the privacy curtain, the picture goes off.",
            "Every opening is written to the audit log with who looked at which bed and for how long.",
            "The picture stays inside the hospital network."]]],
          ["Notifications", [[
            "You only receive notifications that concern your role and your units.",
            "Only critical alarms go to your phone, and **the notification carries no patient name** — only the bed number and alarm type.",
            "Critical alarm and critical laboratory result notifications cannot be switched off by the user; who saw them and when is recorded.",
            "A phone notification does not replace the bedside monitor alarm."]]],
          ["Voice dictation", ["Voice dictation currently runs on **the browser's built-in speech recognition**. It runs in the browser, not on the Homunculus server; depending on the browser you use, audio may be sent to the browser maker's service to be turned into text. This is today's only exception to the rule that data does not leave the hospital.", [
            "When dictating, do not say the patient's name, ID or protocol number; the bed number is enough.",
            "No audio is stored in Homunculus; only the text you see on screen and save goes into the document.",
            "Starting dictation is written to the audit log.",
            "You do not have to use dictation; you can type into the same field."],
            {note:"This section will be updated when a speech recognition service running inside the hospital is brought into use."}]],
          ["Where data is kept", ["All data is stored and processed on servers within {H}.",
            "No data is sent to any outside service for the system to work; the only exception is the browser dictation described above. Backups follow the hospital's own backup policy."]],
          ["Security", [[
            "All connections are encrypted.",
            "Signing in requires a code from an authenticator app in addition to your password (two-step verification).",
            "An idle screen locks itself, with a warning beforehand. You can lock the screen at any time with Alt+L.",
            "You can see your open sessions under Settings → Security and close the ones you do not want.",
            "Tamper-proof audit log: every access and every action is recorded with who did it and when; the record cannot be altered or deleted afterwards."]]],
          ["Retention", ["Data is kept for the period required by the legislation that applies to the hospital and by the hospital's records retention policy.",
            "When that period ends, data is deleted, destroyed or anonymised under the same policy. The audit log follows the same policy."]],
          ["Your rights", ["Under the personal data protection legislation that applies to the hospital, you have the right to:", [
            "learn whether your data is processed and, if so, request information about it;",
            "ask for incomplete or incorrect data to be corrected;",
            "ask for data to be deleted where the legislation provides for it;",
            "object to processing."],
            "How to make a request is set out in the Personal Data Protection Notice."]],
          ["Contact", ["For questions about this policy or your personal data, contact the hospital's IT department.", "{C}"]],
        ],
      },
    },

    terms: {
      TR: {
        lede:"Homunculus'u kullanan her hesap için geçerli kurallar: sistemin ne yaptığı, ne yapmadığı ve kararın kimde olduğu.",
        keys:["Homunculus tanı koymaz, doz ya da emir vermez; son karar hastayı değerlendiren hekimindir.",
              "Asıl alarm yatak başı monitördedir; sistem onun yerini tutmaz.",
              "Hesap kişiseldir; paylaşılan istasyondan ayrılırken ekranı Alt+L ile kilitleyin."],
        secs:[
          ["Hizmetin kapsamı", ["Homunculus, {H} yoğun bakım birimlerinde hasta izlemi, erken uyarı, bakım kaydı ve ekip içi iletişim için kullanılan bir klinik karar destek sistemidir.",
            "Sisteme yalnızca hastanenin yetkilendirdiği personel erişebilir. Bu koşullar, sistemi kullanan tüm hesaplar için geçerlidir; sisteme giriş yapmak bu koşulları kabul etmek anlamına gelir."]],
          ["Tıbbi sorumluluk reddi", ["Homunculus bir klinik karar DESTEK sistemidir. Tanı koymaz, tedavi emri vermez, doz önermez.", [
            "Ekrandaki uyarı, skor ve eğilimler hekimin değerlendirmesine sunulan bilgilerdir; tek başına tedavi gerekçesi değildir.",
            "Son karar her zaman hastayı değerlendiren hekime aittir. Sistemin bir uyarıyı göstermesi ya da göstermemesi bu sorumluluğu değiştirmez.",
            "**Bir uyarının görünmemesi, hastanın iyi olduğu anlamına gelmez.** Sistem eksik, gecikmiş ya da kesilmiş veriyle çalışıyor olabilir.",
            "Sistemdeki alarmlar yatak başı monitörün yerini tutmaz. Asıl alarm cihazdadır; cihaz alarmı her zaman önce ve doğrudan yanıtlanır.",
            "Ekrandaki bir değer, hastanın yanında doğrulanmadan klinik karara esas alınmamalıdır.",
            "Sistemin hesapladığı skorlar hekim onaylayana kadar taslaktır; onaylayan hekimin adı ve saati kayda geçer."]], "warn"],
          ["Sistem ne yapar, ne yapmaz", ["Homunculus'un görevi, ekibin gördüğünü tek yerde toplamak ve dikkat gerektireni öne çıkarmaktır. Karar vermek görevi değildir.",
            {duo:[["Yapar", [
              "Yatak başı cihazlardan ve hastane kayıt sisteminden gelen veriyi **toplar**.",
              "Yaşamsal bulguları, sonuçları ve bakım kayıtlarını tek ekranda **gösterir**.",
              "Değerlerden **eğilim çıkarır** ve kötüleşme belirtilerini öne çıkarır.",
              "Sorumlu ekibe **haber verir**: uygulama içinde, tarayıcıda, telefonda yalnız kritik alarm.",
              "Yanıt gelmezse uyarıyı sırayla bir üst sorumluya **iletir**.",
              "**Skor hesaplar ve hekime onaya sunar.**",
              "Kimin neyi ne zaman gördüğünü ve yaptığını kaydeder."]],
              ["Yapmaz", [
              "**Tanı koymaz.**",
              "**Doz ya da tedavi emri vermez.**",
              "Hastayı yerinde değerlendirmenin yerini tutmaz.",
              "**Yatak başı monitör alarmının yerini tutmaz.**",
              "**Aileye ya da hastaya doğrudan bilgi göndermez.**",
              "Hekim onayı olmadan bir skoru kesinleştirmez.",
              "**Veriyi hastane dışına çıkarmaz.** Tek istisna tarayıcıdaki sesle yazdırmadır (Gizlilik Politikası).",
              "**Reklam göstermez;** reklam ya da analiz amaçlı takip yapmaz, bu tür çerez kullanmaz."]]]}]],
          ["Hesap sorumluluğu", [[
            "Hesabınız size özeldir; hesabınızla yapılan işlemlerden siz sorumlusunuz.",
            "Şifrenizi ve doğrulayıcı uygulamanızı kimseyle paylaşmayın; şifrenizi bir yere yazıp bırakmayın. Bilgi işlem sizden şifrenizi istemez.",
            "Başka birinin hesabıyla işlem yapmayın, kendi hesabınızı da başkasına kullandırmayın.",
            "Hesabınızın başkası tarafından kullanıldığından şüphelenirseniz hemen şifrenizi değiştirin ve bilgi işleme bildirin."]]],
          ["Paylaşılan istasyon kuralları", ["Yoğun bakımda aynı bilgisayarı birden çok kişi kullanır. Kayıtların doğru kişiye ait olması bu kurallara bağlıdır.", [
            "İstasyondan ayrılırken ekranı kilitleyin: **Alt+L**. Kilidi yalnız siz, kendi şifrenizle açarsınız; yarım kalan işiniz korunur.",
            "Hareketsiz kalan ekran, sizin seçtiğiniz süre ile hastanenin belirlediği üst sınırdan kısa olanı dolunca kendiliğinden kilitlenir; kilitlenmeden önce geri sayımlı uyarı çıkar.",
            "Başkasının açık bıraktığı oturumda işlem yapmayın; oturumu kapatın ve kendi hesabınızla girin.",
            "Vardiya sonunda oturumu kapatın. Açık oturumlarınızı Ayarlar → Güvenlik bölümünden görüp kapatabilirsiniz.",
            "Duvar monitörü görünümü sürekli açık kalması gereken istasyon ekranıdır ve kendiliğinden kilitlenmez."]]],
          ["Kabul edilebilir kullanım", [[
            "Hasta kayıtlarına yalnızca görevinizin gerektirdiği ölçüde erişin.",
            "Her erişim ve her işlem, kim tarafından ve ne zaman yapıldığıyla birlikte kayıt altına alınır ve denetlenebilir.",
            "Ekran görüntüsü ya da fotoğrafla hasta verisini sistem dışına çıkarmayın.",
            "Kamera izlemesini yalnız klinik gerekçeyle açın; gerekçe kayda geçer.",
            "Görev gereği olmayan erişim, hastanenin disiplin süreçlerine konu olabilir."]]],
          ["Kayıtların doğruluğu", ["Sisteme girdiğiniz her kayıt, kim tarafından ve ne zaman girildiğiyle birlikte saklanır. Onaylanmış bir belge sonradan değiştirilmez; düzeltme ya da ek, ayrı bir not olarak eklenir ve önceki hâli görünür kalır.",
            "Kayıtları olay anında ya da olabildiğince kısa sürede girin. Geriye dönük girişlerde saat ayrıca kayda geçer."]],
          ["Kesinti ve bakım", ["Planlı bakım önceden duyurulur. Plansız bir kesintide hasta bakımı durmaz; Destek sayfasındaki klinik acil durum adımları uygulanır ve durum hemen bilgi işleme bildirilir."]],
          ["Değişiklikler", ["Hastane bu koşulları güncelleyebilir. Güncel sürüm her zaman bu sayfadadır; sayfanın başındaki tarih son güncellemeyi gösterir."]],
          ["İletişim", ["Bu koşullarla ilgili sorularınız için:", "{C}"]],
        ],
      },
      AZ: {
        lede:"Homunculus-dan istifadə edən hər hesab üçün qüvvədə olan qaydalar: sistemin nə etdiyi, nə etmədiyi və qərarın kimdə olduğu.",
        keys:["Homunculus diaqnoz qoymur, doza və ya göstəriş vermir; son qərar xəstəni qiymətləndirən həkimindir.",
              "Əsas siqnal çarpayı başı monitordadır; sistem onu əvəz etmir.",
              "Hesab şəxsidir; ümumi iş yerindən ayrılarkən ekranı Alt+L ilə kilidləyin."],
        secs:[
          ["Xidmətin əhatəsi", ["Homunculus {H} reanimasiya və intensiv terapiya şöbələrində xəstə monitorinqi, erkən xəbərdarlıq, qulluq qeydləri və komanda daxili ünsiyyət üçün istifadə olunan klinik qərar dəstəyi sistemidir.",
            "Sistemə yalnız xəstəxananın səlahiyyət verdiyi əməkdaşlar daxil ola bilər. Bu şərtlər sistemi istifadə edən bütün hesablara şamil edilir; sistemə daxil olmaq bu şərtləri qəbul etmək deməkdir."]],
          ["Tibbi məsuliyyətdən imtina", ["Homunculus klinik qərar DƏSTƏYİ sistemidir. Diaqnoz qoymur, müalicə təyin etmir, doza tövsiyə etmir.", [
            "Ekrandakı xəbərdarlıqlar, şkalalar və meyillər həkimin qiymətləndirməsinə təqdim olunan məlumatlardır; təkbaşına müalicə üçün əsas deyil.",
            "Son qərar həmişə xəstəni qiymətləndirən həkimə məxsusdur. Sistemin xəbərdarlığı göstərməsi və ya göstərməməsi bu məsuliyyəti dəyişmir.",
            "**Xəbərdarlığın görünməməsi xəstənin yaxşı olduğu demək deyil.** Sistem natamam, gecikmiş və ya kəsilmiş məlumatla işləyə bilər.",
            "Sistemdəki siqnallar çarpayı başı monitoru əvəz etmir. Əsas siqnal cihazdadır; cihaz siqnalına həmişə ilk növbədə və birbaşa reaksiya verilir.",
            "Ekrandakı dəyər xəstənin yanında yoxlanılmadan klinik qərar üçün əsas götürülməməlidir.",
            "Sistemin hesabladığı şkalalar həkim təsdiqləyənə qədər qaralamadır; təsdiqləyən həkimin adı və vaxtı qeydə alınır."]], "warn"],
          ["Sistem nə edir, nə etmir", ["Homunculus-un vəzifəsi komandanın gördüyünü bir yerdə toplamaq və diqqət tələb edəni önə çıxarmaqdır. Qərar vermək onun vəzifəsi deyil.",
            {duo:[["Edir", [
              "Çarpayı başı cihazlardan və xəstəxana qeyd sistemindən gələn məlumatı **toplayır**.",
              "Həyati göstəriciləri, nəticələri və qulluq qeydlərini bir ekranda **göstərir**.",
              "Dəyərlərdən **meyil çıxarır** və pisləşmə əlamətlərini önə çıxarır.",
              "Məsul komandaya **xəbər verir**: tətbiq daxilində, brauzerdə, telefona isə yalnız kritik siqnal.",
              "Cavab gəlməsə, xəbərdarlığı növbə ilə bir üst məsul şəxsə **ötürür**.",
              "**Şkala hesablayır və həkimin təsdiqinə təqdim edir.**",
              "Kimin nəyi nə vaxt gördüyünü və etdiyini qeydə alır."]],
              ["Etmir", [
              "**Diaqnoz qoymur.**",
              "**Doza və ya müalicə göstərişi vermir.**",
              "Xəstənin yerində qiymətləndirilməsini əvəz etmir.",
              "**Çarpayı başı monitorun siqnalını əvəz etmir.**",
              "**Ailəyə və ya xəstəyə birbaşa məlumat göndərmir.**",
              "Həkim təsdiqi olmadan şkalanı yekunlaşdırmır.",
              "**Məlumatı xəstəxanadan kənara çıxarmır.** Yeganə istisna brauzerdəki səslə yazdırmadır (Məxfilik siyasəti).",
              "**Reklam göstərmir;** reklam və ya analitika məqsədilə izləmə aparmır, belə kukilərdən istifadə etmir."]]]}]],
          ["Hesaba görə məsuliyyət", [[
            "Hesabınız yalnız sizə məxsusdur; hesabınızla edilən əməliyyatlara görə siz cavabdehsiniz.",
            "Şifrənizi və təsdiqləmə tətbiqinizi heç kimlə paylaşmayın; şifrəni heç yerdə yazılı qoymayın. İT şöbəsi sizdən şifrənizi soruşmur.",
            "Başqasının hesabı ilə əməliyyat aparmayın, öz hesabınızı da başqasına verməyin.",
            "Hesabınızdan başqasının istifadə etdiyindən şübhələnsəniz, dərhal şifrənizi dəyişin və İT şöbəsinə bildirin."]]],
          ["Ümumi iş yeri qaydaları", ["İntensiv terapiyada eyni kompüterdən bir neçə nəfər istifadə edir. Qeydlərin düzgün şəxsə aid olması bu qaydalardan asılıdır.", [
            "İş yerindən ayrılarkən ekranı kilidləyin: **Alt+L**. Kilidi yalnız siz, öz şifrənizlə açırsınız; yarımçıq işiniz qorunur.",
            "Hərəkətsiz qalan ekran sizin seçdiyiniz müddət ilə xəstəxananın müəyyən etdiyi yuxarı həddən qısa olanı bitəndə özü kilidlənir; kilidlənmədən əvvəl geri sayımlı xəbərdarlıq çıxır.",
            "Başqasının açıq qoyduğu sessiyada əməliyyat aparmayın; sessiyanı bağlayın və öz hesabınızla daxil olun.",
            "Növbənin sonunda sessiyanı bağlayın. Açıq sessiyalarınızı Ayarlar → Təhlükəsizlik bölməsində görüb bağlaya bilərsiniz.",
            "Divar monitoru görünüşü daim açıq qalmalı olan iş yeri ekranıdır və özü kilidlənmir."]]],
          ["Məqbul istifadə", [[
            "Xəstə qeydlərinə yalnız vəzifənizin tələb etdiyi həcmdə baxın.",
            "Hər giriş və hər əməliyyat kim tərəfindən və nə vaxt edildiyi ilə birlikdə qeydə alınır və yoxlanıla bilər.",
            "Ekran şəkli və ya foto vasitəsilə xəstə məlumatlarını sistemdən kənara çıxarmayın.",
            "Kamera izləməsini yalnız klinik səbəblə açın; səbəb qeydə alınır.",
            "Vəzifə ilə bağlı olmayan giriş xəstəxananın intizam prosedurlarına səbəb ola bilər."]]],
          ["Qeydlərin düzgünlüyü", ["Sistemə daxil etdiyiniz hər qeyd kim tərəfindən və nə vaxt daxil edildiyi ilə birlikdə saxlanılır. Təsdiqlənmiş sənəd sonradan dəyişdirilmir; düzəliş və ya əlavə ayrıca qeyd kimi əlavə olunur və əvvəlki vəziyyət görünən qalır.",
            "Qeydləri hadisə anında və ya mümkün qədər tez daxil edin. Gecikmiş qeydlərdə vaxt ayrıca qeydə alınır."]],
          ["Fasilə və texniki xidmət", ["Planlı texniki xidmət əvvəlcədən elan olunur. Plansız fasilədə xəstəyə qulluq dayanmır; Dəstək səhifəsindəki klinik təcili hal addımları tətbiq olunur və vəziyyət dərhal İT şöbəsinə bildirilir."]],
          ["Dəyişikliklər", ["Xəstəxana bu şərtləri yeniləyə bilər. Qüvvədə olan versiya həmişə bu səhifədədir; səhifənin yuxarısındakı tarix son yenilənməni göstərir."]],
          ["Əlaqə", ["Bu şərtlərlə bağlı suallar üçün:", "{C}"]],
        ],
      },
      RU: {
        lede:"Правила для каждой учётной записи Homunculus: что система делает, чего не делает и за кем остаётся решение.",
        keys:["Homunculus не ставит диагнозов, не назначает доз и не отдаёт распоряжений; окончательное решение за врачом, оценивающим пациента.",
              "Основная тревога — на прикроватном мониторе; система его не заменяет.",
              "Учётная запись личная; уходя от общего рабочего места, блокируйте экран сочетанием Alt+L."],
        secs:[
          ["Область применения", ["Homunculus — система поддержки клинических решений, которая используется в отделениях реанимации и интенсивной терапии {H} для мониторинга пациентов, раннего предупреждения, документирования ухода и связи внутри команды.",
            "Доступ к системе имеют только сотрудники, уполномоченные больницей. Настоящие условия распространяются на все учётные записи системы; вход в систему означает согласие с ними."]],
          ["Отказ от медицинской ответственности", ["Homunculus — система ПОДДЕРЖКИ клинических решений. Она не ставит диагнозов, не назначает лечение и не предлагает доз.", [
            "Предупреждения, шкалы и тренды на экране — это информация для оценки врачом, а не самостоятельное основание для лечения.",
            "Окончательное решение всегда принимает врач, оценивающий пациента. То, показала система предупреждение или нет, эту ответственность не меняет.",
            "**Отсутствие предупреждения не означает, что пациенту хорошо.** Система может работать с неполными, запоздавшими или прерванными данными.",
            "Тревоги в системе не заменяют прикроватный монитор. Основная тревога — на устройстве; на тревогу устройства всегда реагируют в первую очередь и напрямую.",
            "Значение на экране не должно служить основанием для клинического решения без проверки у постели пациента.",
            "Шкалы, рассчитанные системой, остаются черновиком, пока их не подтвердит врач; имя подтвердившего врача и время фиксируются."]], "warn"],
          ["Что система делает и чего не делает", ["Задача Homunculus — собрать в одном месте то, что видит команда, и выделить то, что требует внимания. Принимать решения — не её задача.",
            {duo:[["Делает", [
              "**Собирает** данные прикроватных устройств и больничной системы учёта.",
              "**Показывает** витальные показатели, результаты и записи об уходе на одном экране.",
              "**Выявляет тренды** и выделяет признаки ухудшения.",
              "**Оповещает** ответственную команду: в приложении, в браузере, на телефон — только критическая тревога.",
              "Если ответа нет, **передаёт** предупреждение по очереди следующему ответственному.",
              "**Рассчитывает шкалы и передаёт их врачу на подтверждение.**",
              "Фиксирует, кто что и когда видел и делал."]],
              ["Не делает", [
              "**Не ставит диагнозов.**",
              "**Не назначает доз и не отдаёт распоряжений о лечении.**",
              "Не заменяет осмотр пациента у постели.",
              "**Не заменяет тревогу прикроватного монитора.**",
              "**Не отправляет сведения напрямую родственникам или пациенту.**",
              "Не утверждает шкалу без подтверждения врача.",
              "**Не выносит данные за пределы больницы.** Единственное исключение — голосовой ввод в браузере (Политика конфиденциальности).",
              "**Не показывает рекламу;** не отслеживает вас в рекламных или аналитических целях и не использует такие cookie."]]]}]],
          ["Ответственность за учётную запись", [[
            "Учётная запись принадлежит только вам; вы отвечаете за действия, выполненные с её помощью.",
            "Никому не сообщайте пароль и не передавайте приложение-аутентификатор; не оставляйте пароль записанным. ИТ-отдел никогда не спрашивает ваш пароль.",
            "Не работайте под чужой учётной записью и не давайте пользоваться своей.",
            "Если вы подозреваете, что вашей учётной записью пользуется кто-то другой, сразу смените пароль и сообщите в ИТ-отдел."]]],
          ["Правила общего рабочего места", ["В отделении интенсивной терапии одним компьютером пользуются несколько человек. От этих правил зависит, будут ли записи принадлежать правильному человеку.", [
            "Уходя от рабочего места, блокируйте экран: **Alt+L**. Разблокировать его можете только вы своим паролем; незавершённая работа сохраняется.",
            "При бездействии экран блокируется сам по истечении меньшего из двух сроков — выбранного вами и максимального, установленного больницей; перед блокировкой появляется предупреждение с обратным отсчётом.",
            "Не работайте в чужом открытом сеансе; завершите его и войдите под своей учётной записью.",
            "В конце смены завершайте сеанс. Открытые сеансы можно увидеть и закрыть в разделе Настройки → Безопасность.",
            "Настенный вид мониторов — экран поста, который должен быть всегда открыт, поэтому он не блокируется автоматически."]]],
          ["Допустимое использование", [[
            "Открывайте записи пациентов только в объёме, необходимом для ваших обязанностей.",
            "Каждый доступ и каждое действие записываются с указанием, кто и когда их выполнил, и могут быть проверены.",
            "Не выносите данные пациентов за пределы системы с помощью снимков экрана или фотографий.",
            "Открывайте наблюдение с камеры только по клинической причине; причина фиксируется.",
            "Доступ, не связанный с обязанностями, может повлечь дисциплинарные меры больницы."]]],
          ["Достоверность записей", ["Каждая внесённая запись хранится с указанием, кто и когда её внёс. Подтверждённый документ впоследствии не изменяется; исправление или дополнение добавляется отдельной записью, а прежняя версия остаётся видимой.",
            "Вносите записи в момент события или как можно скорее. Для записей задним числом время внесения фиксируется отдельно."]],
          ["Перерывы и обслуживание", ["О плановом обслуживании сообщается заранее. При внеплановом сбое уход за пациентами не прекращается: выполняются шаги экстренной ситуации со страницы поддержки, и о сбое сразу сообщается в ИТ-отдел."]],
          ["Изменения", ["Больница может обновлять эти условия. Действующая редакция всегда находится на этой странице; дата вверху страницы показывает последнее обновление."]],
          ["Контакты", ["С вопросами об этих условиях:", "{C}"]],
        ],
      },
      EN: {
        lede:"The rules for every Homunculus account: what the system does, what it does not do, and who makes the decision.",
        keys:["Homunculus does not diagnose, dose or give orders; the final decision rests with the physician assessing the patient.",
              "The primary alarm is on the bedside monitor; the system does not replace it.",
              "Accounts are personal; lock the screen with Alt+L when you leave a shared workstation."],
        secs:[
          ["Scope of service", ["Homunculus is a clinical decision support system used in the intensive care units of {H} for patient monitoring, early warning, care documentation and team communication.",
            "Only staff authorised by the hospital may access the system. These terms apply to every account that uses it; signing in means accepting them."]],
          ["Medical disclaimer", ["Homunculus is a clinical decision SUPPORT system. It does not diagnose, does not order treatment and does not suggest doses.", [
            "Alerts, scores and trends on screen are information for the physician to evaluate; on their own they are not a reason to treat.",
            "The final decision always rests with the physician assessing the patient. Whether the system shows an alert or not does not change that responsibility.",
            "**The absence of an alert does not mean the patient is well.** The system may be working with incomplete, delayed or interrupted data.",
            "Alarms in the system do not replace the bedside monitor. The primary alarm is on the device; a device alarm is always answered first and directly.",
            "A value on screen should not be the basis of a clinical decision until it has been confirmed at the bedside.",
            "Scores the system calculates remain drafts until a physician signs them off; the signing physician's name and the time are recorded."]], "warn"],
          ["What the system does and does not do", ["Homunculus exists to bring what the team sees into one place and to bring forward what needs attention. Making decisions is not its job.",
            {duo:[["It does", [
              "**Collects** data from bedside devices and the hospital records system.",
              "**Shows** vital signs, results and care records on one screen.",
              "**Derives trends** and brings signs of deterioration forward.",
              "**Notifies** the responsible team: in the app, in the browser, and by phone for critical alarms only.",
              "If nobody responds, **passes** the alert up to the next person in line.",
              "**Calculates scores and puts them to the physician for sign-off.**",
              "Records who saw and did what, and when."]],
              ["It does not", [
              "**Diagnose.**",
              "**Give doses or treatment orders.**",
              "Replace assessing the patient at the bedside.",
              "**Replace the bedside monitor alarm.**",
              "**Send information directly to families or patients.**",
              "Finalise a score without a physician's sign-off.",
              "**Take data outside the hospital.** The one exception is voice dictation in the browser (Privacy Policy).",
              "**Show ads,** or track you for advertising or analytics; it sets no such cookies."]]]}]],
          ["Account responsibility", [[
            "Your account is yours alone; you are responsible for actions taken with it.",
            "Never share your password or your authenticator app, and never leave your password written down. IT will never ask for your password.",
            "Do not act under someone else's account, and do not let anyone use yours.",
            "If you suspect someone else is using your account, change your password straight away and tell IT."]]],
          ["Shared workstation rules", ["In intensive care several people use the same computer. Whether records belong to the right person depends on these rules.", [
            "Lock the screen when you leave the workstation: **Alt+L**. Only you can unlock it, with your own password; unfinished work is kept.",
            "An idle screen locks itself when the shorter of your chosen time and the hospital's maximum runs out; a countdown warning appears first.",
            "Do not work in a session someone else left open; sign it out and sign in with your own account.",
            "Sign out at the end of your shift. You can see and close your open sessions under Settings → Security.",
            "The wall monitor view is a station screen that must stay open, so it does not lock itself."]]],
          ["Acceptable use", [[
            "Access patient records only as far as your duties require.",
            "Every access and every action is recorded with who did it and when, and can be audited.",
            "Do not take patient data out of the system by screenshot or photo.",
            "Open camera viewing only for a clinical reason; the reason is recorded.",
            "Access unrelated to your duties may lead to the hospital's disciplinary procedures."]]],
          ["Accuracy of records", ["Every record you enter is kept with who entered it and when. A signed document is not changed afterwards; a correction or addendum is added as a separate note and the earlier version stays visible.",
            "Enter records at the time of the event or as soon as possible. For late entries the time of entry is recorded separately."]],
          ["Outages and maintenance", ["Planned maintenance is announced in advance. During an unplanned outage patient care does not stop: the clinical emergency steps on the Support page are followed and the outage is reported to IT straight away."]],
          ["Changes", ["The hospital may update these terms. The current version is always on this page; the date at the top shows the latest update."]],
          ["Contact", ["For questions about these terms:", "{C}"]],
        ],
      },
    },

    notice: {
      TR: {
        lede:"Homunculus aracılığıyla işlenen kişisel veriler hakkında hastaları, hasta yakınlarını ve sistemi kullanan çalışanları bilgilendirir.",
        keys:["Veri sorumlusu, sistemi kullanan hastanedir; veriler hastanenin kendi sunucularında işlenir.",
              "Sağlık verileri özel nitelikli veridir; yalnız sır saklama yükümlülüğü olan yetkililerce işlenir.",
              "Haklarınızı kullanmak için hastane yönetimine yazılı olarak başvurabilirsiniz."],
        secs:[
          ["Kapsam", ["Bu aydınlatma metni, {H} yoğun bakım birimlerinde kullanılan Homunculus sistemi aracılığıyla işlenen kişisel veriler hakkında bilgi verir. Şu kişileri kapsar:", [
            "Yoğun bakımda yatan hastalar,",
            "Hasta yakınları (yalnız iletişim ve bilgilendirme kayıtları ölçüsünde),",
            "Sistemi kullanan hastane çalışanları."],
            "Veri sorumlusu: {H}."]],
          ["İşlenen veri kategorileri", [{tb:["Kategori", "İçerik"], rows:[
            ["Kimlik", "Ad-soyad, hasta ve protokol numarası, doğum tarihi"],
            ["Sağlık", "Yatış ve tanı bilgisi, yaşamsal bulgular, laboratuvar sonuçları, ilaç, sıvı ve bakım kayıtları, klinik belgeler"],
            ["Cihaz verisi", "Yatak başı monitör, ventilatör ve infüzyon pompası ölçümleri ile cihaz alarmları"],
            ["Görüntü", "Yatak başı kameradan canlı görüntü; kaydedilmez ve saklanmaz"],
            ["Çalışan", "Ad-soyad, unvan, birim, rol, bildirim tercihleri"],
            ["İşlem güvenliği", "Oturum, erişim ve denetim kayıtları, kullanılan istasyon bilgisi"]]},
            "Sağlık verileri özel nitelikli kişisel veridir ve daha sıkı korunur."]],
          ["Veriler nereden gelir", [[
            "Hastanenin kayıt sisteminden (yatış, tanı, ilaç ve laboratuvar bilgileri),",
            "Yatak başı cihazlardan, hastanenin kendi ağı üzerinden,",
            "Sağlık çalışanlarının sisteme girdiği bakım, gözlem ve belge kayıtlarından,",
            "Çalışan hesapları için hastanenin bilgi işlem biriminden."]]],
          ["İşleme amaçları", [[
            "Tıbbi bakım ve tedavinin yürütülmesi, hastanın yakından izlenmesi,",
            "Kötüleşme belirtilerinin erken fark edilmesine yardımcı olunması,",
            "Bakım ve tedavi kayıtlarının eksiksiz tutulması, vardiya teslimi,",
            "Hasta güvenliği ve bakım kalitesinin denetlenmesi,",
            "Sisteme kimin, ne zaman eriştiğinin izlenmesi ve yetkisiz erişimin önlenmesi,",
            "Hastanenin yasal yükümlülüklerinin yerine getirilmesi."],
            "Veriler reklam, pazarlama ya da bu amaçlarla ilgisi olmayan bir amaçla kullanılmaz."]],
          ["Hukuki dayanak", ["Kişisel veriler, hastanenin tabi olduğu kişisel veri koruma mevzuatı ve sağlık hizmetlerine ilişkin mevzuat çerçevesinde işlenir. Başlıca işleme nedenleri:", [
            "Tıbbi bakım ve tedavi hizmetlerinin yürütülmesi,",
            "Sağlık hizmetlerinin planlanması ve yönetimi,",
            "Hastanenin yasal yükümlülüklerinin yerine getirilmesi,",
            "Hasta güvenliğinin sağlanması."],
            "Sağlık verileri yalnızca sır saklama yükümlülüğü altındaki yetkili kişilerce işlenir."]],
          ["Aktarım", ["Veriler hastanenin kendi sunucularında işlenir ve hastane dışına aktarılmaz.",
            "Yalnızca mevzuatın açıkça gerektirdiği hâllerde, yetkili kamu kurumlarına ve mevzuatın izin verdiği ölçüde aktarım yapılabilir. Homunculus aileye ya da hastaya doğrudan bilgi göndermez; bilgilendirme hastanın hekimi tarafından yapılır."]],
          ["Saklama süresi", ["Veriler, hastanenin tabi olduğu mevzuatın ve hastanenin kayıt saklama politikasının öngördüğü süre boyunca saklanır. Süre dolduğunda silinir, yok edilir ya da anonim hâle getirilir.",
            "Kamera görüntüsü hiç saklanmaz; yalnız izlemenin kim tarafından, ne zaman ve hangi gerekçeyle açıldığı denetim kaydına yazılır."]],
          ["Haklarınız", ["Hastanenin tabi olduğu kişisel veri koruma mevzuatının tanıdığı ölçüde:", [
            "Verilerinizin işlenip işlenmediğini öğrenme ve işlenmişse bilgi isteme,",
            "İşlenme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme,",
            "Aktarıldığı alıcıları öğrenme,",
            "Eksik ya da yanlış işlenmiş verilerin düzeltilmesini isteme,",
            "Mevzuatın öngördüğü koşullarda silinmesini ya da yok edilmesini isteme,",
            "İşlemeye itiraz etme ve mevzuata aykırı işleme nedeniyle zarara uğradıysanız bunun giderilmesini talep etme."]]],
          ["Başvuru yolu", [{ol:[
            "Başvurunuzu yazılı olarak hastane yönetimine iletin.",
            "Başvuruda kimliğinizi, hangi veriyle ilgili olduğunu ve talebinizi açıkça belirtin. Hasta yakınıysanız yetkinizi gösteren belgeyi ekleyin.",
            "Başvurunuz mevzuatın öngördüğü süre içinde yanıtlanır.",
            "Hastane çalışanıysanız hesap ve erişim kayıtlarınızla ilgili taleplerinizi bilgi işlem birimine iletebilirsiniz."]}, "{C}"]],
        ],
      },
      AZ: {
        lede:"Homunculus vasitəsilə emal olunan fərdi məlumatlar barədə xəstələri, onların yaxınlarını və sistemi istifadə edən əməkdaşları məlumatlandırır.",
        keys:["Məlumatlara cavabdeh qurum sistemi istifadə edən xəstəxanadır; məlumatlar xəstəxananın öz serverlərində emal olunur.",
              "Sağlamlıq məlumatları xüsusi kateqoriyalı məlumatlardır; yalnız sirri saxlamaq öhdəliyi olan səlahiyyətli şəxslər tərəfindən emal olunur.",
              "Hüquqlarınızdan istifadə etmək üçün xəstəxana rəhbərliyinə yazılı müraciət edə bilərsiniz."],
        secs:[
          ["Əhatə dairəsi", ["Bu bildiriş {H} reanimasiya və intensiv terapiya şöbələrində istifadə olunan Homunculus sistemi vasitəsilə emal olunan fərdi məlumatlar barədə məlumat verir. Aşağıdakı şəxsləri əhatə edir:", [
            "İntensiv terapiyada yatan xəstələr,",
            "Xəstələrin yaxınları (yalnız əlaqə və məlumatlandırma qeydləri həcmində),",
            "Sistemi istifadə edən xəstəxana əməkdaşları."],
            "Məlumatlara cavabdeh qurum: {H}."]],
          ["Emal olunan məlumat kateqoriyaları", [{tb:["Kateqoriya", "Məzmun"], rows:[
            ["Şəxsiyyət", "Ad və soyad, xəstə və protokol nömrəsi, doğum tarixi"],
            ["Sağlamlıq", "Yatış və diaqnoz məlumatı, həyati göstəricilər, laborator nəticələr, dərman, maye və qulluq qeydləri, klinik sənədlər"],
            ["Cihaz məlumatı", "Çarpayı başı monitor, süni tənəffüs aparatı və infuziya pompası ölçmələri, cihaz siqnalları"],
            ["Görüntü", "Çarpayı başı kameradan canlı görüntü; qeydə alınmır və saxlanılmır"],
            ["Əməkdaş", "Ad və soyad, vəzifə, şöbə, rol, bildiriş seçimləri"],
            ["Əməliyyat təhlükəsizliyi", "Sessiya, giriş və audit qeydləri, istifadə olunan iş yeri məlumatı"]]},
            "Sağlamlıq məlumatları xüsusi kateqoriyalı fərdi məlumatlardır və daha ciddi qorunur."]],
          ["Məlumatlar haradan gəlir", [[
            "Xəstəxananın qeyd sistemindən (yatış, diaqnoz, dərman və laborator məlumatları),",
            "Çarpayı başı cihazlardan, xəstəxananın öz şəbəkəsi vasitəsilə,",
            "Tibb işçilərinin sistemə daxil etdiyi qulluq, müşahidə və sənəd qeydlərindən,",
            "Əməkdaş hesabları üçün xəstəxananın İT şöbəsindən."]]],
          ["Emal məqsədləri", [[
            "Tibbi qulluq və müalicənin aparılması, xəstənin yaxından izlənməsi,",
            "Pisləşmə əlamətlərinin erkən görülməsinə kömək edilməsi,",
            "Qulluq və müalicə qeydlərinin tam aparılması, növbə təhvili,",
            "Xəstə təhlükəsizliyinin və qulluq keyfiyyətinin yoxlanılması,",
            "Sistemə kimin nə vaxt daxil olduğunun izlənməsi və icazəsiz girişin qarşısının alınması,",
            "Xəstəxananın qanuni öhdəliklərinin yerinə yetirilməsi."],
            "Məlumatlar reklam, marketinq və ya bu məqsədlərlə əlaqəsi olmayan başqa məqsəd üçün istifadə olunmur."]],
          ["Hüquqi əsas", ["Fərdi məlumatlar xəstəxananın tabe olduğu fərdi məlumatların qorunması qanunvericiliyi və səhiyyə xidmətlərinə aid qanunvericilik çərçivəsində emal olunur. Əsas emal səbəbləri:", [
            "Tibbi qulluq və müalicə xidmətlərinin göstərilməsi,",
            "Səhiyyə xidmətlərinin planlaşdırılması və idarə olunması,",
            "Xəstəxananın qanuni öhdəliklərinin yerinə yetirilməsi,",
            "Xəstə təhlükəsizliyinin təmin edilməsi."],
            "Sağlamlıq məlumatları yalnız sirri saxlamaq öhdəliyi daşıyan səlahiyyətli şəxslər tərəfindən emal olunur."]],
          ["Ötürülmə", ["Məlumatlar xəstəxananın öz serverlərində emal olunur və xəstəxanadan kənara ötürülmür.",
            "Yalnız qanunvericiliyin açıq şəkildə tələb etdiyi hallarda, səlahiyyətli dövlət orqanlarına və qanunvericiliyin icazə verdiyi həcmdə ötürülə bilər. Homunculus ailəyə və ya xəstəyə birbaşa məlumat göndərmir; məlumatlandırmanı xəstənin həkimi aparır."]],
          ["Saxlama müddəti", ["Məlumatlar xəstəxananın tabe olduğu qanunvericiliyin və xəstəxananın qeydlərin saxlanması siyasətinin nəzərdə tutduğu müddət ərzində saxlanılır. Müddət bitdikdə silinir, məhv edilir və ya anonimləşdirilir.",
            "Kamera görüntüsü ümumiyyətlə saxlanılmır; yalnız izləmənin kim tərəfindən, nə vaxt və hansı səbəblə açıldığı audit jurnalına yazılır."]],
          ["Hüquqlarınız", ["Xəstəxananın tabe olduğu fərdi məlumatların qorunması qanunvericiliyinin tanıdığı həcmdə:", [
            "Məlumatlarınızın emal olunub-olunmadığını öyrənmək və emal olunubsa, məlumat istəmək,",
            "Emal məqsədini və məqsədə uyğun istifadə olunub-olunmadığını öyrənmək,",
            "Məlumatların ötürüldüyü alıcıları öyrənmək,",
            "Natamam və ya səhv emal olunmuş məlumatların düzəldilməsini tələb etmək,",
            "Qanunvericiliyin nəzərdə tutduğu hallarda silinməsini və ya məhv edilməsini tələb etmək,",
            "Emala etiraz etmək və qanunvericiliyə zidd emal nəticəsində zərər çəkmisinizsə, onun ödənilməsini tələb etmək."]]],
          ["Müraciət qaydası", [{ol:[
            "Müraciətinizi yazılı şəkildə xəstəxana rəhbərliyinə göndərin.",
            "Müraciətdə şəxsiyyətinizi, hansı məlumatla bağlı olduğunu və tələbinizi aydın göstərin. Xəstənin yaxınısınızsa, səlahiyyətinizi təsdiq edən sənədi əlavə edin.",
            "Müraciətinizə qanunvericiliyin nəzərdə tutduğu müddətdə cavab verilir.",
            "Xəstəxana əməkdaşısınızsa, hesab və giriş qeydlərinizlə bağlı sorğularınızı İT şöbəsinə göndərə bilərsiniz."]}, "{C}"]],
        ],
      },
      RU: {
        lede:"Информирует пациентов, их близких и сотрудников о персональных данных, обрабатываемых с помощью Homunculus.",
        keys:["Ответственный за данные — больница, использующая систему; данные обрабатываются на собственных серверах больницы.",
              "Данные о здоровье относятся к особой категории; их обрабатывают только уполномоченные лица, обязанные хранить врачебную тайну.",
              "Чтобы воспользоваться своими правами, направьте письменное обращение в администрацию больницы."],
        secs:[
          ["Сфера действия", ["Настоящее уведомление рассказывает о персональных данных, обрабатываемых с помощью системы Homunculus в отделениях реанимации и интенсивной терапии {H}. Оно касается:", [
            "пациентов отделения интенсивной терапии;",
            "близких пациентов (только в объёме записей о связи и информировании);",
            "сотрудников больницы, работающих в системе."],
            "Ответственный за данные: {H}."]],
          ["Категории обрабатываемых данных", [{tb:["Категория", "Состав"], rows:[
            ["Идентификационные", "Фамилия и имя, номер пациента и протокола, дата рождения"],
            ["О здоровье", "Сведения о госпитализации и диагнозе, витальные показатели, результаты анализов, записи о лекарствах, жидкостях и уходе, клинические документы"],
            ["Данные устройств", "Показания прикроватного монитора, аппарата ИВЛ и инфузионного насоса, тревоги устройств"],
            ["Изображение", "Изображение с прикроватной камеры в реальном времени; не записывается и не хранится"],
            ["О сотрудниках", "Фамилия и имя, должность, отделение, роль, настройки уведомлений"],
            ["Безопасность операций", "Записи о сеансах, доступе и аудите, сведения о рабочем месте"]]},
            "Данные о здоровье относятся к особой категории персональных данных и защищаются строже."]],
          ["Откуда поступают данные", [[
            "из больничной системы учёта (госпитализация, диагноз, лекарства, анализы);",
            "от прикроватных устройств — по собственной сети больницы;",
            "из записей об уходе, наблюдениях и документов, которые вносят медицинские работники;",
            "для учётных записей сотрудников — от ИТ-отдела больницы."]]],
          ["Цели обработки", [[
            "оказание медицинской помощи и лечения, тщательное наблюдение за пациентом;",
            "помощь в раннем выявлении признаков ухудшения;",
            "полное ведение записей об уходе и лечении, передача смены;",
            "контроль безопасности пациентов и качества ухода;",
            "контроль того, кто и когда обращался к системе, и предотвращение несанкционированного доступа;",
            "выполнение правовых обязанностей больницы."],
            "Данные не используются для рекламы, маркетинга или иных целей, не связанных с перечисленными."]],
          ["Правовые основания", ["Персональные данные обрабатываются в рамках законодательства о защите персональных данных и законодательства о здравоохранении, применимых к больнице. Основные цели обработки:", [
            "оказание медицинской помощи и лечения;",
            "планирование и управление медицинскими услугами;",
            "выполнение правовых обязанностей больницы;",
            "обеспечение безопасности пациентов."],
            "Данные о здоровье обрабатывают только уполномоченные лица, связанные обязанностью сохранять врачебную тайну."]],
          ["Передача", ["Данные обрабатываются на собственных серверах больницы и не передаются за её пределы.",
            "Передача возможна только в случаях, прямо предусмотренных законодательством, — уполномоченным государственным органам и в допустимом законом объёме. Homunculus не отправляет сведения напрямую родственникам или пациенту; информирование проводит лечащий врач."]],
          ["Срок хранения", ["Данные хранятся в течение срока, установленного применимым к больнице законодательством и политикой больницы по хранению записей. По его истечении они удаляются, уничтожаются или обезличиваются.",
            "Изображение с камеры не хранится вовсе; в журнал аудита записывается только, кто, когда и по какой причине открыл наблюдение."]],
          ["Ваши права", ["В объёме, предусмотренном законодательством о защите персональных данных, применимым к больнице, вы вправе:", [
            "узнать, обрабатываются ли ваши данные, и получить сведения об этом;",
            "узнать цель обработки и используются ли данные в соответствии с ней;",
            "узнать, кому передавались данные;",
            "потребовать исправления неполных или неверных данных;",
            "потребовать удаления или уничтожения данных в случаях, предусмотренных законодательством;",
            "возразить против обработки и потребовать возмещения ущерба, если он причинён незаконной обработкой."]]],
          ["Порядок обращения", [{ol:[
            "Направьте письменное обращение в администрацию больницы.",
            "Укажите, кто вы, каких данных касается обращение и в чём состоит ваше требование. Если вы родственник пациента, приложите документ, подтверждающий ваши полномочия.",
            "Ответ даётся в срок, установленный законодательством.",
            "Если вы сотрудник больницы, запросы о вашей учётной записи и записях доступа можно направить в ИТ-отдел."]}, "{C}"]],
        ],
      },
      EN: {
        lede:"Informs patients, their relatives and staff about the personal data processed through Homunculus.",
        keys:["The data controller is the hospital that uses the system; data is processed on the hospital's own servers.",
              "Health data is special-category data; it is processed only by authorised people bound by confidentiality.",
              "To exercise your rights, write to the hospital management."],
        secs:[
          ["Scope", ["This notice explains the personal data processed through the Homunculus system in the intensive care units of {H}. It covers:", [
            "patients in intensive care;",
            "patients' relatives (only as far as contact and information records go);",
            "hospital staff who use the system."],
            "Data controller: {H}."]],
          ["Categories of data", [{tb:["Category", "What it includes"], rows:[
            ["Identity", "Name, patient and protocol number, date of birth"],
            ["Health", "Admission and diagnosis details, vital signs, laboratory results, medication, fluid and care records, clinical documents"],
            ["Device data", "Bedside monitor, ventilator and infusion pump readings, and device alarms"],
            ["Image", "Live picture from the bedside camera; not recorded or stored"],
            ["Staff", "Name, title, unit, role, notification preferences"],
            ["Operational security", "Session, access and audit records, workstation details"]]},
            "Health data is special-category personal data and receives stricter protection."]],
          ["Where the data comes from", [[
            "the hospital records system (admission, diagnosis, medication and laboratory details);",
            "bedside devices, over the hospital's own network;",
            "care, observation and document entries made by healthcare staff;",
            "for staff accounts, the hospital's IT department."]]],
          ["Purposes of processing", [[
            "providing medical care and treatment, and close monitoring of the patient;",
            "helping staff notice signs of deterioration early;",
            "keeping care and treatment records complete, and shift handover;",
            "reviewing patient safety and quality of care;",
            "tracking who accessed the system and when, and preventing unauthorised access;",
            "meeting the hospital's legal obligations."],
            "Data is never used for advertising, marketing or any purpose unrelated to these."]],
          ["Legal basis", ["Personal data is processed under the personal data protection legislation and the healthcare legislation that apply to the hospital. The main grounds are:", [
            "providing medical care and treatment;",
            "planning and managing healthcare services;",
            "meeting the hospital's legal obligations;",
            "ensuring patient safety."],
            "Health data is processed only by authorised persons bound by a duty of confidentiality."]],
          ["Transfers", ["Data is processed on the hospital's own servers and is not transferred outside it.",
            "Transfers may take place only where the legislation expressly requires it, to competent public authorities and within the limits the law allows. Homunculus does not send information directly to families or patients; that is done by the patient's physician."]],
          ["Retention", ["Data is kept for the period required by the legislation that applies to the hospital and by the hospital's records retention policy. When it ends, data is deleted, destroyed or anonymised.",
            "Camera pictures are not kept at all; only who opened a view, when and for what reason is written to the audit log."]],
          ["Your rights", ["To the extent recognised by the personal data protection legislation that applies to the hospital, you may:", [
            "learn whether your data is processed and, if so, request information about it;",
            "learn the purpose of processing and whether data is used in line with it;",
            "learn who the data has been transferred to;",
            "ask for incomplete or incorrect data to be corrected;",
            "ask for data to be deleted or destroyed where the legislation provides for it;",
            "object to processing, and seek redress if you have suffered harm from unlawful processing."]]],
          ["How to make a request", [{ol:[
            "Send your request in writing to the hospital management.",
            "State who you are, which data it concerns and what you are asking for. If you are a patient's relative, attach a document showing your authority.",
            "Your request will be answered within the period set by the legislation.",
            "If you are hospital staff, you can send requests about your account and access records to the IT department."]}, "{C}"]],
        ],
      },
    },

    support: {
      TR: {
        lede:"Giriş sorunları, sık sorulan sorular, arıza bildirimi ve sistem çalışmadığında ne yapılacağı.",
        keys:["Sistem çalışmıyorsa bakım durmaz: hasta yatak başı monitörden izlenir, kayıtlar yedek prosedürle tutulur.",
              "Tüm destek, hesap ve yetki talepleri hastanenin bilgi işlem birimine gider.",
              "Arıza bildirirken hasta adı yazmayın; yatak numarası yeterlidir."],
        secs:[
          ["Klinik acil durum", ["Sistem çalışmıyorsa hasta bakımı durmaz.", [
            "Hastayı yatak başı monitörden izlemeye devam edin; asıl alarm cihazdadır.",
            "Kayıtlar için hastanenin kâğıt ya da hastane kayıt sistemi üzerinden yürüyen yedek prosedürünü uygulayın.",
            "Sistem geri geldiğinde aradaki kayıtlar yedek prosedüre göre tamamlanır.",
            "Durumu hemen bilgi işleme bildirin."], "{C}"], "warn"],
          ["Sık sorulan sorular", [{faq:[
            ["Şifremi unuttum", ["Giriş ekranında **Şifremi unuttum** bağlantısına tıklayın ve kullanıcı adınızı ya da kurumsal e-postanızı yazın. Kayıtlı telefonunuza ve e-postanıza bir kod gelir; kod 10 dakika geçerlidir. Kodu girip yeni şifrenizi belirleyin.",
              "Kod gelmiyorsa ya da kayıtlı telefonunuz değiştiyse bilgi işleme başvurun. Kimliğiniz doğrulandıktan sonra geçici şifre verilir ve ilk girişte değiştirmeniz istenir. Bilgi işlem sizden şifrenizi istemez."]],
            ["İki adımlı doğrulama kodu gelmiyor", ["Bu kod size gönderilmez; telefonunuzdaki **doğrulayıcı uygulamada** üretilir ve kısa aralıklarla yenilenir. Ekrandaki güncel 6 haneli kodu girin.", [
              "Kod kabul edilmiyorsa telefonunuzun saatinin otomatik ayarlı olduğunu kontrol edin.",
              "Telefonunuzu değiştirdiyseniz ya da uygulamayı sildiyseniz, doğrulamanın yeniden kurulması için bilgi işleme başvurun."]]],
            ["Hesabım kilitlendi", ["Art arda 5 hatalı şifre denemesinden sonra hesap 15 dakika kilitlenir. Süre dolunca yeniden deneyebilirsiniz.",
              "Beklemeden girmeniz gerekiyorsa bilgi işlem, kimliğinizi doğruladıktan sonra kilidi hemen açabilir. Hatalı denemeleri siz yapmadıysanız bunu ayrıca bildirin."]],
            ["Ekranım kilitlendi", ["Bu bir güvenlik önlemidir: ekran hareketsiz kalınca ya da Alt+L ile kilitlenir. Kendi şifrenizle açın; oturumunuz ve yarım kalan işiniz korunur.",
              "Kilitli ekran başka birine aitse açmaya çalışmayın; o oturumu kapatıp kendi hesabınızla girin. Kilitlenme süresini Ayarlar → Güvenlik bölümünden, hastanenin üst sınırı içinde değiştirebilirsiniz."]],
            ["Alarm sesi gelmiyor", ["Önce: **asıl alarm yatak başı monitördedir.** Homunculus'taki ses ek bir uyarıdır.", [
              "Monitör ekranında ses her açılışta kapalı başlar; hoparlör düğmesiyle açın.",
              "Tarayıcılar sayfaya ilk tıklamadan önce ses çalmaz; ekranda bir yere tıklayın.",
              "Ses 2 dakikalığına susturulmuş olabilir; süre dolunca kendiliğinden açılır.",
              "Bilgisayarın ses düzeyini ve hoparlör bağlantısını kontrol edin.",
              "Hâlâ ses yoksa bilgi işleme bildirin."]]],
            ["Telefona bildirim gelmiyor", [[
              "Telefona yalnız **kritik alarm** gider; diğer bildirimler uygulama içinde ve tarayıcıda görünür.",
              "Uygulama kapalıyken telefona bildirim bugün ulaşmaz.",
              "Bildirim ayarlarınızı Ayarlar → Bildirimler bölümünden kontrol edin; telefonunuzda tarayıcı bildirim izninin açık olduğundan emin olun.",
              "Bildirimde hasta adı olmaz; yatak numarası ve alarm türü yazar.",
              "Telefon bildirimi yatak başı alarmın yerini tutmaz."]]],
            ["Sistem yavaş ya da açılmıyor", [[
              "Sayfayı yenileyin; olmazsa başka bir istasyonda deneyin.",
              "İstasyonun ağ bağlantısını kontrol edin.",
              "Bir yatağın cihaz verisi gelmiyorsa ekranda bağlantı durumu görünür; yatak başı monitörden izlemeye devam edin.",
              "Hasta bakımını etkiliyorsa yukarıdaki klinik acil durum adımlarını uygulayın ve hemen bilgi işleme bildirin."]]],
            ["Yetki istiyorum", ["Bir sayfaya erişiminiz yoksa ekranda bunu söyleyen bir uyarı çıkar ve deneme kayda geçer. Yetki için bölüm sorumlunuza başvurun; bölüm sorumlusunun onayıyla bilgi işlem yetkiyi tanımlar.",
              "Rolünüzün ötesinde verilen her ek yetki, kimin verdiğiyle birlikte denetim kaydına yazılır."]],
          ]}]],
          ["Arıza bildirme", ["Doğru ve hızlı çözüm için arızayı şu adımlarla bildirin:", {ol:[
            "Önce hasta güvenliğini sağlayın; gerekiyorsa klinik acil durum adımlarını uygulayın.",
            "Hangi ekranda olduğunuzu, saati ve hangi istasyonu kullandığınızı not edin.",
            "Ne yaptığınızı, ne beklediğinizi ve ne olduğunu kısaca yazın.",
            "Ekranda bir hata mesajı varsa aynen yazın.",
            "Hasta adı yazmayın; yatak numarası yeterlidir. Hasta verisi içeren ekran görüntüsü göndermeyin.",
            "Bildirimi hastanenin bilgi işlem birimine iletin."]}]],
          ["Hesap ve yetki talepleri", ["Yeni hesap, rol değişikliği, birim ekleme ya da ayrılan personelin hesabının kapatılması için bölüm sorumlunuza ya da bilgi işlem birimine başvurun. Yetki talepleri bölüm sorumlusunun onayıyla işleme alınır.",
            "Ayrılan ya da görev yeri değişen personelin hesabı gecikmeden kapatılmalı ya da güncellenmelidir; bunu bölüm sorumlusu bildirir."]],
          ["Öncelik ve yanıt", [[
            "**Önce:** hasta bakımını etkileyen sorunlar — sistemin açılmaması, cihaz verisinin gelmemesi, uyarıların görünmemesi. Bunları beklemeden, doğrudan bildirin.",
            "**Sonra:** giriş sorunları ve kilitlenen hesaplar.",
            "**Sırayla:** hesap ve yetki talepleri, diğer bildirimler. Bildiriminizin durumunu bilgi işlemden öğrenebilirsiniz."]]],
          ["İletişim", ["Tüm destek talepleri için tek adres:", "{C}"]],
        ],
      },
      AZ: {
        lede:"Giriş problemləri, tez-tez verilən suallar, nasazlığın bildirilməsi və sistem işləmədikdə nə edilməli.",
        keys:["Sistem işləmirsə, qulluq dayanmır: xəstə çarpayı başı monitordan izlənir, qeydlər ehtiyat prosedurla aparılır.",
              "Bütün dəstək, hesab və səlahiyyət sorğuları xəstəxananın İT şöbəsinə gedir.",
              "Nasazlığı bildirərkən xəstənin adını yazmayın; çarpayı nömrəsi kifayətdir."],
        secs:[
          ["Klinik təcili hal", ["Sistem işləmirsə, xəstəyə qulluq dayanmır.", [
            "Xəstəni çarpayı başı monitordan izləməyə davam edin; əsas siqnal cihazdadır.",
            "Qeydlər üçün xəstəxananın kağız və ya xəstəxana qeyd sistemi üzərindən aparılan ehtiyat prosedurunu tətbiq edin.",
            "Sistem bərpa olunduqda aradakı qeydlər ehtiyat prosedura uyğun tamamlanır.",
            "Vəziyyəti dərhal İT şöbəsinə bildirin."], "{C}"], "warn"],
          ["Tez-tez verilən suallar", [{faq:[
            ["Şifrəmi unutmuşam", ["Giriş ekranında **Şifrəni unutmusunuz** keçidinə basın və istifadəçi adınızı və ya korporativ e-poçtunuzu yazın. Qeydiyyatdakı telefonunuza və e-poçtunuza kod gəlir; kod 10 dəqiqə etibarlıdır. Kodu daxil edib yeni şifrə təyin edin.",
              "Kod gəlmirsə və ya qeydiyyatdakı telefonunuz dəyişibsə, İT şöbəsinə müraciət edin. Şəxsiyyətiniz təsdiqləndikdən sonra müvəqqəti şifrə verilir və ilk girişdə onu dəyişməyiniz tələb olunur. İT şöbəsi sizdən şifrənizi soruşmur."]],
            ["İki mərhələli təsdiqləmə kodu gəlmir", ["Bu kod sizə göndərilmir; telefonunuzdakı **təsdiqləmə tətbiqində** yaranır və qısa fasilələrlə yenilənir. Ekrandakı cari 6 rəqəmli kodu daxil edin.", [
              "Kod qəbul olunmursa, telefonunuzun saatının avtomatik tənzimləndiyini yoxlayın.",
              "Telefonunuzu dəyişmisinizsə və ya tətbiqi silmisinizsə, təsdiqləmənin yenidən qurulması üçün İT şöbəsinə müraciət edin."]]],
            ["Hesabım kilidləndi", ["Ardıcıl 5 səhv şifrə cəhdindən sonra hesab 15 dəqiqəlik kilidlənir. Müddət bitdikdə yenidən cəhd edə bilərsiniz.",
              "Gözləmədən daxil olmalısınızsa, İT şöbəsi şəxsiyyətinizi təsdiqlədikdən sonra kilidi dərhal aça bilər. Səhv cəhdləri siz etməmisinizsə, bunu ayrıca bildirin."]],
            ["Ekranım kilidləndi", ["Bu təhlükəsizlik tədbiridir: ekran hərəkətsiz qaldıqda və ya Alt+L ilə kilidlənir. Öz şifrənizlə açın; sessiyanız və yarımçıq işiniz qorunur.",
              "Kilidli ekran başqasına aiddirsə, onu açmağa çalışmayın; həmin sessiyanı bağlayıb öz hesabınızla daxil olun. Kilidlənmə müddətini Ayarlar → Təhlükəsizlik bölməsində, xəstəxananın yuxarı həddi daxilində dəyişə bilərsiniz."]],
            ["Siqnal səsi gəlmir", ["Əvvəlcə: **əsas siqnal çarpayı başı monitordadır.** Homunculus-dakı səs əlavə xəbərdarlıqdır.", [
              "Monitor ekranında səs hər açılışda söndürülmüş başlayır; dinamik düyməsi ilə açın.",
              "Brauzerlər səhifəyə ilk kliklənənə qədər səs çalmır; ekranın istənilən yerinə basın.",
              "Səs 2 dəqiqəlik susdurulmuş ola bilər; müddət bitəndə özü açılır.",
              "Kompüterin səs səviyyəsini və dinamik bağlantısını yoxlayın.",
              "Səs yenə yoxdursa, İT şöbəsinə bildirin."]]],
            ["Telefona bildiriş gəlmir", [[
              "Telefona yalnız **kritik siqnal** gedir; digər bildirişlər tətbiq daxilində və brauzerdə görünür.",
              "Tətbiq bağlı olduqda telefona bildiriş bu gün çatmır.",
              "Bildiriş ayarlarınızı Ayarlar → Bildirişlər bölməsində yoxlayın; telefonunuzda brauzer bildirişlərinə icazənin açıq olduğundan əmin olun.",
              "Bildirişdə xəstənin adı olmur; çarpayı nömrəsi və siqnalın növü yazılır.",
              "Telefon bildirişi çarpayı başı siqnalı əvəz etmir."]]],
            ["Sistem yavaşdır və ya açılmır", [[
              "Səhifəni yeniləyin; alınmasa, başqa iş yerində cəhd edin.",
              "İş yerinin şəbəkə bağlantısını yoxlayın.",
              "Çarpayının cihaz məlumatı gəlmirsə, ekranda bağlantı vəziyyəti görünür; çarpayı başı monitordan izləməyə davam edin.",
              "Xəstəyə qulluğa təsir edirsə, yuxarıdakı klinik təcili hal addımlarını tətbiq edin və dərhal İT şöbəsinə bildirin."]]],
            ["Səlahiyyət istəyirəm", ["Səhifəyə girişiniz yoxdursa, ekranda bunu bildirən xəbərdarlıq çıxır və cəhd qeydə alınır. Səlahiyyət üçün şöbə rəhbərinizə müraciət edin; şöbə rəhbərinin təsdiqi ilə İT şöbəsi səlahiyyəti təyin edir.",
              "Rolunuzdan artıq verilən hər əlavə səlahiyyət kimin verdiyi ilə birlikdə audit jurnalına yazılır."]],
          ]}]],
          ["Nasazlığı bildirmək", ["Düzgün və tez həll üçün nasazlığı bu addımlarla bildirin:", {ol:[
            "Əvvəlcə xəstənin təhlükəsizliyini təmin edin; lazım olsa, klinik təcili hal addımlarını tətbiq edin.",
            "Hansı ekranda olduğunuzu, vaxtı və hansı iş yerindən istifadə etdiyinizi qeyd edin.",
            "Nə etdiyinizi, nə gözlədiyinizi və nə baş verdiyini qısaca yazın.",
            "Ekranda xəta mesajı varsa, olduğu kimi yazın.",
            "Xəstənin adını yazmayın; çarpayı nömrəsi kifayətdir. Xəstə məlumatı olan ekran şəklini göndərməyin.",
            "Bildirişi xəstəxananın İT şöbəsinə göndərin."]}]],
          ["Hesab və səlahiyyət sorğuları", ["Yeni hesab, rolun dəyişdirilməsi, şöbə əlavə edilməsi və ya işdən çıxan əməkdaşın hesabının bağlanması üçün şöbə rəhbərinizə və ya İT şöbəsinə müraciət edin. Səlahiyyət sorğuları şöbə rəhbərinin təsdiqi ilə icra olunur.",
            "İşdən çıxan və ya iş yeri dəyişən əməkdaşın hesabı gecikmədən bağlanmalı və ya yenilənməlidir; bunu şöbə rəhbəri bildirir."]],
          ["Prioritet və cavab", [[
            "**Əvvəlcə:** xəstəyə qulluğa təsir edən problemlər — sistemin açılmaması, cihaz məlumatlarının gəlməməsi, xəbərdarlıqların görünməməsi. Bunları gözləmədən, birbaşa bildirin.",
            "**Sonra:** giriş problemləri və kilidlənmiş hesablar.",
            "**Növbə ilə:** hesab və səlahiyyət sorğuları, digər bildirişlər. Bildirişinizin vəziyyətini İT şöbəsindən öyrənə bilərsiniz."]]],
          ["Əlaqə", ["Bütün dəstək sorğuları üçün yeganə ünvan:", "{C}"]],
        ],
      },
      RU: {
        lede:"Проблемы со входом, частые вопросы, как сообщить о сбое и что делать, если система не работает.",
        keys:["Если система не работает, уход не прекращается: пациента наблюдают по прикроватному монитору, записи ведут по резервной процедуре.",
              "Все запросы на поддержку, учётные записи и права идут в ИТ-отдел больницы.",
              "Сообщая о сбое, не пишите имя пациента — достаточно номера койки."],
        secs:[
          ["Экстренная клиническая ситуация", ["Если система не работает, уход за пациентом не прекращается.", [
            "Продолжайте наблюдать пациента по прикроватному монитору; основная тревога — на устройстве.",
            "Для записей используйте резервную процедуру больницы — на бумаге или через больничную систему учёта.",
            "Когда система восстановится, записи за этот период дополняются по резервной процедуре.",
            "Сразу сообщите о ситуации в ИТ-отдел."], "{C}"], "warn"],
          ["Частые вопросы", [{faq:[
            ["Я забыл пароль", ["На экране входа нажмите **Забыли пароль** и введите имя пользователя или рабочую электронную почту. На зарегистрированный телефон и почту придёт код; он действует 10 минут. Введите код и задайте новый пароль.",
              "Если код не приходит или ваш зарегистрированный телефон сменился, обратитесь в ИТ-отдел. После подтверждения личности вам выдадут временный пароль, который нужно сменить при первом входе. ИТ-отдел никогда не спрашивает ваш пароль."]],
            ["Не приходит код двухэтапной проверки", ["Этот код вам не отправляется: он создаётся в **приложении-аутентификаторе** на вашем телефоне и обновляется через короткие промежутки. Введите текущий 6-значный код.", [
              "Если код не принимается, проверьте, что время на телефоне устанавливается автоматически.",
              "Если вы сменили телефон или удалили приложение, обратитесь в ИТ-отдел, чтобы заново настроить проверку."]]],
            ["Моя учётная запись заблокирована", ["После 5 неверных попыток ввода пароля подряд учётная запись блокируется на 15 минут. По истечении этого времени можно попробовать снова.",
              "Если войти нужно без ожидания, ИТ-отдел может сразу снять блокировку после подтверждения личности. Если неверные попытки делали не вы, сообщите об этом отдельно."]],
            ["Мой экран заблокирован", ["Это мера безопасности: экран блокируется при бездействии или сочетанием Alt+L. Разблокируйте его своим паролем — сеанс и незавершённая работа сохраняются.",
              "Если заблокированный экран принадлежит другому человеку, не пытайтесь его открыть: завершите тот сеанс и войдите под своей учётной записью. Время до блокировки можно изменить в разделе Настройки → Безопасность в пределах максимума, установленного больницей."]],
            ["Нет звука тревоги", ["Прежде всего: **основная тревога — на прикроватном мониторе.** Звук в Homunculus — дополнительное оповещение.", [
              "На экране монитора звук при каждом открытии выключен; включите его кнопкой динамика.",
              "Браузеры не воспроизводят звук до первого нажатия на странице — нажмите в любом месте экрана.",
              "Звук мог быть приглушён на 2 минуты; по истечении времени он включится сам.",
              "Проверьте громкость компьютера и подключение динамиков.",
              "Если звука по-прежнему нет, сообщите в ИТ-отдел."]]],
            ["Не приходят уведомления на телефон", [[
              "На телефон приходит только **критическая тревога**; остальные уведомления видны в приложении и в браузере.",
              "Когда приложение закрыто, уведомления на телефон сегодня не доходят.",
              "Проверьте настройки в разделе Настройки → Уведомления и убедитесь, что на телефоне браузеру разрешены уведомления.",
              "В уведомлении нет имени пациента — только номер койки и тип тревоги.",
              "Уведомление на телефоне не заменяет прикроватную тревогу."]]],
            ["Система работает медленно или не открывается", [[
              "Обновите страницу; если не помогает, попробуйте на другом рабочем месте.",
              "Проверьте сетевое подключение рабочего места.",
              "Если от койки не поступают данные устройств, на экране видно состояние связи; продолжайте наблюдение по прикроватному монитору.",
              "Если это влияет на уход за пациентом, выполните шаги экстренной ситуации выше и сразу сообщите в ИТ-отдел."]]],
            ["Мне нужен доступ", ["Если у вас нет доступа к странице, на экране появится предупреждение, а попытка будет записана. За доступом обратитесь к руководителю отделения; с его одобрения ИТ-отдел выдаёт права.",
              "Каждое дополнительное право сверх роли записывается в журнал аудита с указанием, кто его выдал."]],
          ]}]],
          ["Как сообщить о сбое", ["Чтобы проблему решили быстро и правильно, сообщайте о сбое так:", {ol:[
            "Сначала обеспечьте безопасность пациента; при необходимости выполните шаги экстренной ситуации.",
            "Запишите, на каком экране вы были, время и рабочее место.",
            "Кратко опишите, что вы сделали, что ожидали и что произошло.",
            "Если на экране есть сообщение об ошибке, перепишите его дословно.",
            "Не пишите имя пациента — достаточно номера койки. Не отправляйте снимки экрана с данными пациентов.",
            "Передайте сообщение в ИТ-отдел больницы."]}]],
          ["Запросы на учётные записи и права", ["Для новой учётной записи, смены роли, добавления отделения или закрытия записи уволившегося сотрудника обратитесь к руководителю отделения или в ИТ-отдел. Запросы на права выполняются с одобрения руководителя отделения.",
            "Учётную запись уволившегося или переведённого сотрудника нужно без промедления закрыть или обновить; об этом сообщает руководитель отделения."]],
          ["Приоритет и сроки", [[
            "**В первую очередь:** проблемы, влияющие на уход за пациентами, — система не открывается, не поступают данные устройств, не отображаются предупреждения. Сообщайте о них сразу и напрямую.",
            "**Затем:** проблемы со входом и заблокированные учётные записи.",
            "**В порядке очереди:** запросы на учётные записи и права, прочие обращения. О статусе обращения можно узнать в ИТ-отделе."]]],
          ["Контакты", ["Единый адрес для всех запросов на поддержку:", "{C}"]],
        ],
      },
      EN: {
        lede:"Sign-in problems, frequent questions, how to report a fault, and what to do when the system is down.",
        keys:["If the system is down, care does not stop: the patient is watched on the bedside monitor and records follow the backup procedure.",
              "All support, account and access requests go to the hospital IT department.",
              "When reporting a fault, do not write the patient's name; the bed number is enough."],
        secs:[
          ["Clinical emergency", ["If the system is down, patient care does not stop.", [
            "Keep monitoring the patient on the bedside monitor; the primary alarm is on the device.",
            "For records, follow the hospital's backup procedure on paper or through the hospital records system.",
            "When the system is back, the records for that period are completed under the backup procedure.",
            "Report the outage to IT straight away."], "{C}"], "warn"],
          ["Frequent questions", [{faq:[
            ["I forgot my password", ["On the sign-in screen, click **Forgot password** and enter your username or work email. A code is sent to your registered phone and email; it is valid for 10 minutes. Enter it and set a new password.",
              "If the code does not arrive, or your registered phone has changed, contact IT. Once your identity is confirmed you receive a temporary password, which you must change at first sign-in. IT will never ask for your password."]],
            ["My two-step verification code does not arrive", ["This code is not sent to you: it is generated in the **authenticator app** on your phone and refreshes at short intervals. Enter the current 6-digit code.", [
              "If the code is rejected, check that your phone's clock is set automatically.",
              "If you have changed phones or removed the app, contact IT to set up verification again."]]],
            ["My account is locked", ["After 5 wrong password attempts in a row, the account locks for 15 minutes. You can try again once that time has passed.",
              "If you need to get in without waiting, IT can unlock it straight away after confirming your identity. If you did not make the failed attempts, report that as well."]],
            ["My screen is locked", ["This is a safety measure: the screen locks when idle or with Alt+L. Unlock it with your own password; your session and unfinished work are kept.",
              "If the locked screen belongs to someone else, do not try to open it; sign that session out and sign in with your own account. You can change the lock time under Settings → Security, within the hospital's maximum."]],
            ["There is no alarm sound", ["First: **the primary alarm is on the bedside monitor.** The sound in Homunculus is an additional alert.", [
              "On the monitor screen, sound starts off every time it opens; turn it on with the speaker button.",
              "Browsers do not play sound until the page is clicked once; click anywhere on the screen.",
              "Sound may be muted for 2 minutes; it comes back on by itself when the time is up.",
              "Check the computer's volume and speaker connection.",
              "If there is still no sound, report it to IT."]]],
            ["Notifications do not reach my phone", [[
              "Only **critical alarms** go to your phone; other notifications appear in the app and in the browser.",
              "Notifications do not currently reach your phone while the app is closed.",
              "Check your settings under Settings → Notifications, and make sure browser notifications are allowed on your phone.",
              "Notifications carry no patient name; they show the bed number and alarm type.",
              "A phone notification does not replace the bedside alarm."]]],
            ["The system is slow or will not open", [[
              "Reload the page; if that does not help, try another workstation.",
              "Check the workstation's network connection.",
              "If a bed's device data is not arriving, the screen shows its connection status; keep watching the bedside monitor.",
              "If patient care is affected, follow the clinical emergency steps above and report it to IT straight away."]]],
            ["I need access", ["If you do not have access to a page, a message on screen tells you so and the attempt is recorded. Ask your unit lead for access; with the unit lead's approval, IT grants it.",
              "Every extra permission beyond your role is written to the audit log together with who granted it."]],
          ]}]],
          ["Reporting a fault", ["For a fast, correct fix, report a fault like this:", {ol:[
            "Make the patient safe first; follow the clinical emergency steps if needed.",
            "Note which screen you were on, the time and which workstation you used.",
            "Briefly write what you did, what you expected and what happened.",
            "If there is an error message on screen, copy it word for word.",
            "Do not write the patient's name; the bed number is enough. Do not send screenshots containing patient data.",
            "Send the report to the hospital IT department."]}]],
          ["Account and access requests", ["For a new account, a role change, adding a unit or closing the account of someone who has left, contact your unit lead or the IT department. Access requests are processed with the unit lead's approval.",
            "The account of someone who leaves or changes post must be closed or updated without delay; the unit lead reports this."]],
          ["Priority and response", [[
            "**First:** problems that affect patient care — the system will not open, device data is not arriving, alerts are not showing. Report these directly, without waiting.",
            "**Next:** sign-in problems and locked accounts.",
            "**In order:** account and access requests, and other reports. You can ask IT about the status of your report."]]],
          ["Contact", ["One address for all support requests:", "{C}"]],
        ],
      },
    },
  };

  /* ---------- 5. tur eklemeleri ---------- */
  /* Kısaca kartı: her belgenin 3 ana noktasına, belgenin kendi metninden 2 madde daha */
  const EXTRA = {
    privacy:{
      TR:["Tarayıcıda yalnız ekran tercihleriniz saklanır; tam liste Çerezler sayfasındadır.",
          "Kişisel verilerinizle ilgili sorularınız için hastanenin bilgi işlem birimine başvurabilirsiniz; hak başvurusunun yolu Aydınlatma Metni'ndedir."],
      AZ:["Brauzerdə yalnız ekran seçimləriniz saxlanılır; tam siyahı Kukilər səhifəsindədir.",
          "Fərdi məlumatlarınızla bağlı suallar üçün xəstəxananın İT şöbəsinə müraciət edə bilərsiniz; hüquq müraciətinin qaydası Məlumatlandırma bildirişindədir."],
      RU:["В браузере хранятся только ваши настройки экрана; полный список — на странице «Cookie».",
          "С вопросами о персональных данных обращайтесь в ИТ-отдел больницы; порядок обращения по правам описан в Уведомлении."],
      EN:["Only your screen preferences are stored in the browser; the full list is on the Cookies page.",
          "For questions about your personal data, contact the hospital IT department; how to exercise your rights is set out in the Data Notice."] },
    terms:{
      TR:["**Bir uyarının görünmemesi, hastanın iyi olduğu anlamına gelmez.**",
          "Her erişim ve işlem kayda geçer; görev gereği olmayan erişim disiplin süreçlerine konu olabilir."],
      AZ:["**Xəbərdarlığın görünməməsi xəstənin yaxşı olduğu demək deyil.**",
          "Hər giriş və əməliyyat qeydə alınır; vəzifə ilə bağlı olmayan giriş intizam prosedurlarına səbəb ola bilər."],
      RU:["**Отсутствие предупреждения не означает, что пациенту хорошо.**",
          "Каждый доступ и действие записываются; доступ, не связанный с обязанностями, может повлечь дисциплинарные меры."],
      EN:["**The absence of an alert does not mean the patient is well.**",
          "Every access and action is recorded; access unrelated to your duties may lead to disciplinary procedures."] },
    notice:{
      TR:["Veriler reklam, pazarlama ya da ilgisiz bir amaçla kullanılmaz.",
          "Kamera görüntüsü hiç saklanmaz; Homunculus aileye ya da hastaya doğrudan bilgi göndermez."],
      AZ:["Məlumatlar reklam, marketinq və ya əlaqəsiz məqsəd üçün istifadə olunmur.",
          "Kamera görüntüsü heç saxlanılmır; Homunculus ailəyə və ya xəstəyə birbaşa məlumat göndərmir."],
      RU:["Данные не используются для рекламы, маркетинга или посторонних целей.",
          "Изображение с камеры не хранится; Homunculus не отправляет сведения напрямую родственникам или пациенту."],
      EN:["Data is not used for advertising, marketing or any unrelated purpose.",
          "Camera images are never stored; Homunculus does not send information directly to families or patients."] },
    support:{
      TR:["Hasta bakımını etkileyen sorunlar beklemeden, doğrudan bildirilir.",
          "Sık sorulan soruların cevabı bu sayfada; çözülmezse sayfadaki formla sorun bildirin."],
      AZ:["Xəstəyə qulluğa təsir edən problemlər gözləmədən, birbaşa bildirilir.",
          "Tez-tez verilən sualların cavabı bu səhifədədir; həll olunmasa, səhifədəki forma ilə problemi bildirin."],
      RU:["О проблемах, влияющих на уход за пациентами, сообщают сразу и напрямую.",
          "Ответы на частые вопросы — на этой странице; если это не помогло, сообщите о проблеме через форму."],
      EN:["Problems that affect patient care are reported directly, without waiting.",
          "Answers to frequent questions are on this page; if that does not solve it, report the problem with the form."] },
  };

  /* Destek: SSS dört gruba ayrılır, 6 soru eklenir, "Sorun bildir" bölümü arıza bildirmenin ardına girer.
     Metinde [[anahtar|yazı]] → o belgeye bağlantı · [[@form|yazı]] → sorun bildir bölümüne atlar. */
  const SUP = {
    TR:{ groups:["Giriş ve hesap", "Bildirim ve ses", "Ekranlar ve cihazlar", "Veri ve hata bildirimi"],
      phone:["Telefona bildirim nasıl açılır?", ["Telefona yalnız **kritik alarm** gider; bildirimde hasta adı yoktur, yatak numarası ve alarm türü yazar.", {ol:[
        "Homunculus'u telefonunuzun tarayıcısında açın ve giriş yapın.",
        "**Ayarlar → Bildirimler** bölümüne gidin.",
        "**Ana ekrana ekle** adımını tamamlayın. Android: Chrome → ⋮ menü → “Ana ekrana ekle”. iPhone: Safari → Paylaş → “Ana Ekrana Ekle”.",
        "**Bildirimlere izin ver** düğmesine basın ve tarayıcının sorusunu onaylayın.",
        "Son adımdaki düğmeyle bir bildirimin telefonunuza geldiğini kontrol edin."]},
        "İzni daha önce reddettiyseniz tarayıcı ayarlarından açmanız gerekir. Telefon bildirimi yatak başı alarmın yerini tutmaz."]],
      device:["Bir cihaz veri göndermiyor", ["Hastayı **yatak başı monitörden** izlemeye devam edin; asıl alarm cihazdadır.", [
        "Ekranda cihazın bağlantı durumu görünür: **Bağlı**, **Sessiz** (bağlı ama yeni veri gelmiyor) ya da **Çevrim dışı**.",
        "Cihazın açık olduğunu, kablosunun ya da ağ bağlantısının yerinde olduğunu kontrol edin.",
        "Sorun sürerse biyomedikal birimine ve bilgi işleme bildirin; yatak numarasını ve cihaz türünü yazın. Hasta adı yazmayın."]]],
      lang:["Dili nasıl değiştiririm?", [[
        "Giriş ekranında bayraklı dil düğmesine basın ve dilinizi seçin: Azərbaycan, Türkçe, Русский ya da English.",
        "Giriş yaptıktan sonra üst çubuktaki bayraklı düğmeyi ya da **Ayarlar → Görünüm** bölümünü kullanın.",
        "Seçiminiz bu tarayıcıda saklanır; ayrıntısı [[cookies|Çerezler]] sayfasındadır.",
        "Hastaneniz dili sabitlediyse Ayarlar'dan değiştirilemez; bilgi işleme başvurun."]]],
      print:["Nasıl yazdırırım ya da PDF alırım?", [[
        "Yazdırılabilen ekranlarda yazıcı simgeli bir düğme bulunur; yasal ve destek sayfalarında bu düğme **Kısaca** kartındaki **Yazdır / PDF** düğmesidir.",
        "Yazdırma penceresinde yazıcı yerine “PDF olarak kaydet”i seçerseniz belgeyi dosya olarak alırsınız.",
        "Hasta verisi içeren çıktıları ortada bırakmayın; ekran görüntüsü ya da fotoğrafla hasta verisini sistem dışına çıkarmayın."]]],
      data:["Verilerim nerede saklanıyor?", ["Hasta ve kayıt verileri {H} bünyesindeki sunucularda tutulur ve işlenir; ayrıntısı [[privacy|Gizlilik Politikası]] sayfasındadır.",
        "Tarayıcınızda yalnız ekran tercihleriniz (dil, tema, yazı boyu gibi) saklanır; hasta verisi saklanmaz. Tam liste ve silme düğmesi [[cookies|Çerezler]] sayfasındadır."]],
      report:["Bir hatayı nasıl bildiririm?", ["Bu sayfadaki [[@form|Sorun bildir]] formunu doldurun ya da hastanenizin bilgi işlem birimine başvurun.",
        "Hasta adı yazmayın; yatak numarası yeterlidir. Hasta bakımını etkileyen bir sorunda beklemeyin: önce klinik acil durum adımlarını uygulayın."]],
      form:["Sorun bildir", ["Çözemediğiniz bir sorunu buradan bildirin; hastanenizin bilgi işlem birimi inceler. Hasta adı yazmayın, yatak numarası yeterlidir.", {form:"report"}]] },
    AZ:{ groups:["Giriş və hesab", "Bildiriş və səs", "Ekranlar və cihazlar", "Məlumat və xəta bildirişi"],
      phone:["Telefona bildirişi necə aktivləşdirim?", ["Telefona yalnız **kritik siqnal** gedir; bildirişdə xəstənin adı olmur, çarpayı nömrəsi və siqnalın növü yazılır.", {ol:[
        "Homunculus-u telefonunuzun brauzerində açın və daxil olun.",
        "**Ayarlar → Bildirişlər** bölməsinə keçin.",
        "**Ana ekrana əlavə et** addımını tamamlayın. Android: Chrome → ⋮ menyu → “Ana ekrana əlavə et”. iPhone: Safari → Paylaş → “Ana ekrana əlavə et”.",
        "**Bildirişə icazə ver** düyməsinə basın və brauzerin sorğusunu təsdiqləyin.",
        "Son addımdakı düymə ilə bildirişin telefonunuza gəldiyini yoxlayın."]},
        "İcazəni əvvəl rədd etmisinizsə, onu brauzer ayarlarından açmalısınız. Telefon bildirişi çarpayı başı siqnalı əvəz etmir."]],
      device:["Cihaz məlumat göndərmir", ["Xəstəni **çarpayı başı monitordan** izləməyə davam edin; əsas siqnal cihazdadır.", [
        "Ekranda cihazın bağlantı vəziyyəti görünür: **Bağlı**, **Səssiz** (bağlıdır, amma yeni məlumat gəlmir) və ya **Oflayn**.",
        "Cihazın açıq olduğunu, kabelinin və ya şəbəkə bağlantısının yerində olduğunu yoxlayın.",
        "Problem davam edərsə, biotibbi mühəndisə və İT şöbəsinə bildirin; çarpayı nömrəsini və cihazın növünü yazın. Xəstənin adını yazmayın."]]],
      lang:["Dili necə dəyişim?", [[
        "Giriş ekranında bayraqlı dil düyməsinə basın və dili seçin: Azərbaycan, Türkçe, Русский və ya English.",
        "Daxil olduqdan sonra yuxarı paneldəki bayraqlı düymədən və ya **Ayarlar → Görünüş** bölməsindən istifadə edin.",
        "Seçiminiz bu brauzerdə saxlanılır; ətraflı məlumat [[cookies|Kukilər]] səhifəsindədir.",
        "Xəstəxananız dili sabitləyibsə, onu Ayarlardan dəyişmək olmur; İT şöbəsinə müraciət edin."]]],
      print:["Necə çap edim və ya PDF alım?", [[
        "Çap oluna bilən ekranlarda printer simvollu düymə var; hüquqi və dəstək səhifələrində bu, **Qısaca** kartındakı **Çap et / PDF** düyməsidir.",
        "Çap pəncərəsində printer əvəzinə “PDF kimi saxla” seçsəniz, sənədi fayl kimi alırsınız.",
        "Xəstə məlumatı olan çap nüsxələrini açıq qoymayın; ekran şəkli və ya foto ilə xəstə məlumatını sistemdən kənara çıxarmayın."]]],
      data:["Məlumatlarım harada saxlanılır?", ["Xəstə və qeyd məlumatları {H} daxilindəki serverlərdə saxlanılır və emal olunur; ətraflı məlumat [[privacy|Məxfilik siyasəti]] səhifəsindədir.",
        "Brauzerinizdə yalnız ekran seçimləriniz (dil, tema, şrift ölçüsü və s.) saxlanılır; xəstə məlumatı saxlanılmır. Tam siyahı və silmə düyməsi [[cookies|Kukilər]] səhifəsindədir."]],
      report:["Xətanı necə bildirim?", ["Bu səhifədəki [[@form|Problemi bildir]] formasını doldurun və ya xəstəxananızın İT şöbəsinə müraciət edin.",
        "Xəstənin adını yazmayın; çarpayı nömrəsi kifayətdir. Xəstəyə qulluğa təsir edən problemdə gözləməyin: əvvəlcə klinik təcili hal addımlarını tətbiq edin."]],
      form:["Problemi bildir", ["Həll edə bilmədiyiniz problemi buradan bildirin; xəstəxananızın İT şöbəsi araşdırır. Xəstənin adını yazmayın, çarpayı nömrəsi kifayətdir.", {form:"report"}]] },
    RU:{ groups:["Вход и учётная запись", "Уведомления и звук", "Экраны и приборы", "Данные и сообщения о проблемах"],
      phone:["Как включить уведомления на телефон?", ["На телефон приходит только **критическая тревога**; в уведомлении нет имени пациента — только номер койки и тип тревоги.", {ol:[
        "Откройте Homunculus в браузере телефона и войдите.",
        "Перейдите в раздел **Настройки → Уведомления**.",
        "Выполните шаг **Добавить на главный экран**. Android: Chrome → меню ⋮ → «Добавить на главный экран». iPhone: Safari → Поделиться → «На экран Домой».",
        "Нажмите **Разрешить уведомления** и подтвердите запрос браузера.",
        "Кнопкой последнего шага проверьте, что уведомление приходит на телефон."]},
        "Если вы ранее запретили уведомления, включите их в настройках браузера. Уведомление на телефоне не заменяет прикроватную тревогу."]],
      device:["Прибор не передаёт данные", ["Продолжайте наблюдать пациента по **прикроватному монитору**; основная тревога — на устройстве.", [
        "На экране видно состояние связи прибора: **Подключён**, **Молчит** (подключён, но новые данные не поступают) или **Не в сети**.",
        "Проверьте, что прибор включён, а кабель или сетевое подключение на месте.",
        "Если проблема сохраняется, сообщите биомедицинскому инженеру и в ИТ-отдел; укажите номер койки и тип прибора. Не пишите имя пациента."]]],
      lang:["Как сменить язык?", [[
        "На экране входа нажмите кнопку языка с флагом и выберите язык: Azərbaycan, Türkçe, Русский или English.",
        "После входа используйте кнопку с флагом на верхней панели или раздел **Настройки → Вид**.",
        "Ваш выбор сохраняется в этом браузере; подробнее — на странице [[cookies|Cookie]].",
        "Если больница закрепила язык, изменить его в настройках нельзя; обратитесь в ИТ-отдел."]]],
      print:["Как распечатать или сохранить PDF?", [[
        "На экранах, которые можно распечатать, есть кнопка со значком принтера; на правовых страницах и странице поддержки это кнопка **Печать / PDF** в карточке **Коротко**.",
        "В окне печати выберите вместо принтера «Сохранить как PDF», чтобы получить файл.",
        "Не оставляйте без присмотра распечатки с данными пациентов; не выносите данные пациентов за пределы системы с помощью снимков экрана или фотографий."]]],
      data:["Где хранятся мои данные?", ["Данные пациентов и записи хранятся и обрабатываются на серверах {H}; подробнее — в документе [[privacy|Политика конфиденциальности]].",
        "В браузере хранятся только ваши настройки экрана (язык, тема, размер шрифта и т. п.); данные пациентов там не хранятся. Полный список и кнопка удаления — на странице [[cookies|Cookie]]."]],
      report:["Как сообщить об ошибке?", ["Заполните форму [[@form|Сообщить о проблеме]] на этой странице или обратитесь в ИТ-отдел вашей больницы.",
        "Не пишите имя пациента — достаточно номера койки. Если проблема влияет на уход за пациентом, не ждите: сначала выполните шаги экстренной ситуации."]],
      form:["Сообщить о проблеме", ["Сообщите здесь о проблеме, которую не удалось решить; ИТ-отдел вашей больницы её рассмотрит. Не пишите имя пациента — достаточно номера койки.", {form:"report"}]] },
    EN:{ groups:["Sign-in and account", "Notifications and sound", "Screens and devices", "Data and reporting problems"],
      phone:["How do I turn on phone notifications?", ["Only **critical alarms** go to your phone; notifications carry no patient name, only the bed number and alarm type.", {ol:[
        "Open Homunculus in your phone's browser and sign in.",
        "Go to **Settings → Notifications**.",
        "Complete the **Add to home screen** step. Android: Chrome → ⋮ menu → “Add to Home screen”. iPhone: Safari → Share → “Add to Home Screen”.",
        "Tap **Allow notifications** and accept the browser's prompt.",
        "Use the button in the last step to check that a notification reaches your phone."]},
        "If you blocked notifications before, turn them on in your browser settings. A phone notification does not replace the bedside alarm."]],
      device:["A device is not sending data", ["Keep watching the patient on the **bedside monitor**; the primary alarm is on the device.", [
        "The screen shows the device's connection status: **Connected**, **Silent** (connected, but no new data) or **Offline**.",
        "Check that the device is switched on and that its cable or network connection is in place.",
        "If it continues, tell biomedical engineering and IT; give the bed number and device type. Do not write the patient's name."]]],
      lang:["How do I change the language?", [[
        "On the sign-in screen, press the language button with the flag and choose: Azərbaycan, Türkçe, Русский or English.",
        "After signing in, use the flag button in the top bar or **Settings → Appearance**.",
        "Your choice is stored in this browser; see the [[cookies|Cookies]] page.",
        "If your hospital has fixed the language, it cannot be changed in Settings; contact IT."]]],
      print:["How do I print or save a PDF?", [[
        "Screens that can be printed have a button with a printer icon; on the legal and support pages it is the **Print / PDF** button in the **In short** card.",
        "In the print dialog, choose “Save as PDF” instead of a printer to get a file.",
        "Do not leave printouts with patient data lying around; do not take patient data out of the system by screenshot or photo."]]],
      data:["Where is my data stored?", ["Patient data and records are kept and processed on servers within {H}; see the [[privacy|Privacy Policy]] for details.",
        "Your browser stores only your screen preferences (language, theme, text size and similar); it stores no patient data. The full list and a delete button are on the [[cookies|Cookies]] page."]],
      report:["How do I report a problem?", ["Fill in the [[@form|Report a problem]] form on this page, or contact your hospital IT department.",
        "Do not write the patient's name; the bed number is enough. If patient care is affected, do not wait: follow the clinical emergency steps first."]],
      form:["Report a problem", ["Report a problem you could not solve here; your hospital IT department will look into it. Do not write the patient's name; the bed number is enough.", {form:"report"}]] },
  };

  /* Çerezler: tarayıcıda saklanan HER ŞEY. Liste app/*.js taranarak çıkarıldı (24.09):
     core.js H.savePref → "hmc." + lang/theme/size/bedView/rememberUser2 · ayarlar.js lockMin, n_<tür>_web (yalnız kapatılabilen üçü)
     monitor.js hmc.snd.pulse/alarms · admin.js hmc.roles · sosyal.js hmc.social · pwa.js service worker (sw.js önbellek tutmaz).
     Yeni bir anahtar eklenirse buraya da yazılmalı; "Tercihlerimi sil" hmc.* önekli her şeyi siler. */
  const DUR = {
    sess:{ AZ:"Çıxış edəndə və ya brauzer bağlananda silinir", TR:"Çıkış yapınca ya da tarayıcı kapanınca silinir", RU:"Удаляется при выходе или закрытии браузера", EN:"Deleted when you sign out or close the browser" },
    local:{ AZ:"Siz silənə qədər, yalnız bu brauzerdə", TR:"Siz silene kadar, yalnız bu tarayıcıda", RU:"Пока вы не удалите, только в этом браузере", EN:"Until you delete it, in this browser only" },
    perm:{ AZ:"Siz ləğv edənə qədər (brauzer saxlayır)", TR:"Siz geri alana kadar (tarayıcı saklar)", RU:"Пока вы не отзовёте (хранит браузер)", EN:"Until you revoke it (kept by the browser)" },
    sw:{ AZ:"Brauzerdən sayt məlumatları silinənə qədər", TR:"Tarayıcıdan site verileri silinene kadar", RU:"Пока данные сайта не удалены в браузере", EN:"Until the site data is cleared in the browser" },
  };
  const STORE = [
    [{ AZ:"**Sessiya**", TR:"**Oturum**", RU:"**Сеанс**", EN:"**Session**" }, "sess",
      { AZ:"Daxil olduğunuzu təsdiqləyir və səhifələr arasında sessiyanızı qoruyur. Server tərəfindən verilir.", TR:"Giriş yaptığınızı doğrular ve sayfalar arasında oturumunuzu korur. Sunucu tarafından verilir.", RU:"Подтверждает, что вы вошли, и сохраняет сеанс между страницами. Выдаётся сервером.", EN:"Confirms that you are signed in and keeps your session between pages. Issued by the server." }],
    ["`hmc.lang`", "local", { AZ:"İnterfeys dili (AZ, TR, RU, EN)", TR:"Arayüz dili (AZ, TR, RU, EN)", RU:"Язык интерфейса (AZ, TR, RU, EN)", EN:"Interface language (AZ, TR, RU, EN)" }],
    ["`hmc.theme`", "local", { AZ:"Gecə və ya gündüz işığı teması", TR:"Gece ya da gün ışığı teması", RU:"Тема: ночная или дневная", EN:"Night or daylight theme" }],
    ["`hmc.size`", "local", { AZ:"Şrift ölçüsü (normal və ya böyük)", TR:"Yazı boyu (normal ya da büyük)", RU:"Размер шрифта (обычный или крупный)", EN:"Text size (normal or large)" }],
    ["`hmc.bedView`", "local", { AZ:"Çarpayı panelinin kart və ya siyahı görünüşü", TR:"Yatak panelinin kart ya da liste görünümü", RU:"Вид панели коек: карточки или список", EN:"Bed panel shown as cards or a list" }],
    ["`hmc.lockMin`", "local", { AZ:"Seçdiyiniz ekran kilidi müddəti (xəstəxananın yuxarı həddi daxilində)", TR:"Seçtiğiniz ekran kilidi süresi (hastanenin üst sınırı içinde)", RU:"Выбранное вами время до блокировки экрана (в пределах максимума больницы)", EN:"Your chosen screen-lock time (within the hospital's maximum)" }],
    ["`hmc.rememberUser2`", "local", { AZ:"Girişdə “İstifadəçi adını xatırla” seçilibsə, yalnız istifadəçi adınız. Şifrə heç vaxt saxlanılmır.", TR:"Girişte “Kullanıcı adımı hatırla” seçildiyse yalnız kullanıcı adınız. Şifre hiçbir zaman saklanmaz.", RU:"Если при входе выбрано «Запомнить имя» — только имя пользователя. Пароль никогда не сохраняется.", EN:"Only your username, if “Remember username” was ticked at sign-in. Your password is never stored." }],
    ["`hmc.n_high_web` `hmc.n_hand_web` `hmc.n_task_web`", "local", { AZ:"Brauzer bildirişi seçimləriniz: yüksək siqnal, təhvil gözləyən qeyd, gecikən iş. Kritik siqnal və kritik laborator nəticəsi söndürülə bilməz.", TR:"Tarayıcı bildirimi tercihleriniz: yüksek alarm, teslim bekleyen not, geciken iş. Kritik alarm ve kritik laboratuvar sonucu kapatılamaz.", RU:"Ваши настройки уведомлений в браузере: высокая тревога, заметка к передаче смены, просроченная задача. Критическую тревогу и критический результат анализа отключить нельзя.", EN:"Your browser notification choices: high alarm, handover note waiting, overdue task. Critical alarms and critical lab results cannot be turned off." }],
    ["`hmc.snd.pulse` `hmc.snd.alarms`", "local", { AZ:"Nəbz siqnalının və həyəcan tonlarının açıq və ya bağlı olması", TR:"Nabız bipi ve alarm tonlarının açık ya da kapalı olması", RU:"Включены ли звук пульса и тоны тревог", EN:"Whether the pulse beep and alarm tones are on or off" }],
    ["`hmc.cookieNote`", "local", { AZ:"Ana səhifədəki kuki qeydini “Aydındır” ilə bağladığınızı xatırlayır", TR:"Ana sayfadaki çerez notunu “Tamam” ile kapattığınızı hatırlar", RU:"Запоминает, что вы закрыли заметку о cookie на главной странице", EN:"Remembers that you closed the cookie note on the home page" }],
    ["`hmc.roles`", "local", { AZ:"Yalnız idarəetmə hesabı: bu brauzerdə səlahiyyət cədvəlində edilən dəyişikliklər", TR:"Yalnız yönetim hesabı: bu tarayıcıda yetki tablosunda yapılan düzenlemeler", RU:"Только для администраторов: изменения таблицы прав, сделанные в этом браузере", EN:"Management accounts only: changes made to the permissions table in this browser" }],
    ["`hmc.social`", "local", { AZ:"Yalnız idarəetmə hesabı: giriş ekranında göstərilən sosial media və veb keçidləri", TR:"Yalnız yönetim hesabı: giriş ekranında gösterilen sosyal medya ve web bağlantıları", RU:"Только для администраторов: ссылки на соцсети и сайт на экране входа", EN:"Management accounts only: social media and web links shown on the sign-in screen" }],
    [{ AZ:"**Brauzer icazələri**", TR:"**Tarayıcı izinleri**", RU:"**Разрешения браузера**", EN:"**Browser permissions**" }, "perm",
      { AZ:"Bildiriş, mikrofon və kamera icazələri. Onları Homunculus deyil, brauzerin özü saxlayır; vəziyyəti Ayarlar → İcazələr bölməsində görürsünüz.", TR:"Bildirim, mikrofon ve kamera izinleri. Homunculus değil tarayıcının kendisi saklar; durumunu Ayarlar → İzinler bölümünde görürsünüz.", RU:"Разрешения на уведомления, микрофон и камеру. Их хранит сам браузер, а не Homunculus; состояние видно в разделе Настройки → Разрешения.", EN:"Notification, microphone and camera permissions. They are kept by the browser itself, not by Homunculus; you can see them under Settings → Permissions." }],
    [{ AZ:"**Bildiriş xidməti** (service worker)", TR:"**Bildirim çalışanı** (service worker)", RU:"**Служба уведомлений** (service worker)", EN:"**Notification worker** (service worker)" }, "sw",
      { AZ:"Kritik siqnal bildirişini telefonda və brauzerdə göstərmək üçün qeydiyyata alınır. Səhifə və ya məlumatı keşdə saxlamır.", TR:"Kritik alarm bildirimini telefonda ve tarayıcıda göstermek için kaydedilir. Sayfa ya da veri önbelleğe almaz.", RU:"Регистрируется, чтобы показывать уведомления о критической тревоге на телефоне и в браузере. Не кэширует страницы и данные.", EN:"Registered to show critical alarm notifications on your phone and in the browser. It does not cache pages or data." }],
  ];
  const STORE_H = { AZ:["Açar", "Nə üçündür", "Nə qədər qalır"], TR:["Anahtar", "Ne işe yarar", "Ne kadar kalır"], RU:["Ключ", "Назначение", "Срок хранения"], EN:["Key", "What it is for", "How long it stays"] };

  C.cookies = {
    TR: {
      lede:"Homunculus'un tarayıcınızda ne sakladığını, neden sakladığını ve nasıl sileceğinizi anlatır. Takip, reklam ya da analiz çerezi yoktur.",
      keys:["**Takip, reklam ya da analiz çerezi yok;** bu yüzden ekranı kapatan bir çerez onay penceresi de yok.",
            "Tarayıcıda yalnız oturum ve sizin seçtiğiniz ekran tercihleri tutulur; hasta verisi tutulmaz.",
            "Oturum sunucu tarafından verilir; çıkışta ya da tarayıcı kapanınca silinir.",
            "Saklanan her anahtar bu sayfadaki tabloda adıyla listelenir.",
            "Tercihlerinizi bu sayfadaki düğmeyle tek seferde silebilirsiniz."],
      secs:[
        ["Neden onay penceresi yok", ["Homunculus reklam göstermez. Takip, reklam ya da analiz amaçlı çerez kullanmaz ve üçüncü taraf çerezi yerleştirmez.",
          "Tarayıcıda yalnız sistemin çalışması için gereken oturum ve sizin seçtiğiniz ekran tercihleri tutulur. Bu yüzden ekranı kapatan bir çerez onay penceresi göstermiyoruz; onun yerine neyin saklandığını burada eksiksiz listeliyoruz."]],
        ["Tarayıcınızda saklananlar", ["Aşağıdaki liste, Homunculus'un tarayıcınıza yazdığı her şeydir. Anahtar adları, tarayıcının geliştirici araçlarında gördüğünüz adlarla aynıdır.", {store:1}]],
        ["Neler saklanmaz", [[
          "Hasta adı, hasta verisi ya da klinik kayıt,",
          "Şifreniz ya da iki adımlı doğrulama kodu,",
          "Hangi ekranı ne zaman açtığınız; bu bilgi yalnız sunucudaki denetim kaydında tutulur,",
          "Reklam, analiz ya da takip kimliği."]]],
        ["Tercihlerimi sil", ["Bu düğme, bu tarayıcıdaki bütün Homunculus tercihlerini (adı `hmc.` ile başlayan anahtarlar) siler. Hasta kayıtlarına ve sunucudaki hiçbir bilgiye dokunmaz; bu tarayıcıdaki ekran ayarları varsayılana döner.", {prefs:1}]],
        ["Tarayıcı ayarlarından silme", [[
          "Tarayıcının ayarlarında bu sitenin verilerini silerek aynı kayıtları kaldırabilirsiniz.",
          "Bildirim, mikrofon ve kamera izinlerini adres çubuğundaki kilit simgesinden geri alabilirsiniz.",
          "Gizli pencerede kaydedilen tercihler, pencere kapanınca kendiliğinden silinir.",
          "Paylaşılan istasyonda vardiya sonunda oturumu kapatmanız yeterlidir; tercihleri silmek zorunda değilsiniz."]]],
        ["İletişim", ["Bu sayfayla ilgili sorularınız için:", "{C}"]],
      ],
    },
    AZ: {
      lede:"Homunculus-un brauzerinizdə nə saxladığını, nə üçün saxladığını və onu necə silə biləcəyinizi izah edir. İzləmə, reklam və ya analitika kukiləri yoxdur.",
      keys:["**İzləmə, reklam və ya analitika kukiləri yoxdur;** buna görə ekranı bağlayan kuki razılığı pəncərəsi də yoxdur.",
            "Brauzerdə yalnız sessiya və sizin seçdiyiniz ekran seçimləri saxlanılır; xəstə məlumatı saxlanılmır.",
            "Sessiya server tərəfindən verilir; çıxışda və ya brauzer bağlananda silinir.",
            "Saxlanılan hər açar bu səhifədəki cədvəldə adı ilə göstərilir.",
            "Seçimlərinizi bu səhifədəki düymə ilə bir dəfəyə silə bilərsiniz."],
      secs:[
        ["Razılıq pəncərəsi niyə yoxdur", ["Homunculus reklam göstərmir. İzləmə, reklam və ya analitika məqsədli kukilərdən istifadə etmir və üçüncü tərəf kukiləri yerləşdirmir.",
          "Brauzerdə yalnız sistemin işləməsi üçün lazım olan sessiya və sizin seçdiyiniz ekran seçimləri saxlanılır. Buna görə ekranı bağlayan kuki razılığı pəncərəsi göstərmirik; əvəzində nəyin saxlanıldığını burada tam siyahı ilə göstəririk."]],
        ["Brauzerinizdə saxlananlar", ["Aşağıdakı siyahı Homunculus-un brauzerinizə yazdığı hər şeydir. Açarların adları brauzerin tərtibatçı alətlərində gördüyünüz adlarla eynidir.", {store:1}]],
        ["Nələr saxlanılmır", [[
          "Xəstənin adı, xəstə məlumatı və ya klinik qeyd,",
          "Şifrəniz və ya iki mərhələli təsdiqləmə kodu,",
          "Hansı ekranı nə vaxt açdığınız; bu məlumat yalnız serverdəki audit jurnalında saxlanılır,",
          "Reklam, analitika və ya izləmə identifikatoru."]]],
        ["Seçimlərimi sil", ["Bu düymə bu brauzerdəki bütün Homunculus seçimlərini (adı `hmc.` ilə başlayan açarları) silir. Xəstə qeydlərinə və serverdəki heç bir məlumata toxunmur; bu brauzerdəki ekran ayarları standart vəziyyətə qayıdır.", {prefs:1}]],
        ["Brauzer ayarlarından silmək", [[
          "Brauzerin ayarlarında bu saytın məlumatlarını silərək eyni qeydləri silə bilərsiniz.",
          "Bildiriş, mikrofon və kamera icazələrini ünvan sətrindəki kilid işarəsindən ləğv edə bilərsiniz.",
          "Gizli pəncərədə saxlanılan seçimlər pəncərə bağlananda öz-özünə silinir.",
          "Ümumi iş yerində növbənin sonunda sessiyanı bağlamağınız kifayətdir; seçimləri silmək məcburi deyil."]]],
        ["Əlaqə", ["Bu səhifə ilə bağlı suallar üçün:", "{C}"]],
      ],
    },
    RU: {
      lede:"Что Homunculus хранит в вашем браузере, зачем и как это удалить. Отслеживающих, рекламных и аналитических cookie нет.",
      keys:["**Отслеживающих, рекламных и аналитических cookie нет;** поэтому нет и окна согласия, закрывающего экран.",
            "В браузере хранятся только сеанс и выбранные вами настройки экрана; данные пациентов не хранятся.",
            "Сеанс выдаётся сервером и удаляется при выходе или закрытии браузера.",
            "Каждый сохраняемый ключ указан по имени в таблице на этой странице.",
            "Свои настройки можно удалить одной кнопкой на этой странице."],
      secs:[
        ["Почему нет окна согласия", ["Homunculus не показывает рекламу. Он не использует cookie для отслеживания, рекламы или аналитики и не устанавливает сторонние cookie.",
          "В браузере хранятся только сеанс, необходимый для работы системы, и выбранные вами настройки экрана. Поэтому мы не показываем окно согласия на cookie, закрывающее экран, а вместо этого приводим здесь полный список того, что хранится."]],
        ["Что хранится в браузере", ["Ниже — всё, что Homunculus записывает в ваш браузер. Имена ключей совпадают с теми, что видны в инструментах разработчика браузера.", {store:1}]],
        ["Что не хранится", [[
          "Имя пациента, данные пациентов или клинические записи,",
          "Ваш пароль или код двухэтапной проверки,",
          "Какие экраны и когда вы открывали — это записывается только в журнал аудита на сервере,",
          "Рекламные, аналитические или отслеживающие идентификаторы."]]],
        ["Удалить мои настройки", ["Эта кнопка удаляет все настройки Homunculus в этом браузере (ключи, имя которых начинается с `hmc.`). Записи пациентов и данные на сервере не затрагиваются; настройки экрана в этом браузере возвращаются к значениям по умолчанию.", {prefs:1}]],
        ["Удаление через настройки браузера", [[
          "Те же записи можно удалить, очистив данные этого сайта в настройках браузера.",
          "Разрешения на уведомления, микрофон и камеру можно отозвать через значок замка в адресной строке.",
          "Настройки, сохранённые в режиме инкогнито, удаляются сами при закрытии окна.",
          "На общем рабочем месте в конце смены достаточно завершить сеанс; удалять настройки не обязательно."]]],
        ["Контакты", ["С вопросами об этой странице:", "{C}"]],
      ],
    },
    EN: {
      lede:"What Homunculus stores in your browser, why, and how to delete it. There are no tracking, advertising or analytics cookies.",
      keys:["**No tracking, advertising or analytics cookies,** so there is no consent pop-up covering the screen either.",
            "The browser holds only your session and the screen preferences you choose; it holds no patient data.",
            "The session is issued by the server and is deleted when you sign out or close the browser.",
            "Every stored key is listed by name in the table on this page.",
            "You can delete your preferences in one go with the button on this page."],
      secs:[
        ["Why there is no consent pop-up", ["Homunculus shows no advertising. It uses no cookies for tracking, advertising or analytics, and it sets no third-party cookies.",
          "The browser holds only the session the system needs to work and the screen preferences you choose. That is why we do not show a cookie consent pop-up over the screen; instead we list everything that is stored, in full, here."]],
        ["What is stored in your browser", ["The list below is everything Homunculus writes to your browser. The key names are the same ones you see in the browser's developer tools.", {store:1}]],
        ["What is not stored", [[
          "Patient names, patient data or clinical records,",
          "Your password or two-step verification code,",
          "Which screens you opened and when; that is kept only in the audit log on the server,",
          "Any advertising, analytics or tracking identifier."]]],
        ["Delete my preferences", ["This button deletes every Homunculus preference in this browser (keys whose names start with `hmc.`). It does not touch patient records or anything on the server; the screen settings in this browser return to their defaults.", {prefs:1}]],
        ["Deleting through browser settings", [[
          "You can remove the same entries by clearing this site's data in your browser settings.",
          "You can revoke notification, microphone and camera permissions from the lock icon in the address bar.",
          "Preferences saved in a private window are deleted automatically when the window closes.",
          "On a shared workstation it is enough to sign out at the end of your shift; you do not have to delete preferences."]]],
        ["Contact", ["For questions about this page:", "{C}"]],
      ],
    },
  };

  /* ---------- stil ---------- */
  const CSS = `
.lgl-root { position:fixed; inset:0; z-index:120; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; background:var(--app); color:var(--ink); font-family:Figtree, system-ui, sans-serif; -webkit-overflow-scrolling:touch;
  --lgl-rail:color-mix(in srgb, var(--card2) 55%, var(--app)); --lgl-bar:60px; --lgl-head:108px;
  --lgl-cols:minmax(240px, min(18vw, 330px)) minmax(0, 1fr) minmax(300px, min(22vw, 410px)); }
.lgl-root *, .lgl-root *::before, .lgl-root *::after { box-sizing:border-box; }
.lgl-root:focus { outline:none; }
.lgl-root svg { flex:none; }
.lgl-root :focus-visible { outline:2px solid var(--pri); outline-offset:2px; }
.lgl-root code { font:600 .88em "JetBrains Mono", ui-monospace, monospace; padding:1px 6px; border-radius:6px; background:var(--card2); border:1px solid var(--line); white-space:nowrap; }
/* üst çubuk + sekmeler */
.lgl-top { position:sticky; top:0; z-index:5; background:color-mix(in srgb, var(--app) 92%, transparent); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border-bottom:1px solid var(--line); }
.lgl-bar { height:var(--lgl-bar); padding:0 clamp(16px, 2.4vw, 36px); display:flex; align-items:center; gap:14px; }
.lgl-back { display:inline-flex; align-items:center; gap:4px; height:38px; padding:0 12px 0 8px; border-radius:11px; border:1px solid var(--line2); background:var(--card); color:var(--ink); font:600 13px Figtree, sans-serif; cursor:pointer; flex:none; }
.lgl-back:hover { border-color:var(--pri); }
.lgl-back svg { width:16px; height:16px; }
.lgl-brand { display:flex; align-items:center; gap:10px; min-width:0; flex:1 1 auto; }
.lgl-mk { width:34px; height:34px; flex:none; border-radius:10px; background:var(--ink); color:var(--app); display:grid; place-items:center; font:700 18px "Space Grotesk", Figtree, sans-serif; }
.lgl-bt { min-width:0; line-height:1.2; }
.lgl-bt b { display:block; font:700 14px "Space Grotesk", Figtree, sans-serif; letter-spacing:.01em; }
.lgl-bt span { display:block; font-size:12px; color:var(--mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lgl-tabs { border-top:1px solid var(--line); }
.lgl-tabs-in { display:flex; gap:2px; padding:0 clamp(16px, 2.4vw, 36px); overflow-x:auto; overflow-y:hidden; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
.lgl-tabs-in::-webkit-scrollbar { display:none; }
.lgl-tab { display:inline-flex; align-items:center; gap:8px; height:47px; padding:0 14px; margin-bottom:-1px; border:0; border-bottom:2px solid transparent; background:none; color:var(--mute); font:600 13.5px Figtree, sans-serif; white-space:nowrap; cursor:pointer; flex:none; }
.lgl-tab svg { width:16px; height:16px; }
.lgl-tab:hover { color:var(--ink); }
.lgl-tab.on { color:var(--ink); border-bottom-color:var(--pri); }
.lgl-tab.on svg { color:var(--pri); }
/* dil seçici */
.lgl-ld { position:relative; flex:none; }
.lgl-lsel { display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 10px 0 8px; border-radius:11px; border:1px solid var(--line2); background:var(--card); color:var(--ink); font:700 12.5px Figtree, sans-serif; cursor:pointer; }
.lgl-lsel:hover, .lgl-lsel[aria-expanded="true"] { border-color:var(--pri); }
.lgl-lsel .flagbox { width:22px; height:15px; }
.lgl-lsel svg { width:14px; height:14px; color:var(--mute); transition:transform .15s; }
.lgl-lsel[aria-expanded="true"] svg { transform:rotate(180deg); }
.lgl-lmenu { position:absolute; right:0; top:calc(100% + 6px); min-width:220px; padding:6px; border-radius:14px; border:1px solid var(--line2); background:var(--card); box-shadow:var(--shadow); z-index:6; }
.lgl-lmenu[hidden] { display:none; }
.lgl-lopt { width:100%; display:flex; align-items:center; gap:12px; padding:9px 10px; border:0; border-radius:9px; background:none; color:var(--ink); font:600 13px Figtree, sans-serif; text-align:left; cursor:pointer; }
.lgl-lopt:hover, .lgl-lopt:focus-visible { background:var(--card2); outline:none; }
.lgl-lopt[aria-selected="true"] { background:var(--priSoft); }
.lgl-lopt .flagbox { width:24px; height:16px; }
.lgl-lopt .lt { flex:1; display:flex; flex-direction:column; line-height:1.2; }
.lgl-lopt small { color:var(--mute); font:600 11px Figtree, sans-serif; }
.lgl-lopt svg { width:16px; height:16px; color:var(--pri); }
.lgl-tocsel { display:none; padding:8px 16px 10px; border-top:1px solid var(--line); }
.lgl-tocsel select { width:100%; max-width:100%; padding:9px 12px; border-radius:10px; border:1px solid var(--line2); background:var(--card); color:var(--ink); font:600 14px Figtree, sans-serif; }
/* kahraman şeridi */
.lgl-hero { position:relative; overflow:hidden; border-bottom:1px solid var(--line); background:
  radial-gradient(120% 140% at 88% 0%, color-mix(in srgb, var(--pri) 20%, transparent) 0%, transparent 55%),
  linear-gradient(180deg, color-mix(in srgb, var(--pri) 7%, var(--app)) 0%, var(--app) 100%); }
.lgl-hero::before { content:""; position:absolute; inset:0; background-image:radial-gradient(color-mix(in srgb, var(--mute) 22%, transparent) 1px, transparent 1.2px); background-size:22px 22px; -webkit-mask-image:linear-gradient(90deg, transparent 0%, #000 45%, #000 100%); mask-image:linear-gradient(90deg, transparent 0%, #000 45%, #000 100%); opacity:.55; pointer-events:none; }
.lgl-ecg { position:absolute; left:0; right:0; bottom:6px; height:72px; width:100%; color:var(--pri); pointer-events:none; }
.lgl-ecg .base { opacity:.2; }
.lgl-ecg .sweep { opacity:.9; filter:drop-shadow(0 0 4px color-mix(in srgb, var(--pri) 60%, transparent)); }
.lgl-ecg .scan { animation:lgl-scan 6s linear infinite; }
@keyframes lgl-scan { from { transform:translateX(-30%); } to { transform:translateX(130%); } }
.lgl-hin { position:relative; z-index:1; display:grid; grid-template-columns:var(--lgl-cols); }
.lgl-hico { justify-self:end; align-self:start; margin:30px 30px 0 0; width:72px; height:72px; border-radius:22px; display:grid; place-items:center; color:var(--pri); background:color-mix(in srgb, var(--card) 80%, transparent); border:1px solid color-mix(in srgb, var(--pri) 35%, var(--line)); box-shadow:0 0 0 8px color-mix(in srgb, var(--pri) 8%, transparent), var(--shadow); }
.lgl-hico svg { width:36px; height:36px; }
.lgl-htx { grid-column:2 / 4; padding:28px clamp(16px, 2.6vw, 40px) 88px 0; min-width:0; max-width:1100px; }
.lgl-crumb { display:flex; align-items:center; gap:6px; margin:0 0 10px; font:700 11.5px Figtree, sans-serif; letter-spacing:.08em; text-transform:uppercase; color:var(--pri); }
.lgl-crumb svg { width:13px; height:13px; }
.lgl-hero h1 { margin:0; font:700 clamp(28px, 3.3vw, 44px)/1.1 "Space Grotesk", Figtree, sans-serif; letter-spacing:-.02em; overflow-wrap:anywhere; }
.lgl-lede { margin:12px 0 0; max-width:72ch; font-size:clamp(15px, 1.25vw, 18px); line-height:1.55; color:color-mix(in srgb, var(--ink) 82%, var(--mute)); }
.lgl-meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
.lgl-chip { display:inline-flex; align-items:center; gap:6px; padding:6px 11px; border-radius:999px; border:1px solid var(--line2); background:color-mix(in srgb, var(--card) 85%, transparent); font:600 12.5px Figtree, sans-serif; color:var(--ink); }
.lgl-chip svg { width:14px; height:14px; color:var(--pri); }
/* üç sütun: içindekiler · metin · kısaca */
.lgl-grid { display:grid; grid-template-columns:var(--lgl-cols); grid-template-areas:"toc main side"; align-items:stretch; }
.lgl-left { grid-area:toc; background:var(--lgl-rail); border-right:1px solid var(--line); min-width:0; }
.lgl-main { grid-area:main; min-width:0; padding:28px clamp(16px, 2.2vw, 36px) 48px; }
.lgl-right { grid-area:side; background:var(--lgl-rail); border-left:1px solid var(--line); min-width:0; }
.lgl-toc { position:sticky; top:calc(var(--lgl-head) + 18px); max-height:calc(100vh - var(--lgl-head) - 36px); overflow-y:auto; scrollbar-width:thin; padding:26px 18px 26px clamp(16px, 2vw, 32px); }
.lgl-toc h2, .lgl-box > h2 { margin:0 0 10px; font:700 11px Figtree, sans-serif; letter-spacing:.08em; text-transform:uppercase; color:var(--mute); }
.lgl-toc ol { list-style:none; margin:0; padding:0; border-left:1px solid var(--line2); }
.lgl-toc a { display:flex; gap:9px; padding:7px 10px; margin-left:-1px; border-left:2px solid transparent; color:var(--mute); text-decoration:none; font-size:13.5px; line-height:1.35; border-radius:0 8px 8px 0; }
.lgl-toc a:hover { color:var(--ink); background:color-mix(in srgb, var(--card) 60%, transparent); }
.lgl-toc a.on { color:var(--ink); border-left-color:var(--pri); background:var(--priSoft); font-weight:600; }
.lgl-toc a i { font-style:normal; font-family:"JetBrains Mono", monospace; font-size:11.5px; color:var(--mute); padding-top:1px; }
.lgl-toc a.on i { color:var(--pri); }
.lgl-pan { position:sticky; top:calc(var(--lgl-head) + 18px); max-height:calc(100vh - var(--lgl-head) - 36px); overflow-y:auto; scrollbar-width:thin; padding:26px clamp(16px, 2vw, 32px) 26px 20px; display:grid; gap:14px; align-content:start; }
.lgl-box { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; min-width:0; }
.lgl-brief { border-color:color-mix(in srgb, var(--pri) 30%, var(--line)); box-shadow:0 0 0 3px color-mix(in srgb, var(--pri) 6%, transparent); }
.lgl-brief > h2 { display:flex; align-items:center; gap:8px; color:var(--pri) !important; }
.lgl-brief > h2 svg { width:15px; height:15px; }
.lgl-keys { list-style:none; margin:0; padding:0; counter-reset:k; display:grid; gap:10px; }
.lgl-keys li { counter-increment:k; display:grid; grid-template-columns:24px 1fr; gap:10px; font-size:13.5px; line-height:1.5; overflow-wrap:anywhere; }
.lgl-keys li::before { content:counter(k); width:24px; height:24px; border-radius:7px; display:grid; place-items:center; background:var(--priSoft); color:var(--pri); font:700 12px "JetBrains Mono", monospace; }
.lgl-dl { display:grid; gap:8px; margin:14px 0 0; padding:12px 0 0; border-top:1px solid var(--line); }
.lgl-dl > div { display:grid; grid-template-columns:18px 1fr; gap:8px; align-items:start; }
.lgl-dl svg { width:16px; height:16px; color:var(--mute); margin-top:2px; }
.lgl-dl dt { font:700 11px Figtree, sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--mute); }
.lgl-dl dd { margin:2px 0 0; font:600 13.5px/1.4 Figtree, sans-serif; overflow-wrap:anywhere; }
.lgl-dl dd small { display:block; font-weight:500; color:var(--mute); font-size:12.5px; }
.lgl-hint { margin:8px 0 0; font-size:12px; line-height:1.45; color:var(--mute); }
.lgl-help p { margin:0 0 10px; font-size:13.5px; line-height:1.5; }
.lgl-help .em { display:flex; gap:8px; align-items:flex-start; padding:9px 10px; border-radius:10px; background:var(--att); border:1px solid var(--attLine); color:var(--attInk); font:600 12.5px/1.45 Figtree, sans-serif; }
.lgl-help .em svg { width:16px; height:16px; margin-top:1px; }
.lgl-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; width:100%; margin-top:12px; padding:10px 12px; border-radius:10px; border:1px solid var(--pri); background:var(--pri); color:var(--onpri); font:700 13.5px Figtree, sans-serif; cursor:pointer; }
.lgl-btn:hover { filter:brightness(1.07); }
.lgl-btn svg { width:16px; height:16px; }
.lgl-btn.ghost { background:var(--card); color:var(--ink); border-color:var(--line2); }
.lgl-btn.ghost:hover { border-color:var(--pri); filter:none; }
.lgl-btn.danger { background:var(--crit); border-color:var(--crit); color:#fff; }
.lgl-btn.inline { width:auto; margin-top:0; }
.lgl-btn:disabled { opacity:.45; cursor:not-allowed; filter:none; }
/* bölümler */
.lgl-sec { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:22px 26px; margin-bottom:14px; scroll-margin-top:calc(var(--lgl-head) + 16px); }
.lgl-sec h2 { margin:0 0 12px; display:flex; gap:12px; align-items:baseline; font:700 19px/1.3 "Space Grotesk", Figtree, sans-serif; letter-spacing:-.005em; overflow-wrap:anywhere; }
.lgl-sec h2:focus { outline:none; }
.lgl-sec h2 i { font-style:normal; font-family:"JetBrains Mono", monospace; font-size:12px; color:var(--pri); flex:none; }
.lgl-sec h2 svg { width:18px; height:18px; vertical-align:-3px; margin-right:6px; }
.lgl-sb { min-width:0; }
.lgl-sb > :last-child { margin-bottom:0; }
.lgl-sec p, .lgl-sec li { font-size:15px; line-height:1.68; color:var(--ink); overflow-wrap:anywhere; }
.lgl-sec p { margin:0 0 12px; }
.lgl-sb > p, .lgl-sb > ul, .lgl-fa > p, .lgl-fa > ul, .lgl-sb > .lgl-ol, .lgl-fa > .lgl-ol, .lgl-note { max-width:72ch; }
.lgl-sec ul { margin:0 0 12px; padding-left:20px; }
.lgl-sec li { margin:5px 0; }
.lgl-sec li::marker { color:var(--pri); }
.lgl-sec b { font-weight:700; }
.lgl-a { color:var(--pri); font-weight:700; text-decoration:underline; text-underline-offset:3px; text-decoration-thickness:1px; cursor:pointer; }
.lgl-a:hover { text-decoration-thickness:2px; }
.lgl-sec.warn { background:var(--att); border-color:var(--attLine); box-shadow:inset 4px 0 0 var(--attLine); }
.lgl-sec.warn h2, .lgl-sec.warn h2 i { color:var(--attInk); }
.lgl-sec.warn .lgl-sb > p:first-child { font-weight:700; font-size:16px; }
.lgl-sec.warn li::marker { color:var(--attInk); }
.lgl-note { display:flex; gap:10px; align-items:flex-start; margin:0 0 12px; padding:11px 13px; border-radius:12px; background:var(--priSoft); border:1px solid color-mix(in srgb, var(--pri) 35%, transparent); font:600 13.5px/1.5 Figtree, sans-serif; }
.lgl-note svg { width:17px; height:17px; color:var(--pri); margin-top:1px; }
.lgl-call { display:flex; align-items:center; gap:12px; margin:4px 0 0; padding:12px 14px; border-radius:12px; background:var(--card2); border:1px solid var(--line2); max-width:72ch; }
.lgl-call > svg { width:20px; height:20px; color:var(--pri); }
.lgl-call b { display:block; font-size:14.5px; }
.lgl-call small { display:block; color:var(--mute); font-size:12.5px; margin-top:1px; }
.lgl-sec.warn .lgl-call { background:var(--card); }
.lgl-h3 { display:flex; align-items:center; gap:10px; margin:20px 0 10px; font:700 12px Figtree, sans-serif; letter-spacing:.07em; text-transform:uppercase; color:var(--mute); }
.lgl-h3:first-child { margin-top:2px; }
.lgl-h3::after { content:""; flex:1; height:1px; background:var(--line); }
/* tablo */
.lgl-tw { margin:0 0 12px; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.lgl-t { width:100%; border-collapse:collapse; font-size:14px; line-height:1.5; }
.lgl-t th { text-align:left; padding:10px 12px; background:var(--card2); color:var(--mute); font:700 11.5px Figtree, sans-serif; letter-spacing:.06em; text-transform:uppercase; border-bottom:1px solid var(--line); }
.lgl-t td { padding:11px 12px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
.lgl-t tr:last-child td { border-bottom:0; }
.lgl-t td:first-child { font-weight:700; width:24%; }
.lgl-t.store td:first-child { width:30%; font-weight:600; }
.lgl-t.store td:first-child code { display:inline-block; margin:0 4px 4px 0; white-space:normal; overflow-wrap:anywhere; }
.lgl-t.store td:last-child { width:22%; color:var(--mute); }
.lgl-pill { display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:999px; font:700 12px/1.3 Figtree, sans-serif; white-space:normal; }
.lgl-pill svg { width:13px; height:13px; }
.lgl-pill.ok { color:var(--ok); background:color-mix(in srgb, var(--ok) 13%, transparent); }
.lgl-pill.no { color:var(--mute); background:var(--card2); border:1px solid var(--line2); }
.lgl-pill.mk { color:var(--attInk); background:var(--att); border:1px solid var(--attLine); }
/* yapar / yapmaz: geniş ekranda karşılaştırma tablosu, dar ekranda iki liste */
.lgl-vs { width:100%; border-collapse:collapse; table-layout:fixed; font-size:14.5px; line-height:1.5; }
.lgl-vs th { text-align:left; padding:12px 14px; font:700 14px Figtree, sans-serif; border-bottom:1px solid var(--line); }
.lgl-vs th span { display:inline-grid; place-items:center; width:24px; height:24px; border-radius:7px; margin-right:8px; vertical-align:-6px; }
.lgl-vs th span svg { width:15px; height:15px; }
.lgl-vs th.vy { background:color-mix(in srgb, var(--ok) 9%, var(--card)); color:var(--ok); }
.lgl-vs th.vy span { background:color-mix(in srgb, var(--ok) 18%, transparent); }
.lgl-vs th.vn { background:color-mix(in srgb, var(--crit) 7%, var(--card)); color:var(--crit); border-left:1px solid var(--line); }
.lgl-vs th.vn span { background:var(--critSoft); }
.lgl-vs td { position:relative; padding:10px 14px 10px 40px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
.lgl-vs td + td { border-left:1px solid var(--line); }
.lgl-vs tr:last-child td { border-bottom:0; }
.lgl-vs td svg { position:absolute; left:14px; top:13px; width:16px; height:16px; }
.lgl-vs td.vy svg { color:var(--ok); } .lgl-vs td.vn svg { color:var(--crit); }
.lgl-vs td.vy { background:color-mix(in srgb, var(--ok) 3%, transparent); }
.lgl-vs td.vn { background:color-mix(in srgb, var(--crit) 3%, transparent); }
.lgl-duo { display:none; gap:12px; margin:0 0 12px; }
.lgl-duo > div { border-radius:14px; padding:14px 16px; border:1px solid var(--line); min-width:0; }
.lgl-duo .dy { background:color-mix(in srgb, var(--ok) 7%, var(--card)); border-color:color-mix(in srgb, var(--ok) 35%, var(--line)); }
.lgl-duo .dn { background:color-mix(in srgb, var(--crit) 6%, var(--card)); border-color:color-mix(in srgb, var(--crit) 32%, var(--line)); }
.lgl-duo h3 { display:flex; align-items:center; gap:8px; margin:0 0 8px; font:700 15px Figtree, sans-serif; }
.lgl-duo h3 span { width:26px; height:26px; border-radius:8px; display:grid; place-items:center; }
.lgl-duo .dy h3 span { background:color-mix(in srgb, var(--ok) 18%, transparent); color:var(--ok); }
.lgl-duo .dn h3 span { background:var(--critSoft); color:var(--crit); }
.lgl-duo h3 svg { width:16px; height:16px; }
.lgl-duo ul { list-style:none; padding:0; margin:0; }
.lgl-sec .lgl-duo li { position:relative; padding-left:22px; margin:7px 0; font-size:14px; line-height:1.5; }
.lgl-duo li svg { position:absolute; left:0; top:4px; width:15px; height:15px; }
.lgl-duo .dy li svg { color:var(--ok); } .lgl-duo .dn li svg { color:var(--crit); }
/* adımlar */
.lgl-ol { list-style:none; margin:0 0 12px; padding:0; counter-reset:s; }
.lgl-sec .lgl-ol li { counter-increment:s; position:relative; padding:0 0 12px 42px; margin:0; }
.lgl-ol li::before { content:counter(s); position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; display:grid; place-items:center; background:var(--pri); color:var(--onpri); font:700 13px "JetBrains Mono", monospace; }
.lgl-ol li:not(:last-child)::after { content:""; position:absolute; left:13.5px; top:32px; bottom:2px; width:1px; background:var(--line2); }
/* sss */
.lgl-faq { border:1px solid var(--line); border-radius:12px; margin:0 0 8px; background:var(--card); overflow:hidden; }
.lgl-faq[open] { border-color:color-mix(in srgb, var(--pri) 45%, var(--line)); box-shadow:0 0 0 3px var(--priSoft); }
.lgl-faq summary { list-style:none; display:flex; align-items:center; gap:12px; padding:13px 14px; cursor:pointer; font:700 14.5px/1.35 Figtree, sans-serif; }
.lgl-faq summary::-webkit-details-marker { display:none; }
.lgl-faq summary:hover { background:var(--card2); }
.lgl-faq summary .q { width:26px; height:26px; flex:none; border-radius:8px; display:grid; place-items:center; background:var(--priSoft); color:var(--pri); font:700 12px "JetBrains Mono", monospace; }
.lgl-faq summary span:nth-child(2) { flex:1; min-width:0; overflow-wrap:anywhere; }
.lgl-faq summary svg { width:16px; height:16px; color:var(--mute); transition:transform .15s; }
.lgl-faq[open] summary svg { transform:rotate(180deg); }
.lgl-fa { padding:2px 16px 14px 52px; }
.lgl-fa p, .lgl-fa li { font-size:14.5px; }
.lgl-fa > :last-child { margin-bottom:0; }
/* sorun bildir formu */
.lgl-form { display:grid; gap:14px; margin:4px 0 0; }
.lgl-fg { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; }
.lgl-fl { display:grid; gap:6px; min-width:0; }
.lgl-fl > span, .lgl-rad legend { font:700 13px Figtree, sans-serif; color:var(--ink); }
.lgl-fl > span small { font-weight:500; color:var(--mute); }
.lgl-form input[type=text], .lgl-form select, .lgl-form textarea { width:100%; max-width:100%; min-width:0; padding:10px 12px; border-radius:10px; border:1px solid var(--line2); background:var(--app); color:var(--ink); font:500 14.5px/1.45 Figtree, sans-serif; }
.lgl-form textarea { resize:vertical; min-height:120px; }
.lgl-form input:focus, .lgl-form select:focus, .lgl-form textarea:focus { outline:2px solid var(--pri); outline-offset:0; border-color:var(--pri); }
.lgl-rad { border:0; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:8px 10px; align-items:center; min-width:0; }
.lgl-rad legend { float:left; width:100%; margin-bottom:6px; padding:0; }
.lgl-rad label, .lgl-chk { display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:10px; border:1px solid var(--line2); background:var(--app); font:600 14px Figtree, sans-serif; cursor:pointer; }
.lgl-rad label:has(input:checked) { border-color:var(--pri); background:var(--priSoft); }
.lgl-chk { display:flex; align-items:flex-start; line-height:1.45; }
.lgl-chk input, .lgl-rad input { accent-color:var(--pri); width:17px; height:17px; flex:none; margin:1px 0 0; }
.lgl-urg { display:flex; gap:10px; align-items:flex-start; padding:11px 13px; border-radius:12px; background:var(--att); border:1px solid var(--attLine); color:var(--attInk); font:600 13.5px/1.5 Figtree, sans-serif; }
.lgl-urg[hidden], .lgl-ferr[hidden], .lgl-thx[hidden], .lgl-pconf[hidden], .lgl-form[hidden] { display:none; }
.lgl-urg svg { width:17px; height:17px; margin-top:1px; }
.lgl-urg button { margin-left:auto; flex:none; }
.lgl-ferr { margin:0; padding:9px 12px; border-radius:10px; background:var(--critSoft); color:var(--crit); font:600 13.5px Figtree, sans-serif; }
.lgl-fsub { display:flex; justify-content:flex-start; }
.lgl-fsub .lgl-btn { width:auto; min-width:220px; margin-top:0; }
.lgl-thx { display:grid; grid-template-columns:44px 1fr; gap:14px; align-items:start; padding:18px; border-radius:14px; background:color-mix(in srgb, var(--ok) 9%, var(--card)); border:1px solid color-mix(in srgb, var(--ok) 38%, var(--line)); }
.lgl-thx > span { width:44px; height:44px; border-radius:12px; display:grid; place-items:center; background:color-mix(in srgb, var(--ok) 18%, transparent); color:var(--ok); }
.lgl-thx > span svg { width:22px; height:22px; }
.lgl-thx b { display:block; font:700 16px Figtree, sans-serif; margin-bottom:4px; }
.lgl-thx p { margin:0 0 10px !important; font-size:14.5px !important; }
.lgl-thx .lgl-btn { width:auto; margin:0; }
/* tercihlerimi sil */
.lgl-prefs { display:grid; gap:12px; padding:16px; border-radius:14px; background:var(--card2); border:1px solid var(--line2); max-width:860px; }
.lgl-pc { display:flex; align-items:center; gap:10px; margin:0 !important; font:700 14.5px/1.4 Figtree, sans-serif !important; }
.lgl-pc svg { width:18px; height:18px; color:var(--pri); }
.lgl-pk { display:flex; flex-wrap:wrap; gap:6px; }
.lgl-pk code { white-space:normal; overflow-wrap:anywhere; }
.lgl-pk small { display:block; width:100%; font:700 11px Figtree, sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--mute); }
.lgl-prefs > .lgl-btn { width:auto; justify-self:start; margin:0; }
.lgl-pconf { display:grid; gap:10px; padding:13px 14px; border-radius:12px; background:var(--att); border:1px solid var(--attLine); color:var(--attInk); }
.lgl-pconf p { margin:0 !important; font:600 14px/1.5 Figtree, sans-serif !important; color:var(--attInk) !important; }
.lgl-pconf div { display:flex; flex-wrap:wrap; gap:8px; }
.lgl-pdone { display:flex; gap:10px; align-items:center; padding:10px 12px; border-radius:10px; background:color-mix(in srgb, var(--ok) 12%, var(--card)); border:1px solid color-mix(in srgb, var(--ok) 38%, var(--line)); color:var(--ink); font:600 13.5px Figtree, sans-serif; }
.lgl-pdone svg { width:17px; height:17px; color:var(--ok); }
/* alt bilgi */
.lgl-foot { border-top:1px solid var(--line); background:var(--lgl-rail); padding:32px clamp(16px, 2.4vw, 36px) 26px; }
.lgl-foot > h2 { margin:0 0 14px; font:700 11px Figtree, sans-serif; letter-spacing:.08em; text-transform:uppercase; color:var(--mute); }
.lgl-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:14px; }
.lgl-card { position:relative; display:flex; flex-direction:column; gap:10px; min-width:0; text-align:left; padding:20px; border-radius:16px; border:1px solid var(--line); background:var(--card); color:var(--ink); font:inherit; cursor:pointer; overflow:hidden; }
.lgl-card:hover { border-color:var(--pri); box-shadow:0 0 0 3px var(--priSoft); }
.lgl-card .ci { width:42px; height:42px; border-radius:12px; display:grid; place-items:center; background:var(--priSoft); color:var(--pri); }
.lgl-card .ci svg { width:21px; height:21px; }
.lgl-card b { font:700 16px/1.3 "Space Grotesk", Figtree, sans-serif; overflow-wrap:anywhere; padding-right:22px; }
.lgl-card small { color:var(--mute); font-size:13px; line-height:1.45; }
.lgl-card .go { position:absolute; right:16px; top:20px; width:18px; height:18px; color:var(--mute); }
.lgl-card:hover .go { color:var(--pri); }
.lgl-fbar { display:flex; flex-wrap:wrap; align-items:center; gap:10px 18px; margin-top:24px; padding-top:18px; border-top:1px solid var(--line); color:var(--mute); font-size:12.5px; }
.lgl-fbar b { color:var(--ink); font:700 13px "Space Grotesk", Figtree, sans-serif; }
.lgl-fbar .sp { flex:1; }
.lgl-totop { display:inline-flex; align-items:center; gap:6px; padding:7px 11px; border-radius:10px; border:1px solid var(--line2); background:var(--card); color:var(--ink); font:600 12.5px Figtree, sans-serif; cursor:pointer; }
.lgl-totop:hover { border-color:var(--pri); }
.lgl-totop svg { width:14px; height:14px; transform:rotate(180deg); }
.lgl-root { animation:lgl-in .18s ease-out; }
@keyframes lgl-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
/* çok geniş ekran: bölüm başlığı solda, metin sağda — kart sütunu doldurur, satır 72ch'de kalır */
@media (min-width:1560px) {
  .lgl-sec { display:grid; grid-template-columns:minmax(170px, 230px) minmax(0, 1fr); column-gap:clamp(24px, 2.4vw, 40px); padding:26px 30px; }
  .lgl-sec h2 { flex-direction:column; gap:6px; margin:0; align-self:start; position:sticky; top:calc(var(--lgl-head) + 22px); font-size:18px; }
  .lgl-sec p, .lgl-sec li { font-size:15.5px; }
}
/* 1100px altı: kısaca kartı metnin başına, içindekiler solda kalır */
@media (max-width:1100px) {
  .lgl-root { --lgl-cols:minmax(210px, 260px) minmax(0, 1fr); }
  .lgl-grid { grid-template-areas:"toc side" "toc main"; grid-template-rows:auto 1fr; }
  .lgl-htx { grid-column:2; }
  .lgl-hico { margin-right:24px; }
  .lgl-right { background:none; border-left:0; }
  .lgl-pan { position:static; max-height:none; overflow:visible; padding:26px clamp(16px, 2.2vw, 36px) 0; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); }
  .lgl-main { padding-top:14px; }
}
/* 820px altı: içindekiler açılır listeye, sekmeler kayar */
@media (max-width:820px) {
  .lgl-root { --lgl-bar:56px; --lgl-cols:minmax(0, 1fr); }
  .lgl-grid { grid-template-areas:"side" "main"; grid-template-rows:auto auto; }
  .lgl-left { display:none; }
  .lgl-tocsel { display:block; }
  .lgl-tab { height:44px; padding:0 12px; font-size:13px; }
  .lgl-sec { scroll-margin-top:calc(var(--lgl-head) + 64px); padding:18px; }
  .lgl-hin { padding:22px 16px 74px; gap:12px; }
  .lgl-hico { justify-self:start; margin:0; width:52px; height:52px; border-radius:15px; box-shadow:0 0 0 6px color-mix(in srgb, var(--pri) 8%, transparent); }
  .lgl-hico svg { width:26px; height:26px; }
  .lgl-htx { grid-column:1; padding:0; }
  .lgl-ecg { height:60px; bottom:4px; }
  .lgl-pan { padding:16px 16px 0; grid-template-columns:minmax(0, 1fr); }
  .lgl-help { display:none; }
  .lgl-main { padding:14px 16px 32px; }
  .lgl-cards { grid-template-columns:minmax(0, 1fr); }
  .lgl-vsw { display:none; }
  .lgl-duo { display:grid; grid-template-columns:minmax(0, 1fr); }
  .lgl-fg { grid-template-columns:minmax(0, 1fr); }
  .lgl-fsub .lgl-btn { width:100%; min-width:0; }
  .lgl-urg { flex-wrap:wrap; }
  .lgl-urg button { margin-left:27px; }
  /* tablo telefonda kart olur */
  .lgl-tw { border:0; border-radius:0; overflow:visible; }
  .lgl-t, .lgl-t tbody, .lgl-t tr, .lgl-t td { display:block; width:100% !important; }
  .lgl-t thead { display:none; }
  .lgl-t tr { border:1px solid var(--line); border-radius:12px; padding:10px 12px; margin-bottom:8px; background:var(--card2); }
  .lgl-t td, .lgl-t td:first-child { padding:3px 0; border:0; }
  .lgl-t td:first-child { font-size:15px; }
  .lgl-t td[data-h]:not(:first-child)::before { content:attr(data-h); display:block; font:700 10.5px Figtree, sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--mute); margin-top:4px; }
  .lgl-t.store td:last-child { color:var(--ink); }
  .lgl-fa { padding-left:16px; }
}
@media (max-width:460px) {
  .lgl-bar { gap:8px; padding:0 12px; }
  .lgl-back span, .lgl-bt span { display:none; }
  .lgl-back { padding:0 8px; }
  .lgl-tabs-in { padding:0 8px; }
  .lgl-tocsel { padding:8px 12px; }
  .lgl-sec { padding:16px 14px; }
  .lgl-sec h2 { font-size:17.5px; }
  .lgl-main { padding-left:12px; padding-right:12px; }
  .lgl-pan { padding-left:12px; padding-right:12px; }
  .lgl-hin { padding-left:12px; padding-right:12px; }
  .lgl-prefs { padding:13px; }
}
@media (prefers-reduced-motion:reduce) {
  .lgl-root { animation:none; }
  .lgl-ecg .scan { animation:none; display:none; }
  .lgl-lsel svg, .lgl-faq summary svg { transition:none; }
}
/* yazdır / PDF: yalnız belge basılır — üst çubuk, içindekiler, düğmeler, form basılmaz; açılır sorular açık basılır */
@media print {
  body.lgl-open > *:not(.lgl-root) { display:none !important; }
  body.lgl-open { overflow:visible !important; background:#fff !important; }
  .lgl-root { position:static !important; overflow:visible !important; animation:none !important; background:#fff !important; color:#111 !important;
    --app:#fff; --card:#fff; --card2:#f3f4f6; --ink:#111; --mute:#555; --line:#d4d4d8; --line2:#c4c4c8; --pri:#0b5cad; --priSoft:#eef4fb; --onpri:#fff;
    --att:#fff8e8; --attLine:#d8a93c; --attInk:#5c3f00; --ok:#1a7f3c; --crit:#b42318; --critSoft:#fdecea; --lgl-rail:#fff; }
  .lgl-top, .lgl-left, .lgl-help, .lgl-foot > h2, .lgl-cards, .lgl-totop, .lgl-ecg, .lgl-hico, .lgl-meta, .lgl-btn, .lgl-hint, .lgl-form, .lgl-thx, .lgl-pconf, .lgl-urg { display:none !important; }
  .lgl-hero { background:none !important; border-bottom:1px solid #ccc; }
  .lgl-hero::before { display:none; }
  .lgl-hin { display:block; padding:0; }
  .lgl-htx { padding:0 0 14px; max-width:none; }
  .lgl-grid { display:block !important; }
  .lgl-right { border:0; background:none; }
  .lgl-pan { position:static !important; max-height:none !important; overflow:visible !important; display:block; padding:14px 0 0; }
  .lgl-brief { box-shadow:none; }
  .lgl-main { padding:14px 0 0; }
  .lgl-sec { display:block !important; border:1px solid #ddd; box-shadow:none !important; break-inside:auto; padding:14px 16px; }
  .lgl-sec h2 { position:static !important; flex-direction:row !important; margin:0 0 8px !important; break-after:avoid; }
  .lgl-sb > p, .lgl-sb > ul, .lgl-fa > p, .lgl-fa > ul { max-width:none; }
  .lgl-faq { box-shadow:none !important; break-inside:avoid; }
  .lgl-faq summary svg { display:none; }
  .lgl-vsw { display:block !important; } .lgl-duo { display:none !important; }
  .lgl-t tr, .lgl-vs tr { break-inside:avoid; }
  .lgl-foot { background:none; border-top:1px solid #ccc; padding:10px 0 0; }
  .lgl-fbar { margin:0; border:0; padding:0; }
}
`;

  const ensureStyle = () => {
    let s = document.getElementById("lgl-style");
    if (s && s.textContent === CSS) return;
    if (!s) { s = document.createElement("style"); s.id = "lgl-style"; document.head.appendChild(s); }
    s.textContent = CSS;
  };

  /* ---------- çizim ---------- */
  const e = (s) => H.esc(s);
  const I = (k) => H.icon(k);
  const L = () => H.state.lang;
  const tr = (o) => (o && typeof o === "object") ? (o[L()] || o.TR) : o;
  const hosp = () => (H.data && H.data.hospital && H.data.hospital.name) || "";
  const fill = (s) => e(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[@form\|([^\]]+)\]\]/g, '<a href="#" class="lgl-a" data-lgl-toform>$1</a>')
    .replace(/\[\[([a-z]+)\|([^\]]+)\]\]/g, (m, k, t) => C[k] ? `<a href="#" class="lgl-a" data-legal="${k}">${t}</a>` : t)
    .split("{H}").join(`<b>${e(hosp())}</b>`);
  const tpl = (k, n) => H.t(k).replace("{n}", n);
  const callLine = () => `<div class="lgl-call">${I("building")}<div><b>${e(H.t("lgl_contact"))}</b><small>${e(H.t("lgl_contact_s"))}</small></div></div>`;
  const pill = (c) => {
    const m = { "+":["ok", "ok"], "-":["no", "minus"], "~":["mk", "eye"] }[c[0]];
    return m ? `<span class="lgl-pill ${m[0]}">${I(m[1])}${e(c.slice(1))}</span>` : fill(c);
  };
  const list = (a) => `<ul>${a.map(li => `<li>${fill(li)}</li>`).join("")}</ul>`;

  /* tarayıcıdaki Homunculus anahtarları (hmc.*) */
  /* Kurum ayarları kişisel tercih değildir: "Tercihlerimi sil" bunlara dokunmaz. Gerçek üründe sunucuda durur (24.09 karar). */
  const ORG_KEYS = ["hmc.roles", "hmc.social"];
  const hmcKeys = () => { try { const o = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf("hmc.") === 0) o.push(k); } return o.sort(); } catch { return []; } };
  let cleared = false;
  const prefsHtml = () => {
    const ks = hmcKeys(), n = ks.length;
    return `<div class="lgl-prefs" data-lgl-prefs>
      ${cleared ? `<div class="lgl-pdone" role="status">${I("ok")}<span>${e(H.t("lgl_p_done"))}</span></div>` : ""}
      <p class="lgl-pc">${I("tablet")}<span>${e(n ? tpl("lgl_p_count", n) : H.t("lgl_p_none"))}</span></p>
      ${n ? `<div class="lgl-pk"><small>${e(H.t("lgl_p_keys"))}</small>${ks.map(k => `<code>${e(k)}</code>`).join("")}</div>` : ""}
      <button type="button" class="lgl-btn danger" data-lgl-pdel${n ? "" : " disabled"} aria-expanded="false">${I("trash")}<span>${e(H.t("lgl_p_btn"))}</span></button>
      <div class="lgl-pconf" role="alertdialog" aria-live="assertive" hidden><p>${e(tpl("lgl_p_ask", n))}</p><div>
        <button type="button" class="lgl-btn danger inline" data-lgl-pyes>${I("trash")}<span>${e(H.t("lgl_p_yes"))}</span></button>
        <button type="button" class="lgl-btn ghost inline" data-lgl-pno>${e(H.t("lgl_p_no"))}</button></div></div>
    </div>`;
  };
  const storeHtml = () => {
    const h = STORE_H[L()] || STORE_H.TR;
    return `<div class="lgl-tw"><table class="lgl-t store"><thead><tr>${h.map(x => `<th scope="col">${e(x)}</th>`).join("")}</tr></thead><tbody>${
      STORE.map(([k, d, what]) => `<tr><td data-h="${e(h[0])}">${fill(tr(k))}</td><td data-h="${e(h[1])}">${fill(tr(what))}</td><td data-h="${e(h[2])}">${e(tr(DUR[d]))}</td></tr>`).join("")}</tbody></table></div>`;
  };
  const formHtml = () => {
    const opt = [1, 2, 3, 4, 5].map(i => `<option value="${i}">${e(H.t("lgl_f_t" + i))}</option>`).join("");
    const opt2 = `<small>· ${e(H.t("lgl_f_opt"))}</small>`;
    return `<form class="lgl-form" data-lgl-report novalidate>
        <div class="lgl-fg">
          <label class="lgl-fl"><span>${e(H.t("lgl_f_topic"))}</span><select name="topic">${opt}</select></label>
          <label class="lgl-fl"><span>${e(H.t("lgl_f_where"))} ${opt2}</span><input type="text" name="where" maxlength="80" placeholder="${e(H.t("lgl_f_where_ph"))}"></label>
          <label class="lgl-fl"><span>${e(H.t("lgl_f_bed"))} ${opt2}</span><input type="text" name="bed" maxlength="12" autocomplete="off" spellcheck="false"></label>
        </div>
        <label class="lgl-fl"><span>${e(H.t("lgl_f_what"))}</span><textarea name="what" rows="5" maxlength="2000" required placeholder="${e(H.t("lgl_f_what_ph"))}"></textarea></label>
        <fieldset class="lgl-rad"><legend>${e(H.t("lgl_f_impact"))}</legend>
          <label><input type="radio" name="impact" value="yes">${e(H.t("lgl_f_yes"))}</label>
          <label><input type="radio" name="impact" value="no" checked>${e(H.t("lgl_f_no"))}</label></fieldset>
        <div class="lgl-urg" data-lgl-urg hidden>${I("alert")}<span>${e(H.t("lgl_f_urgent"))}</span><button type="button" class="lgl-btn ghost inline" data-lgl-toem>${e(H.t("lgl_help_em_go"))}</button></div>
        <label class="lgl-chk"><input type="checkbox" name="noname"><span>${e(H.t("lgl_f_noname"))}</span></label>
        <p class="lgl-ferr" role="alert" hidden>${e(H.t("lgl_f_need"))}</p>
        <div class="lgl-fsub"><button type="submit" class="lgl-btn">${I("ok")}<span>${e(H.t("lgl_f_send"))}</span></button></div>
      </form>
      <div class="lgl-thx" role="status" tabindex="-1" hidden><span>${I("ok")}</span><div><b>${e(H.t("lgl_f_thx_h"))}</b><p>${e(H.t("lgl_f_thx_p"))}</p><button type="button" class="lgl-btn ghost" data-lgl-again>${I("plus")}<span>${e(H.t("lgl_f_again"))}</span></button></div></div>`;
  };
  const block = (it) => {
    if (typeof it === "string") return it === "{C}" ? callLine() : `<p>${fill(it)}</p>`;
    if (Array.isArray(it)) return list(it);
    if (it.tb) return `<div class="lgl-tw"><table class="lgl-t"><thead><tr>${it.tb.map(h => `<th scope="col">${e(h)}</th>`).join("")}</tr></thead><tbody>${it.rows.map(r => `<tr>${r.map((c, i) => `<td data-h="${e(it.tb[i])}">${pill(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    if (it.duo) {
      const [[hy, ay], [hn, an]] = it.duo, rows = Math.max(ay.length, an.length);
      const td = (cls, s) => s ? `<td class="${cls}">${I(cls === "vy" ? "ok" : "x")}${fill(s)}</td>` : `<td class="${cls}"></td>`;
      const table = `<div class="lgl-tw lgl-vsw"><table class="lgl-vs"><thead><tr><th scope="col" class="vy"><span>${I("ok")}</span>${e(hy)}</th><th scope="col" class="vn"><span>${I("x")}</span>${e(hn)}</th></tr></thead><tbody>${
        Array.from({ length:rows }, (_, i) => `<tr>${td("vy", ay[i])}${td("vn", an[i])}</tr>`).join("")}</tbody></table></div>`;
      const lists = `<div class="lgl-duo">${it.duo.map(([h, items], i) => { const ic = i ? "x" : "ok"; return `<div class="${i ? "dn" : "dy"}"><h3><span>${I(ic)}</span>${e(h)}</h3><ul>${items.map(li => `<li>${I(ic)}${fill(li)}</li>`).join("")}</ul></div>`; }).join("")}</div>`;
      return table + lists;
    }
    if (it.faq) return it.faq.map(([q, a], i) => `<details class="lgl-faq"><summary><span class="q">${(it.n0 || 0) + i + 1}</span><span>${e(q)}</span>${I("chevD")}</summary><div class="lgl-fa">${a.map(block).join("")}</div></details>`).join("");
    if (it.h3) return `<h3 class="lgl-h3">${e(it.h3)}</h3>`;
    if (it.ol) return `<ol class="lgl-ol">${it.ol.map(li => `<li>${fill(li)}</li>`).join("")}</ol>`;
    if (it.note) return `<div class="lgl-note">${I("clock")}<span>${fill(it.note)}</span></div>`;
    if (it.store) return storeHtml();
    if (it.prefs) return prefsHtml();
    if (it.form) return formHtml();
    return "";
  };
  const textOf = (it) => typeof it === "string" ? it : Array.isArray(it) ? it.join(" ") : it.tb ? it.tb.concat(...it.rows).join(" ") : it.duo ? it.duo.map(([h, a]) => h + " " + a.join(" ")).join(" ") : it.faq ? it.faq.map(([q, a]) => q + " " + a.map(textOf).join(" ")).join(" ") : it.ol ? it.ol.join(" ") : it.store ? STORE.map(([k, d, w]) => tr(k) + " " + tr(w)).join(" ") : it.h3 || it.note || "";
  const minutes = (doc) => Math.max(1, Math.round((doc.lede + " " + doc.secs.map(([h, b]) => h + " " + b.map(textOf).join(" ")).join(" ")).split(/\s+/).length / 200));
  const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

  /* EKG motifi: tek atım deseni yan yana döşenir (genişlikte bozulmaz), üstünden bir tarama ışığı geçer */
  const BEAT = "M0 70 H40 q8 -10 16 0 H70 l6 8 l8 -58 l8 70 l6 -20 H118 q14 -20 28 0 H200";
  const ecg = () => `<svg class="lgl-ecg" aria-hidden="true" focusable="false"><defs>
      <pattern id="lgl-beat" width="200" height="110" patternUnits="userSpaceOnUse"><path d="${BEAT}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></pattern>
      <linearGradient id="lgl-glow" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".85" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <mask id="lgl-mask"><rect class="scan" x="0" y="0" width="30%" height="100%" fill="url(#lgl-glow)"/></mask>
    </defs>
    <rect class="base" width="100%" height="100%" fill="url(#lgl-beat)"/>
    <rect class="sweep" width="100%" height="100%" fill="url(#lgl-beat)" mask="url(#lgl-mask)"/></svg>`;

  let root = null, cur = null, prevFocus = null, prevOverflow = "", langAtOpen = null, raf = 0;

  /* Destek: SSS'yi gruplar, yeni soruları ve "Sorun bildir" bölümünü yerleştirir (hukukçunun okuduğu metin olduğu gibi kalır) */
  const supportSecs = (secs, S) => {
    const out = secs.slice();
    const fi = out.findIndex(s => s[1].some(b => b && b.faq));
    if (fi >= 0) {
      const o = out[fi][1].find(b => b && b.faq).faq;
      const G = [[o[0], o[1], o[2], o[3]], [o[4], o[5], S.phone], [o[6], S.device, S.lang, S.print, o[7]].concat(o.slice(8)), [S.data, S.report]];
      let n = 0; const blocks = [];
      G.forEach((g, i) => { g = g.filter(Boolean); if (!g.length) return; blocks.push({ h3:S.groups[i] }, { faq:g, n0:n }); n += g.length; });
      out[fi] = [out[fi][0], blocks, out[fi][2]];
    }
    const ai = out.findIndex(s => s[1].some(b => b && b.ol));
    out.splice(ai >= 0 ? ai + 1 : Math.max(0, out.length - 1), 0, S.form);
    return out;
  };
  const docOf = (key) => {
    const base = C[key][L()] || C[key].TR;
    const keys = base.keys.concat((EXTRA[key] && (EXTRA[key][L()] || EXTRA[key].TR)) || []);
    const secs = key === "support" ? supportSecs(base.secs, SUP[L()] || SUP.TR) : base.secs;
    return { lede:base.lede, keys, secs };
  };

  const langMenu = () => `<div class="lgl-ld">
      <button type="button" class="lgl-lsel" data-lgl-lsel aria-haspopup="listbox" aria-expanded="false" aria-label="${e(H.t("lgl_lang"))}: ${e((H.LANGS.find(l => l[0] === H.state.lang) || ["", ""])[1])}">${H.flagBox(H.state.lang)}<b>${e(H.state.lang)}</b>${I("chevD")}</button>
      <div class="lgl-lmenu" role="listbox" aria-label="${e(H.t("lgl_lang"))}" hidden>${H.LANGS.map(([k, n]) => `<button type="button" class="lgl-lopt" role="option" data-lgl-lang="${k}" aria-selected="${H.state.lang === k}" lang="${k.toLowerCase()}">${H.flagBox(k)}<span class="lt">${e(n)}<small>${k}</small></span>${H.state.lang === k ? I("ok") : ""}</button>`).join("")}</div>
    </div>`;

  const html = (key) => {
    const doc = docOf(key), secs = doc.secs, others = KEYS.filter(k => k !== key);
    const nn = (i) => String(i + 1).padStart(2, "0");
    const toc = secs.map(([h], i) => `<li><a href="#lgl-s${i + 1}" data-lgl-go="${i + 1}"><i>${nn(i)}</i><span>${e(h)}</span></a></li>`).join("");
    const opts = secs.map(([h], i) => `<option value="${i + 1}">${i + 1}. ${e(h)}</option>`).join("");
    const cards = secs.map(([h, b, flag], i) => `<section class="lgl-sec${flag === "warn" ? " warn" : ""}" id="lgl-s${i + 1}" aria-labelledby="lgl-h${i + 1}"><h2 id="lgl-h${i + 1}"><i>${nn(i)}</i><span>${flag === "warn" ? I("alert") : ""}${e(h)}</span></h2><div class="lgl-sb">${b.map(block).join("")}</div></section>`).join("");
    const emIdx = key === "support" ? secs.findIndex(s => s[2] === "warn") + 1 : 0;
    const helpBtn = key === "support"
      ? (emIdx ? `<button type="button" class="lgl-btn ghost" data-lgl-go="${emIdx}">${I("alert")}<span>${e(H.t("lgl_help_em_go"))}</span></button>` : "")
      : `<button type="button" class="lgl-btn ghost" data-legal="support">${I("bell")}<span>${e(H.t("lgl_help_go"))}</span></button>`;
    const owner = key === "notice" ? H.t("lgl_owner_mgmt") : H.t("lgl_contact");
    const tabs = KEYS.map(k => `<button type="button" class="lgl-tab${k === key ? " on" : ""}" data-legal="${k}"${k === key ? ' aria-current="page"' : ""}>${I(ICON[k])}<span>${e(H.t("lgl_tab_" + k))}</span></button>`).join("");
    return `<header class="lgl-top">
      <div class="lgl-bar">
        <button type="button" class="lgl-back" data-lgl-close>${I("chevL")}<span>${e(H.t("lgl_back"))}</span></button>
        <div class="lgl-brand"><div class="lgl-mk" aria-hidden="true">h</div><div class="lgl-bt"><b>homunculus</b><span>${e(hosp())}</span></div></div>
        ${langMenu()}
      </div>
      <nav class="lgl-tabs" aria-label="${e(H.t("lgl_docs"))}"><div class="lgl-tabs-in">${tabs}</div></nav>
      <div class="lgl-tocsel"><select aria-label="${e(H.t("lgl_toc"))}" data-lgl-sel>${opts}</select></div>
    </header>
    <div class="lgl-hero">
      ${ecg()}
      <div class="lgl-hin">
        <div class="lgl-hico" aria-hidden="true">${I(ICON[key])}</div>
        <div class="lgl-htx">
          <p class="lgl-crumb">${I("shield")}<span>homunculus · ${e(H.t("lgl_crumb"))}</span></p>
          <h1 id="lgl-title">${e(H.t("lgl_" + key))}</h1>
          <p class="lgl-lede">${fill(doc.lede)}</p>
          <div class="lgl-meta">
            <span class="lgl-chip">${I("clock")}${e(H.t("lgl_updated"))}</span>
            <span class="lgl-chip">${I("file")}${e(tpl("lgl_secs", secs.length))}</span>
            <span class="lgl-chip">${I("eye")}${e(tpl("lgl_read", minutes(doc)))}</span>
            <span class="lgl-chip">${I("globe")}${e(H.t("lgl_langs4"))}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="lgl-grid">
      <aside class="lgl-left"><nav class="lgl-toc" aria-label="${e(H.t("lgl_toc"))}"><h2>${e(H.t("lgl_toc"))}</h2><ol>${toc}</ol></nav></aside>
      <aside class="lgl-right" aria-label="${e(H.t("lgl_brief"))}">
        <div class="lgl-pan">
          <section class="lgl-box lgl-brief"><h2>${I("zap")}${e(H.t("lgl_brief"))}</h2>
            <ol class="lgl-keys">${doc.keys.map(k => `<li><span>${fill(k)}</span></li>`).join("")}</ol>
            <dl class="lgl-dl">
              <div>${I("clock")}<div><dt>${e(H.t("lgl_upd_l"))}</dt><dd>${e(H.t("lgl_upd_v"))}</dd></div></div>
              <div>${I("building")}<div><dt>${e(H.t("lgl_owner_l"))}</dt><dd>${e(owner)}${hosp() ? `<small>${e(hosp())}</small>` : ""}</dd></div></div>
            </dl>
            <button type="button" class="lgl-btn" data-lgl-print>${I("print")}<span>${e(H.t("lgl_print"))}</span></button>
            <p class="lgl-hint">${e(H.t("lgl_print_s"))}</p>
          </section>
          <div class="lgl-box lgl-help"><h2>${e(H.t("lgl_help_h"))}</h2><p>${e(H.t("lgl_help_p"))}</p><div class="em">${I("alert")}<span>${e(H.t("lgl_help_em"))}</span></div>${helpBtn}</div>
        </div>
      </aside>
      <main class="lgl-main">${cards}</main>
    </div>
    <footer class="lgl-foot">
      <h2>${e(H.t("lgl_more"))}</h2>
      <nav class="lgl-cards" aria-label="${e(H.t("lgl_more"))}">${others.map(k => `<button type="button" class="lgl-card" data-legal="${k}"><span class="ci">${I(ICON[k])}</span><b>${e(H.t("lgl_" + k))}</b><small>${e(H.t("lgl_" + k + "_s"))}</small>${I("chevR").replace("<svg ", '<svg class="go" ')}</button>`).join("")}</nav>
      <div class="lgl-fbar"><b>homunculus</b><span>${e(hosp())}</span><span>${e(H.t("lgl_updated"))}</span><span class="sp"></span><button type="button" class="lgl-totop" data-lgl-totop>${I("chevD")}<span>${e(H.t("lgl_totop"))}</span></button></div>
    </footer>`;
  };

  /* kaydırırken etkin bölüm */
  const spy = () => {
    raf = 0; if (!root) return;
    const secs = root.querySelectorAll(".lgl-sec"); if (!secs.length) return;
    const topH = (root.querySelector(".lgl-top") || {}).offsetHeight || 0;
    const line = root.getBoundingClientRect().top + topH + 64;
    let idx = 0;
    secs.forEach((s, i) => { if (s.getBoundingClientRect().top <= line) idx = i; });
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) idx = secs.length - 1;
    const n = String(idx + 1);
    root.querySelectorAll(".lgl-toc [data-lgl-go]").forEach(a => { const on = a.dataset.lglGo === n; a.classList.toggle("on", on); if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    const sel = root.querySelector("[data-lgl-sel]"); if (sel && sel.value !== n) sel.value = n;
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(spy); };

  const goTo = (n) => {
    const s = root && root.querySelector("#lgl-s" + n); if (!s) return;
    const topH = (root.querySelector(".lgl-top") || {}).offsetHeight || 0;
    const y = root.scrollTop + s.getBoundingClientRect().top - root.getBoundingClientRect().top - topH - 14;
    root.scrollTo({ top:Math.max(0, y), behavior:reduced() ? "auto" : "smooth" });
    const h = s.querySelector("h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll:true }); }
  };
  const formSecNo = () => { const s = root && root.querySelector("[data-lgl-report]"); const sec = s && s.closest(".lgl-sec"); return sec ? sec.id.slice(5) : 0; };

  const draw = (key, keepScroll) => {
    const y = keepScroll ? root.scrollTop : 0;
    root.innerHTML = html(key);
    root.setAttribute("aria-labelledby", "lgl-title");
    root.style.setProperty("--lgl-head", ((root.querySelector(".lgl-top") || {}).offsetHeight || 108) + "px");
    root.scrollTop = y;
    const tb = root.querySelector(".lgl-tabs-in"), on = tb && tb.querySelector(".lgl-tab.on");
    if (tb && on && tb.scrollWidth > tb.clientWidth) tb.scrollLeft = Math.max(0, on.offsetLeft - (tb.clientWidth - on.offsetWidth) / 2);
    spy();
  };

  /* dil menüsü */
  const menuEl = () => root && root.querySelector(".lgl-lmenu");
  const menuOpen = () => { const m = menuEl(); return !!m && !m.hidden; };
  const setMenu = (open, focusSel) => {
    const m = menuEl(), b = root && root.querySelector("[data-lgl-lsel]"); if (!m || !b) return;
    m.hidden = !open; b.setAttribute("aria-expanded", String(open));
    if (open) { const on = m.querySelector('[aria-selected="true"]') || m.querySelector(".lgl-lopt"); if (on) on.focus(); }
    else if (focusSel) b.focus();
  };
  const setLang = (l) => {
    H.state.lang = l;
    try { localStorage.setItem("hmc.lang", l); } catch {}
    document.documentElement.lang = l.toLowerCase();
    draw(cur, true);
    const b = root.querySelector("[data-lgl-lsel]"); if (b) b.focus();
  };

  /* yazdır: açılır sorular açık basılır, sonra eski hâline döner */
  let printOpened = [];
  const beforePrint = () => { if (!root) return; printOpened = [...root.querySelectorAll("details.lgl-faq:not([open])")]; printOpened.forEach(d => { d.open = true; }); };
  const afterPrint = () => { printOpened.forEach(d => { d.open = false; }); printOpened = []; };

  /* tercihlerimi sil */
  const prefsBox = () => root && root.querySelector("[data-lgl-prefs]");
  const deletePrefs = () => {
    hmcKeys().filter(k => !ORG_KEYS.includes(k)).forEach(k => { try { localStorage.removeItem(k); } catch {} });
    try { history.replaceState(null, "", location.pathname + location.search + "#lgl-cookies-cleared"); } catch {}
    location.reload();
  };

  const onRootClick = (ev) => {
    const t = ev.target;
    if (t.closest("[data-lgl-close]")) { ev.preventDefault(); return api.close(); }
    if (t.closest("[data-lgl-lsel]")) { ev.preventDefault(); return setMenu(!menuOpen()); }
    const lg = t.closest("[data-lgl-lang]");
    if (lg) { ev.preventDefault(); return setLang(lg.dataset.lglLang); }
    if (menuOpen() && !t.closest(".lgl-lmenu")) setMenu(false);
    if (t.closest("[data-lgl-totop]")) { ev.preventDefault(); root.scrollTo({ top:0, behavior:reduced() ? "auto" : "smooth" }); root.focus({ preventScroll:true }); return; }
    if (t.closest("[data-lgl-print]")) { ev.preventDefault(); beforePrint(); try { window.print(); } catch {} return; }
    if (t.closest("[data-lgl-toform]")) { ev.preventDefault(); const n = formSecNo(); return n && goTo(n); }
    if (t.closest("[data-lgl-toem]")) { ev.preventDefault(); const w = root.querySelector(".lgl-sec.warn"); return w && goTo(w.id.slice(5)); }
    if (t.closest("[data-lgl-pdel]")) { ev.preventDefault(); const b = prefsBox(), c = b && b.querySelector(".lgl-pconf"); if (c) { c.hidden = false; t.closest("[data-lgl-pdel]").setAttribute("aria-expanded", "true"); const y = c.querySelector("[data-lgl-pno]"); if (y) y.focus(); } return; }
    if (t.closest("[data-lgl-pno]")) { ev.preventDefault(); const b = prefsBox(); if (b) { b.querySelector(".lgl-pconf").hidden = true; const d = b.querySelector("[data-lgl-pdel]"); d.setAttribute("aria-expanded", "false"); d.focus(); } return; }
    if (t.closest("[data-lgl-pyes]")) { ev.preventDefault(); return deletePrefs(); }
    if (t.closest("[data-lgl-again]")) {
      ev.preventDefault(); const f = root.querySelector("[data-lgl-report]"), x = root.querySelector(".lgl-thx");
      if (f && x) { f.reset(); f.hidden = false; x.hidden = true; const u = f.querySelector("[data-lgl-urg]"); if (u) u.hidden = true; const ta = f.querySelector("textarea"); if (ta) ta.focus(); }
      return;
    }
    const go = t.closest("[data-lgl-go]"); if (go) { ev.preventDefault(); return goTo(go.dataset.lglGo); }
  };
  const onRootInput = (ev) => {
    const f = ev.target.form; if (!f || !f.matches("[data-lgl-report]")) return;
    const er = f.querySelector(".lgl-ferr"); if (er && !er.hidden && (f.elements.what.value || "").trim() && f.elements.noname.checked) er.hidden = true;
  };
  const onRootChange = (ev) => {
    onRootInput(ev);
    if (ev.target.matches("[data-lgl-sel]")) return goTo(ev.target.value);
    if (ev.target.name === "impact") { const f = ev.target.form, u = f && f.querySelector("[data-lgl-urg]"); if (u) u.hidden = ev.target.value !== "yes"; }
  };
  /* sorun bildir: yalnız ekranda teşekkür gösterir; hiçbir yere gönderilmez, hiçbir yere yazılmaz */
  const onRootSubmit = (ev) => {
    const f = ev.target.closest("[data-lgl-report]"); if (!f) return;
    ev.preventDefault();
    const what = (f.elements.what.value || "").trim(), ok = what.length > 0 && f.elements.noname.checked;
    const er = f.querySelector(".lgl-ferr"); if (er) er.hidden = ok;
    if (!ok) { (what ? f.elements.noname : f.elements.what).focus(); return; }
    const x = root.querySelector(".lgl-thx");
    f.hidden = true; if (x) { x.hidden = false; x.focus(); }
  };

  const onKey = (ev) => {
    if (!root) return;
    if (ev.key === "Escape") {
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (menuOpen()) return setMenu(false, true);
      const c = root.querySelector(".lgl-pconf:not([hidden])"); if (c) { c.hidden = true; const d = root.querySelector("[data-lgl-pdel]"); if (d) d.focus(); return; }
      return api.close();
    }
    if (menuOpen() && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Home" || ev.key === "End")) {
      ev.preventDefault();
      const opts = [...menuEl().querySelectorAll(".lgl-lopt")], i = opts.indexOf(document.activeElement);
      const n = ev.key === "Home" ? 0 : ev.key === "End" ? opts.length - 1 : (i + (ev.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      opts[n].focus();
    }
  };
  const onFocusOut = (ev) => { if (menuOpen() && !(ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest(".lgl-ld"))) setMenu(false); };

  const api = {
    keys:KEYS.slice(),
    open(key) {
      if (!C[key]) key = "privacy";
      ensureStyle();
      if (!root) {
        prevFocus = document.activeElement;
        prevOverflow = document.body.style.overflow;
        langAtOpen = H.state.lang;
        root = document.createElement("div");
        root.className = "lgl-root";
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-modal", "true");
        root.tabIndex = -1;
        root.addEventListener("click", onRootClick);
        root.addEventListener("change", onRootChange);
        root.addEventListener("input", onRootInput);
        root.addEventListener("submit", onRootSubmit);
        root.addEventListener("focusout", onFocusOut);
        root.addEventListener("scroll", onScroll, { passive:true });
        document.body.appendChild(root);
        document.body.style.overflow = "hidden";
        document.body.classList.add("lgl-open");
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("beforeprint", beforePrint);
        window.addEventListener("afterprint", afterPrint);
      }
      cur = key;
      draw(key, false);
      root.focus({ preventScroll:true });
    },
    close() {
      if (!root) return;
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      root.remove(); root = null; cur = null; cleared = false;
      document.body.classList.remove("lgl-open");
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      document.body.style.overflow = prevOverflow;
      // dil katmanın içinde değiştiyse arkadaki ekran da o dilde yeniden çizilsin
      if (langAtOpen !== H.state.lang && typeof H.renderApp === "function") H.renderApp();
      else if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus();
      prevFocus = null;
    },
  };
  H.legal = api;

  /* belgede herhangi bir [data-legal] öğesi */
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest && ev.target.closest("[data-legal]");
    if (!a) return;
    const k = a.dataset.legal;
    if (!C[k]) return;
    ev.preventDefault();
    api.open(k);
  });

  /* Ana sayfanın altbilgi bağlantıları: ../app/#legal=<anahtar>. Sayfa açılınca o yasal sayfa açılır, adres temizlenir. */
  const HASH_ALIAS = { gizlilik:"privacy", kosullar:"terms", aydinlatma:"notice", destek:"support", cerezler:"cookies" };
  const hashKey = () => { const m = /^#(?:legal=)?([a-z]+)$/.exec(location.hash || ""); if (!m) return null; const k = HASH_ALIAS[m[1]] || m[1]; return C[k] ? k : null; };
  const openFromHash = () => { const k = hashKey(); if (!k) return; try { history.replaceState(null, "", location.pathname + location.search); } catch {} api.open(k); };
  if (hashKey()) { if (document.readyState === "complete") setTimeout(openFromHash, 0); else window.addEventListener("load", () => setTimeout(openFromHash, 0)); }
  window.addEventListener("hashchange", openFromHash);

  /* "Tercihlerimi sil" sayfayı yeniler; yenilendikten sonra Çerezler sayfası "silindi" notuyla yeniden açılır */
  if (location.hash === "#lgl-cookies-cleared") {
    try { history.replaceState(null, "", location.pathname + location.search); } catch {}
    window.addEventListener("load", () => setTimeout(() => { cleared = true; api.open("cookies"); }, 0));
  }
})();
