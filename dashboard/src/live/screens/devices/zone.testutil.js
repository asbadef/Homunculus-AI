// Test-only: a fixed time zone for the tests that read local time (amendment A-20). Their expected values are
// built from the same Date getters the screen uses, so they hold in any zone — and so a CI running in UTC cannot
// tell a screen that prints local time from one that prints UTC. Baku is UTC+4 all year (no daylight saving), so
// a literal expectation («09:02Z» is «13:02») is stable, and a late-evening instant crosses midnight.
// Call `pinZone()` once at the top of a test file; each test file runs in its own process, and the zone is put
// back after the file.
import { afterAll, beforeAll } from "vitest";

export const TEST_ZONE = "Asia/Baku";

export function pinZone(zone = TEST_ZONE) {
  let was;
  beforeAll(() => {
    was = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  });
}
