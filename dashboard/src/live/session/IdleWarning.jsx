// src/live/session/IdleWarning.jsx — the last minute before an idle session is taken off the
// screen. One warning for both endings (the user's standing decision: a personal session always
// locks, and there is no "never"):
//
//   the shell     locks  — the session lives on behind the lock screen (Shell.jsx)
//   a step screen ends   — the TOTP step, the forced password change and the "server unreachable"
//                          screen have no shell to lock behind, so the session ENDS there
//                          (LiveApp.jsx). Without it, a nurse who walked away from "Yeni şifrə
//                          təyin edin" left the step — and the password she had typed — on a ward
//                          keyboard for whoever sat down next.
//
// The caller says which it is by passing the two i18n KEYS, so no wording lives in here: `titleKey`
// (what is about to happen) and `spokenKey` (the same thing in a sentence, with {seconds}).
//
// The count on screen moves every second; what a screen reader hears does not — it is said when
// the warning opens and once more IDLE_SPOKEN_AGAIN_AT seconds before the end, not sixty times
// (ui/Alert.jsx `Announce`: one region that stays and takes its text afterwards, so the same text
// twice over is not said twice).
import React, { useRef } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Announce, Button, Icon } from "../ui/index.js";

/** Seconds before the end at which the warning is said once more (it is said when it opens). */
export const IDLE_SPOKEN_AGAIN_AT = 10;

export function IdleWarning({ seconds, onStay, titleKey, spokenKey }) {
  const { t } = useI18n();
  const opened = useRef(seconds);
  const spoken = seconds <= IDLE_SPOKEN_AGAIN_AT ? Math.min(opened.current, IDLE_SPOKEN_AGAIN_AT) : opened.current;
  return (
    <div className="fixed bottom-[22px] left-1/2 z-[200] flex -translate-x-1/2 items-center gap-3 rounded-box border border-mid bg-card px-3.5 py-3 font-text text-13 text-ink shadow-pop">
      <Announce text={t(spokenKey, { seconds: spoken })} />
      <Icon name="lock" size={20} className="text-mid-ink" />
      <div aria-hidden="true">
        <b className="block">{t(titleKey)}</b>
        <small className="text-mute">{t("shell.idleWhy", { seconds })}</small>
      </div>
      <Button variant="primary" size="sm" onClick={onStay}>{t("shell.idleStay")}</Button>
    </div>
  );
}
