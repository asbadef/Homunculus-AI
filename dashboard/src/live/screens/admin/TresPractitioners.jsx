// src/live/screens/admin/TresPractitioners.jsx — Yönetim › TRƏS › «Hekim kimlikleri» (TRƏS-01 · phase F1, spec §6, §8,
// D16): what the platform needs of each physician and Homunculus does not hold — the FİN, the family and the given name.
// A physician without one is left out of a stay's record (`identity_missing`).
//
// THE FİN IS WRITE-ONLY, as the account's password: the server answers `fin_set` and never the FİN; the field is empty
// when the panel opens and says «kayıtlı» when one is stored. Left empty it is left OUT of the body and the stored one
// stays; «Kayıtlı FİN'i sil» sends an empty string. Each physician is saved on its own row; a FİN that is not seven
// Latin letters or digits, or a missing name, is held on the screen before anything is sent.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Box, Button, Empty, Input, Table, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";

const FIN = /^[A-Za-z0-9]{7}$/;
const rowOf = (p) => ({ ...p, fin: "", clearFin: false, family: p.family_name ?? "", given: p.given_name ?? "" });
/** Would the server refuse this row? A typed FİN of another shape, or a name part left empty. */
export const wrong = (row) => (!row.clearFin && row.fin.trim() !== "" && !FIN.test(row.fin.trim()))
  || !row.family.trim() || !row.given.trim();
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

  async function save(row) {
    if (busy) return;
    if (wrong(row)) {
      setTried(row.user_id);
      return;
    }
    setBusy(row.user_id);
    try {
      const got = await store.track(() => store.api.saveTresPractitioner(row.user_id, identityBody(row)));
      if (got && got.user_id === row.user_id) setRows((all) => all.map((r) => (r.user_id === row.user_id ? rowOf(got) : r)));
      setTried(null);
      toast(t("tres.practitioners.saved", { name: row.full_name }));
    } catch (err) {
      toast(refusedFor(t, row.full_name, err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Box title={t("tres.practitioners.title")} level={2}>
      <p className="m-0 mb-3 text-13 text-mute">{t("tres.practitioners.sub")}</p>
      {error ? (
        <p className="m-0 text-13 text-crit">{t("tres.practitioners.readFailed", { reason: readErrorText(t, error) })}</p>
      ) : rows === null ? (
        <p className="m-0 text-13 text-mute">{t("tres.practitioners.loading")}</p>
      ) : rows.length === 0 ? (
        <Empty>{t("tres.practitioners.empty")}</Empty>
      ) : (
        <Table caption={t("tres.practitioners.caption")}>
          <thead>
            <tr>
              <th>{t("tres.practitioners.name")}</th><th>{t("tres.practitioners.fin")}</th>
              <th>{t("tres.practitioners.family")}</th><th>{t("tres.practitioners.given")}</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user_id}>
                <th scope="row" className="font-text text-13.5">{row.full_name}</th>
                <td>
                  <Input value={row.fin} maxLength={7} autoComplete="off" disabled={row.clearFin}
                    placeholder={row.fin_set ? t("tres.practitioners.finStored") : undefined}
                    aria-label={`${t("tres.practitioners.fin")} · ${row.full_name}`}
                    onChange={(e) => edit(row.user_id, { fin: e.target.value })} />
                  {row.fin_set ? (
                    <label className="mt-1 flex items-center gap-1.5 font-text text-12">
                      <input type="checkbox" checked={row.clearFin}
                        onChange={(e) => edit(row.user_id, { clearFin: e.target.checked, fin: "" })} />
                      {t("tres.practitioners.finClear")}
                    </label>
                  ) : null}
                </td>
                <td>
                  <Input value={row.family} maxLength={100} aria-label={`${t("tres.practitioners.family")} · ${row.full_name}`}
                    onChange={(e) => edit(row.user_id, { family: e.target.value })} />
                </td>
                <td>
                  <Input value={row.given} maxLength={100} aria-label={`${t("tres.practitioners.given")} · ${row.full_name}`}
                    onChange={(e) => edit(row.user_id, { given: e.target.value })} />
                </td>
                <td>
                  <Button size="sm" busy={busy === row.user_id} onClick={() => save(row)}
                    aria-label={`${t("tres.practitioners.save")} · ${row.full_name}`}>{t("tres.practitioners.save")}</Button>
                  {tried === row.user_id && wrong(row) ? (
                    <p className="m-0 mt-1 text-12 text-crit">{t("tres.practitioners.invalid")}</p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Box>
  );
}
