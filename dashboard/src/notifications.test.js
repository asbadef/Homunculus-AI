import { describe, it, expect } from "vitest";
import { showDesktop, beep, ensurePermission } from "./notifications.js";

describe("notifications helpers", () => {
  it("showDesktop no-ops safely when Notification API is absent", () => {
    const saved = globalThis.Notification;
    delete globalThis.Notification;
    expect(() => showDesktop("t", "b")).not.toThrow();
    globalThis.Notification = saved;
  });

  it("beep no-ops safely when AudioContext is absent", () => {
    const saved = globalThis.AudioContext;
    delete globalThis.AudioContext;
    expect(() => beep()).not.toThrow();
    globalThis.AudioContext = saved;
  });

  it("ensurePermission resolves without throwing when API absent", async () => {
    const saved = globalThis.Notification;
    delete globalThis.Notification;
    await expect(ensurePermission()).resolves.toBeDefined();
    globalThis.Notification = saved;
  });
});
