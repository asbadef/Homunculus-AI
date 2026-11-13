// src/live/screens/admin/TresPractitioners.jsx — Yönetim › TRƏS › «Hekim kimlikleri» (TRƏS-01 · phase F1, spec §6, §8,
// D16): what the platform needs of each physician and Homunculus does not hold — the FİN, the family and the given name.
// A physician without one is left out of a stay's record (`identity_missing`).
//
// THE FİN IS WRITE-ONLY, as the account's password: the server answers `fin_set` and never the FİN; the field is empty
// when the panel opens and says «kayıtlı» when one is stored. Left empty it is left OUT of the body and the stored one
// stays; «Kayıtlı FİN'i sil» sends an empty string. Each physician is saved on its own row; a FİN that is not seven
// Latin letters or digits, or a missing name, is held on the screen before anything is sent — and the sentence that says
// so is tied to the inputs at fault (aria-invalid, aria-describedby). One row saves at a time: its button is busy, the
// other rows' are off, visibly. A failed read says so and offers «Yeniden dene» (review, 2026-11-13).
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Box, Button, Empty, Input, Table, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";
import { TresReadFailed } from "./TresReadFailed.jsx";

const FIN = /^[A-Za-z0-9]{7}$/;
const rowOf = (p) => ({ ...p, fin: "", clearFin: false, family: p.family_name ?? "", given: p.given_name ?? "" });
/** What the server would refuse in this row, field by field: a typed FİN of another shape, a name part left empty. */
const problems = (row) => ({
  fin: !row.clearFin && row.fin.trim() !== "" && !FIN.test(row.fin.trim()),
  family: !row.family.trim(),
  given: !row.given.trim(),
});
/** Would the server refuse this row? */
export const wrong = (row) => {
  const bad = problems(row);
  return bad.fin || bad.family || bad.given;
};
/** One row as the server takes it: the FİN left out unless typed, "" to clear it. */
export function identityBody(row) {
  const body = { family_name: row.family.trim(), given_name: row.given.trim() };
  if (row.clearFin) body.fin = "";
  else if (row.fin.trim() !== "") body.fin = row.fin.trim();
  return body;
}

export function TresPractitioners() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [tried, setTried] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reading, setReading] = useState(false);
  const saving = useRef(false);
  const base = useId();

  const read = useCallback(async () => {
    try {
      const got = await store.track(() => store.api.tresPractitioners());
      if (!Array.isArray(got)) throw new Error("no practitioners in the answer");
      setRows(got.map(rowOf));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store]);
  useEffect(() => { read(); }, [read]);

  const edit = (userId, patch) => setRows((all) => all.map((r) => (r.user_id === userId ? { ...r, ...patch } : r)));

  async function retry() {
    setReading(true);
    try {
      await read();
    } finally {
      setReading(false);
    }
  }

  async function save(row) {
    if (saving.current) return;
    if (wrong(row)) {
      setTried(row.user_id);
      return;
    }
    saving.current = true;
    setBusy(row.user_id);
    try {
      const got = await store.track(() => store.api.saveTresPractitioner(row.user_id, identityBody(row)));
      if (got && got.user_id === row.user_id) setRows((all) => all.map((r) => (r.user_id === row.user_id ? rowOf(got) : r)));
      setTried(null);
      toast(t("tres.practitioners.saved", { name: row.full_name }));
    } catch (err) {
      toast(refusedFor(t, row.full_name, err), "error");
    } finally {
      saving.current = false;
      setBusy(null);
    }
  }

  return (
    <Box title={t("tres.practitioners.title")} level={2}>
      <p className="m-0 mb-3 text-13 text-mute">{t("tres.practitioners.sub")}</p>
      {error ? (
        <TresReadFailed text={t("tres.practitioners.readFailed", { reason: readErrorText(t, error) })} busy={reading}
          onRetry={retry} />
      ) : rows === null ? (
        <p className="m-0 text-13 text-mute">{t("tres.practitioners.loading")}</p>
      ) : rows.length === 0 ? (
        <Empty>{t("tres.practitioners.empty")}</Empty>
      ) : (
        <Table caption={t("tres.practitioners.caption")}>
          <thead>
            <tr>
              <th>{t("tres.practitioners.name")}</th><th>{t("tres.practitioners.fin")}</th>
              <th>{t("tres.practitioners.family")}</th><th>{t("tres.practitioners.given")}</th>
              <th><span className="sr-only">{t("tres.practitioners.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, at) => {
              // The sentence that says what is wrong is drawn once a save was tried, and tied to the inputs at fault.
              const held = tried === row.user_id && wrong(row);
              const bad = held ? problems(row) : {};
              const invalidId = `${base}-invalid-${at}`;
              const tie = (fault) => (fault ? { "aria-invalid": "true", "aria-describedby": invalidId } : {});
              return (
                <tr key={row.user_id}>
                  <th scope="row" className="font-text text-13.5">{row.full_name}</th>
                  <td>
                    <Input value={row.fin} maxLength={7} autoComplete="off" spellCheck={false} disabled={row.clearFin}
                      placeholder={row.fin_set ? t("tres.practitioners.finStored") : undefined}
                      aria-label={`${t("tres.practitioners.fin")} · ${row.full_name}`} {...tie(bad.fin)}
                      onChange={(e) => edit(row.user_id, { fin: e.target.value })} />
                    {row.fin_set ? (
                      <label className="mt-1 flex items-center gap-1.5 font-text text-12">
                        <input type="checkbox" checked={row.clearFin} aria-label={`${t("tres.practitioners.finClear")} · ${row.full_name}`}
                          onChange={(e) => edit(row.user_id, { clearFin: e.target.checked, fin: "" })} />
                        {t("tres.practitioners.finClear")}
                      </label>
                    ) : null}
                  </td>
                  <td>
                    <Input value={row.family} maxLength={100} aria-label={`${t("tres.practitioners.family")} · ${row.full_name}`}
                      {...tie(bad.family)} onChange={(e) => edit(row.user_id, { family: e.target.value })} />
                  </td>
                  <td>
                    <Input value={row.given} maxLength={100} aria-label={`${t("tres.practitioners.given")} · ${row.full_name}`}
                      {...tie(bad.given)} onChange={(e) => edit(row.user_id, { given: e.target.value })} />
                  </td>
                  <td>
                    <Button size="sm" busy={busy === row.user_id} disabled={busy !== null && busy !== row.user_id}
                      onClick={() => save(row)} aria-label={`${t("tres.practitioners.save")} · ${row.full_name}`}>
                      {t("tres.practitioners.save")}
                    </Button>
                    {held ? <p id={invalidId} className="m-0 mt-1 text-12 text-crit">{t("tres.practitioners.invalid")}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Box>
  );
}
