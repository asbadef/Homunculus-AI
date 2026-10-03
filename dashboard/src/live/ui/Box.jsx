// src/live/ui/Box.jsx — the prototype's .box / .card (the two are the same rule).
import React from "react";
import { Icon } from "./Icon.jsx";

/** A bordered surface, optionally with the prototype's small upper-case header (its h5). The
 *  header is a real heading — h3 unless `level` says otherwise — so screen-reader users can jump
 *  between boxes. `right` fills the header's right-hand side (the prototype's h5 .r). */
export function Box({ title, icon, right, level = 3, className = "", children }) {
  const Heading = `h${Math.min(6, Math.max(2, level))}`;
  return (
    <div className={`rounded-box border border-line bg-card px-[14px] py-3 ${className}`}>
      {title ? (
        <div className="mb-2.5 flex items-center gap-2">
          <Heading className="m-0 flex items-center gap-2 font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute">
            {icon ? <Icon name={icon} size={15} /> : null}
            {title}
          </Heading>
          {right ? <div className="ml-auto font-text text-11 font-semibold text-mute">{right}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
