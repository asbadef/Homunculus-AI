import { describe, it, expect, vi, afterEach } from "vitest";
import {
  LOCK_KEY, REMEMBER_KEY, clearLock, forgetUser, parseLock, readActiveAt, readLock,
  readRememberedUser, rememberUser, writeActiveAt, writeLock,
} from "./browserState.js";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the lock this browser keeps", () => {
  it("round-trips, and clears", () => {
    writeLock({ user: "u-1", at: 1_700_000_000_000, why: "idle" });
    expect(readLock()).toEqual({ user: "u-1", at: 1_700_000_000_000, why: "idle" });
    clearLock();
    expect(readLock()).toBeNull();
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
  });

  it.each(["", "{}", "null", "kilit", '{"user":"","at":1,"why":"idle"}', '{"user":"u","at":"dün","why":"idle"}',
    '{"user":"u","at":1,"why":"tired"}'])("reads %j as no lock", (raw) => {
    expect(parseLock(raw)).toBeNull();
  });

  it("keeps the wrong unlock passwords it has taken, shared by every tab and reload", () => {
    writeLock({ user: "u-1", at: 5, why: "idle", failures: 2 });
    expect(readLock()).toEqual({ user: "u-1", at: 5, why: "idle", failures: 2 });
    for (const failures of [0, -1, 1.5, "2", null]) {
      expect(parseLock(JSON.stringify({ user: "u-1", at: 5, why: "idle", failures }))).toEqual({ user: "u-1", at: 5, why: "idle" });
    }
  });

  it("answers no lock, and writes nothing, when storage refuses", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError"); });
    expect(() => writeLock({ user: "u", at: 1, why: "manual" })).not.toThrow();
    expect(() => writeActiveAt(5)).not.toThrow();
    expect(() => rememberUser("ayse")).not.toThrow();
    expect(() => clearLock()).not.toThrow();
    expect(readLock()).toBeNull();
    expect(readActiveAt()).toBeNull();
    expect(readRememberedUser()).toBe("");
    vi.restoreAllMocks();
    expect(localStorage.length).toBe(0);   // nothing was written behind the refusal
  });

  it("answers nothing, and does not throw, when reaching window.localStorage itself throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("SecurityError"); });
    expect(() => writeLock({ user: "u", at: 1, why: "idle" })).not.toThrow();
    expect(() => writeActiveAt(7)).not.toThrow();
    expect(() => forgetUser()).not.toThrow();
    expect(readLock()).toBeNull();
    expect(readActiveAt()).toBeNull();
    expect(readRememberedUser()).toBe("");
    vi.restoreAllMocks();
    expect(localStorage.length).toBe(0);
  });
});

describe("the last activity in any tab", () => {
  it("is a time, or nothing", () => {
    expect(readActiveAt()).toBeNull();
    writeActiveAt(1_700_000_000_123);
    expect(readActiveAt()).toBe(1_700_000_000_123);
    localStorage.setItem("hmc.activeAt", "dün");
    expect(readActiveAt()).toBeNull();
  });
});

describe("remember my username", () => {
  it("keeps the name and only the name; forgetting removes it", () => {
    rememberUser("ayse");
    expect(readRememberedUser()).toBe("ayse");
    expect(Object.keys(localStorage)).toEqual([REMEMBER_KEY]);
    forgetUser();
    expect(readRememberedUser()).toBe("");
    expect(localStorage.getItem(REMEMBER_KEY)).toBeNull();
  });
});
