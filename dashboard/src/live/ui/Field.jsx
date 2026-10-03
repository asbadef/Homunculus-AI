// src/live/ui/Field.jsx — the prototype's .fld (label + control) and its global input/select look.
import React, { forwardRef, useId } from "react";

// The prototype's `input, select { … }` and `:focus` rules. On focus the border turns primary
// (pri on card2: >= 3:1 in both themes) — the visible focus mark for a text field.
const CONTROL =
  "w-full rounded-ctl border border-line2 bg-card2 px-[11px] py-[9px] font-text text-14.5 text-ink outline-none "
  + "placeholder:text-mute focus:border-pri focus:shadow-[0_0_0_3px_var(--priSoft)] disabled:cursor-not-allowed disabled:opacity-45";

export const Input = forwardRef(function Input({ className = "", ...rest }, ref) {
  return <input ref={ref} className={`${CONTROL} ${className}`} {...rest} />;
});

export const Select = forwardRef(function Select({ className = "", children, ...rest }, ref) {
  return (
    <select ref={ref} className={`${CONTROL} ${className}`} {...rest}>
      {children}
    </select>
  );
});

/** One labelled control. The label is tied to it (htmlFor/id: the child's own id, else a
 *  generated one); `hint` is read with it (aria-describedby); `required` marks the label with a
 *  "*" and sets the control's required. layout: "row" — label beside the control above 860 px,
 *  as the prototype — or "col", label above. */
export function Field({ label, hint, required = false, layout = "row", className = "", children }) {
  const generated = useId();
  const child = React.Children.only(children);
  const id = child.props.id || generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [child.props["aria-describedby"], hintId].filter(Boolean).join(" ") || undefined;
  const control = React.cloneElement(child, {
    id,
    required: required || child.props.required,
    "aria-describedby": describedBy,
  });
  const grid = layout === "col" ? "grid-cols-1" : "grid-cols-1 min-[861px]:grid-cols-[150px_1fr]";
  return (
    <div className={`mb-2.5 grid items-center gap-x-3 gap-y-1.5 font-text text-13.5 ${grid} ${className}`}>
      <label htmlFor={id} className="font-semibold text-mute">
        {label}
        {required ? <span aria-hidden="true" className="text-crit-ink"> *</span> : null}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className={`m-0 text-12 text-mute ${layout === "col" ? "" : "min-[861px]:col-start-2"}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
