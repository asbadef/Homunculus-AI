// Test-only: render a piece of the live UI inside a real session store (on a fake API) and a
// board store, the way LiveApp nests them. `access` null: signed out; otherwise the session is
// restored first (phase ready, or whatever the profile says). Synthetic accounts only.
import React from "react";
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { ToastProvider } from "../ui/index.js";
import { SessionProvider } from "./SessionProvider.jsx";
import { createSessionStore } from "./sessionStore.js";
import { BoardProvider } from "../data/BoardProvider.jsx";
import { createBoardStore } from "../data/boardStore.js";
import { fakeApi, profile, token } from "./testTokens.testutil.js";

export const refusal = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export async function mount(ui, { access = token(), me = profile(), setup } = {}) {
  const api = fakeApi(vi, { access });
  api.me.mockResolvedValue(me);
  setup?.(api);
  const store = createSessionStore({ api, events: new EventTarget() });
  if (access) await store.restore();
  const board = createBoardStore({ api });
  render(
    <I18nProvider><ToastProvider>
      <SessionProvider store={store}><BoardProvider store={board}>{ui}</BoardProvider></SessionProvider>
    </ToastProvider></I18nProvider>,
  );
  return { api, store, board };
}
