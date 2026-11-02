// src/live/screens/common/WavePanel.jsx — the live waveform panel (Lane C, dalga; spec §3.3, §4, §5).
//
// UNVALIDATED research decoding of a bedside monitor's waveform blocks, drawn about 2 s behind the
// monitor, for a monitor the strip already shows. The safety rules, each held by a test:
//   1. The stamp is on screen whenever anything of the panel is (§5.1), in full screen too.
//   2. "No signal" is never a flat line (§5.2): a no-signal block draws nothing and the row says so.
//   3. Stalls are loud (§5.3): frozen, faded and "akış durdu · N sn" 1.5 s after the render time
//      reaches the end of the data; cleared, and said, 10 s after it.
//   4. No number from a wave (§5.4): the rows print labels and states, never a value.
//   5. The patient binding is the caller's (§5.5): the patient screen mounts this only for the
//      strip's `link === "one"`.
//   6. Nothing stored (§5.6) and 8. no sound of any kind (§5.8) — waveBoundaries.test.js.
// It polls only while open, mounted and visible (data/waveStore.js). On the patient screen it
// draws nothing until the first answer, and nothing when waves are off (409): it does not
// advertise a panel it cannot fill. On the device screen it is opened by hand (`collapsible`), so
// there it says why it shows nothing.
import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { WAVE_STATUS, waveStoreFor } from "../../data/waveStore.js";
import { Button, Note, Tag } from "../../ui/index.js";
import { WaveRows } from "./WaveRows.jsx";
import { WaveFullscreen } from "./WaveFullscreen.jsx";

const NOTE = {
  [WAVE_STATUS.UNAVAILABLE]: "waves.unavailable",
  [WAVE_STATUS.GONE]: "waves.gone",
  [WAVE_STATUS.DENIED]: "waves.denied",
  [WAVE_STATUS.OFF]: "waves.off",
};
const QUIET = new Set([WAVE_STATUS.IDLE, WAVE_STATUS.LOADING, WAVE_STATUS.OFF]);

function OpenPanel({ store, source, title, collapsible, onHide, hideRef, raf, caf, className }) {
  const { t } = useI18n();
  const id = useId();
  const [full, setFull] = useState(false);
  const fullRef = useRef(null);
  const headRef = useRef(null);
  useEffect(() => store.watch(source), [store, source]);
  const device = useSyncExternalStore(store.subscribe, () => store.get(source));
  const { status } = device;
  const quiet = QUIET.has(status);
  const hasRows = Object.keys(device.blocks).length > 0;
  // Full screen shows rows. With none left to show — a refusal dropped them, the waves went off — it
  // closes, and stays closed: an answer that comes later never reopens it by itself.
  const fullOpen = full && hasRows && !quiet;
  /** The focus back into the panel: ⤢ while there are rows, else the hide button, else the heading. */
  const focusBack = () => (fullRef.current ?? hideRef?.current ?? headRef.current)?.focus();
  useEffect(() => {
    if (!full || fullOpen) return;
    setFull(false);
    // The × had the focus, and went with the view: the panel takes it, rather than <body>.
    if (!document.activeElement || document.activeElement === document.body) focusBack();
  }, [full, fullOpen]);
  if (!collapsible && quiet) return null;
  const noteKey = NOTE[status];
  const waiting = status === WAVE_STATUS.LOADING || (status === WAVE_STATUS.OK && !hasRows);
  const closeFull = () => {
    setFull(false);
    focusBack();
  };
  return (
    <section aria-labelledby={id} data-wave-panel="" className={`rounded-ctl border border-dashed border-line2 px-2.5 py-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={id} ref={headRef} tabIndex={-1} className="m-0 font-text text-11.5 font-bold leading-[normal] text-ink outline-none">
          {title ? `${title} · ${t("waves.title")}` : t("waves.title")}
        </h3>
        <Tag tone="warn">{t("waves.tag")}</Tag>
        <span className="font-text text-11 text-mute">{t("waves.delay")}</span>
        <span className="ml-auto flex gap-1">
          {hasRows ? (
            <Button ref={fullRef} variant="ghost" size="sm" icon="fullscreen" label={t("waves.fullscreen")}
              onClick={() => setFull(true)} />
          ) : null}
          {collapsible ? <Button ref={hideRef} variant="ghost" size="sm" icon="x" label={t("waves.hide")} onClick={onHide} /> : null}
        </span>
      </div>
      <p data-wave-stamp="" className="m-0 mt-1 font-text text-11.5 font-semibold text-att-ink">{t("waves.stamp")}</p>
      {noteKey ? <Note className="mt-1.5">{t(noteKey)}</Note> : null}
      {waiting ? <p className="m-0 mt-1.5 font-text text-12 text-mute">{t("waves.waiting")}</p> : null}
      {hasRows && !fullOpen ? <WaveRows device={device} raf={raf} caf={caf} /> : null}
      {/* The panel's note is behind the black while full screen is open: it goes along, said there too. */}
      {fullOpen ? (
        <WaveFullscreen source={source} title={title} device={device} note={noteKey ? t(noteKey) : null}
          onClose={closeFull} raf={raf} caf={caf} />
      ) : null}
    </section>
  );
}

/**
 * One monitor's waves. `source`: the strip card's address. `title`: the bed label (or the device
 * screen's own title). `collapsible`: closed behind a button until opened (the device screen, so
 * that a list of monitors polls none of them by itself). `store`, `raf`, `caf`: for the tests; the
 * page uses the session's wave store and the browser's frame clock.
 *
 * Another `source` is another panel (`key`): the old monitor is let go, the new one watched, and
 * nothing of the old one's — its full screen least of all — carries over.
 */
export function WavePanel({ source, title, collapsible = false, store, raf, caf, className = "" }) {
  const { t } = useI18n();
  const { store: session } = useSession();
  const waves = store ?? waveStoreFor(session);
  const [open, setOpen] = useState(!collapsible);
  const showRef = useRef(null);
  const hideRef = useRef(null);
  // A press on «göster» or «gizle» replaces the button pressed: the focus goes to the one that took
  // its place, rather than to <body>.
  const pressed = useRef(false);
  useEffect(() => {
    if (!pressed.current) return;
    pressed.current = false;
    (open ? hideRef : showRef).current?.focus();
  }, [open]);
  const toggle = (next) => {
    pressed.current = true;
    setOpen(next);
  };
  if (!source) return null;
  if (!open) {
    return (
      <div className={className}>
        <Button ref={showRef} variant="ghost" size="sm" icon="activity" onClick={() => toggle(true)}>{t("waves.show")}</Button>
      </div>
    );
  }
  return (
    <OpenPanel key={source} store={waves} source={source} title={title} collapsible={collapsible}
      onHide={() => toggle(false)} hideRef={hideRef} raf={raf} caf={caf} className={className} />
  );
}
