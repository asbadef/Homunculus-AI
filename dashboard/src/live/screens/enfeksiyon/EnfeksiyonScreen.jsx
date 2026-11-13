// src/live/screens/enfeksiyon/EnfeksiyonScreen.jsx — «Enfeksiyon kontrol» (G4-05, spec D13–D15 as §5 S1, A3, A4, A6, M3,
// M4, M7 amend them): per unit, who is in isolation and where, who has suspected infection or a Sepsis-3 alarm and how
// their antibiotic clock stands, and the isolation beds. Read-only: it charts nothing — an isolation is recorded on the
// patient screen (patient/IsolationBox.jsx), by a person.
//
// TWO SOURCES (§5 S1). The patients are the page's own read (useInfection: GET /infection every 30 s, Eczane's tempo);
// the isolation beds are the shell's structure tree (useStructure, read again with each tick), worded with the answer's
// `bed_occupants`. Either can fail alone: without the tree the bed cells say why and the rest of the page stands;
// without a fresh answer every count, tile and table that would say «none» says «—» and why (Decision 18, spec D15).
//
// THE SERVER DECIDES, THE PAGE FORMATS AND ORDERS (spec D10, §5 M4). The states, the counts and `sort_group` are the
// engine's; the page orders the rows by the unit and bed names it holds (enfeksiyon.js `sortRows`), writes times in the
// reader's clock and, while the answer is fresh, the antibiotic durations as Eczane does (pharmacyModel). Names are shown
// (every default holder is a clinician of the unit); the bed and the name open the patient for a `board.view` holder.
//
// NOTHING HERE JUDGES (spec D19, §5 M7): no tile is coloured as a judgement — the isolation types are tags, the alarm
// tones the engine's severities — no isolation is recommended, and the honesty note says what the page does not have.
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, FOCUS_RING, Field, Note, Select, StatusPill, Table, Tag } from "../../ui/index.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { STRUCTURE_PERMS, useStructure, useUnitNames } from "../../data/StructureProvider.jsx";
import { normId } from "../../data/structure.js";
import { ScopeNote, nameOf } from "../common/BoardState.jsx";
import { useNow } from "../common/useNow.js";
import { bedNameOf } from "../beds/order.js";
import { antibioticCell, clockSkewOf, isFresh, msOf } from "../eczane/pharmacyModel.js";
import { WHY, structureSource } from "../ozet/ozet.js";
import {
  ALL, TYPES, alarmItems, bedTally, countCell, freeBedsCell, isolationBeds, roomCell, selectionOf, sortRows, tileWords,
  unitChoices, unitInScope, unitOf,
} from "./enfeksiyon.js";
import { useInfection } from "./useInfection.js";

/** The one window and source Eczane's source sentence states (spec D13 item 6): another is printed by its numbers. */
const WINDOW_MIN = 60;
const WINDOW_SOURCE = "surviving-sepsis-campaign-2026";

/** The five cards (spec D13 item 3, §5 A3, M3): the server's field, its label, and its second line. */
const CARDS = [
  { field: "isolated", label: "enfeksiyon.count.isolated",
    second: { field: "isolation_unrecorded", key: "enfeksiyon.count.isolationUnrecorded" } },
  { field: "free_beds", label: "enfeksiyon.count.freeBeds" },
  { field: "suspected", label: "enfeksiyon.count.suspected",
    second: { field: "suspected_unrecorded", key: "enfeksiyon.count.suspectedUnrecorded" } },
  { field: "clock_missed", label: "enfeksiyon.count.clockMissed" },
  { field: "sepsis_open", label: "enfeksiyon.count.sepsisOpen", note: "enfeksiyon.count.sepsisOpenNote" },
];

/** «—» and why: the one way a cell says it has no value (Decision 18). */
function Dash({ why }) {
  return (
    <span data-dash className="text-mute">
      {"—"}
      {why ? <>{" "}<span className="text-12">{why}</span></> : null}
    </span>
  );
}

/** The isolation types as Doluluk's warn tags, in the engine's order — a type this build does not know as its word. */
function Types({ types }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {(Array.isArray(types) ? types : []).map((type) => (
        <Tag key={type} tone="warn">{TYPES.includes(type) ? t(`enfeksiyon.type.${type}`) : String(type)}</Tag>
      ))}
    </span>
  );
}

/** The bed (else the key) and the name, one link to the patient for a `board.view` holder (Eczane D5). */
function Who({ row, canOpen }) {
  const { t } = useI18n();
  const who = (
    <>
      <span className="block font-data text-13.5 font-bold text-ink">{bedNameOf({ bedLabel: row.bed_label, patient_id: row.patient_id })}</span>
      <span className="block text-12.5 font-normal text-mute">{nameOf(row, t)}</span>
    </>
  );
  return canOpen
    ? <a href={`#/patients/${encodeURIComponent(row.patient_id ?? "")}`} className={`block rounded-md ${FOCUS_RING}`}>{who}</a>
    : who;
}

function UnitCell({ row, index, names }) {
  const { t } = useI18n();
  const unit = unitOf(row, index);
  return unit ? names.nameOf(unit) : <Dash why={t("enfeksiyon.unit.none")} />;
}

function Cards({ counts, fresh, tally, source, treeText, staleAsOf }) {
  const { t } = useI18n();
  const shown = (cell) => (cell.dash ? <Dash why={cell.why ? t(cell.why) : null} /> : String(cell.value));
  const second = ({ field, key }) => {
    const cell = countCell(counts?.[field], fresh);
    return cell.dash ? <Dash why={cell.why ? t(cell.why) : null} /> : t(key, { n: cell.value });
  };
  const freeBeds = () => {
    const cell = freeBedsCell(tally, fresh, source);
    if (!cell.dash) return `${cell.free} / ${cell.total}`;
    return <Dash why={cell.why === "tree" ? treeText : t(cell.why)} />;
  };
  return (
    <div data-counters>
      <div className="grid grid-cols-2 gap-2 min-[640px]:grid-cols-3 min-[1000px]:grid-cols-5">
        {CARDS.map((c) => (
          <div key={c.field} className="rounded-box border border-line bg-card px-3 py-2">
            <b data-testid={`count-${c.field}`} className="block font-data text-23 text-ink">
              {c.field === "free_beds" ? freeBeds() : shown(countCell(counts?.[c.field], fresh))}
            </b>
            <span className="block text-12 text-mute">{t(c.label)}</span>
            {c.second ? <span data-testid={`count-${c.second.field}`} className="block text-12 text-mute">{second(c.second)}</span> : null}
            {c.note ? <span className="block text-12 text-mute">{t(c.note)}</span> : null}
          </div>
        ))}
      </div>
      {staleAsOf ? <p data-as-of-stale className="m-0 mt-1 text-12 text-mute">{staleAsOf}</p> : null}
    </div>
  );
}

function IsolatedBox({ data, rows, fresh, canOpen, index, names, treeOk, treeText, nowMs }) {
  const { t } = useI18n();
  let body = null;
  if (data && rows.length > 0) {
    body = (
      <Table caption={t("enfeksiyon.isolated.caption", { n: rows.length })}>
        <thead>
          <tr>
            <th>{t("enfeksiyon.col.bed")}</th>
            <th>{t("enfeksiyon.col.unit")}</th>
            <th>{t("enfeksiyon.col.isolation")}</th>
            <th>{t("enfeksiyon.col.room")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const room = roomCell(row, index, treeOk);
            const charted = msOf(row.isolation?.charted_at);
            return (
              <tr key={row.patient_id} data-patient={row.patient_id}>
                <th scope="row" className="!normal-case !tracking-normal"><Who row={row} canOpen={canOpen} /></th>
                <td data-cell="unit"><UnitCell row={row} index={index} names={names} /></td>
                <td data-cell="isolation">
                  <Types types={row.isolation?.types} />
                  {charted !== null ? (
                    <span className="mt-0.5 block text-12 text-mute">{t("enfeksiyon.lastRecord", { time: dayStamp(charted, nowMs) })}</span>
                  ) : null}
                </td>
                <td data-cell="room">{room.key ? t(room.key) : <Dash why={room.why === "tree" ? treeText : t(room.why)} />}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    );
  } else if (data) {
    body = <p data-empty className="m-0 text-13">{fresh ? t("enfeksiyon.isolated.empty") : <Dash why={t("enfeksiyon.notFresh")} />}</p>;
  }
  return (
    <Box title={t("enfeksiyon.isolated.title")} icon="thermo" level={2}>
      <div data-isolated className="grid gap-2">
        {body}
        <p className="m-0 text-12.5 text-mute">{t("enfeksiyon.isolated.note")}</p>
      </div>
    </Box>
  );
}

function Tile({ tile, fresh, canOpen }) {
  const { t, lang } = useI18n();
  const words = tileWords(tile, fresh);
  let said;
  if (words.dash) said = <Dash why={t(words.why)} />;
  else if (words.stateKey) {
    // Review M5: a conflict from an answer that is not fresh is the last answer's, as an isolated tile is.
    said = `${words.lastAnswer ? `${t("enfeksiyon.beds.lastAnswer")} · ` : ""}${t(words.key, { state: t(words.stateKey).toLocaleLowerCase(lang) })}`;
  }
  else if (words.state !== undefined) said = t(words.key, { state: String(words.state) });
  else {
    said = (
      <>
        {words.lastAnswer ? `${t("enfeksiyon.beds.lastAnswer")} · ` : ""}
        {t(words.key)}
        {words.why ? <>{" "}<Dash why={t(words.why)} /></> : null}
      </>
    );
  }
  return (
    <li data-bed={tile.key} data-tile={tile.tile} className="grid gap-1 rounded-ctl border border-line bg-card px-2.5 py-2">
      <span className="flex items-baseline justify-between gap-2">
        <b className="font-data text-15">{tile.label}</b>
        <span className="truncate text-12 text-mute">{tile.roomName}</span>
      </span>
      <span data-words className="text-13">{said}</span>
      {(words.dash ? [] : tile.occupants).map((occupant) => (
        <span key={occupant.patient_id} className="grid gap-0.5">
          {canOpen ? (
            <a href={`#/patients/${encodeURIComponent(occupant.patient_id)}`} className={`rounded-md text-13 font-semibold ${FOCUS_RING}`}>
              {nameOf(occupant, t)}
            </a>
          ) : <span className="text-13 font-semibold">{nameOf(occupant, t)}</span>}
          {occupant.types.length > 0 ? <Types types={occupant.types} /> : null}
        </span>
      ))}
    </li>
  );
}

function BedsBox({ tiles, tally, fresh, treeOk, treeText, canOpen }) {
  const { t } = useI18n();
  let line;
  let body;
  if (!treeOk) {
    line = <Dash why={treeText} />;
    body = <Dash why={treeText} />;
  } else {
    line = fresh ? t("enfeksiyon.beds.tally", { occupied: tally.occupied, free: tally.free }) : <Dash why={t("enfeksiyon.notFresh")} />;
    body = tiles.length > 0 ? (
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2 p-0">
        {tiles.map((tile) => <Tile key={tile.key} tile={tile} fresh={fresh} canOpen={canOpen} />)}
      </ul>
    ) : (fresh ? t("enfeksiyon.beds.none") : <Dash why={t("enfeksiyon.notFresh")} />);
  }
  return (
    <Box title={t("enfeksiyon.beds.title")} icon="bed" level={2} right={<span data-tally>{line}</span>}>
      <div data-beds className="text-13">{body}</div>
    </Box>
  );
}

function AntibioticCell({ row, nowMs, fresh }) {
  const { t } = useI18n();
  const stamp = (ms) => (ms === null ? "—" : dayStamp(ms, nowMs));
  const cell = antibioticCell(row, nowMs, fresh);
  const text = t(cell.key, {
    duration: cell.duration ? t(cell.duration.key, cell.duration.params) : "—",
    time: stamp(cell.timeMs),
    state: String(cell.state ?? "—"),
  });
  return (
    <>
      {cell.tone ? <StatusPill tone={cell.tone}>{text}</StatusPill> : <span className={cell.state === "none" ? "text-mute" : ""}>{text}</span>}
      {cell.second ? <span className="mt-0.5 block text-12 text-mute">{t(cell.second.key, { time: stamp(cell.second.timeMs) })}</span> : null}
    </>
  );
}

function AlarmCell({ row, fresh, nowMs }) {
  const { t } = useI18n();
  const items = alarmItems(row);
  if (items.length === 0) {
    return fresh ? <span className="text-mute">{t("enfeksiyon.alarm.none")}</span> : <Dash why={t("enfeksiyon.notFresh")} />;
  }
  return items.map((item, at) => {
    const kind = item.kindKey ? t(item.kindKey) : item.kind;
    const notes = [
      item.latched ? t("alarms.resolvedUnacked") : null,
      item.acknowledged ? t("enfeksiyon.alarm.acknowledged") : null,
      item.snoozeMs !== null ? t("enfeksiyon.alarm.snoozed", { time: dayStamp(item.snoozeMs, nowMs) }) : null,
    ].filter(Boolean);
    return (
      <span key={`${item.kind}-${at}`} data-alarm={item.kind} className="block">
        <StatusPill tone={item.tone}>{fresh ? kind : t("enfeksiyon.alarm.lastAnswer", { kind })}</StatusPill>
        {/* A space, not only a margin: the text a reader copies or hears does not run together (review M7). */}
        {notes.length > 0 ? <>{" "}<span className="ms-1 text-12 text-mute">{notes.join(" · ")}</span></> : null}
      </span>
    );
  });
}

function SuspectedBox({ data, rows, fresh, canOpen, index, names, nowMs }) {
  const { t } = useI18n();
  const standard = data?.antibiotic_window_min === WINDOW_MIN && data?.antibiotic_window_source === WINDOW_SOURCE;
  let body = null;
  if (data && rows.length > 0) {
    body = (
      <Table caption={t("enfeksiyon.suspected.caption", { n: rows.length })}>
        <thead>
          <tr>
            <th>{t("enfeksiyon.col.bed")}</th>
            <th>{t("enfeksiyon.col.unit")}</th>
            <th>{t("enfeksiyon.col.antibiotic")}</th>
            <th>{t("enfeksiyon.col.sepsis")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.patient_id} data-patient={row.patient_id}>
              <th scope="row" className="!normal-case !tracking-normal"><Who row={row} canOpen={canOpen} /></th>
              <td data-cell="unit"><UnitCell row={row} index={index} names={names} /></td>
              <td data-cell="antibiotic"><AntibioticCell row={row} nowMs={nowMs} fresh={fresh} /></td>
              <td data-cell="sepsis"><AlarmCell row={row} fresh={fresh} nowMs={nowMs} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  } else if (data) {
    body = <p data-empty className="m-0 text-13">{fresh ? t("enfeksiyon.suspected.empty") : <Dash why={t("enfeksiyon.notFresh")} />}</p>;
  }
  return (
    <Box title={t("enfeksiyon.suspected.title")} icon="flask" level={2}>
      <div data-suspected className="grid gap-2">
        {body}
        <p className="m-0 text-12.5 text-mute">{t("eczane.note")}</p>
        {data ? (
          <p data-source className="m-0 text-12.5 text-mute">
            {standard
              ? t("eczane.source")
              : t("eczane.sourceOther", { minutes: String(data.antibiotic_window_min ?? "—"), source: String(data.antibiotic_window_source ?? "—") })}
          </p>
        ) : null}
      </div>
    </Box>
  );
}

export function EnfeksiyonScreen() {
  const { t, lang } = useI18n();
  const { user, store } = useSession();
  const tree = useStructure();
  const perms = user?.perms ?? [];
  const mayTree = STRUCTURE_PERMS.some((key) => perms.includes(key));
  const canOpen = perms.includes("board.view");
  const { data, error, skewMs, refresh } = useInfection(store, { reloadStructure: mayTree ? tree.reload : null });
  // The page's clock is the server's for every session (Eczane D17): the board's skew for a `board.view` holder, else
  // the skew of this page's own answers — a session holding `infection.view` alone has no board store behind it.
  const { clockSkewMs } = useBoard();
  const nowMs = useNow(10_000) + clockSkewOf(clockSkewMs, skewMs);
  const fresh = isFresh(data, error, nowMs);
  const source = structureSource(tree, mayTree);
  const treeText = source.ok ? null
    : source.why === WHY.failed ? t("enfeksiyon.structure.failed", { reason: readErrorText(t, tree.error) })
      : source.why === WHY.loading ? t("enfeksiyon.structure.loading") : t("enfeksiyon.structure.noRight");

  // The filter offers the tree's units inside the answer's scope and the answer's own (§5 S1), named and ordered as
  // every screen names them; a unit a new read no longer lists falls back to «Tüm birimler», and the page says so (spec
  // D13 item 1). Review M4: that claim is made only when it is known. While the tree does not count (no structure key,
  // or not read yet) a unit offered once in this session stays — its patients leaving the list is no news about the
  // unit — unless the answer's scope leaves it out; once the tree counts, the tree and the answer are the list.
  const current = useMemo(() => unitChoices(tree.known ? tree.structure : null, data, tree.index),
    [tree.known, tree.structure, data, tree.index]);
  const [offered, setOffered] = useState([]);
  useEffect(() => {
    setOffered((prev) => {
      const have = new Set(prev.map(normId));
      const added = current.filter((id) => !have.has(normId(id)));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [current]);
  const choiceIds = useMemo(() => {
    if (source.ok) return current;
    const have = new Set(current.map(normId));
    return [...current, ...offered.filter((id) => !have.has(normId(id)) && unitInScope(data, id, tree.index) !== false)];
  }, [source.ok, current, offered, data, tree.index]);
  const names = useUnitNames(choiceIds);
  const [picked, setPicked] = useState(ALL);
  const [gone, setGone] = useState(false);
  const listed = picked === ALL || choiceIds.some((id) => normId(id) === picked);
  useEffect(() => {
    if (!listed && data) {
      setPicked(ALL);
      setGone(true);
    }
  }, [listed, data]);
  const selected = listed ? picked : ALL;

  const selection = selectionOf(data, selected);
  const ordering = { unitOf: (row) => unitOf(row, tree.index), unitName: names.nameOf, lang };
  const isolated = sortRows(selection.isolated, ordering);
  const suspected = sortRows(selection.suspected, { ...ordering, byGroup: true });
  const tiles = data && source.ok
    ? isolationBeds(tree.structure, data).filter((tile) => selected === ALL || tile.unitKey === selected) : [];
  const tally = bedTally(tiles);
  const answeredMs = msOf(data?.now);
  const answered = answeredMs === null ? "—" : dayStamp(answeredMs, nowMs);
  const reason = error ? (error.malformed ? t("enfeksiyon.malformed") : readErrorText(t, error)) : null;

  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-23 font-bold">{t("enfeksiyon.title")}</h1>
          <p className="m-0 text-13 text-mute">{t("enfeksiyon.intro")}</p>
          {data && fresh ? <p data-as-of className="m-0 mt-0.5 text-12 text-mute">{t("enfeksiyon.asOf", { time: answered })}</p> : null}
        </div>
        <Field label={t("enfeksiyon.unit.label")} layout="col" className="min-w-[200px] max-w-[320px]">
          <Select value={selected} onChange={(event) => { setPicked(event.target.value); setGone(false); }}>
            <option value={ALL}>{t("enfeksiyon.unit.all")}</option>
            {names.sorted.map((id) => <option key={normId(id)} value={normId(id)}>{names.nameOf(id)}</option>)}
          </Select>
        </Field>
        <Button size="sm" icon="clock" onClick={() => { refresh(); }}>{t("enfeksiyon.refresh")}</Button>
      </div>
      {/* An info Alert, not a Note: the fallback happens without the reader's doing, so it is said (review M4). */}
      {gone ? <Alert tone="info" icon="alert">{t("enfeksiyon.unit.gone")}</Alert> : null}
      {!data && !error ? <Note tone="info" icon="clock">{t("enfeksiyon.loading")}</Note> : null}
      {!data && error ? <Alert tone="crit"><p className="m-0">{t("enfeksiyon.readFailed", { reason })}</p></Alert> : null}
      {data && !fresh ? (
        <Alert tone="crit">
          <p className="m-0">{t("enfeksiyon.stale", { time: answered })}</p>
          {reason ? <p className="m-0 mt-1 font-normal">{reason}</p> : null}
        </Alert>
      ) : null}
      {data ? <ScopeNote scope={data.scope} scopeNote={data.scope_note} /> : null}
      {data ? (
        <Cards counts={selection.counts} fresh={fresh} tally={tally} source={source} treeText={treeText}
          staleAsOf={fresh ? null : t("enfeksiyon.staleAsOf", { time: answered })} />
      ) : null}
      <IsolatedBox data={data} rows={isolated} fresh={fresh} canOpen={canOpen} index={tree.index} names={names}
        treeOk={source.ok} treeText={treeText} nowMs={nowMs} />
      {data ? <BedsBox tiles={tiles} tally={tally} fresh={fresh} treeOk={source.ok} treeText={treeText} canOpen={canOpen} /> : null}
      <SuspectedBox data={data} rows={suspected} fresh={fresh} canOpen={canOpen} index={tree.index} names={names} nowMs={nowMs} />
      <p data-honesty className="m-0 text-12.5 text-mute">{t("enfeksiyon.honesty")}</p>
    </div>
  );
}
