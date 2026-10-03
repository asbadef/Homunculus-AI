// src/live/ui/focus.js — the keyboard focus mark every interactive control in the live UI uses.
//
// The prototype has none (it styles :focus only on inputs). A 2 px primary outline, 2 px away from
// the control: an outline needs no "offset colour", so it reads on any surface, and it survives
// forced-colours (Windows high-contrast) mode, which drops box-shadows. --pri clears 3:1 against
// page, card and card2 in both themes (tokens.test.js). :focus-visible, so a mouse click on a
// button does not leave a ring behind.
export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pri";
