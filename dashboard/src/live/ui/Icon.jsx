// src/live/ui/Icon.jsx — one of the prototype's line icons, by its prototype name.
import React from "react";
import { ICONS } from "./icons.js";

/** Decorative by default (aria-hidden): the button or text beside it carries the meaning. Pass
 *  `label` when the icon alone carries meaning; it then becomes an image with that name.
 *  An unknown name draws the prototype's fallback (grid) and warns in development. */
export function Icon({ name, size = 16, label, className = "" }) {
  const shapes = ICONS[name];
  if (!shapes && import.meta.env.DEV) console.warn(`Icon: no icon named "${name}"`);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      data-icon={name}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {(shapes || ICONS.grid).map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
