// Test-only: render a piece of the live UI inside a real session store (on a fake API) and a
// board store, the way LiveApp nests them. The store is started either way (`restore()`, as
// LiveApp's effect does), so it listens to other tabs: `access` null leaves it signed out,
// otherwise the session is restored first (phase ready, or whatever the profile says). `events`
// is the store's window stand-in — dispatch a `storage` or `focus` event on it to play another
// tab. `stream` is the board's SSE stream, which the test drives itself. Synthetic accounts only.
import React from "react";
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { ToastProvider } from "../ui/index.js";
import { SessionProvider } from "./SessionProvider.jsx";
import { createSessionStore } from "./sessionStore.js";
import { BoardProvider } from "../data/BoardProvider.jsx";
import { createBoardStore } from "../data/boardStore.js";
import { AlarmSignals } from "../signals/AlarmSignals.jsx";
import { fakeApi, profile, token } from "./testTokens.testutil.js";

export const refusal = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** The board's stream as a test drives it, in place of `boardStore`'s own `openStream`: jsdom has
 *  no EventSource, so the real one opens nothing and a board could never reach LIVE — the one
 *  state that may say "no alarms" (Decision 18). Every call belongs inside act():
 *
 *    await act(async () => { stream.open(); await settle(); });  // opened: LIVE once its reload lands
 *    act(() => { stream.frame(entry("S-001", [alarm])); });      // one board frame
 *    act(() => { stream.heartbeat(); });                         // the server is still there
 *    act(() => { stream.drop(); });                              // it died: DEGRADED, then a reconnect
 *
 *  `url` is what the store asked to open (a ticket, never a token), `opened` whether a stream is
 *  open now, and `closes` how many the store has closed. */
function streamStub() {
  let handlers = null;
  let url = null;
  let closes = 0;
  return {
    openStream(nextUrl, nextHandlers) {
      url = nextUrl;
      handlers = nextHandlers;
      return () => { closes += 1; handlers = null; };
    },
    get url() { return url; },
    get opened() { return handlers !== null; },
    get closes() { return closes; },
    open: () => handlers?.onopen(),
    frame: (entry) => handlers?.onmessage({ data: JSON.stringify(entry) }),
    heartbeat: () => handlers?.onheartbeat(),
    drop: () => handlers?.onerror(),
  };
}

export async function mount(ui, { access = token(), me = profile(), setup } = {}) {
  const api = fakeApi(vi, { access });
  api.me.mockResolvedValue(me);
  setup?.(api);
  const events = new EventTarget();
  const store = createSessionStore({ api, events });
  await store.restore();
  const stream = streamStub();
  // `track` as LiveApp wires it: the board's own calls run inside the session, so a refused
  // refresh ends it here too and a 403 password_change_required moves the shell on — the paths a
  // board-driven test would otherwise never reach.
  const board = createBoardStore({ api, track: store.track, openStream: stream.openStream });
  render(
    <I18nProvider><ToastProvider>
      <SessionProvider store={store}><BoardProvider store={board}>
        <AlarmSignals>{ui}</AlarmSignals>
      </BoardProvider></SessionProvider>
    </ToastProvider></I18nProvider>,
  );
  return { api, store, board, events, stream };
}
