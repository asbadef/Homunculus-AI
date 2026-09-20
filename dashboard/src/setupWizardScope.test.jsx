/**
 * The administrator of a real deployment does not get asked to set up what is already set up.
 *
 * Measured 07.09.2026: signing in as HOSPITAL_ADMIN produced a screen whose only controls were
 * a language picker, "Skip for now" and "Next" — the setup wizard, in front of the person who
 * bought the product. On a live install that is worse than an inconvenience:
 *
 *   - the tenant already exists (seed_admin.py creates it at first boot from SEED_TENANT_SLUG);
 *   - `createTenant` / `completeTenantSetup` never reach the API, so the answer lives in
 *     browser memory and is gone on refresh;
 *   - and if the administrator types a different hospital name, they believe the system is
 *     configured as they wrote it while the real tenant is whatever the .env said — the exact
 *     silent divergence docker-compose.yml warns about, arriving by a different door.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";

beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0.42));
afterEach(() => vi.restoreAllMocks());

/** Sign in as `role` in the given mode and return what the screen shows. */
async function signIn(role, { simulation }) {
  const store = createDemoStore(buildRealisticState());
  await act(async () => { store.loginAs(role); });
  render(<ClinicalDemo store={store} simulation={simulation} />);
  await act(async () => { await Promise.resolve(); });
  return {
    text: document.body.textContent || "",
    nav: Array.from(document.querySelectorAll("aside button[title]"))
      .map((b) => b.getAttribute("title")),
  };
}

describe("a live deployment", () => {
  it("takes the administrator straight to the product", async () => {
    const { nav } = await signIn(ROLE.HOSPITAL_ADMIN, { simulation: false });
    expect(nav.length).toBeGreaterThan(0);
    expect(nav).toContain("Sistem Ayarları");
  });

  it("does not ask for a tenant that the deployment already created", async () => {
    const { text } = await signIn(ROLE.HOSPITAL_ADMIN, { simulation: false });
    expect(text).not.toMatch(/Şimdilik atla|Skip for now/i);
  });

  it("still lets the administrator reach the settings they actually need", async () => {
    const { nav } = await signIn(ROLE.HOSPITAL_ADMIN, { simulation: false });
    expect(nav).toContain("Cihaz & Veri Akışı");
  });
});

describe("the simulation", () => {
  it("still opens the wizard, where creating a tenant is the only way one exists", async () => {
    const { nav } = await signIn(ROLE.HOSPITAL_ADMIN, { simulation: true });
    // The wizard replaces the whole shell, so there is no sidebar at all.
    expect(nav).toEqual([]);
  });
});

describe("no other role was ever affected", () => {
  it.each([
    ["a physician", ROLE.ATTENDING],
    ["a nurse", ROLE.CHARGE_NURSE],
    ["a biomedical engineer", ROLE.BIOMEDICAL],
  ])("%s goes straight in, in both modes", async (_label, role) => {
    expect((await signIn(role, { simulation: false })).nav.length).toBeGreaterThan(0);
    expect((await signIn(role, { simulation: true })).nav.length).toBeGreaterThan(0);
  });
});
