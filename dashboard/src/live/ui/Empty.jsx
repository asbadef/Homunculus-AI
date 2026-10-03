// src/live/ui/Empty.jsx — the prototype's .empty: what a list says when it has nothing to show.
import React from "react";
import { Icon } from "./Icon.jsx";

/** Say why the list is empty in the words of the screen ("no open alarms"), never a bare "—":
 *  on a clinical screen an empty area must not read as "all quiet" by accident. */
export function Empty({ icon, className = "", children }) {
  return (
    <div className={`rounded-box border-[1.5px] border-dashed border-line2 px-2.5 py-[26px] text-center font-text text-14 text-mute ${className}`}>
      {icon ? <Icon name={icon} size={20} className="mx-auto mb-1.5" /> : null}
      {children}
    </div>
  );
}
