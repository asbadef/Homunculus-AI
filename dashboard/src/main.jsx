import "@fontsource-variable/figtree";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { LoadBoundary } from "./LoadFailed.jsx";

/**
 * Which mode a URL selects. Exported so the routing is testable without a DOM.
 *
 * There is one product: the bare URL — the address a clinician naturally types — is the live
 * system, and so is every other address but the design gallery's. `?live=1` remains honoured for
 * old links and, being an explicit ask for the real system, wins over `?tasarim=1`.
 *
 * G1-16 removed every root that was not the live system: the simulation (`?demo=1`, `#/demo`), the
 * previous live workspace (`?eski=1`), the replay (`?mode=replay`, `?scenario=`) and the legacy
 * bearer-token board (`?board=1`). Their addresses open the live system, and `withoutRetired`
 * takes their parameters out of the address bar.
 */
export function chooseMode(params) {
  if (params.get("live") === "1") return "live";
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
  return "live";
}

/** Parameters only a removed root read. `mode` is retired only as `mode=replay`: another value
 *  is not this page's to take away. */
const RETIRED_PARAMS = Object.freeze(["demo", "eski", "board", "token", "scenario"]);
/** The simulation's oldest entry, from before `?demo=1`: `#/demo` and anything under it. */
const RETIRED_HASH = /^#\/demo(?:[/?#]|$)/;

/**
 * The address an old bookmark is left with once the parameters of the roots G1-16 removed are
 * taken out — or null when it carries none, and must not be touched. Exported for its tests.
 *
 * Such an address opens the live system (chooseMode), so it must stop saying otherwise: a bar
 * reading `?demo=1` above real patients is a claim, and `?board=1&token=…` kept a tenant token in
 * the address, the history and every bookmark made from it. Everything else stays — the path, any
 * other parameter and the hash, which is a deep link the live UI uses once.
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
  let rest = hash;
  if (RETIRED_HASH.test(hash)) {
    rest = "";
    changed = true;
  }
  if (!changed) return null;
  const kept = query.toString();
  return `${pathname}${kept ? `?${kept}` : ""}${rest}`;
}

// Once, before anything renders: LiveApp keeps `location.search` whenever it clears the hash, so a
// retired parameter left here would stay in the bar for the whole session.
const cleaned = withoutRetired(window.location);
if (cleaned !== null) window.history.replaceState(window.history.state, "", cleaned);

function pickRoot(mode) {
  if (mode === "tasarim") {
    return <React.Suspense fallback={null}><DesignGallery /></React.Suspense>;
  }
  // The live system: the new shell (G1-07/G1-08), on the real API and nothing simulated.
  return <React.Suspense fallback={null}><LiveApp /></React.Suspense>;
}

// Lazy: the gallery and its fonts load only when ?tasarim=1 asks for them.
const DesignGallery = React.lazy(() => import("./live/gallery/DesignGallery.jsx"));
// Lazy too: the live UI, its fonts and tokens are not in the first chunk, so a page that cannot
// fetch them still has LoadFailed.jsx to say so.
const LiveApp = React.lazy(() => import("./live/LiveApp.jsx"));

const mode = chooseMode(new URLSearchParams(window.location.search));

/**
 * The page frame. Exported so its layout contract is testable.
 *
 * The frame is exactly one screen tall and hides its own overflow, so the page itself never
 * scrolls. The app's wrapper MUST therefore scroll (`overflow-y-auto`): without it everything
 * below the first screen — a bed below the fold, i.e. a patient — is unreachable (measured
 * 1366x768 on the previous workspace: 3032 px of content in 672 px).
 */
export function AppShell({ children }) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

const el = document.getElementById("root");
if (el) {
  // Every root is fetched on demand, and a fetch that fails throws during render: without the
  // boundary a ward PC with no network — or a tablet still holding a service worker from before a
  // deploy — showed a blank white page (LoadFailed.jsx).
  createRoot(el).render(
    <AppShell><LoadBoundary>{pickRoot(mode)}</LoadBoundary></AppShell>,
  );
}
