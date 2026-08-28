/// <reference types="jest" />
import recording from "../assets/demo/icu-ward.json";
import type { Recording, BoardAlert, LatestVitals } from "../src/transport/types";

const ward = recording as Recording;

// Compile-time contract: the hand-written types and the recorded data must agree on field
// names in BOTH directions. The `as Recording` cast alone cannot enforce this — TypeScript
// only rejects casts between insufficiently-overlapping types, and 17 of 18 matching fields
// counts as sufficient overlap, so a renamed field would slip through silently.
type JsonAlert = (typeof recording)["frames"][number]["boards"][number]["alerts"][number];
type JsonLatest = (typeof recording)["frames"][number]["boards"][number]["latest"];
type KeysMatch<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;
const alertKeysMatch: KeysMatch<BoardAlert, JsonAlert> = true;
const latestKeysMatch: KeysMatch<LatestVitals, JsonLatest> = true;
void alertKeysMatch;
void latestKeysMatch;

describe("the committed recording", () => {
  it("declares its scenario and a step interval", () => {
    expect(ward.scenario).toBe("icu-ward");
    expect(ward.step_seconds).toBeGreaterThan(0);
  });

  it("carries every field the screens read", () => {
    const board = ward.frames.at(-1)!.boards.find((b) => b.patient_id === "bed-3")!;
    expect(board.risk).toBe("critical");
    expect(Object.keys(board.latest).sort()).toEqual([
      "heart_rate", "lactate", "map", "resp_rate", "sofa", "spo2", "temperature",
    ]);
    const alert = board.alerts[0];
    for (const key of [
      "kind", "severity", "urgency", "summary", "clinical_reasoning", "supporting_evidence",
      "recommended_actions", "confidence", "source", "downgraded", "chronic_context",
      "stale_inputs", "acknowledged", "first_seen_at", "escalated",
    ]) {
      expect(alert).toHaveProperty(key);
    }
  });

  it("holds all three beds", () => {
    const ids = new Set(ward.frames.at(-1)!.boards.map((b) => b.patient_id));
    expect(ids).toEqual(new Set(["bed-3", "bed-5", "bed-7"]));
  });
});
