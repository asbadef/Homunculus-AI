// src/demo.jsx — self-contained demo: fetch a recorded timeline, replay it through <Board>.
import React, { useEffect, useState } from "react";
import { Board } from "./Board.jsx";
import { makeDemoTransport } from "./demoTransport.js";

export function DemoApp({ scenario = "septic_shock" }) {
  const [t, setT] = useState(null);
  useEffect(() => {
    let ok = true;
    fetch(`${import.meta.env.BASE_URL}demo/${scenario}.json`)
      .then((r) => r.json()).then((tl) => { if (ok) setT(makeDemoTransport(tl)); }).catch(() => {});
    return () => { ok = false; };
  }, [scenario]);
  if (!t) return <div className="p-6 text-slate-400">Demo yükleniyor…</div>;
  return (
    <>
      <div className="fixed bottom-3 left-3 z-[2000] rounded-full bg-teal-600 px-3 py-1 text-xs
                      font-semibold text-white shadow">DEMO · sentetik veri</div>
      <Board token="demo" fetchBoard={t.fetchBoard} openStream={t.openStream}
             openNotifications={t.openNotifications} ackAlert={t.ackAlert}
             fetchAudit={t.fetchAudit} recordView={t.recordView} />
    </>
  );
}
