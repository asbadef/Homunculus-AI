// src/legacyRoots.jsx — every root that is NOT the live system: the previous live workspace
// (?eski=1, the reference Wave 3 ports from, removed with the demo in G1-16), the simulation
// (?demo=1), the replay demonstration (?mode=replay) and the legacy bearer-token board (?board=1).
//
// They sit behind one lazy import (main.jsx) so that the live page does not download them. The
// simulation, its data builder and the old workspace are the bulk of this bundle — 710 kB in the
// first chunk — and a ward PC opening the real system was fetching every byte of a simulation it
// never renders. Nothing here is new code: it is main.jsx's own branches, moved.
import React from "react";
import { Board } from "./Board.jsx";
import { DemoApp } from "./demo.jsx";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState } from "./clinicalDemo.js";
import { createLiveStore } from "./liveStore.js";
import { backendApi } from "./backendApi.js";

/** The previous live workspace: the real API under the old ClinicalDemo screens. */
function Eski() {
  const [store] = React.useState(() => createLiveStore({
    api: backendApi,
    base: createDemoStore(buildRealisticState()),
  }));
  // In an effect, not while rendering: reading the stored session is a request, and a render may
  // be thrown away or run twice. Fire-and-forget — a page refresh must reopen the stored session
  // instead of signing the clinician out, and a failure quietly leaves the login screen, which
  // renders meanwhile anyway.
  React.useEffect(() => { store.restoreSession(); }, [store]);
  // simulation stays false: this is the real ward. See the note on ClinicalDemo.
  return <ClinicalDemo store={store} />;
}

/** `params`: the page's query string (main.jsx), for the roots that read it. */
export default function LegacyRoot({ mode, params }) {
  if (mode === "eski") return <Eski />;
  if (mode === "demo") return <ClinicalDemo simulation />;
  if (mode === "replay") return <DemoApp scenario={params.get("scenario") || "septic_shock"} />;
  // ?board=1 → the legacy bearer-token board. It authenticates with a tenant token, so on any
  // real deployment every fetch 401s and the screen sits at "reconnecting" — which looks exactly
  // like a quiet ward. Pass ?board=1&token=<tenant-token> to use it deliberately.
  return <Board token={params.get("token") || "dev-token"} />;
}
