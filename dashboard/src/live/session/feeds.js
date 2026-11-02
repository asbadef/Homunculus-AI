// src/live/session/feeds.js — the one thing of a session the live waveform modules hold (I1): a
// wave feed, whose only capability is `getWaves(path)`, a GET of one /infinity-waves/ path inside
// the session's `track`.
//
// The wave modules (data/waveStore.js, screens/common/Wave*.jsx; waveBoundaries.test.js lists them)
// never receive the session store or its API client. With either they could unlock, lock, sign out,
// change a password, admit, chart, discharge, release a bed or acknowledge an alarm, and a deny-list
// of names read in their text can be evaded. An object that holds none of it cannot. So the screens
// that draw waves, which already hold the session, turn it into a feed here — the ONE place that
// does — and hand the feed down (WavePanel's `feed`). This module is not a wave module (its name
// does not start with "wave"): it is the session's side of that line.
//
// A feed, each held by feeds.test.js:
//   * is a frozen plain object with `getWaves` alone: no session, client or `track` on it, and none
//     reachable through it;
//   * is one per session (a WeakMap), so every panel of a session shares it, and its wave store;
//   * takes only the API's one wave route, `/infinity-waves/{source}` and its query, as a browser
//     would read it. Anything else throws at once and nothing is asked: another route, a path the
//     browser would turn into another one (`..`, `%2e%2e`, a backslash, a tab or newline it drops, a
//     trailing space), a second segment, a fragment, anything but a string;
//   * asks with the path alone: a GET, with no method, body or option of any kind;
//   * asks inside the session's `track`, so a refused refresh ends the session there too, as every
//     other call of a screen does. The answer, or the refusal, goes back as it came.

const ROUTE = "/infinity-waves/";
const ONE_MONITOR = /^\/infinity-waves\/[^/]+$/;
// Only to read a path as the browser will (backendApi fetches `${baseUrl}${path}`); never fetched.
const READER = "http://feed.invalid";

/** Whether `path` is the wave route of one monitor, read as a browser reads it: its path part (all
 *  before the first `?`) comes back from the URL parser unchanged, and is one segment under the route. */
function isWavesPath(path) {
  if (typeof path !== "string" || !path.startsWith(ROUTE) || path.includes("#")) return false;
  const query = path.indexOf("?");
  const pathPart = query === -1 ? path : path.slice(0, query);
  let read;
  try {
    read = new URL(path, READER);
  } catch {
    return false;
  }
  return read.pathname === pathPart && ONE_MONITOR.test(pathPart);
}

const feeds = new WeakMap();

/** The session's wave feed, made on first use: `{ getWaves(path) }`, frozen, and the same object
 *  for every caller of one session. `session`: the session store (sessionStore.js), with `track`
 *  and `api.request` (backendApi's escape hatch for a route it does not wrap). */
export function waveFeedFor(session) {
  if (session === null || typeof session !== "object") throw new TypeError("waveFeedFor: a session store is required");
  let feed = feeds.get(session);
  if (!feed) {
    feed = Object.freeze({
      getWaves(path) {
        if (!isWavesPath(path)) throw new TypeError("getWaves: only an /infinity-waves/{source} path");
        return session.track(() => session.api.request(path));
      },
    });
    feeds.set(session, feed);
  }
  return feed;
}
