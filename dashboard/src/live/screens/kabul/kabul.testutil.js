// Test-only: a synthetic ward for the Hasta Kabul screens (Group 2 · B1a) — the structure GET
// /tenant/structure answers, admission rows as GET /admissions answers them, and a mount inside
// the shell's StructureProvider on a session holding the given rights. UUIDs are made up and must
// never appear on a screen (`UUID_TEXT`). Synthetic patients only.
import React from "react";
import { expect, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { ShellProvider } from "../../shell/ShellContext.jsx";
import { StructureProvider } from "../../data/StructureProvider.jsx";

export const T = "11111111-1111-4111-8111-111111111111";
export const SITE = "22222222-2222-4222-8222-222222222222";
export const REA = "33333333-3333-4333-8333-333333333301";
export const NEO = "33333333-3333-4333-8333-333333333302";
export const ROOM1 = "44444444-4444-4444-8444-444444444401";
export const ROOM2 = "44444444-4444-4444-8444-444444444402";
export const ROOMN = "44444444-4444-4444-8444-444444444403";
export const BED = (n) => `55555555-5555-4555-8555-5555555555${String(n).padStart(2, "0")}`;
/** Any UUID at all: no screen may print one. */
export const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** No UUID anywhere a reader or a screen reader meets one: the page's text, and the attributes
 *  that become an accessible name (aria-label, title, alt, placeholder). */
export function expectNoUuid(root = document.body) {
  expect(root.textContent).not.toMatch(UUID_TEXT);
  for (const el of root.querySelectorAll("[aria-label],[title],[alt],[placeholder]")) {
    for (const attr of ["aria-label", "title", "alt", "placeholder"]) {
      expect(el.getAttribute(attr) ?? "", `${el.tagName.toLowerCase()} ${attr}`).not.toMatch(UUID_TEXT);
    }
  }
}

const bed = (n, label, state = "AVAILABLE", is_active = true) => ({ id: BED(n), label, state, is_active });

export function structure() {
  return {
    tenant_id: T,
    sites: [{
      id: SITE, name: "Ana bina", is_active: true,
      units: [
        { id: REA, name: "Reanimasiya", unit_type: "ADULT_ICU", is_active: true, rooms: [
          { id: ROOM1, name: "Otaq 1", room_number: null, is_isolation: false, is_active: true,
            beds: [bed(1, "1"), bed(2, "2", "OCCUPIED"), bed(3, "3", "HOUSEKEEPING"), bed(4, "4", "AVAILABLE", false)] },
          { id: ROOM2, name: "Otaq 2", room_number: null, is_isolation: false, is_active: true,
            beds: [bed(5, "5")] },
        ] },
        { id: NEO, name: "Neonatal", unit_type: "NICU", is_active: false, rooms: [
          { id: ROOMN, name: "N-1", room_number: null, is_isolation: false, is_active: true, beds: [bed(6, "N1")] },
        ] },
      ],
    }],
  };
}

/** An admission row (admission/schemas.py AdmissionRow). */
export function row(over = {}) {
  return {
    id: "a-1", patient_id: "p-1", tenant_id: T, state: "ACTIVE", admission_datetime: "2026-10-25T08:00:00Z",
    admitting_unit_id: REA, bed_id: BED(2), attending_physician_id: null, admission_diagnosis_free_text: "Sentetik tanı",
    created_at: "2026-10-25T08:00:00Z", patient_number: "H2600001", display_name: "Sentetik Hasta",
    bed_label: "2", room_name: "Otaq 1", unit_name: "Reanimasiya", discharge_disposition: null,
    discharge_institution: null, discharge_at: null, ...over,
  };
}

/** Let what is pending settle: a macrotask — or, under fake timers, the clock's own zero tick. */
export const settle = () => act(async () => {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await new Promise((resolve) => setTimeout(resolve, 0));
});

/** Mount `ui` in the providers the shell gives a screen, the structure's included. `shell`
 *  ({ units, scope }) puts the shell's own ShellProvider around the structure's, as Shell.jsx
 *  nests them — what the top bar, the bed board and the provider's own re-read read. */
export async function mountKabul(ui, { perms, setup, shell } = {}) {
  const inner = React.createElement(StructureProvider, null, ui);
  const framed = shell
    ? React.createElement(ShellProvider, { units: shell.units, scope: shell.scope ?? "known" }, inner)
    : inner;
  const mounted = await mount(framed, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.structure.mockResolvedValue(structure());
      api.admissions.mockResolvedValue([]);
      setup?.(api);
    },
  });
  await settle();
  return mounted;
}

export const toasts = () => within(screen.getByRole("region", { name: "Bildirişlər" }));

export const NURSE = ["board.view", "admissions.view", "admissions.admit", "beds.release", "clinical.chart"];
export const CHARGE = [...NURSE, "admissions.discharge.confirm"];
export const DOCTOR = ["board.view", "admissions.view", "admissions.sign_off", "admissions.move.initiate", "clinical.chart"];
export const ADMIN = ["board.view", "admissions.view", "admissions.admit", "structure.manage", "users.manage", "groups.manage"];
