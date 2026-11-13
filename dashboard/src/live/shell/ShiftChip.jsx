// src/live/shell/ShiftChip.jsx — the prototype's «Nöbet bitimine 7:43» chip (.top .shift).
// The shift's end is the server's: GET /tasks answers with the current shift window
// (admission/shifts.py), read by whoever may see the task queue. No source, no chip — never a
// guessed 08:00/20:00.
import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { hhmm } from "../i18n/dates.js";

const READ_EVERY_MS = 5 * 60_000;

/** «7:05» — hours and minutes left, never negative. */
export function leftText(endMs, nowMs) {
  const min = Math.max(0, Math.floor((endMs - nowMs) / 60_000));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

export function ShiftChip() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const may = Array.isArray(user?.perms) && user.perms.includes("tasks.view");
  const [shift, setShift] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!may) return undefined;
    let alive = true;
    const read = () => store.track(() => store.api.tasks()).then(
      (data) => {
        const start = Date.parse(data?.shift?.start);
        const end = Date.parse(data?.shift?.end);
        if (alive && Number.isFinite(start) && Number.isFinite(end)) setShift({ start, end });
      },
      () => {},
    );
    read();
    const id = setInterval(read, READ_EVERY_MS);
    return () => { alive = false; clearInterval(id); };
  }, [may, store]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!shift) return null;
  return (
    <p title={t("shell.shiftWindow", { start: hhmm(shift.start), end: hhmm(shift.end) })}
      className="m-0 hidden h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-card2 px-2.5 text-11.5 font-semibold text-mute min-[1100px]:flex">
      <i aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[#16a34a]" />
      {t("shell.shiftLeft")}
      <b className="font-data text-ink">{leftText(shift.end, now)}</b>
    </p>
  );
}
