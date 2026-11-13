// src/live/ui/Flag.jsx — the prototype's language flags (core.js FLAG / .flagbox), 3:2, decorative.
// The owner asked for flags beside the language codes (2026-11-13); the code stays the name.
// Kept as SVG strings (static, no user data) so the prototype's legal pages can reuse them.
import React, { useId } from "react";

const star = (n, cx, cy, r, inner, rot) => {
  let d = "";
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI / n) * i + rot;
    const rr = i % 2 ? r * inner : r;
    d += `${i ? "L" : "M"}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
};

const SVG = (box, body) => `<svg viewBox="${box}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
const FLAGS = {
  az: () => SVG("0 0 30 20", `<rect width="30" height="6.67" fill="#00B5E2"/><rect y="6.67" width="30" height="6.67" fill="#EF3340"/><rect y="13.33" width="30" height="6.67" fill="#509E2F"/><circle cx="14.1" cy="10" r="2.5" fill="#fff"/><circle cx="14.72" cy="10" r="2.05" fill="#EF3340"/><path d="${star(8, 16.95, 10, 1.15, 0.45, -Math.PI / 2)}" fill="#fff"/>`),
  tr: () => SVG("0 0 30 20", `<rect width="30" height="20" fill="#E30A17"/><circle cx="10" cy="10" r="5" fill="#fff"/><circle cx="11.25" cy="10" r="4" fill="#E30A17"/><path d="${star(5, 14.58, 10, 2.5, 0.38, Math.PI)}" fill="#fff"/>`),
  ru: () => SVG("0 0 30 20", `<rect width="30" height="6.67" fill="#fff"/><rect y="6.67" width="30" height="6.67" fill="#0039A6"/><rect y="13.33" width="30" height="6.67" fill="#D52B1E"/>`),
  // The Union Jack's clip paths need ids unique on the page: one flag may be drawn many times.
  en: (uid) => SVG("0 0 60 30", `<clipPath id="s${uid}"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="t${uid}"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><g clip-path="url(#s${uid})"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#t${uid})" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g>`),
};

let seq = 0;
/** The flag's SVG markup for a UI language (az/tr/ru/en), or "" for an unknown one. */
export function flagSvg(code, uid = `f${++seq}`) {
  const draw = FLAGS[String(code).toLowerCase()];
  return draw ? draw(uid) : "";
}

const FRAME =
  "relative block shrink-0 overflow-hidden rounded-[3px] [&>svg]:block [&>svg]:h-full [&>svg]:w-full after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgba(0,0,0,.22),inset_0_1px_0_rgba(255,255,255,.25)]";

/** A flag in a 3:2 frame with the prototype's inner hairline. */
export function Flag({ code, className = "h-4 w-6" }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  return <span aria-hidden="true" className={`${FRAME} ${className}`} dangerouslySetInnerHTML={{ __html: flagSvg(code, uid) }} />;
}
