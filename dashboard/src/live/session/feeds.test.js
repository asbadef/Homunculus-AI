// The wave feed (I1): the one thing of a session the live waveform modules hold — a GET of one
// /infinity-waves/ path, inside the session's `track` — and nothing else of it. A session-shaped
// stub with every action a wave module must not reach, each a spy that must stay unasked.
// Synthetic addresses only (192.0.2.x, TEST-NET-1).
import { describe, it, expect, vi } from "vitest";
import { waveFeedFor } from "./feeds.js";
import { wavesPath } from "../data/waveStore.js";
import { STARTED, refusal } from "../data/waves.testutil.js";

const PATH = "/infinity-waves/192.0.2.10?since=0";
const ANSWER = Object.freeze({ schema: "homunculus.infinity-waves.v1" });

/** A session as the shell holds one: its client, `track`, and the actions the waves must never reach. */
function sessionLike() {
  const api = {
    request: vi.fn(async () => ANSWER),
    acknowledge: vi.fn(), changePassword: vi.fn(), logout: vi.fn(), reauth: vi.fn(),
  };
  const session = {
    api,
    track: vi.fn((call) => call()),
    signOut: vi.fn(), cancel: vi.fn(), lock: vi.fn(), unlock: vi.fn(), changePassword: vi.fn(),
    subscribe: vi.fn(() => () => {}), getState: vi.fn(() => ({ phase: "ready", user: null })),
  };
  /** Every spy of the session but `track` and `request`: none may ever be called through a feed. */
  const untouchable = () => [
    ...Object.entries(api).filter(([name]) => name !== "request"),
    ...Object.entries(session).filter(([name]) => !["api", "track"].includes(name)),
  ].filter(([, fn]) => fn.mock.calls.length > 0).map(([name]) => name);
  return { session, api, untouchable };
}

describe("a session's wave feed", () => {
  it("asks for a waves path inside the session's track, as a GET of the path alone", async () => {
    const { session, api, untouchable } = sessionLike();
    const feed = waveFeedFor(session);
    await expect(feed.getWaves(PATH)).resolves.toBe(ANSWER);
    expect(session.track).toHaveBeenCalledTimes(1);
    // The path alone: no method, no body, no option of any kind — backendApi's GET.
    expect(api.request.mock.calls).toEqual([[PATH]]);
    expect(untouchable()).toEqual([]);
  });

  it("asks through track, not around it: the request is made by the call track runs", async () => {
    const { session, api } = sessionLike();
    session.track.mockImplementation(() => Promise.resolve("held"));    // a track that runs nothing
    await expect(waveFeedFor(session).getWaves(PATH)).resolves.toBe("held");
    expect(api.request).not.toHaveBeenCalled();
  });

  it("passes a refusal on as it was thrown, for the wave store to read its status", async () => {
    const { session, api } = sessionLike();
    const denied = refusal(403);
    api.request.mockRejectedValue(denied);
    await expect(waveFeedFor(session).getWaves(PATH)).rejects.toBe(denied);
  });

  it("takes every path the wave store builds, an address or a hub process of any text included", async () => {
    const { session, api } = sessionLike();
    const feed = waveFeedFor(session);
    const paths = [wavesPath("192.0.2.10", 0), wavesPath("192.0.2.10", 41, STARTED),
      wavesPath("bed 7/ü?#", 3, "it's (a) hub!*~"), wavesPath("192.0.2.11", 9, "")];
    for (const path of paths) await feed.getWaves(path);
    expect(api.request.mock.calls).toEqual(paths.map((path) => [path]));
  });

  it.each([
    ["another route", "/auth/me"],
    ["the acknowledgement", "/ack"],
    ["the patients", "/patients"],
    ["no leading slash", "infinity-waves/192.0.2.10?since=0"],
    ["the route without a monitor", "/infinity-waves/"],
    ["the route's name without its slash", "/infinity-waves"],
    ["a longer name", "/infinity-wavesx/192.0.2.10"],
    ["another case", "/INFINITY-WAVES/192.0.2.10"],
    ["another origin", "//evil.example/infinity-waves/192.0.2.10"],
    ["a whole URL", "http://evil.example/infinity-waves/192.0.2.10"],
    ["a dot-dot segment", "/infinity-waves/../auth/me"],
    ["a dot-dot segment after the address", "/infinity-waves/192.0.2.10/../../admin/users"],
    ["an encoded dot-dot", "/infinity-waves/%2e%2e/auth/me"],
    ["a half-encoded dot-dot", "/infinity-waves/.%2E/auth/me"],
    ["a bare dot-dot, with a query", "/infinity-waves/..?since=0"],
    ["a dot", "/infinity-waves/."],
    ["an encoded dot-dot as the monitor", "/infinity-waves/%2e%2e?since=0"],
    ["a tab inside a dot-dot", "/infinity-waves/.\t.?since=0"],
    ["backslashes", "/infinity-waves/a\\..\\..\\auth\\me"],
    ["a tab the browser drops", "/infinity-waves/.\t./auth/me"],
    ["a newline the browser drops", "/infinity-waves/.\n./auth/me?since=0"],
    ["a trailing space the browser drops", "/infinity-waves/192.0.2.10 "],
    ["a second segment", "/infinity-waves/192.0.2.10/x"],
    ["a fragment", "/infinity-waves/192.0.2.10?since=0#x"],
    ["no path", undefined],
    ["null", null],
    ["a number", 42],
    ["a String object", new String(PATH)],
    ["an array that prints as a path", [PATH]],
    ["an object that prints as a path", { toString: () => PATH }],
  ])("refuses %s at once, and asks nothing", (_name, path) => {
    const { session, api, untouchable } = sessionLike();
    const feed = waveFeedFor(session);
    expect(() => feed.getWaves(path)).toThrow(TypeError);
    expect(session.track).not.toHaveBeenCalled();
    expect(api.request).not.toHaveBeenCalled();
    expect(untouchable()).toEqual([]);
  });

  it("is a frozen plain object with getWaves alone, and holds nothing of the session", () => {
    const { session, api } = sessionLike();
    const feed = waveFeedFor(session);
    expect(Object.isFrozen(feed)).toBe(true);
    expect(Reflect.ownKeys(feed)).toEqual(["getWaves"]);
    expect(Object.getPrototypeOf(feed)).toBe(Object.prototype);
    expect(typeof feed.getWaves).toBe("function");
    expect(Object.getOwnPropertyDescriptor(feed, "getWaves")).toMatchObject({ writable: false, configurable: false });
    // Not a constructor, and nothing hung on the function: only its own name and length.
    expect(feed.getWaves.prototype).toBeUndefined();
    expect(Reflect.ownKeys(feed.getWaves).sort()).toEqual(["length", "name"]);
    // Nothing reachable through what it owns is the session, its client or one of their functions.
    const held = new Set([session, api, ...Object.values(session), ...Object.values(api)]);
    const owned = [...Reflect.ownKeys(feed).map((k) => feed[k]), ...Reflect.ownKeys(feed.getWaves).map((k) => feed.getWaves[k])];
    expect(owned.filter((value) => held.has(value))).toEqual([]);
    // Nothing can be added, swapped or taken away (an ES module is strict: each throws).
    expect(() => { feed.api = api; }).toThrow(TypeError);
    expect(() => { feed.getWaves = api.request; }).toThrow(TypeError);
    expect(() => { delete feed.getWaves; }).toThrow(TypeError);
    expect(() => Object.setPrototypeOf(feed, session)).toThrow(TypeError);
  });

  it("works taken off its object, as the wave store holds it", async () => {
    const { session, api } = sessionLike();
    const { getWaves } = waveFeedFor(session);
    await getWaves(PATH);
    expect(api.request.mock.calls).toEqual([[PATH]]);
  });

  it("is one per session, shared by every caller, and another session's is another", async () => {
    const first = sessionLike();
    const second = sessionLike();
    const feed = waveFeedFor(first.session);
    expect(waveFeedFor(first.session)).toBe(feed);
    const other = waveFeedFor(second.session);
    expect(other).not.toBe(feed);
    await other.getWaves(PATH);
    expect(second.api.request).toHaveBeenCalledTimes(1);
    expect(first.api.request).not.toHaveBeenCalled();
  });

  it("refuses to make a feed of anything but a session object", () => {
    for (const notOne of [undefined, null, "session", 7]) expect(() => waveFeedFor(notOne), String(notOne)).toThrow(TypeError);
  });
});
