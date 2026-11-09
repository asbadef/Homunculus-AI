// What the Doluluk screen counts, offers and says about time (G2-B3a, spec §3, R3, X10). Pure.
import { describe, it, expect } from "vitest";
import { structure } from "../kabul/kabul.testutil.js";
import { REASONS, actionsFor, sinceKey, unitCounts, usable, withOpen } from "./occupancy.js";

const rea = () => structure().sites[0].units[0];
const open = (state) => ({ state, open: true });
const CHARGE = ["admissions.view", "admissions.admit", "beds.release", "beds.manage_state"];
const NURSE = ["admissions.view", "admissions.admit", "beds.release"];
const MIN = 60_000;

describe("occupancy", () => {
  it("counts a unit's beds: occupied of usable, and each state apart; a closed bed counts nowhere", () => {
    // Reanimasiya: 1 free, 2 occupied, 3 cleaning, 4 free but CLOSED, 5 free.
    expect(unitCounts(rea())).toEqual({ occupied: 1, usable: 4, free: 2, cleaning: 1, reserved: 0, outOfService: 0, maintenance: 0 });
  });

  it("counts out of service and maintenance as not usable, and a reserved bed as usable", () => {
    const unit = rea();
    unit.rooms[0].beds[0].state = "BLOCKED";
    unit.rooms[0].beds[2].state = "MAINTENANCE";
    unit.rooms[1].beds[0].state = "RESERVED";
    expect(unitCounts(unit)).toEqual({ occupied: 1, usable: 2, free: 0, cleaning: 0, reserved: 1, outOfService: 1, maintenance: 1 });
  });

  it("counts both pending states as occupied: the patient has not left yet", () => {
    const unit = rea();
    unit.rooms[0].beds[0].state = "PENDING_DISCHARGE";
    unit.rooms[1].beds[0].state = "PENDING_TRANSFER_OUT";
    expect(unitCounts(unit).occupied).toBe(3);
  });

  it("marks a bed open only when it, its room and its unit are", () => {
    const unit = rea();
    expect(withOpen(unit, unit.rooms[0], unit.rooms[0].beds[3]).open).toBe(false);       // bed 4 closed
    expect(withOpen({ ...unit, is_active: false }, unit.rooms[0], unit.rooms[0].beds[0]).open).toBe(false);
    expect(usable(open("BLOCKED"))).toBe(false);
    expect(usable({ state: "AVAILABLE", open: false })).toBe(false);
  });

  it("offers each move to the right that makes it, and nothing on a closed bed", () => {
    expect(actionsFor(open("AVAILABLE"), CHARGE)).toEqual(["admit", "reserve", "outOfService"]);
    expect(actionsFor(open("AVAILABLE"), NURSE)).toEqual(["admit"]);
    expect(actionsFor(open("RESERVED"), CHARGE)).toEqual(["admit", "unreserve"]);              // X10
    expect(actionsFor(open("RESERVED"), ["beds.manage_state"])).toEqual(["unreserve"]);
    expect(actionsFor(open("HOUSEKEEPING"), NURSE)).toEqual(["release"]);
    expect(actionsFor(open("BLOCKED"), CHARGE)).toEqual(["returnToService"]);
    expect(actionsFor(open("MAINTENANCE"), CHARGE)).toEqual(["returnToService"]);              // R3
    expect(actionsFor(open("MAINTENANCE"), NURSE)).toEqual([]);
    expect(actionsFor(open("OCCUPIED"), CHARGE)).toEqual([]);
    expect(actionsFor({ state: "AVAILABLE", open: false }, CHARGE)).toEqual([]);
  });

  it("says how long a bed has been in its state, never negative, nothing without an instant", () => {
    const now = Date.UTC(2026, 10, 9, 12, 0, 0);
    expect(sinceKey(null, now)).toBeNull();
    expect(sinceKey(now + 5 * MIN, now)).toEqual({ key: "doluluk.since.now", vars: {} });       // a PC ahead
    expect(sinceKey(now - 30_000, now)).toEqual({ key: "doluluk.since.now", vars: {} });
    expect(sinceKey(now - 25 * MIN, now)).toEqual({ key: "doluluk.since.min", vars: { n: 25 } });
    expect(sinceKey(now - 185 * MIN, now)).toEqual({ key: "doluluk.since.hour", vars: { h: 3, m: 5 } });
    expect(sinceKey(now - 50 * 60 * MIN, now)).toEqual({ key: "doluluk.since.day", vars: { n: 2 } });
  });

  it("offers the four reasons in the server's order", () => {
    expect(REASONS).toEqual(["FAULT", "ISOLATION_CLEANING", "STAFFING", "OTHER"]);
  });
});
