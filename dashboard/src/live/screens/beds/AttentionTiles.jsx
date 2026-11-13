// src/live/screens/beds/AttentionTiles.jsx — the prototype's four attention tiles over the bed board
// (shell.js / ek.css `.att`): unanswered alarms, overdue nursing tasks, handovers waiting for my
// countersignature, results not yet seen.
//
// Every number is read from the server: the alarms from the board (`waitingAlarms`, only a LIVE board
// may say 0), the tasks from GET /tasks (the Görevlerim screen's own rule, taskModel.items), the
// handovers from GET /handovers?box=incoming (the Devir screen's groupHandovers). A tile whose source
// this session may not read, or that could not be read, shows «—» and says why — never a 0. The
// results tile has no source in this build (no laboratory feed), so it says that instead of the
// prototype's constant.
import React, { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { waitingAlarms } from "../../data/boardStore.js";
import { useSnoozeClock } from "../../data/useSnoozeClock.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { ROUTES, canReach, screenOf } from "../../shell/routes.js";
import { Icon } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { elapsed } from "../common/elapsed.js";
import { items as taskItems } from "../gorevler/taskModel.js";
import { groupHandovers } from "../devir/devir.js";

const POLL_MS = 60_000;
// The prototype's .ac and its three looks: .crit (something waits, red), the plain one (amber: yours
// to do) and .ok (nothing waits: a white card with a green icon). `none`: the number is not known —
// the calm card with a grey icon, never the green one.
const TONES = {
  crit: { box: "border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)] bg-crit-soft", icon: "bg-[color:color-mix(in_srgb,var(--crit)_18%,transparent)] text-crit" },
  att: { box: "border-att-line bg-att", icon: "bg-att-ico text-att-ink" },
  calm: { box: "border-line bg-card", icon: "bg-card2 text-ok" },
  none: { box: "border-line bg-card", icon: "bg-card2 text-mute" },
};

const hrefOf = (id, perms) => {
  const route = ROUTES.find((r) => r.id === id);
  return route && screenOf(route) && canReach(route, perms) ? `#${route.path}` : null;
};

function Tile({ id, icon, tone, count, text, href }) {
  const s = TONES[tone];
  const body = (
    <>
      <span className={`row-span-2 grid h-10 w-10 place-items-center rounded-[10px] ${s.icon}`}><Icon name={icon} size={20} /></span>
      <b className="font-display text-[calc(24px*var(--fs))] font-bold leading-none text-ink">{count}</b>
      <span className="min-w-0 text-12.5 text-mute">{text}</span>
    </>
  );
  const cls = `grid min-w-0 grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-[3px] rounded-[14px] border px-[13px] py-3 transition-transform duration-150 hover:-translate-y-px motion-reduce:transition-none ${s.box}`;
  return href
    ? <a href={href} data-tile={id} className={`${cls} ${FOCUS_RING}`}>{body}</a>
    : <div data-tile={id} className={cls}>{body}</div>;
}

/** Polls `read` every minute while mounted; {value, failed}. `read` null: not this session's to read. */
function usePoll(read) {
  const [state, setState] = useState({ value: null, failed: false });
  useEffect(() => {
    if (!read) return undefined;
    let alive = true;
    const go = () => read().then(
      (value) => { if (alive) setState({ value, failed: false }); },
      () => { if (alive) setState((s) => ({ value: s.value, failed: true })); },
    );
    go();
    const id = setInterval(go, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [read]);
  return state;
}

/** The task queue, read once a minute by whoever may see it: `{value, failed, readable}`. The board
 *  reads it here and hands it to the tiles and to the cards' «n geciken iş» flag — one read for both. */
export function useTaskQueue() {
  const { user, store } = useSession();
  const may = Array.isArray(user?.perms) && user.perms.includes("tasks.view");
  const [read] = useState(() => (may ? () => store.track(() => store.api.tasks()) : null));
  return { ...usePoll(read), readable: Boolean(read) };
}

/** Each patient's overdue tasks, by the Görevlerim screen's own rule: Map(patient_id -> count). */
export function lateByPatient(queue, nowMs) {
  const out = new Map();
  for (const p of queue?.value?.patients ?? []) {
    const n = taskItems(p, nowMs, queue.value.settings?.grace_min ?? 30).filter((x) => x.state === "late").length;
    if (n) out.set(p.patient_id, n);
  }
  return out;
}

export function AttentionTiles({ nowMs, tasks }) {
  const { t } = useI18n();
  const { user, store } = useSession();
  const board = useBoard();
  const perms = user?.perms;
  const can = (p) => Array.isArray(perms) ? perms.includes(p) : perms instanceof Set ? perms.has(p) : false;

  const queueNowMs = useSnoozeClock();
  const { known, stale, items } = waitingAlarms({ ...board, nowMs: queueNowMs });
  const waiting = items ?? [];
  const oldest = waiting.map((a) => a.firstSeenAtMs).filter(Number.isFinite).sort((a, b) => a - b)[0];

  const [readHand] = useState(() => (can("handover.sign") ? () => store.track(() => store.api.handovers("incoming")) : null));
  const hand = usePoll(readHand);

  const late = tasks.value ? [...lateByPatient(tasks, nowMs).values()].reduce((a, b) => a + b, 0) : null;
  const toSign = hand.value ? groupHandovers({ incoming: hand.value }).toCountersign.length : null;

  // Only a LIVE board may say 0; one that may be out of date still counts what it has, and says so.
  const alarm = waiting.length && (known || stale)
    ? { count: waiting.length, tone: "crit",
      text: [Number.isFinite(oldest) ? t("beds.tileAlarmOldest", { elapsed: elapsed(oldest, nowMs) }) : t("beds.tileAlarm"),
        stale ? t("board.degraded") : null].filter(Boolean).join(" · ") }
    : known && !stale
      ? { count: 0, text: t("beds.tileAlarmNone"), tone: "calm" }
      : { count: "—", text: t("beds.waitingUnknown"), tone: "none" };

  const why = (state, readable) => (!readable ? t("beds.tileNoAccess") : state.failed && state.value === null ? t("beds.tileUnread") : null);

  return (
    <div className="grid gap-3 min-[861px]:grid-cols-2 min-[1180px]:grid-cols-4">
      <Tile id="alarm" icon="bell" tone={alarm.tone} count={alarm.count} text={alarm.text} href={hrefOf("alarms", perms)} />
      <Tile id="tasks" icon="clock" tone={late === null ? "none" : late ? "crit" : "calm"} count={late ?? "—"}
        text={why(tasks, tasks.readable) ?? t("beds.tileTasks")} href={hrefOf("gorevler", perms)} />
      <Tile id="handover" icon="clip" tone={toSign === null ? "none" : toSign ? "att" : "calm"} count={toSign ?? "—"}
        text={why(hand, readHand) ?? t("beds.tileHandover")} href={hrefOf("devir", perms)} />
      <Tile id="results" icon="flask" tone="none" count="—" text={t("beds.tileResultsNone")} />
    </div>
  );
}
