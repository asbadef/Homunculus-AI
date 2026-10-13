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
    board: { view: "Canlı panoyu, hasta ayrıntısını ve olay akışını görür" },
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
    devices: { manage: "Cihaz araştırma penceresini salt okunur açar: araştırma sunucusunun başucu monitörlerinin trafiğinden çözdüğü, cihaz başına canlı değerler — çözümlemeyi denetlemek içindir, klinik gözlem değildir ve klinik kurallar bunları hiç okumaz. Varsayılan olarak biyomedikal grubunda ve üreticinin destek grubunda vardır" },
    clinical: { chart: "Klinisyenin gözlemlediği girdileri (enfeksiyon şüphesi, vazopresör, sıvı, GKS…) ve hastanın kendi bazalını kaydeder" },
    scores: { sign: "Ağırlık skoru formunu (SOFA) düzeltmelerle imzalar" },
  },
  az: {
    board: { view: "Canlı paneli, xəstə təfərrüatını və hadisə axınını görür" },
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
    devices: { manage: "Cihaz tədqiqat pəncərəsini yalnız oxumaq üçün açır: tədqiqat serverinin çarpayı yanındakı monitorların trafikindən deşifrə etdiyi, hər cihaz üzrə canlı dəyərlər — deşifrəni yoxlamaq üçündür, klinik müşahidə deyil və klinik qaydalar onları heç vaxt oxumur. Standart olaraq biotibbi texniklər qrupunda və istehsalçının dəstək qrupunda var" },
    clinical: { chart: "Klinisistin müşahidə etdiyi məlumatları (infeksiya şübhəsi, vazopressor, maye, QKŞ…) və xəstənin öz bazal dəyərlərini qeyd edir" },
    scores: { sign: "Ağırlıq balı formasını (SOFA) düzəlişlərlə imzalayır" },
  },
  ru: {
    board: { view: "Видит живую панель, карточку пациента и ленту событий" },
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
    devices: { manage: "Открывает окно исследования устройств, только для чтения: значения по каждому устройству, которые исследовательский сервер в реальном времени декодирует из трафика прикроватных мониторов, — для проверки декодирования, а не клинические наблюдения; клинические правила их никогда не читают. По умолчанию это право есть у группы биомедицинских техников и у группы поддержки производителя" },
    clinical: { chart: "Вносит наблюдения клинициста (подозрение на инфекцию, вазопрессор, инфузии, ШКГ…) и собственную базовую линию пациента" },
    scores: { sign: "Подписывает форму оценки тяжести (SOFA) с исправлениями" },
  },
  en: {
    board: { view: "See the live board, a patient's detail and the event stream" },
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
    devices: { manage: "Open the read-only device research window: live per-device values the research hub decodes from bedside-monitor traffic — for checking the decoding, not clinical observations, and never read by the clinical rules. By default the biomedical group and the vendor's support group hold it" },
    clinical: { chart: "Chart clinician-observed inputs (suspected infection, pressor, fluids, GCS…) and the patient's own baseline" },
    scores: { sign: "Sign a severity-score form (SOFA) with corrections" },
  },
};
