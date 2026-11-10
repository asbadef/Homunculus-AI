// src/live/screens/devir/devir.js — the rules of the «Vardiya devri» screen (G2-B3b, spec D5, D7, D9). Pure: no
// network, no React. The server judges every one of them again; these only keep the screen from sending what it
// already knows will be refused, and sort what it was given.

/** The four parts of the note, in the order they are written: Durum, Öykü, Değerlendirme, Öneri (D-Ö-D-Ö). The
 *  names are the server's (`HandoverSign.note`). */
export const NOTE_PARTS = ["situation", "background", "assessment", "recommendation"];
/** At least one part must hold this many characters after trimming (D5). */
export const PART_MIN = 3;
/** No part may be longer than this (D5). */
export const PART_MAX = 2000;

/** A blank note — a fresh object each time, for a form to write into. */
export function emptyNote() {
  return { situation: "", background: "", assessment: "", recommendation: "" };
}

// Python's len() counts code points; String.length counts UTF-16 units, so one emoji would count twice here and
// once at the server.
const length = (text) => [...text].length;

/** Would the server take this note? At least one part of PART_MIN or more characters after trimming, and no part over
 *  PART_MAX (D5). A part that is not text counts as empty. */
export function noteValid(note) {
  if (!note || typeof note !== "object" || Array.isArray(note)) return false;
  let substantial = false;
  for (const part of NOTE_PARTS) {
    const text = typeof note[part] === "string" ? note[part] : "";
    if (length(text) > PART_MAX) return false;
    if (length(text.trim()) >= PART_MIN) substantial = true;
  }
  return substantial;
}

/** How many critical alarms nobody has acknowledged this patient's card holds on the live board — the number the
 *  engine's gate counts too (admission/boardlink.py `count_open_critical`), so the dialog can say «İmzalanamaz» before
 *  the server has to. `board` is the board store's state (`useBoard()`: its `alerts`, whose `patientId` is the board
 *  key, `severity`, and `ack` — null until somebody acknowledges, liveAdapters.js `alertsFromPatients`). A latched
 *  alarm (status RESOLVED: its rule stopped before anyone answered it) is still open and counts. A board that holds
 *  nothing, or a key that names nobody, gives 0: the server stays the judge. */
export function openCriticalOnBoard(board, boardKey) {
  if (typeof boardKey !== "string" || boardKey === "" || !Array.isArray(board?.alerts)) return 0;
  return board.alerts.filter((a) => a?.patientId === boardKey && a.severity === "critical" && !a.ack).length;
}

const isRow = (row) => row !== null && typeof row === "object" && !Array.isArray(row);
const rowsOf = (list) => (Array.isArray(list) ? list.filter(isRow) : []);

/** An ISO instant as milliseconds, or null when absent or unparseable (never an invented time). */
function ms(iso) {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** When a row last changed hands: the receiver's signature for one completed, the end of the bridge for one that
 *  lapsed, else the outgoing signature or the opening — what «newest first» and «oldest first» order by. */
function lastChange(row) {
  const first = row.status === "COMPLETED" ? row.incoming_signed_at
    : row.status === "EXPIRED" ? row.bridge_expires_at : row.outgoing_signed_at;
  return ms(first) ?? ms(row.outgoing_signed_at) ?? ms(row.created_at);
}

// Two instants in order; one that is unknown (null) goes last, whichever way the list runs.
const oldestFirst = (x, y) => (x === null || y === null ? Number(x === null) - Number(y === null) : x - y);
const newestFirst = (x, y) => (x === null || y === null ? Number(x === null) - Number(y === null) : y - x);

/** The screen's four lists from the two boxes (`GET /handovers?box=…`). `incoming`/`outgoing` are the server's rows.
 *   toCountersign: incoming, OUTGOING_SIGNED — the one signed longest ago first;
 *   mineOpen: outgoing, OPEN (the signature was refused or is yet to be given);
 *   mineWaiting: outgoing, OUTGOING_SIGNED (the receiver has not yet countersigned), in the server's order;
 *   recent: COMPLETED or EXPIRED, either box, newest first.
 *  A box that is not a list is an empty one. */
export function groupHandovers(boxes) {
  const mine = rowsOf(boxes?.incoming);
  const given = rowsOf(boxes?.outgoing);
  return {
    toCountersign: mine.filter((r) => r.status === "OUTGOING_SIGNED")
      .sort((a, b) => oldestFirst(lastChange(a), lastChange(b))),
    mineOpen: given.filter((r) => r.status === "OPEN"),
    mineWaiting: given.filter((r) => r.status === "OUTGOING_SIGNED"),
    recent: [...mine, ...given].filter((r) => r.status === "COMPLETED" || r.status === "EXPIRED")
      .sort((a, b) => newestFirst(lastChange(a), lastChange(b))),
  };
}
