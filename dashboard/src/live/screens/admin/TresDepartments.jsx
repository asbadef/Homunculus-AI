// src/live/screens/admin/TresDepartments.jsx — Yönetim › TRƏS › «Bölüm eşleme» (TRƏS-01 · phase F1, spec §6, §8, D17):
// each unit of the hospital with the platform's `hospital-departments` code and name it goes under. An unmapped unit's
// stays are not sent (`unit_unmapped`), never sent under a default department.
//
// The map is saved WHOLE (PUT /admin/tres/departments): a row whose code and name are both empty is unmapped; a row with
// one of the two is held on the screen before anything is sent. Closed units are listed too — a past stay may be in one.
// A refusal is said by its code; the rows keep what was typed. A failed read says so and offers «Yeniden dene»; a hospital
// with no unit says so and offers no save (review, 2026-11-13). A held half row's inputs are tied to the sentence that
// names the fault (aria-invalid, aria-describedby).
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Box, Button, Empty, Input, Table, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";
import { TresReadFailed } from "./TresReadFailed.jsx";

const rowOf = (unit) => ({ ...unit, code: unit.code ?? "", display: unit.display ?? "" });
/** A row with exactly one of its two fields: the server would refuse it. */
export const half = (row) => (row.code.trim() === "") !== (row.display.trim() === "");
/** The whole map as the server takes it: the rows with both fields, trimmed. */
export const mapOf = (rows) => rows.filter((r) => r.code.trim() && r.display.trim())
  .map((r) => ({ unit_id: r.unit_id, code: r.code.trim(), display: r.display.trim() }));

export function TresDepartments() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const saving = useRef(false);
  const invalidId = `${useId()}-invalid`;

  const read = useCallback(async () => {
    try {
      const got = await store.track(() => store.api.tresDepartments());
      if (!Array.isArray(got)) throw new Error("no units in the answer");
      setRows(got.map(rowOf));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store]);
  useEffect(() => { read(); }, [read]);

  const edit = (unitId, patch) => setRows((all) => all.map((r) => (r.unit_id === unitId ? { ...r, ...patch } : r)));

  async function retry() {
    setReading(true);
    try {
      await read();
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (saving.current) return;
    if (rows.some(half)) {
      setTried(true);
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const got = await store.track(() => store.api.saveTresDepartments(mapOf(rows)));
      if (Array.isArray(got)) setRows(got.map(rowOf));
      setTried(false);
      toast(t("tres.departments.saved"));
    } catch (err) {
      toast(refusedFor(t, t("tres.departments.title"), err), "error");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const held = tried && rows !== null && rows.some(half);
  return (
    <Box title={t("tres.departments.title")} level={2}>
      <p className="m-0 mb-3 text-13 text-mute">{t("tres.departments.sub")}</p>
      {error ? (
        <TresReadFailed text={t("tres.departments.readFailed", { reason: readErrorText(t, error) })} busy={reading}
          onRetry={retry} />
      ) : rows === null ? (
        <p className="m-0 text-13 text-mute">{t("tres.departments.loading")}</p>
      ) : rows.length === 0 ? (
        <Empty>{t("tres.departments.empty")}</Empty>
      ) : (
        <>
          <Table caption={t("tres.departments.caption")}>
            <thead>
              <tr><th>{t("tres.departments.unit")}</th><th>{t("tres.departments.code")}</th><th>{t("tres.departments.display")}</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.unit_id}>
                  <th scope="row" className="font-text text-13.5">
                    {row.unit_name}{row.unit_active ? "" : ` ${t("tres.departments.closed")}`}
                  </th>
                  <td>
                    <Input value={row.code} maxLength={32} aria-label={`${t("tres.departments.code")} · ${row.unit_name}`}
                      aria-invalid={tried && half(row) ? "true" : undefined}
                      aria-describedby={tried && half(row) ? invalidId : undefined}
                      onChange={(e) => edit(row.unit_id, { code: e.target.value })} />
                  </td>
                  <td>
                    <Input value={row.display} maxLength={200} aria-label={`${t("tres.departments.display")} · ${row.unit_name}`}
                      aria-invalid={tried && half(row) ? "true" : undefined}
                      aria-describedby={tried && half(row) ? invalidId : undefined}
                      onChange={(e) => edit(row.unit_id, { display: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {held ? <p id={invalidId} className="m-0 mt-2 text-13 text-crit">{t("tres.departments.invalid")}</p> : null}
          <Button className="mt-3" variant="primary" busy={busy} onClick={save}>{t("tres.departments.save")}</Button>
        </>
      )}
    </Box>
  );
}
