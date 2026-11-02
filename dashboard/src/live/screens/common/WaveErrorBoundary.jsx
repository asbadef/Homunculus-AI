// src/live/screens/common/WaveErrorBoundary.jsx — the wave panel's own error boundary (Lane A, I3).
//
// The waves are UNVALIDATED research decoding (WavePanel.jsx), and they are drawn inside the tree
// that carries the alarm sound and the critical-alarm notification: AlarmSignals wraps the phases,
// the screens and so the panel (LiveApp.jsx). An error React finds no boundary for unmounts the
// whole root, the alarm signals with it — the sound is cut (alarmSound.js `close`) and the ward is
// left with main.jsx's "the page could not be loaded". This boundary keeps a failure of the waves
// to the waves:
//   * It catches what React hands a boundary: an error while rendering, in a lifecycle method or in
//     an effect, of any child — a portal child (the full screen) too, since React follows the
//     component tree, not the DOM.
//   * In their place it draws the panel's frame and heading with the panel's own word for a stream
//     it cannot show, «Dalga akışı yok» (`waves.unavailable`): never a trace, never a blank box,
//     never the error. There is no wave in it, so it carries no stamp.
//   * It does not try again by itself: the same children would throw again. Only a new `resetKey`
//     (another monitor) renders them once more.
//   * It warns once per failure and names the error's type only: a message could carry what the
//     panel was drawing.
// React hands it nothing thrown in a frame callback, a timer or an event handler. Those leave the
// tree, and the alarm signals, mounted.
import React, { useId } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Note } from "../../ui/index.js";

/** The error's type for the console: its `name` when that is a plain identifier, else its
 *  JavaScript type (a thrown string is "string"). Never its message. */
function errorType(error) {
  const name = error?.name;
  return typeof name === "string" && /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : typeof error;
}

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    // `episode` counts the monitors shown, so that a failure is warned about once however many
    // errors it raised (two effects throwing in one commit are one failure).
    this.state = { failed: false, resetKey: props.resetKey, episode: 0 };
    this.warned = -1;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props, state) {
    if (Object.is(props.resetKey, state.resetKey)) return null;
    return { failed: false, resetKey: props.resetKey, episode: state.episode + 1 };
  }

  componentDidCatch(error) {
    if (this.warned === this.state.episode) return;
    this.warned = this.state.episode;
    console.warn(`Homunculus: the waveform panel stopped after an error (${errorType(error)}); `   // eslint-disable-line no-console
      + "it says there is no wave stream until another monitor is shown.");
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { id, heading, note, className } = this.props;
    return (
      <section aria-labelledby={id} data-wave-panel="" data-wave-failed=""
        className={`rounded-ctl border border-dashed border-line2 px-2.5 py-2 ${className}`}>
        <h3 id={id} className="m-0 font-text text-11.5 font-bold leading-[normal] text-ink">{heading}</h3>
        <Note className="mt-1.5">{note}</Note>
      </section>
    );
  }
}

/**
 * Wraps one monitor's wave panel. `resetKey`: what names that monitor (the strip card's `source`):
 * a new one lets the children render again, the same one never does. `title`: the panel's own
 * title (the bed label), for the fallback's heading. `className`: the panel's layout classes, so
 * the fallback sits where the panel sat. While nothing fails it renders the children and nothing
 * else.
 */
export function WaveErrorBoundary({ resetKey, title, className = "", children }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <Boundary resetKey={resetKey} id={id} className={className}
      heading={title ? `${title} · ${t("waves.title")}` : t("waves.title")} note={t("waves.unavailable")}>
      {children}
    </Boundary>
  );
}
