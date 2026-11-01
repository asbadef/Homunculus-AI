// src/live/screens/kabul/boardKey.js — the card key of an admission row (Group 2 · B1d, spec §4).
//
// The board keys a patient by one string. An admission made since migration 0015 is keyed by its
// protocol number (D7: the number on the device, the label and the card are one); one opened before
// keeps its H-number. The server answers it as `board_key` on every row and every admit answer;
// EVERY match between an admission and a card goes through this one function (E12). An answer
// without the field — an API one release behind, the B1a tests' rows — keyed its card by
// `patient_number`.
export function boardKeyOf(row) {
  if (typeof row?.board_key === "string" && row.board_key) return row.board_key;
  return typeof row?.patient_number === "string" ? row.patient_number : null;
}
