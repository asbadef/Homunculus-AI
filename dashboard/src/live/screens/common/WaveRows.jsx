// src/live/screens/common/WaveRows.jsx — the drawn rows of a waveform panel (Lane C, dalga): one
// <canvas> per row waveGeometry.js `rowsOf` gives the monitor — ECG (chosen by liveness, never named
// by lead), pressure, pleth, resp — redrawn on every animation frame. Shared by the panel and its
// full-screen view.
//
// What a row SAYS is DOM text, not pixels, so a screen reader and a test read it: its label, its
// unit or "göreli", the evidence word and — over the trace, on the row's own ground — "dalga
// bekleniyor", "sinyal yok", "akış durdu · N sn" or "akış durdu · N sn · iz kaldırıldı". No number
// made from a sample is ever printed (spec §5.4).
// A stalled row is drawn frozen and faded; a cleared one is blank. Colours are plain ink (white on
// the full-screen black): a monitor value is never dressed in a vital's colour (the strip's
// Decision 14).
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { headAt, nextAnchor, rowView, rowsOf } from "./waveGeometry.js";

const defaultRaf = (fn) => (typeof requestAnimationFrame === "function"
  ? requestAnimationFrame(fn) : setTimeout(() => fn(performance.now()), 50));
const defaultCaf = (id) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));
const EVIDENCE = new Set(["structural", "unverified", "screen_scale"]);

/** The row's name: "EKG" for every ECG channel (the lead is not verified), else the monitor's own
 *  label from the catalogue ("ART", "P1", "Pleth", "RESP"), else the kind's word. */
function rowLabel(t, row, catalogue) {
  if (row.kind === "ecg") return t("waves.ecg");
  const label = catalogue?.[row.id]?.label;
  return typeof label === "string" && label ? label : t(`waves.kind.${row.kind}`);
}

function rowNote(t, row, catalogue) {
  const evidence = catalogue?.[row.id]?.evidence;
  const ev = t(`waves.ev.${EVIDENCE.has(evidence) ? evidence : "unverified"}`);
  if (row.kind === "ecg") return `${t("waves.ecgLead")} · ${ev}`;
  if (row.kind === "pressure") return `${t("board.unitMmhg")} · ${ev}`;
  return `${t("waves.relative")} · ${ev}`;
}

function overlay(t, s) {
  if (!s) return null;
  if (s.state === "cleared") return t("waves.cleared", { seconds: s.seconds });
  if (s.state === "stalled") return t("waves.stalled", { seconds: s.seconds });
  if (s.state === "nosignal") return t("waves.noSignal");
  if (s.state === "waiting") return t("waves.waiting");
  return null;
}

/** The canvas's drawing buffer at its CSS size × devicePixelRatio. */
function fit(canvas) {
  if (!canvas) return { width: 0, height: 0, dpr: 1 };
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const width = canvas.clientWidth || 0;
  const height = canvas.clientHeight || 0;
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return { width, height, dpr };
}

function paint(canvas, size, view) {
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return;
  // The whole backing store is cleared, in device pixels, before anything is drawn in CSS pixels.
  // The store is round(CSS size × dpr) pixels, so a clear in CSS pixels under the dpr transform can
  // stop half a pixel short of its last column (866 × 1.25 = 1082.5 of 1083). A GPU-rastered canvas
  // then never clears that column, and every stroke that ever touched the right edge piled up there:
  // a vertical line over the trace's whole height, a line where there is no data (walk 2026-11-02, P3).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  if (view.paths.length === 0 && view.grid.length === 0) return;
  const color = (typeof getComputedStyle === "function" && getComputedStyle(canvas).color) || "#888888";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  for (const y of view.grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  for (const path of view.paths) {
    ctx.beginPath();
    ctx.moveTo(path[0], path[1]);
    for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
    ctx.stroke();
  }
  for (const [x, edge] of view.clips) {           // a small triangle on the edge the trace went past
    const y = edge === "top" ? 0 : size.height;
    const dir = edge === "top" ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x, y + 5 * dir);
    ctx.closePath();
    ctx.fill();
  }
}

const sameStates = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length
    && ka.every((k) => b[k] && a[k].state === b[k].state && a[k].seconds === b[k].seconds);
};

/** `device`: the wave store's state of one monitor. `tall`: the full-screen look. `raf`/`caf` are
 *  for the tests (a hand-driven frame clock); the page uses the browser's. */
export function WaveRows({ device, tall = false, raf = defaultRaf, caf = defaultCaf }) {
  const { t } = useI18n();
  const rows = rowsOf(device.blocks, device.catalogue);
  const canvases = useRef(new Map());
  const latest = useRef(device);
  latest.current = device;
  const [states, setStates] = useState({});

  useEffect(() => {
    let handle = null;
    let anchor = null;
    let seen = null;
    let lastPerf = null;
    const ranges = new Map();
    const frame = (perfMs) => {
      const d = latest.current;
      if (d.sample && d.sample !== seen) {
        anchor = nextAnchor(anchor, d.sample);
        seen = d.sample;
      }
      const head = headAt(anchor, perfMs);
      const dt = lastPerf === null ? 0 : Math.max(0, (perfMs - lastPerf) / 1000);
      lastPerf = perfMs;
      const next = {};
      for (const row of rowsOf(d.blocks, d.catalogue)) {
        const canvas = canvases.current.get(row.id);
        const size = fit(canvas);
        const view = rowView(d.blocks[row.id] ?? [], row.kind, head, size, ranges.get(row.id) ?? null, dt);
        ranges.set(row.id, view.range ?? null);
        // A canvas measuring 0 (not laid out, or hidden) is not drawn on: fit() has emptied it. Its
        // row still says its state below.
        if (size.width > 0 && size.height > 0) paint(canvas, size, view);
        next[row.id] = { state: view.state, seconds: view.silentS === null ? null : Math.floor(view.silentS) };
      }
      setStates((previous) => (sameStates(previous, next) ? previous : next));
      handle = raf(frame);
    };
    handle = raf(frame);
    return () => caf(handle);
  }, [raf, caf]);

  return (
    <ul data-wave-rows="" className="m-0 mt-1.5 grid list-none gap-1.5 p-0">
      {rows.map((row) => {
        const s = states[row.id];
        const text = overlay(t, s);
        const label = rowLabel(t, row, device.catalogue);
        return (
          <li key={row.id} data-wave-row={row.kind} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-2">
            <div className="min-w-0">
              <p className={`m-0 font-text text-11 font-bold uppercase leading-[normal] tracking-[.06em] ${tall ? "text-white" : "text-mute"}`}>{label}</p>
              <p className={`m-0 font-text text-10.5 leading-[normal] ${tall ? "text-white/70" : "text-mute"}`}>{rowNote(t, row, device.catalogue)}</p>
            </div>
            <div className={`relative ${tall ? "h-[18vh] min-h-[90px]" : "h-14"}`}>
              <canvas
                ref={(el) => { if (el) canvases.current.set(row.id, el); else canvases.current.delete(row.id); }}
                role="img" aria-label={t("waves.canvas", { label })} data-state={s?.state ?? "waiting"}
                className={`block h-full w-full ${tall ? "text-white" : "text-ink"} ${s?.state === "stalled" ? "opacity-40" : ""}`}
              />
              {text ? (
                <p className="pointer-events-none absolute inset-0 m-0 grid place-items-center font-text text-12 font-semibold">
                  {/* On the row's own ground (the panel's card, the full screen's black), so a frozen
                      trace does not run through the words. */}
                  <span className={`rounded-ctl px-1.5 py-0.5 ${tall ? "bg-black text-amber-300" : "bg-card text-att-ink"}`}>
                    {text}
                  </span>
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
