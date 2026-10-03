// src/live/ui/KV.jsx — the prototype's .kv rows (label left, value right), as a description list.
import React from "react";

export function KVList({ className = "", children }) {
  return <dl className={`m-0 ${className}`}>{children}</dl>;
}

/** One label–value row; put it inside <KVList>. The value is set in the data face (JetBrains
 *  Mono, bold) like the prototype's <b>; mono={false} for a value that is prose. */
export function KV({ label, mono = true, children }) {
  return (
    <div className="flex justify-between gap-2.5 border-b border-dashed border-line py-1.5 font-text text-13 last:border-b-0">
      <dt>{label}</dt>
      <dd className={`m-0 text-right font-bold ${mono ? "font-data" : ""}`}>{children}</dd>
    </div>
  );
}
