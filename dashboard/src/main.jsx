import "@fontsource-variable/figtree";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { DemoDataBanner } from "./DemoDataBanner.jsx";

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
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
  // The previous live workspace (LDAP ClinicalDemo on the real API), kept reachable as the
  // reference Wave 3 ports from; removed with the demo in G1-16.
  if (params.get("eski") === "1") return "eski";
  return "live";
}

function pickRoot(mode) {
  // The live system: the new shell (G1-07/G1-08), on the real API and nothing simulated.
  if (mode === "live") {
    return <React.Suspense fallback={null}><LiveApp /></React.Suspense>;
  }
  if (mode === "tasarim") {
    return <React.Suspense fallback={null}><DesignGallery /></React.Suspense>;
  }
  // Everything else — the previous live workspace (?eski=1), the simulation (?demo=1), the replay
  // demonstration and the legacy bearer-token board — is one lazy chunk of its own, so the live
  // page never downloads a simulation it does not render (legacyRoots.jsx).
  return <React.Suspense fallback={null}><LegacyRoot mode={mode} params={params} /></React.Suspense>;
}

// Lazy: the gallery and its fonts load only when ?tasarim=1 asks for them.
const DesignGallery = React.lazy(() => import("./live/gallery/DesignGallery.jsx"));
// Lazy too: the new live UI, its fonts and tokens load only in live mode.
const LiveApp = React.lazy(() => import("./live/LiveApp.jsx"));
// And the roots that are not the live system, which are the bulk of the bundle.
const LegacyRoot = React.lazy(() => import("./legacyRoots.jsx"));

// #/demo is an older deep link into the simulation; honour it ahead of the query string.
const mode = window.location.hash.startsWith("#/demo") ? "demo" : chooseMode(params);

/**
 * The page frame. Exported so its layout contract is testable.
 *
 * Örnek-veri bandı uygulamanın üstüne ekleniyor; sayfa yüksekliği bu yüzden ekranı aşıyordu ve
 * giriş ekranı tek ekran olmasına rağmen kayıyordu. Kabuk ekranı paylaştırıyor: bant kendi
 * yüksekliğini alır, uygulama kalanı.
 *
 * The frame is exactly one screen tall and hides its own overflow, so the page itself never
 * scrolls. The app's wrapper MUST therefore scroll (`overflow-y-auto`): the LDAP ClinicalDemo
 * relies on page scroll, and without it everything below the first screen — a bed below the
 * fold, i.e. a patient — is unreachable (measured 1366x768: 3032 px of content in 672 px).
 *
 * The banner belongs only to the simulation: demo and replay both draw from fabricated data, so
 * both say so. Live and board talk to the real API — labelling them as demonstration data would
 * be false, and a notice that is sometimes wrong is worse than none, because people stop reading it.
 */
export function AppShell({ mode, children }) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {mode === "demo" || mode === "replay" ? (
        <div className="shrink-0"><DemoDataBanner /></div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<AppShell mode={mode}>{pickRoot(mode)}</AppShell>);
}
