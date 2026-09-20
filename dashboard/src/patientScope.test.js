/**
 * Kim hangi hastayı görür.
 *
 * Yönetici ekranındaki atama matrisi (`staffAssignments`) yıllardır oradaydı ve hiçbir panoyu
 * etkilemiyordu: hekim, hemşire, eczacı ve biyomedikal aynı hasta listesini görüyordu. Bu
 * testler matrisi panoya bağlayan kuralları sabitler — özellikle de kısıtlamanın **nerede
 * durduğunu**: kendi hastası kapsam dışında olsa bile görünür, atama yoksa liste kapatılmaz.
 */
import { describe, it, expect } from "vitest";
import {
  scopeForUser, visibleBeds, visiblePatients, visibleUnits, visibleAlerts,
  ownPatientIds, SCOPE_REASON,
} from "./patientScope.js";

const ROLE = { ATTENDING: "ATTENDING", HOSPITAL_ADMIN: "HOSPITAL_ADMIN", BIOMEDICAL: "BIOMEDICAL" };
const UNRESTRICTED = [ROLE.HOSPITAL_ADMIN, ROLE.BIOMEDICAL];

function world(overrides = {}) {
  return {
    user: { email: "dr@x.health", role: ROLE.ATTENDING },
    users: [
      { id: "u-01", email: "dr@x.health", role: ROLE.ATTENDING },
      { id: "u-09", email: "other@x.health", role: ROLE.ATTENDING },
    ],
    structure: { units: [{ id: "unit-adult", name: "Erişkin" }, { id: "unit-nicu", name: "Yenidoğan" }] },
    beds: [
      { id: "bed-a1", unitId: "unit-adult", patientId: "P-1" },
      { id: "bed-a2", unitId: "unit-adult", patientId: "P-2" },
      { id: "bed-n1", unitId: "unit-nicu", patientId: "P-3" },
      { id: "bed-n2", unitId: "unit-nicu", patientId: null },
    ],
    patients: [
      { patient_id: "P-1", bedId: "bed-a1" },
      { patient_id: "P-2", bedId: "bed-a2" },
      { patient_id: "P-3", bedId: "bed-n1" },
    ],
    alerts: [
      { id: "A-1", patientId: "P-1", status: "FIRED" },
      { id: "A-3", patientId: "P-3", status: "FIRED" },
    ],
    careTeam: {},
    staffAssignments: {},
    clockSec: 100,
    breakGlass: null,
    ...overrides,
  };
}

describe("kapsam nasıl hesaplanır", () => {
  it("ünite ataması o ünitenin yataklarını verir", () => {
    const st = world({ staffAssignments: { "u-01": { unitIds: ["unit-adult"], bedIds: [] } } });
    const scope = scopeForUser(st, UNRESTRICTED);
    expect(scope.unrestricted).toBe(false);
    expect(visibleBeds(st, scope).map((b) => b.id)).toEqual(["bed-a1", "bed-a2"]);
    expect(visibleUnits(st, scope).map((u) => u.id)).toEqual(["unit-adult"]);
  });

  it("yatak ataması yalnız o yatakları verir", () => {
    const st = world({ staffAssignments: { "u-01": { unitIds: [], bedIds: ["bed-n1"] } } });
    const scope = scopeForUser(st, UNRESTRICTED);
    expect(visibleBeds(st, scope).map((b) => b.id)).toEqual(["bed-n1"]);
  });

  it("kendi hastası kapsam dışındaki yatakta olsa da görünür", () => {
    const st = world({
      staffAssignments: { "u-01": { unitIds: ["unit-adult"], bedIds: [] } },
      careTeam: { "P-3": { attendingId: "u-01", nurseId: null } },
    });
    const scope = scopeForUser(st, UNRESTRICTED);
    expect(ownPatientIds(st)).toEqual(["P-3"]);
    expect(visibleBeds(st, scope).map((b) => b.id)).toContain("bed-n1");
    expect(visiblePatients(st, scope).map((p) => p.patient_id)).toContain("P-3");
  });

  it("başkasının hastası kapsam dışındaysa görünmez", () => {
    const st = world({
      staffAssignments: { "u-01": { unitIds: ["unit-adult"], bedIds: [] } },
      careTeam: { "P-3": { attendingId: "u-09", nurseId: null } },
    });
    const scope = scopeForUser(st, UNRESTRICTED);
    expect(visiblePatients(st, scope).map((p) => p.patient_id)).not.toContain("P-3");
  });

  it("alarmlar da kapsamla süzülür", () => {
    const st = world({ staffAssignments: { "u-01": { unitIds: ["unit-adult"], bedIds: [] } } });
    const scope = scopeForUser(st, UNRESTRICTED);
    expect(visibleAlerts(st, scope).map((a) => a.id)).toEqual(["A-1"]);
  });
});

describe("kısıtlamanın durduğu yerler", () => {
  it("atama yoksa liste kapatılmaz ama sebebi 'atanmamış' olur", () => {
    const st = world();
    const scope = scopeForUser(st, UNRESTRICTED);
    expect(scope.unrestricted).toBe(true);
    expect(scope.reason).toBe(SCOPE_REASON.NO_ASSIGNMENT);
    expect(visibleBeds(st, scope)).toHaveLength(4);
  });

  it("yönetici kısıtlanmaz ve sebebi roldür", () => {
    const st = world({ user: { email: "admin@x.health", role: ROLE.HOSPITAL_ADMIN } });
    const scope = scopeForUser(st, UNRESTRICTED);
    expect(scope).toMatchObject({ unrestricted: true, reason: SCOPE_REASON.UNRESTRICTED_ROLE });
  });

  it("break-glass kapsamı geçici açar ve sebebi ayrı görünür", () => {
    const st = world({
      staffAssignments: { "u-01": { unitIds: ["unit-adult"], bedIds: [] } },
      breakGlass: { active: true, until: 500, reason: "acil konsültasyon" },
    });
    const scope = scopeForUser(st, UNRESTRICTED);
    expect(scope).toMatchObject({ unrestricted: true, reason: SCOPE_REASON.BREAK_GLASS });
    expect(visibleBeds(st, scope)).toHaveLength(4);
  });

  it("süresi dolmuş break-glass kapsamı açmaz", () => {
    const st = world({
      staffAssignments: { "u-01": { unitIds: ["unit-adult"], bedIds: [] } },
      breakGlass: { active: true, until: 50, reason: "bitti" },
      clockSec: 100,
    });
    expect(scopeForUser(st, UNRESTRICTED).unrestricted).toBe(false);
  });

  it("yataksız (HBYS'den bekleyen) hasta kapsam dışında sayılmaz", () => {
    const st = world({
      staffAssignments: { "u-01": { unitIds: ["unit-adult"], bedIds: [] } },
      patients: [...world().patients, { patient_id: "P-9", bedId: null, source: "comed" }],
    });
    const scope = scopeForUser(st, UNRESTRICTED);
    expect(visiblePatients(st, scope).map((p) => p.patient_id)).toContain("P-9");
  });
});
