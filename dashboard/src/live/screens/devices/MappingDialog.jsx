// src/live/screens/devices/MappingDialog.jsx — «Yatağa bağla» and «Bağlantıyı çöz» (spec 2026-10-28
// §3.3–§3.6): pick a bed from the session's own structure (bind only), confirm in one sentence that names
// the monitor and the bed (both monitors when the bed already has one, and the bed a monitor leaves), and
// — only when the SERVER answers `bed_occupied` — a second step of its own, its focus on «Vazgeç».
//
// THE SECOND STEP NAMES A PATIENT ONLY AS «Ahmet Y.», ALWAYS BESIDE THE BED'S LABEL (A-1, A-4, O5): one line
// per bed in the refusal, from the session's own board card (`occupiedNames`); with no card or no name, the
// line says that a patient is on the bed. The short name is shown in this step and nowhere else: not on a
// toast, not in a request body (the server receives the bed and `confirm_occupied`, never a name), not in
// `console.*`. No UUID and no patient number is ever printed. The browser holds no occupancy rule: the
// picker's «dolu» is information, and the server's `bed_occupied` is what opens the step.
//
// ENDING. `onDone(text, fresh)` — a change is over: `text` is the sentence said (and announced by the
// section), `fresh` the list the server answered with, or null when the section has to read it again
// (the mapping changed meanwhile, or a request got no answer and may have landed). `onClose()` — the nurse
// left. Every other refusal stays on the toast with the dialog open: nothing changed, and she reads it.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { bedLabel, normId } from "../../data/structure.js";
import { Button, Modal, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { mayHaveLanded, reasonOf, refusedFor } from "../admin/refusal.js";
import { bedText, monitorName, occupiedNames } from "./deviceMap.js";

// The structure's bed states with a patient (or one about to leave) on them: «dolu» in the picker, information only.
const FULL = new Set(["OCCUPIED", "PENDING_DISCHARGE", "PENDING_TRANSFER_OUT"]);

function BedChoice({ beds, devices, picked, onPick, self }) {
  const { t } = useI18n();
  const onBed = new Map(devices.filter((d) => d.bed?.id && d.source !== self).map((d) => [normId(d.bed.id), d]));
  if (beds.length === 0) return <p className="m-0 text-13">{t("esleme.pick.none")}</p>;
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("esleme.pick.legend")}</legend>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {beds.map((bed) => {
          const other = onBed.get(normId(bed.id));
          return (
            <li key={bed.id} className={bed.open ? "" : "opacity-55"}>
              <label className="inline-flex flex-wrap items-center gap-x-2 text-13.5">
                <input type="radio" name="esleme-bed" value={bed.id} checked={picked === bed.id} disabled={!bed.open}
                  onChange={() => onPick(bed.id)} className={FOCUS_RING} />
                {/* The spaces keep the accessible name readable where the spans are not laid out as flex items. */}
                <span>{bed.label} · {bed.roomName} · {bed.unitName}</span>{" "}
                {!bed.open ? <span className="text-12 text-mute">{t("esleme.pick.closed")}</span> : null}{" "}
                {other ? <span className="text-12 text-mute">{t("esleme.pick.hasMonitor", { monitor: monitorName(other) })}</span> : null}{" "}
                {FULL.has(bed.state) ? <span className="text-12 font-semibold text-att-ink">{t("esleme.pick.occupied")}</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

export function MappingDialog({ mode, device, devices, onClose, onDone }) {
  const { t, lang } = useI18n();
  const { store } = useSession();
  const { patients } = useBoard();
  const { index } = useStructure();
  const toast = useToast();
  const [step, setStep] = useState(mode === "bind" ? "pick" : "confirm");
  const [picked, setPicked] = useState(null);
  const [occupied, setOccupied] = useState([]);    // [{ bedId, name }] from the refusal and the session's board
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);                   // `busy` is state: this stops a second press before it re-renders
  const region = useRef(null);
  const cancel = useRef(null);
  const shownStep = useRef(step);
  const name = monitorName(device);

  // By unit, then room, then label, numbers by value: a unit's beds stay together, "9" before "10".
  const beds = useMemo(() => {
    const cmp = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), lang, { numeric: true });
    return [...index.beds.values()]
      .filter((bed) => normId(bed.id) !== normId(device.bed?.id))
      .sort((a, b) => cmp(a.unitName, b.unitName) || cmp(a.roomName, b.roomName) || cmp(a.label, b.label));
  }, [index, device, lang]);
  const other = picked ? devices.find((d) => d.source !== device.source && normId(d.bed?.id) === normId(picked)) : null;
  const target = picked ? bedLabel(index, picked) : null;
  const leaving = device.bed ? bedText(t, device) : null;

  // A step that opens takes focus off the button that opened it: «Davam» turns into «Onayla» at the same place,
  // and Enter (or a second tap) must not confirm what she has not read. The confirmation takes it on its text;
  // the occupied step on «Vazgeç», so that Enter cancels (spec §3.3 step 3).
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    (step === "occupied" ? cancel.current : region.current)?.focus();
  }, [step]);

  // The bed a refusal for scope concerns. It can be the target, or the bed the monitor LEAVES (the server checks
  // both and answers the same code): the leaving one when it is the one outside the session's units (A-17).
  function scopeBed() {
    if (mode === "unbind") return leaving;
    const leavingOut = Boolean(device.bed) && (!device.bed.in_scope || !index.beds.has(normId(device.bed.id)));
    return leavingOut && target ? leaving : target;
  }

  // A bed of the refusal, named as everywhere else: from the structure, else the one the list gave this monitor.
  const bedName = (id) => bedLabel(index, id)
    ?? (device.bed && normId(device.bed.id) === normId(id) ? leaving : null)
    ?? "—";

  async function send(confirm) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const body = mode === "bind"
      ? { source: device.source, bed_id: picked, confirm_occupied: confirm,
          expected: { device_row_id: device.row_id, bed_row_id: other?.row_id ?? null } }
      : { source: device.source, confirm_occupied: confirm, expected: { device_row_id: device.row_id } };
    try {
      const answer = await store.track(() => (mode === "bind" ? store.api.bindDeviceBed(body) : store.api.unbindDeviceBed(body)));
      const text = !answer?.changed ? t("esleme.done.same")
        : mode === "bind" ? t("esleme.done.bound", { monitor: name, bed: target }) : t("esleme.done.unbound", { monitor: name });
      toast(text);
      onDone(text, answer?.list);
    } catch (err) {
      if (err?.apiCode === "bed_occupied" && !confirm) {
        setOccupied(occupiedNames(err.occupied, patients));
        setStep("occupied");
      } else if (err?.apiCode === "mapping_changed") {
        const text = t("esleme.err.mappingChanged");
        toast(text, "warn");
        onDone(text, null);
      } else {
        const subject = err?.apiCode === "out_of_scope" && scopeBed() ? `${name} · ${scopeBed()}` : name;
        const text = refusedFor(t, subject, reasonOf(t, err));
        toast(text, "error");
        // No answer: it may have landed. What it was to change is not shown as unchanged and not repeated
        // blind — the dialog ends and the list is read again (refusal.js `mayHaveLanded`).
        if (mayHaveLanded(err)) onDone(text, null);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const titles = { pick: t("esleme.pick.title", { monitor: name }), confirm: t("esleme.confirm.title"), occupied: t("esleme.occupied.title") };
  // Each step's buttons are its own (keyed): none carries the focus or a half-made press from the step before.
  const actions = step === "pick" ? (
    <>
      <Button key="pick-cancel" onClick={onClose} busy={busy}>{t("esleme.cancel")}</Button>
      <Button key="pick-next" variant="primary" busy={busy} aria-disabled={picked ? undefined : "true"}
        onClick={() => { if (picked) setStep("confirm"); }}>{t("esleme.pick.next")}</Button>
    </>
  ) : step === "confirm" ? (
    <>
      <Button key="confirm-cancel" onClick={onClose} busy={busy}>{t("esleme.cancel")}</Button>
      <Button key="confirm-ok" variant="primary" busy={busy} onClick={() => send(false)}>{t("esleme.confirm.ok")}</Button>
    </>
  ) : (
    <>
      <Button key="occupied-cancel" ref={cancel} onClick={onClose} busy={busy}>{t("esleme.cancel")}</Button>
      <Button key="occupied-ok" variant="primary" busy={busy} onClick={() => send(true)}>{t("esleme.occupied.ok")}</Button>
    </>
  );

  // One line per bed of the refusal, the target first as the server sends them. A refusal that names none still
  // says that a patient is there.
  const lines = (occupied.length > 0 ? occupied : [{ bedId: mode === "bind" ? picked : device.bed?.id, name: null }]).map((o) => ({
    bed: bedName(o.bedId),
    name: o.name,
    // Values start to flow to the patient of the bed the monitor is going to; they stop for the bed it leaves.
    flow: t(mode === "bind" && normId(o.bedId) === normId(picked) ? "esleme.occupied.flowTo" : "esleme.occupied.flowStop"),
  }));

  return (
    <Modal open title={titles[step]} onClose={onClose} busy={busy} actions={actions}>
      <div ref={region} tabIndex={-1} role="group" aria-label={titles[step]} className="outline-none">
        {step === "pick" ? <BedChoice beds={beds} devices={devices} picked={picked} onPick={setPicked} self={device.source} /> : null}
        {step === "confirm" ? (
          <div className="flex flex-col gap-1.5 text-13.5">
            {mode === "bind" ? <p className="m-0 font-semibold">{t("esleme.confirm.bind", { monitor: name, bed: target })}</p>
              : <p className="m-0 font-semibold">{t("esleme.confirm.unbind", { monitor: name, bed: leaving ?? "—" })}</p>}
            {mode === "bind" && other ? <p className="m-0">{t("esleme.confirm.replace", { other: monitorName(other) })}</p> : null}
            {mode === "bind" && leaving ? <p className="m-0">{t("esleme.confirm.leave", { bed: leaving })}</p> : null}
          </div>
        ) : null}
        {step === "occupied" ? (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-13.5">
            {lines.map((line, at) => (
              <li key={at} className="flex flex-col gap-0.5">
                <p className="m-0 font-semibold">
                  {line.name ? t("esleme.occupied.named", { bed: line.bed, name: line.name }) : `${line.bed}: ${t("esleme.occupied.unnamed")}`}
                </p>
                <p className="m-0">{line.flow}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
