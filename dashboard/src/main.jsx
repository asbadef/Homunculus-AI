import "@fontsource-variable/figtree";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./Board.jsx";
import { DemoApp } from "./demo.jsx";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState } from "./clinicalDemo.js";
import { createLiveStore } from "./liveStore.js";
import { backendApi } from "./backendApi.js";

const params = new URLSearchParams(window.location.search);
const isDemo = params.get("demo") === "1" || window.location.hash.startsWith("#/demo");
// Eski pasif replay demosu artık ?mode=replay (veya ?scenario=...) ile erişilebilir.
const isReplay = params.get("mode") === "replay" || params.has("scenario");
// ?live=1 → giriş gerçek backend'e (JWT/MFA) yapılır; backend'in henüz karşılamadığı ekranlar
// simülasyonla çalışmaya devam eder.
const isLive = params.get("live") === "1";

function pickRoot() {
  if (isLive) {
    const store = createLiveStore({
      api: backendApi,
      base: createDemoStore(buildRealisticState()),
    });
    return <ClinicalDemo store={store} />;
  }
  if (isDemo && !isReplay) return <ClinicalDemo />;
  if (isDemo && isReplay) {
    return <DemoApp scenario={params.get("scenario") || "septic_shock"} />;
  }
  return <Board token="dev-token" />;
}

createRoot(document.getElementById("root")).render(pickRoot());
