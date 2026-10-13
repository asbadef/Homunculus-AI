// src/legacyRoots.jsx — every root that is NOT the live system: the previous live workspace
// (?eski=1, the reference Wave 3 ports from, removed with the demo in G1-16) and the simulation
// (?demo=1). The replay demonstration and the legacy bearer-token board are already gone.
//
// They sit behind main.jsx's one lazy import, so that the live page does not download them. The
// simulation, its data builder and the old workspace are the bulk of this bundle — 710 kB in the
// first chunk — and a ward PC opening the real system was fetching every byte of a simulation it
// never renders. Nothing here is new code: it is main.jsx's own branches, moved.
import React from "react";
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

export default function LegacyRoot({ mode }) {
  if (mode === "eski") return <Eski />;
  return <ClinicalDemo simulation />;
}
