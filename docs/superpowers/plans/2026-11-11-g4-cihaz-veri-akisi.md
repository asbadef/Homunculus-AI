# G4-01 «Cihaz & Veri Akışı» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Two implementers run the **engine lane** (Tasks 1–4) and the **dashboard lane** (Tasks 5–10) **in parallel, in the same worktree**; Task 11 (docs) and Task 12 (gates) run after both lanes report.

**Goal:** The device page (`/devices`) first answers «is data arriving?» — the verdict and its counts, the silent monitors with since when, the stale channels, the data chain, the table's rows never seen — above the unchanged editor and strip cards, from a server-side, memory-only last-seen ledger carried additively on `GET /infinity-shadow/board`.

**Architecture:** Engine: a small `FeedLedger` class beside `ShadowStore` in `api/infinity_shadow.py`, fed by the POST route from what the store shows after each accepted body, read by the GET route and laid onto the cards `board_view` already scoped. The store, its readings, its 120-s forgetting and everything the shadow engine reads stay byte-identical. Dashboard: a pure `screens/devices/deviceFeed.js` (verdict, rows, chain, durations on the board's own clock) and a `FeedSections.jsx` component at the top of `DevicesScreen`, worded by a new `cihaz` string namespace; the never-seen rows come from the editor's own device-beds poll. No new route, no permission change, no migration, no hub change.

**Tech Stack:** Python 3 / FastAPI / pytest (engine); React 18 / Vitest 2 / Testing Library / Tailwind (dashboard); Turkish guide in Markdown.

**Spec (the contract):** `docs/superpowers/specs/2026-11-11-g4-cihaz-veri-akisi-design.md` (committed at `97743c3d`). Read it whole before your first task.

---

## Plan notes — where the spec meets the code

Each note is a choice this plan makes where the spec and the tree disagree, or where the spec leaves a detail open. They are binding for the implementers; a reviewer who disagrees raises it, the implementer does not improvise.

**N1 — How `STALE_LIST_AFTER_S` reaches the client (settled).** As a top-level board field, `stale_list_after_s: 60.0`, beside `display_max_age_s`. The client compares its own ticking durations with it (`deviceFeed.js staleAfterOf`) and falls back to its own `STALE_LIST_AFTER_S = 60` for an answer that carries none. The server does **not** mark channels: a mark taken at `generated_at` would not tick between polls, and on a board that is not fresh it would freeze — D5 says durations tick. The field is additive; it is the one field not named in D3's table.

**N2 — How `vanished` is scoped through the approved table (settled).** `vanished` is cut from the cards the caller is already shown: bed cards that passed `visible(card)` (the table row valid now, then the caller's scope) and unassigned cards only when `show_unassigned`. So it inherits the cards' rule exactly, with no second rule to drift: a scoped `board.view` caller gets the vanished rows of its own beds only, `devices.manage` gets all, and an unassigned device's row has `bed_label: null`.

**N3 — What `vanished` means, given the store (spec vs code).** `ShadowStore` never drops a device the hub stops listing: it stays a card with status `unknown` until the `MAX_DEVICES` eviction or a restart (`infinity_shadow.py` `ingest`/`devices`; the hub itself lists every inventory device, `edge/infinity_live.py snapshot`). So a vanished device is **also** an `unknown` card. The plan defines: *vanished* = in the ledger, **absent from the latest accepted body**, and its card `unknown` (unreported for more than `SILENT_AFTER_S`, on the store's monotonic clock). An `unknown` device that the latest body still listed is the forwarder's silence, not its own: it is not vanished, and the verdict is the chain's. The page merges by source: one row per device, worded «hub artık bildirmiyor» when vanished. After `LEDGER_KEEP_S` (24 h) the ledger drops the device as D2 says; its card, still in the store, then carries `last_packet_at: null`, `silent_for_s: null`, `channels_seen: []`, and the page lists it under «Sessiz monitörler» as «son verinin zamanı bilinmiyor».

**N4 — `silent_for_s`: `packet_age_ms` or `last_packet_at`? (settled).** The ledger's `last_packet_at`, for `silent` and `unknown` alike: `int(max(0, now − last_packet_at))` at the board's `now` (wall clock, the same clock as `generated_at`), floored. Not the hub's `packet_age_ms`: it freezes once the hub stops reporting a device, so the two kinds would disagree; for a `silent` device the two agree within the transport delay. The page does not print `silent_for_s` (D5: it ticks its own durations from the ISO times); it is the server's figure at `generated_at`.

**N5 — `last_packet_at` when the age is absent (spec vs code).** D2 says "or the report's time when the age is absent". The hub sends `packet_age_ms: null` only for a device it has had **no packet from** (`waiting`, or after a hub restart — `edge/infinity_live.py snapshot`). Writing the report's time would print «son veri 10:42» for a monitor that never sent. The ledger leaves `last_packet_at` where it was (null if never).

**N6 — The ledger is its own class, not a `ShadowStore` method (spec vs code).** D2 says "`ShadowStore` gains a small ledger". `tests/test_infinity_shadow_store.py::test_the_store_has_no_method_that_could_reach_the_clinical_side` pins the store's public surface to `ingest/devices/feed` and its constructor to `clock/monotonic`, and the existing tests must stay unchanged. So `FeedLedger` lives in the same module, beside the store, created next to it in `create_app` (`app.state.shadow_ledger`); the POST route feeds it from `shadow_store.devices()` after an accepted body (`reported_sources(body)` names who the body listed), the GET route passes `shadow_ledger.view()` to `board_view(ledger=…)`. `board_view` without a ledger returns exactly today's body, so Aşama B's `_sample_and_publish` pass (which calls it without one) is byte-identical. The ledger's own surface is pinned the same way (`observe`, `view`). A failure inside the ledger is logged and never refuses an accepted body.

**N7 — Clocks.** The ledger keeps wall-clock epochs for every time the board prints, and measures the 24-h keep on the monotonic clock, as the store measures "unreported" (a wall clock stepped by NTP or a VM restore neither drops nor keeps a device by mistake).

**N8 — "The board's skew-corrected clock" (D5).** The page measures from the shadow board's own `generated_at` plus this browser's time since `fetchedAtMs` (`deviceFeed.js serverNowMs`): two readings of one clock on each side, the same rule as the strip's ages (`data/ShadowProvider.jsx`). Not `useBoardNow`: that corrects by the clinical board's measured skew, which a `devices.manage`-only session (biomedical: no `board.view`, no board stream) never measures.

**N9 — "While its device still sends" (D4)** is the card status `streaming`. A device in `standby`, `silent`, `unknown`, `waiting` or `unsupported` has no stale channel; standby is counted on its own, silence is section 2's.

**N10 — Never-seen rows (section 5).** From the editor's own poll of `GET /infinity-shadow/device-beds`, lifted by an optional `onList` prop on `MappingSection`, so the page asks once per 5 s, not twice. That route takes `devices.manage` **or** `devices.map_beds` (`devicebeds/router.py`, `require_permission(...)` = ANY), the page's own two keys, so every page holder can read it. A never-seen row is `row_id != null && status === null` (`devicebeds/listing.py`: `status` is null when the API has never had a report of the monitor since it started). A session that holds neither key has no editor and no section 5. Its own Decision 18: «none» only from a list that answered; a list that later fails keeps its rows and says so (`esleme.unreadable`).

**N11 — Counts and durations.** Section 1 prints only the counts above zero (a «0» is a list called empty, which only a fresh answer may say). Durations are whole minutes, floored — «4 dk'dır» is a true lower bound and «<1 dk» is under a minute, as D5 words it — carried as one phrase `{for}` so each language places it. The chain's ages use the strip's own `ageText` (ceiled seconds/minutes).

**N12 — When the chain is broken** (`feed.state` not `ok`), section 1 is the chain's verdict with no counts, and sections 2 and 3 say «Veri zinciri kesik: monitörler tek tek listelenmiyor» instead of rows — D5's "the page says so instead of listing them as faults".

**N13 — What the rename touches.** Nav label «Cihazlar» (az «Cihazlar», ru «Устройства», en «Devices»), heading «Cihaz & Veri Akışı» (new key `cihaz.title`; the route keeps `labelKey: "nav.devices"`). Two UI texts name the screen by its rail name and follow it: `kabul.err.bedHasMonitor` and `perms.devices.map_beds`. The login screen's `auth.noScreen` drops its example «(ör. yalnız cihaz yönetimi)», which is false now that `devices.manage` opens a screen — the UI's copy of the stale guide sentence D5 corrects. The guide's older sections (§3.9, §3.11) keep «Monitörler»; §3.22 says it is the same screen.

**N14 — Words that would collide with the strip's.** The chain's rejected line has its own words (`cihaz.chainRejected`, az «Qəbul edilməyən dəyərlər») rather than `monitor.feedRejected`, and the az verdict says «monitordan məlumat gəlir», not «məlumat göndərir»: the strip below keeps its own counter lines, and the existing `DevicesScreen.test.jsx` finds them by those words (`/rədd edilən oxunuş/i`, `/məlumat göndərir/`). The az collector's heartbeat is «əlaqə», never «siqnal», which is the az UI's word for an alarm. `cihaz.strings.test.js` pins all three.

---

## Execution rules (both lanes — read before Task 0)

- **Code exploration:** `graphify-out/graph.json` lives in the main checkout `C:/Users/User/Desktop/Project/Homunculus AI` and was built from an older branch. Before your first grep or source read for a codebase question, run `graphify query "<question>"` from that directory (`cd "/c/Users/User/Desktop/Project/Homunculus AI" && graphify query "..."`), then read the **worktree's** files (`C:\tmp\g4-cihaz`) for the current lines. Use `graphify path "<A>" "<B>"` / `graphify explain "<concept>"` for focused questions. **Never run `graphify update`.**
- **Tests in the FOREGROUND only.** Never background a test run and wait on it; split a long run into chunks instead. Report before you wait on anything.
- **Engine tests:** from `C:\tmp\g4-cihaz\homunculus-engine`, always written out in full (shell variables do not persist between tool calls):
  `"/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest <paths> -q -p no:cacheprovider`
  pytest's `pythonpath = ["src", "tests"]` (pyproject) puts the worktree's `src` first, ahead of the venv's editable install of the main checkout — Task 0 checks it.
- **Dashboard tests:** from `C:\tmp\g4-cihaz\dashboard`: `npx vitest run <files>` (`node_modules` is a junction, already present).
- **Never** `npm install` or `pip install`. **Never** set `DATABASE_URL`; no DB is needed (DB-backed tests skip). **Never** run `tests/test_infinity_vm_pilot.py`.
- **Never a bare `git stash`.** Never `git add -A`, never `git commit -a`. Every commit names its paths: `git add <paths>` then `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <paths>` from `C:\tmp\g4-cihaz`. The pathspec matters: the other lane may have files staged at the same moment, and `git commit -- <paths>` commits only yours.
- If `.git/index.lock` exists, the other lane is committing: wait a few seconds and retry. **Never delete it.**
- `core.autocrlf=true`: tracked files are CRLF in the working tree. Edit existing files with the **Edit** tool (or a `python -I -X utf8` script that writes `\r\n`); create new files with the **Write** tool. **Never** write code with a Bash heredoc (the Bash tool mangles backslashes in heredocs).
- Every **find** block below occurs **exactly once** in its file at that point of the plan (checked when the plan was written); if one does not match, stop and report — do not guess.
- **No patient data:** synthetic ids only (`synth-p1`, `S-003`, `192.0.2.x`, `198.51.100.x`).
- Do not push. Do not merge. Do not touch the VM.

## Lanes and file ownership

The two lanes share **no file**. Each lane commits only its own paths.

| Lane | Tasks | Files (only these) |
|---|---|---|
| Engine | 1–4 | `homunculus-engine/src/homunculus/api/infinity_shadow.py`, `homunculus-engine/src/homunculus/api/app.py`, `homunculus-engine/tests/test_infinity_shadow_ledger.py` (new), `homunculus-engine/tests/test_infinity_shadow_ledger_api.py` (new) |
| Dashboard | 5–10 | `dashboard/src/live/i18n/strings/cihaz.js` (new), `dashboard/src/live/i18n/cihaz.strings.test.js` (new), `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`, `dashboard/src/live/i18n/strings/nav.js`, `dashboard/src/live/i18n/strings/kabul.js`, `dashboard/src/live/i18n/strings/perms.js`, `dashboard/src/live/i18n/strings/auth.js`, `dashboard/src/live/screens/devices/deviceFeed.js` (new), `dashboard/src/live/screens/devices/deviceFeed.test.js` (new), `dashboard/src/live/screens/devices/FeedSections.jsx` (new), `dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx` (new), `dashboard/src/live/screens/devices/DevicesScreen.jsx`, `dashboard/src/live/screens/devices/DevicesScreen.test.jsx`, `dashboard/src/live/screens/devices/MappingSection.jsx`, `dashboard/src/live/screens/admin/StructureTab.test.jsx`, `dashboard/src/live/rawKeys.test.jsx` |
| Docs (after both) | 11 | `docs/homunculus-rehber-TR.md` |
| Gates (last) | 12 | none (fixes go back to the owning lane) |

The dashboard lane never needs the engine running: its tests use fixtures in the contract's shape below.

## The shared contract — `GET /infinity-shadow/board`, additive

Present only when the strip is on and the caller is the strip's hospital (as every board field is). Every field it had stays, with the same meaning. ISO times are `datetime.fromtimestamp(epoch, timezone.utc).isoformat()` — `+00:00`, microseconds only when non-zero.

| Where | Field | Type | Example | Meaning |
|---|---|---|---|---|
| top level | `watching_since` | string (ISO) | `"2027-01-15T08:00:00+00:00"` | when the ledger started: the API's start. A restart resets it. |
| top level | `stale_list_after_s` | number | `60.0` | the page lists a channel as stale once its last valid value is older than this (N1) |
| top level | `vanished` | array | `[{"source": "192.0.2.11", "bed_label": "B-2", "last_packet_at": "2027-01-15T07:59:59.880000+00:00", "last_report_at": "2027-01-15T08:00:00+00:00"}]` | devices the hub no longer lists, still in the ledger (≤ 24 h), scoped as the cards (N2, N3). Order: the cards' order (beds by label, then unassigned by address). |
| `vanished[]` | `source` | string | `"192.0.2.11"` | the device's address |
| `vanished[]` | `bed_label` | string \| null | `"B-2"` / `null` | the card's bed label; null for an unassigned device |
| `vanished[]` | `last_packet_at` | string \| null | `"2027-01-15T07:59:59.880000+00:00"` | as the card's |
| `vanished[]` | `last_report_at` | string | `"2027-01-15T08:00:00+00:00"` | the last accepted body that listed it |
| each card (beds and unassigned) | `last_packet_at` | string \| null | `"2027-01-15T07:59:59.880000+00:00"` | the last report's time less its `packet_age_ms`; null when no packet is known (N5) or the ledger has dropped the device |
| each card | `silent_for_s` | integer \| null | `45` | whole seconds since `last_packet_at` when the card's status is `silent` or `unknown`; otherwise null (N4) |
| each card | `channels_seen` | array | `[{"parameter": "hr", "last_value_at": "2027-01-15T07:59:59.600000+00:00"}, {"parameter": "nbp", "last_value_at": "…"}]` | every channel that carried a valid value since `watching_since`, the forgotten ones included; the board's order (`hr, pls, spo2, etco2, temperature, art_systolic, art_diastolic, art_mean, respiration`, then `nbp` last) |

None of these fields names a patient. `GET /infinity-shadow/device-beds` is unchanged; the page reads `devices[].source`, `.status` (null = never reported), `.row_id`, `.bed`, `.device_bed_label`.

## File map

**Engine**
- Modify `homunculus-engine/src/homunculus/api/infinity_shadow.py` — constants `LEDGER_KEEP_S`, `STALE_LIST_AFTER_S`; the ledger block (`CHANNELS`, `SHOWN_VALUE`, `reported_sources`, `_Seen`, `SeenView`, `LedgerView`, `FeedLedger`) between `ShadowStore` and the board's answer; `board_view(…, ledger=None)` and `_ledger_fields`.
- Modify `homunculus-engine/src/homunculus/api/app.py` — create the ledger beside the store, `app.state.shadow_ledger`, feed it in `POST /infinity-shadow/readings` (`_note_seen`), pass it in `GET /infinity-shadow/board`.
- Create `homunculus-engine/tests/test_infinity_shadow_ledger.py` — the ledger (Task 1) and `board_view`'s fields (Task 2), pure.
- Create `homunculus-engine/tests/test_infinity_shadow_ledger_api.py` — through the two routes: fields, vanished for 24 h, scope, no patient, a failing ledger (Task 3).

**Dashboard**
- Create `dashboard/src/live/i18n/strings/cihaz.js` — the namespace; register it in `catalog.js`.
- Create `dashboard/src/live/i18n/cihaz.strings.test.js` — the spec's Turkish, the duration phrase, the words that must not collide.
- Create `dashboard/src/live/screens/devices/deviceFeed.js` — pure: `serverNowMs`, `minutesOf`, `staleAfterOf`, `verdictOf`, `silentRows`, `staleRows`, `countsOf`, `chainLines`, `neverSeenRows`.
- Create `dashboard/src/live/screens/devices/deviceFeed.test.js` — the rules on a fixed clock.
- Create `dashboard/src/live/screens/devices/FeedSections.jsx` — the five sections.
- Create `dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx` — the page with each section, Decision 18.
- Modify `DevicesScreen.jsx` (sections first, the editor's list lifted, the heading), `MappingSection.jsx` (`onList`), `DevicesScreen.test.jsx` (the level-2 heading test, the heading's name), `rawKeys.test.jsx` (an anchor for the new keys), `strings.test.js` (`AZ_SAME_AS_TR`), `nav.js`, `kabul.js`, `perms.js`, `auth.js`, `StructureTab.test.jsx` (the screen's new name in a pinned text).

**Docs**
- Modify `docs/homunculus-rehber-TR.md` — §3.22 before the `---` that precedes «## 4.»; the stale sentences of §3 «Girişten sonra nereye düşülür»; the Yapı quote that names the screen.

---

## Task 0: Preflight (each implementer, once)

**Files:** none.

- [ ] **Step 1: Check the worktree**

Run: `cd /c/tmp/g4-cihaz && git status --short && git log --oneline -2`
Expected: no changes listed; the head is this plan's commit, its parent `97743c3d docs(spec): G4-01 «Cihaz & Veri Akışı» …`, on branch `feat/g4-cihaz-akis`.

- [ ] **Step 2 (engine lane): Check that pytest imports the worktree's code**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -c "import sys; sys.path.insert(0, 'src'); import homunculus; print(homunculus.__file__)"`
Expected: `C:\tmp\g4-cihaz\homunculus-engine\src\homunculus\__init__.py`. Anything under `Desktop\Project` means the tests would exercise the main checkout: stop and report.

- [ ] **Step 3 (dashboard lane): Check the toolchain**

Run: `cd /c/tmp/g4-cihaz/dashboard && ls node_modules/.bin/vitest && npx vitest run src/live/screens/devices/DevicesScreen.test.jsx`
Expected: the file exists; `19 passed`.

- [ ] **Step 4: Run graphify once for your lane** (rule above), e.g. engine: `graphify query "ShadowStore board_view infinity shadow board scope"`; dashboard: `graphify query "DevicesScreen MappingSection shadowStore MonitorFeedChip"`. The graph predates these files, so expect little; read the worktree after.

---

# Engine lane

## Task 1 (engine): the last-seen ledger, `FeedLedger`

**Files:**
- Create: `homunculus-engine/tests/test_infinity_shadow_ledger.py`
- Modify: `homunculus-engine/src/homunculus/api/infinity_shadow.py` (imports ~line 22; constants ~line 153; a new block before `# --- the board's answer` ~line 498)

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_infinity_shadow_ledger.py` with:

```python
"""G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D2–D4): the shadow lane's last-seen ledger.

Memory only, beside the store's readings: when each device was first and last reported, when its last
packet came (the report's time less the hub's packet age), and when each channel last carried a valid
value — kept after the store forgets the reading at 120 s. A device the hub stops reporting stays 24 h,
never more devices than the store holds, and only the board's own channels. The store itself is
unchanged (test_infinity_shadow_store.py pins its surface). Synthetic sources only (192.0.2.x,
198.51.100.x).
"""
from __future__ import annotations

import inspect
from datetime import datetime, timezone

import pytest

from homunculus.api.infinity_shadow import (
    FORGET_AFTER_S, LEDGER_KEEP_S, MAX_DEVICES, NBP_PARTS, SCHEMA, STALE_LIST_AFTER_S, FeedLedger, ShadowStore,
    reported_sources,
)

T0 = 1_800_000_000.0


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


def reading(parameter="hr", value=72, unit="bpm", *, valid=True, captured_at=T0 - 0.5, changed_at=None):
    out = {"parameter": parameter, "value": value if valid else None, "unit": unit, "valid": valid,
           "captured_at": captured_at}
    if parameter in NBP_PARTS:
        out["changed_at"] = changed_at                 # v2: an NBP reading always carries the key
    return out


def device(source="192.0.2.10", *readings, status="streaming", packet_age_ms=100.0):
    last = source.rsplit(".", 1)[1]
    return {"source": source, "group": f"239.20.1.{last}", "port": 2050, "status": status,
            "packet_age_ms": packet_age_ms, "readings": list(readings)}


def body(*devices, sent_at=T0):
    return {"schema": SCHEMA, "sent_at": sent_at,
            "forwarder": {"interval_s": 5, "sent": 10, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 100, "old_or_duplicate_packets": 2},
            "devices": list(devices)}


def lane(clock=None, monotonic=None):
    """A store and its ledger on the same clocks, as create_app builds them."""
    clock = clock or Clock()
    return clock, ShadowStore(clock, monotonic=monotonic), FeedLedger(clock, monotonic=monotonic)


def post(store, ledger, raw):
    """What POST /infinity-shadow/readings does with a body it accepts (app.py `_note_seen`)."""
    store.ingest(raw)
    ledger.observe(store.devices(), reported_sources(raw))


def _iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


# --- the ledger (Task 1) -------------------------------------------------------------------------

def test_the_ledgers_bounds_are_the_specs():
    assert (STALE_LIST_AFTER_S, LEDGER_KEEP_S, MAX_DEVICES) == (60.0, 24 * 3600.0, 100)


def test_watching_starts_when_the_ledger_is_made_and_nothing_is_held_before_a_report():
    clock, store, ledger = lane()
    clock.t = T0 + 7
    seen = ledger.view()
    assert seen.started_at == T0 and dict(seen.devices) == {}


def test_reported_sources_are_the_bodys_addresses():
    assert reported_sources(body(device("192.0.2.10"), device("192.0.2.11"))) == ["192.0.2.10", "192.0.2.11"]


def test_a_report_sets_the_last_report_and_the_last_packet_less_its_age():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading(), packet_age_ms=1500.0)))
    one = ledger.view().devices["192.0.2.10"]
    assert (one.first_seen_at, one.last_report_at, one.last_packet_at, one.reported) == (T0, T0, T0 - 1.5, True)
    clock.t = T0 + 5                                    # the monitor went quiet: the hub's age grows with it
    post(store, ledger, body(device("192.0.2.10", status="stale", packet_age_ms=6500.0), sent_at=clock.t))
    one = ledger.view().devices["192.0.2.10"]
    assert (one.first_seen_at, one.last_report_at, one.last_packet_at) == (T0, T0 + 5, T0 - 1.5)


def test_a_report_with_no_packet_age_leaves_the_last_packet_where_it_was():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", status="waiting", packet_age_ms=None)))
    assert ledger.view().devices["192.0.2.10"].last_packet_at is None       # never a packet: never a time
    clock.t = T0 + 5
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5), packet_age_ms=200.0),
                             sent_at=clock.t))
    clock.t = T0 + 10                                   # a hub restarted: no packet since, so no age
    post(store, ledger, body(device("192.0.2.10", status="waiting", packet_age_ms=None), sent_at=clock.t))
    assert ledger.view().devices["192.0.2.10"].last_packet_at == T0 + 5 - 0.2


def test_a_channels_last_valid_value_outlives_the_stores_forgetting():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), reading("spo2", 97, "%"))))
    for step in range(1, 30):                           # five-second posts for 145 s: hr goes on, spo2 stops
        clock.t = T0 + 5 * step
        post(store, ledger, body(device("192.0.2.10", reading("hr", 72, captured_at=clock.t - 0.5)),
                                 sent_at=clock.t))
    assert "spo2" not in {p["parameter"] for p in store.devices()["192.0.2.10"].parameters}   # forgotten
    channels = dict(ledger.view().devices["192.0.2.10"].channels)
    assert channels == {"hr": pytest.approx(clock.t - 0.5, abs=1e-3), "spo2": pytest.approx(T0 - 0.5, abs=1e-3)}
    assert clock.t - channels["spo2"] > FORGET_AFTER_S


def test_only_a_value_the_board_showed_moves_a_channels_time():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), reading("spo2", None, "%", valid=False))))
    assert dict(ledger.view().devices["192.0.2.10"].channels) == {"hr": pytest.approx(T0 - 0.5, abs=1e-3)}
    clock.t = T0 + 5                                    # «***» on hr, and a parameter the board does not know
    post(store, ledger, body(device("192.0.2.10", reading("hr", None, valid=False, captured_at=clock.t - 0.5),
                                    reading("bogus", 1, "x", captured_at=clock.t - 0.5)), sent_at=clock.t))
    clock.t = T0 + 10                                   # a value outside the record's bounds: refused, counted
    post(store, ledger, body(device("192.0.2.10", reading("hr", 999, captured_at=clock.t - 0.5)), sent_at=clock.t))
    assert dict(ledger.view().devices["192.0.2.10"].channels) == {"hr": pytest.approx(T0 - 0.5, abs=1e-3)}


def test_nbp_is_one_channel_by_the_boards_name_and_last():
    clock, store, ledger = lane()
    triple = [reading(name, value, "mmHg", changed_at=T0 - 600.0) for name, value in zip(NBP_PARTS, (118, 79, 92))]
    post(store, ledger, body(device("192.0.2.10", reading(), *triple)))
    assert [name for name, _ in ledger.view().devices["192.0.2.10"].channels] == ["hr", "nbp"]


def test_a_device_left_out_of_the_latest_body_is_no_longer_reported():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading())))
    clock.t = T0 + 5
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    seen = ledger.view().devices
    assert (seen["192.0.2.10"].reported, seen["192.0.2.11"].reported) == (True, False)
    assert seen["192.0.2.11"].last_report_at == T0


def test_a_device_no_longer_reported_is_kept_24_hours_then_dropped():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading())))
    clock.t = T0 + LEDGER_KEEP_S
    assert set(ledger.view().devices) == {"192.0.2.10", "192.0.2.11"}       # 24 h to the second: kept
    clock.t = T0 + LEDGER_KEEP_S + 1
    assert dict(ledger.view().devices) == {}
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    assert set(ledger.view().devices) == {"192.0.2.10"}
    assert ledger.view().devices["192.0.2.10"].first_seen_at == clock.t      # seen again, first again


def test_the_24_hours_run_on_the_monotonic_clock():
    wall, mono = Clock(T0), Clock(5_000.0)
    _, store, ledger = lane(wall, mono)
    post(store, ledger, body(device("192.0.2.10", reading())))
    wall.t += 2 * LEDGER_KEEP_S                         # a wall clock stepped forward two days
    mono.t += 60
    assert "192.0.2.10" in ledger.view().devices
    mono.t += LEDGER_KEEP_S
    assert "192.0.2.10" not in ledger.view().devices


def test_the_ledger_never_holds_a_device_the_store_has_let_go():
    clock, store, ledger = lane()
    post(store, ledger, body(*[device(f"192.0.2.{i + 1}", reading()) for i in range(MAX_DEVICES)]))
    clock.t = T0 + 5                                    # a 101st source: the store drops one, so does the ledger
    post(store, ledger, body(device("198.51.100.1", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    seen = ledger.view().devices
    assert len(seen) == MAX_DEVICES and "198.51.100.1" in seen
    assert set(seen) <= set(store.devices())


def test_the_ledger_has_no_method_that_could_reach_the_clinical_side():
    public = {name for name in dir(FeedLedger) if not name.startswith("_")}
    assert public == {"observe", "view"}
    assert set(inspect.signature(FeedLedger.observe).parameters) == {"self", "views", "reported"}
    assert set(inspect.signature(FeedLedger.view).parameters) == {"self"}
    assert set(inspect.signature(FeedLedger).parameters) == {"clock", "monotonic"}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infinity_shadow_ledger.py -q -p no:cacheprovider`
Expected: collection ERROR — `ImportError: cannot import name 'FeedLedger' from 'homunculus.api.infinity_shadow'` (or `LEDGER_KEEP_S`).

- [ ] **Step 3: Write the minimal implementation**

`homunculus-engine/src/homunculus/api/infinity_shadow.py` — find (exactly once):

```python
from collections.abc import Callable, Mapping
```

replace with:

```python
from collections.abc import Callable, Iterable, Mapping
```

`homunculus-engine/src/homunculus/api/infinity_shadow.py` — find (exactly once):

```python
REJECTIONS = ("too_old", "clock", "unit", "range", "unknown_parameter", "duplicate")
```

replace with:

```python
REJECTIONS = ("too_old", "clock", "unit", "range", "unknown_parameter", "duplicate")
# G4-01 (spec 2026-11-11 D2, D4): the last-seen ledger's bounds. A device the hub stopped reporting is kept
# this long after its last report. A channel is stale once its last valid value is DISPLAY_MAX_AGE_S old — the
# strip already shows every such gap — and the device page LISTS it once it is this old; the page reads the
# number from the board (`stale_list_after_s`), so it is said here once.
LEDGER_KEEP_S = 24 * 3600.0
STALE_LIST_AFTER_S = 60.0
```

`homunculus-engine/src/homunculus/api/infinity_shadow.py` — find (exactly once):

```python
# --- the board's answer --------------------------------------------------------------------------
```

replace with:

```python
# --- G4-01: the last-seen ledger -----------------------------------------------------------------

CHANNELS = tuple(name for name in PARAMETERS if name not in NBP_PARTS) + (NBP,)   # the board's own, in its order
SHOWN_VALUE = frozenset({"value", "value_untimed"})     # a board entry carrying a valid value (NBP-2's untimed too)


def reported_sources(body: Mapping) -> list[str]:
    """The devices an ACCEPTED body reported, by address. Only after `ShadowStore.ingest` took the
    body: it has been validated whole, so every entry has a unicast `source`."""
    return [unicast_ipv4(item["source"]) for item in body["devices"]]


def _epoch(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


@dataclass
class _Seen:
    first_seen_at: float                      # wall clock
    last_report_at: float                     # wall clock
    last_report_tick: float                   # monotonic: LEDGER_KEEP_S is measured on it
    last_packet_at: float | None = None       # wall clock: the report's time less the hub's packet age
    channels: dict[str, float] = field(default_factory=dict)   # channel -> when it last carried a valid value


@dataclass(frozen=True)
class SeenView:
    """One device as the ledger holds it. Wall-clock epochs; `channels` in the board's order (CHANNELS)."""
    first_seen_at: float
    last_report_at: float
    last_packet_at: float | None
    channels: tuple[tuple[str, float], ...]
    reported: bool                            # listed in the latest accepted body


@dataclass(frozen=True)
class LedgerView:
    started_at: float                         # the board's `watching_since`: when this API began watching
    devices: Mapping[str, SeenView]


class FeedLedger:
    """G4-01 (spec 2026-11-11 D2): when the lane last saw each monitor and each of its channels.

    Memory only, beside `ShadowStore` and fed from it: after each accepted body the POST route hands
    `observe` what the store now shows (`ShadowStore.devices()`) and the addresses the body listed
    (`reported_sources`). So it remembers only what the board showed: a device's last report, its
    last packet (the report's time less the hub's `packet_age_ms`; a report with no age — a device
    the hub has had no packet from — leaves it where it was), and per channel the time of the last
    entry that carried a valid value (`value`, or NBP's `value_untimed`), kept after the store forgets
    the reading at FORGET_AFTER_S. Bounds: a device is dropped LEDGER_KEEP_S after its last report,
    and with the store when the store lets it go, so it never holds more than MAX_DEVICES; only the
    board's own channels (CHANNELS).

    The store, its readings and everything the shadow engine reads are untouched; nothing here is
    written anywhere. A restart empties it, and `started_at` says since when it has watched. Two
    clocks, as the store's: the wall clock for the times the board prints, the monotonic one for how
    long ago a device was last reported. A test that injects only the wall clock gets it for both."""

    def __init__(self, clock: Callable[[], float] = time.time, monotonic: Callable[[], float] | None = None):
        self._clock = clock
        self._monotonic = monotonic or (time.monotonic if clock is time.time else clock)
        self._started_at = clock()
        self._seen: dict[str, _Seen] = {}
        self._reported: frozenset[str] = frozenset()

    def observe(self, views: Mapping[str, DeviceView], reported: Iterable[str]) -> None:
        """Note one accepted body: `views` the store's devices right after it, `reported` its addresses."""
        now, tick = self._clock(), self._monotonic()
        for source in [s for s in self._seen if s not in views]:
            del self._seen[source]                    # the store let it go (MAX_DEVICES): so does the ledger
        listed = frozenset(source for source in reported if source in views)
        for source in listed:
            view = views[source]
            held = self._seen.get(source)
            if held is None:
                held = self._seen[source] = _Seen(now, now, tick)
            held.last_report_at, held.last_report_tick = now, tick
            if view.packet_age_ms is not None:
                held.last_packet_at = now - view.packet_age_ms / 1000.0
            for entry in view.parameters:
                name = entry.get("parameter")
                if name in CHANNELS and entry.get("state") in SHOWN_VALUE and entry.get("last_at"):
                    at = _epoch(entry["last_at"])
                    if at > held.channels.get(name, float("-inf")):
                        held.channels[name] = at
        self._reported = listed
        self._prune(tick)

    def view(self) -> LedgerView:
        """What the ledger holds now, once what is past LEDGER_KEEP_S is dropped."""
        self._prune(self._monotonic())
        return LedgerView(self._started_at, {
            source: SeenView(held.first_seen_at, held.last_report_at, held.last_packet_at,
                             tuple((name, held.channels[name]) for name in CHANNELS if name in held.channels),
                             source in self._reported)
            for source, held in self._seen.items()})

    def _prune(self, tick: float) -> None:
        for source in [s for s, held in self._seen.items() if tick - held.last_report_tick > LEDGER_KEEP_S]:
            del self._seen[source]
        while len(self._seen) > MAX_DEVICES:
            del self._seen[min(self._seen, key=lambda s: self._seen[s].last_report_tick)]


# --- the board's answer --------------------------------------------------------------------------
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infinity_shadow_ledger.py tests/test_infinity_shadow_store.py tests/test_infinity_shadow_isolation.py -q -p no:cacheprovider`
Expected: all pass (13 new tests; the store's and the isolation's as before — the store's surface test still says `{"ingest", "devices", "feed"}`).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add homunculus-engine/src/homunculus/api/infinity_shadow.py homunculus-engine/tests/test_infinity_shadow_ledger.py
git commit -m "feat(shadow): G4-01 the last-seen ledger — FeedLedger beside ShadowStore, memory only: first and last report, the last packet less its age, each channel's last valid value kept past the 120 s forgetting; 24 h after the last report, never more than the store holds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/infinity_shadow.py homunculus-engine/tests/test_infinity_shadow_ledger.py
```

## Task 2 (engine): `board_view` carries the ledger, additively

**Files:**
- Modify: `homunculus-engine/tests/test_infinity_shadow_ledger.py` (imports; tests appended)
- Modify: `homunculus-engine/src/homunculus/api/infinity_shadow.py` (`_address_key` ~line 503 → `_ledger_fields` after it; `board_view` signature, docstring and return ~lines 507–579)

- [ ] **Step 1: Write the failing tests**

`homunculus-engine/tests/test_infinity_shadow_ledger.py` — find (exactly once):

```python
import inspect
from datetime import datetime, timezone

import pytest

from homunculus.api.infinity_shadow import (
    FORGET_AFTER_S, LEDGER_KEEP_S, MAX_DEVICES, NBP_PARTS, SCHEMA, STALE_LIST_AFTER_S, FeedLedger, ShadowStore,
    reported_sources,
)
```

replace with:

```python
import inspect
import json
from datetime import datetime, timezone

import pytest

from homunculus.api.infinity_device_beds import DeviceBedTable, Row, TableState
from homunculus.api.infinity_shadow import (
    FORGET_AFTER_S, LEDGER_KEEP_S, MAX_DEVICES, NBP_PARTS, SCHEMA, STALE_LIST_AFTER_S, FeedLedger, ShadowStore,
    board_view, reported_sources,
)
```

Append to the end of `homunculus-engine/tests/test_infinity_shadow_ledger.py`:

```python


# --- the board (Task 2) --------------------------------------------------------------------------

START = datetime(2026, 7, 1, tzinfo=timezone.utc)
OLD_TOP = {"stage", "display_max_age_s", "generated_at", "table", "feed", "beds", "unassigned"}
OLD_BED = {"bed_label", "bed_id", "unit_id", "method", "verified_at", "source", "group", "status", "status_age_s",
           "packet_age_ms", "parameters", "link", "patient_id", "link_reason"}
OLD_STRAY = {"source", "group", "status", "status_age_s", "packet_age_ms", "parameters", "reason", "note"}
VANISHED_KEYS = {"source", "bed_label", "last_packet_at", "last_report_at"}


def _table():
    """B-1 (unit-1) and B-2 (unit-2) on beds; .12 in the table, its bed unresolved."""
    rows = tuple(Row(source, f"239.20.1.{source.rsplit('.', 1)[1]}", 2050, label, bed_id, unit_id, "monitor_screen",
                     "2026-07-14", START, None, "")
                 for source, label, bed_id, unit_id in (("192.0.2.10", "B-1", "bed-b1", "unit-1"),
                                                        ("192.0.2.11", "B-2", "bed-b2", "unit-2"),
                                                        ("192.0.2.12", None, None, None)))
    return TableState(DeviceBedTable(1, "synthetic", "test", "2026-07-14", rows), "ok", None, "0" * 64, 1)


def _board(store, ledger, clock, *, visible=lambda card: True, show_unassigned=True, with_ledger=True, occupants=None):
    extra = {"ledger": ledger.view()} if with_ledger else {}
    return board_view(store.devices(clock.t), store.feed(clock.t), _table(), occupants=occupants, visible=visible,
                      patient_visible=lambda card: True, show_unassigned=show_unassigned, now=clock.t, **extra)


def test_without_a_ledger_the_board_is_exactly_what_it_was():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.12", reading())))
    out = _board(store, ledger, clock, with_ledger=False)
    assert set(out) == OLD_TOP
    assert set(out["beds"][0]) == OLD_BED and set(out["unassigned"][0]) == OLD_STRAY


def test_with_the_ledger_every_card_and_the_body_carry_it():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), packet_age_ms=500.0),
                             device("192.0.2.12", reading("spo2", 97, "%"))))
    clock.t = T0 + 2
    out = _board(store, ledger, clock)
    assert set(out) == OLD_TOP | {"watching_since", "stale_list_after_s", "vanished"}
    assert (out["watching_since"], out["stale_list_after_s"], out["vanished"]) == (_iso(T0), 60.0, [])
    bed, stray = out["beds"][0], out["unassigned"][0]
    assert set(bed) == OLD_BED | {"last_packet_at", "silent_for_s", "channels_seen"}
    assert set(stray) == OLD_STRAY | {"last_packet_at", "silent_for_s", "channels_seen"}
    assert (bed["last_packet_at"], bed["silent_for_s"]) == (_iso(T0 - 0.5), None)          # streaming: no silence
    assert bed["channels_seen"] == [{"parameter": "hr", "last_value_at": _iso(T0 - 0.5)}]
    assert stray["channels_seen"] == [{"parameter": "spo2", "last_value_at": _iso(T0 - 0.5)}]


def test_channels_seen_keeps_a_channel_the_store_has_forgotten():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), reading("spo2", 97, "%"))))
    for step in range(1, 27):                           # to T0 + 130: spo2's reading is past FORGET_AFTER_S
        clock.t = T0 + 5 * step
        post(store, ledger, body(device("192.0.2.10", reading("hr", 72, captured_at=clock.t - 0.5)),
                                 sent_at=clock.t))
    card = _board(store, ledger, clock)["beds"][0]
    assert "spo2" not in {p["parameter"] for p in card["parameters"]}
    assert [ch["parameter"] for ch in card["channels_seen"]] == ["hr", "spo2"]
    assert card["channels_seen"][1]["last_value_at"] == _iso(T0 - 0.5)


def test_silent_for_is_whole_seconds_since_the_last_packet_for_a_silent_or_unknown_monitor_only():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", status="stale", packet_age_ms=7_000.0),
                             device("192.0.2.11", reading())))
    clock.t = T0 + 0.9
    beds = {c["source"]: c for c in _board(store, ledger, clock)["beds"]}
    assert (beds["192.0.2.10"]["status"], beds["192.0.2.10"]["silent_for_s"]) == ("silent", 7)
    assert beds["192.0.2.11"]["silent_for_s"] is None
    clock.t = T0 + 30                                   # no post since T0: both unknown
    beds = {c["source"]: c for c in _board(store, ledger, clock)["beds"]}
    assert [(c["status"], c["silent_for_s"]) for c in beds.values()] == [("unknown", 37), ("unknown", 30)]


def test_a_monitor_left_out_of_the_bodies_is_vanished_once_unknown_and_the_forwarders_silence_is_not():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading()),
                             device("192.0.2.12", reading())))
    clock.t = T0 + 10
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    assert _board(store, ledger, clock)["vanished"] == []                   # 10 s: not unknown yet
    clock.t = T0 + 16
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    assert _board(store, ledger, clock)["vanished"] == [
        {"source": "192.0.2.11", "bed_label": "B-2", "last_packet_at": _iso(T0 - 0.1), "last_report_at": _iso(T0)},
        {"source": "192.0.2.12", "bed_label": None, "last_packet_at": _iso(T0 - 0.1), "last_report_at": _iso(T0)},
    ]
    clock.t = T0 + 40                                   # the posts stop: .10 is unknown too, but the last body listed it
    assert [v["source"] for v in _board(store, ledger, clock)["vanished"]] == ["192.0.2.11", "192.0.2.12"]


def test_vanished_reaches_only_what_the_cards_reach():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading()),
                             device("192.0.2.12", reading())))
    clock.t = T0 + 16
    post(store, ledger, body(sent_at=clock.t))         # the hub lists none of them any more
    scoped = _board(store, ledger, clock, visible=lambda card: card["unit_id"] == "unit-1", show_unassigned=False)
    assert [c["source"] for c in scoped["beds"]] == ["192.0.2.10"] and scoped["unassigned"] == []
    assert [v["source"] for v in scoped["vanished"]] == ["192.0.2.10"]
    assert [v["source"] for v in _board(store, ledger, clock)["vanished"]] == ["192.0.2.10", "192.0.2.11", "192.0.2.12"]


def test_the_new_fields_name_no_patient():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading())))
    clock.t = T0 + 16
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    out = _board(store, ledger, clock, occupants={"bed-b1": ["synth-p1"], "bed-b2": ["synth-p2"]})
    assert [set(v) for v in out["vanished"]] == [VANISHED_KEYS]
    assert "synth-p2" not in json.dumps(out["vanished"])
    for card in out["beds"]:
        assert all(set(ch) == {"parameter", "last_value_at"} for ch in card["channels_seen"])
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infinity_shadow_ledger.py -q -p no:cacheprovider`
Expected: the Task 1 tests pass; `test_without_a_ledger_the_board_is_exactly_what_it_was` passes; the other six FAIL with `TypeError: board_view() got an unexpected keyword argument 'ledger'`.

- [ ] **Step 3: Write the minimal implementation**

`homunculus-engine/src/homunculus/api/infinity_shadow.py` — find (exactly once):

```python
def _address_key(source: str) -> tuple[int, ...]:
    return tuple(int(part) for part in source.split("."))
```

replace with:

```python
def _address_key(source: str) -> tuple[int, ...]:
    return tuple(int(part) for part in source.split("."))


QUIET_STATUSES = ("silent", "unknown")


def _ledger_fields(shown: list[dict], ledger: LedgerView, now: float) -> dict:
    """G4-01 (D3): the ledger on the cards this caller is shown, and the body's three new fields.

    `vanished` is cut from those same cards, so it reaches exactly what they reach: a bed card only
    through the approved table's row valid now and the caller's scope (`visible`), an unassigned one
    only with `show_unassigned`. A vanished monitor is in the ledger, absent from the latest accepted
    body, and unreported long enough to be `unknown` — the store keeps its card, so it is that card
    worded differently. An `unknown` monitor the latest body still listed is the forwarder's silence,
    not its own. `silent_for_s` counts from `last_packet_at` on the board's own clock. Nothing here
    names a patient."""
    vanished = []
    for card in shown:
        seen = ledger.devices.get(card["source"])
        last = None if seen is None else seen.last_packet_at
        card["last_packet_at"] = None if last is None else _iso(last)
        card["silent_for_s"] = (int(max(0.0, now - last))
                                if last is not None and card["status"] in QUIET_STATUSES else None)
        card["channels_seen"] = ([] if seen is None else
                                 [{"parameter": name, "last_value_at": _iso(at)} for name, at in seen.channels])
        if seen is not None and not seen.reported and card["status"] == "unknown":
            vanished.append({"source": card["source"], "bed_label": card.get("bed_label"),
                             "last_packet_at": card["last_packet_at"], "last_report_at": _iso(seen.last_report_at)})
    return {"watching_since": _iso(ledger.started_at), "stale_list_after_s": STALE_LIST_AFTER_S,
            "vanished": vanished}
```

`homunculus-engine/src/homunculus/api/infinity_shadow.py` — find (exactly once):

```python
               show_unassigned: bool, now: float) -> dict:
```

replace with:

```python
               show_unassigned: bool, now: float, ledger: LedgerView | None = None) -> dict:
```

`homunculus-engine/src/homunculus/api/infinity_shadow.py` — find (exactly once):

```python
    - `visible(card)` decides each bed card (scope). Counts cover only what is shown.
```

replace with:

```python
    - `visible(card)` decides each bed card (scope). Counts cover only what is shown.
    - `ledger` (G4-01) is `FeedLedger.view()`, or None — the shadow engine's pass. With it every shown
      card carries `last_packet_at`, `silent_for_s` and `channels_seen`, and the body
      `watching_since`, `stale_list_after_s` and `vanished` (`_ledger_fields`); without it the body
      is exactly what it was.
```

`homunculus-engine/src/homunculus/api/infinity_shadow.py` — find (exactly once):

```python
    return {"stage": "shadow", "display_max_age_s": DISPLAY_MAX_AGE_S, "generated_at": _iso(now),
            "table": {"status": table.status, "reason": table.reason, "version": table.version,
                      "sha256": table.sha256, "approved_at": approved_at, "site": site},
            "feed": {**feed, "devices": counts, "unassigned": len(unassigned)},
            "beds": beds, "unassigned": unassigned}
```

replace with:

```python
    body = {"stage": "shadow", "display_max_age_s": DISPLAY_MAX_AGE_S, "generated_at": _iso(now),
            "table": {"status": table.status, "reason": table.reason, "version": table.version,
                      "sha256": table.sha256, "approved_at": approved_at, "site": site},
            "feed": {**feed, "devices": counts, "unassigned": len(unassigned)},
            "beds": beds, "unassigned": unassigned}
    if ledger is not None:
        body.update(_ledger_fields(shown, ledger, now))
    return body
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infinity_shadow_ledger.py tests/test_infinity_shadow_store.py tests/test_infinity_rules.py -q -p no:cacheprovider`
Expected: all pass (20 in the ledger file).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add homunculus-engine/src/homunculus/api/infinity_shadow.py homunculus-engine/tests/test_infinity_shadow_ledger.py
git commit -m "feat(shadow): G4-01 board_view carries the ledger, additively — watching_since, stale_list_after_s, vanished, and on each shown card last_packet_at, silent_for_s, channels_seen; vanished cut from the shown cards, so scoped as they are; without a ledger the body is unchanged" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/infinity_shadow.py homunculus-engine/tests/test_infinity_shadow_ledger.py
```

## Task 3 (engine): the routes feed and read the ledger

**Files:**
- Create: `homunculus-engine/tests/test_infinity_shadow_ledger_api.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (import ~58–61; store creation ~425; `app.state` ~875; POST ~1869–1877; before `_sample_and_publish` ~1879; GET ~1949–1956)

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_infinity_shadow_ledger_api.py` with:

```python
"""G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D2–D3): the last-seen ledger through the two routes.

POST /infinity-shadow/readings notes what the store holds after each accepted body; GET
/infinity-shadow/board carries it, additively — `watching_since`, `stale_list_after_s`, `vanished`
and, on each card, `last_packet_at`, `silent_for_s`, `channels_seen` — scoped as the cards are. A
ledger that fails never refuses a body. Synthetic addresses and ids only.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.infinity_shadow import LEDGER_KEEP_S, SCHEMA, ShadowSettings
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.scope import Scope, ScopeReason
from homunculus.tenant.bedmap import BedMap, BedRef

HOSPITAL, DEVICE, SHADOW = "HOSP1", "tok-device-00000000000000000000000000", "s" * 40
T0 = 1_800_000_000.0
WHEN = datetime(2027, 1, 15, 7, 0, tzinfo=timezone.utc)
TABLE = {
    "schema": "homunculus.infinity-device-beds.v1", "version": 3, "site": "synthetic",
    "approved_by": "test", "approved_at": "2026-07-14",
    "devices": [
        {"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "bed_label": "B-1",
         "bed_id": "bed-b1", "unit_id": "unit-1", "method": "monitor_screen", "verified_at": "2026-07-14",
         "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""},
        {"source": "192.0.2.11", "group": "239.20.1.11", "port": 2050, "bed_label": "B-2",
         "bed_id": "bed-b2", "unit_id": "unit-2", "method": "central_station_list",
         "verified_at": "2026-07-14", "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""},
    ],
}
CALLERS = {
    "nurse-jwt": Caller(hospital=HOSPITAL, actor="synth-n1", groups=("nurse",), perms=frozenset({"board.view"})),
    "scoped-jwt": Caller(hospital=HOSPITAL, actor="synth-n2", groups=("nurse",), perms=frozenset({"board.view"})),
    "biomed-jwt": Caller(hospital=HOSPITAL, actor="synth-b1", groups=("biomedical",),
                         perms=frozenset({"devices.manage"})),
}
SCOPES = {"scoped-jwt": Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"unit-1"}))}
EVERYONE = ("192.0.2.10", "192.0.2.11", "192.0.2.13")          # .13: not in the table
NEW_CARD = {"last_packet_at", "silent_for_s", "channels_seen"}
NEW_TOP = {"watching_since", "stale_list_after_s", "vanished"}
VANISHED_KEYS = {"source", "bed_label", "last_packet_at", "last_report_at"}


async def _resolve_jwt(token):
    return CALLERS.get(token)


async def _resolve_scope(token):
    return SCOPES.get(token, Scope(True, ScopeReason.UNASSIGNED))


class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t


def _iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def _app(tmp_path, *, identities=None):
    path = tmp_path / "device-beds.json"
    path.write_text(json.dumps(TABLE), encoding="utf-8")
    clock = Clock()
    app = create_app({DEVICE: HOSPITAL}, run_escalation_loop=False, resolve_jwt=_resolve_jwt,
                     resolve_scope=_resolve_scope,
                     shadow=ShadowSettings("shadow", "shadow", None, SHADOW, HOSPITAL, str(path)),
                     shadow_clock=clock, bedmap=BedMap({"YB^1^1": BedRef("bed-b1", "unit-1", "B-1")}),
                     identities=identities if identities is not None else InMemoryIdentityStore())
    return TestClient(app), clock


def _device(source, *, now=T0, status="streaming", packet_age_ms=120.0, hr=True):
    readings = ([{"parameter": "hr", "value": 72, "unit": "bpm", "valid": True, "captured_at": now - 0.4}]
                if hr else [])
    return {"source": source, "group": "239.20.1." + source.rsplit(".", 1)[1], "port": 2050, "status": status,
            "packet_age_ms": packet_age_ms, "readings": readings}


def _post(client, clock, *devices):
    body = {"schema": SCHEMA, "sent_at": clock.t,
            "forwarder": {"interval_s": 5, "sent": 3, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 10, "old_or_duplicate_packets": 0},
            "devices": list(devices)}
    response = client.post("/infinity-shadow/readings", json=body, headers={"Authorization": f"Bearer {SHADOW}"})
    assert response.status_code == 200, response.text
    return response.json()


def _board(client, token="biomed-jwt"):
    response = client.get("/infinity-shadow/board", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    return response.json()


def _cards(board):
    return {card["source"]: card for card in board["beds"] + board["unassigned"]}


def _ward(client, clock, gone=()):
    """The three monitors at T0, then a post every 5 s to T0 + 20 without the ones in `gone`: past
    SILENT_AFTER_S, so those are `unknown`, and the hub no longer lists them."""
    _post(client, clock, *(_device(source) for source in EVERYONE))
    for step in (5, 10, 15, 20):
        clock.t = T0 + step
        _post(client, clock, *(_device(source, now=clock.t) for source in EVERYONE if source not in gone))


def test_the_board_keeps_every_field_it_had_and_adds_the_ledgers(tmp_path):
    client, clock = _app(tmp_path)
    _post(client, clock, _device("192.0.2.10"), _device("192.0.2.13"))
    clock.t = T0 + 2
    board = _board(client)
    assert set(board) == {"stage", "display_max_age_s", "generated_at", "table", "feed", "beds", "unassigned"} | NEW_TOP
    assert (board["watching_since"], board["stale_list_after_s"], board["vanished"]) == (_iso(T0), 60.0, [])
    one = _cards(board)["192.0.2.10"]
    assert (one["last_packet_at"], one["silent_for_s"]) == (_iso(T0 - 0.12), None)
    assert one["channels_seen"] == [{"parameter": "hr", "last_value_at": _iso(T0 - 0.4)}]
    assert NEW_CARD <= set(_cards(board)["192.0.2.13"])                     # an unassigned card too


def test_silent_for_counts_whole_seconds_from_the_last_packet_for_a_silent_or_unknown_monitor_only(tmp_path):
    client, clock = _app(tmp_path)
    _post(client, clock, _device("192.0.2.10", status="stale", packet_age_ms=42_000.0, hr=False),
          _device("192.0.2.11"))
    clock.t = T0 + 3.5
    cards = _cards(_board(client))
    assert (cards["192.0.2.10"]["status"], cards["192.0.2.10"]["silent_for_s"]) == ("silent", 45)
    assert cards["192.0.2.10"]["last_packet_at"] == _iso(T0 - 42.0)
    assert cards["192.0.2.11"]["silent_for_s"] is None
    clock.t = T0 + 20                                   # no post since T0: both unknown
    board = _board(client)
    cards = _cards(board)
    assert (cards["192.0.2.10"]["status"], cards["192.0.2.10"]["silent_for_s"]) == ("unknown", 62)
    assert (cards["192.0.2.11"]["status"], cards["192.0.2.11"]["silent_for_s"]) == ("unknown", 20)
    assert board["vanished"] == []                      # the forwarder's silence, not the monitors' own


def test_a_monitor_the_hub_stops_listing_is_vanished_for_24_hours_then_dropped(tmp_path):
    client, clock = _app(tmp_path)
    _ward(client, clock, gone=("192.0.2.11",))
    board = _board(client)
    assert board["vanished"] == [{"source": "192.0.2.11", "bed_label": "B-2",
                                  "last_packet_at": _iso(T0 - 0.12), "last_report_at": _iso(T0)}]
    gone = _cards(board)["192.0.2.11"]
    assert (gone["status"], gone["silent_for_s"]) == ("unknown", 20)        # still a card: the store keeps it
    clock.t = T0 + LEDGER_KEEP_S
    assert [v["source"] for v in _board(client)["vanished"]] == ["192.0.2.11"]  # 24 h to the second: kept
    clock.t = T0 + LEDGER_KEEP_S + 1
    board = _board(client)
    assert board["vanished"] == []
    gone = _cards(board)["192.0.2.11"]
    assert (gone["status"], gone["last_packet_at"], gone["silent_for_s"], gone["channels_seen"]) == (
        "unknown", None, None, [])


def test_a_scoped_viewer_gets_only_its_beds_devices_and_vanished_rows(tmp_path):
    client, clock = _app(tmp_path)
    _ward(client, clock, gone=EVERYONE)
    scoped = _board(client, "scoped-jwt")               # unit-1: B-1 only, and no unassigned device
    assert [c["source"] for c in scoped["beds"]] == ["192.0.2.10"] and scoped["unassigned"] == []
    assert [v["source"] for v in scoped["vanished"]] == ["192.0.2.10"]
    everyone = _board(client, "biomed-jwt")
    assert [(v["source"], v["bed_label"]) for v in everyone["vanished"]] == [
        ("192.0.2.10", "B-1"), ("192.0.2.11", "B-2"), ("192.0.2.13", None)]


def test_devices_manage_sees_every_device_and_the_new_fields_name_no_patient(tmp_path):
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="synth-p1", unit="YB", room="1", bed="1",
                                              state="admitted", source="test", updated_at=WHEN))
    client, clock = _app(tmp_path, identities=identities)
    _ward(client, clock, gone=("192.0.2.10",))
    board = _board(client, "biomed-jwt")
    assert "synth-p1" not in json.dumps(board)
    assert [set(v) for v in board["vanished"]] == [VANISHED_KEYS]
    for card in _cards(board).values():
        assert NEW_CARD <= set(card)
        assert all(set(ch) == {"parameter", "last_value_at"} for ch in card["channels_seen"])
    nurse = _board(client, "nurse-jwt")                 # board.view: the card's own link, as before
    assert _cards(nurse)["192.0.2.10"]["patient_id"] == "synth-p1"
    assert [set(v) for v in nurse["vanished"]] == [VANISHED_KEYS]


def test_a_ledger_that_fails_never_refuses_an_accepted_body(tmp_path, monkeypatch, caplog):
    client, clock = _app(tmp_path)

    def boom(views, reported):
        raise RuntimeError("synthetic ledger failure")

    monkeypatch.setattr(client.app.state.shadow_ledger, "observe", boom)
    assert _post(client, clock, _device("192.0.2.10"))["accepted"] == 1
    assert _cards(_board(client))["192.0.2.10"]["status"] == "streaming"
    assert "ledger" in caplog.text
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infinity_shadow_ledger_api.py -q -p no:cacheprovider`
Expected: 6 FAIL — `assert {...} == {...} | NEW_TOP` (the board has no new field), `KeyError: 'silent_for_s'` / `'vanished'`, and `AttributeError: 'State' object has no attribute 'shadow_ledger'`.

- [ ] **Step 3: Write the minimal implementation**

`homunculus-engine/src/homunculus/api/app.py` — find (exactly once):

```python
from homunculus.api.infinity_shadow import (
    MAX_BODY as SHADOW_MAX_BODY, MIN_TOKEN as SHADOW_MIN_TOKEN, ShadowRejected, ShadowSettings, ShadowStore,
    TooSoon, board_view,
)
```

replace with:

```python
from homunculus.api.infinity_shadow import (
    MAX_BODY as SHADOW_MAX_BODY, MIN_TOKEN as SHADOW_MIN_TOKEN, FeedLedger, ShadowRejected, ShadowSettings,
    ShadowStore, TooSoon, board_view, reported_sources,
)
```

`homunculus-engine/src/homunculus/api/app.py` — find (exactly once):

```python
    shadow_store = ShadowStore(clock=shadow_clock, monotonic=shadow_monotonic)
```

replace with:

```python
    shadow_store = ShadowStore(clock=shadow_clock, monotonic=shadow_monotonic)
    # G4-01 (spec 2026-11-11 D2): when the lane last saw each monitor and channel — memory only, beside the
    # store and fed from what it shows; it changes nothing the store keeps or the shadow engine reads.
    shadow_ledger = FeedLedger(clock=shadow_clock, monotonic=shadow_monotonic)
```

`homunculus-engine/src/homunculus/api/app.py` — find (exactly once):

```python
    app.state.shadow_store = shadow_store
```

replace with:

```python
    app.state.shadow_store = shadow_store
    app.state.shadow_ledger = shadow_ledger         # G4-01
```

`homunculus-engine/src/homunculus/api/app.py` — find (exactly once):

```python
        try:
            result = shadow_store.ingest(json.loads(raw))
        except TooSoon:
            raise HTTPException(status_code=429, detail={"reason": "too_soon"}) from None
        except (ShadowRejected, ValueError, RecursionError):
            raise HTTPException(status_code=400, detail={"reason": "rejected"}) from None
        if shadow.rules:
            await _sample_and_publish()
```

replace with:

```python
        try:
            parsed = json.loads(raw)
            result = shadow_store.ingest(parsed)
        except TooSoon:
            raise HTTPException(status_code=429, detail={"reason": "too_soon"}) from None
        except (ShadowRejected, ValueError, RecursionError):
            raise HTTPException(status_code=400, detail={"reason": "rejected"}) from None
        _note_seen(parsed)
        if shadow.rules:
            await _sample_and_publish()
```

`homunculus-engine/src/homunculus/api/app.py` — find (exactly once):

```python
    async def _sample_and_publish() -> None:
```

replace with:

```python
    def _note_seen(body: dict) -> None:
        """G4-01 (D2): the ledger notes what the store now shows for the devices this accepted body
        listed. Display memory only: a failure here is logged and never refuses the body, which the
        store has already taken."""
        try:
            shadow_ledger.observe(shadow_store.devices(), reported_sources(body))
        except Exception:                      # noqa: BLE001 — the body is accepted; the page only loses a time
            log.exception("G4-01: the device ledger could not note a shadow body")

    async def _sample_and_publish() -> None:
```

`homunculus-engine/src/homunculus/api/app.py` — find (exactly once):

```python
            show_unassigned=scope.unrestricted or manager, now=now)
```

replace with:

```python
            show_unassigned=scope.unrestricted or manager, now=now,
            # G4-01 (D3): the last-seen ledger, on the cards this caller is shown and nowhere else.
            ledger=shadow_ledger.view())
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infinity_shadow_ledger_api.py tests/test_infinity_shadow_api.py tests/test_infinity_shadow_isolation.py -q -p no:cacheprovider`
Expected: all pass (6 new; the existing API and isolation tests as before).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_infinity_shadow_ledger_api.py
git commit -m "feat(api): G4-01 the shadow routes feed and read the ledger — POST notes each accepted body (a ledger failure is logged, never refuses it), GET hands it to board_view, scoped as the cards are; no new route, no permission change" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_infinity_shadow_ledger_api.py
```

## Task 4 (engine): the existing tests stay unchanged and green

**Files:** none (verification). Nothing to commit unless a test fails — then fix the **new** code, never an existing test, and report.

- [ ] **Step 1: No existing engine test was edited**

Run: `cd /c/tmp/g4-cihaz && git diff --stat 97743c3d -- homunculus-engine/tests`
Expected: only `homunculus-engine/tests/test_infinity_shadow_ledger.py` and `homunculus-engine/tests/test_infinity_shadow_ledger_api.py`, both new.

- [ ] **Step 2: The shadow lane's suites (readings and the shadow engine's input unchanged)**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infinity_shadow_api.py tests/test_infinity_shadow_check.py tests/test_infinity_shadow_config.py tests/test_infinity_shadow_equivalence.py tests/test_infinity_shadow_forwarder.py tests/test_infinity_shadow_isolation.py tests/test_infinity_shadow_store.py tests/test_infinity_rules.py tests/test_api_shadow_findings.py tests/test_api_board_shadow.py -q -p no:cacheprovider`
Expected: all pass (DB-backed cases skip).

- [ ] **Step 3: Device-beds and waves, which read the store and the board**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_device_beds_api.py tests/test_device_beds_concurrency.py tests/test_device_beds_import.py tests/test_device_beds_occupied.py tests/test_device_beds_parity.py tests/test_device_beds_postgres.py tests/test_device_beds_structure.py tests/test_device_beds_wiring.py tests/test_infinity_device_beds.py tests/test_infinity_device_beds_contract.py tests/test_infinity_waves_api.py -q -p no:cacheprovider`
Expected: all pass or skip.

- [ ] **Step 4: The route tables are unchanged (no new route, no permission change)**

Run: `cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_route_inventory.py tests/test_route_permissions.py tests/test_board_permissions.py tests/test_nginx_routes.py tests/test_tenant_isolation.py -q -p no:cacheprovider`
Expected: all pass or skip.

- [ ] **Step 5: Report** the engine lane done to the controller, with the three commits' shas and the counts of Steps 2–4.

---

# Dashboard lane

## Task 5 (dashboard): the `cihaz` strings

**Files:**
- Create: `dashboard/src/live/i18n/cihaz.strings.test.js`
- Create: `dashboard/src/live/i18n/strings/cihaz.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (import ~line 81; `NAMESPACES` ~line 133)
- Modify: `dashboard/src/live/i18n/strings.test.js` (`AZ_SAME_AS_TR`, ~line 191)

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/i18n/cihaz.strings.test.js` with:

```js
// G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D5): the device page's words (strings/cihaz.js) — the spec's own
// Turkish, one duration phrase for every sentence that has one, and the words that must not collide with the
// strip's below them (DevicesScreen.test.jsx finds those by text) or with the az word for an alarm.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));

describe("the device page's words (cihaz)", () => {
  it("says the spec's Turkish", () => {
    const tr = DICTIONARIES.tr;
    const forOf = (n) => (n === 0 ? tr["cihaz.forUnderMinute"] : fill(tr["cihaz.forMinutes"], { n }));
    expect(tr["cihaz.title"]).toBe("Cihaz & Veri Akışı");
    expect([tr["cihaz.verdictTitle"], tr["cihaz.silentTitle"], tr["cihaz.staleTitle"], tr["cihaz.chainTitle"], tr["cihaz.neverTitle"]])
      .toEqual(["Veri geliyor mu?", "Sessiz monitörler", "Eskiyen kanallar", "Veri zinciri", "Tabloda var, hiç görülmedi"]);
    expect(fill(tr["cihaz.verdictForwarder"], { for: forOf(4) })).toBe("Veri gelmiyor: aktarıcı 4 dk'dır sessiz");
    expect(tr["cihaz.verdictCollector"]).toBe("Veri gelmiyor: toplayıcı bağlı değil");
    expect(tr["cihaz.verdictNever"]).toBe("Henüz hiç veri gelmedi");
    expect(fill(tr["cihaz.verdictFlowing"], { streaming: 3, total: 5 })).toBe("Veri akıyor · 3/5 monitör veri gönderiyor");
    expect(fill(tr["cihaz.watchingSince"], { time: "10:42" })).toBe("İzleme 10:42'den beri; sistem yeniden başlayınca sıfırlanır");
    expect(fill(tr["cihaz.silentFor"], { for: forOf(4), time: "10:42" })).toBe("4 dk'dır veri yok · son veri 10:42");
    expect(fill(tr["cihaz.silentFor"], { for: forOf(0), time: "10:42" })).toBe("<1 dk'dır veri yok · son veri 10:42");
    expect(tr["cihaz.vanished"]).toBe("hub artık bildirmiyor");
    expect([tr["cihaz.silentNone"], tr["cihaz.staleNone"]]).toEqual(["Sessiz monitör yok", "Eskiyen kanal yok"]);
    expect(fill(tr["cihaz.staleChannel"], { channel: "SpO₂", for: forOf(4) })).toBe("SpO₂ · 4 dk'dır değer yok");
    expect(fill(tr["cihaz.notFresh"], { time: "10:42" })).toBe("Pano güncel değil · 10:42");
  });

  it("carries a duration as one phrase, in every language", () => {
    for (const lang of LANG_CODES) {
      const d = DICTIONARIES[lang];
      for (const key of ["cihaz.verdictForwarder", "cihaz.silentFor", "cihaz.staleChannel"]) expect(d[key], `${lang} ${key}`).toContain("{for}");
      expect(d["cihaz.forMinutes"], lang).toContain("{n}");
      expect(d["cihaz.forUnderMinute"], lang).toMatch(/^<1 /);
    }
  });

  it("leaves the strip's own words to the strip, and never calls the az heartbeat «siqnal»", () => {
    const az = DICTIONARIES.az;
    expect(az["cihaz.verdictFlowing"]).not.toMatch(/məlumat göndərir/);      // the strip's chip (DevicesScreen.test.jsx)
    expect(az["cihaz.chainRejected"]).not.toMatch(/rədd edilən oxunuş/i);    // the strip's monitor.feedRejected
    expect(az["cihaz.chainForwarder"]).not.toMatch(/Alınan göndəriş/);       // the strip's monitor.feedPosts
    for (const key of ["cihaz.chainCollector", "cihaz.chainCollectorNone"]) expect(az[key]).not.toMatch(/siqnal/i);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/i18n/cihaz.strings.test.js`
Expected: FAIL — `expected undefined to be 'Cihaz & Veri Akışı'` (and `Cannot read properties of undefined (reading 'replace')`).

- [ ] **Step 3: Write the minimal implementation**

Create `dashboard/src/live/i18n/strings/cihaz.js` with:

```js
// src/live/i18n/strings/cihaz.js — G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D5): the device page's first
// answer, «veri geliyor mu?» — the verdict and its counts, the silent monitors, the stale channels, the data
// chain and the table's rows never seen (screens/devices/FeedSections.jsx).
//
// The Turkish is the spec's own. `{for}` is one duration phrase (`forMinutes`, `forUnderMinute`: whole minutes,
// «<1 dk» under one), so each language puts it where its grammar wants it. The az collector's heartbeat is «əlaqə»,
// never «siqnal», the az UI's word for an alarm (nav.alarms). The vanished row says «hub», as the spec words it;
// the chain says «Infinity sunucusu», as the strip's own sentences do (monitor.feedForwarder). The chain's refused
// values and the az verdict use words of their own, so the strip's counter lines below stay findable by theirs
// (cihaz.strings.test.js). AZ/RU/EN await a native speaker's review before the pilot.
export default {
  tr: {
    title: "Cihaz & Veri Akışı",
    verdictTitle: "Veri geliyor mu?",
    verdictFlowing: "Veri akıyor · {streaming}/{total} monitör veri gönderiyor",
    verdictForwarder: "Veri gelmiyor: aktarıcı {for} sessiz",
    verdictForwarderNoTime: "Veri gelmiyor: aktarıcı sessiz",
    verdictCollector: "Veri gelmiyor: toplayıcı bağlı değil",
    verdictNever: "Henüz hiç veri gelmedi",
    verdictUnknown: "Veri akışının durumu okunamıyor",
    countSilent: "{count} sessiz",
    countStale: "{count} eskiyen kanal",
    countStandby: "{count} beklemede",
    countWaiting: "{count} veri bekliyor",
    countUnassigned: "{count} atanmamış",
    watchingSince: "İzleme {time}'den beri; sistem yeniden başlayınca sıfırlanır",
    notFresh: "Pano güncel değil · {time}",
    forMinutes: "{n} dk'dır",
    forUnderMinute: "<1 dk'dır",
    silentTitle: "Sessiz monitörler",
    silentFor: "{for} veri yok · son veri {time}",
    silentNoTime: "son verinin zamanı bilinmiyor",
    vanished: "hub artık bildirmiyor",
    silentNone: "Sessiz monitör yok",
    chainBlocks: "Veri zinciri kesik: monitörler tek tek listelenmiyor",
    staleTitle: "Eskiyen kanallar",
    staleChannel: "{channel} · {for} değer yok",
    staleNone: "Eskiyen kanal yok",
    chainTitle: "Veri zinciri",
    chainCollector: "Toplayıcı · son sinyal {age} önce",
    chainCollectorNone: "Toplayıcı · sinyal yok",
    chainForwarder: "Aktarıcı · son gönderi {age} önce · {sent} gönderildi, {failed} başarısız",
    chainForwarderNone: "Aktarıcı · henüz gönderi yok",
    chainHub: "Infinity sunucusu · {accepted} paket alındı · {old} eski ya da yinelenen",
    chainHubNone: "Infinity sunucusu · bilgi yok",
    chainRejected: "Reddedilen değerler · çok eski {too_old} · saat {clock} · birim {unit} · aralık {range} · bilinmeyen {unknown_parameter} · yinelenen {duplicate}",
    chainRejectedNone: "Reddedilen değerler · bilgi yok",
    wordOk: "normal",
    wordDown: "durmuş",
    wordWarn: "dikkat",
    wordUnknown: "bilinmiyor",
    neverTitle: "Tabloda var, hiç görülmedi",
    neverNone: "Tabloda olup hiç görülmeyen monitör yok",
  },
  az: {
    title: "Cihaz & Məlumat Axını",
    verdictTitle: "Məlumat gəlirmi?",
    verdictFlowing: "Məlumat axır · {streaming}/{total} monitordan məlumat gəlir",
    verdictForwarder: "Məlumat gəlmir: ötürücü {for} susur",
    verdictForwarderNoTime: "Məlumat gəlmir: ötürücü susur",
    verdictCollector: "Məlumat gəlmir: toplayıcı qoşulmayıb",
    verdictNever: "Hələ heç bir məlumat gəlməyib",
    verdictUnknown: "Məlumat axınının vəziyyəti oxunmur",
    countSilent: "{count} səssiz",
    countStale: "{count} köhnələn kanal",
    countStandby: "{count} gözləmə rejimində",
    countWaiting: "{count} məlumat gözləyir",
    countUnassigned: "{count} təyin edilməmiş",
    watchingSince: "İzləmə {time}-dan bəri; sistem yenidən başlayanda sıfırlanır",
    notFresh: "Lövhə yenilənməyib · {time}",
    forMinutes: "{n} dəqiqədir",
    forUnderMinute: "<1 dəqiqədir",
    silentTitle: "Səssiz monitorlar",
    silentFor: "{for} məlumat yoxdur · son məlumat {time}",
    silentNoTime: "son məlumatın vaxtı məlum deyil",
    vanished: "hub artıq bildirmir",
    silentNone: "Səssiz monitor yoxdur",
    chainBlocks: "Məlumat zənciri qırılıb: monitorlar bir-bir sadalanmır",
    staleTitle: "Köhnələn kanallar",
    staleChannel: "{channel} · {for} dəyər yoxdur",
    staleNone: "Köhnələn kanal yoxdur",
    chainTitle: "Məlumat zənciri",
    chainCollector: "Toplayıcı · son əlaqə {age} əvvəl",
    chainCollectorNone: "Toplayıcı · əlaqə yoxdur",
    chainForwarder: "Ötürücü · son göndəriş {age} əvvəl · {sent} göndərildi, {failed} uğursuz",
    chainForwarderNone: "Ötürücü · hələ göndəriş yoxdur",
    chainHub: "Infinity serveri · {accepted} paket alınıb · {old} köhnə və ya təkrar",
    chainHubNone: "Infinity serveri · məlumat yoxdur",
    chainRejected: "Qəbul edilməyən dəyərlər · çox köhnə {too_old} · saat {clock} · vahid {unit} · diapazon {range} · naməlum {unknown_parameter} · təkrar {duplicate}",
    chainRejectedNone: "Qəbul edilməyən dəyərlər · məlumat yoxdur",
    wordOk: "normal",
    wordDown: "dayanıb",
    wordWarn: "diqqət",
    wordUnknown: "məlum deyil",
    neverTitle: "Cədvəldə var, heç görünməyib",
    neverNone: "Cədvəldə olub heç görünməyən monitor yoxdur",
  },
  ru: {
    title: "Устройства и поток данных",
    verdictTitle: "Поступают ли данные?",
    verdictFlowing: "Данные поступают · {streaming}/{total} мониторов передают данные",
    verdictForwarder: "Данные не поступают: передатчик молчит {for}",
    verdictForwarderNoTime: "Данные не поступают: передатчик молчит",
    verdictCollector: "Данные не поступают: сборщик не подключён",
    verdictNever: "Данные ещё ни разу не поступали",
    verdictUnknown: "Состояние потока данных не удаётся прочитать",
    countSilent: "молчат: {count}",
    countStale: "устаревающих каналов: {count}",
    countStandby: "в режиме ожидания: {count}",
    countWaiting: "ожидают данных: {count}",
    countUnassigned: "не назначено: {count}",
    watchingSince: "Наблюдение с {time}; сбрасывается при перезапуске системы",
    notFresh: "Данные на экране не обновлены · {time}",
    forMinutes: "{n} мин",
    forUnderMinute: "<1 мин",
    silentTitle: "Молчащие мониторы",
    silentFor: "нет данных {for} · последние данные {time}",
    silentNoTime: "время последних данных неизвестно",
    vanished: "хаб больше о нём не сообщает",
    silentNone: "Молчащих мониторов нет",
    chainBlocks: "Цепочка данных прервана: мониторы по отдельности не перечисляются",
    staleTitle: "Устаревающие каналы",
    staleChannel: "{channel} · нет значения {for}",
    staleNone: "Устаревающих каналов нет",
    chainTitle: "Цепочка данных",
    chainCollector: "Сборщик · последний сигнал {age} назад",
    chainCollectorNone: "Сборщик · сигнала нет",
    chainForwarder: "Передатчик · последняя отправка {age} назад · отправлено {sent}, неудачно {failed}",
    chainForwarderNone: "Передатчик · отправок ещё не было",
    chainHub: "Сервер Infinity · принято пакетов: {accepted} · устаревших или повторных: {old}",
    chainHubNone: "Сервер Infinity · сведений нет",
    chainRejected: "Отклонённые значения · слишком старые {too_old} · часы {clock} · единица {unit} · диапазон {range} · неизвестные {unknown_parameter} · повтор {duplicate}",
    chainRejectedNone: "Отклонённые значения · сведений нет",
    wordOk: "норма",
    wordDown: "остановлен",
    wordWarn: "внимание",
    wordUnknown: "неизвестно",
    neverTitle: "Есть в таблице, ни разу не замечен",
    neverNone: "В таблице нет мониторов, которые ни разу не были замечены",
  },
  en: {
    title: "Devices & Data Flow",
    verdictTitle: "Is data arriving?",
    verdictFlowing: "Data is flowing · {streaming}/{total} monitors sending data",
    verdictForwarder: "No data arriving: the forwarder has been silent for {for}",
    verdictForwarderNoTime: "No data arriving: the forwarder is silent",
    verdictCollector: "No data arriving: the collector is not connected",
    verdictNever: "No data has arrived yet",
    verdictUnknown: "The data flow's state cannot be read",
    countSilent: "{count} silent",
    countStale: "{count} stale channels",
    countStandby: "{count} in standby",
    countWaiting: "{count} waiting for data",
    countUnassigned: "{count} unassigned",
    watchingSince: "Watching since {time}; reset when the system restarts",
    notFresh: "Board not up to date · {time}",
    forMinutes: "{n} min",
    forUnderMinute: "<1 min",
    silentTitle: "Silent monitors",
    silentFor: "no data for {for} · last data {time}",
    silentNoTime: "time of the last data unknown",
    vanished: "the hub no longer reports it",
    silentNone: "No silent monitor",
    chainBlocks: "The data chain is broken: monitors are not listed one by one",
    staleTitle: "Stale channels",
    staleChannel: "{channel} · no value for {for}",
    staleNone: "No stale channel",
    chainTitle: "Data chain",
    chainCollector: "Collector · last heartbeat {age} ago",
    chainCollectorNone: "Collector · no heartbeat",
    chainForwarder: "Forwarder · last post {age} ago · {sent} sent, {failed} failed",
    chainForwarderNone: "Forwarder · no post yet",
    chainHub: "Infinity server · {accepted} packets accepted · {old} old or duplicate",
    chainHubNone: "Infinity server · no report",
    chainRejected: "Refused values · too old {too_old} · clock {clock} · unit {unit} · range {range} · unknown {unknown_parameter} · duplicate {duplicate}",
    chainRejectedNone: "Refused values · no report",
    wordOk: "normal",
    wordDown: "stopped",
    wordWarn: "attention",
    wordUnknown: "unknown",
    neverTitle: "In the table, never seen",
    neverNone: "No monitor in the table that was never seen",
  },
};
```

`dashboard/src/live/i18n/catalog.js` — find (exactly once):

```js
import ertele from "./strings/ertele.js";
```

replace with:

```js
import ertele from "./strings/ertele.js";

// G4-01: «Cihaz & Veri Akışı» — the device page's «veri geliyor mu?» sections (screens/devices/FeedSections.jsx).
import cihaz from "./strings/cihaz.js";
```

`dashboard/src/live/i18n/catalog.js` — find (exactly once):

```js
  ertele, // G2-B5b
```

replace with:

```js
  ertele, // G2-B5b

  cihaz, // G4-01
```

`dashboard/src/live/i18n/strings.test.js` — find (exactly once):

```js
  "devir.fromTo", //         "{from} → {to}" — no word in it
```

replace with:

```js
  "devir.fromTo", //         "{from} → {to}" — no word in it

  // G4-01 (cihaz) · az = tr
  "cihaz.wordOk", //         normal — the same word in Azerbaijani (a link's state word on the device page)
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/i18n/cihaz.strings.test.js src/live/i18n/strings.test.js src/live/rawKeys.test.jsx`
Expected: all pass (the dictionaries' rules hold for the new namespace: four languages, same placeholders, ru in Cyrillic, the one az = tr listed).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add dashboard/src/live/i18n/strings/cihaz.js dashboard/src/live/i18n/cihaz.strings.test.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js
git commit -m "feat(i18n): G4-01 the cihaz namespace — the device page's verdict, sections, chain and duration phrase in four languages, the spec's Turkish pinned" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/i18n/strings/cihaz.js dashboard/src/live/i18n/cihaz.strings.test.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js
```

## Task 6 (dashboard): the pure `deviceFeed.js`

**Files:**
- Create: `dashboard/src/live/screens/devices/deviceFeed.test.js`
- Create: `dashboard/src/live/screens/devices/deviceFeed.js`

Note: `src/reachable.test.js` fails from this task until Task 7 imports the module (`deviceFeed.js` is not reachable from `main.jsx` yet). Do not run it in this task; Task 7 does.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/devices/deviceFeed.test.js` with:

```js
// G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D4, D5): the device page's answer, pure, on a fixed clock. The
// server's instant is AT (the fixtures' generated_at); this browser's is FETCHED when the answer arrived.
// Synthetic devices only (data/shadow.testutil.js): addresses 192.0.2.x, labels «REA-01 · n».
import { describe, it, expect } from "vitest";
import { AT, bed, strip, unassigned } from "../../data/shadow.testutil.js";
import {
  STALE_LIST_AFTER_S, chainLines, countsOf, minutesOf, neverSeenRows, serverNowMs, silentRows, staleAfterOf,
  staleRows, verdictOf,
} from "./deviceFeed.js";

const AT_MS = Date.parse(AT);
const FETCHED = 5_000_000;
const NOW = AT_MS;
const before = (seconds) => new Date(AT_MS - seconds * 1000).toISOString();
const seen = (...channels) => channels.map(([parameter, seconds]) => ({ parameter, last_value_at: before(seconds) }));
const withLedger = (answer, over = {}) => ({ ...answer, watching_since: before(3 * 3600), stale_list_after_s: 60, vanished: [], ...over });

describe("the server's clock", () => {
  it("is the answer's generated_at plus the time since it arrived on this browser", () => {
    const data = strip();
    expect(serverNowMs(data, FETCHED + 30_000, FETCHED)).toBe(AT_MS + 30_000);
    expect(serverNowMs(data, FETCHED - 1, FETCHED)).toBe(AT_MS);              // a clock stepped back: never younger
    expect(serverNowMs({ ...data, generated_at: undefined }, FETCHED, FETCHED)).toBeNull();
  });

  it("counts whole minutes, «<1 dk» being 0", () => {
    expect([minutesOf(0), minutesOf(59_999), minutesOf(60_000), minutesOf(270_000), minutesOf(-5)]).toEqual([0, 0, 1, 4, 0]);
    expect(minutesOf(NaN)).toBeNull();
  });
});

describe("the verdict", () => {
  it("says the data flows, with the server's counts, when the chain is ok", () => {
    const data = strip({ beds: [bed("REA-01 · 2"), bed("REA-01 · 3", [], { status: "silent" })] });
    expect(verdictOf(data, NOW)).toEqual({ chain: false, key: "cihaz.verdictFlowing", streaming: 1, total: 2 });
  });

  it("is the chain's when the feed is not ok: the forwarder's silence and since when, the collector, never", () => {
    expect(verdictOf(strip({ feed: { state: "forwarder_silent", last_post_at: before(4 * 60 + 10) } }), NOW))
      .toEqual({ chain: true, key: "cihaz.verdictForwarder", minutes: 4 });
    expect(verdictOf(strip({ feed: { state: "forwarder_silent", last_post_at: null } }), NOW))
      .toEqual({ chain: true, key: "cihaz.verdictForwarderNoTime", minutes: null });
    expect(verdictOf(strip({ feed: { state: "collector_disconnected" } }), NOW)).toMatchObject({ chain: true, key: "cihaz.verdictCollector" });
    expect(verdictOf(strip({ feed: { state: "never" } }), NOW)).toMatchObject({ chain: true, key: "cihaz.verdictNever" });
    expect(verdictOf(strip({ feed: { state: "something_new" } }), NOW)).toMatchObject({ chain: true, key: "cihaz.verdictUnknown" });
  });
});

describe("«Sessiz monitörler»", () => {
  const ward = withLedger(strip({
    beds: [
      bed("REA-01 · 2", [], { last_packet_at: before(1) }),
      bed("REA-01 · 3", [], { status: "silent", last_packet_at: before(3 * 60) }),
      bed("REA-01 · 4", [], { status: "unknown", last_packet_at: before(12 * 60 + 30) }),
      bed("REA-01 · 5", [], { status: "standby", last_packet_at: before(1) }),
      bed("REA-01 · 6", [], { status: "waiting", last_packet_at: null }),
      bed("REA-01 · 7", [], { status: "unknown", last_packet_at: null }),
    ],
    unassigned: [unassigned("192.0.2.40", "not_in_table", [], { status: "silent", last_packet_at: before(30) })],
  }), { vanished: [
    { source: "192.0.2.4", bed_label: "REA-01 · 4", last_packet_at: before(12 * 60 + 30), last_report_at: before(12 * 60) },
    { source: "192.0.2.90", bed_label: null, last_packet_at: before(20 * 60), last_report_at: before(20 * 60) },
  ] });

  it("lists the silent, the unknown and the vanished once each, the longest silence first, an unknown time last", () => {
    expect(silentRows(ward, NOW).map((r) => [r.label ?? r.source, r.minutes, r.vanished])).toEqual([
      ["192.0.2.90", 20, true],             // vanished, and no card for it: still listed
      ["REA-01 · 4", 12, true],             // unknown AND vanished: one row
      ["REA-01 · 3", 3, false],
      ["192.0.2.40", 0, false],             // unassigned: by its address; under a minute
      ["REA-01 · 7", null, false],          // no last packet known: after every row that has one
    ]);
  });

  it("leaves out a streaming, a standby and a waiting monitor", () => {
    const sources = silentRows(ward, NOW).map((r) => r.source);
    for (const source of ["192.0.2.2", "192.0.2.5", "192.0.2.6"]) expect(sources).not.toContain(source);
  });

  it("reads an answer with no ledger (an API before G4-01): the silent card with no time", () => {
    const old = strip({ beds: [bed("REA-01 · 3", [], { status: "silent" })] });
    expect(silentRows(old, NOW)).toEqual([{ source: "192.0.2.3", label: "REA-01 · 3", lastMs: null, minutes: null, vanished: false }]);
  });
});

describe("«Eskiyen kanallar»", () => {
  it("lists a channel only past the limit — at 61 s, not at 59 — oldest first, the devices by their oldest", () => {
    const data = withLedger(strip({
      beds: [
        bed("REA-01 · 2", [], { channels_seen: seen(["hr", 0], ["spo2", 59], ["art_systolic", 61], ["etco2", 5 * 60]) }),
        bed("REA-01 · 3", [], { channels_seen: seen(["hr", 10 * 60]) }),
      ],
    }));
    expect(staleRows(data, NOW)).toEqual([
      { source: "192.0.2.3", label: "REA-01 · 3", channels: [{ parameter: "hr", lastMs: AT_MS - 600_000, minutes: 10 }] },
      { source: "192.0.2.2", label: "REA-01 · 2", channels: [
        { parameter: "etco2", lastMs: AT_MS - 300_000, minutes: 5 },
        { parameter: "art_systolic", lastMs: AT_MS - 61_000, minutes: 1 },
      ] },
    ]);
  });

  it("takes the server's limit, and 60 s from an answer that sends none", () => {
    const card = bed("REA-01 · 2", [], { channels_seen: seen(["spo2", 90]) });
    expect(staleRows(withLedger(strip({ beds: [card] }), { stale_list_after_s: 120 }), NOW)).toEqual([]);
    const none = strip({ beds: [card] });
    expect(staleAfterOf(none)).toBe(STALE_LIST_AFTER_S);
    expect(staleRows(none, NOW)).toHaveLength(1);
  });

  it("never lists NBP, and no channel of a monitor in standby, silent or unknown", () => {
    const data = withLedger(strip({
      beds: [
        bed("REA-01 · 2", [], { channels_seen: seen(["nbp", 3 * 3600]) }),
        bed("REA-01 · 3", [], { status: "standby", channels_seen: seen(["hr", 600]) }),
        bed("REA-01 · 4", [], { status: "silent", channels_seen: seen(["hr", 600]) }),
        bed("REA-01 · 5", [], { status: "unknown", channels_seen: seen(["hr", 600]) }),
      ],
    }));
    expect(staleRows(data, NOW)).toEqual([]);
  });
});

describe("the counts", () => {
  it("are the rows' and the server's: silent monitors, stale channels, standby, waiting, unassigned", () => {
    const data = strip({
      beds: [bed("REA-01 · 3", [], { status: "standby" }), bed("REA-01 · 4", [], { status: "waiting" })],
      unassigned: [unassigned("192.0.2.40")],
    });
    const silent = [{ source: "a" }, { source: "b" }];
    const stale = [{ channels: [{}, {}] }, { channels: [{}] }];
    expect(countsOf(data, silent, stale)).toEqual({ silent: 2, stale: 3, standby: 2, waiting: 1, unassigned: 1 });
  });
});

describe("«Veri zinciri»", () => {
  it("gives each link its state word, and its age aged since the answer arrived", () => {
    const lines = chainLines(strip(), FETCHED + 3000, FETCHED);
    expect(lines.map((line) => [line.id, line.word])).toEqual([["collector", "ok"], ["forwarder", "ok"], ["hub", "ok"], ["rejected", "ok"]]);
    expect(lines[0]).toMatchObject({ heard: true, ageS: 4 });                  // 1 s when it answered, 3 s since
    expect(lines[1]).toMatchObject({ posted: true, ageS: 5, sent: 11, failed: 0 });
    expect(lines[2]).toMatchObject({ accepted: 1000, old: 0 });
  });

  it("says which link stopped", () => {
    const words = (feed) => Object.fromEntries(chainLines(strip({ feed }), FETCHED, FETCHED).map((line) => [line.id, line.word]));
    expect(words({ state: "forwarder_silent" })).toMatchObject({ forwarder: "down", hub: "unknown" });
    expect(words({ state: "collector_disconnected", collector_connected: false })).toMatchObject({ collector: "down", forwarder: "ok" });
    expect(words({ state: "never", collector_connected: null, collector_age_s: null, last_post_age_s: null, forwarder: null, hub: null }))
      .toEqual({ collector: "unknown", forwarder: "unknown", hub: "unknown", rejected: "ok" });
    expect(words({ rejected: { too_old: 2, clock: 0, unit: 0, range: 0, unknown_parameter: 0, duplicate: 0 } }).rejected).toBe("warn");
  });
});

describe("«Tabloda var, hiç görülmedi»", () => {
  it("is the table's rows whose monitor was never reported (status null), in the list's order", () => {
    const body = { stage: "shadow", generated_at: AT, can_bind: false, devices: [
      { source: "192.0.2.11", status: "streaming", row_id: 1 },
      { source: "192.0.2.12", status: null, row_id: 2 },
      { source: "192.0.2.13", status: "unknown", row_id: 3 },       // seen, then gone: not «never seen»
      { source: "192.0.2.14", status: null, row_id: 4 },
    ] };
    expect(neverSeenRows(body).map((d) => d.source)).toEqual(["192.0.2.12", "192.0.2.14"]);
    expect(neverSeenRows(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/screens/devices/deviceFeed.test.js`
Expected: FAIL — `Failed to resolve import "./deviceFeed.js"`.

- [ ] **Step 3: Write the minimal implementation**

Create `dashboard/src/live/screens/devices/deviceFeed.js` with:

```js
// src/live/screens/devices/deviceFeed.js — G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D4, D5): the device page's
// answer to "is data arriving?", pure. It reads the shadow board's answer (GET /infinity-shadow/board: the strip's
// cards plus the server's last-seen ledger) and the editor's list (GET /infinity-shadow/device-beds), and decides
// what the five sections say; FeedSections.jsx only words it.
//
// A duration is the server's: an instant the answer names (a card's `last_packet_at`, a channel's
// `last_value_at`, the feed's `last_post_at`) against the answer's own `generated_at` plus the time since it
// arrived on this browser's clock (`serverNowMs`) — two readings of one clock on each side, so a browser with a
// wrong clock cannot shorten a silence, and the durations tick between polls with ShadowProvider's 1 s clock.
// Whole minutes, floored: «4 dk» is a true lower bound, and 0 is «<1 dk».
//
// No patient and no value here — which monitor, which channel, since when — and no threshold on a value.
import { displayAge } from "../common/monitor.js";

/** The API sends `stale_list_after_s` (D4: a channel is listed once it has had no valid value this long); this
 *  is what it sends, for an answer from an API that sends none. */
export const STALE_LIST_AFTER_S = 60;

const MINUTE_MS = 60_000;
const QUIET = new Set(["silent", "unknown"]);
const CHAIN_KEY = Object.freeze({
  never: "cihaz.verdictNever", forwarder_silent: "cihaz.verdictForwarder", collector_disconnected: "cihaz.verdictCollector",
});
const FORWARDER_WORD = Object.freeze({ ok: "ok", collector_disconnected: "ok", forwarder_silent: "down", never: "unknown" });

const listOf = (value) => (Array.isArray(value) ? value : []);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (row) => row.label ?? row.source;

function msOf(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** The server's instant now: the answer's `generated_at` plus the time since it arrived, on this browser's clock.
 *  A clock now before the arrival (stepped back) adds nothing; an answer with no time gives null. */
export function serverNowMs(data, nowMs, fetchedAtMs) {
  const at = msOf(data?.generated_at);
  if (at === null) return null;
  if (!Number.isFinite(nowMs) || !Number.isFinite(fetchedAtMs) || nowMs < fetchedAtMs) return at;
  return at + (nowMs - fetchedAtMs);
}

/** Whole minutes in `ms`, floored; 0 is under a minute («<1 dk»). Null for no duration. */
export function minutesOf(ms) {
  return Number.isFinite(ms) ? Math.floor(Math.max(0, ms) / MINUTE_MS) : null;
}

/** The list-after limit in seconds: the server's, or STALE_LIST_AFTER_S from an answer that has none. */
export function staleAfterOf(data) {
  const server = data?.stale_list_after_s;
  return Number.isFinite(server) && server >= 0 ? server : STALE_LIST_AFTER_S;
}

/** Every card the caller is shown; `label` is the bed's for a bed card, null for an unassigned one. */
function cardsOf(data) {
  return [...listOf(data?.beds).map((card) => ({ card, label: card.bed_label ?? null })),
    ...listOf(data?.unassigned).map((card) => ({ card, label: null }))];
}

/** Section 1's verdict. The chain comes first: a feed that is not `ok` is the chain's verdict — the forwarder's
 *  silence with its minutes, the collector, «never», or a state this build does not know — and every monitor is
 *  then silent for that one reason. Otherwise the data flows, with the server's own counts. */
export function verdictOf(data, now) {
  const feed = data?.feed ?? {};
  if (feed.state === "ok") {
    return { chain: false, key: "cihaz.verdictFlowing", streaming: feed.devices?.streaming ?? 0, total: feed.devices?.total ?? 0 };
  }
  if (feed.state === "forwarder_silent") {
    const last = msOf(feed.last_post_at);
    const minutes = last !== null && now !== null ? minutesOf(now - last) : null;
    return { chain: true, key: minutes === null ? "cihaz.verdictForwarderNoTime" : "cihaz.verdictForwarder", minutes };
  }
  return { chain: true, key: CHAIN_KEY[feed.state] ?? "cihaz.verdictUnknown", minutes: null };
}

function quietRow(source, label, lastIso, vanished, now) {
  const lastMs = msOf(lastIso);
  return { source, label, lastMs, minutes: lastMs !== null && now !== null ? minutesOf(now - lastMs) : null, vanished };
}

function bySilence(a, b) {
  if (a.lastMs !== b.lastMs) {
    if (a.lastMs === null) return 1;
    if (b.lastMs === null) return -1;
    return a.lastMs - b.lastMs;
  }
  return cmp(nameOf(a), nameOf(b)) || cmp(a.source, b.source);
}

/** Section 2 «Sessiz monitörler»: every silent or unknown card and every vanished device, once each — a vanished
 *  device is also an unknown card (the server keeps it), and is said once, as vanished. The longest silence
 *  first; a row whose last packet is not known after every row whose is. */
export function silentRows(data, now) {
  const gone = new Map(listOf(data?.vanished).filter((v) => typeof v?.source === "string").map((v) => [v.source, v]));
  const rows = [];
  const listed = new Set();
  for (const { card, label } of cardsOf(data)) {
    const vanished = gone.has(card.source);
    if (!QUIET.has(card.status) && !vanished) continue;
    listed.add(card.source);
    rows.push(quietRow(card.source, label, card.last_packet_at ?? gone.get(card.source)?.last_packet_at, vanished, now));
  }
  for (const v of gone.values()) {
    if (!listed.has(v.source)) rows.push(quietRow(v.source, v.bed_label ?? null, v.last_packet_at, true, now));
  }
  return rows.sort(bySilence);
}

/** Section 3 «Eskiyen kanallar» (D4): per device that is still sending (`streaming`), the channels with no valid
 *  value for longer than the list-after limit, oldest first; the devices by their oldest channel. NBP is never
 *  stale — it comes when the cuff measures. A monitor in standby, silent or unknown has none: its silence is
 *  section 2's, and standby is counted on its own. */
export function staleRows(data, now) {
  if (now === null) return [];
  const afterMs = staleAfterOf(data) * 1000;
  const rows = [];
  for (const { card, label } of cardsOf(data)) {
    if (card.status !== "streaming") continue;
    const channels = listOf(card.channels_seen)
      .filter((ch) => typeof ch?.parameter === "string" && ch.parameter !== "nbp")
      .map((ch) => ({ parameter: ch.parameter, lastMs: msOf(ch.last_value_at) }))
      .filter((ch) => ch.lastMs !== null && now - ch.lastMs > afterMs)
      .map((ch) => ({ ...ch, minutes: minutesOf(now - ch.lastMs) }))
      .sort((x, y) => x.lastMs - y.lastMs || cmp(x.parameter, y.parameter));
    if (channels.length > 0) rows.push({ source: card.source, label, channels });
  }
  return rows.sort((a, b) => a.channels[0].lastMs - b.channels[0].lastMs || cmp(nameOf(a), nameOf(b)));
}

/** Section 1's counts after a verdict that the data flows: silent monitors and stale channels (the rows'),
 *  standby, waiting and unassigned (the server's). A count the answer does not carry is 0 here; the screen prints
 *  only the counts above 0. */
export function countsOf(data, silent, stale) {
  const devices = data?.feed?.devices ?? {};
  const n = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
  return {
    silent: silent.length,
    stale: stale.reduce((sum, row) => sum + row.channels.length, 0),
    standby: n(devices.standby),
    waiting: n(devices.waiting),
    unassigned: n(data?.feed?.unassigned),
  };
}

/** Section 4 «Veri zinciri»: one line per link, each with its state word — ok, down, warn or unknown. The
 *  collector (connected, its last heartbeat's age), the forwarder (its last post's age, sent and failed), the
 *  hub's accepted and old-or-duplicate packets, and the refused values by reason. Ages are the server's plus the
 *  time since the answer arrived (`displayAge`). */
export function chainLines(data, nowMs, fetchedAtMs) {
  const feed = data?.feed ?? {};
  const aged = (seconds) => (Number.isFinite(seconds) ? displayAge({ age_s: seconds }, nowMs, fetchedAtMs) : null);
  const forwarder = FORWARDER_WORD[feed.state] ?? "unknown";
  const rejected = feed.rejected && typeof feed.rejected === "object" ? feed.rejected : null;
  const refused = rejected === null ? null
    : Object.values(rejected).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return [
    { id: "collector", word: feed.collector_connected === true ? "ok" : feed.collector_connected === false ? "down" : "unknown",
      heard: Number.isFinite(feed.collector_age_s), ageS: aged(feed.collector_age_s) },
    { id: "forwarder", word: forwarder, posted: Number.isFinite(feed.last_post_age_s), ageS: aged(feed.last_post_age_s),
      sent: feed.forwarder?.sent ?? null, failed: feed.forwarder?.failed ?? null },
    { id: "hub", word: feed.hub && forwarder === "ok" ? "ok" : "unknown",
      accepted: feed.hub?.accepted_packets ?? null, old: feed.hub?.old_or_duplicate_packets ?? null },
    { id: "rejected", word: refused === null ? "unknown" : refused === 0 ? "ok" : "warn", rejected },
  ];
}

/** Section 5 «Tabloda var, hiç görülmedi»: the editor list's table rows (`row_id`) whose monitor the API has never
 *  had a report of since it started (`status` null — devicebeds/listing.py), in the list's own order. */
export function neverSeenRows(body) {
  return listOf(body?.devices).filter((d) => d?.row_id != null && d.status === null);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/screens/devices/deviceFeed.test.js`
Expected: all pass (14 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add dashboard/src/live/screens/devices/deviceFeed.js dashboard/src/live/screens/devices/deviceFeed.test.js
git commit -m "feat(devices): G4-01 deviceFeed.js — the verdict, the silent monitors, the stale channels, the chain's links and the never-seen rows, pure, in whole minutes on the server's own clock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/devices/deviceFeed.js dashboard/src/live/screens/devices/deviceFeed.test.js
```

## Task 7 (dashboard): «veri geliyor mu?» first — sections 1–4 at the top of `DevicesScreen`

**Files:**
- Create: `dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx`
- Create: `dashboard/src/live/screens/devices/FeedSections.jsx`
- Modify: `dashboard/src/live/screens/devices/DevicesScreen.jsx` (imports ~line 26; body ~line 116)
- Modify: `dashboard/src/live/screens/devices/DevicesScreen.test.jsx` (the level-2 heading test, ~lines 102–110)

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx` with:

```jsx
// G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D5): the device page answers «is data arriving?» first — the verdict
// and its counts, the silent monitors, the stale channels, the data chain and the table's rows never seen — above
// the editor and the strips. The screen speaks az (the default). Synthetic devices only (shadow.testutil.js).
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { AT, bed, param, strip, unassigned } from "../../data/shadow.testutil.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { DevicesScreen } from "./DevicesScreen.jsx";
import { device, list as mappingList, onBed } from "./esleme.testutil.js";
import { pinZone } from "./zone.testutil.js";

pinZone();     // Baku, UTC+4: AT (10:00Z) reads 14:00
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const before = (minutes) => new Date(Date.parse(AT) - minutes * 60_000).toISOString();
const seen = (...channels) => channels.map(([parameter, minutes]) => ({ parameter, last_value_at: before(minutes) }));
const withLedger = (answer, over = {}) => ({ ...answer, watching_since: before(180), stale_list_after_s: 60, vanished: [], ...over });
const EMPTY_LIST = { stage: "shadow", generated_at: AT, can_bind: false, devices: [] };

async function open(answer, perms = ["devices.manage"], list = EMPTY_LIST) {
  const mounted = await mount(<DevicesScreen />, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      if (list instanceof Error) api.deviceBeds.mockRejectedValue(list);
      else api.deviceBeds.mockResolvedValue(list);
      api.shadowBoard.mockResolvedValue(answer);
    },
  });
  await act(async () => { mounted.shadow.start(perms); await settle(); });
  await act(async () => { await settle(); });       // the editor's first read lands too
  return mounted;
}

const region = (name) => screen.getByRole("region", { name });
const items = (name) => within(region(name)).getAllByRole("listitem").map((li) => li.textContent);

// A streaming bed with a channel quiet for 4½ min (and NBP, never stale), a silent bed, an unknown one the hub no
// longer lists, a monitor in standby, and an unassigned streaming monitor with a channel quiet for 2 min.
const WARD = withLedger(strip({
  beds: [
    bed("REA-01 · 2", [param("hr", 72)], { last_packet_at: before(0), channels_seen: seen(["hr", 0], ["art_systolic", 4.5], ["nbp", 30]) }),
    bed("REA-01 · 5", [], { status: "silent", last_packet_at: before(12.5), silent_for_s: 750, channels_seen: [] }),
    bed("REA-01 · 6", [], { status: "unknown", last_packet_at: before(3), silent_for_s: 180, channels_seen: seen(["hr", 3]) }),
    bed("REA-01 · 7", [], { status: "standby", last_packet_at: before(0), channels_seen: seen(["spo2", 50]) }),
  ],
  unassigned: [unassigned("192.0.2.28", "not_in_table", [param("pls", 70)],
    { status: "streaming", last_packet_at: before(0), channels_seen: seen(["pls", 0], ["spo2", 2]) })],
}), { vanished: [{ source: "192.0.2.6", bed_label: "REA-01 · 6", last_packet_at: before(3), last_report_at: before(2.5) }] });

describe("«Cihaz & Veri Akışı» — is data arriving?", () => {
  it("puts its questions first, in the spec's order, above the editor and the strips", async () => {
    await open(WARD);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 5)).toEqual(["Məlumat gəlirmi?", "Səssiz monitorlar", "Köhnələn kanallar", "Məlumat zənciri",
      "Monitor–çarpayı uyğunlaşdırması"]);
  });

  it("says the data flows, with the counts above zero and since when it has watched", async () => {
    await open(WARD);
    const verdict = region("Məlumat gəlirmi?");
    expect(verdict).toHaveTextContent("Məlumat axır · 2/5 monitordan məlumat gəlir");
    expect(verdict).toHaveTextContent("2 səssiz · 2 köhnələn kanal · 1 gözləmə rejimində · 1 təyin edilməmiş");
    expect(verdict).not.toHaveTextContent("məlumat gözləyir");                  // no monitor waiting: no «0»
    expect(verdict).toHaveTextContent("İzləmə 11:00-dan bəri; sistem yenidən başlayanda sıfırlanır");
  });

  it("lists the silent monitors, the longest silence first, and says which one the hub no longer reports", async () => {
    await open(WARD);
    expect(items("Səssiz monitorlar")).toEqual([
      "REA-01 · 5 · 12 dəqiqədir məlumat yoxdur · son məlumat 13:47",
      "REA-01 · 6 · 3 dəqiqədir məlumat yoxdur · son məlumat 13:57 · hub artıq bildirmir",
    ]);
  });

  it("lists the channels a sending monitor has carried no value on for over a minute — never NBP, never a monitor in standby", async () => {
    await open(WARD);
    expect(items("Köhnələn kanallar")).toEqual([
      "REA-01 · 2 · ART S · 4 dəqiqədir dəyər yoxdur",
      "192.0.2.28 · SpO₂ · 2 dəqiqədir dəyər yoxdur",
    ]);
  });

  it("shows the data chain, each link with its state word", async () => {
    await open(WARD);
    const lines = items("Məlumat zənciri");
    expect(lines[0]).toMatch(/^normal Toplayıcı · son əlaqə \d+ san əvvəl$/);
    expect(lines[1]).toMatch(/^normal Ötürücü · son göndəriş \d+ san əvvəl · 11 göndərildi, 0 uğursuz$/);
    expect(lines[2]).toBe("normal Infinity serveri · 1000 paket alınıb · 0 köhnə və ya təkrar");
    expect(lines[3]).toBe("normal Qəbul edilməyən dəyərlər · çox köhnə 0 · saat 0 · vahid 0 · diapazon 0 · naməlum 0 · təkrar 0");
  });

  it("gives the chain's verdict when no data arrives, and lists no monitor as a fault then", async () => {
    await open(withLedger(strip({ beds: WARD.beds, unassigned: WARD.unassigned,
      feed: { state: "forwarder_silent", last_post_at: before(4.2), last_post_age_s: 252 } })));
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Məlumat gəlmir: ötürücü 4 dəqiqədir susur");
    expect(region("Məlumat gəlirmi?")).not.toHaveTextContent("səssiz");
    for (const name of ["Səssiz monitorlar", "Köhnələn kanallar"]) {
      expect(region(name)).toHaveTextContent("Məlumat zənciri qırılıb: monitorlar bir-bir sadalanmır");
      expect(within(region(name)).queryAllByRole("listitem")).toEqual([]);
    }
    expect(items("Məlumat zənciri")[1]).toMatch(/^dayanıb Ötürücü/);
    cleanup();
    await open(withLedger(strip({ feed: { state: "collector_disconnected", collector_connected: false } })));
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Məlumat gəlmir: toplayıcı qoşulmayıb");
    cleanup();
    await open(withLedger(strip({ feed: { state: "never" } })));
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Hələ heç bir məlumat gəlməyib");
  });

  it("says a list is empty when the answer is fresh", async () => {
    await open(withLedger(strip({ beds: [bed("REA-01 · 2", [param("hr", 72)], { last_packet_at: before(0), channels_seen: seen(["hr", 0]) })] })));
    expect(region("Səssiz monitorlar")).toHaveTextContent("Səssiz monitor yoxdur");
    expect(region("Köhnələn kanallar")).toHaveTextContent("Köhnələn kanal yoxdur");
  });

  it("reads an answer with no ledger: the silent card with no time, and no watching line", async () => {
    await open(strip({ beds: [bed("REA-01 · 5", [], { status: "silent" })] }));
    expect(items("Səssiz monitorlar")).toEqual(["REA-01 · 5 · son məlumatın vaxtı məlum deyil"]);
    expect(region("Məlumat gəlirmi?")).not.toHaveTextContent("İzləmə");
  });

  it("shows no patient, even to a session that also holds board.view", async () => {
    await open(withLedger(strip({ beds: [bed("REA-01 · 5", [], { status: "silent", last_packet_at: before(5), link: "one", patient_id: "S-003" })] })),
      ["devices.manage", "board.view"]);
    expect(document.body).not.toHaveTextContent("S-003");
  });

  it("draws none of it while the strip is off", async () => {
    await open({ stage: "off" });
    expect(screen.queryByRole("region", { name: "Məlumat gəlirmi?" })).toBeNull();
  });
});
```

`dashboard/src/live/screens/devices/DevicesScreen.test.jsx` — find (exactly once):

```jsx
    // The four strips, and (G2-ESLEME) the monitor–bed section above them, which is a level-2 heading too.
    const [section, ...strips] = screen.getAllByRole("heading", { level: 2 });
    expect(section).toHaveTextContent("Monitor–çarpayı uyğunlaşdırması");
    expect(strips).toHaveLength(4);
    for (const heading of strips) expect(heading.closest("[data-monitor-strip]")).not.toBeNull();
```

replace with:

```jsx
    // G4-01: the page's own sections come first (DevicesScreen.feed.test.jsx pins them), then (G2-ESLEME) the
    // monitor–bed section, then the four strips — every one of them a level-2 heading.
    const headings = screen.getAllByRole("heading", { level: 2 });
    const strips = headings.filter((heading) => heading.closest("[data-monitor-strip]"));
    expect(strips).toHaveLength(4);
    expect(headings.slice(-4)).toEqual(strips);
    expect(headings[headings.length - 5]).toHaveTextContent("Monitor–çarpayı uyğunlaşdırması");
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/screens/devices/DevicesScreen.feed.test.jsx src/live/screens/devices/DevicesScreen.test.jsx`
Expected: 8 of the feed file's 10 tests FAIL (no region «Məlumat gəlirmi?»; the heading list starts with the editor's) — the two guards, no patient and the strip off, pass already; `DevicesScreen.test.jsx` still passes (19).

- [ ] **Step 3: Write the minimal implementation**

Create `dashboard/src/live/screens/devices/FeedSections.jsx` with:

```jsx
// src/live/screens/devices/FeedSections.jsx — G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D5): what the device
// page says first — is data arriving? Top to bottom: the verdict and its counts, the silent monitors, the stale
// channels, the data chain and the table's rows never seen; the editor and the strip cards follow, unchanged
// (DevicesScreen.jsx). The rules are deviceFeed.js's; this file only words them.
//
// Decision 18: only a fresh answer — the last poll answered, no longer ago than the display limit — may say a
// list is empty; one that is not keeps what it said, marked «Pano güncel değil · {HH:MM}», and says nothing is
// empty. No patient anywhere: monitors, channels and times. Nothing here alarms, sounds or counts on the rail.
import React, { useId } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { StatusPill } from "../../ui/index.js";
import { stripOn } from "../common/MonitorStrip.jsx";
import { ageText } from "../common/monitor.js";
import { chainLines, countsOf, serverNowMs, silentRows, staleRows, verdictOf } from "./deviceFeed.js";

const WORD = Object.freeze({ ok: "cihaz.wordOk", down: "cihaz.wordDown", warn: "cihaz.wordWarn", unknown: "cihaz.wordUnknown" });
const TONE = Object.freeze({ ok: "ok", down: "att", warn: "att", unknown: "neutral" });
const COUNTS = Object.freeze([
  ["silent", "cihaz.countSilent"], ["stale", "cihaz.countStale"], ["standby", "cihaz.countStandby"],
  ["waiting", "cihaz.countWaiting"], ["unassigned", "cihaz.countUnassigned"],
]);

/** «4 dk'dır», or «<1 dk'dır» under a minute: every section's duration, in whole minutes (D5). */
const forText = (t, minutes) => (minutes === 0 ? t("cihaz.forUnderMinute") : t("cihaz.forMinutes", { n: minutes }));

/** One section: a level-2 heading under the page's own, the region named by it. */
function Section({ title, children }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5 rounded-box bg-card p-3">
      <h2 id={id} className="m-0 font-display text-17 font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Verdict({ t, data, verdict, counts }) {
  const watching = Date.parse(data.watching_since ?? "");
  const text = verdict.chain
    ? t(verdict.key, verdict.minutes === null ? undefined : { for: forText(t, verdict.minutes) })
    : t(verdict.key, { streaming: verdict.streaming, total: verdict.total });
  // Only the counts above zero: a «0» would be a list called empty, which is Decision 18's to allow.
  const parts = verdict.chain ? []
    : COUNTS.filter(([name]) => counts[name] > 0).map(([name, key]) => t(key, { count: counts[name] }));
  return (
    <>
      <p className="m-0 text-13 font-semibold">{text}</p>
      {parts.length > 0 ? <p className="m-0 text-13">{parts.join(" · ")}</p> : null}
      {Number.isFinite(watching) ? <p className="m-0 text-12.5 text-mute">{t("cihaz.watchingSince", { time: hhmm(watching) })}</p> : null}
    </>
  );
}

function SilentList({ t, rows }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((row) => (
        <li key={row.source} data-source={row.source} className="text-13">
          <span className="font-semibold">{row.label ?? row.source}</span>
          {" · "}
          {row.minutes === null ? t("cihaz.silentNoTime")
            : t("cihaz.silentFor", { for: forText(t, row.minutes), time: hhmm(row.lastMs) })}
          {row.vanished ? ` · ${t("cihaz.vanished")}` : null}
        </li>
      ))}
    </ul>
  );
}

function StaleList({ t, rows }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((row) => (
        <li key={row.source} data-source={row.source} className="text-13">
          <span className="font-semibold">{row.label ?? row.source}</span>
          {" · "}
          {row.channels.map((ch) => t("cihaz.staleChannel", { channel: t(`monitor.p.${ch.parameter}`), for: forText(t, ch.minutes) })).join("; ")}
        </li>
      ))}
    </ul>
  );
}

function chainText(t, line) {
  const age = ageText(t, line.ageS) ?? "—";
  if (line.id === "collector") return line.heard ? t("cihaz.chainCollector", { age }) : t("cihaz.chainCollectorNone");
  if (line.id === "forwarder") {
    return line.posted ? t("cihaz.chainForwarder", { age, sent: line.sent ?? "—", failed: line.failed ?? "—" })
      : t("cihaz.chainForwarderNone");
  }
  if (line.id === "hub") {
    return line.accepted === null ? t("cihaz.chainHubNone") : t("cihaz.chainHub", { accepted: line.accepted, old: line.old ?? "—" });
  }
  return line.rejected ? t("cihaz.chainRejected", line.rejected) : t("cihaz.chainRejectedNone");
}

function ChainList({ t, lines }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {lines.map((line) => (
        <li key={line.id} data-chain={line.id} className="flex flex-wrap items-center gap-2 text-13">
          <StatusPill tone={TONE[line.word]}>{t(WORD[line.word])}</StatusPill>
          {" "}
          <span>{chainText(t, line)}</span>
        </li>
      ))}
    </ul>
  );
}

export function FeedSections({ shadow }) {
  const { t } = useI18n();
  const { data, nowMs, fetchedAtMs } = shadow;
  if (!stripOn(data)) return null;
  // Decision 18: only a fresh answer may say a list is empty, and one that is not is marked.
  const fresh = true;
  const mark = null;
  const now = serverNowMs(data, nowMs, fetchedAtMs);
  const verdict = verdictOf(data, now);
  const silent = verdict.chain ? [] : silentRows(data, now);
  const stale = verdict.chain ? [] : staleRows(data, now);
  const counts = countsOf(data, silent, stale);
  const blocked = <p className="m-0 text-13">{t("cihaz.chainBlocks")}</p>;
  const none = (key) => (fresh ? <p className="m-0 text-13 text-mute">{t(key)}</p> : null);
  return (
    <div className="flex flex-col gap-2.5" data-feed-sections>
      <Section title={t("cihaz.verdictTitle")}>
        <Verdict t={t} data={data} verdict={verdict} counts={counts} />
        {mark}
      </Section>
      <Section title={t("cihaz.silentTitle")}>
        {verdict.chain ? blocked : silent.length > 0 ? <SilentList t={t} rows={silent} /> : none("cihaz.silentNone")}
        {mark}
      </Section>
      <Section title={t("cihaz.staleTitle")}>
        {verdict.chain ? blocked : stale.length > 0 ? <StaleList t={t} rows={stale} /> : none("cihaz.staleNone")}
        {mark}
      </Section>
      <Section title={t("cihaz.chainTitle")}>
        <ChainList t={t} lines={chainLines(data, nowMs, fetchedAtMs)} />
        {mark}
      </Section>
    </div>
  );
}
```

`dashboard/src/live/screens/devices/DevicesScreen.jsx` — find (exactly once):

```jsx
import { MappingSection } from "./MappingSection.jsx";
```

replace with:

```jsx
import { MappingSection } from "./MappingSection.jsx";
// G4-01: «veri geliyor mu?» first, above the editor and the strips (spec 2026-11-11 D5)
import { FeedSections } from "./FeedSections.jsx";
```

`dashboard/src/live/screens/devices/DevicesScreen.jsx` — find (exactly once):

```jsx
      {canSeeMapping(user?.perms) ? <MappingSection /> : null}
```

replace with:

```jsx
      <FeedSections shadow={shadow} />
      {canSeeMapping(user?.perms) ? <MappingSection /> : null}
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/screens/devices src/reachable.test.js src/live/boundaries.test.js src/live/waveBoundaries.test.js`
Expected: all pass — the feed tests (10), `DevicesScreen.test.jsx` (19, the strip's counters still found by their own words), `reachable.test.js` (deviceFeed.js and FeedSections.jsx now reached), the boundaries (`screens/devices/*` is strip code; nothing guarded imports it).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add dashboard/src/live/screens/devices/FeedSections.jsx dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx dashboard/src/live/screens/devices/DevicesScreen.jsx dashboard/src/live/screens/devices/DevicesScreen.test.jsx
git commit -m "feat(devices): G4-01 «veri geliyor mu?» first — the verdict and its counts, the silent monitors, the stale channels and the data chain above the editor and the strips" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/devices/FeedSections.jsx dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx dashboard/src/live/screens/devices/DevicesScreen.jsx dashboard/src/live/screens/devices/DevicesScreen.test.jsx
```

## Task 8 (dashboard): «Tabloda var, hiç görülmedi» — the table's rows never seen

**Files:**
- Modify: `dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx` (the order test; a describe appended)
- Modify: `dashboard/src/live/rawKeys.test.jsx` (`openAt` ~line 243; a fixture after `STRIP` ~line 171; an anchor test before the audit page's ~line 441)
- Modify: `dashboard/src/live/screens/devices/MappingSection.jsx` (`onList`)
- Modify: `dashboard/src/live/screens/devices/FeedSections.jsx` (imports; `NeverSeen`; section 5)
- Modify: `dashboard/src/live/screens/devices/DevicesScreen.jsx` (the editor's list lifted)

- [ ] **Step 1: Write the failing tests**

`dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx` — find (exactly once):

```jsx
    expect(headings.slice(0, 5)).toEqual(["Məlumat gəlirmi?", "Səssiz monitorlar", "Köhnələn kanallar", "Məlumat zənciri",
      "Monitor–çarpayı uyğunlaşdırması"]);
```

replace with:

```jsx
    expect(headings.slice(0, 6)).toEqual(["Məlumat gəlirmi?", "Səssiz monitorlar", "Köhnələn kanallar", "Məlumat zənciri",
      "Cədvəldə var, heç görünməyib", "Monitor–çarpayı uyğunlaşdırması"]);
```

Append to the end of `dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx`:

```jsx

// Section 5 reads the editor's own list (GET /infinity-shadow/device-beds, `status` null: never reported since the
// API started) — devices.manage or devices.map_beds, the page's own two keys. Synthetic monitors (esleme.testutil.js).
describe("«Tabloda var, hiç görülmedi»", () => {
  const LIST = mappingList([
    device("192.0.2.11", { device_bed_label: "BED05", row_id: 1, bed: onBed(1, "1") }),
    device("192.0.2.21", { device_bed_label: "BED09", row_id: 6, seen: false, status: null, last_seen_at: null, bed: onBed(9, "9") }),
    device("192.0.2.22", { row_id: 7, seen: false, status: null, last_seen_at: null }),
    device("192.0.2.20", { row_id: 5, seen: false, status: "unknown", last_seen_at: null }),   // seen once: not here
  ]);

  it("lists the table's rows whose monitor was never reported, with the bed and the device's address", async () => {
    await open(WARD, ["devices.manage"], LIST);
    expect(items("Cədvəldə var, heç görünməyib")).toEqual(["9 · Otaq 1 · Reanimasiya · 192.0.2.21 (BED09)", "qoşulmayıb · 192.0.2.22"]);
  });

  it("is there for a charge nurse too, whose devices.map_beds reads the same list", async () => {
    await open(WARD, ["devices.map_beds", "board.view"], LIST);
    expect(items("Cədvəldə var, heç görünməyib")).toHaveLength(2);
  });

  it("says none only from a list that answered", async () => {
    await open(WARD);
    expect(region("Cədvəldə var, heç görünməyib")).toHaveTextContent("Cədvəldə olub heç görünməyən monitor yoxdur");
    cleanup();
    await open(WARD, ["devices.manage"], new Error("down"));
    expect(region("Cədvəldə var, heç görünməyib")).not.toHaveTextContent("Cədvəldə olub heç görünməyən monitor yoxdur");
  });

  it("keeps the rows of a list it can no longer read, and says so", async () => {
    const mounted = await open(WARD, ["devices.manage"], LIST);
    mounted.api.deviceBeds.mockRejectedValue(new Error("down"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    expect(items("Cədvəldə var, heç görünməyib")).toHaveLength(2);
    expect(region("Cədvəldə var, heç görünməyib")).toHaveTextContent(DICTIONARIES.az["esleme.unreadable"]);
  });

  it("is absent for a session that holds neither key, and nothing asks for the list", async () => {
    const mounted = await open(WARD, ["board.view"]);
    expect(screen.queryByRole("region", { name: "Cədvəldə var, heç görünməyib" })).toBeNull();
    expect(mounted.api.deviceBeds).not.toHaveBeenCalled();
  });
});
```

`dashboard/src/live/rawKeys.test.jsx` — find (exactly once):

```jsx
  unassigned: [unassigned("192.0.2.28"), unassigned("192.0.2.34", "not_in_table", [param("pls", 70)], { status: "streaming" })],
});
```

replace with:

```jsx
  unassigned: [unassigned("192.0.2.28"), unassigned("192.0.2.34", "not_in_table", [param("pls", 70)], { status: "streaming" })],
});

/** G4-01: a strip with the device page's ledger (api/infinity_shadow.py board_view): a silent monitor, a vanished
 *  one, and a channel with no value for four minutes on a streaming one. STRIP carries no ledger, so the sweep
 *  meets only the sections' empty words; this is where the rest are drawn. Synthetic devices only. */
const minutesBefore = (n) => new Date(NOW - n * 60_000).toISOString();
const FEED_STRIP = {
  ...strip({
    beds: [
      bed("REA-01 · 1", [param("hr", 96)], { last_packet_at: minutesBefore(0),
        channels_seen: [{ parameter: "hr", last_value_at: minutesBefore(0) }, { parameter: "art_systolic", last_value_at: minutesBefore(4) }] }),
      bed("REA-01 · 5", [], { status: "silent", last_packet_at: minutesBefore(7), silent_for_s: 420, channels_seen: [] }),
      bed("REA-01 · 6", [], { status: "unknown", last_packet_at: minutesBefore(3), silent_for_s: 180, channels_seen: [] }),
    ],
  }),
  watching_since: minutesBefore(120), stale_list_after_s: 60,
  vanished: [{ source: "192.0.2.6", bed_label: "REA-01 · 6", last_packet_at: minutesBefore(3), last_report_at: minutesBefore(3) }],
};
```

`dashboard/src/live/rawKeys.test.jsx` — find (exactly once):

```jsx
async function openAt(path) {
```

replace with:

```jsx
async function openAt(path, extra) {
```

`dashboard/src/live/rawKeys.test.jsx` — find (exactly once):

```jsx
      api.handoverColleagues.mockResolvedValue(COLLEAGUES);
```

replace with:

```jsx
      api.handoverColleagues.mockResolvedValue(COLLEAGUES);
      extra?.(api);   // G4-01: a test's own answers, laid over the sweep's
```

`dashboard/src/live/rawKeys.test.jsx` — find (exactly once):

```jsx
  // G2-B4 — the audit page: its verdict appears only on the button (owner D1), so the sweep above never saw it.
```

replace with:

```jsx
  // G4-01 — «Cihaz & Veri Akışı»: the device page's sections on a ward with a silent, a vanished and a stale-channel
  // monitor, and a table row whose monitor was never seen — states the sweep's STRIP and MAPPING do not reach.
  it("the device page's feed keys resolve on every section", async () => {
    const mounted = await openAt("/devices", (api) => {
      api.shadowBoard.mockResolvedValue(FEED_STRIP);
      api.deviceBeds.mockResolvedValue(mappingList([...MAPPING.devices,
        device("192.0.2.21", { row_id: 6, seen: false, status: null, last_seen_at: null, device_bed_label: "BED09" })]));
    });
    expect(screen.getByRole("heading", { level: 2, name: "Məlumat gəlirmi?" })).toBeInTheDocument();          // cihaz.verdictTitle
    expect(screen.getByText(/^Məlumat axır · \d+\/\d+ monitordan məlumat gəlir$/)).toBeInTheDocument();         // cihaz.verdictFlowing
    expect(screen.getByText(/^İzləmə \d\d:\d\d-dan bəri/)).toBeInTheDocument();                                // cihaz.watchingSince
    const silent = screen.getByRole("region", { name: "Səssiz monitorlar" });
    expect(silent).toHaveTextContent("dəqiqədir məlumat yoxdur · son məlumat");                                // cihaz.silentFor, forMinutes
    expect(silent).toHaveTextContent("hub artıq bildirmir");                                                   // cihaz.vanished
    expect(screen.getByRole("region", { name: "Köhnələn kanallar" })).toHaveTextContent("dəqiqədir dəyər yoxdur"); // cihaz.staleChannel
    expect(screen.getByRole("region", { name: "Məlumat zənciri" })).toHaveTextContent("Ötürücü · son göndəriş"); // cihaz.chainForwarder
    expect(screen.getByRole("region", { name: "Cədvəldə var, heç görünməyib" })).toHaveTextContent("192.0.2.21 (BED09)"); // cihaz.neverTitle
    expect(rawKeys(document.body)).toEqual([]);
    act(() => { mounted.board.clear(); mounted.shadow.clear(); });
  });

  // G2-B4 — the audit page: its verdict appears only on the button (owner D1), so the sweep above never saw it.
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/screens/devices/DevicesScreen.feed.test.jsx src/live/rawKeys.test.jsx`
Expected: 6 FAIL — no region «Cədvəldə var, heç görünməyib»: the order test, four of the five new tests (the guard for a session with neither key passes already) and the rawKeys anchor; the other tests pass.

- [ ] **Step 3: Write the minimal implementation**

`dashboard/src/live/screens/devices/MappingSection.jsx` — find (exactly once):

```jsx
export function MappingSection() {
```

replace with:

```jsx
export function MappingSection({ onList } = {}) {
```

`dashboard/src/live/screens/devices/MappingSection.jsx` — find (exactly once):

```jsx
  const { phase, body } = state;
```

replace with:

```jsx
  // G4-01: the page's «Tabloda var, hiç görülmedi» reads this same list, so the page asks for it once (D5 §5).
  useEffect(() => { onList?.(state); }, [state, onList]);

  const { phase, body } = state;
```

`dashboard/src/live/screens/devices/FeedSections.jsx` — find (exactly once):

```jsx
import { StatusPill } from "../../ui/index.js";
```

replace with:

```jsx
import { Note, StatusPill } from "../../ui/index.js";
```

`dashboard/src/live/screens/devices/FeedSections.jsx` — find (exactly once):

```jsx
import { chainLines, countsOf, serverNowMs, silentRows, staleRows, verdictOf } from "./deviceFeed.js";
```

replace with:

```jsx
import { bedText, monitorName } from "./deviceMap.js";
import { chainLines, countsOf, neverSeenRows, serverNowMs, silentRows, staleRows, verdictOf } from "./deviceFeed.js";
```

`dashboard/src/live/screens/devices/FeedSections.jsx` — find (exactly once):

```jsx
export function FeedSections({ shadow }) {
```

replace with:

```jsx
/** Section 5: the table's rows whose monitor the API has never had a report of, from the editor's own list
 *  (MappingSection's `onList`: the page asks for it once). Its own Decision 18: «none» only from a list that
 *  answered; a list that could not be read keeps its last rows and says so. */
function NeverSeen({ t, mapping }) {
  const rows = neverSeenRows(mapping.body);
  const unread = mapping.phase === "unreadable" ? <Note>{t("esleme.unreadable")}</Note> : null;
  if (rows.length === 0) {
    return mapping.phase === "ok" ? <p className="m-0 text-13 text-mute">{t("cihaz.neverNone")}</p> : unread;
  }
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((d) => (
          <li key={d.source} data-source={d.source} className="text-13">
            <span className="font-semibold">{bedText(t, d)}</span>
            {" · "}
            <span className="font-data">{monitorName(d)}</span>
          </li>
        ))}
      </ul>
      {unread}
    </>
  );
}

export function FeedSections({ shadow, mapping = null }) {
```

`dashboard/src/live/screens/devices/FeedSections.jsx` — find (exactly once):

```jsx
        <ChainList t={t} lines={chainLines(data, nowMs, fetchedAtMs)} />
        {mark}
      </Section>
```

replace with:

```jsx
        <ChainList t={t} lines={chainLines(data, nowMs, fetchedAtMs)} />
        {mark}
      </Section>
      {mapping ? (
        <Section title={t("cihaz.neverTitle")}>
          <NeverSeen t={t} mapping={mapping} />
        </Section>
      ) : null}
```

`dashboard/src/live/screens/devices/DevicesScreen.jsx` — find (exactly once):

```jsx
import React from "react";
```

replace with:

```jsx
import React, { useState } from "react";
```

`dashboard/src/live/screens/devices/DevicesScreen.jsx` — find (exactly once):

```jsx
  const shadow = useShadow();
```

replace with:

```jsx
  const shadow = useShadow();
  const [mapping, setMapping] = useState(null);    // G4-01: the editor's list, for «Tabloda var, hiç görülmedi»
```

`dashboard/src/live/screens/devices/DevicesScreen.jsx` — find (exactly once):

```jsx
      <FeedSections shadow={shadow} />
      {canSeeMapping(user?.perms) ? <MappingSection /> : null}
```

replace with:

```jsx
      <FeedSections shadow={shadow} mapping={mapping} />
      {canSeeMapping(user?.perms) ? <MappingSection onList={setMapping} /> : null}
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/screens/devices src/live/rawKeys.test.jsx`
Expected: all pass — the feed tests (15), `DevicesScreen.test.jsx`, `MappingSection.test.jsx` and `MappingSection.poll.test.jsx` unchanged, `rawKeys.test.jsx` with the new anchor.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add dashboard/src/live/screens/devices/MappingSection.jsx dashboard/src/live/screens/devices/FeedSections.jsx dashboard/src/live/screens/devices/DevicesScreen.jsx dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx dashboard/src/live/rawKeys.test.jsx
git commit -m "feat(devices): G4-01 «Tabloda var, hiç görülmedi» — the table's rows whose monitor was never reported, from the editor's own list (asked once, by every holder of the page); «none» only from a list that answered" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/devices/MappingSection.jsx dashboard/src/live/screens/devices/FeedSections.jsx dashboard/src/live/screens/devices/DevicesScreen.jsx dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx dashboard/src/live/rawKeys.test.jsx
```

## Task 9 (dashboard): a board that is not fresh (Decision 18)

**Files:**
- Modify: `dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx` (a describe appended)
- Modify: `dashboard/src/live/screens/devices/FeedSections.jsx` (imports; `fresh` and `mark`)

- [ ] **Step 1: Write the failing test**

Append to the end of `dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx`:

```jsx

// Decision 18: only a fresh answer may say a list is empty. One that is not — a poll that hangs past the display
// limit, a poll that failed — keeps what it said, marked with the answer's own time.
describe("a board that is not fresh (Decision 18)", () => {
  const stall = async (mounted) => {
    mounted.api.shadowBoard.mockReturnValue(new Promise(() => {}));         // the next poll never answers
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 18_000);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
  };
  const MARK = "Lövhə yenilənməyib · 14:00";

  it("keeps each section's last answer, marked with the answer's time", async () => {
    const mounted = await open(WARD);
    expect(screen.queryByText(MARK)).toBeNull();
    await stall(mounted);
    expect(screen.getAllByText(MARK)).toHaveLength(4);
    expect(items("Səssiz monitorlar")).toHaveLength(2);
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Məlumat axır · 2/5 monitordan məlumat gəlir");
  });

  it("says nothing is empty from an answer it cannot vouch for", async () => {
    const mounted = await open(withLedger(strip({ beds: [bed("REA-01 · 2", [param("hr", 72)], { last_packet_at: before(0), channels_seen: seen(["hr", 0]) })] })));
    expect(screen.getByText("Səssiz monitor yoxdur")).toBeInTheDocument();
    await stall(mounted);
    expect(screen.queryByText("Səssiz monitor yoxdur")).toBeNull();
    expect(screen.queryByText("Köhnələn kanal yoxdur")).toBeNull();
    expect(region("Səssiz monitorlar")).toHaveTextContent(MARK);
  });

  it("marks a failed poll the same way", async () => {
    const mounted = await open(WARD);
    mounted.api.shadowBoard.mockRejectedValue(new Error("down"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    expect(screen.getAllByText(MARK)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/screens/devices/DevicesScreen.feed.test.jsx`
Expected: the three new tests FAIL (`Unable to find an element with the text: Lövhə yenilənməyib · 14:00`; «Səssiz monitor yoxdur» still shown); the rest pass.

- [ ] **Step 3: Write the minimal implementation**

`dashboard/src/live/screens/devices/FeedSections.jsx` — find (exactly once):

```jsx
import { stripOn } from "../common/MonitorStrip.jsx";
import { ageText } from "../common/monitor.js";
```

replace with:

```jsx
import { SHADOW_PHASE } from "../../data/shadowStore.js";
import { readUnknown, stripOn } from "../common/MonitorStrip.jsx";
import { ageText, maxAgeOf } from "../common/monitor.js";
```

`dashboard/src/live/screens/devices/FeedSections.jsx` — find (exactly once):

```jsx
  const fresh = true;
  const mark = null;
```

replace with:

```jsx
  const fresh = shadow.phase === SHADOW_PHASE.OK && !readUnknown(shadow, nowMs, maxAgeOf(data));
  const stamp = Date.parse(data.generated_at ?? "");
  const mark = fresh ? null : <Note>{t("cihaz.notFresh", { time: Number.isFinite(stamp) ? hhmm(stamp) : "—" })}</Note>;
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/screens/devices src/live/rawKeys.test.jsx`
Expected: all pass (18 feed tests).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add dashboard/src/live/screens/devices/FeedSections.jsx dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx
git commit -m "feat(devices): G4-01 a board that is not fresh keeps each section's answer, marked «Pano güncel değil · HH:MM», and says nothing is empty (Decision 18)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/devices/FeedSections.jsx dashboard/src/live/screens/devices/DevicesScreen.feed.test.jsx
```

## Task 10 (dashboard): the nav label «Cihazlar» and the heading «Cihaz & Veri Akışı»

**Files:**
- Modify: `dashboard/src/live/i18n/cihaz.strings.test.js` (a test appended)
- Modify: `dashboard/src/live/screens/devices/DevicesScreen.test.jsx` (the heading's name, line 48)
- Modify: `dashboard/src/live/i18n/strings/nav.js` (lines 11, 19, 27, 35)
- Modify: `dashboard/src/live/i18n/strings/kabul.js` (`err.bedHasMonitor`, lines 139, 306, 468, 629)
- Modify: `dashboard/src/live/i18n/strings/perms.js` (`devices.map_beds`, lines 44, 83, 122, 161)
- Modify: `dashboard/src/live/i18n/strings/auth.js` (`notice.noScreen`, lines 67, 126, 185, 244)
- Modify: `dashboard/src/live/i18n/strings.test.js` (`AZ_SAME_AS_TR`)
- Modify: `dashboard/src/live/screens/admin/StructureTab.test.jsx` (lines 382, 387)
- Modify: `dashboard/src/live/screens/devices/DevicesScreen.jsx` (the `<h1>`)

- [ ] **Step 1: Write the failing tests**

`dashboard/src/live/i18n/cihaz.strings.test.js` — find (exactly once):

```js
    for (const key of ["cihaz.chainCollector", "cihaz.chainCollectorNone"]) expect(az[key]).not.toMatch(/siqnal/i);
  });
});
```

replace with:

```js
    for (const key of ["cihaz.chainCollector", "cihaz.chainCollectorNone"]) expect(az[key]).not.toMatch(/siqnal/i);
  });

  it("names the rail entry «Cihazlar», and every text that names the screen follows it", () => {
    expect(LANG_CODES.map((lang) => DICTIONARIES[lang]["nav.devices"])).toEqual(
      LANG_CODES.map((lang) => ({ tr: "Cihazlar", az: "Cihazlar", ru: "Устройства", en: "Devices" })[lang]));
    for (const lang of LANG_CODES) {
      const d = DICTIONARIES[lang];
      expect(d["nav.devicesShort"], lang).toBe(d["nav.devices"]);
      for (const key of ["kabul.err.bedHasMonitor", "perms.devices.map_beds"]) {
        expect(d[key], `${lang} ${key}`).toContain(d["nav.devices"]);
        expect(d[key], `${lang} ${key}`).not.toMatch(/Monitörler|Monitorlar|Мониторы|Monitors/);
      }
      // devices.manage opens a screen now: the login screen's «only device management» example is gone.
      expect(d["auth.notice.noScreen"], lang).not.toMatch(/cihaz|устройств|device/i);
    }
  });
});
```

`dashboard/src/live/screens/devices/DevicesScreen.test.jsx` — find (exactly once):

```jsx
    expect(screen.getByRole("heading", { level: 1, name: "Monitorlar" })).toBeInTheDocument();
```

replace with:

```jsx
    expect(screen.getByRole("heading", { level: 1, name: "Cihaz & Məlumat Axını" })).toBeInTheDocument();   // G4-01
```

`dashboard/src/live/screens/admin/StructureTab.test.jsx` — find (exactly once):

```jsx
  it("says a bed with a monitor is unbound on «Monitorlar» first, named after the bed", async () => {
```

replace with:

```jsx
  it("says a bed with a monitor is unbound on «Cihazlar» first, named after the bed", async () => {
```

`dashboard/src/live/screens/admin/StructureTab.test.jsx` — find (exactly once):

```jsx
əvvəlcə «Monitorlar» ekranında bağlantını kəsin.").length)
```

replace with:

```jsx
əvvəlcə «Cihazlar» ekranında bağlantını kəsin.").length)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/i18n/cihaz.strings.test.js src/live/screens/devices/DevicesScreen.test.jsx src/live/screens/admin/StructureTab.test.jsx`
Expected: FAIL — the rail label is «Monitörler»; the `<h1>` reads «Monitorlar»; the toast still says «Monitorlar».

- [ ] **Step 3: Write the minimal implementation**

`dashboard/src/live/i18n/strings/nav.js` — find (exactly once):

```js
    devices: "Monitörler", devicesShort: "Monitörler", // Aşama A: biomedical's device-only screen
```

replace with:

```js
    devices: "Cihazlar", devicesShort: "Cihazlar", // G4-01: «Cihaz & Veri Akışı» (cihaz.title) — was «Monitörler»
```

`dashboard/src/live/i18n/strings/nav.js` — find (exactly once):

```js
    devices: "Monitorlar", devicesShort: "Monitorlar",
```

replace with:

```js
    devices: "Cihazlar", devicesShort: "Cihazlar",
```

`dashboard/src/live/i18n/strings/nav.js` — find (exactly once):

```js
    devices: "Мониторы", devicesShort: "Мониторы",
```

replace with:

```js
    devices: "Устройства", devicesShort: "Устройства",
```

`dashboard/src/live/i18n/strings/nav.js` — find (exactly once):

```js
    devices: "Monitors", devicesShort: "Monitors",
```

replace with:

```js
    devices: "Devices", devicesShort: "Devices",
```

`dashboard/src/live/i18n/strings/kabul.js` — find (exactly once):

```js
önce «Monitörler» ekranında bağlantıyı çözün.
```

replace with:

```js
önce «Cihazlar» ekranında bağlantıyı çözün.
```

`dashboard/src/live/i18n/strings/kabul.js` — find (exactly once):

```js
əvvəlcə «Monitorlar» ekranında bağlantını kəsin.
```

replace with:

```js
əvvəlcə «Cihazlar» ekranında bağlantını kəsin.
```

`dashboard/src/live/i18n/strings/kabul.js` — find (exactly once):

```js
сначала отвяжите его на экране «Мониторы».
```

replace with:

```js
сначала отвяжите его на экране «Устройства».
```

`dashboard/src/live/i18n/strings/kabul.js` — find (exactly once):

```js
unassign it first on the Monitors screen.
```

replace with:

```js
unassign it first on the Devices screen.
```

`dashboard/src/live/i18n/strings/perms.js` — find (exactly once):

```js
map_beds: "«Monitörler» ekranında bir başucu
```

replace with:

```js
map_beds: "«Cihazlar» ekranında bir başucu
```

`dashboard/src/live/i18n/strings/perms.js` — find (exactly once):

```js
map_beds: "«Monitorlar» ekranında çarpayı
```

replace with:

```js
map_beds: "«Cihazlar» ekranında çarpayı
```

`dashboard/src/live/i18n/strings/perms.js` — find (exactly once):

```js
или отвязывает его на экране «Мониторы» — только
```

replace with:

```js
или отвязывает его на экране «Устройства» — только
```

`dashboard/src/live/i18n/strings/perms.js` — find (exactly once):

```js
or unassign it, on the Monitors screen — beds
```

replace with:

```js
or unassign it, on the Devices screen — beds
```

`dashboard/src/live/i18n/strings/auth.js` — find (exactly once):

```js
 (ör. yalnız cihaz yönetimi)
```

replace with an empty string (delete those characters, the leading space included), so the line reads `noScreen: "Hesabınızın yetkileri bu arayüzdeki ekranlardan hiçbirini açmıyor. Sistem yöneticinizle görüşün.",`.

`dashboard/src/live/i18n/strings/auth.js` — find (exactly once):

```js
 (məs. yalnız cihaz idarəsi)
```

replace with an empty string, so the line reads `noScreen: "Hesabınızın səlahiyyətləri bu interfeysdəki ekranların heç birini açmır. Sistem administratorunuza müraciət edin.",`.

`dashboard/src/live/i18n/strings/auth.js` — find (exactly once):

```js
 (например, только управление устройствами)
```

replace with an empty string, so the line reads `noScreen: "Права вашей учётной записи не открывают ни одного экрана этого интерфейса. Обратитесь к системному администратору.",`.

`dashboard/src/live/i18n/strings/auth.js` — find (exactly once):

```js
 (for example, device management only)
```

replace with an empty string, so the line reads `noScreen: "Your account's rights open none of this interface's screens. Contact your system administrator.",`.

`dashboard/src/live/i18n/strings.test.js` — find (exactly once):

```js
  "nav.settingsShort", //    Ayarlar — the same word
```

replace with:

```js
  "nav.settingsShort", //    Ayarlar — the same word
  "nav.devices", //          Cihazlar — the spec's az word (G4-01 D5), the same in Turkish
  "nav.devicesShort", //     Cihazlar — the same word on the narrow rail
```

`dashboard/src/live/screens/devices/DevicesScreen.jsx` — find (exactly once):

```jsx
        <h1 className="m-0 font-display text-23 font-bold">{t("nav.devices")}</h1>
```

replace with:

```jsx
        <h1 className="m-0 font-display text-23 font-bold">{t("cihaz.title")}</h1>
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run src/live/i18n src/live/shell/routes.test.js src/live/screens/devices src/live/screens/admin/StructureTab.test.jsx src/live/rawKeys.test.jsx src/live/auth`
Expected: all pass — the strings rules (`nav.devices`/`devicesShort` listed az = tr), `routes.test.js` (the route keeps `labelKey: "nav.devices"`, every language has a text), the device screen's heading, the toast's new name.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add dashboard/src/live/i18n/cihaz.strings.test.js dashboard/src/live/i18n/strings/nav.js dashboard/src/live/i18n/strings/kabul.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/i18n/strings/auth.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/admin/StructureTab.test.jsx dashboard/src/live/screens/devices/DevicesScreen.jsx dashboard/src/live/screens/devices/DevicesScreen.test.jsx
git commit -m "feat(devices): G4-01 the rail says «Cihazlar», the page «Cihaz & Veri Akışı»; the texts that name the screen follow, and the login screen drops its stale «device management only» example" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/i18n/cihaz.strings.test.js dashboard/src/live/i18n/strings/nav.js dashboard/src/live/i18n/strings/kabul.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/i18n/strings/auth.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/admin/StructureTab.test.jsx dashboard/src/live/screens/devices/DevicesScreen.jsx dashboard/src/live/screens/devices/DevicesScreen.test.jsx
```

- [ ] **Step 6: Report** the dashboard lane done to the controller, with the six commits' shas.

---

# Docs

## Task 11 (docs, after both lanes): the guide — §3.22 and the corrections

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (lines ~533–537; ~1420–1421; before the `---` that precedes «## 4.», ~line 1968)

- [ ] **Step 1: Correct the stale sentences of «Girişten sonra nereye düşülür»**

`docs/homunculus-rehber-TR.md` — find (exactly once):

```markdown
  Yöneticisi. Panoyu görmeyen ama kullanıcı ya da grup yöneten biri **Yönetim**'e. Yetkileri yeni
  arayüzün hiçbir ekranını açmayan bir hesap — varsayılan gruplarda Biyomedikal Teknisyen ve
  Üretici Destek: ikisinde de yalnız cihaz ve denetim yetkisi var — içeri alınmaz; giriş ekranı
  bunu söyler ("Hesabınızın yetkileri bu arayüzdeki ekranlardan hiçbirini açmıyor (ör. yalnız
  cihaz yönetimi). Sistem yöneticinizle görüşün."). Cihaz sayfası Grup 4'te gelecek. **Ayarlar**
```

replace with:

```markdown
  Yöneticisi. Panoyu görmeyen ama kullanıcı ya da grup yöneten biri **Yönetim**'e. Cihaz yönetimi
  yetkisi (`devices.manage`) olan biri — varsayılan gruplarda Biyomedikal Teknisyen ve Üretici
  Destek — **Cihazlar**'a («Cihaz & Veri Akışı», aşağıda 3.22); Üretici Destek'in menüsünde ikinci
  sırada «Denetim bütünlüğü» de vardır (3.13). Yetkileri yeni arayüzün hiçbir ekranını açmayan bir
  hesap içeri alınmaz; giriş ekranı bunu söyler ("Hesabınızın yetkileri bu arayüzdeki ekranlardan
  hiçbirini açmıyor. Sistem yöneticinizle görüşün."). **Ayarlar**
```

- [ ] **Step 2: The Yapı quote names the screen by its new name**

`docs/homunculus-rehber-TR.md` — find (exactly once):

```markdown
**Monitörü bağlı bir yatak kapatılamaz.** Yapı «Bu yatağa bir monitör bağlı — önce «Monitörler»
ekranında bağlantıyı çözün.» der (bildirim yatağın adıyla başlar): önce «Monitörler»de bağlantıyı
```

replace with:

```markdown
**Monitörü bağlı bir yatak kapatılamaz.** Yapı «Bu yatağa bir monitör bağlı — önce «Cihazlar»
ekranında bağlantıyı çözün.» der (bildirim yatağın adıyla başlar): önce «Cihazlar»da bağlantıyı
```

- [ ] **Step 3: Write §3.22 right before the `---` that precedes «## 4.»**

`docs/homunculus-rehber-TR.md` — find (exactly once):

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-10-g2b-b5b-ertele-design.md`.
```

replace with:

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-10-g2b-b5b-ertele-design.md`.

### 3.22 «Cihaz & Veri Akışı»: veri geliyor mu? (Grup 4 · G4-01)

- **Ne:** Sol raydaki **«Cihazlar»** sayfası (eski adı «Monitörler»; Azerbaycanca «Cihazlar», Rusça
  «Устройства», İngilizce «Devices») önce tek bir soruyu yanıtlar: **veri geliyor mu?** Sayfanın başlığı
  «Cihaz & Veri Akışı». Adresi (`/devices`), simgesi ve yetkileri değişmedi; rehberin önceki bölümleri
  (3.9, 3.11) ekranı eski adıyla anar, aynı ekrandır.
- **Kim görür:** cihaz yönetimi yetkisi (`devices.manage`: Biyomedikal Teknisyen, Üretici Destek;
  hastane yöneticisi her yetkiyi taşır) ve monitör–yatak eşleme yetkisi (`devices.map_beds`: sorumlu
  hemşire). Biyomedikal hesabı girişte bu sayfaya düşer. Yalnız panoyu görme yetkisi (`board.view`) olan
  hekim ve hemşire ekranı görmez. Sayfa hiçbir hasta bilgisi göstermez.
- **Sayfanın sırası (yukarıdan aşağı):**
  1. **«Veri geliyor mu?»** Tek satırlık hüküm, ardından sayılar.
     - Önce veri zinciri: zincir kopuksa hüküm zincirindir — «Veri gelmiyor: aktarıcı 4 dk'dır sessiz»,
       «Veri gelmiyor: toplayıcı bağlı değil», «Henüz hiç veri gelmedi». O zaman bütün monitörler aynı
       nedenle susar; sayfa onları tek tek arıza diye listelemez, «Veri zinciri kesik: monitörler tek tek
       listelenmiyor» der.
     - Zincir sağlamsa: «Veri akıyor · 5/6 monitör veri gönderiyor», ardından sıfırdan büyük sayılar:
       sessiz, eskiyen kanal, beklemede, veri bekliyor, atanmamış.
     - Altında: «İzleme 10:42'den beri; sistem yeniden başlayınca sıfırlanır».
  2. **«Sessiz monitörler».** Sessiz (monitör 5 saniyeden uzun süredir paket göndermiyor), haber
     alınamayan (Infinity sunucusu — hub — 15 saniyedir bildirmiyor) ve hub'ın artık bildirmediği
     monitörler; en uzun süredir susan en üstte. Her satır: yatağın adı (yatağı yoksa cihazın adresi),
     «{n} dk'dır veri yok · son veri {SS:DD}». Hub'ın listesinden çıkan monitörün satırında «hub artık
     bildirmiyor» yazar; sunucu onun zamanlarını son bildiriminden sonra 24 saat tutar, sonra satır
     API yeniden başlayana dek «son verinin zamanı bilinmiyor» der.
  3. **«Eskiyen kanallar».** Monitör veri gönderirken bir kanalı (ör. ART S, SpO₂) bir dakikadan uzun
     süredir geçerli değer taşımıyorsa: «{kanal} · {n} dk'dır değer yok», en eskisi önce. 15 saniyelik
     anlık boşlukları şerit zaten gösterir; burada yalnız bir dakikayı geçenler listelenir. **NBP hiç
     eskimez** (manşon ölçünce gelir). Beklemedeki monitörün (açık ama ölçmüyor) eskiyen kanalı olmaz;
     o ayrıca sayılır. Bilerek çıkarılan bir kanal (ör. arter kateteri alınınca ART) da monitör veri
     gönderdikçe burada kalır.
  4. **«Veri zinciri».** Toplayıcı (bağlı mı, son sinyal ne kadar önce), aktarıcı (son gönderi,
     gönderilen ve başarısız), Infinity sunucusunun aldığı ve eski ya da yinelenen paketler, nedenine
     göre reddedilen değerler. Her satırın durum sözcüğü vardır: normal, durmuş, dikkat, bilinmiyor.
  5. **«Tabloda var, hiç görülmedi».** Cihaz→yatak tablosunda olup hub'ın, sistem açıldığından beri hiç
     bildirmediği monitörler: yatak ve cihaz adresiyle. Liste, aşağıdaki eşleme bölümünün okuduğu
     listedir; sayfa onu bir kez ister.
  6. Sonra, değişmeden: monitör–yatak eşleme bölümü (3.9) ve her monitörün şeridi.
- **Süreler:** dakika birimiyle (tam dakika); bir dakikadan kısa süre «<1 dk». Süreler sunucunun
  saatiyle sayılır ve iki okuma arasında da ilerler; tarayıcının saati yanlış olsa da bir sessizliği
  kısaltamaz.
- **Pano güncel değilse** (son okuma 15 saniyeden eski ya da okunamadı): bölümler son söylediklerini
  korur, «Pano güncel değil · {SS:DD}» işaretiyle, ve hiçbir bölüm «yok» demez — boş bir listeyi yalnız
  güncel bir okuma söyleyebilir.
- **Neyi hatırlar:** sunucu her monitörü ve her kanalını en son ne zaman gördüğünü yalnız bellekte
  tutar. Veritabanına bir şey yazılmaz, göç (migration) yoktur, hub değişmedi. API yeniden başlarsa bu
  hafıza sıfırlanır; sayfa bunu «İzleme … beri» satırıyla söyler. Değerlerin kendisi, 120 saniyelik
  unutma süresi ve gölge motorun okuduğu hiçbir şey değişmedi.
- **Bu dilimde olmayanlar:** cihaz envanteri ve bakım (tip, seri numarası, bakım, kalibrasyon, arıza,
  pil), alarm kalitesi paneli, yeniden başlatmalar arası sessizlik geçmişi, sessiz monitör için
  bildirim ya da ray rozeti, klinik panonun «besleme sağlığı» göstergesinin biyomedikale açılması, hub
  ya da toplayıcı değişikliği.
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-cihaz-veri-akisi-design.md`.
```

- [ ] **Step 4: Check the section sits where it must**

Run: `cd /c/tmp/g4-cihaz && grep -n "^### 3.21\|^### 3.22\|^## 4\." docs/homunculus-rehber-TR.md && grep -c "Grup 4'te gelecek" docs/homunculus-rehber-TR.md`
Expected: `### 3.21` then `### 3.22` then `## 4.` in that order (with the `---` between 3.22's last line and «## 4.»); the count is `0`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-cihaz
git add docs/homunculus-rehber-TR.md
git commit -m "docs(rehber): §3.22 «Cihaz & Veri Akışı»; a biomedical account lands on Cihazlar, no longer «Grup 4'te»; the Yapı quote names «Cihazlar»" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/homunculus-rehber-TR.md
```

---

# Gates

## Task 12: the gates (after Tasks 1–11)

**Files:** none. A failure goes back to the owning lane as a fix commit (pathspec, Co-Authored-By line), then the failed chunk is run again.

- [ ] **Step 1: The whole no-DB engine suite, in foreground chunks** (from `C:\tmp\g4-cihaz\homunculus-engine`; each line is one tool call; never `test_infinity_vm_pilot.py`)

```bash
cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_a*.py -q -p no:cacheprovider
cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[b-h]*.py -q -p no:cacheprovider
cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_i*.py --ignore=tests/test_infinity_vm_pilot.py -q -p no:cacheprovider
cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[j-r]*.py -q -p no:cacheprovider
cd /c/tmp/g4-cihaz/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[s-z]*.py tests/rules tests/scoring tests/tenant -q -p no:cacheprovider
```

Expected: every chunk `N passed, M skipped`, no failure, no error. Add the five passed counts and the five skipped counts and report the totals (the last full run before this slice was 3891 passed / 1222 skipped; this slice adds 26).

- [ ] **Step 2: The whole dashboard suite** (from `C:\tmp\g4-cihaz\dashboard`)

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vitest run` (foreground, timeout 600000).
Expected: `Test Files 153 passed (153)` (150 before this slice, plus `cihaz.strings.test.js`, `deviceFeed.test.js`, `DevicesScreen.feed.test.jsx`) and `Tests 4101 passed` (4064 before this slice, plus 37); report both.
If the single run would pass the tool's 10-minute limit, run the same files in three chunks instead:
`npx vitest run src/live/screens`, then `npx vitest run src/live/data src/live/shell src/live/i18n src/live/session src/live/auth src/live/gallery src/live/signals src/live/theme src/live/ui src/live/LiveApp src/live/apiErrors src/live/boundaries src/live/prefs src/live/rawKeys src/live/waveBoundaries`, then `npx vitest run src/LoadFailed src/backendApi src/buildSha src/devProxy src/liveAdapters src/liveAuth src/liveConnection src/reachable src/routing src/sepsisContext` — the three file counts must add up to 153.

- [ ] **Step 3: The build**

Run: `cd /c/tmp/g4-cihaz/dashboard && npx vite build`
Expected: `✓ built in …`, no error. `dist/` is git-ignored (`dashboard/.gitignore`). Report any chunk-size warning with the LiveApp chunk's size.

- [ ] **Step 4: Nothing stray**

Run: `cd /c/tmp/g4-cihaz && git status --short && git log --oneline 97743c3d..HEAD`
Expected: a clean tree; the plan's commit and the ten task commits (three engine, six dashboard, one docs) — plus any fix commits, each named.

- [ ] **Step 5: Report** to the owner: the shas, the gate counts, and the two things a reviewer should eyeball in a browser: the ru rail label «Устройства» on a phone-width rail, and the az wording (AZ/RU/EN await a native speaker's review before the pilot). Do not push; do not merge; nothing to the VM.

---

## Self-review

**Spec coverage.**
- D1 «veri geliyor mu» first, the strip and editor below: Task 7 (sections 1–4 above the editor), Task 8 (section 5), the existing strip untouched.
- D2 the ledger (per device first/last report, last packet less its age; per channel last valid value; 24 h; `MAX_DEVICES`; board's channels only; `watching_since`; memory only): Task 1. Readings and the shadow engine's input unchanged: Task 4 and N6.
- D3 the five fields, additive, scoped as cards, no patient: Task 2 (pure), Task 3 (through the routes), N1 adds `stale_list_after_s`.
- D4 silent / unknown / stale / `STALE_LIST_AFTER_S` / NBP never stale / standby neither: Tasks 2 (silent_for_s), 6 (`staleRows`, `silentRows`), 7 (on screen); N9.
- D5 route kept, names, order 1–6, durations in minutes with «<1 dk», on the board's clock, not-fresh marking: Tasks 7–10; N8, N11–N13; the guide's §3 correction and §3.22: Task 11.
- D6 nothing out of scope is built (no inventory, no alarm-quality panel, no history, no badge, no hub change, no migration, no tenant binding change).
- §4 Tests: engine list → Tasks 1–4 (route tables: Task 4 Step 4); dashboard list → Tasks 5–10 (`rawKeys` Task 8, `strings` Tasks 5/10, `routes.test.js` Task 10); gates → Task 12.

**Dry run.** When the plan was written, its 72 file operations were applied in order to a scratch copy of the tree at `97743c3d` (outside the worktree): every find block matched exactly once; at each task's Step 2 the stated tests failed and at its Step 4 they passed, task by task; on the final state the engine's shadow, device-beds, waves and route suites gave 688 passed / 342 skipped, the dashboard 153 files / 4101 tests passed, and `vite build` succeeded (`DevicesScreen` chunk 23 kB). The engine's whole no-DB suite was not run then: Task 12 runs it.

**Placeholder scan.** No TBD, no "similar to", no step without its code. The one hard-coded value is Task 7's `const fresh = true; const mark = null;`, which is working code whose tests cover only fresh answers, replaced in Task 9 by the real rule under its own failing tests.

**Type and name consistency.** Engine: `FeedLedger.observe(views, reported)` / `view() → LedgerView(started_at, devices: {source: SeenView(first_seen_at, last_report_at, last_packet_at, channels, reported)})`; `reported_sources(body)`; `board_view(…, ledger=None)`; `_ledger_fields(shown, ledger, now)`; `app.state.shadow_ledger`; `_note_seen(body)`. Board fields as the contract table. Dashboard: `serverNowMs(data, nowMs, fetchedAtMs)`, `minutesOf(ms)`, `staleAfterOf(data)`, `verdictOf(data, now) → {chain, key, streaming, total} | {chain, key, minutes}`, `silentRows(data, now) → [{source, label, lastMs, minutes, vanished}]`, `staleRows(data, now) → [{source, label, channels: [{parameter, lastMs, minutes}]}]`, `countsOf(data, silent, stale)`, `chainLines(data, nowMs, fetchedAtMs) → [{id, word, heard|posted|accepted|rejected, …}]`, `neverSeenRows(body)`; `FeedSections({shadow, mapping})`, `MappingSection({onList})`. Keys used by the code all exist in `cihaz.js` (`cihaz.verdict*`, `count*`, `for*`, `silent*`, `vanished`, `chainBlocks`, `stale*`, `chain*`, `word*`, `never*`, `notFresh`, `watchingSince`, `title`) or already did (`monitor.p.*`, `esleme.unreadable`, `esleme.unbound`, `esleme.otherUnit`).
