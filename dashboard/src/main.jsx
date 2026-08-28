import "@fontsource-variable/figtree";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./Board.jsx";
import { DemoApp } from "./demo.jsx";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { DemoDataBanner } from "./DemoDataBanner.jsx";
import { createDemoStore, buildRealisticState } from "./clinicalDemo.js";
import { createLiveStore } from "./liveStore.js";
import { backendApi } from "./backendApi.js";

const params = new URLSearchParams(window.location.search);

/**
 * Which mode a URL selects. Exported so the routing is testable without a DOM.
 *
 * The bare URL — no query string at all — is the live system: the address a clinician
 * naturally types must be the real one, not a simulation. `?demo=1` keeps the simulation
 * reachable for anyone who wants it deliberately. `?live=1` remains honoured for old links
 * and, being an explicit ask for the real system, wins over a simultaneous `?demo=1`: showing
 * simulated data by accident is the worse failure of the two.
 */
export function chooseMode(params) {
  if (params.get("live") === "1") return "live";
  if (params.get("demo") === "1") return "demo";
  if (params.get("mode") === "replay" || params.has("scenario")) return "replay";
  if (params.get("board") === "1") return "board";
  return "live";
}

function pickRoot(mode) {
  if (mode === "live") {
    const store = createLiveStore({
      api: backendApi,
      base: createDemoStore(buildRealisticState()),
    });
    return <ClinicalDemo store={store} />;
  }
  if (mode === "demo") return <ClinicalDemo />;
  if (mode === "replay") {
    return <DemoApp scenario={params.get("scenario") || "septic_shock"} />;
  }
  // ?board=1 → the legacy bearer-token board. It authenticates with a tenant token, so on any
  // real deployment every fetch 401s and the screen sits at "reconnecting" — which looks exactly
  // like a quiet ward. Pass ?board=1&token=<tenant-token> to use it deliberately.
  return <Board token={params.get("token") || "dev-token"} />;
}

// #/demo is an older deep link into the simulation; honour it ahead of the query string.
const mode = window.location.hash.startsWith("#/demo") ? "demo" : chooseMode(params);

// The banner belongs only to the simulation: demo and replay both draw from fabricated data, so
// both say so. Live and board talk to the real API — labelling them as demonstration data would
// be false, and a notice that is sometimes wrong is worse than none, because people stop reading it.
const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <>
      {mode === "demo" || mode === "replay" ? <DemoDataBanner /> : null}
      {pickRoot(mode)}
    </>,
  );
}
