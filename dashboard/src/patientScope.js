// src/patientScope.js — kim hangi hastayı görür.
//
// 20.09.2026'da ölçüldü: pano `state.beds`'in tamamını çiziyordu. Hekim, hemşire, eczacı,
// biyomedikal ve yönetici aynı hasta listesini görüyordu. Oysa yönetici ekranında **yıllardır
// bir atama matrisi vardı** (`staffAssignments`: userId → {bedIds, unitIds}), yönetici oradan
// atama yapıyordu ve bu atama hiçbir ekranı etkilemiyordu — bu projenin kendi adını koyduğu
// hatanın sekizinci örneği: yazıldı, test edildi, bağlanmadı.
//
// Buradaki kurallar o matrisi panoya bağlar:
//
//   1. **Atama varsa kapsam odur.** Ünite ataması o ünitenin tüm yataklarını, yatak ataması
//      yalnız o yatakları verir.
//   2. **Kendi hastası her zaman görünür.** Bakım ekibinde adı geçen hekim/hemşire, hasta
//      kapsamının dışındaki bir yatakta olsa da onu görür — konsültasyon ve devir gerçektir,
//      ve sistem kendi kayıt ettiği ekiple çelişemez.
//   3. **Atama yoksa kapsam kısıtlanmaz — ama bu söylenir.** Boş bir pano, kullanılamaz bir
//      panodur; sessizce tam erişim ise KVKK'da savunulamaz. Üçüncü yol: her şeyi göster ve
//      ekranda "kapsam atanmamış" de, ki yöneticinin yapacak bir işi olduğu görünsün.
//   4. **Yönetici ve biyomedikal kısıtlanmaz.** Biri kurumu yönetir, diğeri cihaz envanterini;
//      ikisi de yatak listesine bakar. (Biyomedikalin hasta *adını* görmemesi ayrı bir iş.)
//   5. **Break-glass kapsamı geçici olarak açar.** Gerekçesi zorunlu ve denetime düşüyor.
//
// 21.09.2026 · Motor tarafı yazıldı (`homunculus/scope/`) ve pano artık **süzülmüş** geliyor;
// `/patients` cevabı yanında `scope` bloğunu da taşıyor. İki şey değişti:
//
//   • **Canlıda kapsamı motor uygular, bu dosya değil.** Aşağıdaki yerel kurallar yalnız
//     simülasyonda çalışır. Sebebi ölçüldü: canlı modda `bedsFromPatients` yatakları
//     `unitId: null` ve `live-bed-<pid>` kimliğiyle üretiyor — yani ünite ataması canlı bir
//     yatakla hiçbir zaman eşleşemiyordu. Bu süzgeç canlıda yıllardır **boşa çalışıyordu**;
//     "atama yok" yoluna düşüp her şeyi gösteriyordu.
//   • **Motor süzdüyse bir daha süzülmez.** İkinci bir süzgeç, eşleşmeyen yerel kimliklerle
//     panoyu tamamen boşaltırdı. Liste zaten kapsamın kendisidir; bu dosyanın canlıdaki işi
//     süzmek değil, **ekranın neden bu boyutta olduğunu söylemek**.
//
// ⚠️ Yerel yol hâlâ ekran kapsamıdır ve tek başına bir yetki kontrolü değildir.

export const SCOPE_REASON = {
  UNRESTRICTED_ROLE: "role",        // yönetici / biyomedikal
  NO_ASSIGNMENT: "unassigned",      // atama yapılmamış
  BREAK_GLASS: "break_glass",       // geçici acil erişim
  ASSIGNED: "assigned",             // gerçek kapsam
  TENANT_TOKEN: "tenant_token",     // makine kimliği (köprü, duvar ekranı)
  UNKNOWN: "unknown",               // motor kapsamı çözemedi — hiçbir şey gösterilmez
};

/**
 * Motorun uyguladığı kapsam, panonun yanında geldiği hâliyle.
 *
 * `unrestricted: true` burada "kısıt yok" demek **değil**; "kısıt zaten uygulandı, bu listeyi
 * bir daha süzme" demek. Ayrımı `serverEnforced` taşıyor ve bildirimi o belirliyor.
 */
function serverScope(state) {
  const s = state?.engineScope;
  if (!s) return null;
  return {
    unrestricted: true,
    serverEnforced: true,
    reason: s.reason || SCOPE_REASON.ASSIGNED,
    blind: Boolean(s.blind),
    note: state.scopeNote || null,
    unitIds: Array.isArray(s.unit_ids) ? s.unit_ids : [],
    bedIds: Array.isArray(s.bed_ids) ? s.bed_ids : [],
  };
}

/** Oturumdaki kullanıcının kayıt satırı (state.user yalnız e-posta/rol taşıyor). */
export function currentStaff(state) {
  const email = state?.user?.email;
  if (!email) return null;
  return (state.users || []).find((u) => u.email === email) || null;
}

function breakGlassActive(state) {
  const bg = state?.breakGlass;
  if (!bg) return false;
  if (bg.active === false) return false;
  if (typeof bg.until === "number" && typeof state.clockSec === "number") return bg.until > state.clockSec;
  return Boolean(bg.active || bg.reason);
}

/**
 * Kapsam tanımı. `unrestricted` true ise yatak süzmesi uygulanmaz.
 *
 * `reason` ekranın ne yazacağını belirler: kısıtsızlığın sebebi rol mü, atama eksikliği mi,
 * yoksa break-glass mı — üçü aynı görünmemeli.
 */
export function scopeForUser(state, unrestrictedRoles = []) {
  // Motor konuştuysa son söz onundur — iki kapsam tanımı, iki farklı cevap demektir ve bu
  // ekrandaki NEWS2 hatasının (tek isim, iki hesap) aynısı olurdu.
  const fromServer = serverScope(state);
  if (fromServer) return fromServer;

  const role = state?.user?.role;
  if (unrestrictedRoles.includes(role)) {
    return { unrestricted: true, reason: SCOPE_REASON.UNRESTRICTED_ROLE, unitIds: [], bedIds: [] };
  }
  if (breakGlassActive(state)) {
    return { unrestricted: true, reason: SCOPE_REASON.BREAK_GLASS, unitIds: [], bedIds: [] };
  }
  const me = currentStaff(state);
  const a = me ? (state.staffAssignments || {})[me.id] : null;
  const unitIds = a?.unitIds || [];
  const bedIds = a?.bedIds || [];
  if (unitIds.length === 0 && bedIds.length === 0) {
    return { unrestricted: true, reason: SCOPE_REASON.NO_ASSIGNMENT, unitIds: [], bedIds: [] };
  }
  return { unrestricted: false, reason: SCOPE_REASON.ASSIGNED, unitIds, bedIds };
}

/** Bakım ekibinde bu kullanıcının adı geçen hastaların id'leri. */
export function ownPatientIds(state) {
  const me = currentStaff(state);
  if (!me) return [];
  const team = state.careTeam || {};
  return Object.keys(team).filter((pid) => team[pid]?.attendingId === me.id || team[pid]?.nurseId === me.id);
}

/** Kapsamdaki yataklar. Kısıtsızsa liste aynen döner (kopya değil, aynı dizi). */
export function visibleBeds(state, scope) {
  const beds = state?.beds || [];
  if (!scope || scope.unrestricted) return beds;
  const own = new Set(ownPatientIds(state));
  return beds.filter((b) =>
    scope.unitIds.includes(b.unitId)
    || scope.bedIds.includes(b.id)
    || (b.patientId && own.has(b.patientId)));
}

/** Kapsamdaki hastalar — yataksız (HBYS'den bekleyen) hastalar da kapsamın dışında kalmaz. */
export function visiblePatients(state, scope) {
  const patients = state?.patients || [];
  if (!scope || scope.unrestricted) return patients;
  const bedIds = new Set(visibleBeds(state, scope).map((b) => b.id));
  const own = new Set(ownPatientIds(state));
  return patients.filter((p) => own.has(p.patient_id) || (p.bedId ? bedIds.has(p.bedId) : true));
}

/** Kapsamdaki üniteler — sekme listesi bundan üretilir; görünmeyen sekmeye basılamaz. */
export function visibleUnits(state, scope) {
  const units = state?.structure?.units || [];
  if (!scope || scope.unrestricted) return units;
  const fromBeds = new Set(visibleBeds(state, scope).map((b) => b.unitId));
  return units.filter((u) => scope.unitIds.includes(u.id) || fromBeds.has(u.id));
}

/** Kapsamdaki hastaların alarmları. */
export function visibleAlerts(state, scope) {
  const alerts = state?.alerts || [];
  if (!scope || scope.unrestricted) return alerts;
  const ids = new Set(visiblePatients(state, scope).map((p) => p.patient_id));
  return alerts.filter((a) => ids.has(a.patientId));
}
