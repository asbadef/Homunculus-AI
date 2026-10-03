// src/live/ui/Button.jsx — the prototype's .btn.
import React, { forwardRef } from "react";
import { Icon } from "./Icon.jsx";
import { FOCUS_RING } from "./focus.js";

const VARIANT = {
  default: "border-line2 bg-card text-ink hover:border-pri", //  .btn
  primary: "border-transparent bg-pri text-onpri", //           .btn.p
  danger: "border-transparent bg-crit text-oncrit", //          .btn.d
  ghost: "border-transparent bg-transparent text-mute hover:bg-card2 hover:text-ink", // .btn.g
};
const SIZE = {
  sm: "px-[9px] py-[5px] text-12", //   .btn.sm
  md: "px-[13px] py-2 text-13", //      .btn
  lg: "px-[18px] py-[11px] text-14.5", // .btn.lg
};
// Busy is aria-disabled too. Tailwind writes aria-busy: rules before aria-disabled: ones, so the
// wait cursor is the stacked variant (both attributes, a more specific selector) to win.
const BASE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-ctl border font-text font-semibold leading-[normal] "
  + "cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 "
  + `aria-busy:aria-disabled:cursor-wait ${FOCUS_RING}`;

// No content at all: an icon-only button. A 0 is content (a count), not nothing.
const isEmpty = (children) => children === null || children === undefined || children === false || children === "";

/** variant: default | primary | danger | ghost; size: sm | md | lg; icon: an icon name, drawn at
 *  16 px at every size (the prototype's `.btn svg`).
 *  type="button" unless told otherwise — a button inside a form must not submit it by accident.
 *  An icon-only button needs `label`: it becomes the accessible name and the tooltip.
 *  `busy`: a request it started is in flight. The button says so (aria-busy, aria-disabled) and
 *  ignores clicks — including a submit — but stays focusable: a natively disabled button would
 *  drop the keyboard user's focus to <body> the moment it was pressed. */
export const Button = forwardRef(function Button(
  { variant = "default", size = "md", icon, label, type = "button", busy = false, onClick, className = "", children, ...rest },
  ref,
) {
  const iconOnly = isEmpty(children);
  if (iconOnly && !label && import.meta.env.DEV) console.warn("Button: an icon-only button needs a label");
  return (
    <button
      ref={ref}
      type={type}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={`${BASE} ${VARIANT[variant] || VARIANT.default} ${SIZE[size] || SIZE.md} ${className}`}
      {...rest}
      aria-busy={busy ? "true" : rest["aria-busy"]}
      aria-disabled={busy ? "true" : rest["aria-disabled"]}
      onClick={busy ? (event) => event.preventDefault() : onClick}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
});
