// src/live/theme/tokens.js — the names of the live UI's design tokens.
//
// Values live in tokens.css (one block per theme). This file only names them, so that
// tailwind.config.js, the design gallery and the tests work from one list: a colour named here
// and missing from a theme — or declared in a theme and not named here — fails tokens.test.js.
//
// Tailwind class = the CSS variable's name in kebab case: --critInk -> text-crit-ink,
// --priSoft -> bg-pri-soft, --v-hr -> text-v-hr, --card2 -> bg-card2. A CSS variable cannot take
// Tailwind's opacity modifier (bg-pri/20 is never generated): tints are tokens of their own
// (priSoft, critSoft, att) or a color-mix() written in the component.
export const COLOR_TOKENS = [
  // surfaces, text, lines
  "page", "app", "rail", "card", "card2", "ink", "mute", "line", "line2",
  // primary action
  "pri", "onpri", "priSoft",
  // attention: amber notes and warning tags
  "att", "attLine", "attIco", "attInk",
  // severity: the fill paints stripes, bars, dots and solid buttons; *Ink is for text
  "crit", "critInk", "critSoft", "oncrit",
  "high", "highInk",
  "mid", "midInk", "onmid",
  "low", "lowInk",
  "ok", "okInk",
  // vital-sign channels
  "v-hr", "v-map", "v-spo", "v-rr", "v-t",
  // the dimmed page behind a modal dialog (the prototype's .modalBg)
  "scrim",
];

export const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function tailwindColors() {
  return Object.fromEntries(COLOR_TOKENS.map((name) => [kebab(name), `var(--${name})`]));
}

// The prototype's type sizes in px. Class text-<px> (text-13, text-14.5) is that size times --fs,
// so data-size="buyuk" enlarges every text at once. No line-height here: like the prototype,
// text inherits the page's 1.5; components whose prototype rule used the `font` shorthand (which
// resets it) set leading-[normal] themselves.
export const TYPE_SIZES = ["10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5", "17", "23"];

export function tailwindFontSizes() {
  return Object.fromEntries(TYPE_SIZES.map((px) => [px, `calc(${px}px * var(--fs))`]));
}
