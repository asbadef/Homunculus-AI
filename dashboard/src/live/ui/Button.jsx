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
const BASE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-ctl border font-text font-semibold leading-[normal] "
  + `cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS_RING}`;

/** variant: default | primary | danger | ghost; size: sm | md | lg; icon: an icon name.
 *  type="button" unless told otherwise — a button inside a form must not submit it by accident.
 *  An icon-only button needs `label`: it becomes the accessible name and the tooltip. */
export const Button = forwardRef(function Button(
  { variant = "default", size = "md", icon, label, type = "button", className = "", children, ...rest },
  ref,
) {
  const iconOnly = !children;
  if (iconOnly && !label && import.meta.env.DEV) console.warn("Button: an icon-only button needs a label");
  return (
    <button
      ref={ref}
      type={type}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={`${BASE} ${VARIANT[variant] || VARIANT.default} ${SIZE[size] || SIZE.md} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children}
    </button>
  );
});
