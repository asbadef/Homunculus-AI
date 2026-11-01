// src/live/screens/devices/MappingSection.jsx — «Monitör–yatak eşleme» on the Monitörler screen (spec
// 2026-10-28 §3.2): every monitor the worker reports or the table holds, its central station name,
// whether it is seen, its bed (named from the server's names, or «başka birimde») and — for a
// holder of devices.map_beds on a monitor she may change — «Yatağa bağla» / «Bağlantıyı çöz».
// Read every POLL_MS while on screen and right after each change. No patient anywhere here.
import React, { useCallback, useEffect, useId, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { POLL_MS } from "../../data/shadowStore.js";
import { Announce, Button, Note, Table } from "../../ui/index.js";
import { bedText, monitorName, visibility } from "./deviceMap.js";
import { MappingDialog } from "./MappingDialog.jsx";

function Row({ device, onAct }) {
  const { t } = useI18n();
  const name = monitorName(device);
  const seen = visibility(device);
  const bound = Boolean(device.bed);
  return (
    <tr>
      <td className="font-data">{device.source} · {device.port}<span className="block text-12 text-mute">{device.group}</span></td>
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

export function MappingSection() {
  const { t } = useI18n();
  const { store } = useSession();
  const headId = useId();
  const [state, setState] = useState({ phase: "loading", body: null });
  const [dialog, setDialog] = useState(null);       // {mode: "bind" | "unbind", device}
  const [said, setSaid] = useState("");

  const load = useCallback(async () => {
    try {
      // Inside `track`, as every screen's call is (sessionStore.js `api`): a refused refresh ends the session here too.
      const body = await store.track(() => store.api.deviceBeds());
      if (!body || !Array.isArray(body.devices)) throw new Error("not a list");
      setState({ phase: "ok", body });
    } catch (err) {
      setState((was) => ({ phase: err?.apiCode === "monitor_lane_off" ? "off" : "unreadable", body: was.body }));
    }
  }, [store]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const { phase, body } = state;
  return (
    <section aria-labelledby={headId} className="flex flex-col gap-2">
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
              {body.devices.map((d) => <Row key={d.source} device={d} onAct={(mode, device) => setDialog({ mode, device })} />)}
            </tbody>
          </Table>
        )
      ) : null}
      <Announce text={said} />
      {dialog ? (
        <MappingDialog mode={dialog.mode} device={dialog.device} devices={body?.devices ?? []}
          onClose={() => setDialog(null)}
          onDone={(text, fresh) => {
            setDialog(null);
            setSaid(text);
            if (fresh && Array.isArray(fresh.devices)) setState({ phase: "ok", body: fresh });
            else load();
          }} />
      ) : null}
    </section>
  );
}
