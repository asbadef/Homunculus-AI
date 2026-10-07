// src/live/auth/LockScreen.jsx — the locked screen (the prototype's lockHtml, shell.js).
//
// It replaces the whole shell: no screen, menu, dialog or toast of the session is in the page
// while it shows (plan decision 3). What it shows of the ward: the NUMBER of open alarms in the
// session's units, by severity, and how many nobody has acknowledged — no name, bed or value —
// so a nurse glancing at a shared station knows whether something is waiting. It reads the board
// through `lockSummary` and nothing else (boardStore.js): numbers and two flags, so nothing of a
// patient can reach a locked screen through it. Only a LIVE board may say "none" (`known`); a
// board that stopped updating (`stale`) shows its counts as possibly out of date, and one that is
// not there (`open === null`) says it cannot know. Unlock is the session's own password (POST
// /auth/reauth); the third wrong one signs out. "Sign in as someone else" signs out at once — no
// password is needed to leave.
//
// Always dark, as in the prototype: data-theme="gece" on its root.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { PHASE, UNLOCK_ATTEMPTS } from "../session/sessionStore.js";
import { useBoard } from "../data/BoardProvider.jsx";
import { lockSummary } from "../data/boardStore.js";
import { apiErrorKey, apiErrorText } from "../apiErrors.js";
import { Alert, Announce, Button, CapsWarning, Icon, StatusPill, useCapsLock } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { Brand } from "../shell/Prefs.jsx";
import { useRetryHold } from "./useRetryHold.js";
import { ddmmyyyy, hhmm, weekdayKey } from "../i18n/dates.js";

function useNow(stepMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(timer);
  }, [stepMs]);
  return now;
}

// A severity this build does not know comes first and wears the attention look: it may be the
// worst one (riskStyle.js's rule for a value the screen cannot vouch for).
const PILLS = [["unknown", "att"], ["critical", "crit"], ["high", "high"], ["moderate", "mid"],
  ["low", "low"], ["info", "neutral"]];

function OpenAlarms() {
  const { t } = useI18n();
  const { known, stale, open, waiting } = lockSummary(useBoard());
  return (
    <section aria-label={t("lock.region")} aria-live="polite"
      className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-box border border-line2 bg-card px-4 py-2.5 text-13.5">
      {!open ? <span className="text-mute">{t("lock.unavailable")}</span> : known && open.total === 0 ? (
        <b>{t("lock.none")}</b>
      ) : (
        <>
          <b>{t("lock.open")}: <span className="font-data">{open.total}</span></b>
          <span>{t("lock.waiting")}: <span className="font-data font-bold">{waiting}</span></span>
          {/* The count after the label, as everywhere else (Decision 13): a number before a word
              would need the word fitted to it, which Russian ("2 средние") cannot be. */}
          {PILLS.filter(([sev]) => open[sev] > 0).map(([sev, tone]) => (
            <StatusPill key={sev} tone={tone}>{t(`lock.${sev}`)}: <span className="font-data">{open[sev]}</span></StatusPill>
          ))}
          {stale ? (
            <small className="flex items-center gap-1.5 font-semibold text-mid-ink">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-mid" />{t("lock.stale")}
            </small>
          ) : <small className="text-mute">{t("lock.seeing")}</small>}
        </>
      )}
    </section>
  );
}

export function LockScreen() {
  const { t } = useI18n();
  const { store, user, lock } = useSession();
  const now = useNow();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const caps = useCapsLock();
  const { wait, holding, hold, current: holdNow } = useRetryHold();
  const [failure, setFailure] = useState(null);
  const input = useRef(null);
  const mounted = useRef(false);
  const seesBoard = user?.perms?.includes("board.view");

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => { input.current?.focus(); }, []);

  // Said once per hold: the text is the hold's OWN length, which does not change while it runs,
  // and it is emptied when the hold ends, so the next hold says it again (ui/Alert.jsx Announce).
  const heldFor = holding && holdNow ? t("auth.retryIn", { seconds: holdNow.seconds }) : "";

  const submit = async (event) => {
    event.preventDefault();
    if (busy || holding) return;
    if (!password) {
      setFailure(t("errors.passwordRequired"));
      input.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await store.unlock(password);
    } catch (err) {
      // The lock is gone: the session ended (the tries are spent, an administrator reset the
      // password, the account is over) and the sign-in form says why. Nothing to add here.
      if (!mounted.current || store.getState().phase !== PHASE.LOCKED) return;
      if (apiErrorKey(err)?.key === "errors.reauthRefused") {
        const left = UNLOCK_ATTEMPTS - store.getState().unlockFailures;
        setFailure(t("lock.attemptsLeft", { count: left }));
      } else {
        setFailure(apiErrorText(t, err));
        // /auth/reauth is in nginx's own zone (homunculus_reauth) and answers a ward over its
        // budget with Retry-After. Hold the button that long, as the sign-in and password forms
        // do: pressing again before then only spends the ward's shared budget.
        if (Number.isInteger(err?.retryAfter)) hold(err.retryAfter);
      }
      input.current?.focus();
    } finally {
      // The password goes when the request settles, whatever it answered: a right one opens the
      // shell, and nothing of it stays in this screen's state or in the field behind it.
      if (mounted.current) {
        setBusy(false);
        setPassword("");
      }
    }
  };

  const date = `${t(weekdayKey(now))} ${ddmmyyyy(now)}`;
  const initials = (user?.fullName || "?").split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("");

  return (
    <div data-theme="gece" className="flex min-h-full flex-col bg-[radial-gradient(120%_90%_at_50%_-10%,color-mix(in_srgb,var(--pri)_25%,var(--page)),var(--page)_62%)] px-[clamp(16px,4vw,56px)] py-7 font-text text-ink">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Brand subtitle={user?.tenantName || user?.tenant} />
        <p className="m-0 font-data text-14 font-semibold text-mute">{date}</p>
      </div>
      <main className="flex flex-1 flex-col items-center justify-center gap-[22px] py-6">
        <p aria-hidden="true" className="m-0 font-data text-[calc(clamp(64px,9vw,120px)*var(--fs))] font-bold leading-none tracking-[-.02em]">{hhmm(now)}</p>
        <div className="w-full max-w-[420px] rounded-dlg border border-line2 bg-card p-[22px] shadow-pop">
          <div className="flex items-center gap-3.5 border-b border-line pb-4">
            <span aria-hidden="true" className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-pri font-display text-20 font-bold text-onpri">{initials}</span>
            <div className="min-w-0">
              <b className="block truncate font-display text-17">{user?.fullName}</b>
              <small className="text-13 text-mute">{(user?.groups ?? []).map((g) => g.name).join(" · ")}</small>
            </div>
          </div>
          <div className="flex items-start gap-3 py-3.5">
            <Icon name="lock" size={20} className="mt-0.5 text-pri" />
            <div>
              <h1 className="m-0 text-15 font-bold">{t("lock.title")}</h1>
              <small className="text-12.5 text-mute">
                {t(lock?.why === "idle" ? "lock.idle" : "lock.manual", { time: hhmm(lock?.at ?? now) })} · {t("lock.hidden")}
              </small>
            </div>
          </div>
          {failure ? <Alert className="mb-2.5">{failure}</Alert> : null}
          <form noValidate onSubmit={submit}>
            <label htmlFor="lock-password" className="sr-only">{t("lock.password")}</label>
            <div className="flex h-12 items-center gap-2.5 rounded-ctl border border-line2 bg-page px-3.5 focus-within:border-pri focus-within:shadow-[0_0_0_4px_var(--priSoft)]">
              <Icon name="key" size={18} className="text-mute" />
              <input
                ref={input}
                id="lock-password"
                type="password"
                autoComplete="current-password"
                placeholder={t("lock.password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                {...caps.keys}
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-15 text-ink outline-none placeholder:text-mute"
              />
            </div>
            <CapsWarning shown={caps.shown} className="mt-2" />
            <Button type="submit" variant="primary" size="lg" icon="lock" busy={busy} disabled={holding} className="mt-3 w-full justify-center">
              {t("lock.unlock")}
            </Button>
            {holding ? <p aria-hidden="true" className="mt-2 text-12.5 text-mute">{t("auth.retryIn", { seconds: wait })}</p> : null}
            <Announce text={heldFor} />
          </form>
          <button
            type="button"
            onClick={() => store.signOut()}
            className={`mt-2.5 block w-full rounded-ctl p-2.5 text-13.5 font-semibold text-mute hover:bg-card2 hover:text-ink ${FOCUS_RING}`}
          >
            {t("lock.other")}
          </button>
        </div>
        {seesBoard ? <OpenAlarms /> : null}
      </main>
    </div>
  );
}
