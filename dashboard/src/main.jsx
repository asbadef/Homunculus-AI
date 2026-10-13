import "@fontsource-variable/figtree";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { DemoDataBanner } from "./DemoDataBanner.jsx";
import { LoadBoundary } from "./LoadFailed.jsx";

/**
 * Which mode a URL selects. Exported so the routing is testable without a DOM.
 *
 * The bare URL — no query string at all — is the live system: the address a clinician
 * naturally types must be the real one, not a simulation. `?demo=1` keeps the simulation
 * reachable for anyone who wants it deliberately. `?live=1` remains honoured for old links
 * and, being an explicit ask for the real system, wins over a simultaneous `?demo=1`: showing
 * simulated data by accident is the worse failure of the two. The replay (`?mode=replay`,
 * `?scenario=`) and the legacy board (`?board=1`) are gone (G1-16): their addresses open the
 * live system, and `withoutRetired` takes their parameters out of the address.
 */
export function chooseMode(params) {
  if (params.get("live") === "1") return "live";
  if (params.get("demo") === "1") return "demo";
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
  // The previous live workspace (LDAP ClinicalDemo on the real API), kept reachable as the
  // reference Wave 3 ports from; removed with the demo in G1-16.
  if (params.get("eski") === "1") return "eski";
  return "live";
}

/** Parameters only a removed root read. `mode` is retired only as `mode=replay`: another value
 *  is not this page's to take away. */
const RETIRED_PARAMS = Object.freeze(["board", "token", "scenario"]);

/**
 * The address an old bookmark is left with once the parameters of the roots G1-16 removed are
 * taken out — or null when it carries none, and must not be touched. Exported for its tests.
 *
 * Such an address opens the live system (chooseMode), so it must stop saying otherwise: a bar
 * reading `?mode=replay` above real patients is a claim, and `?board=1&token=…` kept a tenant
 * token in the address, the history and every bookmark made from it. Everything else stays —
 * the path, any other parameter and the hash, which is a deep link the live UI uses once.
 */
export function withoutRetired({ pathname, search, hash }) {
  const query = new URLSearchParams(search);
  let changed = false;
  for (const key of RETIRED_PARAMS) {
    if (query.has(key)) {
      query.delete(key);
      changed = true;
    }
  }
  if (query.get("mode") === "replay") {
    query.delete("mode");
    changed = true;
  }
  if (!changed) return null;
  const rest = query.toString();
  return `${pathname}${rest ? `?${rest}` : ""}${hash}`;
}

// Once, before anything renders: LiveApp keeps `location.search` whenever it clears the hash, so a
// retired parameter left here would stay in the bar for the whole session.
const cleaned = withoutRetired(window.location);
if (cleaned !== null) window.history.replaceState(window.history.state, "", cleaned);
const params = new URLSearchParams(window.location.search);

function pickRoot(mode) {
  // The live system: the new shell (G1-07/G1-08), on the real API and nothing simulated.
  if (mode === "live") {
    return <React.Suspense fallback={null}><LiveApp /></React.Suspense>;
  }
  if (mode === "tasarim") {
    return <React.Suspense fallback={null}><DesignGallery /></React.Suspense>;
  }
  // Everything else — the previous live workspace (?eski=1) and the simulation (?demo=1) — is one
  // lazy chunk of its own, so the live page never downloads a simulation it does not render
  // (legacyRoots.jsx).
  return <React.Suspense fallback={null}><LegacyRoot mode={mode} /></React.Suspense>;
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
 * The banner belongs only to the simulation, which draws from fabricated data and says so. Live
 * talks to the real API — labelling it as demonstration data would be false, and a notice that
 * is sometimes wrong is worse than none, because people stop reading it.
 */
export function AppShell({ mode, children }) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {mode === "demo" ? (
        <div className="shrink-0"><DemoDataBanner /></div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

const el = document.getElementById("root");
if (el) {
  // Every root but the first is fetched on demand, and a fetch that fails throws during render:
  // without the boundary a ward PC with no network — or a tablet still holding a service worker
  // from before a deploy — showed a blank white page (LoadFailed.jsx).
  createRoot(el).render(
    <AppShell mode={mode}><LoadBoundary>{pickRoot(mode)}</LoadBoundary></AppShell>,
  );
}
