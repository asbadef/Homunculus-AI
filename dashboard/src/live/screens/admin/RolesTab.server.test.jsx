// The group × permission table against a server that HAS STATE (G1-13).
//
// Mounted through the real `AdminScreen` + `useAdminData`, so a reload really re-reads, and the
// fake server below behaves like `admin/service.update_group`: the body's list REPLACES the set,
// and — as the plan's Task 14e will make the real one do — a body carrying `expected_permissions`
// that differs from what the server holds is refused with 409 `concurrentChange` and writes
// nothing. A body without it is taken as before (today's server ignores the field).
//
// These are the review's proofs (P1, P2, P6, P7, P8), kept as regression tests: each asserts what
// the administrator SEES after the server has answered and the column has been re-read — never only
// that a reload was asked for. Synthetic groups only (admin.testutil.js).
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import perms from "../../i18n/strings/perms.js";
import { PERMISSION_KEYS } from "./catalogue.js";
import { ADMIN_READS, GROUPS, NURSE_GROUP, WARD_GROUP } from "./admin.testutil.js";
import { AdminScreen, onlyTabs, resetTabs } from "./AdminScreen.jsx";
import { RolesTab } from "./RolesTab.jsx";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const AZ = perms.az;
const PENDING = "dəyişiklik gözləyir";
const CONCURRENT = "Kayıt aynı anda değiştirildi; lütfen tekrar deneyin";
const sorted = (list) => [...list].sort();
const cell = (groupName, description) => screen.getByRole("checkbox", {
  name: (name) => name === `${groupName} · ${description}` || name === `${groupName} · ${description} · ${PENDING}`,
});
const column = (name) => screen.getByRole("columnheader", { name });
const alerts = () => screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
const notes = () => screen.queryAllByRole("note").map((n) => n.textContent).join(" ");
const unavailable = () => Object.assign(new Error("Service Unavailable"), { status: 503 });

async function saveIn(name) {
  await act(async () => {
    fireEvent.click(within(column(name)).getByRole("button", { name: "Yadda saxla" }));
    await settle(); await settle(); await settle();
  });
}

afterEach(() => {
  resetTabs();
  vi.restoreAllMocks();
});

/** The screen, on a server with state. `hold` keeps every PATCH open until its gate is released. */
async function openLive({ desk = [...PERMISSION_KEYS], groups = GROUPS, hold = false } = {}) {
  // The subject is the roles tab, so the build's tabs are pinned (Decision 21): with the users tab
  // built too, the frame would open on that one.
  onlyTabs({ roles: RolesTab });
  const state = { groups: groups.map((g) => ({ ...g, permissions: [...g.permissions] })) };
  const copy = (g) => ({ ...g, permissions: [...g.permissions] });
  const gates = [];
  const patches = [];
  const mounted = await mount(<AdminScreen />, {
    access: token({ sub: "u-admin", perms: desk }),
    me: profile({ id: "u-admin", perms: desk }),
    setup: (api) => {
      ADMIN_READS(api);
      api.adminGroups.mockImplementation(async () => state.groups.map(copy));
      api.adminUpdateGroup.mockImplementation(async (id, body) => {
        patches.push({ id, body });
        if (hold) await new Promise((resolve) => { gates.push(resolve); });
        const held = state.groups.find((g) => g.id === id);
        if (Array.isArray(body.expected_permissions)
            && sorted(new Set(body.expected_permissions)).join() !== sorted(new Set(held.permissions)).join()) {
          throw refusal(409, CONCURRENT);
        }
        state.groups = state.groups.map((g) => (g.id === id ? { ...g, permissions: sorted(body.permissions) } : g));
        return copy(state.groups.find((g) => g.id === id));
      });
    },
  });
  await act(async () => { await settle(); await settle(); });
  return { ...mounted, state, gates, patches, held: (id) => state.groups.find((g) => g.id === id).permissions };
}

describe("against a server with state", () => {
  it("P6 a save lands, the re-read column shows it, and it reads as done with no alert", async () => {
    const { held } = await openLive();
    fireEvent.click(cell("Hemşire", AZ.users.manage));
    await saveIn(/Hemşire/);
    expect(held(NURSE_GROUP.id)).toEqual(["alerts.ack", "board.view", "users.manage"]);
    expect(screen.getAllByText(/Hemşire · səlahiyyətlər yadda saxlanıldı\./).length).toBeGreaterThan(0);
    expect(alerts().trim()).toBe("");
    expect(cell("Hemşire", AZ.users.manage)).toBeChecked();
    expect(screen.queryByText(`1 ${PENDING}`)).toBeNull();
    expect(within(column(/Hemşire/)).queryByRole("button", { name: "Yadda saxla" })).toBeNull();
  });

  it("P2 a Save on a stale column does not undo another administrator's change: it is refused, the column is re-read and SHOWS her change, and the ticks are kept", async () => {
    const { state, patches, held } = await openLive();
    // Another administrator grants audit.view to the nurses after this screen read the groups.
    state.groups = state.groups.map((g) => (g.id === NURSE_GROUP.id ? { ...g, permissions: [...g.permissions, "audit.view"] } : g));
    fireEvent.click(cell("Hemşire", AZ.users.manage));
    await saveIn(/Hemşire/);
    // The body says what this screen believed the group held — which is not what it holds now.
    expect(patches[0].body.expected_permissions).toEqual(["alerts.ack", "board.view"]);
    expect(sorted(held(NURSE_GROUP.id))).toEqual(["alerts.ack", "audit.view", "board.view"]);   // nothing undone
    expect(alerts()).toContain("Hemşire");
    expect(alerts()).toContain("Qeyd eyni anda dəyişdirildi");
    // What the re-read column shows: her grant, and this administrator's tick still pending.
    expect(cell("Hemşire", AZ.audit.view)).toBeChecked();
    expect(cell("Hemşire", AZ.users.manage)).toBeChecked();
    expect(within(column(/Hemşire/)).getByText(`1 ${PENDING}`)).toBeInTheDocument();
    expect(notes()).toMatch(/Hemşire: qeyd bu arada başqası tərəfindən dəyişdirildi; sütun serverdən yenidən oxundu/);
    expect(alerts()).not.toMatch(/yenidən oxundu/);
    // Saving again is computed on what the server holds NOW, and keeps both changes.
    await saveIn(/Hemşire/);
    expect(patches[1].body.expected_permissions).toEqual(["alerts.ack", "audit.view", "board.view"]);
    expect(held(NURSE_GROUP.id)).toEqual(["alerts.ack", "audit.view", "board.view", "users.manage"]);
    expect(notes()).not.toMatch(/yenidən oxundu/);
    expect(screen.queryByText(`1 ${PENDING}`)).toBeNull();
  });

  it("P7 after a save whose re-read failed, the column shows what the PATCH answered, and the next Save does not revert the first", async () => {
    const { api, patches, held } = await openLive();
    fireEvent.click(cell("Hemşire", AZ.users.manage));
    api.adminGroups.mockRejectedValueOnce(unavailable());
    await saveIn(/Hemşire/);
    expect(held(NURSE_GROUP.id)).toContain("users.manage");
    expect(screen.getAllByText(/Hemşire · səlahiyyətlər yadda saxlanıldı\./).length).toBeGreaterThan(0);
    // The re-read failed (the frame says so); the column does not fall back to the pre-save list.
    expect(cell("Hemşire", AZ.users.manage)).toBeChecked();
    expect(screen.queryByText(`1 ${PENDING}`)).toBeNull();
    fireEvent.click(cell("Hemşire", AZ.audit.view));
    await saveIn(/Hemşire/);
    expect(patches[1].body.permissions).toContain("users.manage");
    expect(patches[1].body.expected_permissions).toEqual(["alerts.ack", "board.view", "users.manage"]);
    expect(held(NURSE_GROUP.id)).toEqual(["alerts.ack", "audit.view", "board.view", "users.manage"]);
  });

  it("P8 after a 409 whose re-read FAILED, the Note does not claim the column was re-read — it says it could not be", async () => {
    const { api } = await openLive();
    api.adminUpdateGroup.mockRejectedValue(refusal(409, CONCURRENT));
    api.adminGroups.mockRejectedValueOnce(unavailable());
    fireEvent.click(cell("Hemşire", AZ.users.manage));
    await saveIn(/Hemşire/);
    expect(notes()).not.toMatch(/sütun serverdən yenidən oxundu/);
    expect(notes()).toMatch(/Hemşire: qeyd bu arada başqası tərəfindən dəyişdirildi, lakin sütun serverdən yenidən oxuna bilmədi/);
    expect(cell("Hemşire", AZ.users.manage)).toBeChecked();      // the tick is kept
  });

  it("P1 while a column's Save is in flight its cells are not editable, and what the server took is what the column shows", async () => {
    const { gates, held } = await openLive({ hold: true });
    fireEvent.click(cell("Hemşire", AZ.users.manage));                 // grant users.manage
    fireEvent.click(cell("Gece ekibi", AZ.alerts.ack));                 // and, in another column, alerts.ack
    await act(async () => { fireEvent.click(within(column(/Hemşire/)).getByRole("button", { name: "Yadda saxla" })); await settle(); });
    // In flight: a revocation of alerts.ack now could not be in the body already sent. The cell
    // says so instead of collecting a tick the success would then throw away.
    const box = cell("Hemşire", AZ.alerts.ack);
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(document.getElementById(box.getAttribute("aria-describedby"))).toHaveTextContent("Hemşire · yadda saxlanılır…");
    fireEvent.click(box);
    expect(box).toBeChecked();
    await act(async () => { gates.forEach((release) => release()); await settle(); await settle(); await settle(); });
    expect(screen.getAllByText(/Hemşire · səlahiyyətlər yadda saxlanıldı\./).length).toBeGreaterThan(0);
    expect(alerts().trim()).toBe("");
    expect(held(NURSE_GROUP.id)).toEqual(["alerts.ack", "board.view", "users.manage"]);
    expect(cell("Hemşire", AZ.alerts.ack)).toBeChecked();
    expect(cell("Hemşire", AZ.alerts.ack)).not.toHaveAttribute("aria-disabled");
    // The other column's tick was never sent, and is still pending.
    expect(held(WARD_GROUP.id)).toEqual(["board.view"]);
    expect(within(column(/Gece ekibi/)).getByText(`1 ${PENDING}`)).toBeInTheDocument();
  });

  it("P3 a cell granting a right this desk does not hold is not offered as editable", async () => {
    await openLive({ desk: ["groups.manage", "board.view"], groups: [WARD_GROUP] });
    expect(cell("Gece ekibi", AZ.users.manage)).toHaveAttribute("aria-disabled", "true");
    expect(cell("Gece ekibi", AZ.board.view)).not.toHaveAttribute("aria-disabled");
  });
});
