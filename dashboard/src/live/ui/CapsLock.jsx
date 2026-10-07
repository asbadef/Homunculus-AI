// src/live/ui/CapsLock.jsx — the Caps Lock warning a password field shows (the prototype's
// capsWarn), in one place for every form that takes a password: sign-in, the lock screen, the
// password change.
//
// There is no event for "Caps Lock was pressed". The only evidence a page has is the modifier
// state carried by a key the field itself receives, so the hook reads it from that field's
// keydown/keyup and nowhere else: no document-wide listener, and nothing is guessed about a
// keyboard nobody has typed on yet (the warning appears with the first key, as the prototype's
// does).
//
//   const caps = useCapsLock();
//   <Input {...caps.keys} />            // on every password field of the form
//   <CapsWarning shown={caps.shown} />
//
// It is said the way every polite notice here is said (ui/Alert.jsx): the line everyone sees is
// aria-hidden, and one hidden status region that is always mounted takes the text a moment later
// — a region born with its text is not announced at all.
import React, { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Icon } from "./Icon.jsx";
import { Announce } from "./Alert.jsx";

export function useCapsLock() {
  const [shown, setShown] = useState(false);
  // One stable pair of handlers: they are spread onto a field's props on every render.
  const keys = useMemo(() => {
    const read = (event) => setShown(Boolean(event.getModifierState?.("CapsLock")));
    return { onKeyDown: read, onKeyUp: read };
  }, []);
  return { shown, keys };
}

/** `shown`: whether the keys say Caps Lock is on (useCapsLock). The warning is the whole of what
 *  the user sees about it; nothing here refuses anything — a password typed in the wrong case is
 *  the server's to refuse. */
export function CapsWarning({ shown, className = "" }) {
  const { t } = useI18n();
  const text = t("ui.capsLock");
  return (
    <>
      {shown ? (
        <span aria-hidden="true" className={`flex items-center gap-1.5 font-text text-12 font-semibold leading-[normal] text-mid-ink ${className}`}>
          <Icon name="alert" size={14} />
          {text}
        </span>
      ) : null}
      <Announce text={shown ? text : ""} />
    </>
  );
}
