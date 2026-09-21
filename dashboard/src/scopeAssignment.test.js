/**
 * Kapsam ataması motora ulaşıyor mu.
 *
 * Bu dosyanın var olma sebebi tek bir cümle: yönetici ekranındaki personel-yatak matrisi
 * yıllardır **yalnız tarayıcıya** yazıyordu. 21.09.2026'da ekran onu okumaya başladı, motor
 * tarafı da yazıldı — ama atama motora gitmezse `staff_scopes` tablosu sonsuza kadar boş kalır
 * ve yazılan her şey ölü doğar. Testler bu halkayı tutar.
 */
import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";

function baseStore(initial = {}) {
  let state = { staffAssignments: {}, patients: [], beds: [], alerts: [], clockSec: 0, ...initial };
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    assignStaffToBeds({ userId, bedIds, unitIds }) {
      const next = { bedIds: bedIds || [], unitIds: unitIds || [] };
      state = { ...state, staffAssignments: { ...state.staffAssignments, [userId]: next } };
      return next;
    },
  };
}

function api(overrides = {}) {
  return {
    setScope: vi.fn(async () => ({ user_id: "u-1", unrestricted: false, reason: "assigned" })),
    boardPatients: vi.fn(async () => ({ patients: [], scope: null, scope_note: null })),
    unassignedScopes: vi.fn(async () => ({ tenant: "demo", unassigned_users: 3 })),
    accessToken: () => null,
    logout: vi.fn(),
    ...overrides,
  };
}

describe("kapsam ataması", () => {
  it("üniteyi ve yatakları motora ayrı ayrı gönderir", async () => {
    const a = api();
    const store = createLiveStore({ base: baseStore(), api: a });

    await store.assignStaffToBeds({ userId: "u-1", bedIds: ["bed-a1"], unitIds: ["unit-adult"] });

    expect(a.setScope).toHaveBeenCalledWith("u-1", [
      { unit_id: "unit-adult" },
      { bed_id: "bed-a1" },
    ]);
  });

  it("tek hücre tıklaması da aynı yoldan motora gider", async () => {
    const a = api();
    const base = baseStore({ staffAssignments: { "u-1": { bedIds: [], unitIds: [] } } });
    const store = createLiveStore({ base, api: a });

    await store.toggleStaffBed({ userId: "u-1", bedId: "bed-a2" });

    expect(a.setScope).toHaveBeenCalledWith("u-1", [{ bed_id: "bed-a2" }]);
  });

  it("işaretli bir hücreyi kaldırmak motora da yansır", async () => {
    const a = api();
    const base = baseStore({ staffAssignments: { "u-1": { bedIds: ["bed-a2"], unitIds: [] } } });
    const store = createLiveStore({ base, api: a });

    await store.toggleStaffBed({ userId: "u-1", bedId: "bed-a2" });

    expect(a.setScope).toHaveBeenCalledWith("u-1", []);
  });

  it("motor reddederse yerel matris geri alınır — 'kaydedildi' görüntüsü bırakmaz", async () => {
    const a = api({ setScope: vi.fn(async () => { throw new Error("403"); }) });
    const base = baseStore({ staffAssignments: { "u-1": { bedIds: ["bed-a1"], unitIds: [] } } });
    const store = createLiveStore({ base, api: a });

    await expect(
      store.assignStaffToBeds({ userId: "u-1", bedIds: ["bed-a1", "bed-a9"], unitIds: [] }),
    ).rejects.toThrow();

    expect(base.getState().staffAssignments["u-1"].bedIds).toEqual(["bed-a1"]);
  });

  it("atanmamış kullanıcı sayısı motordan okunur", async () => {
    const a = api();
    const store = createLiveStore({ base: baseStore(), api: a });
    expect((await store.unassignedScopes()).unassigned_users).toBe(3);
  });
});

describe("panonun taşıdığı kapsam bloğu", () => {
  it("motorun kapsamı ve notu duruma yazılır", async () => {
    const a = api({
      boardPatients: vi.fn(async () => ({
        patients: [],
        scope: { reason: "assigned", unrestricted: false, blind: true, unit_ids: ["unit-yok"], bed_ids: [] },
        scope_note: "Kapsamınızda panoda karşılığı olan hiçbir yatak yok",
      })),
    });
    const store = createLiveStore({ base: baseStore(), api: a });

    await store.refreshBoard();

    expect(store.getState().engineScope.blind).toBe(true);
    expect(store.getState().scopeNote).toMatch(/hiçbir yatak yok/);
  });

  it("istek başarısız olursa kapsam da düşer — eski kapsam boş panoyu açıklamaz", async () => {
    const a = api({ boardPatients: vi.fn(async () => { throw new Error("offline"); }) });
    const store = createLiveStore({ base: baseStore(), api: a });

    await store.refreshBoard();

    expect(store.getState().engineScope).toBeNull();
    expect(store.getState().scopeNote).toBeNull();
  });
});
