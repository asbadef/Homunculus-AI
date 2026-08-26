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
// ?demo=1 has no flag of its own any more: the clinical demo IS the default, so the parameter
// still works and simply falls through. Existing links keep resolving to the same screen.
// Eski pasif replay demosu artık ?mode=replay (veya ?scenario=...) ile erişilebilir.
const isReplay = params.get("mode") === "replay" || params.has("scenario");
// ?live=1 → giriş gerçek backend'e (JWT/MFA) yapılır; backend'in henüz karşılamadığı ekranlar
// simülasyonla çalışmaya devam eder.
const isLive = params.get("live") === "1";
// ?board=1 → the legacy bearer-token board. No longer the default: it authenticates with a tenant
// token, so on any real deployment every fetch 401s and the screen sits at "reconnecting" — which
// looks exactly like a quiet ward. Pass ?board=1&token=<tenant-token> to use it deliberately.
const isBoard = params.get("board") === "1";

function pickRoot() {
  if (isLive) {
    const store = createLiveStore({
      api: backendApi,
      base: createDemoStore(buildRealisticState()),
    });
    return <ClinicalDemo store={store} />;
  }
  if (isReplay) {
    return <DemoApp scenario={params.get("scenario") || "septic_shock"} />;
  }
  if (isBoard) return <Board token={params.get("token") || "dev-token"} />;
  // Default: the clinical design running on simulated data, which is what the banner above says
  // this is. Previously the bare URL fell through to the legacy Board, so the address a clinician
  // would naturally type produced a permanently failing screen that the banner then mislabelled as
  // demonstration data. Both halves of that were wrong.
  return <ClinicalDemo />;
}

// The banner sits above whichever root is chosen: every mode currently draws its clinical content
// from the simulation, so every mode has to say so. Phase 2 removes it along with the simulation.
createRoot(document.getElementById("root")).render(
  <>
    <DemoDataBanner />
    {pickRoot()}
  </>,
);
