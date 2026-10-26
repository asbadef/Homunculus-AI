// Administration · the permission catalogue's descriptions (G1-13), by permission key.
//
// `/admin/permissions` serves `{key, description}` and the descriptions are ENGLISH DEVELOPER
// PROSE (`auth/permissions.PERMISSIONS`: "Acknowledge or snooze an alert"). They are not the
// hospital's words and they are not in the reader's language, and the roles table is the screen
// on which an administrator decides what a nurse may do — a mis-read permission there is a
// misconfiguration. So they are translated here, in four languages, keyed by the permission key
// itself: `perms.alerts.ack`, with the key's dots as nesting. A key the server serves and this
// file does not know falls back to the server's own text, marked `lang="en"` (RolesTab.jsx), and
// the roles arm's test holds this file to the catalogue so that fallback is never silently the
// rule.
//
// Twenty-one short, static sentences keyed by a stable identifier are ordinary dashboard strings,
// not product copy: the same mechanism every other string uses. The keys are NOT translated —
// `alerts.ack` is printed beside each description, because it is what a support call quotes.
// AZ/RU/EN await a native speaker's review before the pilot.
export default {
  tr: {
    board: { view: "Canlı panoyu, hasta ayrıntısını ve olay akışını görür — Aşama A açıkken «doğrulanmamış» etiketli monitör şeridini de; şerit hiçbir kurala, skora, alarma, bildirime ya da sese girmez" },
    alerts: {
      ack: "Alarmı görüldü olarak işaretler ya da erteler",
      escalate: "Elle alarm oluşturur; alarmı yükseltir",
    },
    admissions: {
      view: "Kabul ve hasta kayıtlarını okur",
      admit: "Kabul kaydı açar",
      sign_off: "Kabulü hekim olarak onaylar",
      move: { initiate: "Transfer ya da taburcu başlatır" },
      transfer: { confirm: "Transferle gelişi onaylar" },
      discharge: { confirm: "Taburcuyu onaylar; yatağı boşaltır" },
    },
    care_team: {
      claim: "Bir hastanın bakım ekibinde rol üstlenir",
      assign: "Başkalarını bir hastanın bakım ekibine atar",
    },
    handover: { sign: "Devri imzalar ya da karşı imzalar" },
    shifts: { manage: "Nöbet çizelgesi oluşturur" },
    break_glass: { use: "Acil erişim oturumu açar, uzatır ya da kapatır" },
    audit: { view: "Denetim kaydını okur" },
    users: { manage: "Kullanıcıları yönetir: oluşturma, düzenleme, etkinleştirme, şifre ve 2FA sıfırlama, dizin girişini açma, grup atama; bir kullanıcının birim ve yatak kapsamını okur, hiç ataması olmayanları sayar ve kapsam atar (atamayı yalnız kendi kapsamı rolü gereği sınırsız olan biri yapabilir); AD hesaplarını arayıp aktarır, AD grup eşlemesini okur (eşlemeyi değiştirmek her yetkiyi gerektirir)" },
    groups: { manage: "Grupları ve yetki kümelerini yönetir" },
    structure: { manage: "Kurum, tesis, birim, oda ve yatak yapılandırması" },
    devices: { manage: "Cihaz ekranını ve araştırma penceresini açar: başucu monitörlerinin trafiğinden çözülen, cihaz başına canlı değerler — DOĞRULANMAMIŞ. Aşama A bunları klinisyenlere «doğrulanmamış» etiketli bir şerit olarak gösterir; hiçbir zaman gözlem değildir ve bunlardan kural, skor, alarm, bildirim ya da denetim kaydı üretilmez. Hasta göstermez. Varsayılan olarak biyomedikal grubunda ve üreticinin destek grubunda vardır" },
    clinical: { chart: "Klinisyenin gözlemlediği girdileri (enfeksiyon şüphesi, vazopresör, sıvı, GKS…) ve hastanın kendi bazalını kaydeder" },
    scores: { sign: "Ağırlık skoru formunu (SOFA) düzeltmelerle imzalar" },

    // G2-B1a
    beds: { release: "Temizliği biten yatağı yeniden boş olarak işaretler (temizlik → boş), kendi birimlerinde" },
  },
  az: {
    board: { view: "Canlı paneli, xəstə təfərrüatını və hadisə axınını görür — Mərhələ A açıq olanda «təsdiqlənməmiş» işarəli monitor zolağını da; zolaqdan heç bir qayda, bal, siqnal, bildiriş və ya səs yaranmır" },
    alerts: {
      ack: "Siqnalı görüldü kimi işarələyir və ya təxirə salır",
      escalate: "Əl ilə siqnal yaradır; siqnalı eskalasiya edir",
    },
    admissions: {
      view: "Qəbul və xəstə qeydlərini oxuyur",
      admit: "Qəbul qeydi açır",
      sign_off: "Qəbulu həkim kimi təsdiqləyir",
      move: { initiate: "Köçürmə və ya evə yazılma başladır" },
      transfer: { confirm: "Köçürmə ilə gəlişi təsdiqləyir" },
      discharge: { confirm: "Evə yazılmanı təsdiqləyir; çarpayını boşaldır" },
    },
    care_team: {
      claim: "Bir xəstənin baxım komandasında rol götürür",
      assign: "Başqalarını xəstənin baxım komandasına təyin edir",
    },
    handover: { sign: "Təhvili imzalayır və ya qarşı imzalayır" },
    shifts: { manage: "Növbə cədvəli yaradır" },
    break_glass: { use: "Təcili giriş sessiyası açır, uzadır və ya bağlayır" },
    audit: { view: "Audit jurnalını oxuyur" },
    users: { manage: "İstifadəçiləri idarə edir: yaratma, redaktə, aktivləşdirmə, şifrə və 2FA sıfırlama, kataloq girişini açma, qrup təyin etmə; istifadəçinin şöbə və çarpayı əhatəsini oxuyur, heç bir təyinatı olmayanları sayır və əhatə təyin edir (təyin edənin öz əhatəsi də roluna görə məhdudiyyətsiz olmalıdır); AD hesablarını axtarıb idxal edir, AD qrup uyğunlaşdırmasını oxuyur (uyğunlaşdırmanı dəyişmək hər səlahiyyəti tələb edir)" },
    groups: { manage: "Qrupları və səlahiyyət dəstlərini idarə edir" },
    structure: { manage: "Təşkilat, bina, şöbə, otaq və çarpayı konfiqurasiyası" },
    devices: { manage: "Cihaz ekranını və tədqiqat pəncərəsini açır: çarpayı yanındakı monitorların trafikindən deşifrə olunan, hər cihaz üzrə canlı dəyərlər — TƏSDİQLƏNMƏMİŞ. Mərhələ A onları klinik heyətə «təsdiqlənməmiş» işarəli zolaq kimi göstərir; heç vaxt müşahidə deyil və onlardan qayda, bal, siqnal, bildiriş və ya audit qeydi yaradılmır. Xəstə göstərmir. Standart olaraq biotibbi texniklər qrupunda və istehsalçının dəstək qrupunda var" },
    clinical: { chart: "Klinisistin müşahidə etdiyi məlumatları (infeksiya şübhəsi, vazopressor, maye, QKŞ…) və xəstənin öz bazal dəyərlərini qeyd edir" },
    scores: { sign: "Ağırlıq balı formasını (SOFA) düzəlişlərlə imzalayır" },

    // G2-B1a
    beds: { release: "Təmizlənmiş çarpayını yenidən boş kimi qeyd edir (təmizlik → boş), öz şöbələrində" },
  },
  ru: {
    board: { view: "Видит живую панель, карточку пациента и ленту событий — а пока включён этап A, и блок монитора с пометкой «не валидировано», который не попадает ни в какие правила, шкалы, тревоги, уведомления или звуки" },
    alerts: {
      ack: "Принимает или откладывает тревогу",
      escalate: "Создаёт тревогу вручную; эскалирует её",
    },
    admissions: {
      view: "Читает госпитализации и записи пациентов",
      admit: "Создаёт госпитализацию",
      sign_off: "Подписывает госпитализацию как врач",
      move: { initiate: "Начинает перевод или выписку" },
      transfer: { confirm: "Подтверждает прибытие по переводу" },
      discharge: { confirm: "Подтверждает выписку; освобождает койку" },
    },
    care_team: {
      claim: "Берёт роль в лечебной команде пациента",
      assign: "Назначает других в лечебную команду пациента",
    },
    handover: { sign: "Подписывает или контрподписывает передачу смены" },
    shifts: { manage: "Составляет графики смен" },
    break_glass: { use: "Открывает, продлевает или закрывает сеанс экстренного доступа" },
    audit: { view: "Читает журнал аудита" },
    users: { manage: "Управляет пользователями: создание, изменение, активация, сброс пароля и 2FA, открытие входа через каталог, назначение групп; читает область отделений и коек пользователя, считает пользователей без назначений и назначает область (назначать может только тот, чья собственная область не ограничена в силу его роли); ищет и импортирует записи AD, читает сопоставление групп AD (изменение сопоставления требует всех прав)" },
    groups: { manage: "Управляет группами и их наборами прав" },
    structure: { manage: "Настройка организации, корпусов, отделений, палат и коек" },
    devices: { manage: "Открывает экран устройств и окно исследования: значения по каждому устройству в реальном времени, декодированные из трафика прикроватных мониторов, — НЕ ВАЛИДИРОВАНЫ. На этапе A они показываются клиницистам как блок с пометкой «не валидировано»; это никогда не наблюдение, и из них не создаются ни правила, ни шкалы, ни тревоги, ни уведомления, ни записи аудита. Пациентов не показывает. По умолчанию это право есть у группы биомедицинских техников и у группы поддержки производителя" },
    clinical: { chart: "Вносит наблюдения клинициста (подозрение на инфекцию, вазопрессор, инфузии, ШКГ…) и собственную базовую линию пациента" },
    scores: { sign: "Подписывает форму оценки тяжести (SOFA) с исправлениями" },

    // G2-B1a
    beds: { release: "Отмечает убранную койку снова свободной (уборка → свободна) в своих отделениях" },
  },
  en: {
    board: { view: "See the live board, a patient's detail and the event stream — and, while Stage A is on, the monitor strip labelled unvalidated, which feeds no rule, score, alert, notification or sound" },
    alerts: {
      ack: "Acknowledge or snooze an alarm",
      escalate: "Create an alarm by hand; escalate one",
    },
    admissions: {
      view: "Read admissions and patient records",
      admit: "Create an admission",
      sign_off: "Sign off an admission as a physician",
      move: { initiate: "Initiate a transfer or a discharge" },
      transfer: { confirm: "Confirm a transfer arrival" },
      discharge: { confirm: "Confirm a discharge and release the bed" },
    },
    care_team: {
      claim: "Claim a care-team role on a patient",
      assign: "Assign others to a patient's care team",
    },
    handover: { sign: "Sign or countersign a handover" },
    shifts: { manage: "Create shift schedules" },
    break_glass: { use: "Open, extend or close an emergency-access session" },
    audit: { view: "Read the audit trail" },
    users: { manage: "Manage users: create, edit, activate, reset a password or 2FA, lift a directory sign-in throttle, set groups; read a user's unit and bed scope, count the users with none, and assign one (only someone whose own scope is unrestricted by role may assign it); search and import AD accounts and read the AD group mapping (changing the mapping needs every permission)" },
    groups: { manage: "Manage groups and their permission sets" },
    structure: { manage: "Configure the tenant, sites, units, rooms and beds" },
    devices: { manage: "Open the device screen and the research window: live per-device values decoded from bedside-monitor traffic — UNVALIDATED. Stage A shows them to clinicians as a strip labelled unvalidated; they are never an observation, and no rule, score, alert, notification or audit row is made from them. Shows no patient. By default the biomedical group and the vendor's support group hold it" },
    clinical: { chart: "Chart clinician-observed inputs (suspected infection, pressor, fluids, GCS…) and the patient's own baseline" },
    scores: { sign: "Sign a severity-score form (SOFA) with corrections" },

    // G2-B1a
    beds: { release: "Mark a cleaned bed free again (housekeeping → available), in their own units" },
  },
};
