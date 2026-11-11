// src/live/screens/devices/MappingSection.jsx — «Monitör–yatak eşleme» on the Monitörler screen (spec
// 2026-10-28 §3.2): every monitor the worker reports or the table holds, its central station name,
// whether it is seen, its bed (named from the server's names, or «başka birimde») and — for a
// holder of devices.map_beds on a monitor she may change — «Yatağa bağla» / «Bağlantıyı çöz».
// Read every POLL_MS while on screen and right after each change. No patient anywhere here.
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { POLL_MS } from "../../data/shadowStore.js";
import { Announce, Button, Note, Table } from "../../ui/index.js";
import { bedText, monitorName, visibility } from "./deviceMap.js";
import { MappingDialog } from "./MappingDialog.jsx";

// Either says hidden, it is hidden: a browser keeps the two in step, and a page that says so through only one
// of them still costs the ward nothing (the same rule as data/shadowStore.js, whose helper is private to it).
const pageVisible = () => typeof document === "undefined"
  || (document.visibilityState !== "hidden" && document.hidden !== true);

function Row({ device, onAct }) {
  const { t } = useI18n();
  const name = monitorName(device);
  const seen = visibility(device);
  const bound = Boolean(device.bed);
  return (
    <tr data-source={device.source}>
      {/* The monitor names its row, so a screen reader reads its address with each cell of it. */}
      <th scope="row" className="font-data font-semibold">{device.source} · {device.port}<span className="block text-12 text-mute">{device.group}</span></th>
      <td className="font-data">{device.device_bed_label ?? "—"}</td>
      <td>{t(seen.key, seen.vars)}</td>
      <td>{bedText(t, device)}</td>
      <td>
        {device.editable ? (
          <span className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => onAct("bind", device)}
              aria-label={t(bound ? "esleme.rebindFor" : "esleme.bindFor", { monitor: name })}>
              {t(bound ? "esleme.rebind" : "esleme.bind")}
            </Button>
            {bound ? (
              <Button size="sm" onClick={() => onAct("unbind", device)} aria-label={t("esleme.unbindFor", { monitor: name })}>
                {t("esleme.unbind")}
              </Button>
            ) : null}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function MappingSection({ onList } = {}) {
  const { t } = useI18n();
  const { store } = useSession();
  const headId = useId();
  const [state, setState] = useState({ phase: "loading", body: null });
  const [dialog, setDialog] = useState(null);       // {mode: "bind" | "unbind", device}
  // What the last change said. A live region speaks only when its text CHANGES, so the same sentence twice in a
  // row (two monitors unbound one after the other, both «no change») would be heard once. `n` counts the sayings
  // and keys the region: each one is a fresh, empty region that takes its text a moment later (A-20).
  const [said, setSaid] = useState({ n: 0, text: "" });
  const root = useRef(null);
  const returnTo = useRef(null);                     // the source of the monitor whose dialog is, or just was, open
  // Every read takes a number, and so does every list handed in from outside (a finished change): an
  // answer that is not the newest number is dropped, whatever order the reads land in. A read started
  // before a bind must never put the old bed back on screen (as StructureProvider's `seq`).
  const seq = useRef(0);
  const alive = useRef(true);
  const reading = useRef(0);                         // the poll's read that is out, so a slow one is not stacked on

  const load = useCallback(async (poll = false) => {
    // A hidden tab costs the ward nothing; it reads again the moment it is seen (the effect below).
    if (!pageVisible() || (poll && reading.current !== 0)) return;
    const mine = ++seq.current;
    reading.current = mine;
    try {
      // Inside `track`, as every screen's call is (sessionStore.js `api`): a refused refresh ends the session here too.
      const body = await store.track(() => store.api.deviceBeds());
      if (!alive.current || mine !== seq.current) return;
      if (!body || !Array.isArray(body.devices)) throw new Error("not a list");
      setState({ phase: "ok", body });
    } catch (err) {
      if (!alive.current || mine !== seq.current) return;
      setState((was) => ({ phase: err?.apiCode === "monitor_lane_off" ? "off" : "unreadable", body: was.body }));
    } finally {
      if (reading.current === mine) reading.current = 0;
    }
  }, [store]);

  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(() => load(true), POLL_MS);
    const seen = () => { if (pageVisible()) load(); };
    document.addEventListener("visibilitychange", seen);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", seen);
    };
  }, [load]);

  // When the dialog ends, focus goes back to the button it started from (the Modal does that). An unbind takes that
  // button away with the bond, and focus would fall to <body>, so a keyboard user would lose her place in the page:
  // it goes to the monitor's row instead, to the button that is left there (spec §3.6).
  useEffect(() => {
    if (dialog !== null || returnTo.current === null) return;
    const source = returnTo.current;
    returnTo.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const row = [...(root.current?.querySelectorAll("tr[data-source]") ?? [])].find((tr) => tr.dataset.source === source);
    row?.querySelector("button")?.focus();
  }, [dialog]);

  // G4-01: the page's «Tabloda var, hiç görülmedi» reads this same list, so the page asks for it once (D5 §5).
  useEffect(() => { onList?.(state); }, [state, onList]);

  const { phase, body } = state;
  return (
    <section ref={root} aria-labelledby={headId} className="flex flex-col gap-2">
      <div>
        <h2 id={headId} className="m-0 font-display text-17 font-bold">{t("esleme.title")}</h2>
        <p className="m-0 text-13 text-mute">{t("esleme.sub")}</p>
      </div>
      {phase === "loading" && !body ? <p className="m-0 text-13 text-mute">{t("esleme.loading")}</p> : null}
      {phase === "off" ? <Note tone="info">{t("esleme.err.laneOff")}</Note> : null}
      {phase === "unreadable" ? <Note>{t("esleme.unreadable")}</Note> : null}
      {body && phase !== "off" ? (
        body.devices.length === 0 ? <p className="m-0 text-13 text-mute">{t("esleme.empty")}</p> : (
          <Table caption={t("esleme.caption")}>
            <thead>
              <tr>
                {["monitor", "station", "visibility", "bed", "actions"].map((col) => (
                  <th key={col} scope="col">{t(`esleme.col.${col}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.devices.map((d) => (
                <Row key={d.source} device={d} onAct={(mode, device) => { returnTo.current = device.source; setDialog({ mode, device }); }} />
              ))}
            </tbody>
          </Table>
        )
      ) : null}
      <Announce key={said.n} text={said.text} />
      {dialog ? (
        <MappingDialog mode={dialog.mode} device={dialog.device} devices={body?.devices ?? []}
          onClose={() => setDialog(null)}
          onDone={(text, fresh) => {
            setDialog(null);
            setSaid((was) => ({ n: was.n + 1, text }));
            // The change is done: a read that was already out may carry the bed from before it.
            seq.current += 1;
            if (fresh && Array.isArray(fresh.devices)) setState({ phase: "ok", body: fresh });
            else load();
          }} />
      ) : null}
    </section>
  );
}
