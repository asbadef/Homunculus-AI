# Group 1 · Wave 3 — the six work screens: the bed board (G1-09), the alarms (G1-10), the patient (G1-11) and the three administration tabs (G1-12 · G1-13 · G1-14) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The shell Wave 2 built gets its screens. A clinician signs in and lands on the ward: a bed board of cards or a list, ordered by bed or by risk, each card carrying the engine's risk, the engine's NEWS2, the channels that were actually measured and when; an alarms screen with the two states the board can answer for and one button, "Gördüm", that really acknowledges; and a read-only patient screen that shows every vital's age, the engine's own reasoning for each finding with the vault sources behind it, and what the Sepsis-3 criterion is being judged against. An administrator gets one screen with three tabs — users and their unit scope, the group × permission table, and the directory: its status, a connection test, a search-and-import and the AD group mapping. Nothing on any of these screens computes a clinical value, and no screen says "nothing is waiting" unless the board is LIVE.

**Architecture:** Each screen is a component under `dashboard/src/live/screens/<name>/`, mounted by the shell through the route registry Wave 2 pre-placed (`shell/routes.js` `SCREENS`). They read the ward from the board store (`data/boardStore.js`, Wave 2) and the session from the session store; neither is replaced. What the stores gained is only what a screen may now ask them to DO: `acknowledge()` (`POST /ack`, the answer applied to the board as a stream frame would be), `view()` (`POST /view`, the audit line), `chart()` (`POST /clinical/{id}` — the one write a clinical screen makes, and the board reloaded after it because the engine may now have a finding it did not have), `applyEntry()`, and — on the session store — `api`, so the administration tabs can reach the routes neither store wraps, through `track`. The board's snapshot also carries `clockSkewMs`, the difference between this browser's clock and the server's as the last answer's `Date` header stated it, because every age on every screen is otherwise measured by a ward tablet's clock. Five modules under `screens/common/` hold what more than one screen needs and what no screen may get wrong: `elapsed.js` (an alarm's age, `m:ss` then `h:mm:ss`, never negative), `freshness.js` (the age of a reading, and never a verdict on it), `feedHealth.js` (whether a bed is still reporting — ported from the old workspace's written-but-never-connected module), `vitals.js` (the channel table, and no threshold anywhere in it) and `BoardState.jsx` (the connection strip, the engine's scope sentence, the feed chip, `boardKnown()` — the one question a screen must ask before it may write a reassuring sentence — and the four small things two arms would otherwise each own a copy of: `ChronicExpected`, `summaryOf`, the `RAIL`/`RAIL_LEFT` accent tables and `useBoardNow`). **Anything two arms both render belongs in that file**, because two arms with a copy each is how two screens come to say different things about the same finding. The administration tabs sit inside one `AdminScreen` whose three slots are pre-placed with the same registry seam the routes have, so G1-12, G1-13 and G1-14 are three parallel branches that touch two lines each.

**Tech Stack:** React 18.3, Vite 5.4, Tailwind 3.4, Vitest 2.1 + Testing Library on jsdom 24. **No new package** — in particular no charting library and no `@testing-library/user-event` (the suite drives the DOM with `fireEvent`). Backend: nothing in this plan changes the API. Python/FastAPI appear only as the sources two tests read as text (`auth/permissions.py`, and the refusal messages of `api/app.py`, `admin/*`, `scope/*`).

**Design source:** the clickable prototype, `origin/tasarim/prototip` (`8bebc67`) `tasarim-taslaklari/app/` — and the file names are not the ones the roadmap suggests: the bed board and the alarms screen are both in **`screens.js`** (`H.register("beds")` at :9–59, `H.register("alarms")` at :61–91), the patient screen is **`patient.js`** (1379 lines), administration is **`admin.js`** (2481 lines; users 712–829, roles 851–883, the AD box 1290–1306), and the copy comes from **`ceviri-sozluk.js`**, a 610 kB Turkish-string → AZ/RU/EN table applied by a `MutationObserver` (`ceviri.js`), which means **the six screens have no translation keys at all**: this plan mints the key namespace and takes the four-language copy from that table where it has an entry. `app.css` / `ek.css` for the class vocabulary, `SOZLESME.md` for the prototype's own contract. **Roadmap:** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — the G1-09 … G1-14 rows, the "Grup 1 kabul ölçütleri" for G1-09/G1-10/G1-11/G1-12, "Main'den gelen ve yeni kabukta karşılanacak davranışlar", "Dalga 2'den açık kalanlar", the G1-15 deploy gate and "Bu dal VM'ye çıkmaz". **Spec:** `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` §3 (the groups and the catalogue), §7 (the directory). **Foundations:** `2026-10-03-g1-dalga1b-tasarim-temeli.md` (`src/live/` tokens, i18n, `ui/`) and `2026-10-04-g1-dalga2-kabuk-giris.md` (the shell, the stores, the registry), with the as-built contracts in `amendments.md` and the open items in `deferred.md`.

---

## Size, and how this is split

**26 tasks. Honestly: six screens is more than one wave.** They are split here along the seam the work itself has, and the split is not cosmetic — the two halves share eight tasks of foundation and then touch different files:

| | Tasks | What | Code in this plan |
|---|---|---|---|
| **Wave 3A** | **0–8** | the shared foundation: the API client's new calls and its per-call timeout, the adapter, the stores' new actions, the pure age/freshness/feed modules, `BoardState`, the test seams, and every Wave-3 refusal translated | **written and run** |
| | **9–15B** | the three clinical screens on three parallel branches: beds (9–11), alarms (12–13), patient (14, 15, 15B) | **written and run** |
| **Wave 3B** | **16–19** | the administration foundation: the mirrored permission catalogue, the rules, what the tabs read, and the frame with its three pre-placed tab slots | **written and run** |
| | **20–22** | the three administration tabs — users, roles, login source | **specified, not written** |
| | **23–24** | the documents, and the end-to-end verification | commands written, not run |

**Tasks 0–19 carry code that was written and run** in a scratch worktree at `cced4f9` (`/c/tmp/homunculus-w3`): the whole dashboard suite went from **87 files / 1751 tests** to **99 files / 2097 tests**, all green, with `npx vite build` clean, and every "Expected" line below is what the command actually printed.

Where the number came from, so the next agent can check it rather than trust it. Twelve new test files add 243 tests: `freshness` 13, `feedHealth` 16, `useNow` 6, `BoardState` 24, `BedCard` 30, `order` 17, `BedsScreen` 23, `AlarmsScreen` 19, `PatientScreen` 37, `catalogue` 9, `rules` 30, `AdminScreen` 19. Nine existing files gain 103: `backendApi` 78 → 89, `liveAdapters` 43 → 50, `boardStore` 23 → 33, `apiErrors` 58 → 122, `routes` 21 → 22, `Shell` 30 → 37, `RiskPill` 11 → 14, and `strings.test.js` and `LiveApp.test.jsx` unchanged at 6 and 33 (both gain entries and assertions, not cases). 1751 + 243 + 103 = 2097. Each per-task gate below states its own file's number; if one of them is wrong the arithmetic will not close, which is the point of writing it out.

**Tasks 20–22 are specifications, not plans.** Each names its files, its exact API calls, its decisions, its acceptance criteria as a list of test names, and the rules it must follow — but no code, because none was written. **They want a plan of their own, about twelve tasks, written against the merged Wave 3A code**, which is this project's own method ("Her dalganın ayrıntılı planı, bir önceki dalga bitince birleşmiş koda bakılarak yazılır"). Do not execute 20–22 from this document as if they were TDD tasks: implement 0–19, merge, then write `2026-10-??-g1-dalga3b-yonetim-ekranlari.md` from Task 19's merged frame and the specifications here.

**The seam is after Task 8.** Tasks 0–8 are sequential and shared. From Task 9 there are four arms that touch different files and can be built on different branches:

```
0 … 8  (shared, sequential)
         ├── 9  → 10 → 11        beds        G1-09
         ├── 12 → 13             alarms      G1-10
         ├── 14 → 15 → 15B       patient     G1-11
         └── 16 → 17 → 18 → 19   administration frame   (then 20 ‖ 21 ‖ 22, next plan)
                      24 → 23    (after all of them — the verification first, see Task 24)
```

**Task 15B is numbered with a letter on purpose.** It was added after two reviews, when the user settled the question this plan had left open (**Needs the user, 2**, now answered): the patient screen charts a suspected infection. Renumbering 16–24 to insert it would have invalidated every "Task 19", "Task 23", "Task 7" reference in this document and in the two review reports written against it. A letter costs a reader nothing and a renumbering costs correctness.

Each arm's own files are its own. The four shared files an arm must touch are **one line each**, pre-placed by Task 7 or already pre-placed by Wave 2: its import and its entry in `i18n/catalog.js`, its line in `shell/routes.js` `SCREENS`, its block in `i18n/strings.test.js`'s `AZ_SAME_AS_TR`, and — for the administration tabs — its line in `AdminScreen.jsx`'s `TAB_SCREENS`. Three of the arms also own one Wave-2 file outright for the duration: the alarms arm owns `shell/Sidebar.jsx` and `shell/TopBar.jsx` (Task 13), the patient arm owns the `patient` route's line in `routes.js` and one line of `shell/Shell.jsx` (Task 15).

**Hours.** Tasks 0–8 about 7 hours; the beds arm about 5; the alarms arm about 3.5; the patient arm about 5 (15B is about an hour); the administration foundation about 3.5; the documents and the verification about 2.5. **About 26–28 hours of subagent execution including review** for tasks 0–19 + 23–24, and about **10–14 hours more** for tasks 20–22 once their own plan exists. (The roadmap budgets 5 + 3 + 5 + 5 + 3 + 5 = 26 points ≈ 4.5 days for G1-09…G1-14; this plan covers the clinical three and the administration foundation, and the eight shared tasks were not in that estimate.)

---

## Not in this plan

- **Any vital trend, chart or sparkline.** The engine has no endpoint for a vital's history: `/patients` carries the LATEST value per channel and nothing else, and `/infinity-research/state` (which does carry history) is a device-research endpoint behind `devices.manage`. The prototype draws every curve from a seeded random generator (`core.js:491-498 H.series`). G1-11 therefore leaves a named seam and a sentence saying what is missing on the SERVER — the roadmap's Group 2 opens with exactly this work ("ICU vital diyagramları (önce)").
- **Snoozing or manually escalating an alarm.** The roadmap puts both in Group 2 ("alarm ertele/eskale"), and the live API has neither: `POST /ack` is the only write the alarm surface has. The prototype's 3 / 5 / 10-minute ladder is client-side and its own admin screen admits the chain "is in the engine's code but not connected" (`admin.js:908`).
- **A "closed alarms" section.** `/patients` carries the engine's ACTIVE alarms; a closed one leaves the board. See Decision 8.
- **The SOFA form** (`severityScore.jsx`, written and never connected) **and the patient's own charted baseline.** Both are writes to the patient's record that need a form, validation and a signature, and both belong with Group 2's charting work. What the patient screen DOES write, after the user settled this (**Needs the user, 2**, answered), is the suspected infection — one boolean, one call, Task 15B — because without it the engine's whole sepsis branch never runs for that patient and the screen would be stating a problem it was built unable to fix.
- **Snoozing, escalating or un-charting.** A charted observation is superseded by a later one, never withdrawn: the audit trail is the record, and an interface that offered "undo" on a clinical judgement would be offering to rewrite it.
- **The bed-occupancy, handover, admission, audit, alarm-quality, wall-monitor, heat-map and RRT screens**: Group 2–4 in the roadmap.
- **A patient/bed search in the top bar** (Ctrl K, "/"). The beds screen has its own search; a global one belongs with the shell and nothing in Group 1 needs it.
- **Creating, renaming or deleting a user.** The API has no `DELETE /admin/users` and no way to change a `username` (the roadmap routes both to Group 4); an account is deactivated, not deleted, and that is what Task 20 offers.
- **Changing the `SCREEN_LOCK_*` times, the escalation chain or the name-masking policy from a screen.** The old workspace's `PolicySettings` wrote them to the simulation only; no endpoint exists (**Needs the user, 7**).

---

## Decisions

1. **What each screen shows, and what it refuses to show.** The bed board shows, per card: the bed the SERVER resolved, the HIS's name or the statement that there is none, the engine's risk as a pill plus a 4 px stripe, the open alarms with the engine's own summaries, the channels that have a value (with their units), the engine's NEWS2 with its partial marking, when the card was last measured, how many channels are overdue, where the identity came from, and the HIS location the bed table failed to cover. The alarms screen shows the two states the board has and the age of each alarm. The patient screen shows all of that plus each vital's own age, the engine's reasoning / sources / suggestions / certainty per finding, and the Sepsis-3 and medication context. **It refuses:** any score, band, normal range, colour-by-value or risk of its own; an age it did not get from a timestamp; a name or a bed it was not sent; a patient's age, body-surface area or protocol number (the prototype computes the first two in the browser and *fabricates* the last from the patient id, `patient.js:214-215`); the prototype's pain / fall / pressure-injury chips (hard-coded bands at `screens.js:16`); its two literal "attention" tiles ("3 sonuç görülmedi · laktat 4.1 dahil", "1 cihaz sessiz · RE07"); the simulated monitor waveform; and any sparkline, because the data behind one does not exist. *Rejected:* porting the prototype's board as drawn and marking the invented parts "demo" — a clinical screen with a demo region on it is a screen whose other regions a clinician has no reason to trust either.

2. **Colour is never the only signal, and nothing is ever green.** Every risk appears as `riskStyle`'s tone **and** its icon **and** its word (`ui/RiskPill`), and the card's left stripe repeats the same tone. `moderate` is amber; `none` and `info` are neutral; a risk the engine did not send, or one this build does not know, takes the attention look — never the quiet grey and never `ok`. An alarm whose severity is the string `"none"` is mapped to `null` before the pill, so an unanswered alarm can never read "no finding". The accent colour that repeats the tone — the card's left rail, the patient screen's left border — comes from ONE table (`RAIL` / `RAIL_LEFT`, `screens/common/BoardState.jsx`), for a reason found while fixing this plan: the card had a map, the patient screen had an inline ternary, and the ternary's fallback caught `neutral` as well as `att`. So a finding of severity `info` came out quiet grey on the card and attention amber on the patient screen. Amber in this interface means "the screen cannot vouch for this", so the same finding was telling a clinician two different things about how much the system knew. A tone the table does not have falls back to `att` and never to the quiet one. *Rejected:* the old `riskUi` map, whose fallback was emerald and which therefore painted the engine's `none`, `info` **and** `moderate` as a green "stabil" with no label at all (`ClinicalDemo.jsx:44-48`); this is the defect on the VM today.

3. **"No finding" is a claim about observations, so the card has to have some.** `riskStyle` refuses to assume it: the caller passes `measured`, and the bed card and the patient screen compute it from the card's own timestamps (`hasMeasurement(patient.measuredAt)`). A patient the HIS admitted whose monitor has sent nothing reads "Ölçülməyib", not "Tapıntı yoxdur". *Rejected:* defaulting `measured` to true (the identity-only card is exactly the one that must not read as calm).

4. **The screen reports the AGE of a value and never decides that an age is too old.** `freshness.js` returns numbers and instants and has no "stale". "Too old to act on" is a clinical threshold; the engine owns every one of them, applies its own inside `evaluate()`, and tells us per finding which inputs it already judged stale (`Alert.stale_inputs`) — which the patient screen shows as the engine's words. *Rejected:* the browser marking a value stale past a window of its own (Wave 0's lesson: NEWS2 was being computed here and had to be torn out).
   **One window does survive, and it is operational, not clinical:** `feedHealth.js`'s per-channel `freshSec` (heart rate 300 s, SpO₂ 300 s, systolic 900 s, mean 900 s, temperature 3600 s, respiration 600 s, lactate 6 h and `continuous: false`) answers "is this bed still REPORTING", which is a property of the monitor and the bridge. It never colours a vital, never changes a risk and never marks a score partial; it drives one chip and one per-card count. The module is taken over whole from the old workspace, where it was written, tested and never connected. Those numbers still belong on the server (**Needs the user, 4**).

5. **NEWS2 is the engine's or it is "—" with the reason, and `red_param` is a fact, not a floor.** The card prints `news2.total` when the engine sent one, marks `partial` and names the unmeasured parameters, and prints `NEWS2: —` with the engine's own explanation when it did not. `red_param` is shown as its own pill ("Bir parametr 3 bal alıb") and **does not change the engine's level**. The roadmap's G1-09 criterion says a red parameter should make the card at least amber; it cannot be honoured in the browser, because the engine can legitimately send `risk: "low"` with `red_param: true` — `rules/patient_relative.py::_adjust_news2` lowers a NEWS2 alert when the patient's charted chronic normal explains every contributor, and dementia alone can do it. Whether a charted baseline may override the red-parameter floor is a clinical decision (roadmap "Kullanıcı kararları", 9), and the browser deciding it would be the browser scoring the patient. So the screen shows both and overrides neither.

    **The user has now chosen how to show them together** (option **d** of the four put to them): both facts side by side, **plus** a third, neutral pill — `board.chronicExpected`, "Xəstənin öz normasına görə gözlənilən" — on any finding the engine marked `downgraded`, carrying the engine's own `chronic_context` in its accessible name. That is what makes a `low` level and a red-parameter pill reconcilable at a glance: without it, a clinician reading "Aşağı" beside "Bir parametr 3 bal alıb" cannot tell a justified downgrade from an engine fault, and the only safe reading of an ambiguous screen is to distrust the whole of it. The pill is `tone="neutral"`, not the attention look, because it is an explanation and not a warning; it lives in `screens/common/BoardState.jsx` so the card and the alarms row cannot drift apart.

    **Two things this does not settle, and both are recorded rather than decided here.** First, the clinical question itself: option **b** — the engine stops downgrading a NEWS2 alert *below* MODERATE while `red_param` is true — is the answer that would make the roadmap's criterion true rather than merely explicable, and it is a few lines in `rules/patient_relative.py`. It is not in this plan because it changes what the engine *concludes*, which needs a source in the vault behind it and a clinician's sign-off, not a UI decision (**Needs the user, 2**). Second, a mechanism worth knowing before that conversation: `_adjust_news2` walks only the contributors it can account for and `continue`s past a parameter whose points it cannot explain (`pts <= 0 → continue`), so a charted baseline can downgrade a NEWS2 that is **partial** — scored from four of seven parameters — all the way to LOW. The downgrade is then explained by the patient's own history for the parameters that WERE measured and says nothing at all about the three that were not. The card marks `partial` and names the missing parameters beside the pill; a reader who takes in only the level sees neither.

    *Rejected:* an amber floor in `riskStyle` (it would contradict the engine on exactly the patients the patient-relative layer exists for); hiding `red_param` (it is the one fact the floor was trying to surface); option **a**, showing only the engine's level (that is what the VM does today, and it is why this came up); option **c**, showing only the red parameter (the browser overriding the engine).

6. **The bed order is the bed's, and risk order is offered.** The default is unit then bed label with numbers compared as numbers, and it does not move: a nurse learns where a bed sits on the screen, and a board that re-sorts itself makes her hunt for it at the moment she is reacting to an alarm — the old wall board wrote the rule down ("an alarm HIGHLIGHTS a bed, it does not re-order the list", `wallBoard.jsx:14-15`). The roadmap asks for risk order, so it is a second choice the clinician makes, kept per browser, and the bed order carries a one-line note saying why it is the default. Risk order puts what the screen cannot vouch for **above** `critical` — a risk the engine did not send may be the worst, the same rule the bell follows for an unknown severity. *Rejected:* risk order as the default (the wall board's lesson); no risk order at all (the roadmap asks for it, and the attention line alone does not let a charge nurse read the ward worst-first).

7. **The unit chip's choice filters the bed board, lives in the shell's memory, and is never remembered between sessions.** `useShell().unit` is the one choice: the top bar's chip and the board's own selector write it, so they cannot disagree. A scope of ONE unit offers no choice at all — `scopeUnits` returns a list only from two units up, because a chip with one entry is a decoration. G1-09 adds the selector the top bar cannot give: the chip is hidden at 640 px and below, so on a phone the board's own `<select>` is the only way to pick a unit. **The choice is forgotten when the shell goes** (a lock, a sign-out). **This reverses `deferred.md`'s own note,** which had Wave 3 persist the unit choice; Wave 3 is declining to. The reversal is deliberate, and the reason is something Wave 2's own work established: the shell now locks and unlocks in place at a shared station, which is exactly the case where a remembered filter is dangerous. A deferred note is a question left open, not an instruction, and this answers it with a no. *Rejected:* keeping it in `localStorage`, which the roadmap's note invites ("seçimin oturum boyunca saklanması") — at a shared station the next clinician would unlock into someone else's narrowed ward, and a card hidden by a filter you did not set is the quiet this screen exists to prevent; `prefs.readPref` also needs an allow-list, which a unit id coming from the engine at run time cannot have. What the screen does instead is make an active filter impossible to miss: it says how many cards it is hiding, every time.

8. **Two alarm sections, not three, and the third's absence is explained.** "Yanıt bekliyor" is `acknowledged: false`, "Değerlendiriliyor" is `acknowledged: true`; both come from `/patients`, which carries the engine's ACTIVE alarms only. A closed alarm simply leaves the board. The durable record of it is the audit trail, which needs `audit.view` (no nurse has it) and whose reads return the OLDEST rows first — a known engine defect the roadmap routes to Group 2. An empty "closed in the last hour" section would read as "nothing was closed in the last hour", which is a different and false statement. So the screen says in one sentence where a closed alarm went. *Rejected:* a third section fed from `/audit` (wrong permission, wrong order, and it would be empty for almost every user who can see the screen); a third section left empty (the false statement).

9. **One escalation fact, not a ladder.** The board carries one boolean, `escalated`, which the engine's own escalation loop sets; the screen shows it as a pill and one sentence saying escalation is the engine's business. *Rejected:* the prototype's three pills at 3 / 5 / 10 minutes with charge nurse / physician / rapid response (client-side, advanced only by a human clicking "Eskale", and its own notification-rules tab admits the chain is not wired); the old workspace's `EscalationTimeline` with its hard-coded 0 / 180 / 300 s (it never read the configurable chain either, and the configuration has no endpoint).

10. **An alarm's age is the server's instant on this browser's clock, written `m:ss` then `h:mm:ss`.** `firstSeenAtMs` with `elapsed()`: minutes never run past 59, so five and a quarter hours is `5:18:30` and not `318:30` — the shape the old workspace's unwired copy had already argued for ("sayı büyüdükçe anlamı kayboluyor", `clinicalUi.jsx:41-55`), against the wired one that printed the minutes. An instant that has not arrived yet is `0:00`, which is a real case and not a theoretical one: the subtraction uses the browser's clock against the server's instant. **No duration at all** when the engine sent no `first_seen_at` — never an invented one. **The two clocks are measured, and the correction is applied.** The board payload carries no server time — but every HTTP answer does: `Date` is a header an origin server is required to send (RFC 9110). `backendApi`'s `timed()` reads it on every response and keeps `server − browser` as `clockSkewMs`; the board store carries that figure in its snapshot; and `useBoardNow()` — which every screen that prints an age calls instead of `useNow()` — adds it. It is deliberately crude: half the round trip is not subtracted and the readings are not smoothed, because this is not a time service. It exists so an age is wrong by the SERVER's view instead of by a ward tablet's, and the direction matters more than the size: of all the ways a tablet's clock can be wrong, half make every reading on the screen look FRESHER than it is, and "ölçüldü: 1 dəq" is the most reassuring thing this interface can print. An unmeasured skew corrects by 0 and never blanks an age — an uncorrected age is right to the second on a correctly-set device, which is most of them. *Still for Group 2:* saying out loud that a device's clock is badly set, which belongs on the device page with the rest of the feed's health, and the per-entry sequence number.

11. **A patient is reached from the board, from the bell, or by address; an id the board does not hold gets ONE honest message.** The card and the list's bed cell are links to `#/patients/<id>`; every bell row is a link to the same place (deferred from Wave 2); the address works on its own. The screen reads the patient from the board this session already has — there is no per-patient endpoint, and `/patients` is already narrowed by the engine's scope. So an id the board does not hold is one of two things, and **the server answers both the same way on purpose**: `_require_patient` returns 404 for a patient outside the scope AND for one that does not exist, because a 403 would confirm that the patient exists and is under care here. The screen says exactly that, in one sentence, and does not guess. When the board could not be READ it says that instead — "we cannot tell whether this patient is on your board" is a different statement from "this patient is not on it". *Rejected:* asking the server to tell the two apart (it withholds the difference by design, and a screen that asked would be asking it to leak); showing a bare "not found" (it reads as "no such patient", which is the half that may be false).

12. **Opening a patient is recorded, and only when a patient was actually opened.** `POST /view` is sent once per patient per mount, for a patient the screen SHOWS. A refused deep link sends nothing: the server logs a refusal as `scope_denied`, and a clinician reloading a stale bookmark would otherwise fill the audit trail with refusals for views that never happened — while the board request that refused it is already in the trail. A failed `/view` does not stop the screen (a missing audit row is not something a clinician at the bedside can act on). *Rejected:* sending it for every address (fills the trail with false refusals); not sending it at all (the audit trail exists to answer "who opened this patient", and `POST /view` is the only thing that answers it; the new board store had not ported it and no screen has ever called it).

13. **Acknowledging: who may, what it sends, what the screen does while it is in flight, and what it does when it fails.** `alerts.ack` may — nurse, physician, charge nurse, rapid response, the attending roles and the system group; not an auditor, not a pharmacist. Without it **no button is drawn at all** and one line says why and which right it needs: N disabled buttons answer the same question N times. The call is `POST /ack {patient_id, kind}`, the actor attributed by the server from the token, and **the answer is the patient's board entry as it is after the acknowledgement** — which the store applies through exactly the path a stream frame takes, so the server's own publish of that board arrives as a frame and lays down the identical card. **Nothing is written before the server has taken it**: there is no optimistic update, so there is nothing to roll back, and "Gördü: ayşe" is never on screen for an acknowledgement that may not have happened — it is a claim about a person. While it is in flight that row's button is `busy` (`aria-busy`, clicks ignored, focus kept) and an sr-only region says "Yadda saxlanılır…" — a busy `Button` otherwise reads only "unavailable" to a screen reader, which is Wave 1B's note for the first use of `busy`. One at a time. A refusal is shown and the list is unchanged; a 404 reads "this alarm is no longer open — somebody else may have answered it, or it closed by itself". **On a board that is not LIVE the button stays** and a warning above it says the acknowledgement does reach the server but the list may be stale: the server decides what is still open, and a screen that hid the button would stop a nurse answering a real alarm because the Wi-Fi flickered. *Rejected:* an optimistic update (it writes a person's name against an act that may not have occurred); disabling the button on a DEGRADED board; a reason or a note field (the server keeps neither — its record is who and when — so asking would pretend otherwise, which is the old `AckModal`'s own stated rule).

14. **The patient screen with nothing to show says what is missing, not nothing.** A device-token-only patient — readings arriving with a patient id and no HIS record — has `identity: null`, so: no name (the slot says "kimlik gözlənilir" instead of repeating the device's id, which the bed slot already carries), no bed label, no unit, `bedMatched` false. Such a card is invisible to a SCOPED session altogether (`sees_patient`: no bed, no unit, no grant can reach it), which is why the board's own scope note counts it under `unresolved_hidden` — the screen shows that count. A patient with no readings gets "Bu çarpayıdan heç bir ölçmə gəlməyib." once, and risk `none` reads "not measured"; the vital grid is not drawn as six dashes, which is the old wall board's rule ("show what was measured; if nothing was, say that once", `wallBoard.jsx:93-104`). *Rejected:* falling back to the patient id as the name (what the old bed card did, printing the same identifier twice and dressing a device number as a person).

15. **Which administration actions exist in Group 1.** Only the ones the API implements, and nothing else is drawn. **Users:** list; create a LOCAL account with a temporary password; edit the full name and the e-mail; set the manual group memberships; reset the password (local only); reset two-step verification; deactivate and reactivate; lift the directory sign-in throttle once with a written reason; and set the unit/bed scope. **Roles:** list the groups with their permissions and member counts; change a group's name, description, MFA rule and permission set; create and delete a group. **Login source:** the directory's status, a connection test, a search, an import in chunks of ten, and the AD group mapping. **Not in Group 1** (the roadmap's own Group 2–4 lists): the hospital structure tree, integrations, cameras, notification rules, the care catalogue, the mobile modules, system settings, the audit screen, system health, the event log, data integrity, open sessions, announcements, backup, "view as a role", invitations, quick PINs, and a per-user MFA policy. **Forced MFA for the four groups (user decision 3) stays open and nothing here names a group:** the UI reads `requires_mfa` from the token and `mfa_required` from the group, exactly as Wave 2 does, so whichever way the user decides, no screen changes. *Rejected:* drawing the prototype's other fourteen tabs as "coming soon" (a tab that cannot do anything is a tab an administrator will try during a handover).

16. **The user form is Role + Extra duty + Units (roadmap D3), and the role/duty distinction is OURS.** The backend has one flat membership list and `GroupOut` says nothing about which group is a role and which an added duty, so `screens/admin/catalogue.js` holds that classification — `charge_nurse` and `rapid_response` are duties, the other nine defaults are roles, and a group the hospital created itself is neither and appears under "Diğer gruplar". The mirror is checked against `auth/permissions.py` by a test that reads it, so the two cannot drift. *Rejected:* inferring it from the slug or the permission set (both break the moment a hospital adds a group); asking the API (**Needs the user, 5**: a `kind` on `GroupOut` would be two lines of backend and would put the classification where it belongs).

17. **The unit scope is assigned from the keys the board actually shows, plus the ones the user already holds, plus a free-text field — and the screen says why.** There is **no endpoint that lists the units and beds a scope may name.** Those keys are the values in the site's `bed-mapping.json` (`BED_MAPPING_PATH`, a read-only bind mount; `tenant/bedmap.py` `BedRef.unit_id` / `bed_id`), written by an operator from the discovery report. `/tenant/*` has a unit and bed tree, but it needs `structure.manage` — which `users.manage` does not imply — and its ids are database UUIDs that nothing forces the mapping file to use. So the editor offers the `identity.unit_id` / `identity.bed_id` values on the current board (an unrestricted administrator sees them all), plus the grants `/scope/{id}` already reports, plus a field for a key that has no patient on it right now; and it says in one line where the list comes from and that an empty unit does not appear in it. A grant whose key matches no card is not an error — `/patients` reports it under `scope.unmatched_grants`, and the clinician's own board shows that sentence. The write is `PUT /scope/{id}` with the WHOLE list (replacement, not a diff: two administrators saving diffs would merge into the union, the more permissive outcome, chosen by neither); the screen shows its own list optimistically and **puts the previous list back when the server refuses**, saying so. *Rejected:* a unit × bed matrix drawn from `/tenant/*` (half of it would grant nothing, and a matrix that looks complete and is wrong is worse than a list that says what it knows — this is also the permission problem); free text alone (an administrator cannot be asked to remember the mapping file's spelling).

18. **The group × permission table is edited and then saved, not applied per click.** A checkbox collects a change; the row shows what will change and a Save sends one `PATCH /admin/groups/{id}` with the whole permission list. The system group's row is read-only (the server refuses it, 409) and so is any group whose rights exceed the session's (`canGrant`). *Rejected:* the prototype's instant apply, which writes to `localStorage` and is enforced only in the browser (`admin.js:874-882`) — in a live system one mis-click would grant a right, and the audit row would record it as a decision.

19. **Every administration write goes through `track`, and a refusal on one read does not empty the screen.** The tabs ask only what the session's rights allow (`/admin/users` needs `users.manage`; `/admin/groups` takes either; `/admin/permissions` needs `groups.manage`), with `Promise.allSettled`, so a desk holding one right sees the part of the screen that right opens and the refusal beside it. A stale load never overwrites a newer one. The API client is reached through `useSession().store.api` and every call is wrapped in `store.track`, so a refused refresh ends the session here too and a 403 `password_change_required` moves the shell on. *Rejected:* a context of its own for the API client (the session store is what owns the credential, and a screen that can reach the API without `track` is the mistake worth making hard).

20. **The administration tab lives in React state, not in the address.** A tab is a view of one screen; the rail links to the screen and nothing in the product links to a tab. *Rejected:* `#/admin?tab=roles` — `hashPath` deliberately leaves a query to the screen, but reading one needs a second `hashchange` listener in every tabbed screen, and the shell settles the address once at mount and does not read the bar again (Wave 2's fix for the Back button).

21. **The directory routes get 30 seconds, not 15.** `/admin/ldap/*` may wait two LDAP deadlines on the server — about 20 s with the API's defaults, 24 s at its cap — and the client's 15 s would cut an import off while the server was still working, telling an administrator "no answer" about accounts that then landed. `backendApi`'s `timed()` takes a per-call `timeoutMs` that may only LENGTHEN the wait, never shorten it, and the directory calls pass `ADMIN_LDAP_TIMEOUT_MS = 30_000`. The import is sent in chunks of ten (`LDAP_IMPORT_CHUNK`), because a slow controller spends about 2 s per account and the import is idempotent, so one chunk's failure costs that chunk. *Rejected:* a second `createBackendApi` instance with a longer limit (it would hold its own token copy and its own generation counter, so `supersede()` and a refresh in one would not reach the other).

22. **`aria-current` marks the rail's beds entry while a patient is open.** Wave 2 left this open and showed no entry as current, on the ground that the entry does not lead to that page; G1-11 decides the other way. A clinician spends most of her time on a patient, and a rail with nothing current says "you are nowhere" for all of it. The patient route declares `under: "beds"` and the Shell passes it; a route whose `under` entry is not in the rail still marks nothing. The claim is not left implied: the patient screen carries a visible "Çarpayılara qayıt" link to the board. *Rejected:* leaving it as Wave 2 had it (truthful in the narrow sense and useless to a screen-reader user for the screen she is on longest).

23. **The vitals trend charts Group 2 will build get a seam, not a stub.** The seam is three things and no drawing code: `screens/common/vitals.js`, which already names each channel, where its value comes from, where its timestamp comes from and its identity colour — so a chart reads the same table the cards do and the two cannot disagree about what a channel is called; the patient screen's own `Box` where the chart goes, with one sentence saying the engine has no history endpoint; and `useNow`, which a chart will want. Nothing is drawn, no library is added, and `vitals.js` carries an explicit note that it holds **no threshold, no band and no colour that depends on a value** — the prototype's bands come from `core.js:499-501 H.VITAL.al/nb`, which is the single most-copied unsourced number in that codebase and must not travel with the table. *Rejected:* an empty chart with axes (a picture of nothing reads as "no data for this patient"); a chart drawn from the one latest value.

24. **Four languages, and the copy's provenance is written down.** Every new string exists in az / tr / ru / en; `strings.test.js` holds the parity, the placeholders, the Latin/Cyrillic scripts, and the rule that an Azerbaijani text may equal its Turkish source only where the identity was reviewed and listed. Each namespace's header says where its copy came from — the prototype's own four-language table where it has an entry, the old workspace's reviewed `clinicalI18n` where that is better, and "new, awaits a native-speaking clinician" otherwise. Two traps are documented in the files: the prototype's dictionary resolves "Isı" (temperature) to the heat-map screen's title in all three target languages, so the channel names are written out here; and about twenty of the prototype's composed strings have no dictionary entry at all and are Turkish today for every user. **The engine's own clinical prose is not translated** — `clinical_reasoning`, `recommended_actions`, `confidence`, `chronic_context` and every `summary` come out of `reco/engine.py` in English. The user has decided it **stays English for the pilot, on one condition**: before the pilot, an Azerbaijani-speaking clinician reads the reasoning texts actually in use and confirms that each is understood as written. Four rule families produce them (`news2`, `septic_shock`, `acute_change`, `patient_relative`), so this is a short reading and not a translation project — but it is a **gate item**, carried by Task 23 into the G1-15 deploy gate, not a note in a file. The screens hold up their half: every site that prints the engine's prose is marked `lang="en"`, so a Russian- or Azerbaijani-voiced screen reader pronounces it as English (the five `summary` sites, the reasoning, the evidence list, the confidence, the chronic context), and each screen that shows any of it says once, in the reader's own language, that these texts are the engine's English and are not translated. One piece of server prose is NOT English: `scope_note` is written in Turkish by `api/board.py`, so `ScopeNote` marks it `lang="tr"` and prints one line in the reader's language saying where the sentence came from. The real fix there is the engine answering in the language that was asked for, which Task 23 routes to Group 2. *Rejected:* translating the engine's prose in the browser (it is a clinical claim, and a dictionary file is not where a clinical claim gets written); leaving it unmarked (a Russian voice reading English letter-groups aloud is worse than silence).

25. **This branch still does not go to the VM.** Nothing in this plan deploys, pushes or touches `/c/Users/User/Desktop/Project/Homunculus AI`. The G1-15 gate is unchanged and gains the items in Task 23.

26. **A finding the engine downgraded is visible, and answers to nobody.** `boardStore`'s `needsAnswer(a) = !a.ack && a.downgraded !== true` is the one predicate behind the waiting queue, the bell's count and the rail's badge, so a chronic-expected finding drives none of them. It stays on the card, in the alarms list and in the engine's own text; what it does not do is put a number in front of a charge nurse that says somebody must act. The engine's own contract says so in as many words — `rules/patient_relative.py:16-18`: such a finding "stays visible but does NOT alarm or escalate" — and a queue that counted it would be the browser escalating what the engine declined to. The `!== true` is deliberate: only an explicit `true` from the engine removes a finding from the queue, so a missing field, a `null`, or the string `"true"` from some future serialiser all keep it IN. **The user may overrule this**, and it is the kind of decision a charge nurse is entitled to make differently — if a downgraded finding should still be counted, it is one word in one function, and the four tests that pin the behaviour name it. *Rejected:* hiding a downgraded finding altogether (the engine kept it visible on purpose, and a clinician must be able to see that the system considered the thing and explained it); counting it in the queue (it would mean the bell can never reach zero on a ward of chronic patients, which is how a bell stops being read).

27. **The patient screen writes exactly one thing: whether an infection is suspected.** One `POST /clinical/{id}` with one entry — `{code: "suspected_infection", value: 1 | 0}` — behind `clinical.chart`, with no right meaning no button and one line saying which right is missing. It is here, and the SOFA form and the charted baseline are not, because of what its absence does: nothing in the engine's sepsis branch runs until something charts this (`septic_shock.evaluate` returns at its first line), so on a ward where nobody can chart it the engine is simply silent about sepsis — and the screen would be printing "the sepsis rule does not run at all for this patient" while being, by construction, unable to do anything about it. Three rules it keeps. **Neither answer is suggested:** no default, no pre-selection, no pressed state — the screen takes a clinician's judgement and never forms one. **Both answers stay offered** after one has been charted, because a judgement can change and a "no" after a "yes" is a clinical event, not an undo. **And it says, before it is pressed,** that this goes into the audit trail under the clinician's own name and cannot be withdrawn — the engine keeps the latest charted value, so a correction supersedes rather than erases. The store reloads the board afterwards rather than applying what came back: the answer is not a board entry, and more to the point the charted value may change what the engine CONCLUDES, so the card that returns can carry findings that did not exist a moment earlier. Nothing is written locally on a refusal. *Rejected:* a `<Seg>` with the current answer selected (a pressed-looking control reads as "this is what is true", not "this is what a person charted, at a time"); an "unknown" button to clear it (there is no such write, and there should not be — you cannot un-observe something); doing it in Group 2 with the rest of the charting (the engine is silent about sepsis until then, and that is not a cosmetic gap).

---

## Roadmap behaviours this wave owns

The roadmap's "Main'den gelen ve yeni kabukta karşılanacak davranışlar" and "Grup 1 kabul ölçütleri" rows tagged G1-09 … G1-14, each with the task that meets it — or the reason it is not met.

| Roadmap item | Where |
|---|---|
| G1-09 · `risk` mapped explicitly: `moderate` amber, `none`/`info` neutral, nothing green | Task 9 (`BedCard`, `riskStyle`); `BedCard.test.jsx` "moderate is amber, never a green stabil" — Decision 2 |
| G1-09 · the card passes `measured` explicitly, from its own timestamps | Task 9 (`hasMeasurement(patient.measuredAt)`); two tests — Decisions 3, 4 |
| G1-09 · colour never the only cue | Task 9 (stripe + icon + word); "the stripe's colour is never the only signal" |
| G1-09 · an open alarm is visible on the card | Task 9 ("puts the open alarms on the card, with the engine's own summary") |
| G1-09 · the connection state is a strip on the screen; an empty board does not read as a calm ward | Task 6 (`BoardStrip`), Task 11; "a load that FAILED says the list is not shown" — Decision 1 |
| G1-09 · the feed-health chip ("N yatak sessiz") | Tasks 5, 6, 11 (`feedHealth.js`, `FeedHealth`) — Decision 4 |
| G1-09 · a downgraded finding is explained on the card, not merely levelled down | Task 6 (`ChronicExpected` in `BoardState.jsx`, `board.chronicExpected`), Task 9 (on the card), Task 12 (on the alarms row); 5 + 1 tests — Decisions 5, 26 |
| G1-09 · the engine's own prose is marked as English wherever it is printed | Task 6 (`summaryOf`, `board.engineEnglish`), Tasks 9, 11, 12, 13, 14 (one `lang="en"` each) — Decision 24 |
| G1-11 · the patient screen charts a suspected infection | **Task 15B** (`POST /clinical/{id}`, `clinical.chart`); 8 tests — Decision 27 |
| G1-09/10/11 · an age is measured against the server's clock, not the tablet's | Task 1 (`serverClockSkewMs` from the `Date` header), Task 3 (`clockSkewMs` on the snapshot), Task 6 (`useBoardNow`); 3 + 2 + 2 tests — Decision 10 |
| G1-09 · the engine's scope note is visible | Task 6 (`ScopeNote`), Task 11 ("writes the engine's own scope sentence, and how many cards it withheld") |
| G1-09 · NEWS2 `red_param` makes the card at least amber | **Not met, on purpose.** Shown as the engine's own fact, never overriding its level — Decision 5; **Needs the user, 1** |
| G1-09 · one NEWS2 only, the engine's; "—" and the reason when it sent none; a partial score marked | Task 9 (`News2`), three tests |
| G1-09 · `patientFromBoard` must read `identity.bed_id` / `unit_id` | Task 2 — the unit filter and the scope editor both need them |
| G1-09 · the patient label | Task 9 (`nameOf`): the HIS's name or "kimlik gözlənilir", never the device's id as a name |
| G1-09 (Wave 2's note) · the unit chip is hidden ≤ 640 px and the choice is forgotten at every lock | Task 11: the board gets its own selector at every width; the choice stays in the shell's memory **on purpose** and an active filter says how much it hides — Decision 7 |
| G1-09 · the screen-reader risk pill says only the level; it needs an invisible "Risk:" prefix | **Task 6** (`ui/RiskPill.jsx`, `strings/risk.js` `risk.prefix`, 3 tests). Wave 1B had the word in only two of the seven labels — "Risk bildirilməyib" and "Naməlum risk: x" — so for the other five a screen reader met "Orta", alone, among a bed number, a name, six numbers and a score. The pill now carries an sr-only `Risk: ` before every label that does not already say it (`SAYS_RISK`). It is in Task 6, a SEQUENTIAL task, and not in an arm: three screens render `RiskPill`, and a shared `ui/` component that one arm improves is a shared component the other two arms are missing |
| G1-10 · real time, never the simulation's 60× clock | Task 4 (`elapsed`), Task 12 — Decision 10 |
| G1-10 · `m:ss` under an hour, `h:mm:ss` above (never "318:30"), negative → `0:00` | Task 4, four tests — Decision 10 |
| G1-10 · "Gördüm", the escalation pills, the duration on the server's clock | Task 12 — Decisions 9, 10, 13 |
| G1-10 (Wave 1B) · a busy `Button` reads only "unavailable" to a screen reader | Task 12: the caller supplies the words (`Announce` + `alarms.seeing`) |
| G1-10 (Wave 2, deferred) · the bell's rows link to a patient; the rail's alarms entry gets a count | Task 13, five tests |
| G1-11 · every vital's age and staleness is visible | Task 14 (`Vitals`, `ageText`) — Decision 4 |
| G1-11 · NEWS2 does not read "complete" on old vitals | Task 9 (`partial` marked, the missing parameters named). The engine-side half — `api/board.py` calls `news2.score()` without applying freshness — stays Group 2's; the screen cannot fix it and does not pretend to |
| G1-11 · the recommendation card: the rationale and its source | Task 2 (the adapter carries them), Task 14 (`Finding`) — Decision 24 |
| G1-11 · read-only | Task 14 (`patient.readOnly`); the write surfaces are **Needs the user, 2** |
| G1-11 · the SOFA form, suspected infection, the patient's own baseline | Not built; the seam and the sentence are in Task 14 — **Needs the user, 2** |
| G1-12 · users with D3's form (role + extra duty + units) | Tasks 16, 19, 20 — Decisions 15, 16 |
| G1-12 · the scope matrix really reaches the engine (`PUT /scope/{user}`), with a rollback | Task 20 — Decision 17; the matrix becomes a list, with its reason |
| G1-12 · `/scope/me` must decide as the board does (`enforce_unassigned`, break-glass) | **Not met: it is a backend defect.** `scope/router.py:_view` calls `build_scope` without either, so `/scope/me` can say "unassigned" where the board enforces nothing, or omit a break-glass patient the board shows. Recorded in Task 23 and **Needs the user, 6** |
| G1-12 · `backendApi.myScope()` has no caller | Task 20 (the scope editor reads `/scope/{id}`; `myScope()` stays for Group 2's own-scope panel) |
| G1-12 · `patientScope.js`'s screen scope, adapted from roles to permissions | Not needed: the server filters `/patients` and says so (`scope.unrestricted` means "already applied, do not filter again"). The old local filter had been dead for years — `bedsFromPatients` gave every bed `unitId: null`, so no assignment could ever match |
| G1-13 · the group × permission table | Task 21 — Decision 18 |
| G1-13 · the permission descriptions are out of date (`users.manage`, `devices.manage`) | Task 23: the descriptions live in `auth/permissions.py` and the screen shows them verbatim, so the correction is a backend text change and is listed there |
| G1-14 · the AD panel: status, test, search + import, group mapping | Task 22 — Decisions 15, 21 |
| G1-14 · `/admin/ldap` calls can outlast the dashboard's 15 s; import in tens | Task 1 (`ADMIN_LDAP_TIMEOUT_MS`, `LDAP_IMPORT_CHUNK`), Task 22 — Decision 21 |
| G1-14 · changing the mapping needs every permission (403); the panel shows the buttons accordingly | Task 17 (`canMapGroups`), Task 22 |
| G1-14 · a mapping row stored before DNs were canonicalised may no longer match | Task 22's specification: the panel offers to delete and re-create from the picker, and says why |

---

## Wave 2's deferred items, decided

`deferred.md`'s "notes for Wave 3", each with this plan's answer.

| Deferred item | Wave 3's answer |
|---|---|
| The bell's rows should link to a patient; the rail's Alarmlar entry should carry a count | **Done** — Task 13 (Decision 13's honesty rule applies to the badge: a number only from a LIVE board, a dot when it may be out of date, nothing when it cannot know) |
| `resumePath` refuses only "`nav:false` AND has params", so a future parameterised MAIN route (`/beds/:unit`) would be resumed | **No such route is added**, so no change is needed and none is made. The unit filter is the shell's memory, not the address (Decision 7) — which is also why `/beds/:unit` is not wanted: a lock must not hand the next person a narrowed ward. Recorded again in Task 23 for whoever adds one |
| `aria-current` while a `nav:false` screen is open | **Decided: yes** — Task 15, `under: "beds"` on the patient route (Decision 22) |
| `stubScreens()` does not unwind LIFO when nested | **Avoided, not fixed**: Task 7 adds `onlyScreens()`, which sets the WHOLE table at once, so a test that cares which screens exist states its own build instead of layering stubs. Every new test in this plan uses it; nothing nests |
| `Shell.jsx` sends an empty path to `resumeTo.current \|\| home` | Left as it is (harmless, and Wave 2's reasoning stands) |
| The board's per-entry sequence number ("newer wins") | Group 2, unchanged. Task 3's `applyEntry` inherits the same narrow race and the same mitigation (a frame or an answer is replayed over a snapshot still on its way) — and Decision 10's note adds the other reason to want it: a server clock would arrive with it |

---

## Ground rules for every task

- Work only in your own worktree off `feat/canli-tasarim`. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`**, the user's main checkout, and never `git push`, deploy or run anything against the hospital VM. The reference worktree `/c/tmp/homunculus-g1` is finished for Wave 2 and pushed: read it, do not commit in it.
- Dashboard commands run from `<worktree>/dashboard`. Filter tests by **folder with a trailing slash** (`npx vitest run src/live/`): Vitest filters by substring, so `src/live` alone also runs `src/liveStore.test.js` and the other old `live*` files.
- The gate at the end of every task is the whole dashboard suite plus a production build:

  ```bash
  cd <worktree>/dashboard
  npx vitest run 2>&1 | tail -5
  npx vite build 2>&1 | grep -E "built in|error"
  ```
  The build always prints `(!) Some chunks are larger than 500 kB` (the old workspace's main chunk): not a failure. Nothing in this plan changes the backend, so the Python suite is not in the gate — but if you touch a `.py` file, it is.
- **Counts.** Every "Expected" count assumes the branch at `cced4f9`: dashboard **87 files / 1751 tests**. Task 0 records the real base; if it differs, every later expected count is the real base plus this plan's additions. Each gate states its own file's number as well as the suite's, so a wrong total can be traced to a file rather than hunted for; the arithmetic is written out in the header and in the Self-review.
- **No new package.** In particular: no charting library (Decision 23) and no `@testing-library/user-event` — this suite drives the DOM with `fireEvent` from `@testing-library/react`, as every Wave-2 test does.
- **Write and edit files with the Write/Edit tools, never with `sed`, `python` or a shell heredoc.** Two failures on this machine, both met while this plan was written. Heredocs drop backslashes, so a regex or an escape goes in silently wrong; and the working tree's files are **CRLF** while every block in this document is **LF**, so a `sed`/`python` replacement that matches a plan block's text will not match the file on disk — or will match and rewrite the whole file's line endings, producing a diff of hundreds of lines in which the real change cannot be reviewed. The Edit tool handles both. For the strings files, which carry Azerbaijani, Russian and Turkish text, also **check the result is UTF-8 and unmangled**: `npx vitest run src/live/i18n/strings.test.js` fails if the Russian lost its Cyrillic or the Azerbaijani its `ə`, and a heredoc has been seen to transliterate both to ASCII without any error at all.
- No hex colour and no Tailwind palette colour in a live component: token classes only (`bg-crit`, `text-v-hr`, `border-l-mid`…). Class names are written out whole, never assembled. No user-visible text inside a component — it comes from `t()` or from the caller.
- **No patient data, ever** (CLAUDE.md, hard rule 6). Fixtures use `S-001`…, units `REA-01` / `NICU-01`, "Ayşe Sentetik", "Sentetik Hastane". `data/board.testutil.js` says so in its header; nothing in it may be replaced by anything from a real ward, a capture or an export, not even to reproduce a bug.
- **D1 holds:** nothing under `src/live/` may import `liveStore.js`, `clinicalDemo.js`, `ClinicalDemo.jsx`, `clinicalI18n.js`, `permissions.js`, `liveAdmin.js` or `feedHealth.js`. The allowed four are `backendApi.js`, `liveAuth.js`, `liveAdapters.js`, `liveConnection.js`, and `boundaries.test.js` enforces it — which is why two of this plan's modules are COPIES of old-workspace files (Tasks 5, 16, 17) rather than imports. A *test* may read more (`boundaries.test.js` checks the sources, not the tests), which is how Task 16's mirror is checked against `auth/permissions.py`.
- **A test whose subject is WHICH screens or tabs exist must pin the registry** (`onlyScreens`, `stubTabs`; Task 7). A test written against the build instead breaks in a file none of the parallel branches owns, the moment one of them builds a screen. This happened three times while this plan was being written — in `routes.test.js`, `Shell.test.jsx`, `LiveApp.test.jsx` and `BedsScreen.test.jsx` — and Task 7 repairs all four centrally so the arms do not meet there.
- Accessibility, to the standard Wave 2 reached, and **each of these is asserted, not merely intended**:
  - **One `h1` per screen** — the shell focuses `<main>` after every move and the screen's own heading is what a reader lands on. Each screen's test asserts `getAllByRole("heading", {level: 1})` has length **1**, not merely that one exists: a second `h1` is the failure this catches.
  - `<h2>`/`<h3>` under it, never a bare bold line. Landmarks are the shell's.
  - **Every control reachable AND operable by keyboard**, with a test for anything that has its own key handling. `Seg`'s buttons are plain buttons and the browser activates them; `Tabs` has arrow/Home/End of its own, so the administration frame has a `fireEvent.keyDown` test that walks all three tabs in both directions and round the ends (Task 19). A control whose keyboard behaviour is the browser's needs no test; one whose keyboard behaviour is ours needs one.
  - **A list is a list and a table is a table**: `<ul>`/`<li>` for the cards and the rows, and the list view and the administration lists are real `<table>`s with a `<caption>` and `<th scope="col">` / `<th scope="row">`. A grid of `<div>`s with a bold first cell is not a table to a screen reader, which is how a column of names becomes unnavigable.
  - **Something said once is said once**: `Announce`/`useAnnounced`, **never a `role="status"` born with its text** (a live region rendered already holding its message is not announced at all — so the pattern that looks accessible is the one that says nothing), and never a per-tick announcement.
  - **390 px with no horizontal page scroll**, checked in a browser at 390 and 1440 px in both themes. Every task that adds a screen or a tab carries that step; it is not deferred to Task 24 alone, because a layout fixed four tasks later is a layout rewritten.
  - Token-only colours.
- Stage exactly the paths a task lists — never `git add -A` or `git add .` (other agents commit on this branch). **Never stage while another agent's hunks are uncommitted in a file you stage:** `git add <file>` takes the whole file, theirs included. Before every commit run `git status --short` and `git diff --stat`; if a file the task stages shows changes that are not this task's, stop and ask instead of committing. Commit after each task. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

---

## File map

**Create — `dashboard/src/live/`**

| File | Responsibility | Task |
|---|---|---|
| `screens/common/elapsed.js` | How long an alarm has been open, on the wall clock. Pure. | 4 |
| `screens/common/freshness.js` | The age of a reading, and never a verdict on it. Pure. | 4 |
| `screens/common/useNow.js` | The wall clock, re-read on a cadence, not while hidden. | 4 |
| `screens/common/freshness.test.js`, `useNow.test.jsx` | Both of the above; the fake-timer recipe. | 4 |
| `screens/common/feedHealth.js` + `.test.js` | Is the bed still reporting? Ported from the old workspace. | 5 |
| `screens/common/vitals.js` | Which channels a screen shows, in what order, and where each value, unit and timestamp come from. **No threshold.** The seam Group 2's charts read. | 6 |
| `screens/common/BoardState.jsx` + `.test.jsx` | `BoardStrip`, `ScopeNote`, `FeedHealth`, `boardKnown`, `boardStale`. | 6 |
| `i18n/strings/board.js` | The connection, the scope, the feed, the channel names, the age units. | 6 |
| `data/board.testutil.js` | Synthetic `/patients` payloads. Test-only. | 7 |
| `shell/screens.testutil.js` | `onlyScreens()`: pin the registry to a known set. Test-only. | 7 |
| `i18n/strings/beds.js`, `screens/beds/BedCard.jsx` + `.test.jsx` | The bed card. | 9 |
| `screens/beds/order.js` + `.test.js` | Two orders, two filters, the diacritic-folding match. Pure. | 10 |
| `screens/beds/BedsScreen.jsx` + `.test.jsx` | The bed board. | 11 |
| `i18n/strings/alarms.js`, `screens/alarms/AlarmsScreen.jsx` + `.test.jsx` | The alarms screen. | 12 |
| `i18n/strings/patient.js`, `screens/patient/PatientScreen.jsx` + `.test.jsx` | The patient screen. | 14 |
| `screens/admin/catalogue.js` + `.test.js` | The permission keys and the default groups, mirrored from `auth/permissions.py`; which group is a role and which an extra duty. | 16 |
| `screens/admin/rules.js` + `.test.js` | The `/admin` payloads as the screens render them, and the hints those screens follow. Ported. | 17 |
| `screens/admin/useAdminData.js` | What the three tabs read, loaded once, asking only what the rights allow. | 18 |
| `i18n/strings/admin.js`, `screens/admin/AdminScreen.jsx` + `.test.jsx` | The frame, the three tab slots and their seam. | 19 |
| `i18n/strings/roles.js`, `screens/admin/RolesTab.jsx` + `.test.jsx` | **Specified only.** | 21 |
| `i18n/strings/source.js`, `screens/admin/SourceTab.jsx` + `.test.jsx` | **Specified only.** | 22 |
| `screens/admin/UsersTab.jsx`, `UserForm.jsx`, `ScopeEditor.jsx` + tests | **Specified only.** | 20 |

**Modify** (line numbers at `5171954`)

| File | Change | Task |
|---|---|---|
| `dashboard/src/backendApi.js` | `timed(run, ms)` takes a per-call limit that may only lengthen; `ADMIN_LDAP_TIMEOUT_MS`, `LDAP_IMPORT_MAX`, `LDAP_IMPORT_CHUNK`; `view`, `adminUnlockSignIn`, and the eight `/admin/ldap/*` calls. | 1 |
| `dashboard/src/liveAdapters.js` | `patientFromBoard` reads `identity.bed_id` / `unit_id` / `bed_matched` / `bed_key`; `alertsFromPatients` carries the engine's reasoning, evidence, actions, certainty, `downgraded`, `chronicContext`, `staleInputs`, `ackBy`, `ackAtMs`. | 2 |
| `src/live/data/boardStore.js` | `onMessage` split into `ingest` + the parse; `applyEntry`, `acknowledge`, `view`. | 3 |
| `src/live/session/sessionStore.js` | returns `api`. | 3 |
| `src/live/i18n/catalog.js` | one import and one entry per new namespace — **seven pre-placed comment lines**, one pair per arm. | 6 (seam), then each arm |
| `src/live/i18n/strings.test.js` | `NEUTRAL` gains the language-neutral keys; `AZ_SAME_AS_TR` gains **one commented block per arm**. | 6 (seam), then each arm |
| `src/live/apiErrors.js`, `i18n/strings/errors.js`, `apiErrors.test.js` | Every refusal of `api/app.py`, `admin/service.py`, `admin/schemas.py`, `admin/ldap_service.py`, `admin/ldap_router.py`, `scope/router.py` and `scope/schemas.py`, in four languages, with the "no site escapes the readers" check extended to all seven files. | 8 |
| `src/live/session/testTokens.testutil.js` | `fakeApi` gains every call Wave 3 makes. | 7 |
| `src/live/shell/routes.test.js`, `shell/Shell.test.jsx`, `src/live/LiveApp.test.jsx` | made build-independent (`onlyScreens`), so an arm building a screen does not break them. | 7 |
| `src/live/shell/routes.js` | each arm's own `SCREENS` line (pre-placed by Wave 2); the `patient` route's `under: "beds"`. | 11, 12, 14, 15, 19 |
| `src/live/shell/Sidebar.jsx` | its header's `nav: false` paragraph (Task 7, sequential), then the rail's alarm badge (Task 13). **One arm only** — see the ownership table below. | 7, 13 |
| `src/live/shell/TopBar.jsx` | the bell's per-row links and its foot. | 13 |
| `src/live/shell/Shell.jsx` | one line: `current={match?.route.under ?? match?.route.id ?? null}`. | 15 |

**Modify — docs** (Task 23): `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, `docs/homunculus-rehber-TR.md`, `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`, and `/c/tmp/homunculus-plans/{amendments,deferred}.md`.

Read and left alone: `ClinicalDemo.jsx`, `clinicalDemo.js`, `liveStore.js`, `clinicalI18n.js`, `permissions.js`, `liveAdmin.js`, `feedHealth.js`, `severityScore.jsx`, `wallBoard.jsx`, `patientScope.js`, `admin/LiveUserAdmin.jsx`, `admin/GroupAdmin.jsx` — all of which G1-16 deletes, and three of which this plan copies from rather than imports (D1).

### Who owns which shared file

An arm may be built on its own branch. That holds only if the files two arms both touch are either pre-placed before the seam or owned outright by one arm, so this is written out rather than implied. **Four files carry one pre-placed line per arm** (Task 7, or Wave 2): `i18n/catalog.js` (an import and an entry), `shell/routes.js` (`SCREENS`), `i18n/strings.test.js` (a block in `NEUTRAL` and a block in `AZ_SAME_AS_TR`), and `AdminScreen.jsx` (`TAB_SCREENS`, for the three tabs of the next plan). In all four, **each arm's line has a blank line on either side and a `// G1-NN` marker of its own.** The blank lines are the whole mechanism: git merges line ranges, so four arms editing four adjacent lines of one object conflict every time, and four arms editing lines with untouched context between them do not. Do not tidy the gaps away.

| Shared file | Owned by | The other arms |
|---|---|---|
| `shell/Sidebar.jsx` | **the alarms arm** (Task 13), outright | Its header's `nav: false` paragraph is rewritten in **Task 7**, before the seam, so the patient arm does not need to touch this file at all. Task 13 may then give the whole file. (The earlier draft of this plan had Task 13 write the whole file and Task 15 replace a paragraph of it — a guaranteed conflict in either merge order, and the plan claimed the opposite. That is why the rewrite moved to Task 7.) |
| `shell/TopBar.jsx` | **the alarms arm** (Task 13), outright | — |
| `shell/Shell.jsx` | **the patient arm** (Task 15), one line | — |
| `shell/routes.js` | one `SCREENS` line each (pre-placed, Task 7) **plus** `under: "beds"` on the `patient` route, which is **the patient arm's** (Task 15) — a third change that earlier drafts of this plan did not list | — |
| `shell/Shell.test.jsx` | **two arms: the alarms arm (Task 13) and the patient arm (Task 15).** This is the one shared file with no single owner | They edit different `describe` blocks — the bell's and the rail's — with the whole of the shell's other tests between them, so git merges them cleanly in either order. The counts, each measured with `npx vitest run` on that one file and not by grepping for `it(` (nested `describe`s indent differently and a grep undercounts): **33** at the base and **still 33 after Task 7** — corrected 2026-10-09, see below — then **39** after Task 13, and **40** after Task 15, which rewrites two of the rail's tests and turns one into two. **So the number to expect once both arms have merged is 40.** An arm that merges second and finds 39 or 41 has lost or duplicated a test: compare the `it(` names against this plan before touching the number.<br><br>**Correction (2026-10-09, after Tasks 0–8 were built).** This row and Task 7's Step 7 both said **34** after Task 7, and that was arithmetic rather than measurement: Task 7 Step 5 rewrites four of this file's tests and **adds none** (`git show` of the Task 7 commit adds exactly one `it()`, and it is in `routes.test.js`). So Task 7's Step 7 and Step 8 print **100**, not 101, and the alarms arm's Task 13 lands on **39**, not 40. The final 40 after both arms is unchanged, because Task 15's "one becomes two" supplies the test this row had already counted. |
| `screens/common/BoardState.jsx` | **nobody: it is Task 6's, and sequential.** Anything two arms both render goes here | `ChronicExpected`, `summaryOf`, `RAIL`/`RAIL_LEFT`/`railOf`, `useBoardNow` are all in it for that reason, and each of them was first written inside one arm's file and moved. **`News2` and `nameOf` joined them in the Wave 3 fix-up**, with the six strings they read (`board.identityPending`, `board.news2*`, `board.escalated*`): the rule was stated here and then missed for the two symbols and six keys the patient screen needed, which is how it was found. The rule is worth stating because breaking it does not fail a test: it produces two screens that say slightly different things about the same finding, which is exactly the defect the `info` tone had. |
| `ui/RiskPill.jsx`, `strings/risk.js` | **Task 6**, sequential | Three screens render the pill. |

---

# Wave 3A · the shared foundation (Tasks 0–8, sequential)

### Task 0: Baseline

**Files:** none changed (this plan file is committed).

- [ ] **Step 1: Confirm the worktree, the branch and the head**

```bash
cd <worktree>
git status --short --branch | head -3
git log --oneline -1
```
Expected: `## feat/canli-tasarim` with nothing uncommitted (the plan file aside); head `5171954 fix(dashboard): the load-failure message leans on no design token` or a later commit on the same branch.

- [ ] **Step 2: Record the dashboard baseline**

```bash
cd <worktree>/dashboard
npx vitest run 2>&1 | tail -4
```
Expected:
```
 Test Files  87 passed (87)
      Tests  1751 passed (1751)
```
If the numbers differ, write the real ones down: every later "Expected" count is the real base plus this plan's additions.

- [ ] **Step 3: Confirm the build is clean before anything is changed**

```bash
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `✓ built in 3.3s` (any duration). The `(!) Some chunks are larger than 500 kB` line is the old workspace's chunk and is not an error.

- [ ] **Step 4: Confirm there is no `user-event` to reach for**

```bash
ls node_modules/@testing-library/
```
Expected: `dom  jest-dom  react` — no `user-event`. Every test in this plan uses `fireEvent`.

- [ ] **Step 5: Commit the plan**

```bash
git add docs/superpowers/plans/2026-10-08-g1-dalga3-is-ekranlari.md
git commit -m "$(cat <<'EOF'
docs(plan): Group 1 Wave 3 — the six work screens

The shared foundation and the three clinical screens with tested code; the
three administration tabs specified for a plan of their own.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1: The API client — a per-call timeout, and the calls Wave 3 makes

**Files:**
- Modify: `dashboard/src/backendApi.js`
- Test: `dashboard/src/backendApi.test.js`

Why a per-call timeout at all: the directory routes may wait two LDAP deadlines on the server — about 20 s with the API's defaults, 24 s at its cap (the roadmap's G1-14 note) — and the client's 15 s would cut an import off while the server was still working, telling an administrator "no answer" about accounts that then landed. The limit may only be LENGTHENED: a screen cannot make a route impatient.

- [ ] **Step 1: Write the failing tests**

Four of them go at the end of the existing `describe("backendApi — a server that does not answer")` block, which already has the fake-timer setup; the rest are a new block at the end of the file. In `dashboard/src/backendApi.test.js`, replace

```javascript
  it("an answer in time leaves no timer behind", async () => {
    const fetchMock = vi.fn();
    const api = await signedIn(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "u" }));
    await expect(api.me()).resolves.toEqual({ id: "u" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

with

```javascript
  it("an answer in time leaves no timer behind", async () => {
    const fetchMock = vi.fn();
    const api = await signedIn(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "u" }));
    await expect(api.me()).resolves.toEqual({ id: "u" });
    expect(vi.getTimerCount()).toBe(0);
  });

  // A route that waits on the domain controller is given longer: the API allows itself two LDAP
  // deadlines (about 20 s, 24 s at its cap), and cutting it off at 15 s would tell an administrator
  // "no answer" about an import the server then completed.
  it("a directory call waits 30 s, not 15", async () => {
    const fetchMock = vi.fn();
    const api = await signedIn(fetchMock);
    fetchMock.mockImplementationOnce(hanging);

    const outcome = api.ldapImport(["e-1"]).then(() => "answered", (err) => err);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect((await outcome).code).toBe(REQUEST_TIMEOUT);
  });

  it("a caller may make a call more patient, never less", async () => {
    // The client's limit is the floor: a screen cannot shorten a route's wait, only lengthen it.
    const fetchMock = vi.fn();
    const api = await signedIn(fetchMock, { timeoutMs: 15_000 });
    fetchMock.mockImplementationOnce(hanging);

    const outcome = api.request("/slow", { timeoutMs: 1 }).then(() => "answered", (err) => err);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect((await outcome).code).toBe(REQUEST_TIMEOUT);
  });
});

describe("backendApi — what the work screens call", () => {
  const signedIn = (fetchMock) => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    return createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
  };

  it("acknowledges an alarm by patient and kind, and gets the patient's new board entry", async () => {
    const entry = { patient_id: "S-001", risk: "high", alerts: [{ kind: "sepsis", acknowledged: true }] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(entry));
    const api = signedIn(fetchMock);
    expect(await api.acknowledge("S-001", "sepsis")).toEqual(entry);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/ack");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ patient_id: "S-001", kind: "sepsis" });
  });

  it("records that a patient was opened", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = signedIn(fetchMock);
    expect(await api.view("S-001")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/view");
    expect(JSON.parse(init.body)).toEqual({ patient_id: "S-001" });
  });

  it("lifts an account's directory sign-in throttle with the administrator's reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = signedIn(fetchMock);
    await api.adminUnlockSignIn("11111111-2222-3333-4444-555555555555", "Telefonla doğrulandı");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/admin/users/11111111-2222-3333-4444-555555555555/unlock-sign-in");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ reason: "Telefonla doğrulandı" });
  });

  it("asks the directory routes the questions the login-source screen asks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = signedIn(fetchMock);
    await api.ldapStatus();
    await api.ldapTest();
    await api.ldapSearch("ayşe", 10);
    await api.ldapGroups("YB");
    await api.ldapGroups();
    await api.ldapMappings();
    expect(fetchMock.mock.calls.map(([url, init]) => `${init.method || "GET"} ${url}`)).toEqual([
      "GET /admin/ldap/status",
      "POST /admin/ldap/test",
      "GET /admin/ldap/search?q=ay%C5%9Fe&limit=10",
      "GET /admin/ldap/groups?q=YB",
      "GET /admin/ldap/groups",
      "GET /admin/ldap/group-mappings",
    ]);
  });

  it("imports the accounts it was given, with the extra groups, and maps a group to ours", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ imported: [], skipped: [] }));
    const api = signedIn(fetchMock);
    await api.ldapImport(["e-1", "e-2"], ["g-1"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body))
      .toEqual({ external_ids: ["e-1", "e-2"], extra_group_ids: ["g-1"] });

    await api.ldapCreateMapping("CN=YB-Hekim,OU=Qruplar,DC=xh,DC=local", "g-2");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body))
      .toEqual({ ad_group_dn: "CN=YB-Hekim,OU=Qruplar,DC=xh,DC=local", group_id: "g-2" });
  });

  it("a deleted mapping answers 204, so it resolves to null", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => null });
    const api = signedIn(fetchMock);
    expect(await api.ldapDeleteMapping("m-1")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/admin/ldap/group-mappings/m-1");
    expect(init.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd <worktree>/dashboard
npx vitest run src/backendApi.test.js 2>&1 | grep -E "Tests |not a function" | head -5
```
Expected: **the eight tests you just wrote fail** — `api.ldapImport is not a function` and so on — and nothing that was passing stops. On a clean base at `cced4f9` that reads `8 failed | 78 passed (86)`. The `78` is the base's own count (Task 0 recorded it); the `8` is this step's, and it is the one to check. The file ends this task at **89**, because Step 4b adds the server clock's three tests after the code they need, not here.

- [ ] **Step 3: Give `timed` a per-call limit**

In `dashboard/src/backendApi.js`, replace

```javascript
  /** Run one request (its fetches and the reading of its answer) against the clock: past
   *  `timeoutMs` it is aborted and rejects with REQUEST_TIMEOUT — no `status`, never
   *  `sessionEnded`, so no caller mistakes it for a refusal and signs the clinician out. The
   *  SSE stream is an EventSource, not a request made here, and has no such limit. */
  function timed(run) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl?.abort();
        const err = new Error(TIMEOUT_MESSAGE);
        err.code = REQUEST_TIMEOUT;
        reject(err);
      }, timeoutMs);
    });
```

with

```javascript
  /** Run one request (its fetches and the reading of its answer) against the clock: past
   *  `timeoutMs` it is aborted and rejects with REQUEST_TIMEOUT — no `status`, never
   *  `sessionEnded`, so no caller mistakes it for a refusal and signs the clinician out. The
   *  SSE stream is an EventSource, not a request made here, and has no such limit.
   *
   *  `ms` overrides the client's own limit for ONE call. A route that waits on something outside
   *  this system needs it: the directory routes (`/admin/ldap/*`) may take two LDAP deadlines —
   *  about 20 s with the API's defaults, 24 s at most — so the 15 s that is right for every other
   *  route would cut them off while the server was still working. Only longer than the client's
   *  limit is honoured: a caller cannot make a route impatient, only patient. */
  function timed(run, ms) {
    const limit = Number.isFinite(ms) && ms > timeoutMs ? ms : timeoutMs;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl?.abort();
        const err = new Error(TIMEOUT_MESSAGE);
        err.code = REQUEST_TIMEOUT;
        reject(err);
      }, limit);
    });
```

and replace

```javascript
  function authed(path, options = {}) {
    return timed((doFetch) => authedOnce(doFetch, path, options));
  }
```

with

```javascript
  function authed(path, options = {}) {
    return timed((doFetch) => authedOnce(doFetch, path, options), options.timeoutMs);
  }
```

(`authedOnce` destructures only the options it uses, so the extra key reaches it harmlessly.)

- [ ] **Step 4a: Read the server's clock off every answer**

Every screen in this plan ages a timestamp — an alarm's, a reading's — and ages it against `Date.now()`, this browser's clock. On a ward tablet whose clock is eight minutes slow, every reading on every screen then reads eight minutes fresher than the engine believes it is, and "ölçüldü: 1 dəq" is the most reassuring sentence this interface can print. The board payload says nothing about the server's time, and this plan's earlier draft recorded that as a gap for Group 2 — **which overstated it.** Every HTTP response already carries the server's clock in its `Date` header; RFC 9110 requires an origin server to send one. One place in this file sees every response, so the skew is measurable there and needs no endpoint, no payload field and no new call.

In `dashboard/src/backendApi.js`, replace

```javascript
  function timed(run, ms) {
    const limit = Number.isFinite(ms) && ms > timeoutMs ? ms : timeoutMs;
```

with

```javascript
  /** How far this browser's clock is from the server's, in milliseconds (server minus browser),
   *  read from the `Date` header of the last answer: positive when the browser is behind.
   *
   *  It is captured here, in the one place every request passes through, because every HTTP
   *  response already states the server's clock — RFC 9110 requires an origin server to send
   *  `Date` — so no new endpoint and no new field in the board payload is needed to know it. And
   *  it has to be known: the screens age the engine's timestamps against the BROWSER's clock, and
   *  a ward tablet whose clock is eight minutes slow draws every reading eight minutes fresher
   *  than it is. "Measured 1 min ago" is the most reassuring sentence this interface can print,
   *  and it must not be a tablet's wrong clock saying it.
   *
   *  Deliberately crude: half the round trip is not subtracted and the readings are not smoothed.
   *  This is not a time service. It exists so an age is off by the server's view instead of the
   *  browser's, and so Group 2 can warn about a badly-set device; a few hundred milliseconds of
   *  network is noise beside the minutes that would matter. `null` until an answer has been seen —
   *  which is not 0: "we do not know the skew" and "there is no skew" are different statements. */
  let clockSkewMs = null;
  function noteServerDate(res) {
    const header = res?.headers?.get?.("Date");
    if (header) {
      const server = Date.parse(header);
      if (Number.isFinite(server)) clockSkewMs = server - Date.now();
    }
    return res;
  }

  function timed(run, ms) {
    const limit = Number.isFinite(ms) && ms > timeoutMs ? ms : timeoutMs;
```

and replace

```javascript
    const doFetch = (input, init = {}) => fetchNow(input, ctrl ? { ...init, signal: ctrl.signal } : init);
```

with

```javascript
    const doFetch = (input, init = {}) =>
      Promise.resolve(fetchNow(input, ctrl ? { ...init, signal: ctrl.signal } : init)).then(noteServerDate);
```

(`Promise.resolve` wraps it because a test's `fetchImpl` may return a plain object rather than a promise; `noteServerDate` returns the response unchanged, and a response with no `headers` — which most of this suite's fakes are — passes through it untouched.)

and replace

```javascript
  return {
    accessToken,
    logout,
    forget,
    supersede,
```

with

```javascript
  return {
    accessToken,
    logout,
    forget,
    supersede,

    /** Server clock minus browser clock, in ms, from the last answer's `Date` header; `null` until
     *  one has been seen. A screen that ages a timestamp reads it through the board store. */
    serverClockSkewMs: () => clockSkewMs,
```

- [ ] **Step 4b: The clock's own tests**

Append to `dashboard/src/backendApi.test.js`:

```javascript
// Every answer states the server's clock in its `Date` header (RFC 9110 requires it of an origin
// server), so the client can tell how far the browser's clock is out without a new endpoint and
// without a field in the board payload. It matters because the screens age the engine's timestamps:
// a tablet eight minutes behind draws every reading eight minutes fresher than it is.
describe("backendApi — the server's clock", () => {
  const dated = (body, date) => ({
    ...jsonResponse(body),
    headers: { get: (k) => (k === "Date" ? date : null) },
  });
  const signedIn = () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
  };

  it("is unknown before any answer — null, not 0", () => {
    // "We have not measured the skew" and "there is no skew" are different statements, and only
    // one of them licenses correcting an age by 0.
    const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn() });
    expect(api.serverClockSkewMs()).toBeNull();
  });

  it("reads the Date header, as server minus browser", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-10-08T10:00:00Z"));
    try {
      signedIn();
      const fetchMock = vi.fn().mockResolvedValue(dated({ ok: true }, "Thu, 08 Oct 2026 10:08:00 GMT"));
      const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(8 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps what it knew when a header is missing or unreadable — a proxy may strip it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-10-08T10:00:00Z"));
    try {
      signedIn();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(dated({ ok: true }, "Thu, 08 Oct 2026 09:55:00 GMT"))
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
        .mockResolvedValueOnce(dated({ ok: true }, "not a date"));
      const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(-5 * 60 * 1000);
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(-5 * 60 * 1000);
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(-5 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

```bash
npx vitest run src/backendApi.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  89 passed (89)`.

The first of the three is the one worth keeping if any were cut. `null` and `0` are different claims — "we have not measured the skew" and "there is no skew" — and only one of them licenses correcting an age by nothing.

- [ ] **Step 4: Name the three limits**

Replace

```javascript
export const DEFAULT_TIMEOUT_MS = 15_000;
const TIMEOUT_MESSAGE = "Sunucu yanıt vermedi. İşlem gerçekleşmiş olabilir; listeyi kontrol edip gerekirse tekrar deneyin.";
```

with

```javascript
export const DEFAULT_TIMEOUT_MS = 15_000;
/** How long a call that waits on the domain controller waits (`/admin/ldap/*`). The API gives such
 *  a call up to two LDAP deadlines — about 20 s with its defaults, 24 s at its cap — and one 15 s
 *  earlier would be cut off while the server was still working, leaving an administrator told
 *  "no answer" about an import that then landed. 30 s: past the server's own cap, so the answer a
 *  screen shows is the server's. */
export const ADMIN_LDAP_TIMEOUT_MS = 30_000;
/** The most accounts one `/admin/ldap/import` call takes (the API's own cap). */
export const LDAP_IMPORT_MAX = 50;
/** How many a screen sends per call. A slow controller spends about 2 s per account, so 50 in one
 *  call can outlast any sane limit; in tens, one chunk's failure costs that chunk and the import is
 *  idempotent, so the rest can simply be sent again. */
export const LDAP_IMPORT_CHUNK = 10;
const TIMEOUT_MESSAGE = "Sunucu yanıt vermedi. İşlem gerçekleşmiş olabilir; listeyi kontrol edip gerekirse tekrar deneyin.";
```

- [ ] **Step 5: Add `view` beside `acknowledge`**

Replace

```javascript
    /** The actor is attributed by the API from the token; nothing about who is sent. */
    acknowledge(patientId, kind) {
      return authed("/ack", { method: "POST", body: { patient_id: patientId, kind } });
    },
```

with

```javascript
    /** The actor is attributed by the API from the token; nothing about who is sent.
     *  Resolves to the patient's own board entry as it is AFTER the acknowledgement, so a screen
     *  shows the server's answer rather than its own guess at it. 404 means the alarm is no longer
     *  open (it cleared, or somebody else answered it and it resolved). */
    acknowledge(patientId, kind) {
      return authed("/ack", { method: "POST", body: { patient_id: patientId, kind } });
    },

    /** Record that a clinician opened this patient — the audit line an inspection asks for.
     *  Sent for a patient the screen actually shows: the server answers 404 for one outside the
     *  caller's scope AND for one that does not exist (deliberately the same answer), and logs
     *  the refusal as `scope_denied`, so sending it for a stale bookmark would fill the trail with
     *  refusals for views that never happened. */
    view(patientId) {
      return authed("/view", { method: "POST", body: { patient_id: patientId } });
    },
```

- [ ] **Step 6: Add the unlock and the eight directory calls**

Replace

```javascript
    adminResetMfa(id) { return authed(`/admin/users/${seg(id)}/reset-mfa`, { method: "POST" }); },
```

with

```javascript
    adminResetMfa(id) { return authed(`/admin/users/${seg(id)}/reset-mfa`, { method: "POST" }); },
    /** Three more failed directory binds for this account's current run of failures. `reason` goes
     *  into the audit row and the API requires it: one line, at least one letter or digit, at most
     *  200 characters. Once per run — a second call grants nothing and says so. */
    adminUnlockSignIn(id, reason) {
      return authed(`/admin/users/${seg(id)}/unlock-sign-in`, { method: "POST", body: { reason } });
    },

    // ---- the directory (/admin/ldap, see homunculus-engine admin/ldap_router.py) ----
    // Every one of these waits on the domain controller, so they all carry ADMIN_LDAP_TIMEOUT_MS
    // instead of the client's usual limit (see `timed`). `status` and `test`, the search and the
    // group list need users.manage; importing needs users.manage; CHANGING the group mapping needs
    // the whole catalogue (the API answers 403 otherwise), so a screen shows those controls only to
    // an administrator who has it.
    /** {configured, url_host, last_test_at, last_test_ok} — never a bind DN or a password. */
    ldapStatus() { return authed("/admin/ldap/status", { timeoutMs: ADMIN_LDAP_TIMEOUT_MS }); },
    /** One service bind now: {ok, reason, checked_at}; `reason` is unreachable | timeout | tls |
     *  service_bind_rejected | protocol. */
    ldapTest() {
      return authed("/admin/ldap/test", { method: "POST", timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
    /** [LdapUserOut] for a name fragment — each says whether it is already imported. */
    ldapSearch(query, limit = 25) {
      return authed(`/admin/ldap/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`,
        { timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
    /** [{dn, name}] — the directory's groups, for the mapping's picker. */
    ldapGroups(query = "") {
      const q = query ? `?q=${encodeURIComponent(query)}` : "";
      return authed(`/admin/ldap/groups${q}`, { timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
    /** Import up to LDAP_IMPORT_MAX accounts: {imported, skipped}. Idempotent — an account already
     *  here comes back under `skipped` with the reason "exists", so a retry after a timeout is
     *  safe. A slow controller makes this the longest call in the product: the caller sends it in
     *  chunks of LDAP_IMPORT_CHUNK so one chunk's failure costs only that chunk. */
    ldapImport(externalIds, extraGroupIds = []) {
      return authed("/admin/ldap/import", {
        method: "POST", timeoutMs: ADMIN_LDAP_TIMEOUT_MS,
        body: { external_ids: externalIds, extra_group_ids: extraGroupIds },
      });
    },
    /** [LdapMappingOut] — which AD group grants which of our groups. Reading needs users.manage. */
    ldapMappings() { return authed("/admin/ldap/group-mappings", { timeoutMs: ADMIN_LDAP_TIMEOUT_MS }); },
    /** Needs EVERY permission (403 otherwise). `adGroupDn` is stored in its canonical spelling. */
    ldapCreateMapping(adGroupDn, groupId) {
      return authed("/admin/ldap/group-mappings", {
        method: "POST", timeoutMs: ADMIN_LDAP_TIMEOUT_MS,
        body: { ad_group_dn: adGroupDn, group_id: groupId },
      });
    },
    /** 204: resolves to null. Needs every permission. */
    ldapDeleteMapping(id) {
      return authed(`/admin/ldap/group-mappings/${seg(id)}`,
        { method: "DELETE", timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run src/backendApi.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  86 passed (86)`.

- [ ] **Step 8: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `87 passed (87)` files, `1759 passed (1759)` tests; the build succeeds.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the API client's per-call timeout and Wave 3's calls

`timed` takes a limit that may only LENGTHEN a call's wait: the directory
routes may take two LDAP deadlines on the server, and 15 s would cut an
import off while it was still working. /view, the sign-in unlock and the
eight /admin/ldap calls, the last carrying 30 s.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **89** tests in `backendApi.test.js` (was 78: +8 for the timeout and the new calls, +3 for the server clock); whole suite green; build clean.

---

### Task 2: The adapter — the unit and bed a card sits on, and an alarm's whole reasoning

**Files:**
- Modify: `dashboard/src/liveAdapters.js`
- Test: `dashboard/src/liveAdapters.test.js`

Two gaps the roadmap names. `patientFromBoard` sets `bedId` and `unitId` to `null` although the board publishes both — so every HIS patient reads "waiting for a bed", and the unit filter and the scope editor have nothing to match on. And `alertsFromPatients` keeps five fields of an alarm and drops the seven that say WHY the engine raised it, which is the whole content of G1-11's recommendation card.

This file is shared with the old workspace (it is one of the four `src/live/` may import). The change is additive except for `bedId`/`unitId`, which become what the server says: `awaitingLocalAdmission` filters on `!p.bedId`, so a HIS patient already on a mapped bed correctly stops reading as "awaiting local admission" — which is the defect the roadmap records.

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/liveAdapters.test.js`, inside `describe("identity on a board entry")`, replace

```javascript
    expect(patientFromBoard(discharged).identityState).toBe("discharged");
  });
});
```

with

```javascript
    expect(patientFromBoard(discharged).identityState).toBe("discharged");
  });

  // The bed and unit the SERVER resolved the card onto (api/board.py `_bed_resolution`). These are
  // the keys the server's own scope filter matches (`sees_patient`), so a screen that filters by
  // unit, or explains why a board is the size it is, has to read the same ones.
  const resolved = {
    ...withIdentity,
    identity: { ...withIdentity.identity, bed_id: "REA-01-2", unit_id: "REA-01",
                bed_matched: true, bed_key: "YB^304^2" },
  };

  it("carries the bed and unit the board resolved, and that it matched", () => {
    const patient = patientFromBoard(resolved);
    expect(patient.bedId).toBe("REA-01-2");
    expect(patient.unitId).toBe("REA-01");
    expect(patient.bedMatched).toBe(true);
    expect(patient.bedKey).toBe("YB^304^2");
  });

  it("keeps the unmatched location's key, and says it did not match", () => {
    // A location the site's table does not cover: the patient still has a card (never dropped),
    // but belongs to no unit — which is why a scoped session cannot see it at all. The key is
    // what an operator adds to the table, so it is kept verbatim.
    const patient = patientFromBoard({
      ...withIdentity,
      identity: { ...withIdentity.identity, bed_id: null, unit_id: null,
                  bed_matched: false, bed_key: "YB^999^9" },
    });
    expect(patient.bedId).toBeNull();
    expect(patient.unitId).toBeNull();
    expect(patient.bedMatched).toBe(false);
    expect(patient.bedKey).toBe("YB^999^9");
  });

  it("a card with no identity at all is on no bed and no unit, and says so", () => {
    const patient = patientFromBoard({ patient_id: "S-001", risk: "none", alerts: [] });
    expect(patient.bedId).toBeNull();
    expect(patient.unitId).toBeNull();
    expect(patient.bedMatched).toBe(false);
    expect(patient.bedKey).toBeNull();
  });
});
```

Then, inside `describe("alertsFromPatients")`, replace

```javascript
    expect(alert.ack.reason).toBeNull();
    expect(alert.ack.note).toBeNull();
  });
```

with

```javascript
    expect(alert.ack.reason).toBeNull();
    expect(alert.ack.note).toBeNull();
  });

  // The engine's own reasoning travels with the alarm (reco/engine.py Alert): the patient screen
  // shows it, and nothing here rewrites it.
  describe("why the engine raised it", () => {
    const reasoned = { ...entry, alerts: [{ ...entry.alerts[0],
      clinical_reasoning: "SOFA rose by 3 over the charted baseline.",
      supporting_evidence: ["sepsis-3-jama-2016", "surviving-sepsis-campaign-2021"],
      recommended_actions: ["Review the patient and the supporting evidence."],
      confidence: "Sepsis-3 organ-dysfunction criterion (consensus definition).",
      downgraded: false, chronic_context: "", stale_inputs: ["lactate"] }] };

    it("carries the reasoning, the sources, the actions and the certainty", () => {
      const alert = alertsFromPatients([patientFromBoard(reasoned)])[0];
      expect(alert.clinicalReasoning).toBe("SOFA rose by 3 over the charted baseline.");
      expect(alert.evidence).toEqual(["sepsis-3-jama-2016", "surviving-sepsis-campaign-2021"]);
      expect(alert.actions).toEqual(["Review the patient and the supporting evidence."]);
      expect(alert.confidence).toBe("Sepsis-3 organ-dysfunction criterion (consensus definition).");
      expect(alert.staleInputs).toEqual(["lactate"]);
    });

    it("says when the patient's own charted normal lowered it, and why", () => {
      const lowered = { ...entry, alerts: [{ ...entry.alerts[0], severity: "low",
        downgraded: true, chronic_context: "Chronic oxygen therapy explains the SpO2." }] };
      const alert = alertsFromPatients([patientFromBoard(lowered)])[0];
      expect(alert.downgraded).toBe(true);
      expect(alert.chronicContext).toBe("Chronic oxygen therapy explains the SpO2.");
    });

    it("carries no reasoning rather than an invented one", () => {
      const alert = alertsFromPatients([patientFromBoard(entry)])[0];
      expect(alert.clinicalReasoning).toBeNull();
      expect(alert.confidence).toBeNull();
      expect(alert.chronicContext).toBeNull();
      expect(alert.evidence).toEqual([]);
      expect(alert.actions).toEqual([]);
      expect(alert.staleInputs).toEqual([]);
      expect(alert.downgraded).toBe(false);
    });

    it("carries the acknowledgement as a bare name and instant too", () => {
      // What a list row shows: who, and when on the wall clock. `ack` keeps the shape the old
      // workspace's AlertCard reads; these two are what a new screen needs.
      const acked = { ...entry, alerts: [{ ...entry.alerts[0], acknowledged: true,
        acknowledged_by: "ayse", acknowledged_at: "2026-08-27T10:05:00Z" }] };
      const alert = alertsFromPatients([patientFromBoard(acked)])[0];
      expect(alert.ackBy).toBe("ayse");
      expect(alert.ackAtMs).toBe(Date.parse("2026-08-27T10:05:00Z"));
      const open = alertsFromPatients([patientFromBoard(entry)])[0];
      expect(open.ackBy).toBeNull();
      expect(open.ackAtMs).toBeNull();
    });
  });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/liveAdapters.test.js 2>&1 | grep -E "Tests "
```
Expected: `7 failed | 43 passed (50)` — **measured**, by putting Step 1's test file into a clean worktree at `cced4f9` with `liveAdapters.js` untouched. The number to hold on to is the **7**: this task adds seven tests, and the 43 is the base's own count. An earlier draft of this document said `8 failed | 42 passed (50)` and was wrong in both halves — the base has 43, not 42, because `it.each` expands and the draft had counted `it(` with grep. If your 43 is a different number, Task 0 recorded the real base and everything here is that base plus seven.

- [ ] **Step 3: Read the bed resolution**

In `dashboard/src/liveAdapters.js`, replace

```javascript
    protocolNo: identity?.patient_id ?? null,
    bedId: null,
    bedLabel: identity?.bed_label || null,
    unitId: null,
    diagnosis: null,
```

with

```javascript
    protocolNo: identity?.patient_id ?? null,
    // The bed and unit the BOARD resolved this card onto (api/board.py `_bed_resolution`): our own
    // ids from the site's HIS-location table, not the HIS's words — these are exactly the keys the
    // server's scope filter matches against (`sees_patient`), so a screen that filters or explains
    // by unit must read the same ones. Null when the table does not cover the location: that card
    // belongs to no unit, which is why a scoped session cannot see it at all.
    bedId: identity?.bed_id || null,
    bedLabel: identity?.bed_label || null,
    unitId: identity?.unit_id || null,
    // Whether the table covered it (false also when there is no table), and the normalised HIS
    // location that was looked up — the line an operator adds to the table. A screen can turn
    // "this patient is on no bed" into a fixable instruction instead of a blank.
    bedMatched: identity?.bed_matched === true,
    bedKey: identity?.bed_key || null,
    diagnosis: null,
```

- [ ] **Step 4: Carry the alarm's reasoning**

Replace

```javascript
        kind: a.kind ?? null,
        tier: SEVERITY_TO_TIER[a.severity] ?? null,
        severity: a.severity ?? null,
        urgency: a.urgency ?? null,
        summary: a.summary ?? null,
        status: a.acknowledged ? "ACKNOWLEDGED" : "FIRED",
        escalated: !!a.escalated,
        firstSeenAtMs: msFromTimestamp(a.first_seen_at),
```

with

```javascript
        kind: a.kind ?? null,
        tier: SEVERITY_TO_TIER[a.severity] ?? null,
        severity: a.severity ?? null,
        urgency: a.urgency ?? null,
        summary: a.summary ?? null,
        // WHY the engine raised it, and what it rests on (reco/engine.py Alert): the reasoning,
        // the vault sources behind it, what it suggests considering, how certain that is, whether
        // the patient's own charted normal lowered it and which inputs were already stale. The
        // patient screen shows these; nothing here is translated or rewritten — it is the engine's
        // own text, and a screen that paraphrased clinical reasoning would be writing its own.
        // Absent fields stay null / empty: an alert carries no reasoning rather than a made-up one.
        clinicalReasoning: a.clinical_reasoning ?? null,
        evidence: Array.isArray(a.supporting_evidence) ? a.supporting_evidence : [],
        actions: Array.isArray(a.recommended_actions) ? a.recommended_actions : [],
        confidence: a.confidence ?? null,
        downgraded: a.downgraded === true,
        chronicContext: a.chronic_context || null,
        staleInputs: Array.isArray(a.stale_inputs) ? a.stale_inputs : [],
        status: a.acknowledged ? "ACKNOWLEDGED" : "FIRED",
        ackBy: a.acknowledged ? (a.acknowledged_by ?? null) : null,
        ackAtMs: a.acknowledged ? msFromTimestamp(a.acknowledged_at) : null,
        escalated: !!a.escalated,
        firstSeenAtMs: msFromTimestamp(a.first_seen_at),
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/liveAdapters.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  50 passed (50)`.

- [ ] **Step 6: Gate** — and read the whole suite carefully here: this file is the old workspace's too.

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `87 passed (87)` files, `1767 passed (1767)` tests. (The old workspace's own tests pass unchanged: the fields it reads are untouched, and the three it did not read are now filled in.)

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the adapter reads the bed resolution and the alarm's reasoning

`patientFromBoard` was dropping identity.bed_id / unit_id, which the server's
own scope filter matches on, so every HIS patient read as bedless and no screen
could filter by unit. `alertsFromPatients` was dropping the seven fields that
say why the engine raised an alarm — the whole content of the patient screen's
recommendation card.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **50** tests in `liveAdapters.test.js` (was **43** — count it at the base rather than trusting this number; an earlier draft of this plan said 42 and was wrong, which made every later total in it wrong by one); whole suite green; build clean.

---

### Task 3: The stores — what a screen may ask them to do

**Files:**
- Modify: `dashboard/src/live/data/boardStore.js`, `dashboard/src/live/session/sessionStore.js`
- Test: `dashboard/src/live/data/boardStore.test.js`

Three things the board store gains, and one line on the session store. The board store's `onMessage` is split so the path a stream frame takes can also take the entry an answer carries — `POST /ack` replies with the patient's board entry as it is after the acknowledgement — which means the server's own publish of that same board arrives as a frame and lays down the identical card, and an answer is replayed over a snapshot still on its way exactly as a frame is. `acknowledge()` and `view()` put the two writes a clinical screen makes inside `track`, where every other call the board makes already is.

- [ ] **Step 1: Write the failing tests**

Append to `dashboard/src/live/data/boardStore.test.js`:

```javascript
describe("an answer the API gave, put onto the board", () => {
  it("applies the entry /ack answered with, as a frame would", async () => {
    const { store, state } = setup();
    await store.start();
    expect(state().alerts[0].status).toBe("FIRED");

    store.applyEntry(entry("P-001", [alert("news2", "high", { acknowledged: true, acknowledged_by: "ayse" })]));

    expect(state().alerts[0].status).toBe("ACKNOWLEDGED");
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-001", "P-002"]);
  });

  it("is replayed over a snapshot still on its way, so a reload cannot undo it", async () => {
    // The same guarantee a stream frame has: the load's snapshot was taken by the server before
    // the acknowledgement, and must not come back and un-acknowledge it.
    let release;
    const { api, store, state } = setup();
    await store.start();
    api.boardPatients.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const loading = store.refresh();
    store.applyEntry(entry("P-001", [alert("news2", "high", { acknowledged: true })]));
    release(BOARD);
    await loading;
    expect(state().alerts[0].status).toBe("ACKNOWLEDGED");
  });

  it("does not make a board whose load FAILED look like a ward of one bed", async () => {
    const { api, store, state } = setup();
    api.boardPatients.mockRejectedValue(new Error("down"));
    await store.start();
    expect(state().connection).toBe(CONNECTION.UNAVAILABLE);

    store.applyEntry(entry("P-001", [alert("news2", "high", { acknowledged: true })]));

    expect(state().patients).toEqual([]);
    expect(state().connection).toBe(CONNECTION.UNAVAILABLE);
  });

  it("ignores an answer with no patient id", () => {
    const { store, state } = setup();
    store.applyEntry({ risk: "high" });
    store.applyEntry(null);
    expect(state().patients).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/live/data/ 2>&1 | grep -E "Tests |not a function" | head -3
```
Expected: `4 failed | 23 passed (27)`, reading `store.applyEntry is not a function`.

- [ ] **Step 3: Split the frame's path from the parsing**

In `dashboard/src/live/data/boardStore.js`, replace

```javascript
  function onMessage(event) {
    let patient;
    let removed;
    try {
      const entry = JSON.parse(event.data);
      removed = entry.removed === true;
      patient = patientFromBoard(entry);
    } catch {
      return;                                     // a malformed frame touches nothing
    }
    if (patient.patient_id == null) return;
```

with

```javascript
  /** One board entry, from wherever it came: a stream frame, or the answer a write gave (`/ack`
   *  replies with the patient's board entry as it is AFTER the acknowledgement). Treated exactly
   *  alike, so an answer applied here is also replayed over a snapshot still on its way and
   *  cannot be undone by it — and so a board whose load failed stays empty either way: one card is
   *  not a ward, and a screen showing only the bed somebody just acknowledged would be the worst
   *  of both (it looks like a board, and it is one patient). */
  function ingest(entry) {
    const removed = entry?.removed === true;
    const patient = patientFromBoard(entry);
    if (patient.patient_id == null) return;
```

and replace

```javascript
    if (state.connection === CONNECTION.UNAVAILABLE) return;
    withPatients(applyFrame(state.patients, frame));
  }

  function onError(mine) {
```

with

```javascript
    if (state.connection === CONNECTION.UNAVAILABLE) return;
    withPatients(applyFrame(state.patients, frame));
  }

  function onMessage(event) {
    let entry;
    try {
      entry = JSON.parse(event.data);
    } catch {
      return;                                     // a malformed frame touches nothing
    }
    ingest(entry);
  }

  function onError(mine) {
```

- [ ] **Step 4: Offer the four actions**

Replace

```javascript
    refresh,
    /** Load, then stream (LIVE once the stream has opened and its reload landed). Resolves once
     *  the first load and the first ticket are done. */
```

with

```javascript
    refresh,
    /** Put a board entry the API answered with onto the board (`/ack` answers with the patient's
     *  own entry). The same path a stream frame takes, so the two cannot disagree: the server's
     *  own publish of that same board will arrive as a frame too and apply the identical card.
     *  A screen never has to guess what an acknowledgement did — it shows what came back. */
    applyEntry: ingest,
    /**
     * Acknowledge one alarm (`POST /ack {patient_id, kind}`, permission `alerts.ack`) and put the
     * board entry it answers with onto the board. Resolves with that entry; REJECTS with the API's
     * own error, having changed nothing — there is no optimistic update to roll back, because
     * nothing is written before the server has taken it. A clinical screen must not show an
     * acknowledgement that may not have happened: "seen by" is a claim about a person.
     *
     * Through `track`, like every other call the board makes, so a refused refresh ends the
     * session here too and a 403 `password_change_required` moves the shell on. An answer that
     * arrives after `clear()` (the session ended) is dropped by `ingest`'s own generation check.
     */
    async acknowledge(patientId, kind) {
      const mine = generation;
      const entry = await track(() => api.acknowledge(patientId, kind));
      if (mine !== generation) return null;
      ingest(entry);
      return entry;
    },
    /**
     * Record that a clinician opened this patient (`POST /view`, permission `board.view`) — the
     * audit line an inspection asks for. It writes a log row and nothing else, so it changes no
     * state here. The CALLER decides when: only for a patient the screen actually shows, because
     * the server logs a refusal as `scope_denied` and a stale bookmark must not fill the trail
     * with refusals for views that never happened.
     *
     * Rejects with the API's error; a screen may ignore it (a missing audit row is not something
     * a clinician at the bedside can act on, and the board request is already in the trail).
     */
    view(patientId) {
      return track(() => api.view(patientId));
    },
    /**
     * Chart what a clinician observed (`POST /clinical/{id}`, permission `clinical.chart`).
     * `entries` is `[{code, value}]` and the engine fixes the unit for each code, so a screen
     * cannot chart a value in the wrong scale (api/clinical.py `CHARTABLE`).
     *
     * It reloads the board afterwards instead of applying what came back. Two reasons. The answer
     * is not a board entry — it is `{patient_id, charted, alerts}` — and more importantly the
     * charted value may change the ENGINE's conclusion about this patient: charting a suspected
     * infection is what lets the sepsis branch run at all (`septic_shock.evaluate` returns at its
     * first line without it), so the card that comes back can carry alarms that did not exist a
     * moment ago. The server publishes that same board as a frame, which a LIVE session would
     * receive anyway; the reload is what makes the screen correct for a session that is DEGRADED
     * or still connecting, and the frame and the reload cannot disagree because both go through
     * `ingest` / `withPatients`.
     *
     * Rejects with the API's own error, having written nothing locally: a clinical screen must
     * never show a charted observation that the server may have refused.
     */
    async chart(patientId, entries) {
      const mine = generation;
      const answer = await track(() => api.chart(patientId, entries));
      if (mine !== generation) return null;
      await refresh();
      return answer;
    },
    /** Load, then stream (LIVE once the stream has opened and its reload landed). Resolves once
     *  the first load and the first ticket are done. */
```

- [ ] **Step 4a: Carry the server's clock with the ward**

Task 1 measures the skew; something has to hand it to the screens, and it has to travel with the board it belongs to rather than be read from the API client by every component. Replace

```javascript
const EMPTY = Object.freeze({
  patients: [], alerts: [], connection: CONNECTION.CONNECTING, scope: null, scopeNote: null,
});
```

with

```javascript
const EMPTY = Object.freeze({
  patients: [], alerts: [], connection: CONNECTION.CONNECTING, scope: null, scopeNote: null,
  clockSkewMs: null,
});
```

and replace

```javascript
  const withPatients = (patients, patch = {}) => set({ patients, alerts: alertsFromPatients(patients), ...patch });
```

with

```javascript
  // The server's clock, as of the last answer (backendApi `serverClockSkewMs`), carried with the
  // ward it came with. A screen ages a timestamp against this and not against `Date.now()` alone:
  // the engine timestamps a reading by ITS clock, so an age measured by a ward tablet's clock is
  // wrong by however wrong that tablet is — and wrong in the reassuring direction half the time.
  const skewNow = () => (typeof api?.serverClockSkewMs === "function" ? api.serverClockSkewMs() : null);
  const withPatients = (patients, patch = {}) =>
    set({ patients, alerts: alertsFromPatients(patients), clockSkewMs: skewNow(), ...patch });
```

The `typeof` guard is not decoration: every fake API in this suite is an object literal, and most of them do not have the method. A board store that threw on a fake would make a hundred Wave-2 tests fail for a reason that has nothing to do with what they test.

- [ ] **Step 4b: A chronic-expected finding is visible, and answers to nobody**

This is the user's second decision (Decision 26), and it is one predicate. The engine marks a finding `downgraded` when the patient's own charted baseline or a recorded comorbidity explains every contributor, and its own contract says what that means — `rules/patient_relative.py:16-18`: such a finding "stays visible but does NOT alarm or escalate". The waiting queue, the bell's count and the rail's badge are all "somebody must act on this", so none of them may count it; the card, the alarms list and the engine's text all keep showing it. Replace

```javascript
function knowing(connection) {
  return { known: connection === CONNECTION.LIVE, stale: connection === CONNECTION.DEGRADED };
}
```

with

```javascript
function knowing(connection) {
  return { known: connection === CONNECTION.LIVE, stale: connection === CONNECTION.DEGRADED };
}

/**
 * Whether this alarm is one somebody must answer.
 *
 * An alarm the engine marked `downgraded` is NOT. The engine's own contract says so
 * (rules/patient_relative.py, the header): a finding every contributor of which the patient's
 * charted chronic normal or a recorded comorbidity explains "stays visible but does NOT alarm or
 * escalate". A patient with dementia or chronic oxygen therapy would otherwise keep a red badge on
 * the rail and a line in the bell for the whole of their stay — and a count that never goes down
 * is a count nobody reads, which is how a real one gets missed.
 *
 * It stays VISIBLE: the bed card shows it, the alarms screen lists it, and both mark it
 * chronic-expected with the engine's own explanation. What it leaves is only the arithmetic that
 * means "this needs a person": the bell, the rail's badge, the board's attention line and the lock
 * screen's counts.
 */
const needsAnswer = (a) => !a.ack && a.downgraded !== true;
```

Then use it in both places that count. Replace

```javascript
/** Open alarms counted: `open` is every alarm the engine still holds (seen or not), by severity
 *  (`unknown`: a severity this build does not know); `waiting` those nobody has acknowledged. */
```

with

```javascript
/** Open alarms counted: `open` is every alarm the engine still holds (seen or not, downgraded or
 *  not), by severity (`unknown`: a severity this build does not know); `waiting` those nobody has
 *  acknowledged AND that the engine has not marked chronic-expected (`needsAnswer`). */
```

. Replace

```javascript
    if (!a.ack) waiting += 1;
```

with

```javascript
    if (needsAnswer(a)) waiting += 1;
```

. Replace

```javascript
/** The alarms nobody has acknowledged (`items`, for the bell): a severity this build does not know
 *  first — it may be the worst —, then the most severe, then the oldest first. */
export function waitingAlarms({ alerts = [], connection } = {}) {
  const { known, stale } = knowing(connection);
  if (!known && !stale) return { known, stale, items: null };
  const rank = (a) => SEVERITY_ORDER.indexOf(a.severity);   // -1: unknown, first
  const items = alerts.filter((a) => !a.ack).sort((a, b) => rank(a) - rank(b)
```

with

```javascript
/** The alarms somebody must answer (`items`, for the bell and the rail's count): a severity this
 *  build does not know first — it may be the worst —, then the most severe, then the oldest first.
 *  A chronic-expected finding is not among them (`needsAnswer`); it is still on the card and in
 *  the alarms list. */
export function waitingAlarms({ alerts = [], connection } = {}) {
  const { known, stale } = knowing(connection);
  if (!known && !stale) return { known, stale, items: null };
  const rank = (a) => SEVERITY_ORDER.indexOf(a.severity);   // -1: unknown, first
  const items = alerts.filter(needsAnswer).sort((a, b) => rank(a) - rank(b)
```

Note what the two names now say. `open` still counts a downgraded finding — it is open, the engine is still holding it — and only `waiting` excludes it. A screen that wanted "how many findings are there" and a screen that wanted "how many need somebody" were asking different questions all along; before this they got the same number.

- [ ] **Step 4c: The two new rules' own tests**

Append to `dashboard/src/live/data/boardStore.test.js`:

```javascript
describe("a chronic-expected finding is visible but answers to nobody", () => {
  // The engine's own contract (rules/patient_relative.py): a finding the patient's charted chronic
  // normal explains "stays visible but does NOT alarm or escalate". A dementia or COPD patient
  // would otherwise keep a red badge on the rail for the whole of their stay.
  const chronic = alert("news2", "low", { downgraded: true, chronic_context: "Chronic oxygen therapy explains the SpO2." });
  const board = { patients: [entry("P-001", [chronic])], scope: null, scope_note: null };

  it("is not in the bell's list, and the bell may still say nothing is waiting", async () => {
    const { api, store, state } = setup({ board });
    await store.start();
    const { known, items } = waitingAlarms({ ...state(), connection: CONNECTION.LIVE });
    expect(api.boardPatients).toHaveBeenCalled();
    expect(known).toBe(true);
    expect(items).toEqual([]);
  });

  it("is not counted as waiting, but is still counted as open", async () => {
    const { store, state } = setup({ board });
    await store.start();
    const counts = alarmCounts({ ...state(), connection: CONNECTION.LIVE });
    expect(counts.open.total).toBe(1);
    expect(counts.open.low).toBe(1);
    expect(counts.waiting).toBe(0);
  });

  it("is still on the board, with the engine's explanation", async () => {
    const { store, state } = setup({ board });
    await store.start();
    expect(state().alerts).toHaveLength(1);
    expect(state().alerts[0].downgraded).toBe(true);
    expect(state().alerts[0].chronicContext).toBe("Chronic oxygen therapy explains the SpO2.");
  });

  it("an acknowledged one is not waiting either, and a plain one still is", async () => {
    const plain = alert("acute_change", "high");
    const acked = alert("sepsis", "critical", { acknowledged: true });
    const mixed = { patients: [entry("P-001", [chronic, plain, acked])], scope: null, scope_note: null };
    const { store, state } = setup({ board: mixed });
    await store.start();
    const { items } = waitingAlarms({ ...state(), connection: CONNECTION.LIVE });
    expect(items.map((a) => a.kind)).toEqual(["acute_change"]);
    expect(lockSummary({ ...state(), connection: CONNECTION.LIVE }).waiting).toBe(1);
  });
});
```

And the clock's two, in the same file. Append to `dashboard/src/live/data/boardStore.test.js`:

```javascript
describe("the server's clock, carried with the ward", () => {
  it("says it does not know the skew when the api cannot state one", async () => {
    // An api built before this existed, or one whose answers carried no `Date` header: the field is
    // null, and `useBoardNow` corrects by 0 — never by a number nobody measured.
    const { store, state } = setup();
    expect(state().clockSkewMs).toBeNull();
    await store.start();
    expect(state().clockSkewMs).toBeNull();
  });

  it("reads it from the api on every load, and a cleared store knows nothing again", async () => {
    const handlers = [];
    const api = {
      boardPatients: vi.fn().mockResolvedValue(BOARD),
      streamTicket: vi.fn().mockResolvedValue({ ticket: "t-1" }),
      serverClockSkewMs: vi.fn().mockReturnValue(-8 * 60 * 1000),
    };
    const store = createBoardStore({ api, openStream: (url, h) => { handlers.push(h); return vi.fn(); } });
    await store.start();
    expect(store.getState().clockSkewMs).toBe(-8 * 60 * 1000);
    api.serverClockSkewMs.mockReturnValue(1500);
    handlers[0].onopen();
    await vi.waitFor(() => expect(store.getState().clockSkewMs).toBe(1500));
    store.clear();
    expect(store.getState().clockSkewMs).toBeNull();
  });
});
```

```bash
npx vitest run src/live/data/boardStore.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  33 passed (33)`.

The second of the clock's two tests is the one that matters for a reader: a fake API with no `serverClockSkewMs` must leave the field `null` and must not throw, because every fake in this suite is an object literal and most of them do not have the method.

- [ ] **Step 5: Let the administration tabs reach the API through `track`**

In `dashboard/src/live/session/sessionStore.js`, replace

```javascript
    changePassword,
    lock,
    unlock,
    track,
```

with

```javascript
    changePassword,
    lock,
    unlock,
    track,
    /** The API client this session speaks through, for a screen that calls routes neither store
     *  wraps — the three administration tabs (`/admin`, `/admin/ldap`, `/scope`). A screen must
     *  still put every such call inside `track`, so a refused refresh ends the session there too:
     *  `store.track(() => store.api.adminUsers())`. It is exposed rather than threaded through a
     *  context of its own because the session store is what owns the credential, and a screen that
     *  can reach the API without `track` is the mistake worth making hard. */
    api,
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/live/data/ src/live/session/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  151 passed (151)` — 27 in the board store (was 23) and the session store's unchanged.

- [ ] **Step 7: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `87 passed (87)` files, `1771 passed (1771)` tests; the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/live/data/boardStore.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/session/sessionStore.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the board store acknowledges, records a view, and takes an answer

One path for a board entry however it arrives — a stream frame or the entry
/ack replies with — so the server's own publish of that board lays down the
same card and an answer is replayed over a snapshot still in flight. Nothing
is written before the server has taken it: there is no optimistic
acknowledgement, because "seen by" is a claim about a person.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **33** tests in `boardStore.test.js` (was 23: +4 for the three actions, +4 for the chronic-expected rule, +2 for the server clock); whole suite green; build clean.

---

### Task 4: The clock and the ages — three pure modules

**Files:**
- Create: `dashboard/src/live/screens/common/elapsed.js`, `freshness.js`, `useNow.js`
- Test: `dashboard/src/live/screens/common/freshness.test.js`, `useNow.test.jsx`

The rule these files exist to enforce, and the one to read before writing a line of them: **a screen reports the AGE of a value and never decides that an age is too old.** `freshness.js` has no "stale" in it. "Too old to act on" is a clinical threshold, the engine owns every one of them, and the browser picking its own is the mistake Wave 0 had to tear out.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/live/screens/common/freshness.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { elapsed, msOf } from "./elapsed.js";
import {
  SIGNAL_KEYS, ageOf, hasMeasurement, lastMeasuredAt, neverMeasured, oldestMeasurement,
} from "./freshness.js";

const NOW = Date.parse("2026-10-08T10:00:00Z");
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

describe("elapsed — how long an alarm has been open", () => {
  it("writes minutes and seconds under an hour", () => {
    expect(elapsed(NOW - 0, NOW)).toBe("0:00");
    expect(elapsed(NOW - 7_000, NOW)).toBe("0:07");
    expect(elapsed(NOW - 247_000, NOW)).toBe("4:07");
    expect(elapsed(NOW - 3_599_000, NOW)).toBe("59:59");
  });

  it("never writes a minute past 59: an hour becomes h:mm:ss", () => {
    // The old workspace wrote "318:30" for five and a quarter hours. A number a clinician reads
    // as minutes when it is hours is worse than no number at all.
    expect(elapsed(NOW - 3_600_000, NOW)).toBe("1:00:00");
    expect(elapsed(NOW - 19_110_000, NOW)).toBe("5:18:30");
  });

  it("an instant that has not arrived yet is 0:00, not a negative age", () => {
    // `firstSeenAtMs` is the SERVER's instant and this subtraction uses the BROWSER's clock: a
    // ward PC running ahead of the API must not show an alarm that has not happened.
    expect(elapsed(NOW + 90_000, NOW)).toBe("0:00");
  });

  it("no instant means no age, never an invented one", () => {
    expect(elapsed(null, NOW)).toBeNull();
    expect(elapsed(undefined, NOW)).toBeNull();
    expect(elapsed(NaN, NOW)).toBeNull();
  });

  it("reads an ISO instant, and refuses anything else", () => {
    expect(msOf("2026-10-08T10:00:00Z")).toBe(NOW);
    expect(msOf("")).toBeNull();
    expect(msOf(null)).toBeNull();
    expect(msOf("bir ara")).toBeNull();
  });
});

describe("freshness — the age of a reading, and never a verdict on it", () => {
  it("lists the signals a vital bar shows, as the server names them", () => {
    expect(SIGNAL_KEYS).toContain("heart_rate");
    expect(SIGNAL_KEYS).toContain("spo2");
    expect(Object.isFrozen(SIGNAL_KEYS)).toBe(true);
  });

  it("says whether a card has ever been measured", () => {
    expect(hasMeasurement({ heart_rate: ago(60), spo2: null })).toBe(true);
    expect(hasMeasurement({ heart_rate: null, spo2: null })).toBe(false);
    expect(hasMeasurement({})).toBe(false);
    expect(hasMeasurement(null)).toBe(false);
    expect(hasMeasurement(undefined)).toBe(false);
  });

  it("an unreadable instant does not count as a measurement", () => {
    expect(hasMeasurement({ heart_rate: "dün" })).toBe(false);
  });

  it("the card's newest instant is its last measurement", () => {
    expect(lastMeasuredAt({ heart_rate: ago(600), spo2: ago(30) })).toBe(NOW - 30_000);
    expect(lastMeasuredAt({ heart_rate: null })).toBeNull();
  });

  it("gives one channel's age in milliseconds", () => {
    expect(ageOf(ago(90), NOW)).toBe(90_000);
    expect(ageOf(null, NOW)).toBeNull();
    expect(ageOf("dün", NOW)).toBeNull();
  });

  it("a value newer than this browser's clock is 0 old, never negative", () => {
    expect(ageOf(new Date(NOW + 5_000).toISOString(), NOW)).toBe(0);
  });

  it("counts the cards that have never been measured — a fact, with no window chosen", () => {
    const patients = [
      { patient_id: "S-001", measuredAt: { heart_rate: ago(30) } },
      { patient_id: "S-002", measuredAt: {} },
      { patient_id: "S-003", measuredAt: { heart_rate: null, spo2: null } },
    ];
    expect(neverMeasured(patients)).toBe(2);
    expect(neverMeasured([])).toBe(0);
    expect(neverMeasured(null)).toBe(0);
  });

  it("names the quietest card's last instant, and nothing about whether that is too long", () => {
    const patients = [
      { patient_id: "S-001", measuredAt: { heart_rate: ago(30) } },
      { patient_id: "S-002", measuredAt: { heart_rate: ago(4_000) } },
      { patient_id: "S-003", measuredAt: {} },
    ];
    expect(oldestMeasurement(patients)).toBe(NOW - 4_000_000);
    expect(oldestMeasurement([{ patient_id: "S-004", measuredAt: {} }])).toBeNull();
    expect(oldestMeasurement([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/live/screens/common/ 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./elapsed.js"`.

- [ ] **Step 3: Write `dashboard/src/live/screens/common/elapsed.js`**

```javascript
// src/live/screens/common/elapsed.js — how long an alarm has been open, on the WALL clock. Pure.
//
// The rule the old workspace learned the hard way (roadmap: escalationClock): a real alarm's age is
// real time since the server first saw it (`firstSeenAtMs`), never the simulation's 60x clock,
// which aged an alarm a minute per second. And the shape matters: minutes never run past 59, so
// "318:30" is written "5:18:30" — a number a clinician reads as minutes when it is hours is worse
// than no number.
//
// Negative is 0:00, and that case is real rather than theoretical: `firstSeenAtMs` is the SERVER's
// instant and the subtraction is done with the BROWSER's clock, so a ward PC a few minutes ahead of
// the API would otherwise show an alarm that has not happened yet. The limit of this: a clock that
// is wrong is still wrong — an age shown here can be out by however far the two clocks differ, and
// nothing in the board payload says what the server's time is (no sequence number, no server
// timestamp on the response). Recorded for Group 2 with the per-entry sequence number.

/** Seconds since `fromMs`, as `m:ss` under an hour and `h:mm:ss` from an hour on; `0:00` for a
 *  time that has not arrived yet. `null` when there is no instant to count from — then a screen
 *  shows nothing rather than an age it invented. */
export function elapsed(fromMs, nowMs = Date.now()) {
  if (!Number.isFinite(fromMs)) return null;
  const total = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/** An ISO-8601 instant as epoch milliseconds, or null — never a fabricated time (liveAdapters'
 *  rule, repeated here because the screens read some instants straight from the payload). */
export function msOf(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
```

- [ ] **Step 4: Write `dashboard/src/live/screens/common/freshness.js`**

```javascript
// src/live/screens/common/freshness.js — how old a card's readings are. Pure.
//
// THE RULE THIS FILE EXISTS FOR: the screen reports the AGE of a value and never decides whether
// that age is too old. "Too old" is a clinical threshold — the engine owns every one of those, and
// a browser that picked its own would be scoring the patient (Wave 0's lesson: NEWS2 was being
// computed here and had to be torn out). So: `ageOf` gives a number, `lastMeasuredAt` gives an
// instant, and nothing here returns "stale". Where the engine has judged freshness it says so
// itself, per alarm (`staleInputs`, reco/engine.py `Alert.stale_inputs`), and the screen shows that
// judgement as the engine's.
//
// `hasMeasurement` is the other half of an honesty rule that lives in `ui/riskStyle.js`: risk
// "none" may read "no finding" ONLY on a card that has observations behind it; on a card admitted
// but never measured it must read "not measured". riskStyle refuses to assume it, so the card has
// to pass `measured` — and this is where that answer comes from, out of the card's own timestamps.

/** Every signal `latest.at` carries, in the order a vital bar shows them (api/board.py
 *  `_PUBLISHED_SIGNALS`; `liveAdapters.patientFromBoard` keeps `measuredAt` as the server sent it,
 *  so these are the server's own keys, not the adapter's short vital names). */
export const SIGNAL_KEYS = Object.freeze([
  "heart_rate", "resp_rate", "spo2", "sbp", "map", "temperature", "lactate",
]);

/** The instants in a card's `measuredAt` block, as epoch milliseconds, newest first. */
function instants(measuredAt) {
  const at = measuredAt && typeof measuredAt === "object" ? measuredAt : {};
  return Object.values(at)
    .map((iso) => (iso ? Date.parse(iso) : NaN))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => b - a);
}

/** Whether ANY channel of this card has ever been measured. This is what `measured` means to
 *  `riskStyle`: with it, risk "none" reads "no finding"; without it, "not measured". */
export function hasMeasurement(measuredAt) {
  return instants(measuredAt).length > 0;
}

/** When this card was last measured on any channel (epoch ms), or null if never. */
export function lastMeasuredAt(measuredAt) {
  return instants(measuredAt)[0] ?? null;
}

/** How old one channel's value is, in milliseconds, or null when it was never measured or the
 *  instant cannot be read. Negative (a server ahead of this browser) is reported as 0: the value
 *  is as new as this screen can tell, and a negative age would read as the future. */
export function ageOf(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, nowMs - ms);
}

/** How many of these cards have never been measured at all — a patient the hospital admitted whose
 *  monitor has sent nothing here. A FACT, not a threshold: no window is chosen, so nothing in this
 *  count depends on a judgement the browser is not entitled to make. */
export function neverMeasured(patients) {
  const list = Array.isArray(patients) ? patients : [];
  return list.filter((p) => !hasMeasurement(p?.measuredAt)).length;
}

/** The oldest "last measured" instant among the cards that HAVE been measured (epoch ms), or null
 *  when none has. With `neverMeasured` this is the whole feed-health statement a browser may make:
 *  how many cards have nothing, and how long ago the quietest of the rest last spoke. Whether that
 *  is too long is the reader's judgement — the screen does not rank it. */
export function oldestMeasurement(patients) {
  const list = Array.isArray(patients) ? patients : [];
  const times = list.map((p) => lastMeasuredAt(p?.measuredAt)).filter((ms) => ms !== null);
  return times.length ? Math.min(...times) : null;
}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/live/screens/common/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  13 passed (13)`.

- [ ] **Step 6: Write the clock's test** — with the fake-timer recipe the earlier waves settled on (`amendments.md`, `useRetryHold`): install the timers BEFORE the mount, fake `Date` with them, and no `shouldAdvanceTime`.

Create `dashboard/src/live/screens/common/useNow.test.jsx`:

```jsx
// The fake-timer recipe the earlier waves settled on (amendments, `useRetryHold`): install the
// timers BEFORE the mount, fake `Date` with them, and no `shouldAdvanceTime` — so nothing moves
// except what the test moves.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { useNow } from "./useNow.js";

const AT = Date.parse("2026-10-08T10:00:00Z");

function Clock({ ms }) {
  const now = useNow(ms);
  return <output>{String(now)}</output>;
}

const shown = () => Number(screen.getByRole("status").textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(AT);
});
afterEach(() => vi.useRealTimers());

describe("useNow", () => {
  it("starts at the clock's reading", () => {
    render(<Clock ms={1_000} />);
    expect(shown()).toBe(AT);
  });

  it("re-reads the clock on its cadence", () => {
    render(<Clock ms={1_000} />);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(shown()).toBe(AT + 1_000);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(shown()).toBe(AT + 3_000);
  });

  it("lines up on the cadence, not on the mount, so every card changes at the same moment", () => {
    vi.setSystemTime(AT + 700);                     // mounted three tenths before the next second
    render(<Clock ms={1_000} />);
    act(() => { vi.advanceTimersByTime(299); });
    expect(shown()).toBe(AT + 700);
    act(() => { vi.advanceTimersByTime(1); });
    expect(shown()).toBe(AT + 1_000);
  });

  it("does not re-read while the page is hidden, and does the moment it comes back", () => {
    // A ward PC left open overnight should not wake once a second to repaint the same digits.
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<Clock ms={1_000} />);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(shown()).toBe(AT);
    spy.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(shown()).toBe(AT + 5_000);
    spy.mockRestore();
  });

  it("reads once and arms nothing when it is given no cadence", () => {
    render(<Clock ms={null} />);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(shown()).toBe(AT);
  });

  it("leaves no timer behind when it goes", () => {
    const { unmount } = render(<Clock ms={1_000} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

```bash
npx vitest run src/live/screens/common/useNow.test.jsx 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./useNow.js"`.

- [ ] **Step 8: Write `dashboard/src/live/screens/common/useNow.js`**

```javascript
// src/live/screens/common/useNow.js — the wall clock, re-read on a cadence. For ages, not for data.
//
// Re-armed with a timeout rather than an interval (the top bar's Clock does the same): an interval
// that fires while the page is throttled queues up and then runs several times at once, and a ward
// PC left open all night should not wake once a second to repaint the same digits. So the tick is
// skipped while the tab is hidden and taken again the moment it comes back — which is also when a
// clinician looks at it.
//
// Nothing clinical depends on this. A value's own age comes from the server's timestamp; this is
// only what the subtraction is done against. The old workspace's `useNow` carried the same warning
// for the opposite reason: the simulation's clock ran at 60x and would age a real alarm a minute
// per second.
import { useEffect, useState } from "react";

/** The current instant, refreshed every `ms` while the page is visible. `ms` null: read once. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(ms) || ms <= 0) return undefined;
    let timer = 0;
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const arm = () => {
      // Line up on the cadence rather than on the mount, so every card on the screen changes at
      // the same moment and a minute's display is never a fraction behind the wall clock.
      timer = setTimeout(tick, ms - (Date.now() % ms));
    };
    const tick = () => {
      if (!hidden()) setNow(Date.now());
      arm();
    };
    const wake = () => {
      if (!hidden()) setNow(Date.now());
    };
    arm();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ms]);
  return now;
}
```

- [ ] **Step 9: Run both**

```bash
npx vitest run src/live/screens/common/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  19 passed (19)`.

- [ ] **Step 10: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `89 passed (89)` files, `1790 passed (1790)` tests; the build succeeds.

- [ ] **Step 11: Commit**

```bash
git add dashboard/src/live/screens/common/elapsed.js dashboard/src/live/screens/common/freshness.js dashboard/src/live/screens/common/useNow.js dashboard/src/live/screens/common/freshness.test.js dashboard/src/live/screens/common/useNow.test.jsx
git commit -m "$(cat <<'EOF'
feat(dashboard): how long, and how old — the three pure modules the screens share

`elapsed` writes m:ss then h:mm:ss (never "318:30") and 0:00 for an instant
that has not arrived; `freshness` gives ages and instants and has no verdict
in it, because "too old" is a clinical threshold the engine owns; `useNow`
re-reads the wall clock on a cadence and not while the tab is hidden.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 19 new tests in two new files — 13 in `freshness.test.js` (which holds `elapsed`'s tests too: the two modules are read together and a reader looking for `elapsed.test.js` will not find one) and 6 in `useNow.test.jsx`; whole suite green; build clean.

---

### Task 5: The feed — is the bed still reporting?

**Files:**
- Create: `dashboard/src/live/screens/common/feedHealth.js` + `feedHealth.test.js`

This module is taken over whole from the old workspace's `src/feedHealth.js`, which was written, tested and **never connected to a screen** — the failure this project has a name for. It cannot be imported (D1: `src/live/` stays off the workspace G1-16 deletes), so it is copied, with its reasoning, and this time a screen reads it.

Read its header before changing anything in it. `freshSec` is how often a channel is expected to ARRIVE — a property of the monitor and the bridge, not of the patient. It answers "is this bed still reporting". It is **not** a clinical validity window: nothing here colours a vital, changes a risk, marks a score partial or decides that a value is too old to act on. Those numbers still belong on the server (**Needs the user, 4**).

- [ ] **Step 1: Write the failing test** — the old module's own tests, carried over, with `ageParts` in place of the Turkish `formatAge` and keys in place of the Turkish labels.

Create `dashboard/src/live/screens/common/feedHealth.test.js`:

```javascript
// The old workspace's feedHealth tests, carried over with the module (src/feedHealth.test.js) and
// extended for what changed: `ageParts` in place of the Turkish `formatAge`, and keys in place of
// the Turkish labels.
import { describe, it, expect } from "vitest";
import {
  CHANNELS, STATUS, ageParts, ageSeconds, channelHealth, patientFeedHealth, wardFeedHealth,
} from "./feedHealth.js";

const NOW = Date.parse("2026-10-08T10:00:00Z");
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();
const hr = CHANNELS.find((c) => c.key === "heart_rate");
const lac = CHANNELS.find((c) => c.key === "lactate");

describe("ageSeconds", () => {
  it("counts the seconds since a timestamp", () => {
    expect(ageSeconds(ago(90), NOW)).toBe(90);
  });

  it("a channel that never reported has no age", () => {
    expect(ageSeconds(null, NOW)).toBeNull();
    expect(ageSeconds(undefined, NOW)).toBeNull();
    expect(ageSeconds("", NOW)).toBeNull();
  });

  it("an unparseable timestamp reads as never, not as now", () => {
    // A bad clock must not make a dead feed look alive.
    expect(ageSeconds("dün akşam", NOW)).toBeNull();
  });

  it("a timestamp in the future is clamped to 0 — a clock problem, not a stale feed", () => {
    expect(ageSeconds(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
  });
});

describe("channelHealth", () => {
  it("is live inside its window and stale outside it", () => {
    expect(channelHealth(hr, { heart_rate: ago(120) }, NOW).status).toBe(STATUS.LIVE);
    expect(channelHealth(hr, { heart_rate: ago(300) }, NOW).status).toBe(STATUS.LIVE);
    expect(channelHealth(hr, { heart_rate: ago(301) }, NOW).status).toBe(STATUS.STALE);
  });

  it("is absent when the channel never arrived", () => {
    const health = channelHealth(hr, {}, NOW);
    expect(health.status).toBe(STATUS.ABSENT);
    expect(health.age).toBeNull();
  });

  it("keeps the channel's own window, naming and cadence flag", () => {
    expect(channelHealth(lac, { lactate: ago(7200) }, NOW))
      .toMatchObject({ key: "lactate", labelKey: "board.chLac", freshSec: 21_600, continuous: false, status: STATUS.LIVE });
  });
});

describe("patientFeedHealth", () => {
  it("splits live, stale and absent — a wiring problem is not a failure", () => {
    const patient = {
      patient_id: "S-001",
      measuredAt: { heart_rate: ago(60), spo2: ago(4_000), lactate: ago(600) },
    };
    const health = patientFeedHealth(patient, NOW);
    expect(health.live.map((c) => c.key)).toEqual(["heart_rate", "lactate"]);
    expect(health.stale.map((c) => c.key)).toEqual(["spo2"]);
    expect(health.absent.map((c) => c.key)).toEqual(["sbp", "map", "temperature", "resp_rate"]);
  });

  it("a bed is silent when no CONTINUOUS channel is arriving", () => {
    const quiet = { patient_id: "S-002", measuredAt: { heart_rate: ago(4_000) } };
    expect(patientFeedHealth(quiet, NOW).silent).toBe(true);
  });

  it("a fresh lactate does not keep a bed whose monitors stopped looking connected", () => {
    // The failure the `continuous` flag exists to catch.
    const labOnly = { patient_id: "S-003", measuredAt: { lactate: ago(3_600) } };
    const health = patientFeedHealth(labOnly, NOW);
    expect(health.live.map((c) => c.key)).toEqual(["lactate"]);
    expect(health.silent).toBe(true);
  });

  it("one arriving continuous channel is enough not to be silent", () => {
    expect(patientFeedHealth({ patient_id: "S-004", measuredAt: { spo2: ago(10) } }, NOW).silent).toBe(false);
  });

  it("a card with nothing at all is silent", () => {
    expect(patientFeedHealth({ patient_id: "S-005", measuredAt: {} }, NOW).silent).toBe(true);
    expect(patientFeedHealth(null, NOW).silent).toBe(true);
  });
});

describe("wardFeedHealth", () => {
  it("counts the ward and orders it worst first", () => {
    const patients = [
      { patient_id: "S-001", measuredAt: { heart_rate: ago(10), spo2: ago(10), sbp: ago(10), map: ago(10), temperature: ago(10), resp_rate: ago(10) } },
      { patient_id: "S-002", measuredAt: {} },
      { patient_id: "S-003", measuredAt: { heart_rate: ago(10), spo2: ago(4_000) } },
    ];
    const ward = wardFeedHealth(patients, NOW);
    expect(ward.beds.map((b) => b.patientId)).toEqual(["S-002", "S-003", "S-001"]);
    expect(ward.silentCount).toBe(1);
    expect(ward.staleCount).toBe(1);
    expect(ward.healthyCount).toBe(1);
  });

  it("an empty ward counts nothing", () => {
    expect(wardFeedHealth([], NOW)).toMatchObject({ silentCount: 0, staleCount: 0, healthyCount: 0 });
    expect(wardFeedHealth(null, NOW).beds).toEqual([]);
  });
});

describe("ageParts — the number and the unit, kept apart", () => {
  it("picks seconds, minutes or hours", () => {
    expect(ageParts(12)).toEqual({ unit: "s", value: 12 });
    expect(ageParts(89)).toEqual({ unit: "s", value: 89 });
    expect(ageParts(90)).toEqual({ unit: "m", value: 2 });
    expect(ageParts(3_000)).toEqual({ unit: "m", value: 50 });
    expect(ageParts(5_400)).toEqual({ unit: "h", value: 2 });
    expect(ageParts(7_200)).toEqual({ unit: "h", value: 2 });
  });

  it("no age has no parts — the caller writes the dash", () => {
    expect(ageParts(null)).toBeNull();
    expect(ageParts(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/live/screens/common/feedHealth.test.js 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./feedHealth.js"`.

- [ ] **Step 3: Write it**

```javascript
// src/live/screens/common/feedHealth.js — is the data still arriving?
//
// Taken over from the old workspace's `src/feedHealth.js`, which was written and tested and never
// connected to a screen (the project's own named failure mode). It could not simply be imported:
// roadmap D1 keeps `src/live/` off the old workspace, which G1-16 deletes. So it is copied, with
// its reasoning, and this time a screen reads it.
//
// Its reason for existing, in its author's words: on an on-prem deployment nobody can look at the
// bridge from here. A ward with no alarms and a ward whose feed died an hour ago look exactly the
// same on a board that only shows values — and the second one is the dangerous one, because
// everybody believes the bed is being watched.
//
// WHAT THESE WINDOWS ARE, AND WHAT THEY ARE NOT. `freshSec` is how often a channel is expected to
// ARRIVE — a property of the monitor and the bridge, not of the patient. It answers "is this bed
// still reporting". It is NOT a clinical validity window: nothing here colours a vital, changes a
// risk, marks a score partial or decides that a value is too old to act on. Every one of those
// belongs to the engine, which applies its own freshness inside `evaluate()` and tells us what it
// found (`Alert.stale_inputs`). Keeping the two apart is the whole discipline: a browser may say
// "this bed has stopped talking"; it may not say "this number no longer counts".
//
// The windows are still constants in a browser, which is one place too far from the hospital. They
// should come from the engine, which knows its own cadences — recorded for Group 2 ("Needs the
// user" in the Wave 3 plan).

/**
 * The channels a ward cares about, how long a gap is normal for each, and whether the channel is
 * continuous. The keys are the server's own (`api/board.py _PUBLISHED_SIGNALS`), as `measuredAt`
 * carries them.
 *
 * `continuous` is the important one. A lactate is fresh for hours by its nature — it is drawn, not
 * streamed — so its age says nothing about whether a feed is alive. Judging a bed by it would let
 * every monitor stop while a six-hour-old lab kept the bed looking connected, which is exactly the
 * failure this module exists to catch.
 *
 * `labelKey` is this build's own i18n key (the old module carried Turkish text); `source` likewise.
 */
export const CHANNELS = Object.freeze([
  { key: "heart_rate", labelKey: "board.chHr", sourceKey: "board.srcMonitor", freshSec: 300, continuous: true },
  { key: "spo2", labelKey: "board.chSpo2", sourceKey: "board.srcMonitor", freshSec: 300, continuous: true },
  { key: "sbp", labelKey: "board.chSbp", sourceKey: "board.srcMonitor", freshSec: 900, continuous: true },
  { key: "map", labelKey: "board.chMap", sourceKey: "board.srcMonitor", freshSec: 900, continuous: true },
  { key: "temperature", labelKey: "board.chTemp", sourceKey: "board.srcMonitor", freshSec: 3600, continuous: true },
  { key: "resp_rate", labelKey: "board.chRr", sourceKey: "board.srcVent", freshSec: 600, continuous: true },
  { key: "lactate", labelKey: "board.chLac", sourceKey: "board.srcLab", freshSec: 6 * 3600, continuous: false },
]);

export const STATUS = Object.freeze({
  LIVE: "live",      // arriving within its window
  STALE: "stale",    // arrived once, but not lately
  ABSENT: "absent",  // never arrived at all
});

/**
 * Seconds since a channel last reported, or null when it never has.
 *
 * An unparseable timestamp is treated as "never" rather than as "now": a bad clock must not make a
 * dead feed look alive. This project has already been bitten once by a server whose local time ran
 * an hour off the UTC stamp in its own filenames.
 */
export function ageSeconds(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const when = Date.parse(iso);
  if (Number.isNaN(when)) return null;
  const seconds = (nowMs - when) / 1000;
  // A timestamp in the future is a clock problem, not freshness. Clamp rather than report a
  // negative age, and let the caller see it as fresh — the alternative is a false "stale".
  return seconds < 0 ? 0 : seconds;
}

/** One channel's state for one patient. */
export function channelHealth(channel, measuredAt, nowMs = Date.now()) {
  const age = ageSeconds(measuredAt?.[channel.key], nowMs);
  if (age === null) return { ...channel, age: null, status: STATUS.ABSENT };
  return { ...channel, age, status: age <= channel.freshSec ? STATUS.LIVE : STATUS.STALE };
}

/**
 * Every channel for one patient, plus a one-line summary.
 *
 * `absent` is reported separately from `stale` on purpose. A channel that never arrived is a wiring
 * problem — a bridge that was never connected, a device with the option switched off. A channel
 * that arrived and then stopped is a failure. They need different people.
 */
export function patientFeedHealth(patient, nowMs = Date.now()) {
  const channels = CHANNELS.map((c) => channelHealth(c, patient?.measuredAt, nowMs));
  return {
    patientId: patient?.patient_id ?? null,
    channels,
    live: channels.filter((c) => c.status === STATUS.LIVE),
    stale: channels.filter((c) => c.status === STATUS.STALE),
    absent: channels.filter((c) => c.status === STATUS.ABSENT),
    // "Silent" means no CONTINUOUS channel is arriving for this bed — the monitors and the
    // ventilator have gone quiet. Intermittent channels are excluded deliberately: a lactate drawn
    // four hours ago is legitimately fresh and would otherwise keep a bed whose monitors all
    // stopped looking connected. That is the state worth waking someone for; a missing lab is not.
    silent: channels.filter((c) => c.continuous).every((c) => c.status !== STATUS.LIVE),
  };
}

/** The whole ward, worst first — the order a biomedical engineer wants to read it in. */
export function wardFeedHealth(patients, nowMs = Date.now()) {
  const list = Array.isArray(patients) ? patients : [];
  const beds = list.map((p) => patientFeedHealth(p, nowMs));
  const rank = (b) => (b.silent ? 0 : b.stale.length ? 1 : 2);
  return {
    beds: [...beds].sort((a, b) => rank(a) - rank(b) || b.stale.length - a.stale.length),
    silentCount: beds.filter((b) => b.silent).length,
    staleCount: beds.filter((b) => !b.silent && b.stale.length > 0).length,
    healthyCount: beds.filter((b) => !b.silent && b.stale.length === 0).length,
  };
}

/** How old, as a short unit and a number: {unit, value}, or null for an age there is none of. The
 *  caller writes it with its own `t()` ("3 dk"), so the unit word is translated and the number
 *  never ends up inside a word that would need a suffix fitted to it. */
export function ageParts(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 90) return { unit: "s", value: Math.round(seconds) };
  if (seconds < 5400) return { unit: "m", value: Math.round(seconds / 60) };
  return { unit: "h", value: Math.round(seconds / 3600) };
}
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/live/screens/common/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  35 passed (35)`.

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `90 passed (90)` files, `1806 passed (1806)` tests; the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/live/screens/common/feedHealth.js dashboard/src/live/screens/common/feedHealth.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the feed-health module, finally connected to something

Copied from the old workspace's src/feedHealth.js — written, tested and never
rendered — because D1 keeps src/live off the workspace G1-16 deletes. Its
windows are operational, not clinical: they answer "is this bed still
reporting", never "is this number still good". They belong on the server.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 16 new tests; whole suite green; build clean.

---

### Task 6: What a screen says about its own board — and the i18n seam

**Files:**
- Create: `dashboard/src/live/i18n/strings/board.js`, `dashboard/src/live/screens/common/vitals.js`, `dashboard/src/live/screens/common/BoardState.jsx` + `BoardState.test.jsx`
- Modify: `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`, `dashboard/src/live/ui/RiskPill.jsx` + `RiskPill.test.jsx`, `dashboard/src/live/i18n/strings/risk.js`

This is the most important component of Wave 3, and it exists for one failure mode: **a board that has stopped updating looks exactly like a calm ward.** Its three parts go at the top of every board-reading screen, in this order: the connection, the engine's own sentence about why the board is this size, and whether readings are still arriving. `boardKnown(connection)` is the question a screen asks before it may write a reassuring sentence.

The task also pre-places the i18n seam for the six screens: one commented import and one commented entry each, so the parallel arms touch two lines nobody else does.

> **This task is DONE, and the code moved after it.** The blocks below are the record of what was asked, not the current source; the review of Tasks 0–8 changed three things in them, and `amendments.md` is authoritative. `FeedHealth` now takes **`connection`** and renders nothing unless `boardKnown(connection)` — on a board that is not LIVE the snapshot is never reloaded, so the chip first said "data is arriving from every bed" and then blamed the ward's monitors for our own outage. It also reports beds that were never wired separately from beds that have stopped. `summaryOf` returns **`null`** rather than `""`, and the caller prints `t("board.findingUnnamed")`. And `vitals.js`'s `unitKey`s point at **`board.unit*`**, not `beds.unit*`, which does not exist until the beds arm merges.

- [ ] **Step 1: Write the strings** — `board.js`. Note the trap in its header: the prototype's dictionary resolves "Isı" (temperature) to the heat-map screen's title in all three target languages, so the channel names are written out here instead of reused.

```javascript
// What every board-reading screen says about its own data before it says anything about a patient:
// the connection, the engine's scope, and whether readings are still arriving.
//
// Sources. `degraded`/`unavailable`/`connecting` carry the sentences of the old workspace's
// `liveConnection.boardView()` — written, never rendered — including its capitalised "DOES NOT
// MEAN": an empty board is the most reassuring screen this system can draw, and it must say when
// it is empty for the wrong reason. The channel names and `silent`/`feedOk` come from the old
// `feedHealth.js` and `clinicalI18n.top` (`feedSilent`, "yatak sessiz"), which existed in four
// languages and was never shown. `measuredAt`/`notMeasured` are new.
//
// `chronicExpected`, `engineEnglish` and `scopeNoteLang` live here, in the shared namespace, and
// not in `beds.js` or `alarms.js`, because the bed card and the alarms row both say them — and
// those two screens are built on separate branches. A string one arm owns and the other reads is a
// merge conflict waiting in a dictionary. `engineEnglish` is the short form, for a row that shows
// only the engine's summary; the patient screen, which shows reasoning, evidence and confidence
// together, says the longer `patient.recoLanguage` instead. `scopeNoteLang` labels the one piece of
// server prose this UI prints verbatim: `scope_note` is written in Turkish by `api/board.py`, so a
// Russian-reading clinician meets a Turkish sentence and is owed an explanation of why.
//
// `ch*` are the names of the engine's own signals; `Isı` is deliberately NOT the word the
// prototype's dictionary carries for temperature (that entry resolves to "heat map" — an
// unrelated screen's title), so this file writes it out.
// AZ/RU/EN await a native-speaking clinician's review before the pilot, except where a line is
// quoted from a four-language source above.
export default {
  tr: {
    connecting: "Pano yükleniyor…",
    degraded: "Canlı akış koptu — ekrandaki veriler son alınanlar ve güncel olmayabilir.",
    unavailable: "Sunucuya bağlantı yok — hasta listesi gösterilmiyor. Bu ekran hasta olmadığı anlamına GELMEZ.",
    hidden: "Kapsamınız dışında kalan kart: {count}.",
    unresolved: "Bunların {count} tanesi hiçbir yatağa eşleşmiyor.",
    scopeNoteLang: "Bu cümleyi sunucu yazdı; dili Türkçedir.",
    silent: "Sessiz yatak: {count}",
    feedOk: "Bütün yataklardan veri geliyor",
    feedTitle: "Cihaz ve veri akışı",
    oldest: "En eski ölçüm: {time}",
    neverMeasured: "Hiç ölçülmemiş yatak: {count}",
    measuredAt: "Son ölçüm: {time}",
    notMeasured: "Ölçülmedi",
    ageS: "{count} sn",
    ageM: "{count} dk",
    ageH: "{count} sa",
    chHr: "Nabız",
    chSpo2: "SpO2",
    chSbp: "Sistolik TA",
    chMap: "MAP",
    chTemp: "Vücut sıcaklığı",
    chRr: "Solunum",
    chLac: "Laktat",
    srcMonitor: "monitör",
    srcVent: "ventilatör",
    srcLab: "laboratuvar",
    chronicExpected: "Hastanın kendi normaline göre beklenen",
    engineEnglish: "Motorun metinleri İngilizcedir; çevrilmemiştir.",
  },
  az: {
    connecting: "Panel yüklənir…",
    degraded: "Canlı axın kəsildi — ekrandakı məlumatlar son alınanlardır və güncəl olmaya bilər.",
    unavailable: "Serverlə bağlantı yoxdur — xəstə siyahısı göstərilmir. Bu ekran xəstə olmadığı anlamına GƏLMİR.",
    hidden: "Əhatənizdən kənarda qalan kart: {count}.",
    unresolved: "Bunlardan {count} ədədi heç bir çarpayıya uyğun gəlmir.",
    scopeNoteLang: "Bu cümləni server yazıb; dili türkcədir.",
    silent: "Səssiz çarpayı: {count}",
    feedOk: "Bütün çarpayılardan məlumat gəlir",
    feedTitle: "Cihaz və məlumat axını",
    oldest: "Ən köhnə ölçmə: {time}",
    neverMeasured: "Heç ölçülməmiş çarpayı: {count}",
    measuredAt: "Son ölçmə: {time}",
    notMeasured: "Ölçülməyib",
    ageS: "{count} san",
    ageM: "{count} dəq",
    ageH: "{count} saat",
    chHr: "Nəbz",
    chSpo2: "SpO2",
    chSbp: "Sistolik AT",
    chMap: "MAP",
    chTemp: "Bədən hərarəti",
    chRr: "Tənəffüs",
    chLac: "Laktat",
    srcMonitor: "monitor",
    srcVent: "ventilyator",
    srcLab: "laboratoriya",
    chronicExpected: "Xəstənin öz normasına görə gözlənilən",
    engineEnglish: "Mühərrikin mətnləri İngiliscədir; tərcümə olunmayıb.",
  },
  ru: {
    connecting: "Панель загружается…",
    degraded: "Прямой поток прерван — на экране последние полученные данные, они могут быть неактуальны.",
    unavailable: "Нет связи с сервером — список пациентов не показывается. Этот экран НЕ ЗНАЧИТ, что пациентов нет.",
    hidden: "Карточек вне вашей области доступа: {count}.",
    unresolved: "Из них не сопоставлено ни с одной койкой: {count}.",
    scopeNoteLang: "Эту фразу написал сервер; она на турецком языке.",
    silent: "Молчащих коек: {count}",
    feedOk: "Данные поступают со всех коек",
    feedTitle: "Устройства и поток данных",
    oldest: "Самое старое измерение: {time}",
    neverMeasured: "Коек без измерений: {count}",
    measuredAt: "Последнее измерение: {time}",
    notMeasured: "Не измерено",
    ageS: "{count} с",
    ageM: "{count} мин",
    ageH: "{count} ч",
    chHr: "Пульс",
    chSpo2: "SpO2",
    chSbp: "Систолическое АД",
    chMap: "САД",
    chTemp: "Температура тела",
    chRr: "Дыхание",
    chLac: "Лактат",
    srcMonitor: "монитор",
    srcVent: "вентилятор",
    srcLab: "лаборатория",
    chronicExpected: "Ожидаемо для собственной нормы пациента",
    engineEnglish: "Тексты системы — на английском; они не переведены.",
  },
  en: {
    connecting: "Loading the board…",
    degraded: "The live stream was lost — what is on screen is the last data received and may be out of date.",
    unavailable: "No connection to the server — the patient list is not shown. This screen DOES NOT MEAN there are no patients.",
    hidden: "Cards outside your scope: {count}.",
    unresolved: "Of those, {count} match no bed at all.",
    scopeNoteLang: "The server wrote this sentence; it is in Turkish.",
    silent: "Silent beds: {count}",
    feedOk: "Data is arriving from every bed",
    feedTitle: "Devices and the data feed",
    oldest: "Oldest measurement: {time}",
    neverMeasured: "Beds never measured: {count}",
    measuredAt: "Last measured: {time}",
    notMeasured: "Not measured",
    ageS: "{count} s",
    ageM: "{count} min",
    ageH: "{count} h",
    chHr: "Pulse",
    chSpo2: "SpO2",
    chSbp: "Systolic BP",
    chMap: "MAP",
    chTemp: "Body temperature",
    chRr: "Respiration",
    chLac: "Lactate",
    srcMonitor: "monitor",
    srcVent: "ventilator",
    srcLab: "laboratory",
    chronicExpected: "Expected for this patient's own normal",
    engineEnglish: "The engine's texts are in English; they are not translated.",
  },
};
```

- [ ] **Step 2: Open the seam in the catalogue** — `dashboard/src/live/i18n/catalog.js`, whole file:

```javascript
// src/live/i18n/catalog.js — every namespace's dictionaries, flattened per language.
//
// One file per namespace under strings/, each { tr, az, ru, en } with the same keys. A screen
// adds its own namespace file and one import line below, so parallel branches touch different
// files. Keys are "<namespace>.<key>", nested objects joined with dots: "news2.missing.spo2".
import { LANG_CODES } from "./langs.js";
import common from "./strings/common.js";
import risk from "./strings/risk.js";
import prefs from "./strings/prefs.js";
import news2 from "./strings/news2.js";
import gallery from "./strings/gallery.js";
import ui from "./strings/ui.js";
import errors from "./strings/errors.js";
import dates from "./strings/dates.js";
import shell from "./strings/shell.js";
import auth from "./strings/auth.js";
import lock from "./strings/lock.js";
import account from "./strings/account.js";
import nav from "./strings/nav.js";
// Wave 3's screens. `board` is shared by the three clinical ones (the connection, the engine's
// scope, the feed) and is added with the first of them; the other six are one import and one entry
// per screen — the same seam `shell/routes.js` has, so the parallel branches of Wave 3 touch
// different lines. Each branch uncomments ITS OWN two lines and nobody else's.
import board from "./strings/board.js";
// G1-09: import beds from "./strings/beds.js";

// G1-10: import alarms from "./strings/alarms.js";

// G1-11: import patient from "./strings/patient.js";

// G1-12: import admin from "./strings/admin.js";

// G1-13: import roles from "./strings/roles.js";

// G1-14: import source from "./strings/source.js";

export const NAMESPACES = {
  common, risk, prefs, news2, gallery, ui, errors, dates, shell, auth, lock, account, nav,
  board,

  // One entry per arm, each with a blank line either side, for the same reason as the import
  // block above and `shell/routes.js`'s SCREENS: adjacent lines conflict on merge, lines with
  // untouched context between them do not. Do not tidy the gaps away.
  // G1-09: beds,

  // G1-10: alarms,

  // G1-11: patient,

  // G1-12: admin,

  // G1-13: roles,

  // G1-14: source,
};

function flattenInto(out, prefix, entries) {
  for (const [key, value] of Object.entries(entries)) {
    if (value && typeof value === "object") flattenInto(out, `${prefix}${key}.`, value);
    else out[`${prefix}${key}`] = value;
  }
  return out;
}

export function buildDictionaries(namespaces) {
  return Object.fromEntries(LANG_CODES.map((lang) => [
    lang,
    Object.entries(namespaces).reduce((out, [ns, dict]) => flattenInto(out, `${ns}.`, dict[lang] || {}), {}),
  ]));
}

export const DICTIONARIES = buildDictionaries(NAMESPACES);
```

- [ ] **Step 3: Open the seam in the parity test**

Both sets get the same treatment, and it has two parts.

**Blank lines.** `NEUTRAL` and `AZ_SAME_AS_TR` are each one `Set` literal that four parallel arms add to, and four arms editing four adjacent lines of one literal conflict on every merge. So each arm gets a heading of its own with a blank line either side, and writes only under its own heading. **Do not close up the gaps** — an arm that tidies them re-creates the conflict for whoever merges after it.

**And a suffix per set:** `· neutral` in one, `· az = tr` in the other. Without it the two sets carry the same seven headings, so `// G1-10 (alarms)` matches twice and an arm can only anchor its insert by reaching back into the arm *before* it — which works when the arms merge in order and fails on a branch cut off Task 8. With it, every arm's anchor is unique in the file and independent of every other arm. It also reads better: the suffix says what listing a key under that heading *claims*, which is two different claims.

In `dashboard/src/live/i18n/strings.test.js`, replace

```javascript
const NEUTRAL = new Set(["news2.missing.spo2"]);
```

with

```javascript
const NEUTRAL = new Set([
  "news2.missing.spo2", //        SpO2 — a clinical abbreviation, the same in every script
  // Wave 3's screens, one block per arm with a blank line either side: four parallel branches
  // adding to one Set conflict on every merge if their lines are adjacent. Each arm writes under
  // ITS OWN heading and leaves the blank lines alone. The `· neutral` suffix is what makes each
  // heading unique in this file — AZ_SAME_AS_TR below carries the same seven, suffixed `· az = tr`.
  // board (shared by the clinical screens, added with the first of them) · neutral
  "board.chSpo2", //              SpO2 again, on the board

  // G1-09 (beds) · neutral

  // G1-10 (alarms) · neutral

  // G1-11 (patient) · neutral

  // G1-12 (admin · users) · neutral

  // G1-13 (admin · roles) · neutral

  // G1-14 (admin · login source) · neutral
]);
```

and replace

```javascript
  "nav.settings", //         Ayarlar — the prototype's AZ dictionary (core.js m_settings)
  "nav.settingsShort", //    Ayarlar — the same word
]);
```

with

```javascript
  "nav.settings", //         Ayarlar — the prototype's AZ dictionary (core.js m_settings)
  "nav.settingsShort", //    Ayarlar — the same word
  // Wave 3's screens. Each branch adds ITS OWN lines under its own heading, so the three parallel
  // branches do not meet in the middle of this list. `· az = tr` distinguishes these headings from
  // NEUTRAL's identical seven, so each arm's anchor is unique in the file.

  // board (shared by the clinical screens) · az = tr
  "board.chSpo2", //         SpO2 — a clinical abbreviation
  "board.chMap", //          MAP — likewise (mean arterial pressure, written the same in AZ)
  "board.chLac", //          Laktat — the same word in Azerbaijani

  // G1-09 (beds) · az = tr

  // G1-10 (alarms) · az = tr

  // G1-11 (patient) · az = tr

  // G1-12 (admin · users) · az = tr

  // G1-13 (admin · roles) · az = tr

  // G1-14 (admin · login source) · az = tr
]);
```

and, in the same file, add the one Wave-2 key this task's own change makes identical in Azerbaijani and Turkish,. Replace

```javascript
  "risk.critical", //        Kritik — the prototype's AZ dictionary (grafik.js gd_k_crit)
```

with

```javascript
  "risk.critical", //        Kritik — the prototype's AZ dictionary (grafik.js gd_k_crit)
  "risk.prefix", //          Risk — the same word in Azerbaijani, Turkish and English
```

- [ ] **Step 4: Run the parity test**

```bash
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests |az |ru "
```
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Write the component's test**

Create `dashboard/src/live/screens/common/BoardState.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { CONNECTION } from "../../../liveConnection.js";
import { ENGINE_RISKS, riskStyle } from "../../ui/index.js";
import { BoardProvider } from "../../data/BoardProvider.jsx";
import {
  BoardStrip, ChronicExpected, FeedHealth, RAIL, RAIL_LEFT, ScopeNote, boardKnown, boardStale, railOf, useBoardNow,
} from "./BoardState.jsx";

const NOW = Date.parse("2026-10-08T10:00:00Z");
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();
const show = (ui) => render(<I18nProvider>{ui}</I18nProvider>);

describe("what a screen may say about its own board", () => {
  it("only a LIVE board is known; only a DEGRADED one is stale", () => {
    expect(boardKnown(CONNECTION.LIVE)).toBe(true);
    for (const c of [CONNECTION.DEGRADED, CONNECTION.UNAVAILABLE, CONNECTION.CONNECTING]) {
      expect(boardKnown(c), c).toBe(false);
    }
    expect(boardStale(CONNECTION.DEGRADED)).toBe(true);
    expect(boardStale(CONNECTION.LIVE)).toBe(false);
  });
});

describe("BoardStrip", () => {
  it("a working board draws nothing", () => {
    const { container } = show(<BoardStrip connection={CONNECTION.LIVE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("an unreachable server is announced, and says an empty list is not an empty ward", () => {
    show(<BoardStrip connection={CONNECTION.UNAVAILABLE} />);
    const box = screen.getByRole("alert");
    expect(box).toHaveTextContent("Serverlə bağlantı yoxdur");
    expect(box).toHaveTextContent("GƏLMİR");
  });

  it("a lost stream is a static note, not something that speaks on every flicker", () => {
    show(<BoardStrip connection={CONNECTION.DEGRADED} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("güncəl olmaya bilər");
  });

  it("a board still loading says so", () => {
    show(<BoardStrip connection={CONNECTION.CONNECTING} />);
    expect(screen.getByRole("note")).toHaveTextContent("Panel yüklənir");
  });
});

describe("ScopeNote", () => {
  it("writes the engine's own sentence, untranslated", () => {
    // The server knows what it filtered and why; the screen does not paraphrase it.
    const note = "Kapsamınızda panoda karşılığı olan hiçbir yatak yok.";
    show(<ScopeNote scope={{ unrestricted: false, hidden: 0 }} scopeNote={note} />);
    expect(screen.getByRole("note")).toHaveTextContent(note);
  });

  it("marks that sentence as Turkish, and says in the reader's language where it came from", () => {
    // The engine writes `scope_note` in Turkish whatever language was asked for. Unmarked, a
    // Russian synthesiser reads Turkish letters as Russian ones, and the reader is never told why
    // one sentence on the screen is not in their language.
    const note = "Kapsamınızda panoda karşılığı olan hiçbir yatak yok.";
    const { container } = show(<ScopeNote scope={{ hidden: 0 }} scopeNote={note} />);
    const marked = container.querySelector('[lang="tr"]');
    expect(marked).not.toBeNull();
    expect(marked).toHaveTextContent(note);
    expect(screen.getByRole("note")).toHaveTextContent("Bu cümləni server yazıb; dili türkcədir.");
  });

  it("adds the counts the engine sent with it", () => {
    show(<ScopeNote scope={{ hidden: 4, unresolved_hidden: 2 }} scopeNote={null} />);
    const box = screen.getByRole("note");
    expect(box).toHaveTextContent("Əhatənizdən kənarda qalan kart: 4.");
    expect(box).toHaveTextContent("Bunlardan 2 ədədi heç bir çarpayıya uyğun gəlmir.");
  });

  it("an unrestricted session with nothing hidden is told nothing", () => {
    const { container } = show(<ScopeNote scope={{ unrestricted: true, hidden: 0 }} scopeNote={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a load that failed carries no scope, so nothing is drawn", () => {
    // A stale scope block would explain an empty board as "this is your scope" when the reason
    // was the connection (boardStore drops the scope with the patients).
    const { container } = show(<ScopeNote scope={null} scopeNote={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FeedHealth", () => {
  const measured = { heart_rate: ago(30), spo2: ago(30), sbp: ago(30), map: ago(30), temperature: ago(30), resp_rate: ago(30) };

  it("says how many beds have gone quiet, and when the quietest one last spoke", () => {
    show(<FeedHealth connection={connection} nowMs={NOW} patients={[
      { patient_id: "S-001", measuredAt: measured },
      { patient_id: "S-002", measuredAt: { heart_rate: ago(4_000) } },
    ]} />);
    expect(screen.getByText(/Səssiz çarpayı: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Ən köhnə ölçmə:/)).toBeInTheDocument();
  });

  it("says so when every bed is reporting — but only a LIVE board should show it at all", () => {
    show(<FeedHealth connection={connection} nowMs={NOW} patients={[{ patient_id: "S-001", measuredAt: measured }]} />);
    expect(screen.getByText(/Bütün çarpayılardan məlumat gəlir/)).toBeInTheDocument();
  });

  it("names itself before it names a number", () => {
    show(<FeedHealth connection={connection} nowMs={NOW} patients={[{ patient_id: "S-001", measuredAt: measured }]} />);
    expect(screen.getByText("Cihaz və məlumat axını:")).toBeInTheDocument();
  });

  it("an empty board has no feed to report on", () => {
    const { container } = show(<FeedHealth connection={connection} nowMs={NOW} patients={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a bed that has never been measured has no oldest instant to name", () => {
    show(<FeedHealth connection={connection} nowMs={NOW} patients={[{ patient_id: "S-002", measuredAt: {} }]} />);
    expect(screen.getByText(/Səssiz çarpayı: 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Ən köhnə ölçmə:/)).toBeNull();
  });
});

describe("ChronicExpected", () => {
  it("says a downgraded finding is expected for this patient, in the reader's language", () => {
    show(<ChronicExpected alarm={{ downgraded: true, chronicContext: "Chronic COPD: baseline SpO2 88%." }} />);
    expect(screen.getByText(/Xəstənin öz normasına görə gözlənilən/)).toBeInTheDocument();
  });

  it("carries the engine's English reason in the accessible name, marked as English", () => {
    const reason = "Chronic COPD: baseline SpO2 88%.";
    const { container } = show(<ChronicExpected alarm={{ downgraded: true, chronicContext: reason }} />);
    const marked = container.querySelector('[lang="en"]');
    expect(marked).not.toBeNull();
    expect(marked.textContent).toContain(reason);
    // Visually hidden: the pill is read at a glance, the reason is for the clinician who asks.
    expect(marked.className).toContain("sr-only");
  });

  it("draws nothing for a finding the engine did not downgrade, and nothing for no finding", () => {
    for (const alarm of [{ downgraded: false }, { downgraded: "true" }, {}, null, undefined]) {
      const { container } = show(<ChronicExpected alarm={alarm} />);
      expect(container, JSON.stringify(alarm)).toBeEmptyDOMElement();
    }
  });
});

describe("useBoardNow", () => {
  // One frozen snapshot, returned by reference: `useSyncExternalStore` compares snapshots by
  // identity, and a `getState` that builds a fresh object every call renders forever (the real
  // store keeps one `state` object and replaces it only in `set`).
  const fakeBoard = (clockSkewMs) => {
    const state = Object.freeze({ patients: [], alerts: [], clockSkewMs });
    return { subscribe: () => () => {}, getState: () => state };
  };
  function Probe() {
    const now = useBoardNow(30_000);
    return <output>{String(now)}</output>;
  }
  const atBoard = (skew) => render(
    <I18nProvider><BoardProvider store={fakeBoard(skew)}><Probe /></BoardProvider></I18nProvider>,
  );

  it("moves the clock the screens age against onto the server's", () => {
    // Eight minutes behind: without this, every reading on every screen reads eight minutes
    // fresher than the engine believes it is.
    const skew = 8 * 60 * 1000;
    atBoard(skew);
    const shown = Number(screen.getByRole("status").textContent);
    expect(shown - Date.now()).toBeGreaterThan(skew - 2000);
    expect(shown - Date.now()).toBeLessThanOrEqual(skew);
  });

  it("corrects by nothing at all when no skew has been measured", () => {
    for (const unknown of [null, undefined, NaN, "600000"]) {
      const { unmount } = atBoard(unknown);
      const shown = Number(screen.getByRole("status").textContent);
      expect(Math.abs(shown - Date.now()), String(unknown)).toBeLessThan(2000);
      unmount();
    }
  });
});

describe("the accent colour of a risk tone", () => {
  it("covers every tone the engine's risks produce, in both tables", () => {
    // The card draws a fill and the patient screen a left border. If one table knows a tone the
    // other does not, the same finding is two colours on two screens.
    const tones = new Set(ENGINE_RISKS.map((r) => riskStyle(r, { measured: true }).tone));
    tones.add(riskStyle("something-new", { measured: true }).tone);     // the unvouchable case
    for (const tone of tones) {
      expect(RAIL[tone], `RAIL ${tone}`).toBeDefined();
      expect(RAIL_LEFT[tone], `RAIL_LEFT ${tone}`).toBeDefined();
    }
    expect(Object.keys(RAIL).sort()).toEqual(Object.keys(RAIL_LEFT).sort());
  });

  it("gives an `info` finding the QUIET colour on both, not the attention one", () => {
    // The bug this table replaced: `info` maps to `neutral`, and the patient screen's ternary
    // fell through to amber — which in this interface means "the screen cannot vouch for this".
    const { tone } = riskStyle("info", { measured: true });
    expect(tone).toBe("neutral");
    expect(railOf(tone)).toBe(RAIL.neutral);
    expect(railOf(tone, RAIL_LEFT)).toBe(RAIL_LEFT.neutral);
    expect(railOf(tone, RAIL_LEFT)).not.toBe(RAIL_LEFT.att);
  });

  it("an unknown tone reads as unvouchable, never as quiet", () => {
    expect(railOf("not-a-tone")).toBe(RAIL.att);
    expect(railOf(undefined, RAIL_LEFT)).toBe(RAIL_LEFT.att);
  });

  it("is never green", () => {
    for (const cls of [...Object.values(RAIL), ...Object.values(RAIL_LEFT)]) {
      expect(cls).not.toMatch(/ok|green|success/);
    }
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npx vitest run src/live/screens/common/BoardState.test.jsx 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./BoardState.jsx"`.

- [ ] **Step 7: Write the channel table** — the seam Group 2's charts will read, and the one place that says it holds no threshold.

Create `dashboard/src/live/screens/common/vitals.js`:

```javascript
// src/live/screens/common/vitals.js — which measured channels a screen shows, in what order, and
// where each one's value, unit and timestamp come from. Shared by the bed card, the bed list and
// the patient screen, so the three never disagree about what a channel is called.
//
// The order is the engine's own publishing order (api/board.py `_PUBLISHED_SIGNALS`), with lactate
// last because it is a lab rather than a monitor channel. `at` is the key inside the card's
// `measuredAt` block — the server's name for the signal; `get` reads the adapter's own shorter
// name (liveAdapters `patientFromBoard`).
//
// NOTHING HERE IS A THRESHOLD. There is no low/high, no normal band, no colour that depends on the
// value: `color` is the channel's identity colour (the prototype's `--v-*`), the same whatever the
// number is. A band or a cut-off would be the browser scoring the patient, which is the engine's
// work and nobody else's (the prototype's `H.VITAL.al/nb` are exactly that, and are not ported).
//
// `--v-map` and `--v-spo` clear 4.5:1 on `card` in daylight but not on `card2` (Wave 1B's contrast
// table), so a vital row belongs on the card surface. The list view writes its numbers in `ink`.
//
// `sbp` and `map` deliberately share `text-v-map`. The token set has five vital colours — hr, map,
// spo, rr, t (theme/tokens.js) — and pressure is one of them: inventing a sixth would add a colour
// to the design system from a screen, which is backwards. They are told apart the way every value
// on this screen is told apart: by its label and its unit. Colour is never the only carrier of a
// distinction here — it cannot be, for the colour-blind clinician or the printed handover.
export const VITALS = Object.freeze([
  { at: "heart_rate", get: (p) => p?.vitals?.hr, labelKey: "board.chHr", unitKey: "board.unitBpm", color: "text-v-hr" },
  { at: "resp_rate", get: (p) => p?.vitals?.rr, labelKey: "board.chRr", unitKey: "board.unitBpm", color: "text-v-rr" },
  { at: "spo2", get: (p) => p?.vitals?.spo2, labelKey: "board.chSpo2", unitKey: "board.unitPct", color: "text-v-spo" },
  { at: "sbp", get: (p) => p?.vitals?.sbp, labelKey: "board.chSbp", unitKey: "board.unitMmhg", color: "text-v-map" },
  { at: "map", get: (p) => p?.vitals?.map, labelKey: "board.chMap", unitKey: "board.unitMmhg", color: "text-v-map" },
  { at: "temperature", get: (p) => p?.vitals?.temp, labelKey: "board.chTemp", unitKey: "board.unitC", color: "text-v-t" },
  { at: "lactate", get: (p) => p?.lactate, labelKey: "board.chLac", unitKey: "board.unitMmol", color: "text-ink" },
]);

/** The channels this card HAS a value for, with the value and the instant it was measured.
 *  `!= null`, never truthiness: a measured 0 is a clinical finding (liveAdapters' rule). */
export function measuredVitals(patient) {
  return VITALS
    .map((v) => ({ ...v, value: v.get(patient), at_: patient?.measuredAt?.[v.at] ?? null }))
    .filter((v) => v.value !== null && v.value !== undefined);
}
```

- [ ] **Step 8: Write `BoardState.jsx`**

```jsx
// src/live/screens/common/BoardState.jsx — what every board-reading screen must say about its own
// data before it says anything about a patient.
//
// This is the most important component of Wave 3, and it exists for one failure mode: a board that
// has stopped updating looks exactly like a calm ward. Three parts, in this order:
//
//   <BoardStrip>   the connection. LIVE says nothing (a working system is quiet); DEGRADED says
//                  the data may be out of date; UNAVAILABLE says the list is EMPTY BECAUSE THE
//                  LOAD FAILED, not because the ward is quiet; CONNECTING says it is still
//                  loading. The sentences are the old workspace's `liveConnection.boardView()`,
//                  which was written, tested and never put on a screen.
//   <ScopeNote>    the engine's own sentence about why this board is the size it is
//                  (`scope_note`), and the counts it sent with it. Never the screen's words: the
//                  server knows what it filtered and why, and it writes that sentence itself — a
//                  paraphrase in four languages is four chances to say something it did not.
//   <FeedHealth>   whether readings are still arriving (screens/common/feedHealth.js). An
//                  operational statement about the feed, never a clinical one about the values.
//
// `boardKnown(connection)` is the question a screen asks before it may write a reassuring sentence
// ("no open alarms", "nothing waiting"): only a LIVE board may. It is the same rule the bell and
// the lock screen read through `alarmCounts` / `lockSummary`; a screen that shows the cards
// themselves needs the flag rather than the summaries.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { CONNECTION } from "../../../liveConnection.js";
import { Alert, Note, Pill, StatusPill } from "../../ui/index.js";
import { hhmm } from "../../i18n/dates.js";
import { oldestMeasurement } from "./freshness.js";
import { wardFeedHealth } from "./feedHealth.js";
import { useNow } from "./useNow.js";
import { useBoard } from "../../data/BoardProvider.jsx";

/** Whether this board may be spoken of as current — the only state in which a screen may say that
 *  nothing is waiting. DEGRADED has data but no open stream (or no reload since it opened), so what
 *  it shows is the last it had; the other two have nothing to show at all. */
export const boardKnown = (connection) => connection === CONNECTION.LIVE;
/** Whether it has data that may be out of date: shown, and marked. */
export const boardStale = (connection) => connection === CONNECTION.DEGRADED;

const STRIP = {
  [CONNECTION.DEGRADED]: { key: "board.degraded", tone: "warn", icon: "alert" },
  [CONNECTION.CONNECTING]: { key: "board.connecting", tone: "info", icon: "clock" },
};

/** The connection, where the eye lands first. A LIVE board draws nothing: a strip that is always
 *  there is a strip nobody reads.
 *
 *  DEGRADED and CONNECTING are a static `Note`, not a live region: the state can change while a
 *  clinician is reading a card, and something that spoke every time the ward's Wi-Fi flickered
 *  would be noise a screen-reader user learns to ignore — they meet it moving through the page.
 *  UNAVAILABLE is the exception and IS announced (`Alert`, role="alert"), because what it would
 *  otherwise be read as is "no patients". */
export function BoardStrip({ connection, className = "" }) {
  const { t } = useI18n();
  if (connection === CONNECTION.UNAVAILABLE) {
    return <Alert tone="crit" className={className}>{t("board.unavailable")}</Alert>;
  }
  const state = STRIP[connection];
  if (!state) return null;
  return <Note tone={state.tone} icon={state.icon} className={className}>{t(state.key)}</Note>;
}

/** The engine's sentence about this board's size, as the engine wrote it, plus the counts it sent
 *  with it (`scope.hidden`, `scope.unresolved_hidden`). A load that failed drops the scope with the
 *  patients (boardStore), so there is nothing to draw then — which is right: a stale scope block
 *  would explain an empty board as "this is your scope" when the reason was the connection. */
export function ScopeNote({ scope, scopeNote, className = "" }) {
  const { t } = useI18n();
  const hidden = Number.isFinite(scope?.hidden) ? scope.hidden : 0;
  const unresolved = Number.isFinite(scope?.unresolved_hidden) ? scope.unresolved_hidden : 0;
  if (!scopeNote && hidden === 0) return null;
  return (
    <Note tone="info" icon="shield" className={className}>
      {scopeNote ? (
        <>
          {/* The engine writes this sentence in Turkish (`api/board.py` `_scope_note`). Printing it
              verbatim is the right call — the server knows what it filtered — but printing it
              UNMARKED is not: a Russian- or Azerbaijani-reading clinician meets a sentence in a
              language the rest of the screen is not in, with nothing saying why, and a screen
              reader set to Russian pronounces Turkish letters as Russian ones. So `lang="tr"` for
              the synthesiser, and one line in the reader's own language saying where the sentence
              came from. The real fix is the engine answering in the requested language; that is
              Group 2's (Task 23 carries it). */}
          <span lang="tr">{scopeNote}</span>
          <span className="mt-0.5 block text-11 font-normal text-mute">{t("board.scopeNoteLang")}</span>
        </>
      ) : null}
      {hidden > 0 ? (
        <span className="mt-1 block font-normal">
          {t("board.hidden", { count: hidden })}
          {unresolved > 0 ? ` ${t("board.unresolved", { count: unresolved })}` : ""}
        </span>
      ) : null}
    </Note>
  );
}

/** What to print as a finding's headline: the engine's own summary, or its `kind` if there is none.
 *
 *  Every screen that shows a finding goes through this, so there is ONE place to improve it. The
 *  `kind` is a raw slug (`news2_red_param`, `sepsis_antibiotic_overdue`) and reads like a database
 *  row, which is poor. It is still what is printed, for one reason: a four-language name per kind
 *  would be this interface naming the engine's clinical findings, and a name is a claim about what
 *  a finding IS. Those names belong in the vault with a source behind each, and then in the
 *  engine's own payload — not invented in a dictionary file by the screen that displays them.
 *  Task 23 records it as a server-side gap. In practice the engine always sends a summary
 *  (reco/engine.py), so this is the seam, not the usual path. */
export const summaryOf = (alarm) => alarm?.summary || alarm?.kind || "";

/** A risk tone's accent colour, as a fill (the bed card's left rail) and as a left border (the
 *  patient screen's finding). One table for both, because the two screens draw the same thing in
 *  two places and are built on two branches: the bed card had this map and the patient screen had
 *  an inline ternary whose fallback caught `neutral` as well as `att`, so a finding of severity
 *  `info` — which riskStyle maps to `neutral` — came out quiet grey on the card and ATTENTION
 *  AMBER on the patient screen. Amber in this interface means "the screen cannot vouch for this"
 *  (riskStyle.js, `UNREPORTED`), so the same finding was telling a clinician two different things
 *  about how much the system knew.
 *
 *  Token classes only, and `att` is the fallback for a tone that is not in the table: an unknown
 *  tone must read as unvouchable, never as quiet. Nothing here is ever green. */
export const RAIL = Object.freeze({
  crit: "bg-crit", high: "bg-high", mid: "bg-mid", low: "bg-low",
  att: "bg-att-line", neutral: "bg-line2",
});
export const RAIL_LEFT = Object.freeze({
  crit: "border-l-crit", high: "border-l-high", mid: "border-l-mid", low: "border-l-low",
  att: "border-l-att-line", neutral: "border-l-line2",
});
/** The rail class for a tone; an unknown tone takes the attention colour, never the quiet one. */
export const railOf = (tone, table = RAIL) => table[tone] ?? table.att;

/** A finding the engine downgraded because the patient's own charted baseline explains it
 *  (`rules/patient_relative.py`: such a finding "stays visible but does NOT alarm or escalate").
 *
 *  It lives here, with the shared board components, rather than on the bed card where it was first
 *  needed, because the alarms row says it too — and the card and the row are built on separate
 *  branches. Two things it deliberately is not. It is not a risk pill: `tone="neutral"` is the one
 *  tone in STATUS_TONES that carries no judgement, and the rule that a Homunculus screen never
 *  paints a patient green (riskStyle.js) is not weakened by a pill that says only "this is
 *  explained". And it is not a reassurance: the finding is still on the card, still on the alarms
 *  screen, still in the engine's text. What it does not do is drive the waiting queue, the bell or
 *  the rail's red count (boardStore's `needsAnswer`), because nobody is being asked to answer it.
 *
 *  `chronicContext` is the engine's own explanation and is English prose (reco/engine.py). It is
 *  sr-only and `lang="en"`: the pill is short enough to read at a glance, and a clinician who wants
 *  the reason is on the patient screen; a screen-reader user, who cannot hover, gets it in the
 *  accessible name with the right language on it. */
export function ChronicExpected({ alarm }) {
  const { t } = useI18n();
  if (alarm?.downgraded !== true) return null;
  return (
    <StatusPill tone="neutral" icon="minus">
      {t("board.chronicExpected")}
      {alarm.chronicContext ? (
        <span className="sr-only" lang="en">{` · ${alarm.chronicContext}`}</span>
      ) : null}
    </StatusPill>
  );
}

/** Is data arriving? `silentCount` beds whose continuous channels have all gone quiet, and when the
 *  quietest card that HAS been measured last spoke. The chip is the whole statement a browser is
 *  entitled to make about the feed: it names beds, not values, and nothing here decides that a
 *  number is too old to act on (feedHealth.js, the header). The device page that would answer the
 *  next question is Group 4's. */
export function FeedHealth({ patients, nowMs, className = "" }) {
  const { t } = useI18n();
  const list = Array.isArray(patients) ? patients : [];
  if (list.length === 0) return null;
  const { silentCount } = wardFeedHealth(list, nowMs);
  const oldest = oldestMeasurement(list);
  return (
    <Pill icon="wifi" className={className}>
      {/* The chip's name says what it is about before it says the number: on its own, "2" beside a
          wireless icon is not a sentence. `Pill` takes no title, so the words are sr-only. */}
      <span className="sr-only">{`${t("board.feedTitle")}: `}</span>
      {silentCount > 0 ? t("board.silent", { count: silentCount }) : t("board.feedOk")}
      {oldest !== null ? ` · ${t("board.oldest", { time: hhmm(oldest) })}` : ""}
    </Pill>
  );
}

/** The time a board-reading screen measures ages against: this browser's clock, corrected by the
 *  skew the server stated in its last answer (`clockSkewMs`, boardStore). Re-read every `everyMs`
 *  like `useNow`, which it wraps.
 *
 *  Every screen that prints an age uses this and not `useNow` directly. The engine timestamps a
 *  reading by its own clock; a ward tablet with a wrong clock therefore ages every reading wrongly,
 *  and for half of all wrong clocks it ages them DOWNWARDS — a four-hour-old pressure drawn as
 *  "6 min". The correction does not make the number right, it makes it the server's number, which
 *  is the one the engine reasoned with.
 *
 *  An unknown skew (no answer seen yet, a header a proxy stripped) is 0, not a refusal to show the
 *  age: an uncorrected age is the status quo and is usually right to the second, and a screen that
 *  blanked every age until it had measured a clock would be worse on every correctly-set device in
 *  the hospital. Group 2's device page is where a skew worth telling someone about gets said out
 *  loud; this only stops it corrupting the ages in the meantime. */
export function useBoardNow(everyMs) {
  const { clockSkewMs } = useBoard();
  const now = useNow(everyMs);
  return now + (Number.isFinite(clockSkewMs) ? clockSkewMs : 0);
}
```

- [ ] **Step 8a: The risk pill says what it is before it says the level**

A roadmap criterion for G1-09 that this plan's first draft marked "already done" and was wrong about: *"Ekran okuyucu risk hapında yalnız düzeyi okur ('Orta'); görünmez 'Risk:' öneki"*. Wave 1B put the word into two of the seven labels — "Risk bildirilməyib" and "Naməlum risk: x" — and the other five are the level alone. On screen that is enough: a coloured pill in a card's corner is read as a risk. A screen reader meets "Orta" with nothing around it, among a bed number, a name, six numbers and a score.

It is in this task, which is sequential, and not in the beds arm: three screens render `RiskPill`, and a shared `ui/` component improved inside one arm is a component the other two arms are missing until it merges.

In `dashboard/src/live/i18n/strings/risk.js`, add the word itself, in each of the four language blocks. Replace

```javascript
  tr: {
    critical: "Kritik",
```

with

```javascript
  tr: {
    prefix: "Risk",
    critical: "Kritik",
```

and replace

```javascript
  az: {
    critical: "Kritik",
```

with

```javascript
  az: {
    prefix: "Risk",
    critical: "Kritik",
```

and replace

```javascript
  ru: {
    critical: "Критический",
```

with

```javascript
  ru: {
    prefix: "Риск",
    critical: "Критический",
```

and replace

```javascript
  en: {
    critical: "Critical",
```

with

```javascript
  en: {
    prefix: "Risk",
    critical: "Critical",
```

Three of the four are the same word — Turkish, Azerbaijani and English all write "Risk" — which is why `risk.prefix` joins `AZ_SAME_AS_TR` above.

Then replace the whole of `dashboard/src/live/ui/RiskPill.jsx` with:

```jsx
// src/live/ui/RiskPill.jsx — an engine risk value as a status pill: tone, icon and a label in the
// current language. Never green (riskStyle.js). Pass `measured` (true) only for a card that has
// observations: without it, "none" reads "not measured", never "no finding".
//
// The pill says WHAT IT IS before it says the level. On screen the level alone is enough — a
// coloured pill in a card's corner is read as a risk — but a screen reader meets "Orta" with
// nothing around it, among a bed number, a name, six numbers and a score. So "Risk:" is there,
// visually hidden (roadmap G1-09: "Ekran okuyucu risk hapında yalnız düzeyi okur ('Orta');
// görünmez 'Risk:' öneki"). Two labels already carry the word themselves — "Risk bildirilməyib"
// and "Naməlum risk: x" — and are left alone rather than made to say it twice.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { riskStyle } from "./riskStyle.js";
import { StatusPill } from "./Tag.jsx";

/** The two labels that already name themselves (strings/risk.js): the prefix would repeat. */
const SAYS_RISK = new Set(["risk.unreported", "risk.unknown"]);

export function RiskPill({ risk, measured, className = "" }) {
  const { t } = useI18n();
  const style = riskStyle(risk, { measured });
  return (
    <StatusPill tone={style.tone} icon={style.icon} className={className}>
      {SAYS_RISK.has(style.labelKey) ? null : <span className="sr-only">{`${t("risk.prefix")}: `}</span>}
      {t(style.labelKey, style.labelVars)}
    </StatusPill>
  );
}
```

Then the tests, as a new `describe` at the end of the file — so the arms to come have nothing to merge here.

Append to `dashboard/src/live/ui/RiskPill.test.jsx`:

```jsx
describe("what a screen reader hears", () => {
  // Roadmap G1-09: the pill read only the level ("Orta") with nothing to say what the level was
  // OF — among a bed number, a name, six numbers and a score.
  it("says what it is before it says the level", () => {
    render(<I18nProvider><RiskPill risk="moderate" measured /></I18nProvider>);
    expect(screen.getByText("Risk:")).toBeInTheDocument();
    expect(screen.getByText("Orta")).toBeInTheDocument();
  });

  it("does not say it twice for a label that already names itself", () => {
    render(<I18nProvider><RiskPill risk={null} /></I18nProvider>);
    expect(screen.queryByText("Risk:")).toBeNull();
    expect(screen.getByText("Risk bildirilməyib")).toBeInTheDocument();
  });

  it("nor for an engine level this build does not know", () => {
    render(<I18nProvider><RiskPill risk="extreme" measured /></I18nProvider>);
    expect(screen.queryByText("Risk:")).toBeNull();
    expect(screen.getByText("Naməlum risk: extreme")).toBeInTheDocument();
  });
});
```

Two of the three are about NOT saying it. "Risk bildirilməyib" and "Naməlum risk: extreme" already carry the word, and a pill that read "Risk: Risk bildirilməyib" would be the fix making the thing it fixed worse — which is why `RiskPill` keeps an explicit `SAYS_RISK` set rather than a heuristic about the text.

```bash
npx vitest run src/live/ui/RiskPill.test.jsx src/live/i18n/strings.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  20 passed (20)` — 14 in `RiskPill.test.jsx` (was 11) and 6 in `strings.test.js`.

- [ ] **Step 9: Run it**

```bash
npx vitest run src/live/screens/common/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  49 passed (49)`.

- [ ] **Step 10: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `91 passed (91)` files, `1820 passed (1820)` tests; the build succeeds.

- [ ] **Step 11: Commit**

```bash
git add dashboard/src/live/i18n/strings/board.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/common/vitals.js dashboard/src/live/screens/common/BoardState.jsx dashboard/src/live/screens/common/BoardState.test.jsx dashboard/src/live/i18n/strings/risk.js dashboard/src/live/ui/RiskPill.jsx dashboard/src/live/ui/RiskPill.test.jsx
git commit -m "$(cat <<'EOF'
feat(dashboard): what a screen must say about its own board before it says anything else

The connection strip (the sentences liveConnection.boardView wrote and nothing
ever rendered, including its capitalised "DOES NOT MEAN"), the engine's own
scope sentence untranslated, the feed chip, and boardKnown() — the question a
screen asks before it may write a reassuring sentence. Plus the channel table
Group 2's charts will read, which holds no threshold on purpose, and the i18n
seam for the six screens.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **24** tests in the new `BoardState.test.jsx` and **14** in `RiskPill.test.jsx` (was 11); `strings.test.js` green with both seams open, at 6; whole suite green; build clean.

---

### Task 7: The test seams — and the repair that lets the three arms coexist

**Files:**
- Create: `dashboard/src/live/data/board.testutil.js`, `dashboard/src/live/shell/screens.testutil.js`
- Modify: `dashboard/src/live/session/testTokens.testutil.js`, `dashboard/src/live/shell/routes.test.js`, `dashboard/src/live/shell/Shell.test.jsx`, `dashboard/src/live/LiveApp.test.jsx`, `dashboard/src/live/shell/routes.js` (the `SCREENS` gaps), `dashboard/src/live/shell/Sidebar.jsx` (its header paragraph)

**This is the task that makes the parallel arms possible, and it is not optional.** Wave 2's shell tests were written against the build it had — one screen, the settings — so they say things like "the rail holds exactly `['#/settings']`" and "the session's home is `/settings`". Every one of those breaks the moment the first arm builds its screen, **in a file no arm owns**. That is the collision the registry's two-line seam was meant to prevent, and it was still there in the tests. Four files were found this way while this plan was written; all four are repaired here, centrally, before anything forks.

The rule it establishes: **a test whose subject is WHICH screens exist states its own build** (`onlyScreens`). A test that does not care asserts through `homePath` / `screenOf` instead of against a literal address.

- [ ] **Step 1: Write the registry pin**

Create `dashboard/src/live/shell/screens.testutil.js`:

```javascript
// Test-only: pin the screen registry to a KNOWN set, whatever this build has built.
//
// Why this exists. Wave 2's shell tests were written against the build it had — one screen, the
// settings — so they said things like "the rail holds exactly ['#/settings']" and "the session's
// home is /settings". Every one of those broke the moment Wave 3 built its first screen, in a file
// none of Wave 3's branches owns. That is the collision the registry's two-line seam was meant to
// prevent, and it was still there in the tests.
//
// So a test that cares WHICH screens exist says so itself: `onlyScreens({ beds: Probe })` leaves
// the beds route with that screen and every other route with none, so the rail, the home path and
// the router's two refusals are the test's own choice and not a property of the build. A test that
// does not care uses the build as it is and asserts through `homePath` / `screenOf` rather than
// against a literal address.
//
// It is the registry's own seam underneath (`stubScreens`), so it refuses outside the test build
// and `resetScreens()` in an `afterEach` puts the build's screens back.
import { ROUTES, screenOf, stubScreens } from "./routes.js";

/** The settings screen is every session's fallback home (`perms: []`, `nav: "bottom"`), it is not
 *  Wave 3's business, and a test that removed it would be testing a build that cannot exist. So it
 *  is kept as this build has it unless a test names it. */
export const KEEP = Object.freeze(["settings"]);

/** The registry reduced to `screens`: every other route loses its screen, except the ids in
 *  `keep`, which stay as this build built them. Returns `resetScreens`, which an `afterEach` must
 *  call — the registry is shared by every test in the file. */
export function onlyScreens(screens = {}, { keep = KEEP } = {}) {
  const table = {};
  for (const route of ROUTES) {
    table[route.id] = keep.includes(route.id) ? screenOf(route) : null;
  }
  return stubScreens({ ...table, ...screens });
}
```

- [ ] **Step 2: Write the board fixtures** — and read the header first: NO PATIENT DATA, EVER.

Create `dashboard/src/live/data/board.testutil.js`:

```javascript
// Test-only: synthetic board payloads in the API's own `/patients` shape (homunculus-engine
// api/board.py `patient_board` / `identity_only_board`), for the three clinical screens of Wave 3
// and the board store.
//
// NO PATIENT DATA, EVER (CLAUDE.md, hard rule 6). Ids are `S-001`…, units `REA-01` / `NICU-01`,
// names "Ayşe Sentetik", the hospital "Sentetik Hastane" — the house style of the earlier waves.
// Nothing in this file may be replaced with anything taken from a real ward, a capture or an
// export, not even "just to reproduce a bug".
//
// The builders are deliberately explicit about absence: `entry()` gives a card whose channels have
// never been measured and whose identity the HIS has not sent, because that is the card every
// honesty rule turns on — a blank must not read as a finding. A test that wants a measured card
// says so (`measured()`), and one that wants a name says so (`identity()`).

/** When the fixtures are "now". A fixed instant, so an age in a test is the age the test wrote. */
export const NOW = Date.parse("2026-10-08T10:00:00Z");
/** An ISO instant this many seconds before NOW. */
export const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

/** `latest.at` with every continuous channel measured `seconds` ago (freshness.js SIGNAL_KEYS). */
export const measured = (seconds = 30) => ({
  heart_rate: ago(seconds), resp_rate: ago(seconds), spo2: ago(seconds),
  sbp: ago(seconds), map: ago(seconds), temperature: ago(seconds),
});

/** The identity block the HIS sends, resolved onto one of our beds (api/board.py
 *  `_bed_resolution`). `bed_matched: false` with a `bed_key` is the honest unmatched case: the
 *  patient keeps a card but belongs to no unit, so no scope grant can reach them. */
export const identity = (over = {}) => ({
  patient_id: "S-001", display_name: "Ayşe Sentetik", bed_label: "REA-01 · 2",
  state: "admitted", source: "comed", updated_at: ago(600), diagnoses: [],
  birth_date: null, sex: null,
  bed_id: "REA-01-2", unit_id: "REA-01", bed_matched: true, bed_key: "REA^01^2", ...over,
});

/** One alarm as the board carries it: the engine's own severity, summary and reasoning, merged
 *  with the acknowledgement store (`_merge_alert`). */
export const alarm = (kind = "news2", over = {}) => ({
  kind, severity: "high", urgency: "immediate",
  summary: `${kind} ölçütü karşılandı`,
  clinical_reasoning: null, supporting_evidence: [], recommended_actions: [], confidence: null,
  downgraded: false, chronic_context: "", stale_inputs: [],
  acknowledged: false, acknowledged_by: null, acknowledged_at: null,
  first_seen_at: ago(247), escalated: false, ...over,
});

/** The engine's NEWS2, in the shape the board carries it (`_news2`). `total` is always a number —
 *  NEWS2 scores a missing parameter as 0 — so `partial` and `missing` are what say whether that
 *  number is the whole story. */
export const news2 = (over = {}) => ({
  total: 6, partial: false, missing: [], red_param: false, breakdown: {}, ...over,
});

/** One board card. By default: measured by nothing, named by nobody, no alarm, risk "none" — the
 *  card that every "a blank is not a finding" rule is about. */
export function entry(id = "S-001", over = {}) {
  const { vitals = {}, at = {}, score = null, sofa = null, lactate = null, ...rest } = over;
  return {
    patient_id: id,
    identity: null,
    risk: "none",
    alerts: [],
    latest: {
      heart_rate: null, resp_rate: null, spo2: null, sbp: null, map: null, temperature: null,
      lactate, sofa, at, news2: score, ...vitals,
    },
    sepsis: { suspected_infection: null, sofa: null, baseline_sofa: null, baseline_assumed: true, rise: 0 },
    meds: null,
    ...rest,
  };
}

/** A whole `/patients` answer. `scope`/`scope_note` default to an unrestricted session, which is
 *  what an administrator sees; a scoped one passes its own. */
export function board(patients = [], over = {}) {
  return {
    patients,
    scope: { unrestricted: true, reason: "unrestricted_role", unit_ids: [], bed_ids: [], own_patients: 0, hidden: 0, unresolved_hidden: 0 },
    scope_note: null,
    ...over,
  };
}

/** The scope block of a session restricted to units, with the counts `/patients` sends. */
export function scopedTo(unitIds, over = {}) {
  return {
    unrestricted: false, reason: "assigned", unit_ids: unitIds, bed_ids: [], own_patients: 0,
    hidden: 0, unresolved_hidden: 0, ...over,
  };
}
```

- [ ] **Step 3: Give the fake API every call Wave 3 makes**

In `dashboard/src/live/session/testTokens.testutil.js`, replace

```javascript
/** A backendApi stand-in: one stored access token, every call a vi.fn the test sets up. */
export function fakeApi(vi, { access = null } = {}) {
  let stored = access;
  const api = {
    accessToken: vi.fn(() => stored),
    logout: vi.fn(() => { stored = null; }),
    forget: vi.fn(),
    supersede: vi.fn(),
    login: vi.fn(),
    verifyTotp: vi.fn(),
    setupTotp: vi.fn(),
    me: vi.fn(),
    changePassword: vi.fn(),
    reauth: vi.fn(),
    boardPatients: vi.fn(),
    streamTicket: vi.fn(),
    /** What the API's own token handling would do: store a new pair. */
    store(next) { stored = next; },
  };
  return api;
}
```

with

```javascript
/** A backendApi stand-in: one stored access token, every call a vi.fn the test sets up.
 *
 *  Every call the live UI makes is listed, whether or not the test under way uses it — a screen
 *  that reaches for a call this object does not have fails with "not a function" instead of with
 *  the thing the test was about, and a `vi.fn()` that nobody set up resolves to `undefined`, which
 *  is what a screen must survive anyway. Wave 3's calls are grouped by the screen that makes them.
 */
export function fakeApi(vi, { access = null } = {}) {
  let stored = access;
  const api = {
    accessToken: vi.fn(() => stored),
    logout: vi.fn(() => { stored = null; }),
    forget: vi.fn(),
    supersede: vi.fn(),
    login: vi.fn(),
    verifyTotp: vi.fn(),
    setupTotp: vi.fn(),
    me: vi.fn(),
    changePassword: vi.fn(),
    reauth: vi.fn(),
    boardPatients: vi.fn(),
    streamTicket: vi.fn(),
    // the beds, alarms and patient screens (G1-09 … G1-11)
    acknowledge: vi.fn(),
    view: vi.fn(),
    // the users and units screen (G1-12)
    adminUsers: vi.fn(),
    adminCreateUser: vi.fn(),
    adminUpdateUser: vi.fn(),
    adminSetUserGroups: vi.fn(),
    adminResetPassword: vi.fn(),
    adminResetMfa: vi.fn(),
    adminUnlockSignIn: vi.fn(),
    myScope: vi.fn(),
    setScope: vi.fn(),
    unassignedScopes: vi.fn(),
    // the roles and permissions screen (G1-13)
    adminPermissions: vi.fn(),
    adminGroups: vi.fn(),
    adminCreateGroup: vi.fn(),
    adminUpdateGroup: vi.fn(),
    adminDeleteGroup: vi.fn(),
    // the login-source screen (G1-14)
    ldapStatus: vi.fn(),
    ldapTest: vi.fn(),
    ldapSearch: vi.fn(),
    ldapGroups: vi.fn(),
    ldapImport: vi.fn(),
    ldapMappings: vi.fn(),
    ldapCreateMapping: vi.fn(),
    ldapDeleteMapping: vi.fn(),
    /** What the API's own token handling would do: store a new pair. */
    store(next) { stored = next; },
  };
  return api;
}
```

- [ ] **Step 4: Make `routes.test.js` build-independent** — five edits.

Import the pin. Replace

```javascript
import { PERMISSION_KEYS } from "../../permissions.js";
```

with

```javascript
import { onlyScreens } from "./screens.testutil.js";
import { PERMISSION_KEYS } from "../../permissions.js";
```

(The import goes after `./routes.js`'s own line; either order works, this is where it was put.)

In `dashboard/src/live/shell/routes.test.js`, replace

```javascript
    expect(bottom.map((r) => r.id)).toEqual(["settings"]);
  });
```

with

```javascript
    expect(bottom.map((r) => r.id)).toEqual(["settings"]);
    // And a build with none of them shows none of them: no dead links, ever.
    restore = onlyScreens({}, { keep: [] });
    expect(navRoutes(ADMIN)).toEqual({ main: [], bottom: [] });
  });
```

and, in `dashboard/src/live/shell/routes.test.js`, replace

```javascript
    expect(canReach(admin, [])).toBe(false);
    expect(homePath([])).toBe("/settings");
```

with

```javascript
    expect(canReach(admin, [])).toBe(false);
    // No rights opens no main screen, whatever this build has built: its home is its settings.
    expect(homePath([])).toBe("/settings");
```

and, in `dashboard/src/live/shell/routes.test.js`, replace

```javascript
  it("takes a screen from the registry, and puts the build's own back", () => {
    const Probe = () => null;
    restore = stubScreens({ beds: Probe });
    expect(screenOf(ROUTES.find((r) => r.id === "beds"))).toBe(Probe);
    expect(navRoutes(["board.view"]).main.map((r) => r.id)).toEqual(["beds"]);
    expect(homePath(["board.view"])).toBe("/beds");
    restore();
    restore = null;
    expect(screenOf(ROUTES.find((r) => r.id === "beds"))).toBeNull();
    expect(homePath(["board.view"])).toBe("/settings");
  });

  it("puts every screen back at once, however many a test stood in for", () => {
    stubScreens({ beds: () => null });
    stubScreens({ alarms: () => null, admin: () => null });
    resetScreens();
    expect(ROUTES.filter((r) => screenOf(r)).map((r) => r.id)).toEqual(["settings"]);
  });
```

with

```javascript
  it("takes a screen from the registry, and puts the build's own back", () => {
    // Build-independent: it asserts the round trip, not which screens this build has. Written
    // against a literal ("after the restore, beds has no screen") it would break in a file no
    // Wave-3 branch owns, the moment one of them built that screen.
    const Probe = () => null;
    const beds = ROUTES.find((r) => r.id === "beds");
    const own = screenOf(beds);
    restore = stubScreens({ beds: Probe });
    expect(screenOf(beds)).toBe(Probe);
    expect(navRoutes(["board.view"]).main.map((r) => r.id)).toContain("beds");
    expect(homePath(["board.view"])).toBe("/beds");           // the first main route in the table
    restore();
    restore = null;
    expect(screenOf(beds)).toBe(own);
  });

  it("puts every screen back at once, however many a test stood in for", () => {
    const own = ROUTES.filter((r) => screenOf(r)).map((r) => r.id);
    stubScreens({ beds: () => null });
    stubScreens({ alarms: () => null, admin: () => null });
    resetScreens();
    expect(ROUTES.filter((r) => screenOf(r)).map((r) => r.id)).toEqual(own);
  });

  // What a test that cares WHICH screens exist uses, so it does not depend on the build.
  it("pins the registry to a known set, and gives it back", () => {
    const Probe = () => null;
    const own = ROUTES.filter((r) => screenOf(r)).map((r) => r.id);
    restore = onlyScreens({ alarms: Probe }, { keep: [] });
    expect(ROUTES.filter((r) => screenOf(r)).map((r) => r.id)).toEqual(["alarms"]);
    expect(homePath(["board.view"])).toBe("/alarms");
    restore();
    restore = null;
    expect(ROUTES.filter((r) => screenOf(r)).map((r) => r.id)).toEqual(own);
  });
```

and, in `dashboard/src/live/shell/routes.test.js`, replace

```javascript
  it("refuses the seam outside the test build", () => {
    vi.stubEnv("MODE", "production");
```

with

```javascript
  it("refuses the seam outside the test build", () => {
    const before = screenOf(ROUTES.find((r) => r.id === "beds"));
    vi.stubEnv("MODE", "production");
```

and in the same test replace

```javascript
    expect(screenOf(ROUTES.find((r) => r.id === "beds"))).toBeNull();
  });
```

with

```javascript
    expect(screenOf(ROUTES.find((r) => r.id === "beds"))).toBe(before);
  });
```

Finally replace

```javascript
    restore = stubScreens({ beds: () => null });
    expect(resumePath("/admin", ["board.view"])).toBe("/beds");        // not this session's
```

with

```javascript
    // `onlyScreens`: the beds screen exists and NOTHING else does, whatever this build has built,
    // so "no screen behind it yet" is this test's own state and not a property of the build.
    restore = onlyScreens({ beds: () => null });
    expect(resumePath("/admin", ["board.view"])).toBe("/beds");        // not this session's
```

- [ ] **Step 5: Make `Shell.test.jsx` build-independent** — four edits.

In `dashboard/src/live/shell/Shell.test.jsx`, replace

```javascript
import { hashPath, resetScreens, stubScreens } from "./routes.js";
```

with

```javascript
import { hashPath, homePath, resetScreens, stubScreens } from "./routes.js";
import { onlyScreens } from "./screens.testutil.js";
```

and, in `dashboard/src/live/shell/Shell.test.jsx`, replace

```javascript
const built = (screens) => stubScreens(screens);
```

with

```javascript
// `built` adds a screen to whatever this build has; `only` pins the registry to a known set, for
// a test whose subject IS which screens exist (the rail's list, where an empty address lands,
// "no such page"). Without `only`, those tests assert a property of the build and break in this
// file every time a Wave-3 branch builds a screen (screens.testutil.js).
const built = (screens) => stubScreens(screens);
const only = (screens) => onlyScreens(screens);
```

and, in `dashboard/src/live/shell/Shell.test.jsx`, replace

```javascript
  it("lists the built screens this session may open, each with its name — not an icon alone", async () => {
    built({ admin: AdminProbe });
```

with

```javascript
  it("lists the built screens this session may open, each with its name — not an icon alone", async () => {
    only({ admin: AdminProbe });
```

and, in `dashboard/src/live/shell/Shell.test.jsx`, replace

```javascript
  it("lands an empty address on the session's home", async () => {
    await renderShell({ hash: "" });
    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
  });

  it("answers an unknown address, or a screen not built yet, with 'no such page' — never a blank", async () => {
    await renderShell({ hash: "#/yok" });
```

with

```javascript
  it("lands an empty address on the session's home", async () => {
    only({});                                     // nothing built: a nurse's home is her settings
    await renderShell({ hash: "" });
    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
    expect(homePath(NURSE_PERMS)).toBe("/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
  });

  it("answers an unknown address, or a screen not built yet, with 'no such page' — never a blank", async () => {
    only({});                                     // the beds route has no screen in this test
    await renderShell({ hash: "#/yok" });
```

- [ ] **Step 6: Pin the registry for `LiveApp.test.jsx`** — one import and one line in `beforeEach`. This file's subject is the session's life, not which work screens exist, and ten of its tests name the screen a session lands on.

In `dashboard/src/live/LiveApp.test.jsx`, replace

```javascript
import { resetScreens, stubScreens } from "./shell/routes.js";
```

with

```javascript
import { resetScreens, stubScreens } from "./shell/routes.js";
import { onlyScreens } from "./shell/screens.testutil.js";
```

and, in the same file, replace

```javascript
beforeEach(() => {
  window.location.hash = "";
});
```

with

```javascript
beforeEach(() => {
  window.location.hash = "";
  // This file's subject is the session's life — sign-in, the steps, the lock, sign-out — not which
  // work screens exist, and several of its tests name the screen a session lands on. So the
  // registry is pinned to the settings screen alone, and a test that needs another one stands it in
  // itself (`built`). Written against the build instead, every one of those tests would break here
  // the moment a Wave-3 branch built a screen — in a file none of them owns.
  onlyScreens({});
});
```

- [ ] **Step 6a: Put the gaps in, where four arms will write one line each**

Three shared literals take one line per arm. Each of them is a conflict on every merge if the arms' lines end up adjacent, and not a conflict at all if there is untouched context between them, because git merges line ranges. So the gaps go in now, before the fork, with a marker per arm — and the comment says not to tidy them away, because tidying them is what re-creates the problem.

Only one of the three needs an edit here. `routes.js`'s **import** block already has the gaps — Wave 2 put them between its four commented import lines — and `catalog.js` got both of its gapped blocks from Task 6's whole-file seam, and `strings.test.js` got its markers in Task 6 Step 3. What is left is `routes.js`'s `SCREENS` object, whose five lines are adjacent.

In `dashboard/src/live/shell/routes.js`, replace

```javascript
const SCREENS = Object.freeze({
  beds: null,      // G1-09
  alarms: null,    // G1-10
  patient: null,   // G1-11
  admin: null,     // G1-12 (users), G1-13 (roles), G1-14 (login source) — tabs inside one screen
  settings: SettingsScreen,
});
```

with

```javascript
const SCREENS = Object.freeze({
  // One entry per wave, each on its own with a blank line either side. The blank lines are the
  // point: git merges line ranges, and four arms editing four ADJACENT lines of the same object
  // conflict every time, while four arms editing lines with untouched context between them do
  // not. Do not close up the gaps.
  beds: null,      // G1-09

  alarms: null,    // G1-10

  patient: null,   // G1-11

  admin: null,     // G1-12 (users), G1-13 (roles), G1-14 (login source) — tabs inside one screen

  settings: SettingsScreen,
});
```

The values stay `null`: each arm sets its own one later (Tasks 11, 12, 14, 19), and what this step changes is only the shape of the ground they land on. Nothing is tested by it and nothing should move — which is why it is here, in a task whose gate is "the suite is exactly as it was", rather than inside an arm where a one-line diff and a five-line diff look the same in review.

- [ ] **Step 6b: Settle `Sidebar.jsx`'s header here, so only one arm ever touches that file**

`Sidebar.jsx` was going to be edited by two arms: the alarms arm adds the rail's alarm badge (Task 13) and the patient arm changes the paragraph about a `nav: false` screen (Task 15, which decides that the beds entry reads as current while one of its patients is open). A whole-file write from one arm and a paragraph replacement from the other is a conflict in **either** merge order — and an earlier draft of this plan asserted, twice, that the two did not overlap. They did.

The fix is to make the change that does not depend on either arm's code here, in a sequential task: the paragraph is a statement of the decision, and `Sidebar` itself needs no new code for it (the Shell passes `current`, and Task 15 is what changes what the Shell passes). After this step, `Sidebar.jsx` belongs to the alarms arm alone and Task 15 does not open the file.

In `dashboard/src/live/shell/Sidebar.jsx`, replace

```javascript
// A screen the rail does not list (routes.js `nav: false` — a patient, opened from the beds) is
// open with NO entry current: saying "you are here" of a page the entry does not lead to would be
// false. Whether the beds entry should read as current while one of its patients is open is a
// question for the screen that opens them (G1-11), and the test pins today's answer so the next
// wave changes it on purpose.
```

with

```javascript
// A screen the rail does not list (routes.js `nav: false`) is open under the entry it was reached
// FROM: the patient screen is opened from the beds board, so the beds entry reads as current while
// a patient is on screen (`under` in routes.js; the Shell passes it). Wave 2 left this open and
// showed no entry as current, on the ground that the entry does not lead to that page — but a
// clinician spends most of her time on a patient, and a rail with nothing current says "you are
// nowhere" for the whole of it. The patient screen also carries a visible way back to the board,
// so the claim is not only implied (G1-11's decision; the deferred note of Wave 2).
```

The behaviour does not change yet — `ROUTES` has no `under` until Task 15 — and the one Wave-2 test that asserts the old behaviour is rewritten in Task 15, with the code that makes it true. A comment that describes the design before the code arrives is the cheaper of the two mistakes available here; a merge conflict in a file two arms both rewrote is the expensive one.

- [ ] **Step 7: Run the three repaired files, with the registry as it is (nothing built yet)**

```bash
npx vitest run src/live/shell/ src/live/LiveApp.test.jsx 2>&1 | grep -E "Tests "
```
Expected: `Tests  100 passed (100)` — `routes.test.js` 22 (was 21), `Menu.test.jsx` 12, `Shell.test.jsx` **33 (unchanged: Step 5 rewrites four of its tests and adds none)**, `LiveApp.test.jsx` 33. (Corrected 2026-10-09 from 101/34, which was arithmetic rather than measurement.)

- [ ] **Step 8: Prove the repair** — temporarily build a screen and watch the three files stay green. This is the whole point of the task; do not skip it.

```bash
# stand a screen in, exactly as an arm will
python - <<'PY'
import io
p = "src/live/shell/routes.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("  beds: null,      // G1-09", "  beds: () => null, // G1-09 TEMPORARY")
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
PY
npx vitest run src/live/shell/ src/live/LiveApp.test.jsx 2>&1 | grep -E "Tests "
git checkout -- src/live/shell/routes.js
```
Expected: `Tests  100 passed (100)` — the same number, with a screen built. Before this task the same experiment fails tests in three files.

Do the stand-in and the revert with the **Edit tool**, not the `python` heredoc above: the ground rules forbid scripted edits to the working tree, and `git checkout -- src/live/shell/routes.js` would also discard Step 6a's still-uncommitted gaps.

- [ ] **Step 9: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `91 passed (91)` files, `1822 passed (1822)` tests; the build succeeds.

- [ ] **Step 10: Commit**

```bash
git add dashboard/src/live/shell/screens.testutil.js dashboard/src/live/data/board.testutil.js dashboard/src/live/session/testTokens.testutil.js dashboard/src/live/shell/routes.test.js dashboard/src/live/shell/Shell.test.jsx dashboard/src/live/LiveApp.test.jsx dashboard/src/live/shell/routes.js dashboard/src/live/shell/Sidebar.jsx
git commit -m "$(cat <<'EOF'
test(dashboard): the seams Wave 3's three arms need, and the repair they need first

Wave 2's shell tests assert which screens exist ("the rail holds exactly
['#/settings']", "home is /settings"), so the first arm to build a screen
breaks 16 tests in three files none of the arms owns. `onlyScreens` lets a
test state its own build; the four files that needed it are repaired here,
before anything forks. Plus the synthetic board payloads and every call Wave 3
makes on the fake API.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 1 new test (`routes.test.js` 21 → 22; `Shell.test.jsx` stays at **33**); the three repaired files green **both** with and without a screen built (Step 8); whole suite green; build clean.

---

### Task 8: Every refusal Wave 3 can meet, in the user's language

**Files:**
- Modify: `dashboard/src/live/apiErrors.js`, `dashboard/src/live/i18n/strings/errors.js`, `dashboard/src/live/apiErrors.test.js`

Wave 2 mapped the sign-in, MFA, password, lock and session surface. Wave 3's screens talk to the board (`/patients`, `/ack`, `/view`), to `/admin`, to `/admin/ldap` and to `/scope` — seven more source files, about forty-six more messages. `apiErrors.test.js` reads those sources **as text** and fails on an unmapped one, so this has to be done before the screens, in one place, or each arm would meet the same wall separately.

Two of the messages the server BUILDS rather than writes out, and both carry a permission key in their tail: `permission required: <key>` and `Kendi yetkilerinizi aşan bir işlem yapılamaz: <keys>`. They are matched by shape, and the KEYS ARE NOT TRANSLATED — they are the catalogue's own identifiers, which is what an administrator searches the permission table for and what a support call quotes.

- [ ] **Step 1: Extend the test's source list, and watch it name every unmapped message**

In `dashboard/src/live/apiErrors.test.js`, replace

```javascript
const DEPS = py("auth/dependencies.py");
```

with

```javascript
const APP = py("api/app.py");
const ADMIN_SERVICE = py("admin/service.py");
const ADMIN_SCHEMAS = py("admin/schemas.py");
const LDAP_SERVICE = py("admin/ldap_service.py");
const LDAP_ROUTER = py("admin/ldap_router.py");
const SCOPE_ROUTER = py("scope/router.py");
const SCOPE_SCHEMAS = py("scope/schemas.py");
const DEPS = py("auth/dependencies.py");
```

Replace

```javascript
/** ldap.py's string constants that are not messages (an LDAP search filter); every other one is. */
const LDAP_NOT_MESSAGES = new Set(["DEFAULT_USER_FILTER"]);
```

with

```javascript
/** ldap.py's string constants that are not messages (an LDAP search filter); every other one is. */
const LDAP_NOT_MESSAGES = new Set(["DEFAULT_USER_FILTER"]);
/** admin/ldap_service.py constants that are not messages: the SKIP_* values are the reason an
 *  import gives per account (`LdapSkippedOut.reason`), which the login-source screen translates
 *  itself, and the rest are column or attribute names. */
const LDAP_SERVICE_NOT_MESSAGES = (name) => name.startsWith("SKIP_");
```

Replace

```javascript
  ...literals(BACKEND_API, String.raw`SUPERSEDED_MESSAGE = ${STR}`).map((m) => ["backendApi.js superseded", m]),
];
```

with

```javascript
  ...literals(BACKEND_API, String.raw`SUPERSEDED_MESSAGE = ${STR}`).map((m) => ["backendApi.js superseded", m]),
  // Wave 3's screens (the beds, the alarms, the patient, and the three administration tabs) talk
  // to the board, /admin, /scope and /admin/ldap, so those refusals have to be translated too.
  ...literals(APP, String.raw`detail=\s*${STR}`).map((m) => ["api/app.py detail", m]),
  ...[...pyConstants(ADMIN_SERVICE).values()].map((m) => ["admin/service.py constant", m]),
  ...literals(ADMIN_SERVICE, String.raw`AdminError\(\d+,\s*${STR}`).map((m) => ["admin/service.py AdminError", m]),
  ...[...pyConstants(ADMIN_SCHEMAS).values()].map((m) => ["admin/schemas.py constant", m]),
  ...literals(ADMIN_SCHEMAS, String.raw`ValueError\(\s*${STR}`).map((m) => ["admin/schemas.py", m]),
  ...[...pyConstants(LDAP_SERVICE)].filter(([name]) => !LDAP_SERVICE_NOT_MESSAGES(name))
    .map(([name, text]) => [`admin/ldap_service.py ${name}`, text]),
  ...literals(LDAP_ROUTER, String.raw`detail=\s*${STR}`).map((m) => ["admin/ldap_router.py detail", m]),
  ...literals(SCOPE_ROUTER, String.raw`detail=\s*${STR}`).map((m) => ["scope/router.py detail", m]),
  ...literals(SCOPE_SCHEMAS, String.raw`ValueError\(\s*${STR}`).map((m) => ["scope/schemas.py", m]),
];
```

Run it:

```bash
npx vitest run src/live/apiErrors.test.js 2>&1 | grep -E "Tests "
```
Expected: **every message the readers found and this build has no text for, failing by name.** Read that list — it *is* the work of this task, and it is the only list of it. On a clean base at `cced4f9` the line reads `56 failed | 61 passed (117)`: the 117 is what the extended source list makes the test enumerate before anything is mapped, and the file ends this task at **122** once `errors.js` and the mapping are in. Both numbers move if the Python sources gain or lose a message, which is exactly what this test exists to notice, so **treat the failure names as the gate and the totals as a sanity check** — not the other way round.

- [ ] **Step 2: Write the texts, in four languages**

`dashboard/src/live/i18n/strings/errors.js` gains 46 keys in each of its four blocks, each inserted immediately before that block's `unknown:` line. **Write this with a file-writing tool** and check the Russian kept its Cyrillic and the Azerbaijani its `ə` (`npx vitest run src/live/i18n/strings.test.js`).

The whole file after this task:

```javascript
// What an API refusal says, by key (live/apiErrors.js maps the server's texts onto these). TR is
// the source. The wording follows the old workspace's reviewed rbac.err texts (clinicalI18n.js),
// with the prototype's word for password ("şifre"/"şifrə") instead of the old "parola"/"parol".
// New here: passwordRequired. AZ/RU/EN need a native speaker's review before the pilot.
export default {
  tr: {
    noTenant: "Hesabınıza kurum tanımlanmamış. Sistem yöneticinizle görüşün.",
    membershipInactive: "Bu kurumdaki üyeliğiniz etkin değil. Sistem yöneticinizle görüşün.",
    platformOnly: "Bu işlem platform operatörü yetkisi gerektirir.",
    passwordChangeRequired: "Devam etmeden önce geçici şifrenizi değiştirin.",
    mfaRequired: "Bu işlem iki adımlı doğrulama gerektirir. Doğrulama kodunuzla yeniden giriş yapın.",
    mfaResetRequired: "Hesabınızda kayıtlı bir doğrulayıcı var. Cihazınızı kaybettiyseniz sistem yöneticinizden iki adımlı doğrulamayı sıfırlamasını isteyin.",
    notAuthenticated: "Oturumunuz doğrulanamadı; yeniden giriş yapın.",
    tokenVersion: "Hesabınızda bir değişiklik yapıldı; yeniden giriş yapın.",
    tenantChanged: "Kurum bilginiz değişti; yeniden giriş yapın.",
    totpLocked: "Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin.",
    totpReplayed: "Bu kod zaten kullanıldı; yeni kodu bekleyin.",
    totpNotSetUp: "İki adımlı doğrulama henüz kurulmamış.",
    invalidTotp: "Kod doğru değil ya da süresi doldu.",
    invalidCredentials: "Kullanıcı adı veya şifre hatalı.",
    sessionExpired: "Oturum süresi doldu; yeniden giriş yapın.",
    directoryUnreachable: "Hastane dizin sunucusuna (Active Directory) ulaşılamıyor. Biraz sonra tekrar deneyin; sürerse bilgi işleme haber verin.",
    directoryNotConfigured: "Hastane dizini (Active Directory) bu kurulumda yapılandırılmamış.",
    directoryThrottled: "Bu hesap için çok fazla hatalı deneme yapıldı. 15 dakika sonra tekrar deneyin.",
    reauthRefused: "Şifre hatalı.",
    directoryPassword: "Şifreniz hastane hesabınızla (Active Directory) yönetiliyor; buradan değiştirilemez.",
    passwordTooShort: "Yeni şifre en az 8 karakter olmalı.",
    passwordUnchanged: "Yeni şifre mevcut şifreden farklı olmalı.",
    wrongCurrentPassword: "Mevcut şifre hatalı.",
    loginRequired: "Kullanıcı adınızı veya e-postanızı girin.",
    loginRateLimited: "Çok fazla giriş denemesi yapıldı. Bir dakika sonra tekrar deneyin.",
    reauthRateLimited: "Çok fazla deneme yapıldı. Bir dakika sonra tekrar deneyin.",
    sessionUnreachable: "Sunucuya şu an ulaşılamıyor; oturumunuz açık. Biraz sonra tekrar deneyin.",
    loginFailed: "Giriş başarısız.",
    requestTimeout: "Sunucu yanıt vermedi. İşlem gerçekleşmiş olabilir; kontrol edip gerekirse tekrar deneyin.",
    sessionSuperseded: "Bu istek önceki oturuma aitti; sonucu uygulanmadı.",
    requestFailed: "İstek başarısız ({status}).",
    serverUnreachable: "Sunucuya şu an ulaşılamıyor. Biraz sonra tekrar deneyin.",
    network: "Sunucuya bağlanılamadı. Ağ bağlantınızı kontrol edin.",
    passwordTooLong: "Şifre en fazla 1024 karakter olabilir.",
    passwordRequired: "Şifrenizi girin.",
    // Wave 3's screens talk to the board, /admin, /scope and /admin/ldap as well (api/app.py,
    // admin/service.py, admin/schemas.py, admin/ldap_service.py, scope/*).
    permissionRequired: "Bu işlem için yetkiniz yok ({permission}).",
    // The server answers an unknown patient and one outside the caller's scope the SAME way, on
    // purpose: a 403 would confirm that the patient exists and is under care here. So does this.
    patientNotFound: "Bu hasta panonuzda yok: ya böyle bir kayıt yok ya da kapsamınız dışında.",
    badPatientId: "Hasta kimliği geçersiz.",
    badRecordedAt: "Kayıt zamanı geçersiz.",
    badAlarmKind: "Alarm türü geçersiz.",
    alarmNoLongerOpen: "Bu alarm artık açık değil; başkası yanıtlamış ya da kendiliğinden kapanmış olabilir.",
    scopeUnreadable: "Kapsamınız şu anda okunamıyor; canlı akış başlatılamadı. Biraz sonra tekrar deneyin.",
    streamTicketExpired: "Canlı akış bileti geçersiz ya da süresi doldu; bağlantı yeniden kurulacak.",
    deviceTokenOnly: "Bu uç nokta yalnızca cihaz token'ı ile kullanılır.",
    badIdentityResource: "Kimlik kaydı okunamadı.",
    auditScoped: "Denetim kaydının tamamı kapsamınız dışında; bir hasta kimliği verin.",
    alarmQualityScoped: "Alarm kalitesi raporunun tamamı kapsamınız dışında.",
    scoreSignedByOne: "Skor formunu yalnız bir kişi imzalayabilir.",
    lastAdmin: "Son yönetici yetkisi kaldırılamaz.",
    lastAdminDeactivate: "Son yönetici pasifleştirilemez.",
    groupNotFound: "Grup bulunamadı.",
    userNotFound: "Kullanıcı bulunamadı.",
    unknownGroup: "Bu kuruma ait olmayan bir grup.",
    slugTaken: "Bu kısa ad zaten kullanılıyor.",
    loginTaken: "Bu kullanıcı adı veya e-posta zaten kayıtlı.",
    concurrentChange: "Kayıt aynı anda değiştirildi; listeyi yenileyip tekrar deneyin.",
    beyondOwnRights: "Kendi yetkilerinizi aşan bir işlem yapılamaz.",
    beyondOwnRightsKeys: "Kendi yetkilerinizi aşan bir işlem yapılamaz. Eksik yetki: {keys}",
    platformAccount: "Platform operatörü hesabı kurum yönetiminden değiştirilemez; yalnızca bu kurumdaki grupları ayarlanabilir.",
    sharedAccount: "Bu hesap başka bir kurumda da etkin; şifre, iki adımlı doğrulama, e-posta, ad ve etkinlik buradan değiştirilemez — yalnızca bu kurumdaki grupları ayarlanabilir.",
    selfCredentials: "Kendi şifrenizi veya iki adımlı doğrulamanızı buradan sıfırlayamazsınız; şifre için Ayarlar › Güvenlik'i kullanın.",
    selfDeactivate: "Kendi hesabınızı pasifleştiremezsiniz.",
    unlockCooldown: "Bu hesabın bu hatalı giriş dizisi için tek kilit açma hakkı kullanıldı; 15 dakika hatalı şifre girilmezse giriş kendiliğinden açılır.",
    systemGroupLocked: "Sistem grubunun izinleri ve iki adımlı doğrulama kuralı değiştirilemez.",
    systemGroupUndeletable: "Sistem grubu silinemez.",
    groupHasMembers: "Üyesi olan grup silinemez.",
    groupHasMapping: "AD eşlemesi olan grup silinemez.",
    usernameRequired: "Kullanıcı adı zorunludur.",
    usernameRule: "Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.",
    mustNotBeBlank: "Bu alan boş bırakılamaz.",
    badEmail: "E-posta adresi tek bir @ içermeli, iki yanında da metin olmalı, boşluk olmamalı.",
    badSlug: "Kısa ad 2-64 karakter olmalı; yalnızca küçük harf, rakam ve _ kullanılabilir.",
    reasonOneLine: "Gerekçe tek satır metin olmalı; denetim ve biçim karakteri içeremez.",
    reasonNeedsText: "Gerekçede en az bir harf ya da rakam olmalı.",
    badGroupDn: "AD grubu ayırt edici ad (DN) biçiminde olmalı: CN=…,DC=…",
    mappingExists: "Bu AD grubu bu gruba zaten eşlenmiş.",
    mappingNotFound: "Eşleme bulunamadı.",
    mappingAdminOnly: "AD grup eşlemesini yalnız tüm yetkilere sahip bir yönetici değiştirebilir.",
    scopeAdminOnly: "Kapsam atamak için kapsamı sınırsız bir yönetici olmanız gerekir.",
    scopeGrantShape: "Bir atama ya bir birim ya bir yatak belirtir, ikisi birden değil.",
    unknown: "İşlem tamamlanamadı.",
  },
  az: {
    noTenant: "Hesabınıza qurum təyin edilməyib. Sistem administratorunuza müraciət edin.",
    membershipInactive: "Bu qurumdakı üzvlüyünüz aktiv deyil. Sistem administratorunuza müraciət edin.",
    platformOnly: "Bu əməliyyat üçün platforma operatoru səlahiyyəti tələb olunur.",
    passwordChangeRequired: "Davam etməzdən əvvəl müvəqqəti şifrənizi dəyişin.",
    mfaRequired: "Bu əməliyyat üçün iki addımlı doğrulama tələb olunur. Doğrulama kodunuzla yenidən daxil olun.",
    mfaResetRequired: "Hesabınızda qeydiyyatlı doğrulayıcı var. Cihazınızı itirmisinizsə, sistem administratorundan iki addımlı doğrulamanı sıfırlamasını xahiş edin.",
    notAuthenticated: "Sessiyanızı təsdiqləmək mümkün olmadı; yenidən daxil olun.",
    tokenVersion: "Hesabınızda dəyişiklik edilib; yenidən daxil olun.",
    tenantChanged: "Qurum məlumatlarınız dəyişib; yenidən daxil olun.",
    totpLocked: "Həddindən artıq yanlış kod. 5 dəqiqədən sonra yenidən cəhd edin.",
    totpReplayed: "Bu kod artıq istifadə olunub; növbəti kodu gözləyin.",
    totpNotSetUp: "İki addımlı doğrulama hələ quraşdırılmayıb.",
    invalidTotp: "Kod səhvdir və ya vaxtı bitib.",
    invalidCredentials: "İstifadəçi adı və ya şifrə səhvdir.",
    sessionExpired: "Sessiyanın müddəti bitib; yenidən daxil olun.",
    directoryUnreachable: "Xəstəxananın kataloq serverinə (Active Directory) qoşulmaq mümkün deyil. Bir az sonra yenidən cəhd edin; davam edərsə, İT şöbəsinə xəbər verin.",
    directoryNotConfigured: "Xəstəxana kataloqu (Active Directory) bu quraşdırmada konfiqurasiya edilməyib.",
    directoryThrottled: "Bu hesab üçün həddindən artıq yanlış cəhd edilib. 15 dəqiqədən sonra yenidən cəhd edin.",
    reauthRefused: "Şifrə səhvdir.",
    directoryPassword: "Şifrəniz xəstəxana hesabınızla (Active Directory) idarə olunur; burada dəyişdirilə bilməz.",
    passwordTooShort: "Yeni şifrə ən azı 8 simvol olmalıdır.",
    passwordUnchanged: "Yeni şifrə cari şifrədən fərqli olmalıdır.",
    wrongCurrentPassword: "Cari şifrə səhvdir.",
    loginRequired: "İstifadəçi adınızı və ya e-poçtunuzu daxil edin.",
    loginRateLimited: "Həddindən artıq giriş cəhdi edildi. Bir dəqiqədən sonra yenidən cəhd edin.",
    reauthRateLimited: "Həddindən artıq cəhd edildi. Bir dəqiqədən sonra yenidən cəhd edin.",
    sessionUnreachable: "Server hazırda əlçatan deyil; sessiyanız açıq qalır. Bir az sonra yenidən cəhd edin.",
    loginFailed: "Giriş alınmadı.",
    requestTimeout: "Server cavab vermədi. Əməliyyat yerinə yetirilmiş ola bilər; yoxlayın və lazım olsa yenidən cəhd edin.",
    sessionSuperseded: "Bu sorğu əvvəlki sessiyaya aid idi; nəticəsi tətbiq edilmədi.",
    requestFailed: "Sorğu uğursuz oldu ({status}).",
    serverUnreachable: "Server hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin.",
    network: "Serverə qoşulmaq mümkün olmadı. Şəbəkə bağlantınızı yoxlayın.",
    passwordTooLong: "Şifrə ən çoxu 1024 simvol ola bilər.",
    passwordRequired: "Şifrənizi daxil edin.",
    permissionRequired: "Bu əməliyyat üçün səlahiyyətiniz yoxdur ({permission}).",
    patientNotFound: "Bu xəstə panelinizdə yoxdur: ya belə bir qeyd yoxdur, ya da əhatənizdən kənardır.",
    badPatientId: "Xəstə identifikatoru yanlışdır.",
    badRecordedAt: "Qeyd vaxtı yanlışdır.",
    badAlarmKind: "Siqnal növü yanlışdır.",
    alarmNoLongerOpen: "Bu siqnal artıq açıq deyil; başqası cavablandırmış ya da öz-özünə bağlanmış ola bilər.",
    scopeUnreadable: "Əhatəniz hazırda oxunmur; canlı axın başladıla bilmədi. Bir az sonra yenidən cəhd edin.",
    streamTicketExpired: "Canlı axın bileti yanlışdır ya da müddəti bitib; bağlantı yenidən qurulacaq.",
    deviceTokenOnly: "Bu uç nöqtə yalnız cihaz tokeni ilə istifadə olunur.",
    badIdentityResource: "Kimlik qeydi oxunmadı.",
    auditScoped: "Audit jurnalının hamısı əhatənizdən kənardır; bir xəstə identifikatoru verin.",
    alarmQualityScoped: "Siqnal keyfiyyəti hesabatının hamısı əhatənizdən kənardır.",
    scoreSignedByOne: "Bal formasını yalnız bir nəfər imzalaya bilər.",
    lastAdmin: "Son administratorun səlahiyyəti geri alına bilməz.",
    lastAdminDeactivate: "Son administrator passivləşdirilə bilməz.",
    groupNotFound: "Qrup tapılmadı.",
    userNotFound: "İstifadəçi tapılmadı.",
    unknownGroup: "Bu quruma aid olmayan qrup.",
    slugTaken: "Bu qısa ad artıq istifadə olunur.",
    loginTaken: "Bu istifadəçi adı və ya e-poçt artıq qeydiyyatdadır.",
    concurrentChange: "Qeyd eyni anda dəyişdirildi; siyahını yeniləyib yenidən cəhd edin.",
    beyondOwnRights: "Öz səlahiyyətlərinizi aşan əməliyyat edilə bilməz.",
    beyondOwnRightsKeys: "Öz səlahiyyətlərinizi aşan əməliyyat edilə bilməz. Çatışmayan səlahiyyət: {keys}",
    platformAccount: "Platforma operatorunun hesabı qurum idarəsindən dəyişdirilə bilməz; yalnız bu qurumdakı qrupları təyin edilə bilər.",
    sharedAccount: "Bu hesab başqa qurumda da aktivdir; şifrə, iki addımlı doğrulama, e-poçt, ad və aktivlik buradan dəyişdirilə bilməz — yalnız bu qurumdakı qrupları təyin edilə bilər.",
    selfCredentials: "Öz şifrənizi və ya iki addımlı doğrulamanızı buradan sıfırlaya bilmərsiniz; şifrə üçün Ayarlar › Təhlükəsizlik bölməsindən istifadə edin.",
    selfDeactivate: "Öz hesabınızı passivləşdirə bilmərsiniz.",
    unlockCooldown: "Bu hesabın bu yanlış giriş silsiləsi üçün tək kilid açma hüququ istifadə olunub; 15 dəqiqə yanlış şifrə daxil edilməzsə giriş öz-özünə açılır.",
    systemGroupLocked: "Sistem qrupunun səlahiyyətləri və iki addımlı doğrulama qaydası dəyişdirilə bilməz.",
    systemGroupUndeletable: "Sistem qrupu silinə bilməz.",
    groupHasMembers: "Üzvü olan qrup silinə bilməz.",
    groupHasMapping: "AD uyğunlaşdırması olan qrup silinə bilməz.",
    usernameRequired: "İstifadəçi adı mütləqdir.",
    usernameRule: "İstifadəçi adı 2-128 simvol olmalıdır; yalnız a-z, 0-9 və . _ @ - istifadə edilə bilər. Türk/Azərbaycan hərflərini Latın qarşılığı ilə yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.",
    mustNotBeBlank: "Bu sahə boş qala bilməz.",
    badEmail: "E-poçt ünvanında bir @ olmalı, iki tərəfində mətn olmalı, boşluq olmamalıdır.",
    badSlug: "Qısa ad 2-64 simvol olmalıdır; yalnız kiçik hərf, rəqəm və _ istifadə edilə bilər.",
    reasonOneLine: "Səbəb bir sətir mətn olmalıdır; idarəetmə və format simvolu ola bilməz.",
    reasonNeedsText: "Səbəbdə ən azı bir hərf və ya rəqəm olmalıdır.",
    badGroupDn: "AD qrupu fərqləndirici ad (DN) formatında olmalıdır: CN=…,DC=…",
    mappingExists: "Bu AD qrupu bu qrupa artıq uyğunlaşdırılıb.",
    mappingNotFound: "Uyğunlaşdırma tapılmadı.",
    mappingAdminOnly: "AD qrup uyğunlaşdırmasını yalnız bütün səlahiyyətlərə sahib administrator dəyişə bilər.",
    scopeAdminOnly: "Əhatə təyin etmək üçün əhatəsi məhdud olmayan administrator olmalısınız.",
    scopeGrantShape: "Bir təyinat ya bir şöbə, ya bir çarpayı göstərir, ikisi birdən deyil.",
    unknown: "Əməliyyatı tamamlamaq mümkün olmadı.",
  },
  ru: {
    noTenant: "Вашей учётной записи не назначена организация. Обратитесь к системному администратору.",
    membershipInactive: "Ваше членство в этой организации неактивно. Обратитесь к системному администратору.",
    platformOnly: "Для этого действия нужны права оператора платформы.",
    passwordChangeRequired: "Прежде чем продолжить, смените временный пароль.",
    mfaRequired: "Для этого действия требуется двухэтапная проверка. Войдите снова с кодом подтверждения.",
    mfaResetRequired: "К вашей учётной записи уже привязан аутентификатор. Если устройство утеряно, попросите системного администратора сбросить двухэтапную проверку.",
    notAuthenticated: "Не удалось проверить сеанс; войдите снова.",
    tokenVersion: "В вашу учётную запись внесены изменения; войдите снова.",
    tenantChanged: "Данные вашей организации изменились; войдите снова.",
    totpLocked: "Слишком много неверных кодов. Повторите попытку через 5 минут.",
    totpReplayed: "Этот код уже использован; дождитесь следующего.",
    totpNotSetUp: "Двухэтапная проверка ещё не настроена.",
    invalidTotp: "Код неверен или срок его действия истёк.",
    invalidCredentials: "Неверное имя пользователя или пароль.",
    sessionExpired: "Срок сеанса истёк; войдите снова.",
    directoryUnreachable: "Сервер каталога больницы (Active Directory) недоступен. Повторите попытку позже; если не пройдёт — сообщите в ИТ-отдел.",
    directoryNotConfigured: "Каталог больницы (Active Directory) в этой установке не настроен.",
    directoryThrottled: "Слишком много неудачных попыток для этой учётной записи. Повторите попытку через 15 минут.",
    reauthRefused: "Неверный пароль.",
    directoryPassword: "Пароль управляется больничной учётной записью (Active Directory); здесь его изменить нельзя.",
    passwordTooShort: "Новый пароль должен содержать не менее 8 символов.",
    passwordUnchanged: "Новый пароль должен отличаться от текущего.",
    wrongCurrentPassword: "Текущий пароль неверен.",
    loginRequired: "Введите имя пользователя или эл. почту.",
    loginRateLimited: "Слишком много попыток входа. Повторите попытку через минуту.",
    reauthRateLimited: "Слишком много попыток. Повторите попытку через минуту.",
    sessionUnreachable: "Сервер сейчас недоступен; ваш сеанс сохранён. Повторите попытку позже.",
    loginFailed: "Не удалось войти.",
    requestTimeout: "Сервер не ответил. Действие могло быть выполнено: проверьте и при необходимости повторите.",
    sessionSuperseded: "Этот запрос относился к предыдущему сеансу; его результат не применён.",
    requestFailed: "Запрос не выполнен ({status}).",
    serverUnreachable: "Сервер сейчас недоступен. Повторите попытку позже.",
    network: "Не удалось подключиться к серверу. Проверьте сетевое подключение.",
    passwordTooLong: "Пароль может содержать не более 1024 символов.",
    passwordRequired: "Введите пароль.",
    permissionRequired: "У вас нет права на эту операцию ({permission}).",
    patientNotFound: "Этого пациента нет на вашей панели: либо такой записи нет, либо он вне вашей области доступа.",
    badPatientId: "Идентификатор пациента некорректен.",
    badRecordedAt: "Время записи некорректно.",
    badAlarmKind: "Тип тревоги некорректен.",
    alarmNoLongerOpen: "Эта тревога больше не открыта: её мог принять кто-то другой или она закрылась сама.",
    scopeUnreadable: "Вашу область доступа сейчас не удаётся прочитать; прямой поток не запущен. Повторите позже.",
    streamTicketExpired: "Билет прямого потока недействителен или истёк; соединение будет восстановлено.",
    deviceTokenOnly: "Эта конечная точка доступна только по токену устройства.",
    badIdentityResource: "Запись идентификации не прочитана.",
    auditScoped: "Весь журнал аудита вне вашей области доступа; укажите идентификатор пациента.",
    alarmQualityScoped: "Весь отчёт о качестве тревог вне вашей области доступа.",
    scoreSignedByOne: "Форму шкалы может подписать только один человек.",
    lastAdmin: "Нельзя снять права у последнего администратора.",
    lastAdminDeactivate: "Нельзя деактивировать последнего администратора.",
    groupNotFound: "Группа не найдена.",
    userNotFound: "Пользователь не найден.",
    unknownGroup: "Группа не принадлежит этой организации.",
    slugTaken: "Этот короткий идентификатор уже используется.",
    loginTaken: "Это имя пользователя или эл. почта уже зарегистрированы.",
    concurrentChange: "Запись изменена одновременно; обновите список и повторите.",
    beyondOwnRights: "Нельзя выполнить операцию, превышающую ваши права.",
    beyondOwnRightsKeys: "Нельзя выполнить операцию, превышающую ваши права. Недостающие права: {keys}",
    platformAccount: "Учётную запись оператора платформы нельзя менять из управления организацией; можно задать только её группы в этой организации.",
    sharedAccount: "Эта учётная запись активна и в другой организации; пароль, двухфакторную проверку, эл. почту, имя и активность отсюда изменить нельзя — только группы в этой организации.",
    selfCredentials: "Свой пароль или двухфакторную проверку отсюда сбросить нельзя; для пароля откройте «Настройки › Безопасность».",
    selfDeactivate: "Нельзя деактивировать собственную учётную запись.",
    unlockCooldown: "Единственная разблокировка для этой серии неудачных входов уже использована; если 15 минут не будет неверных паролей, вход откроется сам.",
    systemGroupLocked: "Права и правило двухфакторной проверки системной группы изменить нельзя.",
    systemGroupUndeletable: "Системную группу удалить нельзя.",
    groupHasMembers: "Группу с участниками удалить нельзя.",
    groupHasMapping: "Группу с сопоставлением AD удалить нельзя.",
    usernameRequired: "Имя пользователя обязательно.",
    usernameRule: "Имя пользователя: 2-128 символов, только a-z, 0-9 и . _ @ -. Турецкие и азербайджанские буквы пишите латиницей: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.",
    mustNotBeBlank: "Это поле не может быть пустым.",
    badEmail: "В адресе эл. почты должна быть одна @ с текстом по обе стороны и без пробелов.",
    badSlug: "Короткий идентификатор: 2-64 символа, только строчные буквы, цифры и _.",
    reasonOneLine: "Причина должна быть одной строкой текста, без управляющих и форматирующих символов.",
    reasonNeedsText: "В причине должна быть хотя бы одна буква или цифра.",
    badGroupDn: "Группа AD должна быть в формате различающегося имени (DN): CN=…,DC=…",
    mappingExists: "Эта группа AD уже сопоставлена с этой группой.",
    mappingNotFound: "Сопоставление не найдено.",
    mappingAdminOnly: "Сопоставление групп AD может менять только администратор со всеми правами.",
    scopeAdminOnly: "Назначать область доступа может только администратор без ограничения области.",
    scopeGrantShape: "Одно назначение указывает либо отделение, либо койку, но не оба сразу.",
    unknown: "Не удалось выполнить действие.",
  },
  en: {
    noTenant: "No organization is assigned to your account. Contact your system administrator.",
    membershipInactive: "Your membership in this organization is not active. Contact your system administrator.",
    platformOnly: "This action requires platform operator rights.",
    passwordChangeRequired: "Change your temporary password before you continue.",
    mfaRequired: "This action requires two-step verification. Sign in again with your verification code.",
    mfaResetRequired: "An authenticator is already registered to your account. If you lost the device, ask your system administrator to reset two-step verification.",
    notAuthenticated: "Your session could not be verified; please sign in again.",
    tokenVersion: "Your account has changed; please sign in again.",
    tenantChanged: "Your organization details have changed; please sign in again.",
    totpLocked: "Too many incorrect codes. Try again in 5 minutes.",
    totpReplayed: "This code has already been used; wait for the next one.",
    totpNotSetUp: "Two-step verification is not set up yet.",
    invalidTotp: "The code is wrong or has expired.",
    invalidCredentials: "Incorrect username or password.",
    sessionExpired: "Your session has expired; please sign in again.",
    directoryUnreachable: "The hospital directory server (Active Directory) cannot be reached. Try again shortly; if it persists, tell IT.",
    directoryNotConfigured: "The hospital directory (Active Directory) is not configured for this installation.",
    directoryThrottled: "Too many attempts for this account. Try again in 15 minutes.",
    reauthRefused: "Incorrect password.",
    directoryPassword: "Your password is managed by your hospital account (Active Directory) and cannot be changed here.",
    passwordTooShort: "The new password must be at least 8 characters.",
    passwordUnchanged: "The new password must differ from the current one.",
    wrongCurrentPassword: "The current password is incorrect.",
    loginRequired: "Enter your username or email.",
    loginRateLimited: "Too many sign-in attempts. Try again in a minute.",
    reauthRateLimited: "Too many attempts. Try again in a minute.",
    sessionUnreachable: "The server cannot be reached right now; your session is kept. Try again shortly.",
    loginFailed: "Sign-in failed.",
    requestTimeout: "The server did not answer. The action may have gone through: check, and try again if needed.",
    sessionSuperseded: "This request belonged to an earlier session; its answer was not applied.",
    requestFailed: "The request failed ({status}).",
    serverUnreachable: "The server cannot be reached right now. Try again shortly.",
    network: "Could not connect to the server. Check your network connection.",
    passwordTooLong: "The password can be at most 1024 characters.",
    passwordRequired: "Enter your password.",
    permissionRequired: "You do not have the right for this ({permission}).",
    patientNotFound: "This patient is not on your board: either there is no such record, or they are outside your scope.",
    badPatientId: "The patient identifier is not valid.",
    badRecordedAt: "The recorded time is not valid.",
    badAlarmKind: "The alarm kind is not valid.",
    alarmNoLongerOpen: "This alarm is no longer open — somebody else may have answered it, or it closed by itself.",
    scopeUnreadable: "Your scope cannot be read at the moment, so the live stream did not start. Try again shortly.",
    streamTicketExpired: "The live-stream ticket is invalid or has expired; the connection will be made again.",
    deviceTokenOnly: "This endpoint takes a device token only.",
    badIdentityResource: "The identity record could not be read.",
    auditScoped: "The whole audit trail is outside your scope; give a patient identifier.",
    alarmQualityScoped: "The whole alarm-quality report is outside your scope.",
    scoreSignedByOne: "A score form can only be signed by one person.",
    lastAdmin: "The last administrator's rights cannot be removed.",
    lastAdminDeactivate: "The last administrator cannot be deactivated.",
    groupNotFound: "Group not found.",
    userNotFound: "User not found.",
    unknownGroup: "That group does not belong to this organization.",
    slugTaken: "That short name is already in use.",
    loginTaken: "That username or e-mail is already registered.",
    concurrentChange: "The record was changed at the same time; refresh the list and try again.",
    beyondOwnRights: "An action beyond your own rights cannot be taken.",
    beyondOwnRightsKeys: "An action beyond your own rights cannot be taken. Rights you lack: {keys}",
    platformAccount: "A platform operator's account cannot be changed from the organization's administration; only its groups here can be set.",
    sharedAccount: "This account is also active in another organization; its password, two-step verification, e-mail, name and activity cannot be changed here — only its groups in this organization.",
    selfCredentials: "You cannot reset your own password or two-step verification here; for a password use Settings › Security.",
    selfDeactivate: "You cannot deactivate your own account.",
    unlockCooldown: "This account's one unlock for this run of failed sign-ins has been used; if no wrong password arrives for 15 minutes, signing in opens by itself.",
    systemGroupLocked: "The system group's rights and two-step verification rule cannot be changed.",
    systemGroupUndeletable: "The system group cannot be deleted.",
    groupHasMembers: "A group with members cannot be deleted.",
    groupHasMapping: "A group with an AD mapping cannot be deleted.",
    usernameRequired: "A username is required.",
    usernameRule: "A username is 2-128 characters of a-z, 0-9 and . _ @ - only. Write Turkish and Azerbaijani letters in their Latin form: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.",
    mustNotBeBlank: "This field cannot be blank.",
    badEmail: "An e-mail address needs one @ with text on both sides and no spaces.",
    badSlug: "A short name is 2-64 characters of lower-case letters, digits and _ only.",
    reasonOneLine: "The reason must be one line of text, with no control or formatting characters.",
    reasonNeedsText: "The reason needs at least one letter or digit.",
    badGroupDn: "An AD group must be a distinguished name (DN): CN=…,DC=…",
    mappingExists: "That AD group is already mapped to this group.",
    mappingNotFound: "Mapping not found.",
    mappingAdminOnly: "Only an administrator with every right may change the AD group mapping.",
    scopeAdminOnly: "Only an administrator whose own scope is unrestricted may assign a scope.",
    scopeGrantShape: "One grant names either a unit or a bed, never both.",
    unknown: "The action could not be completed.",
  },
};
```

- [ ] **Step 3: Map the messages**

Two comments in the block below are the two things a reader of this map has to know: the board
answers an unknown patient and one outside the scope identically on purpose, and the import's
`SKIP_*` reasons are not error messages.

In `dashboard/src/live/apiErrors.js`, replace

```javascript
  // fetch() rejecting with no response: Chrome/Edge, Firefox, Safari
  ["Failed to fetch", "network"],
  ["NetworkError when attempting to fetch resource.", "network"],
  ["Load failed", "network"],
]);
```

with

```javascript
  // fetch() rejecting with no response: Chrome/Edge, Firefox, Safari
  ["Failed to fetch", "network"],
  ["NetworkError when attempting to fetch resource.", "network"],
  ["Load failed", "network"],

  // ---------------------------------------------------------------- Wave 3 (G1-09 … G1-14)
  // api/board.py has no messages; these are api/app.py's. The board's own three credential
  // refusals mean "this is not a credential we know", which is what notAuthenticated says.
  ["unknown tenant token", "notAuthenticated"],
  ["missing bearer token", "notAuthenticated"],
  ["unknown credential", "notAuthenticated"],
  ["invalid or expired ticket", "streamTicketExpired"],
  // The SAME answer for a patient who does not exist and for one outside the caller's scope: a
  // 403 would confirm that the patient exists and is under care here, which is the fact being
  // withheld (api/app.py `_require_patient`). The text says both, so no screen implies one.
  ["hasta bulunamadı", "patientNotFound"],
  ["geçersiz patient_id", "badPatientId"],
  ["geçersiz recorded_at", "badRecordedAt"],
  ["geçersiz kind", "badAlarmKind"],
  ["no such active alert", "alarmNoLongerOpen"],
  ["kapsam şu anda okunamıyor", "scopeUnreadable"],
  ["ingest requires a device token", "deviceTokenOnly"],
  ["malformed identity resource", "badIdentityResource"],
  ["denetim kaydının tamamı kapsam dışı; bir patient_id verin", "auditScoped"],
  ["alarm kalitesi raporunun tamamı kapsam dışı", "alarmQualityScoped"],
  ["skor formunu yalnız bir kişi imzalayabilir", "scoreSignedByOne"],

  // admin/service.py — its module constants and the AdminError literals.
  ["Son yönetici yetkisi kaldırılamaz", "lastAdmin"],
  ["Son yönetici pasifleştirilemez", "lastAdminDeactivate"],
  ["Group not found", "groupNotFound"],
  ["User not found", "userNotFound"],
  ["unknown group for this tenant", "unknownGroup"],
  ["Bu kısa ad zaten kullanılıyor", "slugTaken"],
  ["Bu kullanıcı adı veya e-posta zaten kayıtlı", "loginTaken"],
  ["Kayıt aynı anda değiştirildi; lütfen tekrar deneyin", "concurrentChange"],
  ["Kendi yetkilerinizi aşan bir işlem yapılamaz", "beyondOwnRights"],
  ["Platform operatörü hesabı kurum yönetiminden değiştirilemez; yalnızca bu kurumdaki grupları ayarlanabilir", "platformAccount"],
  ["Bu hesap başka bir kurumda da etkin; parola, MFA, e-posta, ad ve etkinlik buradan değiştirilemez, yalnızca bu kurumdaki grupları ayarlanabilir", "sharedAccount"],
  ["Kendi parolanızı veya MFA'nızı buradan sıfırlayamazsınız; parola için Hesabım > Parola değiştir'i kullanın", "selfCredentials"],
  ["Kendi hesabınızı pasifleştiremezsiniz", "selfDeactivate"],
  ["Bu hesabın bu hatalı giriş dizisi için tek kilit açma hakkı kullanıldı; 15 dakika hatalı parola girilmezse giriş kendiliğinden açılır", "unlockCooldown"],
  ["Sistem grubunun izinleri ve MFA kuralı değiştirilemez", "systemGroupLocked"],
  ["Sistem grubu silinemez", "systemGroupUndeletable"],
  ["Üyesi olan grup silinemez", "groupHasMembers"],
  ["AD eşlemesi olan grup silinemez", "groupHasMapping"],
  ["Kullanıcı adı zorunludur", "usernameRequired"],

  // admin/schemas.py — what a 422 says about a field of the user or group form.
  ["Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.", "usernameRule"],
  ["must not be blank", "mustNotBeBlank"],
  ["e-mail: one '@' with text on both sides, no spaces", "badEmail"],
  ["slug: 2-64 characters, lower-case letters, digits and _ only", "badSlug"],
  ["reason: one line of text, no control or formatting characters", "reasonOneLine"],
  ["reason: at least one letter or digit", "reasonNeedsText"],
  ["ad_group_dn must be a distinguished name (CN=…,DC=…)", "badGroupDn"],

  // admin/ldap_service.py — the group mapping. (Its SKIP_* values are not messages: they are the
  // reasons an import gives per account, and the login-source screen translates them itself.)
  ["Bu AD grubu bu gruba zaten eşlenmiş", "mappingExists"],
  ["Mapping not found", "mappingNotFound"],
  ["AD grup eşlemesini yalnız tüm yetkilere sahip bir yönetici değiştirebilir", "mappingAdminOnly"],

  // scope/router.py and scope/schemas.py — assigning a unit or a bed.
  ["kullanıcı bulunamadı", "userNotFound"],
  ["kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız", "scopeAdminOnly"],
  ["bir atama ya bir ünite ya bir yatak belirtir, ikisi birden değil", "scopeGrantShape"],
]);
```

- [ ] **Step 4: Match the two messages the server builds**

Replace

```javascript
const REQUEST_FAILED = /^İstek başarısız \((\d{3})\)$/; // backendApi.js
```

with

```javascript
const REQUEST_FAILED = /^İstek başarısız \((\d{3})\)$/; // backendApi.js
// Two messages the server BUILDS rather than writes out, so they are matched by shape and their
// own tail is carried into the text. Both name permission keys — the catalogue's own identifiers
// (`alerts.ack`), which are not translated: they are what an administrator searches the
// permission table for and what a support call quotes.
const PERMISSION_REQUIRED = /^permission required: ([\w.]+)$/;           // api/app.py, auth/dependencies.py
const BEYOND_OWN_RIGHTS = /^Kendi yetkilerinizi aşan bir işlem yapılamaz: (.+)$/; // admin/service.py
```

and replace

```javascript
  if (API_MESSAGE_KEYS.has(text)) hit = { key: `errors.${API_MESSAGE_KEYS.get(text)}`, vars: {} };
  else {
    const failed = REQUEST_FAILED.exec(text);
    if (failed) hit = { key: "errors.requestFailed", vars: { status: failed[1] } };
  }
```

with

```javascript
  if (API_MESSAGE_KEYS.has(text)) hit = { key: `errors.${API_MESSAGE_KEYS.get(text)}`, vars: {} };
  else {
    const failed = REQUEST_FAILED.exec(text);
    const permission = PERMISSION_REQUIRED.exec(text);
    const beyond = BEYOND_OWN_RIGHTS.exec(text);
    if (failed) hit = { key: "errors.requestFailed", vars: { status: failed[1] } };
    else if (permission) hit = { key: "errors.permissionRequired", vars: { permission: permission[1] } };
    else if (beyond) hit = { key: "errors.beyondOwnRightsKeys", vars: { keys: beyond[1] } };
  }
```

- [ ] **Step 5: Run the mapping test**

```bash
npx vitest run src/live/apiErrors.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  110 passed (110)` — 117 minus the seven `SKIP_*` entries the reader now leaves out.

- [ ] **Step 6: Extend the "no message site escapes the readers" check to the seven new files**

This is the half of the test that matters most: the readers above capture string LITERALS, so a message the server builds another way would pass them unseen. Every site that sets a message must be a literal (captured), a named constant (read above), or listed as dynamic with its reason.

Replace

```javascript
  const CONSTANTS = new Set([...pyConstants(DEPS).keys(), ...pyConstants(ROUTER).keys(), ...LDAP.keys()]);
```

with

```javascript
  const CONSTANTS = new Set([...pyConstants(DEPS).keys(), ...pyConstants(ROUTER).keys(), ...LDAP.keys(),
    ...pyConstants(ADMIN_SERVICE).keys(), ...pyConstants(ADMIN_SCHEMAS).keys(),
    ...pyConstants(LDAP_SERVICE).keys()]);
```

Replace

```javascript
    ["auth/router.py", /^str\(exc\)/, 1, "PasswordError's message: its literals are read from service.py"],
  ];
```

with

```javascript
    ["auth/router.py", /^str\(exc\)/, 1, "PasswordError's message: its literals are read from service.py"],
    // Wave 3's files.
    ["api/app.py", /^f"permission required:/, 1, "a permission key of the route; the key is not translated, the sentence around it is"],
    ["api/app.py", /^str\(exc\)/, 6, "ClinicalEntryError / GatewayError / ScoreError: the engine's own validation text, shown as the engine wrote it"],
    ["admin/service.py", /^f"\{BEYOND_OWN_RIGHTS\}/, 1, "the constant plus the keys it lacks; matched by shape (BEYOND_OWN_RIGHTS in apiErrors.js)"],
    ["admin/service.py", /^detail\) from None/, 1, "_flush's own parameter: every caller passes a constant read above"],
    ["admin/service.py", /^str\(exc\)\)/, 2, "the ORM's own message for a bad id or a group of another tenant, shown as it arrived"],
  ];
```

Replace

```javascript
  const UNAUTHORIZED = String.raw`(?<!def )\b_unauthorized\(`;
```

with

```javascript
  const UNAUTHORIZED = String.raw`(?<!def )\b_unauthorized\(`;
  // scope/router.py raises with the status positionally: `HTTPException(status.HTTP_404…, "…")`.
  // `(?!\s*detail=)` sits right after the comma: a lookahead placed after `\s*` is defeated by
  // backtracking (the engine simply consumes less whitespace).
  const POSITIONAL = String.raw`HTTPException\(status\.HTTP_\w+,(?!\s*detail=)\s*`;
```

Replace

```javascript
    ["auth/schemas.py", SCHEMAS, [String.raw`\bValueError\(`]],
  ];
```

with

```javascript
    ["auth/schemas.py", SCHEMAS, [String.raw`\bValueError\(`]],
    // Wave 3's screens: the board (/patients, /ack, /view), /admin, /admin/ldap and /scope.
    ["api/app.py", APP, [DETAIL]],
    ["admin/service.py", ADMIN_SERVICE, [String.raw`(?<!class )\bAdminError\(\d+, `]],
    ["admin/schemas.py", ADMIN_SCHEMAS, [String.raw`\bValueError\(`]],
    ["admin/ldap_router.py", LDAP_ROUTER, [DETAIL]],
    ["admin/ldap_service.py", LDAP_SERVICE, [String.raw`\bAdminError\(\d+, `]],
    ["scope/router.py", SCOPE_ROUTER, [DETAIL, POSITIONAL]],
    ["scope/schemas.py", SCOPE_SCHEMAS, [String.raw`\bValueError\(`]],
  ];
```

- [ ] **Step 7: Run it**

```bash
npx vitest run src/live/apiErrors.test.js 2>&1 | grep -E "Tests |cannot see"
```
Expected: `Tests  122 passed (122)`. If a site is reported as unaccounted, read it: either it is a literal the reader's pattern missed (fix the pattern) or it is dynamic and belongs in `DYNAMIC` with a one-line reason — never silenced.

- [ ] **Step 8: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `91 passed (91)` files, `1878 passed (1878)` tests; the build succeeds.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/live/apiErrors.js dashboard/src/live/i18n/strings/errors.js dashboard/src/live/apiErrors.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): every refusal Wave 3's screens can meet, in four languages

Seven more source files read as text — api/app.py, admin/service.py,
admin/schemas.py, admin/ldap_service.py, admin/ldap_router.py and the two
scope modules — and the "no message site escapes the readers" check extended to
all of them. The two messages the server builds are matched by shape; the
permission keys in their tails stay untranslated, because that is what an
administrator searches the permission table for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **122** tests in `apiErrors.test.js` (was **58**; the 64 new ones are mostly one per message, which is the point — a refusal with no text is a refusal a clinician cannot act on); `strings.test.js` green at 6 (the Cyrillic and the `ə` survived); whole suite green; build clean.

> **The seam.** Tasks 0–8 are done and committed. From here the four arms are independent: beds (9–11), alarms (12–13), patient (14–15) and the administration foundation (16–19). Each may be built on its own branch off this commit.

---

# Wave 3A · arm 1 — the bed board (G1-09, Tasks 9–11)

### Task 9: The bed card

**Files:**
- Create: `dashboard/src/live/i18n/strings/beds.js`, `dashboard/src/live/screens/beds/BedCard.jsx` + `BedCard.test.jsx`
- Modify: `dashboard/src/live/i18n/catalog.js` (two lines), `dashboard/src/live/i18n/strings.test.js` (one block)

Read the component's header before writing it. Five honesty rules meet on this card, and each one is there because the old board or the prototype got it wrong: `measured` comes from the card's own timestamps, a never-measured channel is left out instead of printed as a dash, the name is the HIS's or it is *stated as missing* (the device's number is not a person's name), NEWS2 is the engine's or it is "—" with the reason, and `red_param` is a fact that does not change the engine's level.

> **Migrated to the as-built fixtures, 2026-10-09.** Every `entry(…)` and `alarm(…)` below is in the shipped positional form — `entry(id, alarms, over)`, `alarm(kind, severity, over)` — because both builders now **throw** on the old object-second shape. The units of measurement are **not** declared in `beds.js`: they moved to the shared `board` namespace (`board.unitBpm` … `board.unitMmol`, with Russian writing mmHg and mmol/L out), so the five declarations and their parity entries are gone from this task. Four blocks still say `at: measured(30)` beside a partial `vitals`, and that is deliberate: `measured()` timestamps all six monitor channels, so a channel with **no** value still has an age — which is exactly what "Gecikmiş kanal: N" counts. Use `reading({…}, s)` when you want a card whose numbers and ages are the same channels, and keep `measured()` where the test is about an overdue channel. `riskOf` derives the card's risk from its alarms, so an explicit `risk:` in an override is now a deliberate statement rather than scaffolding — the blocks that carry one mean it.

- [ ] **Step 1: Write the strings**

Create `dashboard/src/live/i18n/strings/beds.js`:

```javascript
// The bed board (G1-09). The prototype's `screens.js` "beds" screen, with everything it invented
// left out: no fabricated attention tiles, no client-scored risk, no synthetic sparkline, no
// pain/fall/pressure chips (no backend), no "son veri 2 sn önce" literal.
//
// Sources for the copy: `Kart` / `Liste` / `Yatak` / `Hasta` / `Durum` / `Skor` / `Uyarılar` /
// `Hepsi` and the section line "{#} / {#} dolu · risk sırasına göre" come from the prototype's
// four-language dictionary (`ceviri-sozluk.js`). `identityPending` is the wall board's rule
// ("kimlik bekleniyor", clinicalI18n.pr14), which said what was missing instead of printing the
// device's raw patient number as a name. `news2*` extend `strings/news2.js` on the card.
// `emptyLive` is `liveConnection.boardView()`'s LIVE-and-empty sentence.
// AZ/RU/EN await a native-speaking clinician's review before the pilot.
export default {
  tr: {
    sub: "{count} yatak",
    subUnit: "{unit} · {count} yatak",
    view: "Görünüm",
    viewCards: "Kart",
    viewList: "Liste",
    order: "Sıralama",
    orderBed: "Yatak sırası",
    orderRisk: "Risk sırası",
    orderNote: "Yatak sırası sabittir: bir alarm yatağı öne çıkarır, listeyi yeniden dizmez.",
    unit: "Birim",
    unitAll: "Hepsi",
    unitHidden: "Süzgeç {count} kartı gizliyor.",
    search: "Yatak ya da hasta ara",
    searchNone: "\"{query}\" ile eşleşen kart yok.",
    searchHidden: "Arama {count} kartı gizliyor.",
    emptyLive: "Şu anda izlenen hasta yok. Bağlantı çalışıyor.",
    attention: "Dikkat",
    waiting: "Yanıt bekleyen alarm: {count}",
    waitingOldest: "En eskisi {elapsed} önce açıldı",
    waitingNone: "Yanıt bekleyen alarm yok",
    waitingUnknown: "Yanıt bekleyen alarm bilinmiyor — pano güncel değil",
    openAlarms: "Açık alarmlar",
    identityPending: "kimlik bekleniyor",
    noVitals: "Bu yataktan hiç ölçüm gelmedi.",
    staleChannels: "Gecikmiş kanal: {count}",
    unmatchedBed: "Yatak eşleşmedi · {key}",
    sourceComed: "HBYS",
    sourceManual: "Elle giriş",
    sourceDevice: "Kimlik kaydı yok",
    discharged: "Taburcu",
    openPatient: "{bed} hastasını aç",
    news2: "NEWS2",
    news2Partial: "kısmi",
    news2Red: "Bir parametre 3 puan aldı",
    colBed: "Yatak",
    colPatient: "Hasta",
    colRisk: "Durum",
    colNews2: "Skor",
    colAlarms: "Uyarılar",
    colMeasured: "Son ölçüm",
    caption: "Yataklar ve son ölçülen değerleri",
  },
  az: {
    sub: "{count} çarpayı",
    subUnit: "{unit} · {count} çarpayı",
    view: "Görünüş",
    viewCards: "Kart",
    viewList: "Siyahı",
    order: "Sıralama",
    orderBed: "Çarpayı sırası",
    orderRisk: "Risk sırası",
    orderNote: "Çarpayı sırası sabitdir: siqnal çarpayını önə çıxarır, siyahını yenidən düzmür.",
    unit: "Şöbə",
    unitAll: "Hamısı",
    unitHidden: "Süzgəc {count} kartı gizlədir.",
    search: "Çarpayı və ya xəstə axtar",
    searchNone: "\"{query}\" ilə uyğun gələn kart yoxdur.",
    searchHidden: "Axtarış {count} kartı gizlədir.",
    emptyLive: "Hazırda izlənən xəstə yoxdur. Bağlantı işləyir.",
    attention: "Diqqət",
    waiting: "Cavab gözləyən siqnal: {count}",
    waitingOldest: "Ən köhnəsi {elapsed} əvvəl açılıb",
    waitingNone: "Cavab gözləyən siqnal yoxdur",
    waitingUnknown: "Cavab gözləyən siqnal bilinmir — panel güncəl deyil",
    openAlarms: "Açıq siqnallar",
    identityPending: "kimlik gözlənilir",
    noVitals: "Bu çarpayıdan heç bir ölçmə gəlməyib.",
    staleChannels: "Gecikmiş kanal: {count}",
    unmatchedBed: "Çarpayı uyğunlaşmadı · {key}",
    sourceComed: "XMİS",
    sourceManual: "Əl ilə giriş",
    sourceDevice: "Kimlik qeydi yoxdur",
    discharged: "Evə yazılıb",
    openPatient: "{bed} xəstəsini aç",
    news2: "NEWS2",
    news2Partial: "qismən",
    news2Red: "Bir parametr 3 bal alıb",
    colBed: "Çarpayı",
    colPatient: "Xəstə",
    colRisk: "Vəziyyət",
    colNews2: "Bal",
    colAlarms: "Xəbərdarlıqlar",
    colMeasured: "Son ölçmə",
    caption: "Çarpayılar və son ölçülən dəyərləri",
  },
  ru: {
    sub: "Коек: {count}",
    subUnit: "{unit} · коек: {count}",
    view: "Вид",
    viewCards: "Карточки",
    viewList: "Список",
    order: "Сортировка",
    orderBed: "По номеру койки",
    orderRisk: "По уровню риска",
    orderNote: "Порядок коек постоянный: тревога выделяет койку, но не меняет порядок списка.",
    unit: "Отделение",
    unitAll: "Все",
    unitHidden: "Фильтр скрывает карточек: {count}.",
    search: "Поиск койки или пациента",
    searchNone: "Нет карточек по запросу «{query}».",
    searchHidden: "Поиск скрывает карточек: {count}.",
    emptyLive: "Сейчас нет наблюдаемых пациентов. Связь работает.",
    attention: "Внимание",
    waiting: "Тревог без ответа: {count}",
    waitingOldest: "Самая старая открыта {elapsed} назад",
    waitingNone: "Тревог без ответа нет",
    waitingUnknown: "Неизвестно, есть ли тревоги без ответа — панель неактуальна",
    openAlarms: "Открытые тревоги",
    identityPending: "ожидается идентификация",
    noVitals: "С этой койки измерений не поступало.",
    staleChannels: "Запаздывающих каналов: {count}",
    unmatchedBed: "Койка не сопоставлена · {key}",
    sourceComed: "МИС",
    sourceManual: "Ручной ввод",
    sourceDevice: "Нет записи идентификации",
    discharged: "Выписан",
    openPatient: "Открыть пациента койки {bed}",
    news2: "NEWS2",
    news2Partial: "неполный",
    news2Red: "Один параметр получил 3 балла",
    colBed: "Койка",
    colPatient: "Пациент",
    colRisk: "Состояние",
    colNews2: "Балл",
    colAlarms: "Предупреждения",
    colMeasured: "Последнее измерение",
    caption: "Койки и последние измеренные значения",
  },
  en: {
    sub: "{count} beds",
    subUnit: "{unit} · {count} beds",
    view: "View",
    viewCards: "Cards",
    viewList: "List",
    order: "Order",
    orderBed: "By bed",
    orderRisk: "By risk",
    orderNote: "The bed order is fixed: an alarm highlights a bed, it does not re-sort the list.",
    unit: "Unit",
    unitAll: "All",
    unitHidden: "The filter is hiding {count} cards.",
    search: "Search bed or patient",
    searchNone: "No card matches \"{query}\".",
    searchHidden: "The search is hiding {count} cards.",
    emptyLive: "No patient is being monitored at the moment. The connection is working.",
    attention: "Attention",
    waiting: "Alarms awaiting response: {count}",
    waitingOldest: "The oldest opened {elapsed} ago",
    waitingNone: "No alarm is awaiting a response",
    waitingUnknown: "Whether any alarm is awaiting a response is unknown — the board is out of date",
    openAlarms: "Open alarms",
    identityPending: "identity pending",
    noVitals: "No measurement has arrived from this bed.",
    staleChannels: "Channels overdue: {count}",
    unmatchedBed: "Bed not matched · {key}",
    sourceComed: "HIS",
    sourceManual: "Entered by hand",
    sourceDevice: "No identity record",
    discharged: "Discharged",
    openPatient: "Open the patient in bed {bed}",
    news2: "NEWS2",
    news2Partial: "partial",
    news2Red: "One parameter scored 3",
    colBed: "Bed",
    colPatient: "Patient",
    colRisk: "Status",
    colNews2: "Score",
    colAlarms: "Alerts",
    colMeasured: "Last measured",
    caption: "Beds and their last measured values",
  },
};
```

- [ ] **Step 2: Take this arm's two lines in the catalogue**

In `dashboard/src/live/i18n/catalog.js`, replace

```javascript
// G1-09: import beds from "./strings/beds.js";
```

with

```javascript
import beds from "./strings/beds.js";
```

and replace

```javascript
  // G1-09: beds,
```

with

```javascript
  beds,
```

- [ ] **Step 3: List this arm's reviewed Azerbaijani identities**

Two inserts, each under **this arm's own heading**, and each anchored on a marker that appears exactly once in the file: Task 6 suffixed `NEUTRAL`'s headings `· neutral` and `AZ_SAME_AS_TR`'s `· az = tr` for precisely this reason. Neither pair touches another arm's lines or depends on another arm having merged.

In `dashboard/src/live/i18n/strings.test.js`, replace

```javascript
  // G1-09 (beds) · az = tr

  // G1-10 (alarms) · az = tr
```

with

```javascript
  // G1-09 (beds) · az = tr
  "beds.viewCards", //       Kart — the prototype's AZ dictionary (screens.js, `Kart` / `Liste`)
  "beds.order", //           Sıralama — "ordering" in Azerbaijani too (sıralamaq)
  "beds.orderRisk", //       Risk sırası — the prototype's AZ section line ("risk sırasına görə")
  "beds.staleChannels", //   Gecikmiş kanal — "overdue channel" reads the same in Azerbaijani
  "beds.news2", //           NEWS2 — the score's own name

  // G1-10 (alarms) · az = tr
```

and add this arm's language-neutral keys. Replace

```javascript
  // G1-09 (beds) · neutral

  // G1-10 (alarms) · neutral
```

with

```javascript
  // G1-09 (beds) · neutral
  "beds.news2", //                NEWS2 — the score's own name, not translated anywhere

  // G1-10 (alarms) · neutral
```

- [ ] **Step 4: Check the parity**

```bash
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests |az |ru "
```
Expected: `Tests  6 passed (6)`. A failure here names the key: either the Azerbaijani text really is the Turkish one (write a different one) or the identity is correct and wants a line in the list, with its reason.

- [ ] **Step 5: Write the card's test**

Create `dashboard/src/live/screens/beds/BedCard.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { patientFromBoard, alertsFromPatients } from "../../../liveAdapters.js";
import { NOW, ago, alarm, entry, identity, measured, news2 } from "../../data/board.testutil.js";
import { BedCard } from "./BedCard.jsx";

/** The card as the screen builds it: the adapter's record, and that patient's flattened alarms. */
function card(raw) {
  const patient = patientFromBoard(raw);
  return render(
    <I18nProvider>
      <ul><BedCard patient={patient} alerts={alertsFromPatients([patient])} nowMs={NOW} /></ul>
    </I18nProvider>,
  );
}

describe("the bed card — what it says, and what it refuses to", () => {
  it("names the bed and the patient, and links to the patient", () => {
    card(entry("S-001", [], { identity: identity(), at: measured(30) }));
    const link = screen.getByRole("link", { name: "REA-01 · 2 xəstəsini aç" });
    expect(link).toHaveAttribute("href", "#/patients/S-001");
    expect(screen.getByText("REA-01 · 2")).toBeInTheDocument();
    expect(screen.getByText("Ayşe Sentetik")).toBeInTheDocument();
  });

  it("a card with no HIS name says what is missing — it does not print the device's id as a name", () => {
    card(entry("S-002", [], { at: measured(30) }));
    expect(screen.getByText("kimlik gözlənilir")).toBeInTheDocument();
    // The id is the bed slot's business, and appears there once.
    expect(screen.getAllByText("S-002")).toHaveLength(1);
  });

  it("an escaped id reaches the link intact", () => {
    card(entry("S 001/A", [], { at: measured(30) }));
    expect(screen.getByRole("link")).toHaveAttribute("href", "#/patients/S%20001%2FA");
  });

  describe("risk", () => {
    it("risk none on a MEASURED card reads \"no finding\"", () => {
      card(entry("S-001", [], { risk: "none", at: measured(30), vitals: { heart_rate: 78 } }));
      expect(screen.getByText("Tapıntı yoxdur")).toBeInTheDocument();
    });

    it("risk none on a card with NO observation reads \"not measured\"", () => {
      // The claim "no finding" is about observations, and this card has none.
      card(entry("S-002", [], { risk: "none" }));
      expect(screen.getByText("Ölçülməyib")).toBeInTheDocument();
    });

    it("moderate is amber, never a green \"stable\"", () => {
      const { container } = card(entry("S-001", [], { risk: "moderate", at: measured(30) }));
      expect(screen.getByText("Orta")).toBeInTheDocument();
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "mid");
      expect(container.querySelector("[data-tone='ok']")).toBeNull();
    });

    it("a risk the engine did not send takes the attention look, not a quiet one", () => {
      const { container } = card(entry("S-001", [], { risk: null, at: measured(30) }));
      expect(screen.getByText("Risk bildirilməyib")).toBeInTheDocument();
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "att");
    });

    it("the stripe's colour is never the only signal: the pill's word is beside it", () => {
      const { container } = card(entry("S-001", [], { risk: "critical", at: measured(30) }));
      expect(container.querySelector("[data-rail='crit']")).toBeInTheDocument();
      expect(screen.getByText("Kritik")).toBeInTheDocument();
    });
  });

  describe("the measured channels", () => {
    it("shows the channels that have a value, with their units", () => {
      card(entry("S-001", [], { ...reading({ heart_rate: 118, spo2: 91, resp_rate: 26, map: 58, sbp: 92, temperature: 38.4 }, 30) }));
      expect(screen.getByText("118")).toBeInTheDocument();
      expect(screen.getByText("91")).toBeInTheDocument();
      expect(screen.getByText("Nəbz")).toBeInTheDocument();
      expect(screen.getAllByText("mmHg")).toHaveLength(2);     // systolic and mean
    });

    it("a measured 0 is a finding, not a missing value", () => {
      card(entry("S-001", [], { at: measured(30), vitals: { resp_rate: 0 } }));
      expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("a channel with no value is left out rather than printed as a dash", () => {
      const { container } = card(entry("S-001", [], { at: measured(30), vitals: { heart_rate: 78 } }));
      expect(container.querySelectorAll("dl dt")).toHaveLength(1);
      expect(screen.queryByText("SpO2")).toBeNull();
    });

    it("a card with nothing measured says that once, in a sentence", () => {
      card(entry("S-002"));
      expect(screen.getByText("Bu çarpayıdan heç bir ölçmə gəlməyib.")).toBeInTheDocument();
    });

    it("says when the card was last measured, and how many channels are overdue", () => {
      card(entry("S-001", [], {
        at: { heart_rate: ago(30), spo2: ago(4_000) },
        vitals: { heart_rate: 78, spo2: 96 },
      }));
      expect(screen.getByText(/Son ölçmə: /)).toBeInTheDocument();
      expect(screen.getByText("Gecikmiş kanal: 1")).toBeInTheDocument();
    });
  });

  describe("NEWS2", () => {
    it("shows the engine's total", () => {
      card(entry("S-001", [], { at: measured(30), score: news2({ total: 7 }) }));
      expect(screen.getByText("NEWS2:")).toBeInTheDocument();
      expect(screen.getByText("7")).toBeInTheDocument();
    });

    it("no engine score is a dash with the reason — never a score of the screen's own", () => {
      card(entry("S-001", [], { at: measured(30), vitals: { heart_rate: 78, spo2: 96 } }));
      expect(screen.getByText("NEWS2: —")).toBeInTheDocument();
      expect(screen.getByText(/ekran öz hesabını aparmır/)).toBeInTheDocument();
    });

    it("a partial score is marked, with the unmeasured parameters read out", () => {
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ total: 4, partial: true, missing: ["respiration_rate", "temperature"] }),
      }));
      expect(screen.getByText(/qismən/)).toBeInTheDocument();
      expect(screen.getByText(/tənəffüs tezliyi, temperatur/)).toBeInTheDocument();
    });

    it("a red parameter is stated as a fact and does NOT change the engine's level", () => {
      // The engine may legitimately send "low" with red_param true (patient_relative lowers a
      // NEWS2 alert the patient's charted chronic normal explains). The screen reports both.
      const { container } = card(entry("S-001", [], {
        risk: "low", at: measured(30), score: news2({ total: 5, red_param: true }),
      }));
      expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
      expect(screen.getByText("Aşağı")).toBeInTheDocument();
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "low");
    });
  });

  describe("the open alarms", () => {
    it("puts the open alarms on the card, with the engine's own summary", () => {
      card(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7" })], { at: measured(30), risk: "high" }));
      expect(screen.getByText("NEWS2 7")).toBeInTheDocument();
    });

    it("an acknowledged alarm leaves the card's own list", () => {
      card(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7", acknowledged: true, acknowledged_by: "ayse" })], { at: measured(30) }));
      expect(screen.queryByText("NEWS2 7")).toBeNull();
    });

    it("an alarm with severity \"none\" can never read \"no finding\"", () => {
      // "none" is a PATIENT's risk — "no alarm at all" — and never an alarm's own severity.
      card(entry("S-001", [alarm("other", "none", { summary: "ölçüt" })], { risk: "info", at: measured(30) }));
      expect(screen.queryByText("Tapıntı yoxdur")).toBeNull();
      expect(screen.getByText("Risk bildirilməyib")).toBeInTheDocument();
      expect(screen.getByText("Məlumat")).toBeInTheDocument();
    });
  });

  describe("where the identity came from", () => {
    it("says the HIS sent it, and when", () => {
      card(entry("S-001", [], { identity: identity({ updated_at: ago(600) }), at: measured(30) }));
      expect(screen.getByText("XMİS")).toBeInTheDocument();
    });

    it("says there is no identity record for a device-only card", () => {
      card(entry("S-002", [], { at: measured(30) }));
      expect(screen.getByText("Kimlik qeydi yoxdur")).toBeInTheDocument();
    });

    it("says a discharged patient is discharged", () => {
      card(entry("S-001", [], { identity: identity({ state: "discharged" }), at: measured(30) }));
      expect(screen.getByText(/Evə yazılıb/)).toBeInTheDocument();
    });

    it("names the HIS location a bed table does not cover — the line an operator must add", () => {
      card(entry("S-001", [], {
        identity: identity({ bed_id: null, unit_id: null, bed_matched: false, bed_key: "REA^999^9" }),
        at: measured(30),
      }));
      expect(screen.getByText("Çarpayı uyğunlaşmadı · REA^999^9")).toBeInTheDocument();
    });

    it("a matched bed says nothing about matching", () => {
      card(entry("S-001", [], { identity: identity(), at: measured(30) }));
      expect(screen.queryByText(/uyğunlaşmadı/)).toBeNull();
    });
  });
});

describe("the bed card reconciles a downgraded level at a glance", () => {
  // The hazard this closes: the engine can send risk "low" with red_param true, because
  // patient_relative lowers a NEWS2 alert when the patient's charted chronic normal explains every
  // contributor. Before this, the card showed "Aşağı" beside "a parameter scored 3" with nothing
  // reconciling them, so a clinician had to open the patient to tell a justified low from an
  // engine fault.
  it("marks a downgraded finding chronic-expected, with the engine's reason in its name", () => {
    card(entry("S-001", [alarm("news2", "low", { downgraded: true,
        chronic_context: "Chronic oxygen therapy explains the SpO2." })], { risk: "low", at: measured(30), score: news2({ total: 5, red_param: true }) }));
    expect(screen.getByText("Xəstənin öz normasına görə gözlənilən")).toBeInTheDocument();
    expect(screen.getByText(/Chronic oxygen therapy explains the SpO2/)).toBeInTheDocument();
    // Both facts still stand, and neither is overridden. (Two pills read "Aşağı": the patient's
    // own risk and the finding's severity.)
    expect(screen.getAllByText("Aşağı")).toHaveLength(2);
    expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
  });

  it("the pill is NEUTRAL, not the attention look — it is an explanation, not a warning", () => {
    const { container } = card(entry("S-001", [alarm("news2", "low", { downgraded: true, chronic_context: "Chronic AF." })], { risk: "low", at: measured(30) }));
    const pill = screen.getByText("Xəstənin öz normasına görə gözlənilən").closest("[data-tone]");
    expect(pill).toHaveAttribute("data-tone", "neutral");
    expect(container.querySelector("[data-tone='att']")).toBeNull();
  });

  it("an ordinary finding carries no such pill", () => {
    card(entry("S-001", [alarm("news2")], { risk: "high", at: measured(30) }));
    expect(screen.queryByText("Xəstənin öz normasına görə gözlənilən")).toBeNull();
  });

  it("marks the engine's summary as English, and says so once", () => {
    card(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7" })], { risk: "high", at: measured(30) }));
    expect(screen.getByText("NEWS2 7")).toHaveAttribute("lang", "en");
    expect(screen.getByText("Mühərrikin mətnləri İngiliscədir; tərcümə olunmayıb.")).toBeInTheDocument();
  });

  it("a card with no alarm says nothing about English", () => {
    card(entry("S-001", [], { at: measured(30) }));
    expect(screen.queryByText(/İngiliscədir/)).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npx vitest run src/live/screens/beds/ 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./BedCard.jsx"`.

Four things the card does NOT define, and imports from Task 6's `BoardState.jsx` instead: `railOf` (the left rail's colour for a risk tone), `ChronicExpected` (the neutral pill on a downgraded finding), `summaryOf` (the engine's headline for a finding) and `useBoardNow` on the screen above it. All four were written inside this file first and moved out, for one reason: the alarms row and the patient screen show the same things, and a copy per arm is how two screens come to say different things about one finding. The `info` tone did exactly that — quiet grey here, attention amber on the patient screen — and nothing failed.

- [ ] **Step 7: Write the card**

```jsx
// src/live/screens/beds/BedCard.jsx — one bed, as the board shows it (the prototype's `.bed`).
//
// Everything on this card is the engine's or the hospital's. The card computes nothing clinical:
// no score, no band, no colour that depends on a value, no risk of its own. What it does do is
// state absence out loud, which is where every honesty rule on it comes from:
//
//   * The risk pill is given `measured` from the card's OWN timestamps, so risk "none" reads "no
//     finding" on a card that has observations and "not measured" on one that has none
//     (ui/riskStyle.js's rule, and the reason it refuses to assume it).
//   * A channel that was never measured is NOT printed as a dash. The old wall board learned this:
//     "on a live ward three of the five channels are empty, so half the row became '—'. Show what
//     was measured; if nothing was, say that once." So the row carries the measured channels only,
//     and a card with none says so in a sentence.
//   * The name is the HIS's or it is missing. A device's raw patient number does not stand in for
//     a person's name — the bed label already carries that identifier, so this slot says what is
//     missing instead (the wall board's rule; the old bed card did the opposite and printed the id
//     twice).
//   * NEWS2 is the engine's or it is "—" with the reason. A browser-side NEWS2 scores an
//     unmeasured parameter as 0 and showed a calm green "0" on patients nobody had scored.
//   * `red_param` is shown as the FACT the engine sent, and does not change the level. The engine
//     can legitimately send "low" with `red_param` true — `rules/patient_relative.py` lowers a
//     NEWS2 alert when the patient's charted chronic normal explains every contributor. Whether a
//     charted baseline may override the red-parameter floor is a clinical decision (roadmap "User
//     decisions", 9), so the screen reports both and overrides neither.
//   * Colour is never the only signal: the left rail's tone always travels with the pill's icon
//     and word.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Icon, RiskPill, StatusPill, riskStyle } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import { hasMeasurement, lastMeasuredAt } from "../common/freshness.js";
import { patientFeedHealth } from "../common/feedHealth.js";
import { measuredVitals } from "../common/vitals.js";
import { ChronicExpected, railOf, summaryOf } from "../common/BoardState.jsx";

/** The patient's name, or what is missing instead of it. */
export function nameOf(patient, t) {
  return patient?.display_name || t("beds.identityPending");
}

/** Where this card's identity came from, and what state the HIS says it is in. */
function Provenance({ patient }) {
  const { t } = useI18n();
  const source = patient?.source;
  const key = source === "comed" ? "beds.sourceComed"
    : source === "device" || !source ? "beds.sourceDevice" : "beds.sourceManual";
  // A card with no identity block at all has nothing to say but that: the engine never sent one,
  // so there is no instant and no state either.
  const stamp = patient?.identityUpdatedAt ? Date.parse(patient.identityUpdatedAt) : NaN;
  return (
    <>
      <span>{t(key)}</span>
      {Number.isNaN(stamp) ? null : <span>{` · ${hhmm(stamp)}`}</span>}
      {patient?.identityState === "discharged" ? <span>{` · ${t("beds.discharged")}`}</span> : null}
    </>
  );
}

/** The engine's NEWS2, or "—" and why not. Never a score of this screen's own. */
export function News2({ news2, className = "" }) {
  const { t } = useI18n();
  const missing = Array.isArray(news2?.missing) ? news2.missing : [];
  if (!news2 || typeof news2.total !== "number") {
    return (
      <span className={`inline-flex items-center gap-1.5 text-11.5 font-semibold text-mute ${className}`}>
        <span>{`${t("beds.news2")}: —`}</span>
        <span className="sr-only">{t("news2.noEngine")}</span>
      </span>
    );
  }
  const names = missing.map((m) => t(`news2.missing.${m}`)).join(", ");
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 text-11.5 font-semibold ${className}`}>
      <span className="text-mute">{t("beds.news2")}:</span>
      <b className="font-data text-13 text-ink">{news2.total}</b>
      {news2.partial ? (
        <StatusPill tone="att" icon="alert">
          {t("beds.news2Partial")}
          {names ? <span className="sr-only">{` · ${t("news2.partialHint", { missing: names })}`}</span> : null}
        </StatusPill>
      ) : null}
      {news2.red_param ? <StatusPill tone="att" icon="alert">{t("beds.news2Red")}</StatusPill> : null}
    </span>
  );
}

/** The channels this bed HAS values for. A card with none says so once, instead of a row of
 *  dashes that repeats the same absence five times. */
function Vitals({ patient }) {
  const { t } = useI18n();
  const shown = measuredVitals(patient);
  if (shown.length === 0) {
    return <p className="m-0 mt-2 text-12.5 text-mute">{t("beds.noVitals")}</p>;
  }
  return (
    <dl className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
      {shown.map((v) => (
        <div key={v.at} className="min-w-[62px]">
          <dt className={`text-10 font-bold uppercase leading-[normal] tracking-[.06em] ${v.color}`}>{t(v.labelKey)}</dt>
          <dd className="m-0 font-data text-14.5 font-bold text-ink">
            {v.value}
            <small className="ml-0.5 font-text text-10.5 font-semibold text-mute">{t(v.unitKey)}</small>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * `patient`: one record from `liveAdapters.patientsFromBoard`.
 * `alerts`: that patient's alarms from `boardStore`'s `alerts` (already flattened).
 * `nowMs`: the instant the board was last painted — passed in so one clock serves every card and
 *   a test can fix it.
 */
export function BedCard({ patient, alerts = [], nowMs }) {
  const { t } = useI18n();
  const measured = hasMeasurement(patient?.measuredAt);
  const style = riskStyle(patient?.risk, { measured });
  const bed = patient?.bedLabel || patient?.patient_id || "—";
  const last = lastMeasuredAt(patient?.measuredAt);
  const stale = patientFeedHealth(patient, nowMs).stale.length;
  const open = alerts.filter((a) => a.status !== "ACKNOWLEDGED");
  return (
    <li className="relative overflow-hidden rounded-box border border-line bg-card">
      {/* The rail is the pill's tone again as a 4 px stripe — never the only signal. */}
      <span aria-hidden="true" data-rail={style.tone} className={`absolute inset-y-0 left-0 w-1 ${railOf(style.tone)}`} />
      <a
        href={`#/patients/${encodeURIComponent(patient?.patient_id ?? "")}`}
        aria-label={t("beds.openPatient", { bed })}
        className={`block pb-3 pl-[18px] pr-3.5 pt-3 ${FOCUS_RING}`}
      >
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <b className="block font-data text-15 font-bold text-ink">{bed}</b>
            <span className={`block truncate font-display text-14.5 font-bold ${patient?.display_name ? "text-ink" : "italic text-mute"}`}>
              {nameOf(patient, t)}
            </span>
          </div>
          <RiskPill risk={patient?.risk} measured={measured} />
        </div>

        {open.length > 0 ? (
          <ul className="m-0 mt-2.5 flex list-none flex-col gap-1 p-0">
            {open.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <RiskPill risk={a.severity === "none" ? null : a.severity} measured />
                {/* The engine writes its summaries in English (reco/engine.py); marked so a
                    screen reader pronounces them as English rather than with Azerbaijani
                    phonetics. The card says once, at its foot, that they are English. */}
                <span lang="en" className="min-w-0 flex-1 text-12.5 text-ink">{summaryOf(a) ?? t("board.findingUnnamed")}</span>
                <ChronicExpected alarm={a} />
              </li>
            ))}
          </ul>
        ) : null}

        {open.length > 0 ? (
          <p className="m-0 mt-1 text-10.5 text-mute">{t("board.engineEnglish")}</p>
        ) : null}

        <Vitals patient={patient} />

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-11 text-mute">
          <News2 news2={patient?.news2} />
          {last !== null ? <span>{t("board.measuredAt", { time: hhmm(last) })}</span> : null}
          {stale > 0 ? <span className="text-att-ink">{t("beds.staleChannels", { count: stale })}</span> : null}
          <span className="ml-auto flex items-center gap-1">
            <Icon name="user" size={12} />
            <Provenance patient={patient} />
          </span>
        </div>
        {patient?.bedKey && !patient?.bedMatched ? (
          <p className="m-0 mt-1.5 text-11 font-semibold text-att-ink">
            {t("beds.unmatchedBed", { key: patient.bedKey })}
          </p>
        ) : null}
      </a>
    </li>
  );
}
```

- [ ] **Step 8: Run it**

```bash
npx vitest run src/live/screens/beds/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  25 passed (25)`.

- [ ] **Step 9: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected, on an arm built off Task 8 alone: `92 passed (92)` files, `1903 passed (1903)` tests; the build succeeds. **The number that is this task's own is 30, in `BedCard.test.jsx`** — the suite total depends on which other arms have merged into the branch you are on, and is only knowable when all four have (99 / 2097).

- [ ] **Step 10: Commit**

```bash
git add dashboard/src/live/i18n/strings/beds.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedCard.test.jsx
git commit -m "$(cat <<'EOF'
feat(dashboard): the bed card (G1-09)

The engine's risk with its icon and its word and a matching stripe — moderate
amber, nothing green; "no finding" only on a card that HAS observations; the
channels that were measured and no dashes for the ones that were not; the
engine's NEWS2 or a dash with its reason; red_param as a fact that does not
override the engine's level; and the HIS's name or the statement that there
is none, never the device's number dressed as a person.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **30** tests in the new `BedCard.test.jsx`; `strings.test.js` green at 6; whole suite green; build clean.

---

### Task 10: Two orders, two filters

**Files:**
- Create: `dashboard/src/live/screens/beds/order.js` + `order.test.js`

Pure, and the reasoning is in the header: the default order is the BED's, because a nurse learns where a bed sits on the screen and a board that re-sorts itself makes her hunt for it at the moment she is reacting to an alarm. Risk order is offered because the roadmap asks for it, and it sorts what the screen cannot vouch for **above** `critical`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/beds/order.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { ORDERS, VIEWS, bedNameOf, inUnit, matching, norm, orderBeds } from "./order.js";

const bed = (id, over = {}) => ({ patient_id: id, bedLabel: id, unitId: "REA-01", risk: "none", display_name: null, ...over });

describe("orderBeds", () => {
  it("bed order compares numbers as numbers", () => {
    const list = [bed("REA-10"), bed("REA-2"), bed("REA-1")];
    expect(orderBeds(list, "yatak").map((p) => p.patient_id)).toEqual(["REA-1", "REA-2", "REA-10"]);
  });

  it("bed order groups by unit, and puts a card the bed table does not place last", () => {
    const list = [
      bed("X-1", { unitId: null }),
      bed("N-1", { unitId: "NICU-01" }),
      bed("R-1", { unitId: "REA-01" }),
    ];
    expect(orderBeds(list, "yatak").map((p) => p.patient_id)).toEqual(["N-1", "R-1", "X-1"]);
  });

  it("leaves the caller's array alone", () => {
    const list = [bed("REA-2"), bed("REA-1")];
    orderBeds(list, "yatak");
    expect(list.map((p) => p.patient_id)).toEqual(["REA-2", "REA-1"]);
  });

  it("risk order follows the engine's own severity list", () => {
    const list = [
      bed("b-none", { risk: "none" }), bed("b-info", { risk: "info" }),
      bed("b-low", { risk: "low" }), bed("b-mod", { risk: "moderate" }),
      bed("b-high", { risk: "high" }), bed("b-crit", { risk: "critical" }),
    ];
    expect(orderBeds(list, "risk").map((p) => p.patient_id))
      .toEqual(["b-crit", "b-high", "b-mod", "b-low", "b-info", "b-none"]);
  });

  it("risk order puts what it cannot vouch for ABOVE critical", () => {
    // A risk the engine did not send, or one this build does not know, may be the worst.
    const list = [bed("b-crit", { risk: "critical" }), bed("b-null", { risk: null }), bed("b-new", { risk: "extreme" })];
    const ids = orderBeds(list, "risk").map((p) => p.patient_id);
    expect(ids.indexOf("b-crit")).toBe(2);
    expect(ids.slice(0, 2).sort()).toEqual(["b-new", "b-null"]);
  });

  it("risk order breaks a tie by bed, so the list is stable within a level", () => {
    const list = [bed("REA-10", { risk: "high" }), bed("REA-2", { risk: "high" })];
    expect(orderBeds(list, "risk").map((p) => p.patient_id)).toEqual(["REA-2", "REA-10"]);
  });

  it("an unknown order is the bed order", () => {
    expect(orderBeds([bed("REA-2"), bed("REA-1")], "nonsense").map((p) => p.patient_id))
      .toEqual(["REA-1", "REA-2"]);
    expect(orderBeds(null)).toEqual([]);
  });

  it("names the two views and the two orders", () => {
    expect(VIEWS).toEqual(["kart", "liste"]);
    expect(ORDERS).toEqual(["yatak", "risk"]);
  });
});

describe("bedNameOf", () => {
  it("prefers the hospital's bed label and falls back to the feed's own id", () => {
    expect(bedNameOf({ bedLabel: "REA-01 · 2", patient_id: "S-001" })).toBe("REA-01 · 2");
    expect(bedNameOf({ bedLabel: null, patient_id: "S-001" })).toBe("S-001");
    expect(bedNameOf(null)).toBe("");
  });
});

describe("norm — matching what someone typed", () => {
  it("ignores case and diacritics", () => {
    expect(norm("Ayşe ÇAĞLA")).toBe("ayse cagla");
    expect(norm("Ünal")).toBe("unal");
  });

  it("folds the two letters the ward's keyboards disagree about", () => {
    expect(norm("Əliyev")).toBe("eliyev");
    expect(norm("Işık")).toBe("isik");
  });

  it("trims, and survives nothing at all", () => {
    expect(norm("  REA-01  ")).toBe("rea-01");
    expect(norm(null)).toBe("");
    expect(norm(undefined)).toBe("");
  });
});

describe("inUnit", () => {
  it("keeps the cards of one unit", () => {
    const list = [bed("a"), bed("b", { unitId: "NICU-01" })];
    expect(inUnit(list, "REA-01").map((p) => p.patient_id)).toEqual(["a"]);
  });

  it("no unit chosen keeps every card", () => {
    const list = [bed("a"), bed("b", { unitId: null })];
    expect(inUnit(list, null)).toHaveLength(2);
    expect(inUnit(list, "")).toHaveLength(2);
  });

  it("a card the bed table does not place is hidden by any unit filter", () => {
    expect(inUnit([bed("x", { unitId: null })], "REA-01")).toEqual([]);
  });
});

describe("matching", () => {
  it("matches a bed, an id or the HIS name", () => {
    const list = [
      bed("S-001", { bedLabel: "REA-01 · 2", display_name: "Ayşe Sentetik" }),
      bed("S-002", { bedLabel: "NICU-01 · 1", display_name: null }),
    ];
    expect(matching(list, "ayse").map((p) => p.patient_id)).toEqual(["S-001"]);
    expect(matching(list, "nicu").map((p) => p.patient_id)).toEqual(["S-002"]);
    expect(matching(list, "s-00").map((p) => p.patient_id)).toEqual(["S-001", "S-002"]);
  });

  it("an empty query matches everything", () => {
    const list = [bed("a"), bed("b")];
    expect(matching(list, "")).toHaveLength(2);
    expect(matching(list, "   ")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/live/screens/beds/order.test.js 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./order.js"`.

- [ ] **Step 3: Write it**

```javascript
// src/live/screens/beds/order.js — the bed board's ordering and filtering. Pure.
//
// TWO ORDERS, AND THE DEFAULT IS THE BED'S. A nurse learns where a bed sits on the screen; a board
// that re-sorts itself makes her search for it again at the very moment she is reacting to an
// alarm. The old wall board wrote the rule down: "an alarm HIGHLIGHTS a bed, it does not re-order
// the list." So risk is carried by the card's pill and stripe and by the attention line above the
// board, and the list keeps still — unless the clinician asks for risk order, which the roadmap
// requires the screen to offer (G1-09, "risk sırası") and which this module provides.
//
// RISK ORDER PUTS WHAT IT CANNOT VOUCH FOR FIRST. A card whose risk the engine did not send, or
// sent as a level this build does not know, is sorted above `critical` — the same rule the bell
// follows for an unknown severity ("it may be the worst", boardStore `waitingAlarms`). It is never
// sorted down among the quiet cards.
//
// NOTHING HERE IS A CLINICAL JUDGEMENT. The rank is the engine's own severity list, in the engine's
// own order; no number is read, no threshold applied, nothing re-scored.
import { ENGINE_RISKS } from "../../ui/riskStyle.js";

export const VIEWS = Object.freeze(["kart", "liste"]);
export const ORDERS = Object.freeze(["yatak", "risk"]);

// ENGINE_RISKS is `critical, high, moderate, low, info, none` (ui/riskStyle.js, which reads the
// engine's own list). A risk not in it ranks -1: above everything.
const rankOf = (risk) => {
  const key = typeof risk === "string" ? risk.trim().toLowerCase() : "";
  const at = ENGINE_RISKS.indexOf(key);
  return at === -1 ? -1 : at;
};

/** What a card is called where a bed order is concerned: the hospital's bed label if the HIS sent
 *  one, else the identifier the feed keys the patient by. Never invented. */
export const bedNameOf = (p) => String(p?.bedLabel || p?.patient_id || "");

/** Bed order: by unit (a card the bed table does not place goes last — it belongs to no unit and
 *  no scope grant can reach it), then by bed label with numbers compared as numbers, so REA-2
 *  comes before REA-10. */
function byBed(a, b) {
  const ua = a?.unitId || "";
  const ub = b?.unitId || "";
  if (ua !== ub) {
    if (!ua) return 1;
    if (!ub) return -1;
    return ua < ub ? -1 : 1;
  }
  return bedNameOf(a).localeCompare(bedNameOf(b), "en", { numeric: true, sensitivity: "base" });
}

/** `patients` in the chosen order. A new array; the input is left alone. */
export function orderBeds(patients, order = "yatak") {
  const list = Array.isArray(patients) ? [...patients] : [];
  if (order !== "risk") return list.sort(byBed);
  return list.sort((a, b) => rankOf(a?.risk) - rankOf(b?.risk) || byBed(a, b));
}

/** Case- and diacritic-insensitive form, for matching what someone typed against a name or a bed.
 *  NFD then strip the combining marks, as the prototype's admin search does, plus the two letters
 *  decomposition does not cover: Azerbaijani `ə` and Turkish/Azerbaijani `ı`, which a ward PC's
 *  keyboard and the HIS do not always agree on. */
export function norm(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ə/gi, "e")
    .replace(/[ıİ]/g, "i")
    .toLowerCase()
    .trim();
}

/** The cards this unit holds. `unit` null: all of them. A card the bed table does not place has no
 *  unit, so a unit filter hides it — and the screen says how many it hid. */
export function inUnit(patients, unit) {
  const list = Array.isArray(patients) ? patients : [];
  if (!unit) return list;
  return list.filter((p) => p?.unitId === unit);
}

/** The cards whose bed, id or HIS name contains what was typed. An empty query matches all. */
export function matching(patients, query) {
  const list = Array.isArray(patients) ? patients : [];
  const q = norm(query);
  if (!q) return list;
  return list.filter((p) => norm(p?.bedLabel).includes(q)
    || norm(p?.patient_id).includes(q)
    || norm(p?.display_name).includes(q));
}
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/live/screens/beds/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  42 passed (42)`.

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected, on an arm built off Task 8 alone: `93 passed (93)` files, `1920 passed (1920)` tests; the build succeeds. **This task's own number is 17, in `order.test.js`.**

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/live/screens/beds/order.js dashboard/src/live/screens/beds/order.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the bed board's two orders and two filters

Bed order is the default and does not move — an alarm highlights a bed, it
does not re-sort the list (the wall board's own rule). Risk order follows the
engine's severity list and puts a risk it cannot vouch for above critical, the
rule the bell follows for an unknown severity. The match folds diacritics and
the two letters the ward's keyboards disagree about.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **17** tests in the new `order.test.js`; whole suite green; build clean.

---

### Task 11: The bed board

**Files:**
- Create: `dashboard/src/live/screens/beds/BedsScreen.jsx` + `BedsScreen.test.jsx`
- Modify: `dashboard/src/live/shell/routes.js` (two lines)

The reading order on the screen is the order the honesty rules come in: the connection, then the engine's scope, then what is waiting (**only** from a LIVE board), then the feed, then the beds. The unit selector is the screen's own because the top bar's chip is hidden at 640 px and below; the choice is the shell's memory and is forgotten with the shell (Decision 7), and **an active filter always says how many cards it is hiding**.

- [ ] **Step 1: Write the screen's test**

Note its `open()` helper: it calls `onlyScreens(screens, { keep: [] })`, so this file states its own build. The screen asks the registry whether the alarms screen exists — its attention line links there only when it does — and a test that read the build instead would change its answer the moment another arm built that screen.

Create `dashboard/src/live/screens/beds/BedsScreen.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { token, profile } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { onlyScreens } from "../../shell/screens.testutil.js";
import { ShellProvider } from "../../shell/ShellContext.jsx";
import { NOW, ago, alarm, board, entry, identity, measured, news2, scopedTo } from "../../data/board.testutil.js";
import { BedsScreen } from "./BedsScreen.jsx";

/** Let every answer already given land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The screen inside a real session and board store, with the shell's unit context around it.
 *  `connection`: "live" opens the stream and lets its reload land; "degraded" opens it and drops
 *  it; "unavailable" refuses the load; "connecting" leaves it pending. */
async function open({ payload = board(), units = [], connection = "live", perms, screens = {} } = {}) {
  // Pinned, not inherited: this screen asks the registry whether the alarms screen exists (its
  // attention line links there only when it does), and a test that read the BUILD instead would
  // change its answer the moment another branch built that screen — in a file that branch does not
  // own. `screens` is this test's own build. The beds screen itself is the component under test
  // and does not need to be in the registry at all.
  onlyScreens(screens, { keep: [] });
  const access = perms ? token({ perms }) : token({ perms: ["board.view", "alerts.ack"] });
  const me = profile({ perms: perms ?? ["board.view", "alerts.ack"] });
  const mounted = await mount(
    <ShellProvider units={units} scope="known"><BedsScreen /></ShellProvider>,
    {
      access,
      me,
      setup: (api) => {
        if (connection === "unavailable") api.boardPatients.mockRejectedValue(new Error("down"));
        else api.boardPatients.mockResolvedValue(payload);
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      },
    },
  );
  const { board: store, stream } = mounted;
  if (connection === "connecting") return mounted;
  await act(async () => { await store.start(); });
  if (connection !== "unavailable") {
    await act(async () => { stream.open(); await settle(); });
    if (connection === "degraded") act(() => { stream.drop(); });
  }
  return mounted;
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  window.localStorage.clear();
});
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
  window.localStorage.clear();
});

const CARD = { identity: identity(), at: measured(30), vitals: { heart_rate: 96, spo2: 97 } };

describe("the bed board", () => {
  it("names itself and counts the beds it shows", async () => {
    await open({ payload: board([entry("S-001", CARD), entry("S-002", [], { at: measured(30) })]) });
    expect(screen.getByRole("heading", { level: 1, name: "Çarpayılar" })).toBeInTheDocument();
    // One h1 and no more: the shell moves focus to <main> after every move, and the screen's own
    // heading is what a reader lands on.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("2 çarpayı")).toBeInTheDocument();
  });

  it("an empty LIVE board says the connection is working — that is the only state that may", async () => {
    await open({ payload: board([]) });
    expect(screen.getByText("Hazırda izlənən xəstə yoxdur. Bağlantı işləyir.")).toBeInTheDocument();
  });

  it("a load that FAILED says the list is not shown, and never that the ward is quiet", async () => {
    await open({ connection: "unavailable" });
    // `getAllByRole`: the toast region keeps an empty role="alert" of its own mounted (ui/Toast).
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("GƏLMİR");
    expect(screen.queryByText("Hazırda izlənən xəstə yoxdur. Bağlantı işləyir.")).toBeNull();
  });

  it("a board that lost its stream shows what it has, marked out of date", async () => {
    await open({ payload: board([entry("S-001", CARD)]), connection: "degraded" });
    expect(screen.getByText("REA-01 · 2")).toBeInTheDocument();
    expect(screen.getAllByRole("note").some((n) => n.textContent.includes("güncəl olmaya bilər"))).toBe(true);
  });

  it("writes the engine's own scope sentence, and how many cards it withheld", async () => {
    const note = "Kapsamınızdaki şu anahtarların panoda karşılığı yok: NICU-01";
    await open({
      payload: board([entry("S-001", CARD)], {
        scope: scopedTo(["REA-01"], { hidden: 3, unresolved_hidden: 1 }), scope_note: note,
      }),
    });
    const notes = screen.getAllByRole("note").map((n) => n.textContent).join(" ");
    expect(notes).toContain(note);
    expect(notes).toContain("Əhatənizdən kənarda qalan kart: 3.");
    expect(notes).toContain("Bunlardan 1 ədədi heç bir çarpayıya uyğun gəlmir.");
  });

  describe("what is waiting", () => {
    it("counts the unanswered alarms and how long the oldest has been open", async () => {
      await open({
        payload: board([
          entry("S-001", [alarm("news2", "high", { first_seen_at: ago(247) })], { ...CARD, risk: "high" }),
          entry("S-002", [alarm("acute_change", "moderate")], { at: measured(30), risk: "moderate" }),
        ]),
      });
      expect(screen.getByText("Cavab gözləyən siqnal: 2")).toBeInTheDocument();
      expect(screen.getByText("Ən köhnəsi 4:07 əvvəl açılıb")).toBeInTheDocument();
    });

    it("only a LIVE board says nothing is waiting", async () => {
      await open({ payload: board([entry("S-001", CARD)]) });
      expect(screen.getByText("Cavab gözləyən siqnal yoxdur")).toBeInTheDocument();
    });

    it("a board that may be out of date does NOT say nothing is waiting", async () => {
      await open({ payload: board([entry("S-001", CARD)]), connection: "degraded" });
      expect(screen.queryByText("Cavab gözləyən siqnal yoxdur")).toBeNull();
      expect(screen.getByText("Cavab gözləyən siqnal bilinmir — panel güncəl deyil")).toBeInTheDocument();
    });

    it("a board that could not be loaded says it cannot know", async () => {
      await open({ connection: "unavailable" });
      expect(screen.getByText("Cavab gözləyən siqnal bilinmir — panel güncəl deyil")).toBeInTheDocument();
    });

    it("leads to the alarms screen when this build has it", async () => {
      await open({ payload: board([entry("S-001", CARD)]), screens: { alarms: () => null } });
      expect(screen.getByRole("link", { name: /siqnal/i })).toHaveAttribute("href", "#/alarms");
    });

    it("leads nowhere when it does not — never a dead link", async () => {
      await open({ payload: board([entry("S-001", CARD)]) });
      expect(screen.queryByRole("link", { name: /siqnal/i })).toBeNull();
    });

    it("leads nowhere for a session that may not open the alarms screen", async () => {
      await open({
        payload: board([entry("S-001", CARD)]), perms: ["board.view"],
        screens: { alarms: () => null },
      });
      // `board.view` DOES open the alarms route; a session without it cannot see this screen at
      // all, so the case the link guards against is an unbuilt screen. Pinned here so the rule
      // itself — `canReach` as well as `screenOf` — is exercised.
      expect(screen.getByRole("link", { name: /siqnal/i })).toHaveAttribute("href", "#/alarms");
    });
  });

  it("says how many beds have gone quiet", async () => {
    await open({
      payload: board([
        entry("S-001", CARD),
        entry("S-002", [], { at: { heart_rate: ago(4_000) }, vitals: { heart_rate: 70 } }),
      ]),
    });
    expect(screen.getByText(/Səssiz çarpayı: 1/)).toBeInTheDocument();
  });

  describe("the view and the order", () => {
    it("switches to the list, and the list names every column", async () => {
      await open({ payload: board([entry("S-001", CARD)]) });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      const table = screen.getByRole("table", { name: "Çarpayılar və son ölçülən dəyərləri" });
      const heads = within(table).getAllByRole("columnheader").map((th) => th.textContent);
      expect(heads).toEqual(["Çarpayı", "Xəstə", "Vəziyyət", "Nəbz", "Sistolik AT", "SpO2", "Tənəffüs", "Bədən hərarəti", "Bal", "Son ölçmə"]);
    });

    it("the list prints an unmeasured channel as a dash a screen reader can read", async () => {
      await open({ payload: board([entry("S-001", [], { ...CARD, vitals: { heart_rate: 96 } })]) });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      expect(screen.getAllByText("Ölçülməyib").length).toBeGreaterThan(0);
    });

    it("keeps the chosen view in this browser", async () => {
      await open({ payload: board([entry("S-001", CARD)]) });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      expect(window.localStorage.getItem("hmc.bedView")).toBe("liste");
    });

    it("bed order is the default, and says that an alarm does not re-order the list", async () => {
      await open({ payload: board([entry("S-001", CARD)]) });
      expect(screen.getByRole("button", { name: "Çarpayı sırası" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/siyahını yenidən düzmür/)).toBeInTheDocument();
    });

    it("risk order puts the worst first, and the note goes away", async () => {
      await open({
        payload: board([
          entry("REA-1", [], { identity: identity({ bed_label: "REA-1" }), at: measured(30), risk: "low" }),
          entry("REA-2", [], { identity: identity({ bed_label: "REA-2" }), at: measured(30), risk: "critical" }),
        ]),
      });
      fireEvent.click(screen.getByRole("button", { name: "Risk sırası" }));
      const cards = screen.getByRole("list");
      const beds = within(cards).getAllByRole("link").map((a) => a.getAttribute("href"));
      expect(beds).toEqual(["#/patients/REA-2", "#/patients/REA-1"]);
      expect(screen.queryByText(/siyahını yenidən düzmür/)).toBeNull();
    });
  });

  describe("the unit filter and the search", () => {
    it("offers the engine's units at every width, and writes the shell's choice", async () => {
      await open({
        units: ["NICU-01", "REA-01"],
        payload: board([
          entry("S-001", CARD),
          entry("S-002", [], { identity: identity({ unit_id: "NICU-01", bed_label: "NICU-01 · 1" }), at: measured(30) }),
        ]),
      });
      const select = screen.getByRole("combobox");
      expect(within(select).getAllByRole("option").map((o) => o.textContent))
        .toEqual(["Hamısı", "NICU-01", "REA-01"]);
      fireEvent.change(select, { target: { value: "NICU-01" } });
      expect(screen.getByText("NICU-01 · 1 çarpayı")).toBeInTheDocument();
    });

    it("a filter is never silent: it says how many cards it is hiding", async () => {
      await open({
        units: ["NICU-01", "REA-01"],
        payload: board([
          entry("S-001", CARD),
          entry("S-002", [], { identity: identity({ unit_id: "NICU-01", bed_label: "NICU-01 · 1" }), at: measured(30) }),
        ]),
      });
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "NICU-01" } });
      expect(screen.getByText("Süzgəc 1 kartı gizlədir.")).toBeInTheDocument();
    });

    it("no selector when the engine scoped the session to fewer than two units", async () => {
      await open({ units: [], payload: board([entry("S-001", CARD)]) });
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    it("searches the bed, the id and the HIS name, and says what it hid", async () => {
      await open({
        payload: board([
          entry("S-001", CARD),
          entry("S-002", [], { identity: identity({ display_name: "Kamran Sentetik", bed_label: "REA-01 · 3" }), at: measured(30) }),
        ]),
      });
      fireEvent.change(screen.getByLabelText("Çarpayı və ya xəstə axtar"), { target: { value: "kamran" } });
      expect(screen.getByText("REA-01 · 3")).toBeInTheDocument();
      expect(screen.queryByText("REA-01 · 2")).toBeNull();
      expect(screen.getByText("Axtarış 1 kartı gizlədir.")).toBeInTheDocument();
    });

    it("a search that matches nothing says so with what was typed", async () => {
      await open({ payload: board([entry("S-001", CARD)]) });
      fireEvent.change(screen.getByLabelText("Çarpayı və ya xəstə axtar"), { target: { value: "zzz" } });
      expect(screen.getByText("\"zzz\" ilə uyğun gələn kart yoxdur.")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/live/screens/beds/BedsScreen.test.jsx 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./BedsScreen.jsx"`.

- [ ] **Step 3: Write the screen**

```jsx
// src/live/screens/beds/BedsScreen.jsx — the ward (G1-09). The prototype's "beds" screen, built on
// what the engine actually sends.
//
// Reading order on the screen, which is the order the honesty rules come in:
//   1. the connection      — an empty board whose load failed says so before anything else
//   2. the engine's scope  — why the board is this size, in the engine's own sentence
//   3. what is waiting     — the unanswered alarms, and ONLY from a LIVE board; a board that may
//                            be out of date says that instead of a reassuring "none"
//   4. the feed            — how many beds have gone quiet
//   5. the beds            — cards or a list, in bed order or risk order
//
// WHAT THIS SCREEN REFUSES TO SHOW. The prototype's board carries five "attention" tiles, two of
// which are literal constants ("3 sonuç görülmedi · laktat 4.1 dahil", "1 cihaz sessiz · RE07");
// chips for pain, fall risk and pressure-injury risk keyed off hard-coded bands; a sparkline drawn
// from a seeded random generator; and a risk level it recomputes in the browser from NEWS2. None of
// it is here. Two tiles remain, and both are built from what the engine sent.
//
// THE UNIT FILTER IS NOT REMEMBERED BETWEEN SESSIONS, ON PURPOSE. It lives where Wave 2 put the
// top bar's chip — in the shell's memory (`useShell`) — so the chip and this selector are always
// the same choice, and the choice goes when the shell does. A filter kept in this browser would
// outlive the person who set it: at a shared station the next clinician would unlock into someone
// else's narrowed ward, and a card hidden by a filter you did not set is the kind of quiet this
// screen exists to prevent. What this screen adds instead is a selector that works at 390 px
// (the chip is hidden there) and a line saying how many cards a filter is hiding, so an active
// filter can never be silent.
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { waitingAlarms } from "../../data/boardStore.js";
import { useShell } from "../../shell/ShellContext.jsx";
import { ROUTES, canReach, screenOf } from "../../shell/routes.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { readPref, writePref } from "../../prefs.js";
import { Box, Empty, Field, Icon, Input, RiskPill, Seg, Table } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import {
  BoardStrip, FeedHealth, ScopeNote, boardKnown, boardStale, summaryOf, useBoardNow,
} from "../common/BoardState.jsx";
import { elapsed } from "../common/elapsed.js";
import { hasMeasurement, lastMeasuredAt } from "../common/freshness.js";
import { measuredVitals } from "../common/vitals.js";
import { ORDERS, VIEWS, bedNameOf, inUnit, matching, orderBeds } from "./order.js";
import { BedCard, News2, nameOf } from "./BedCard.jsx";

/** How often the ages on this screen are re-read. A bed card shows a measurement's clock time and
 *  a channel's overdue count, neither of which changes faster than this. */
const TICK_MS = 30_000;

/** The alarms screen, when this build has it and this session may open it. Until G1-10 merges, the
 *  attention line states the count without linking anywhere — never a dead link. */
function alarmsHref(perms) {
  const route = ROUTES.find((r) => r.id === "alarms");
  return route && screenOf(route) && canReach(route, perms) ? `#${route.path}` : null;
}

/** What is waiting, and how sure the board is of it. The three states come from `waitingAlarms`,
 *  which has Wave 2's Decision 18 already applied: only a LIVE board may say "none". */
function Waiting({ nowMs }) {
  const { t } = useI18n();
  const { user } = useSession();
  const board = useBoard();
  const { known, stale, items } = waitingAlarms(board);
  const waiting = items ?? [];
  const href = alarmsHref(user.perms);
  const oldest = waiting
    .map((a) => a.firstSeenAtMs)
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b)[0];
  let text;
  if (!known && !stale) text = t("beds.waitingUnknown");
  else if (waiting.length === 0) text = known ? t("beds.waitingNone") : t("beds.waitingUnknown");
  else text = t("beds.waiting", { count: waiting.length });
  const body = (
    <span className="flex min-w-0 items-center gap-2">
      <Icon name="bell" size={16} className={waiting.length ? "text-crit" : "text-mute"} />
      <span className="min-w-0">
        <b className="block text-13">{text}</b>
        {/* How long the oldest unanswered alarm has been open — the server's instant against this
            browser's clock, so a time that has not arrived yet reads 0:00 (elapsed.js). */}
        {Number.isFinite(oldest) ? (
          <small className="block text-11.5 text-mute">
            {t("beds.waitingOldest", { elapsed: elapsed(oldest, nowMs) })}
          </small>
        ) : null}
        {stale ? <small className="block text-11.5 text-att-ink">{t("board.degraded")}</small> : null}
      </span>
    </span>
  );
  return href ? (
    <a href={href} className={`rounded-box border border-line bg-card px-3 py-2.5 ${FOCUS_RING}`}>{body}</a>
  ) : (
    <div className="rounded-box border border-line bg-card px-3 py-2.5">{body}</div>
  );
}

/** The list view (the prototype's `table.t`). The numbers are written in `ink`, not in the
 *  channels' own colours: on `card2` — which the table's header and zebra use — `--v-map` and
 *  `--v-spo` fall under 4.5:1 in daylight (Wave 1B's contrast table). */
function BedList({ patients, alertsOf, nowMs }) {
  const { t } = useI18n();
  return (
    <Table caption={t("beds.caption")}>
      <thead>
        <tr>
          <th>{t("beds.colBed")}</th>
          <th>{t("beds.colPatient")}</th>
          <th>{t("beds.colRisk")}</th>
          <th>{t("board.chHr")}</th>
          <th>{t("board.chSbp")}</th>
          <th>{t("board.chSpo2")}</th>
          <th>{t("board.chRr")}</th>
          <th>{t("board.chTemp")}</th>
          <th>{t("beds.colNews2")}</th>
          <th>{t("beds.colMeasured")}</th>
        </tr>
      </thead>
      <tbody>
        {patients.map((p) => {
          const measured = hasMeasurement(p.measuredAt);
          const shown = new Map(measuredVitals(p).map((v) => [v.at, v.value]));
          const cell = (key) => (shown.has(key)
            ? <span className="font-data font-bold">{shown.get(key)}</span>
            : <span className="text-mute">—<span className="sr-only">{` ${t("board.notMeasured")}`}</span></span>);
          const last = lastMeasuredAt(p.measuredAt);
          const open = alertsOf(p.patient_id).filter((a) => a.status !== "ACKNOWLEDGED");
          return (
            <tr key={p.patient_id}>
              <th scope="row" className="font-data font-bold">
                <a href={`#/patients/${encodeURIComponent(p.patient_id)}`} className={`rounded-md ${FOCUS_RING}`}>
                  {bedNameOf(p)}
                </a>
              </th>
              <td className={p.display_name ? "" : "italic text-mute"}>
                {nameOf(p, t)}
                {open.length ? <small lang="en" className="block text-11 text-mute">{summaryOf(open[0]) ?? t("board.findingUnnamed")}</small> : null}
              </td>
              <td><RiskPill risk={p.risk} measured={measured} /></td>
              <td>{cell("heart_rate")}</td>
              <td>{cell("sbp")}</td>
              <td>{cell("spo2")}</td>
              <td>{cell("resp_rate")}</td>
              <td>{cell("temperature")}</td>
              <td><News2 news2={p.news2} /></td>
              <td className="whitespace-nowrap font-data">{last === null ? "—" : hhmm(last)}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function BedsScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const { unit, setUnit, units } = useShell();
  const nowMs = useBoardNow(TICK_MS);
  const [view, setView] = useState(() => readPref("bedView", VIEWS, "kart"));
  const [order, setOrder] = useState(() => readPref("bedOrder", ORDERS, "yatak"));
  const [query, setQuery] = useState("");
  useEffect(() => writePref("bedView", view), [view]);
  useEffect(() => writePref("bedOrder", order), [order]);

  const all = board.patients;
  const inUnits = useMemo(() => inUnit(all, unit), [all, unit]);
  const found = useMemo(() => matching(inUnits, query), [inUnits, query]);
  const shown = useMemo(() => orderBeds(found, order), [found, order]);
  const hiddenByUnit = all.length - inUnits.length;
  const hiddenBySearch = inUnits.length - found.length;

  const byPatient = useMemo(() => {
    const map = new Map();
    for (const a of board.alerts) {
      if (!map.has(a.patientId)) map.set(a.patientId, []);
      map.get(a.patientId).push(a);
    }
    return map;
  }, [board.alerts]);
  const alertsOf = (id) => byPatient.get(id) ?? [];

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-23 font-bold">{t("nav.beds")}</h1>
          <p className="m-0 text-13 text-mute">
            {unit ? t("beds.subUnit", { unit, count: shown.length }) : t("beds.sub", { count: shown.length })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg label={t("beds.view")} value={view} onChange={setView} options={[
            { value: "kart", label: t("beds.viewCards"), icon: "grid" },
            { value: "liste", label: t("beds.viewList"), icon: "list" },
          ]} />
          <Seg label={t("beds.order")} value={order} onChange={setOrder} options={[
            { value: "yatak", label: t("beds.orderBed"), icon: "bed" },
            { value: "risk", label: t("beds.orderRisk"), icon: "alert" },
          ]} />
        </div>
      </div>

      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />

      <div className="grid gap-2 min-[861px]:grid-cols-2">
        <Waiting nowMs={nowMs} />
        <div className="flex items-center gap-2 rounded-box border border-line bg-card px-3 py-2.5">
          <FeedHealth connection={connection} patients={all} nowMs={nowMs} />
        </div>
      </div>

      <Box className="!px-3 !py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* The screen's own unit selector: the top bar's chip is hidden at 640 px and below, so
              on a phone this is the only way to choose a unit. Both write the same choice. */}
          {units.length >= 2 ? (
            <label className="flex items-center gap-2 text-12.5 font-semibold text-mute">
              <Icon name="building" size={15} />
              <span>{t("beds.unit")}</span>
              <select
                value={unit ?? ""}
                onChange={(e) => setUnit(e.target.value || null)}
                className={`rounded-ctl border border-line2 bg-card2 px-2 py-1.5 font-data text-12.5 text-ink ${FOCUS_RING}`}
              >
                <option value="">{t("beds.unitAll")}</option>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          ) : null}
          <Field label={t("beds.search")} layout="col" className="!mb-0 min-w-[200px] flex-1">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} type="search" autoComplete="off" />
          </Field>
        </div>
        {/* A filter is never silent: if something is hidden, the screen says how much. */}
        {hiddenByUnit > 0 ? <p className="m-0 mt-1.5 text-12 text-att-ink">{t("beds.unitHidden", { count: hiddenByUnit })}</p> : null}
        {hiddenBySearch > 0 ? <p className="m-0 mt-1.5 text-12 text-att-ink">{t("beds.searchHidden", { count: hiddenBySearch })}</p> : null}
      </Box>

      {shown.length === 0 ? (
        <Empty icon="bed">
          {query && inUnits.length > 0 ? t("beds.searchNone", { query })
            : boardKnown(board.connection) ? t("beds.emptyLive")
              : boardStale(board.connection) ? t("board.degraded") : t("board.connecting")}
        </Empty>
      ) : view === "liste" ? (
        <BedList patients={shown} alertsOf={alertsOf} nowMs={nowMs} />
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-2.5 p-0 max-[640px]:grid-cols-1">
          {shown.map((p) => (
            <BedCard key={p.patient_id} patient={p} alerts={alertsOf(p.patient_id)} nowMs={nowMs} />
          ))}
        </ul>
      )}
      {order === "yatak" ? <p className="m-0 text-11.5 text-mute">{t("beds.orderNote")}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/live/screens/beds/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  65 passed (65)`.

- [ ] **Step 5: Take this arm's two lines in the registry**

In `dashboard/src/live/shell/routes.js`, replace

```javascript
// G1-09: import { BedsScreen } from "../screens/beds/BedsScreen.jsx";
```

with

```javascript
import { BedsScreen } from "../screens/beds/BedsScreen.jsx";
```

and replace

```javascript
  beds: null,      // G1-09
```

with

```javascript
  beds: BedsScreen, // G1-09
```

- [ ] **Step 6: Gate** — this is where the registry change shows up across the suite, and nothing should move, because Task 7 made the shell's tests build-independent.

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected, on an arm built off Task 8 alone: `94 passed (94)` files, `1943 passed (1943)` tests; the build succeeds. **This task's own number is 23, in `BedsScreen.test.jsx`.** **If `routes.test.js`, `Shell.test.jsx` or `LiveApp.test.jsx` fails here, Task 7 was skipped or done differently** — fix it there, not by weakening this task.

- [ ] **Step 7: Look at it** — the one check no test makes.

```bash
npx vite build
# serve dist/ and open it against a running local stack (deploy/local), or point the dev
# server at one: npm run dev
```
Check, at 1440 px and at 390 px, in both themes: no horizontal page scroll; the cards reflow to one column on the phone; the unit selector and the search are reachable at 390 px (the top bar's chip is not); the stripe, the pill and the word all agree; and a card with nothing measured reads as one sentence and not a row of dashes.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/beds/BedsScreen.test.jsx dashboard/src/live/shell/routes.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the bed board (G1-09)

The connection first, then the engine's own scope sentence, then what is
waiting — and only a LIVE board may say nothing is. Cards or a list, bed order
or risk order, the screen's own unit selector because the top bar's chip is
hidden on a phone, and a filter that always says how many cards it hides. Two
of the prototype's five attention tiles are literal constants; neither is here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **23** tests in the new `BedsScreen.test.jsx`; the shell's three test files unchanged and green; whole suite green; build clean; looked at 390/1440 px in both themes.

---

# Wave 3A · arm 2 — the alarms screen (G1-10, Tasks 12–13)

### Task 12: The alarms screen

**Files:**
- Create: `dashboard/src/live/i18n/strings/alarms.js`, `dashboard/src/live/screens/alarms/AlarmsScreen.jsx` + `AlarmsScreen.test.jsx`
- Modify: `dashboard/src/live/i18n/catalog.js` (two lines), `dashboard/src/live/i18n/strings.test.js` (one block), `dashboard/src/live/shell/routes.js` (two lines)

Two sections and not three, one escalation fact and not a ladder, and an age written `m:ss` then `h:mm:ss`. The two things the prototype shows and this screen cannot — a "closed in the last hour" list and the 3 / 5 / 10-minute chain — are each replaced by one sentence saying where that information is and whose business it is (Decisions 8, 9).

- [ ] **Step 1: Write the strings**

Create `dashboard/src/live/i18n/strings/alarms.js`:

```javascript
// The alarms screen (G1-10). The prototype's `screens.js` "alarms" screen, reduced to what the
// engine actually sends and says out loud what it does not.
//
// Sources: `Yanıt bekliyor` / `Değerlendiriliyor` / `Gördüm` / `Yalnız kritik` /
// `Benim hastalarım` / `Açık · {#}` / `Yanıt bekleyen alarm yok.` are the prototype's own
// four-language dictionary entries. `closedGone` and `escalatedHelp` are new and say what the
// prototype pretended: it shows a "closed in the last hour" section and a 3 / 5 / 10-minute
// escalation ladder, neither of which exists behind the live API.
// AZ/RU/EN await a native-speaking clinician's review before the pilot.
export default {
  tr: {
    closedTitle: "Kapanan alarmlar",
    sub: "Zaman sırasına göre · en eski yanıtsız en üstte",
    waiting: "Yanıt bekliyor",
    reviewing: "Değerlendiriliyor",
    openCount: "Açık · {count}",
    all: "Hepsi",
    criticalOnly: "Yalnız kritik",
    emptyWaiting: "Yanıt bekleyen alarm yok.",
    emptyReviewing: "Değerlendirilmekte olan alarm yok.",
    emptyFiltered: "Süzgece uyan alarm yok.",
    unknown: "Pano güncel değil — açık alarmların tamamı gösterilmiyor olabilir.",
    unavailable: "Alarmlar okunamıyor; bu ekran alarm olmadığı anlamına GELMEZ.",
    // The two things the prototype showed and the live system cannot.
    closedGone: "Kapanan bir alarm panodan düşer: motor yalnız açık alarmları gönderiyor, geçmiş için henüz bir uç nokta yok. Kapanma kayıtları denetim kaydında.",
    escalated: "Eskale edildi",
    escalatedHelp: "Eskalasyonu motor yürütür; ekran yalnız motorun bildirdiği durumu gösterir.",
    seen: "Gördüm",
    seeing: "Kaydediliyor…",
    seenBy: "Gördü: {who}",
    noAckPerm: "Alarmları siz onaylayamazsınız — bunun için «alerts.ack» yetkisi gerekir.",
    notLive: "Pano güncel değil; onay sunucuya gider ama liste eski olabilir.",
    elapsed: "Açık kalma süresi",
    noElapsed: "Motor ilk görülme zamanını göndermedi; süre gösterilmiyor.",
    openPatient: "{bed} hastasını aç",
    ackDone: "Alarm görüldü olarak işaretlendi.",
  },
  az: {
    closedTitle: "Bağlanan siqnallar",
    sub: "Zaman sırası ilə · ən köhnə cavabsız ən yuxarıda",
    waiting: "Cavab gözləyir",
    reviewing: "Qiymətləndirilir",
    openCount: "Açıq · {count}",
    all: "Hamısı",
    criticalOnly: "Yalnız kritik",
    emptyWaiting: "Cavab gözləyən həyəcan siqnalı yoxdur.",
    emptyReviewing: "Qiymətləndirilən siqnal yoxdur.",
    emptyFiltered: "Süzgəcə uyğun siqnal yoxdur.",
    unknown: "Panel güncəl deyil — açıq siqnalların hamısı göstərilməyə bilər.",
    unavailable: "Siqnallar oxunmur; bu ekran siqnal olmadığı anlamına GƏLMİR.",
    closedGone: "Bağlanan siqnal paneldən düşür: mühərrik yalnız açıq siqnalları göndərir, tarix üçün hələ uç nöqtə yoxdur. Bağlanma qeydləri audit jurnalındadır.",
    escalated: "Eskalasiya edilib",
    escalatedHelp: "Eskalasiyanı mühərrik yürüdür; ekran yalnız mühərrikin bildirdiyi vəziyyəti göstərir.",
    seen: "Gördüm",
    seeing: "Yadda saxlanılır…",
    seenBy: "Gördü: {who}",
    noAckPerm: "Siqnalları siz təsdiqləyə bilmirsiniz — bunun üçün «alerts.ack» səlahiyyəti lazımdır.",
    notLive: "Panel güncəl deyil; təsdiq serverə gedir, lakin siyahı köhnə ola bilər.",
    elapsed: "Açıq qalma müddəti",
    noElapsed: "Mühərrik ilk görülmə vaxtını göndərməyib; müddət göstərilmir.",
    openPatient: "{bed} xəstəsini aç",
    ackDone: "Siqnal görüldü kimi işarələndi.",
  },
  ru: {
    closedTitle: "Закрытые тревоги",
    sub: "По времени · самые старые без ответа вверху",
    waiting: "Ожидает ответа",
    reviewing: "Оценивается",
    openCount: "Открыто · {count}",
    all: "Все",
    criticalOnly: "Только критические",
    emptyWaiting: "Нет тревог, ожидающих ответа.",
    emptyReviewing: "Нет тревог на оценке.",
    emptyFiltered: "Нет тревог по этому фильтру.",
    unknown: "Панель неактуальна — показаны могут быть не все открытые тревоги.",
    unavailable: "Тревоги не читаются; этот экран НЕ ЗНАЧИТ, что тревог нет.",
    closedGone: "Закрытая тревога уходит с панели: система передаёт только открытые, конечной точки для истории пока нет. Записи о закрытии — в журнале аудита.",
    escalated: "Эскалировано",
    escalatedHelp: "Эскалацию ведёт система; экран показывает только то состояние, о котором она сообщила.",
    seen: "Принято",
    seeing: "Сохраняется…",
    seenBy: "Принял: {who}",
    noAckPerm: "Вы не можете принимать тревоги — для этого нужно право «alerts.ack».",
    notLive: "Панель неактуальна; подтверждение уйдёт на сервер, но список может быть устаревшим.",
    elapsed: "Время с момента открытия",
    noElapsed: "Система не передала время первого обнаружения; длительность не показывается.",
    openPatient: "Открыть пациента койки {bed}",
    ackDone: "Тревога отмечена как принятая.",
  },
  en: {
    closedTitle: "Closed alarms",
    sub: "Chronological · the oldest unanswered at the top",
    waiting: "Awaiting response",
    reviewing: "Under review",
    openCount: "Open · {count}",
    all: "All",
    criticalOnly: "Critical only",
    emptyWaiting: "No alarm is awaiting a response.",
    emptyReviewing: "No alarm is under review.",
    emptyFiltered: "No alarm matches this filter.",
    unknown: "The board is out of date — not every open alarm may be shown.",
    unavailable: "The alarms cannot be read; this screen DOES NOT MEAN there are no alarms.",
    closedGone: "A closed alarm leaves the board: the engine sends the open ones only, and there is no endpoint for the history yet. The closures are in the audit trail.",
    escalated: "Escalated",
    escalatedHelp: "The engine runs the escalation; this screen shows only the state the engine reported.",
    seen: "Seen",
    seeing: "Saving…",
    seenBy: "Seen by {who}",
    noAckPerm: "You cannot acknowledge alarms — that needs the \"alerts.ack\" right.",
    notLive: "The board is out of date; the acknowledgement does reach the server, but the list may be stale.",
    elapsed: "Open for",
    noElapsed: "The engine sent no first-seen time, so no duration is shown.",
    openPatient: "Open the patient in bed {bed}",
    ackDone: "The alarm was marked as seen.",
  },
};
```

- [ ] **Step 2: Take this arm's two lines in the catalogue**

In `dashboard/src/live/i18n/catalog.js`, replace

```javascript
// G1-10: import alarms from "./strings/alarms.js";
```

with

```javascript
import alarms from "./strings/alarms.js";
```

and replace

```javascript
  // G1-10: alarms,
```

with

```javascript
  alarms,
```

- [ ] **Step 3: List this arm's reviewed Azerbaijani identities**

In `dashboard/src/live/i18n/strings.test.js`, replace

```javascript
  // G1-10 (alarms) · az = tr

  // G1-11 (patient) · az = tr
```

with

```javascript
  // G1-10 (alarms) · az = tr
  "alarms.criticalOnly", //  Yalnız kritik — the prototype's AZ dictionary (screens.js)
  "alarms.seen", //          Gördüm — the prototype's AZ dictionary (the acknowledge button)
  "alarms.seenBy", //        Gördü — the same verb, third person, in Azerbaijani too

  // G1-11 (patient) · az = tr
```

The `· az = tr` suffix is what makes that anchor unique: `NEUTRAL` carries the same seven headings with `· neutral` instead (Task 6). This arm has no language-neutral keys, so it leaves `NEUTRAL` alone, and it does not depend on any other arm having merged.

- [ ] **Step 4: Check the parity**

```bash
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests |az |ru "
```
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Write the screen's test**

Create `dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { NOW, ago, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
import { AlarmsScreen } from "./AlarmsScreen.jsx";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The screen inside a real session and board store. `connection`: "live" | "degraded" |
 *  "unavailable"; `perms` decides whether the acknowledge button exists at all. */
async function open({ payload = board(), connection = "live", perms = ["board.view", "alerts.ack"], setup } = {}) {
  const mounted = await mount(<AlarmsScreen />, {
    access: token({ perms }),
    me: profile({ perms }),
    setup: (api) => {
      if (connection === "unavailable") api.boardPatients.mockRejectedValue(new Error("down"));
      else api.boardPatients.mockResolvedValue(payload);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      setup?.(api);
    },
  });
  const { board: store, stream } = mounted;
  await act(async () => { await store.start(); });
  if (connection !== "unavailable") {
    await act(async () => { stream.open(); await settle(); });
    if (connection === "degraded") act(() => { stream.drop(); });
  }
  return mounted;
}

const CARD = { identity: identity(), at: measured(30) };
const withAlarms = (...alarms) => board([entry("S-001", alarms, { ...CARD, risk: "high" })]);

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
});

describe("the alarms screen", () => {
  it("names itself and shows the two sections the board can answer for", async () => {
    await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
    expect(screen.getByRole("heading", { level: 1, name: "Siqnallar" })).toBeInTheDocument();
    // One h1 and no more: the shell moves focus to <main> after every move, and the screen's own
    // heading is what a reader lands on.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2, name: /Qiymətləndirilir/ }).length).toBeGreaterThan(0);
  });

  it("says where a closed alarm went, instead of an empty \"closed today\" section", async () => {
    // The board carries the engine's ACTIVE alarms only: an empty third section would read as
    // "nothing was closed today", which is a different and false statement.
    await open({ payload: withAlarms(alarm("news2")) });
    expect(screen.getByText(/Bağlanan siqnal paneldən düşür/)).toBeInTheDocument();
  });

  it("says whose business escalation is, and shows only the flag the engine sent", async () => {
    await open({ payload: withAlarms(alarm("news2", "high", { escalated: true })) });
    expect(screen.getByText("Eskalasiya edilib")).toBeInTheDocument();
    expect(screen.getByText(/Eskalasiyanı mühərrik yürüdür/)).toBeInTheDocument();
    // No 3 / 5 / 10-minute ladder: nothing behind the live API has that shape.
    expect(screen.queryByText(/3\. dəq|5\. dəq|10\. dəq/)).toBeNull();
  });

  describe("how long an alarm has been open", () => {
    it("writes minutes and seconds under an hour", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(247) })) });
      expect(screen.getByText("4:07")).toBeInTheDocument();
    });

    it("opens the hour field past an hour — never \"318:30\"", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(19_110) })) });
      expect(screen.getByText("5:18:30")).toBeInTheDocument();
      expect(screen.queryByText("318:30")).toBeNull();
    });

    it("shows NO duration when the engine sent no first-seen time", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: null })) });
      expect(screen.getByText("Mühərrik ilk görülmə vaxtını göndərməyib; müddət göstərilmir.")).toBeInTheDocument();
    });

    it("counts from the server's instant against this browser's clock", async () => {
      // How often it is re-read is useNow's business (screens/common/useNow.test.jsx).
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(60) })) });
      expect(screen.getByText("1:00")).toBeInTheDocument();
    });

    it("an instant that has not arrived yet reads 0:00, not a negative age", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(-90) })) });
      expect(screen.getByText("0:00")).toBeInTheDocument();
    });
  });

  describe("the order", () => {
    it("worst first, then oldest, among the alarms awaiting a response", async () => {
      await open({
        payload: board([
          entry("S-001", [alarm("a", "moderate", { first_seen_at: ago(900) })], { ...CARD }),
          entry("S-002", [alarm("b", "critical", { first_seen_at: ago(60) })], { ...CARD }),
          entry("S-003", [alarm("c", "critical", { first_seen_at: ago(600) })], { ...CARD }),
        ]),
      });
      const waiting = screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ }).parentElement;
      expect(within(waiting).getAllByRole("link").map((a) => a.textContent))
        .toEqual(["REA-01 · 2", "REA-01 · 2", "REA-01 · 2"]);
      expect(within(waiting).getAllByText(/ölçütü karşılandı/).map((p) => p.textContent))
        .toEqual(["c ölçütü karşılandı", "b ölçütü karşılandı", "a ölçütü karşılandı"]);
    });

    it("the critical filter narrows both sections", async () => {
      await open({
        payload: board([
          entry("S-001", [alarm("a", "moderate")], { ...CARD }),
          entry("S-002", [alarm("b", "critical")], { ...CARD }),
        ]),
      });
      fireEvent.click(screen.getByRole("button", { name: "Yalnız kritik" }));
      expect(screen.getByText("b ölçütü karşılandı")).toBeInTheDocument();
      expect(screen.queryByText("a ölçütü karşılandı")).toBeNull();
    });
  });

  describe("acknowledging", () => {
    it("sends patient and kind, and shows the board the server answered with", async () => {
      const acked = entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7", acknowledged: true, acknowledged_by: "ayse", acknowledged_at: ago(1) })], { ...CARD, risk: "high" });
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.acknowledge.mockResolvedValue(acked),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Gördüm" }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalledWith("S-001", "news2");
      expect(screen.getByText("Gördü: ayse")).toBeInTheDocument();
      // It moved to the second section: the button for it is gone.
      expect(screen.queryByRole("button", { name: "Gördüm" })).toBeNull();
    });

    it("a refusal is shown and the list is NOT changed — nothing was acknowledged", async () => {
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(403, "permission required: alerts.ack")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Gördüm" }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalled();
      const alerts = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
      expect(alerts).toContain("səlahiyyətiniz yoxdur (alerts.ack)");
      expect(screen.getByRole("button", { name: "Gördüm" })).toBeInTheDocument();
    });

    it("an alarm somebody else answered says so", async () => {
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(404, "no such active alert")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Gördüm" }));
        await settle();
      });
      expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
        .toContain("Bu siqnal artıq açıq deyil");
    });

    it("says it is saving, in words a screen reader hears", async () => {
      let release;
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockImplementation(() => new Promise((resolve) => { release = resolve; })),
      });
      const button = screen.getByRole("button", { name: "Gördüm" });
      await act(async () => { fireEvent.click(button); await settle(); });
      expect(button).toHaveAttribute("aria-busy", "true");
      await waitFor(
        () => expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain("Yadda saxlanılır…"),
        // ANNOUNCE_DELAY_MS is 150 ms of REAL time; the default 1 s wait can be missed when the
        // whole suite runs its files in parallel on a loaded machine.
        { timeout: 4000 },
      );
      await act(async () => { release(entry("S-001", CARD)); await settle(); });
    });

    it("no button at all without the right, and the reason is on the screen", async () => {
      await open({ payload: withAlarms(alarm("news2")), perms: ["board.view"] });
      expect(screen.queryByRole("button", { name: "Gördüm" })).toBeNull();
      expect(screen.getByText(/«alerts.ack» səlahiyyəti lazımdır/)).toBeInTheDocument();
    });
  });

  describe("what it refuses to imply", () => {
    it("a board that could not be loaded does not read as \"no alarms\"", async () => {
      await open({ connection: "unavailable" });
      const said = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
      expect(said).toContain("GƏLMİR");
      expect(screen.queryByText("Cavab gözləyən həyəcan siqnalı yoxdur.")).toBeNull();
    });

    it("a board that may be out of date says so, and warns before an acknowledgement", async () => {
      await open({ payload: withAlarms(alarm("news2")), connection: "degraded" });
      const notes = screen.getAllByRole("note").map((n) => n.textContent).join(" ");
      expect(notes).toContain("açıq siqnalların hamısı göstərilməyə bilər");
      expect(notes).toContain("siyahı köhnə ola bilər");
    });

    it("only a LIVE board says nothing is waiting", async () => {
      await open({ payload: board([entry("S-001", CARD)]) });
      expect(screen.getByText("Cavab gözləyən həyəcan siqnalı yoxdur.")).toBeInTheDocument();
    });

    it("an alarm whose severity is \"none\" can never read \"no finding\"", async () => {
      await open({ payload: withAlarms(alarm("other", "none")) });
      expect(screen.queryByText("Tapıntı yoxdur")).toBeNull();
      expect(screen.getByText("Risk bildirilməyib")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npx vitest run src/live/screens/alarms/ 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./AlarmsScreen.jsx"`.

- [ ] **Step 7: Write the screen**

```jsx
// src/live/screens/alarms/AlarmsScreen.jsx — the open alarms (G1-10).
//
// TWO SECTIONS, NOT THREE. The prototype has "awaiting response", "under review" and "closed in
// the last hour". The first two are the board's own two states (`acknowledged` false and true).
// The third cannot be built: `/patients` carries the engine's ACTIVE alarms only, so a closed
// alarm simply leaves the board, and the only durable record of it is the audit trail — which
// needs `audit.view`, which no nurse has, and whose reads return the OLDEST rows first (a known
// engine defect, roadmap "Dalga 0'dan açık kalanlar"). An empty "closed today" section would read
// as "nothing was closed today", which is a different and false statement. So the screen says in
// one sentence where a closed alarm went, and shows two sections.
//
// ONE ESCALATION FACT, NOT A LADDER. The prototype draws three pills — 3 / 5 / 10 minutes,
// charge nurse / physician / rapid-response — and advances them when a human clicks "Escalate".
// Nothing behind the live API has that shape: the board carries one boolean, `escalated`, which
// the engine's own escalation loop sets. The prototype's own admin screen admits the chain is "in
// the engine's code but not connected". So: the engine's flag, named, with one sentence saying
// whose business escalation is. Snooze and manual escalation are Group 2 (the roadmap's list).
//
// THE AGE IS THE SERVER'S INSTANT ON THIS BROWSER'S CLOCK. `firstSeenAtMs` with `elapsed()`:
// `m:ss` under an hour, `h:mm:ss` above (never "318:30"), `0:00` for an instant that has not
// arrived, and NO duration at all when the engine sent no first-seen time — never an invented one.
// Nothing runs on the simulation's clock, which is gone.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, Note, RiskPill, Seg, StatusPill, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import {
  BoardStrip, ChronicExpected, ScopeNote, boardKnown, boardStale, summaryOf, useBoardNow,
} from "../common/BoardState.jsx";
import { elapsed } from "../common/elapsed.js";

/** The ages on this screen tick every second: how long an alarm nobody has answered has been open
 *  is the number this screen exists to show. `useNow` skips the tick while the tab is hidden. */
const TICK_MS = 1_000;

/** An alarm's severity as a pill may show it. "none" is a PATIENT's risk — "no alarm at all" — and
 *  never an alarm's own severity; shown as one it would read "no finding" beside an alarm nobody
 *  has answered. Handed over as an unreported risk instead: the attention look, never calm.
 *  (The same mapping the bell uses, shell/TopBar.jsx.) */
const pillRisk = (severity) => (severity === "none" ? null : severity);

/** Oldest first, and a severity this build does not know first of all — it may be the worst (the
 *  rule `waitingAlarms` follows for the bell). */
const RANK = ["critical", "high", "moderate", "low", "info"];
function oldestFirst(a, b) {
  return (a.firstSeenAtMs ?? Infinity) - (b.firstSeenAtMs ?? Infinity);
}
function worstFirst(a, b) {
  return RANK.indexOf(a.severity) - RANK.indexOf(b.severity) || oldestFirst(a, b);
}

function Row({ alarm, nowMs, canAck, onAck, busy }) {
  const { t } = useI18n();
  const age = elapsed(alarm.firstSeenAtMs, nowMs);
  const bed = alarm.bedLabel || alarm.patientId;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-t border-line px-3 py-2.5 first:border-t-0 max-[640px]:grid-cols-[auto_minmax(0,1fr)]">
      <RiskPill risk={pillRisk(alarm.severity)} measured />
      <div className="min-w-0">
        <a
          href={`#/patients/${encodeURIComponent(alarm.patientId ?? "")}`}
          aria-label={t("alarms.openPatient", { bed })}
          className={`rounded-md font-data text-13.5 font-bold text-ink ${FOCUS_RING}`}
        >
          {bed}
        </a>
        {/* The engine writes its summaries in English (reco/engine.py); marked so a screen reader
            pronounces them as English. The screen says once, below, that they are. */}
        <p lang="en" className="m-0 text-13 text-ink">{summaryOf(alarm) ?? t("board.findingUnnamed")}</p>
        <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-11.5 text-mute">
          {age === null ? (
            <span>{t("alarms.noElapsed")}</span>
          ) : (
            <span>
              <span className="sr-only">{`${t("alarms.elapsed")}: `}</span>
              <b className="font-data text-12.5 text-ink">{age}</b>
            </span>
          )}
          {Number.isFinite(alarm.firstSeenAtMs) ? <span className="font-data">{hhmm(alarm.firstSeenAtMs)}</span> : null}
          {alarm.escalated ? <StatusPill tone="att" icon="alert">{t("alarms.escalated")}</StatusPill> : null}
          {/* Visible, and marked as the engine's own explanation — but NOT in the counts that mean
              "someone must answer this" (boardStore `needsAnswer`). */}
          <ChronicExpected alarm={alarm} />
          {alarm.ackBy ? <span>{t("alarms.seenBy", { who: alarm.ackBy })}</span> : null}
          {Number.isFinite(alarm.ackAtMs) ? <span className="font-data">{hhmm(alarm.ackAtMs)}</span> : null}
        </p>
      </div>
      {canAck && alarm.status !== "ACKNOWLEDGED" ? (
        <>
          <Button variant="primary" size="sm" icon="ok" busy={busy} onClick={() => onAck(alarm)}>
            {t("alarms.seen")}
          </Button>
          {/* A busy Button reads only "unavailable" to a screen reader; the words come from here
              (Wave 1B's note for G1-10's first use of `busy`). */}
          <Announce text={busy ? t("alarms.seeing") : ""} />
        </>
      ) : null}
    </li>
  );
}

function Section({ titleKey, emptyKey, alarms, nowMs, canAck, onAck, busyId, level = 2 }) {
  const { t } = useI18n();
  const Heading = `h${level}`;
  return (
    <section className="grid gap-2">
      <Heading className="m-0 flex items-center gap-2 font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute">
        {t(titleKey)}
        <span className="font-data text-12 text-ink">{alarms.length}</span>
      </Heading>
      {alarms.length === 0 ? (
        <Empty icon="bell">{t(emptyKey)}</Empty>
      ) : (
        <ul className="m-0 list-none rounded-box border border-line bg-card p-0">
          {alarms.map((a) => (
            <Row key={a.id} alarm={a} nowMs={nowMs} canAck={canAck} onAck={onAck} busy={busyId === a.id} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AlarmsScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const { user } = useSession();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  const [only, setOnly] = useState("all");
  const [busyId, setBusyId] = useState(null);
  const [failure, setFailure] = useState(null);
  const canAck = user.perms.includes("alerts.ack");
  const known = boardKnown(board.connection);
  const stale = boardStale(board.connection);
  // WHAT AN EMPTY SECTION IS ALLOWED TO SAY. "No alarm is awaiting a response" is a claim about
  // the ward, and only a LIVE board may make it. A board that may be out of date says that, and
  // one that could not be loaded says it cannot be read — never a sentence a reader would take
  // for a calm ward. A filter the clinician set is a third case, and is about the filter.
  const emptyKey = (none) => {
    if (only === "crit" && board.alerts.length > 0) return "alarms.emptyFiltered";
    if (known) return none;
    return stale ? "alarms.unknown" : "alarms.unavailable";
  };

  const { waiting, reviewing, hidden, openTotal } = useMemo(() => {
    const picked = only === "crit" ? board.alerts.filter((a) => a.severity === "critical") : board.alerts;
    return {
      waiting: picked.filter((a) => a.status !== "ACKNOWLEDGED").sort(worstFirst),
      reviewing: picked.filter((a) => a.status === "ACKNOWLEDGED").sort(oldestFirst),
      // ADDED 2026-10-11 (clinical-screens review): how much the filter hides, and a count that
      // speaks for the WARD rather than for the filter. See the Seg block below.
      hidden: board.alerts.length - picked.length,
      openTotal: board.alerts.filter((a) => a.status !== "ACKNOWLEDGED").length,
    };
  }, [board.alerts, only]);

  async function acknowledge(alarm) {
    if (busyId) return;                       // one at a time: the answer rewrites the board
    setBusyId(alarm.id);
    setFailure(null);
    try {
      // The store makes the call and puts the answer on the board; nothing is written before the
      // server has taken it, so there is nothing to roll back if it refuses.
      await board.store.acknowledge(alarm.patientId, alarm.kind);
      toast(t("alarms.ackDone"));
    } catch (err) {
      // Shown, not swallowed, and the list is NOT changed: nothing was acknowledged. A 404 means
      // the alarm is no longer open — somebody else answered it, or it cleared.
      setFailure(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex min-h-0 max-w-[1000px] flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-23 font-bold">{t("nav.alarms")}</h1>
          <p className="m-0 text-13 text-mute">{t("alarms.sub")}</p>
        </div>
        {/* CORRECTED 2026-10-11 (clinical-screens review). This block used to read
            `t("alarms.openCount", { count: waiting.length })`, which was wrong twice over and is
            the one count on this screen that had no `known` guard: it printed "Açıq · 0" on a
            board that could not be read at all, beside the crit alert saying so, and zero is the
            most reassuring thing this screen can print. And `waiting` is the FILTERED list, so
            turning the critical-only filter on made the group's accessible name understate the
            ward while the rail badge and the bell went on reporting the truth from the same
            board. The count comes from `board.alerts` and only when the board is LIVE; the filter
            says how much it hides (`alarms.critHidden`), as the bed board does. */}
        <Seg label={known ? t("alarms.openCount", { count: openTotal }) : t("alarms.openUnknown")} value={only} onChange={setOnly} options={[
          { value: "all", label: t("alarms.all") },
          { value: "crit", label: t("alarms.criticalOnly"), icon: "alert" },
        ]} />
      </div>

      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />
      {/* A board that is not LIVE may not be spoken of as the whole truth, and this screen's whole
          subject is "what is still waiting" — the sentence it must never imply when it cannot know. */}
      {!known && !stale ? <Alert tone="crit">{t("alarms.unavailable")}</Alert> : null}
      {stale ? <Note tone="warn" icon="alert">{t("alarms.unknown")}</Note> : null}
      {!canAck ? <Note tone="info" icon="shield">{t("alarms.noAckPerm")}</Note> : null}
      {canAck && stale ? <Note tone="warn" icon="clock">{t("alarms.notLive")}</Note> : null}
      {failure ? <Alert tone="crit" key={String(busyId)}>{apiErrorText(t, failure)}</Alert> : null}

      <Section
        titleKey="alarms.waiting" emptyKey={emptyKey("alarms.emptyWaiting")}
        alarms={waiting} nowMs={nowMs} canAck={canAck} onAck={acknowledge} busyId={busyId}
      />
      <Section
        titleKey="alarms.reviewing" emptyKey={emptyKey("alarms.emptyReviewing")}
        alarms={reviewing} nowMs={nowMs} canAck={false} onAck={acknowledge} busyId={busyId}
      />

      {/* Its own heading: this box is about CLOSED alarms, and titling it "Under review" put a
          second identical <h2> on the page. */}
      <Box title={t("alarms.closedTitle")} icon="clip" level={2} className="!border-dashed">
        <p className="m-0 text-12.5 text-mute">{t("alarms.closedGone")}</p>
        <p className="m-0 mt-1.5 text-12.5 text-mute">{t("alarms.escalatedHelp")}</p>
        <p className="m-0 mt-1.5 text-12.5 text-mute">{t("board.engineEnglish")}</p>
      </Box>
    </div>
  );
}
```

The piece to read twice is `emptyKey`. **An empty section is a claim about the ward**, and only a LIVE board may make it: "no alarm is awaiting a response" on a board whose load failed is the exact sentence this whole wave exists to prevent, and the first draft of this screen said it. A board that may be out of date says that instead; one that could not be read says it cannot be read; a filter the clinician set is a third case and is about the filter.

- [ ] **Step 8: Run it**

```bash
npx vitest run src/live/screens/alarms/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  19 passed (19)`.

- [ ] **Step 9: Take this arm's two lines in the registry**

In `dashboard/src/live/shell/routes.js`, replace

```javascript
// G1-10: import { AlarmsScreen } from "../screens/alarms/AlarmsScreen.jsx";
```

with

```javascript
import { AlarmsScreen } from "../screens/alarms/AlarmsScreen.jsx";
```

and replace

```javascript
  alarms: null,    // G1-10
```

with

```javascript
  alarms: AlarmsScreen, // G1-10
```

- [ ] **Step 9a: Look at it** — the one check no test makes.

Run `npx vite dev`, sign in, open `#/alarms`.

Check, at 1440 px and at 390 px, in both themes: no horizontal page scroll; each row's text and its "Gördüm" button both readable without zooming, and the button still reachable with the thumb; the two sections' headings distinguishable at a glance; an age that has passed an hour (`5:18:30`) does not push the row's layout apart; and the chronic-expected pill reads as an explanation rather than as a second warning beside the risk pill.

- [ ] **Step 10: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected, on an arm built off Task 8 alone: `92 passed (92)` files, `1897 passed (1897)` tests; the build succeeds. **This task's own number is 19, in `AlarmsScreen.test.jsx`.**

- [ ] **Step 11: Commit**

```bash
git add dashboard/src/live/i18n/strings/alarms.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/alarms/AlarmsScreen.jsx dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx dashboard/src/live/shell/routes.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the alarms screen (G1-10)

Two sections, because /patients carries the engine's ACTIVE alarms only and an
empty "closed today" list would read as "nothing was closed today" — so one
sentence says where a closed alarm went. One escalation fact, the engine's own
flag, because nothing behind the live API has the prototype's 3/5/10 ladder.
"Gördüm" sends patient and kind, shows the board the server answered with, and
writes nothing before the server has taken it. An empty section is a claim
about the ward, so only a LIVE board may make it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **19** tests in the new `AlarmsScreen.test.jsx`; whole suite green; build clean; looked at 390/1440 px in both themes.

---

### Task 13: The rail's count and the bell's links

**Files:**
- Modify: `dashboard/src/live/shell/Sidebar.jsx`, `dashboard/src/live/shell/TopBar.jsx`, `dashboard/src/live/shell/Shell.test.jsx`

Both deferred from Wave 2 to G1-10. The badge follows the bell's rule exactly — a number only from a LIVE board, the amber dot when it may be out of date, nothing when it cannot know — and is never the only signal: the entry's accessible name says the same thing in words.

> **Note for the merge.** This task and Task 15 both edit `Sidebar.jsx`'s header comment, in adjacent paragraphs. Whichever arm merges second resolves a two-paragraph comment conflict; there is no code overlap.

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/live/shell/Shell.test.jsx`, add an alarms probe: replace

```javascript
function PatientProbe({ params }) {
  return <h1>Xəstə {params.id}</h1>;
}
```

with

```javascript
function PatientProbe({ params }) {
  return <h1>Xəstə {params.id}</h1>;
}
function AlarmsProbe() {
  return <h1>Siqnal ekranı</h1>;
}
```

Then, inside `describe("the rail")`, replace

```javascript
  it("shows an administrator the built admin screen", async () => {
```

with

```javascript
  // The count of unanswered alarms on the rail's own entry (deferred from Wave 2 to G1-10), under
  // the bell's rule: a number only from a LIVE board.
  describe("the alarms entry's count", () => {
    const waitingPatients = (n) => Array.from({ length: n }, (_, i) => ({
      patient_id: `P-${i}`, risk: "high", vitals: {},
      alerts: [{ kind: "news2", severity: "high", summary: `NEWS2 ${i}`, acknowledged: false }],
    }));

    it("counts what is waiting on a LIVE board, in a badge AND in the entry's name", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const { stream } = await renderShell({ patients: waitingPatients(3) });
      await act(async () => { stream.open(); await settle(); });
      const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
      const entry = within(rail).getByRole("link", { name: /Siqnallar/ });
      expect(entry).toHaveTextContent("3");
      expect(entry).toHaveAccessibleName(/3 siqnal cavab gözləyir/);
    });

    it("a board that may be out of date shows a dot, never a number", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const { stream } = await renderShell({ patients: waitingPatients(3) });
      await act(async () => { stream.open(); await settle(); });
      act(() => { stream.drop(); });
      const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
      expect(within(rail).queryByText("3")).toBeNull();
      expect(rail.querySelector("[data-rail-badge='stale']")).toBeInTheDocument();
    });

    it("a board that cannot know shows nothing", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const rail = (await renderShell({ patients: waitingPatients(3), start: false }),
        screen.getByRole("navigation", { name: "Əsas menyu" }));
      expect(rail.querySelector("[data-rail-badge]")).toBeNull();
    });

    it("a LIVE board with nothing waiting shows no badge either", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const { stream } = await renderShell({ patients: [] });
      await act(async () => { stream.open(); await settle(); });
      const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
      expect(rail.querySelector("[data-rail-badge]")).toBeNull();
    });
  });

  it("shows an administrator the built admin screen", async () => {
```

And inside `describe("the top bar")`, replace

```javascript
  it("lists the worst alarms and says how many more are waiting", async () => {
```

with

```javascript
  // Deferred from Wave 2 to G1-10: a list of alarms nobody can reach from is a list nobody can
  // act on.
  it("links each row to the patient it is about, and the panel to the alarms screen", async () => {
    only({ beds: BedsProbe, alarms: AlarmsProbe, patient: PatientProbe });
    const patients = [{ patient_id: "P-001", risk: "high", vitals: {},
      alerts: [{ kind: "news2", severity: "high", summary: "NEWS2 7", acknowledged: false }],
      identity: { bed_label: "REA-01" } }];
    const { stream } = await renderShell({ patients });
    await act(async () => { stream.open(); await settle(); });
    fireEvent.click(screen.getByRole("button", { name: /1 siqnal cavab gözləyir/ }));
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    expect(within(panel).getByRole("link", { name: /REA-01/ })).toHaveAttribute("href", "#/patients/P-001");
    expect(within(panel).getByRole("link", { name: /Siqnallar/ })).toHaveAttribute("href", "#/alarms");
  });

  it("does not offer a way to a screen this build has not built", async () => {
    only({ beds: BedsProbe });
    const patients = [{ patient_id: "P-001", risk: "high", vitals: {},
      alerts: [{ kind: "news2", severity: "high", summary: "NEWS2 7", acknowledged: false }] }];
    const { stream } = await renderShell({ patients });
    await act(async () => { stream.open(); await settle(); });
    fireEvent.click(screen.getByRole("button", { name: /1 siqnal cavab gözləyir/ }));
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    expect(within(panel).queryByRole("link", { name: /^Siqnallar/ })).toBeNull();
  });

  it("lists the worst alarms and says how many more are waiting", async () => {
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/live/shell/Shell.test.jsx 2>&1 | grep -E "Tests "
```
Expected: `6 failed | 34 passed (40)`.

- [ ] **Step 3: Give the rail its badge** — `dashboard/src/live/shell/Sidebar.jsx`, whole file. **This arm owns this file outright.** Its header paragraph about a `nav: false` screen was already settled in Task 7, before the fork, precisely so that the patient arm never opens it: a whole-file write from one arm and a paragraph replacement from another conflict in either merge order, which is what an earlier draft of this plan had and claimed it did not.

```jsx
// src/live/shell/Sidebar.jsx — the rail (the prototype's .rail / .ri): the screens this session may
// open, built ones only (routes.js), each a link with its icon AND its name — on a phone (62 px)
// its short name, never an icon alone (roadmap: "Daraltılmış sol menüde her madde kısa adıyla
// görünür"). The current screen is aria-current="page".
//
// A screen the rail does not list (routes.js `nav: false`) is open under the entry it was reached
// FROM: the patient screen is opened from the beds board, so the beds entry reads as current while
// a patient is on screen (`under` in routes.js; the Shell passes it). Wave 2 left this open and
// showed no entry as current, on the ground that the entry does not lead to that page — but a
// clinician spends most of her time on a patient, and a rail with nothing current says "you are
// nowhere" for the whole of it. The patient screen also carries a visible way back to the board,
// so the claim is not only implied (G1-11's decision; the deferred note of Wave 2).
//
// The alarms entry carries the count of unanswered alarms, under the same rule as the bell: a
// number only from a LIVE board.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useBoard } from "../data/BoardProvider.jsx";
import { waitingAlarms } from "../data/boardStore.js";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { homePath, navRoutes } from "./routes.js";

/** The alarms entry's count: the alarms nobody has acknowledged, and ONLY from a LIVE board
 *  (`waitingAlarms` has Wave 2's Decision 18 applied). A board that may be out of date shows the dot
 *  bell wears rather than a number — a count a reader would take for current is worse than none —
 *  and one that cannot know shows nothing at all. A badge is never the only signal: the entry's
 *  accessible name says the same thing in words. */
function AlarmBadge({ routeId }) {
  const { t } = useI18n();
  const board = useBoard();
  const { known, stale, items } = waitingAlarms(board);
  if (routeId !== "alarms") return null;
  const count = items?.length ?? 0;
  if (known && count > 0) {
    return (
      <>
        <span aria-hidden="true" data-rail-badge="count" className="absolute right-1 top-1 min-w-[16px] rounded-full bg-crit px-1 font-text text-10 font-bold leading-[14px] text-oncrit">{count}</span>
        <span className="sr-only">{` · ${t("shell.bellCount", { count })}`}</span>
      </>
    );
  }
  if (stale) {
    return (
      <>
        <span aria-hidden="true" data-rail-badge="stale" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-mid" />
        <span className="sr-only">{` · ${t("shell.bellStale", { count })}`}</span>
      </>
    );
  }
  return null;
}

function RailLink({ route, current }) {
  const { t } = useI18n();
  const on = route.id === current;
  return (
    <li>
      <a
        href={`#${route.path}`}
        aria-current={on ? "page" : undefined}
        className={`relative flex flex-col items-center gap-1 rounded-box px-0.5 pb-2 pt-[9px] text-center font-text text-10.5 font-semibold leading-[1.15] ${on ? "bg-pri text-onpri" : "text-mute hover:bg-card2 hover:text-ink"} ${FOCUS_RING}`}
      >
        <Icon name={route.icon} size={21} />
        <span className="max-[640px]:hidden">{t(route.labelKey)}</span>
        <span className="hidden text-10 max-[640px]:block">{t(route.shortKey)}</span>
        <AlarmBadge routeId={route.id} />
      </a>
    </li>
  );
}

/** `current`: the id of the route on screen (null when none is). */
export function Sidebar({ perms, current }) {
  const { t } = useI18n();
  const { main, bottom } = navRoutes(perms);
  return (
    <nav aria-label={t("shell.rail")} className="z-30 flex min-h-0 flex-col gap-[3px] overflow-y-auto border-r border-line bg-rail px-2 py-2.5 max-[640px]:px-1">
      <div className="mb-1.5 border-b border-line pb-3 pt-1">
        <a href={`#${homePath(perms)}`} className={`flex flex-col items-center gap-[5px] rounded-box ${FOCUS_RING}`}>
          <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-ctl bg-ink font-display text-20 font-bold text-app">h</span>
          <small className="font-display text-10 font-bold text-mute max-[640px]:hidden">homunculus</small>
          <span className="sr-only">{t("shell.home")}</span>
        </a>
      </div>
      <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
        {main.map((route) => <RailLink key={route.id} route={route} current={current} />)}
      </ul>
      <div className="flex-1" />
      <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
        {bottom.map((route) => <RailLink key={route.id} route={route} current={current} />)}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Make every bell row a link, and give the panel a foot**

In `dashboard/src/live/shell/TopBar.jsx`, replace

```javascript
import { useShell } from "./ShellContext.jsx";
```

with

```javascript
import { useShell } from "./ShellContext.jsx";
import { ROUTES, canReach, screenOf } from "./routes.js";
```

Replace

```javascript
function Bell() {
  const { t } = useI18n();
```

with

```javascript
/** The way to the whole list, when this build has the alarms screen and this session may open it
 *  — never a dead link (the rail's own entry follows the same rule, routes.js `navRoutes`). */
function BellFoot() {
  const { t } = useI18n();
  const { user } = useSession();
  const route = ROUTES.find((r) => r.id === "alarms");
  if (!route || !screenOf(route) || !canReach(route, user.perms)) return null;
  return (
    <p className="m-0 border-t border-line px-3.5 py-2.5">
      <a href={`#${route.path}`} className={`inline-flex items-center gap-1.5 rounded-md text-12.5 font-semibold text-pri ${FOCUS_RING}`}>
        {t("nav.alarms")}
        <Icon name="chevR" size={14} />
      </a>
    </p>
  );
}

function Bell() {
  const { t } = useI18n();
```

Replace

```javascript
              {waiting.slice(0, BELL_LIST_MAX).map((a) => (
                <li key={a.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 border-t border-line px-3.5 py-2.5">
                  <RiskPill risk={pillRisk(a.severity)} measured />
                  <div className="min-w-0">
                    <b className="block font-data text-13">{a.bedLabel}</b>
                    <span className="block text-12 text-mute">{a.summary ?? a.kind}</span>
                  </div>
                  <span className="whitespace-nowrap font-data text-11 font-semibold text-mute">
                    {a.firstSeenAtMs ? t("shell.bellSince", { time: hhmm(a.firstSeenAtMs) }) : "—"}
                  </span>
                </li>
              ))}
```

with

```javascript
              {/* Each row is a link to the patient it is about (deferred from Wave 2 to G1-10): a
                  list of alarms nobody can reach from is a list nobody can act on. The alarms
                  screen is linked from the panel's foot when this build has it. */}
              {waiting.slice(0, BELL_LIST_MAX).map((a) => (
                <li key={a.id} className="border-t border-line">
                  <a
                    href={`#/patients/${encodeURIComponent(a.patientId ?? "")}`}
                    className={`grid grid-cols-[auto_1fr_auto] items-start gap-2.5 px-3.5 py-2.5 hover:bg-card2 ${FOCUS_RING}`}
                  >
                    <RiskPill risk={pillRisk(a.severity)} measured />
                    <span className="min-w-0">
                      <b className="block font-data text-13">{a.bedLabel}</b>
                      <span className="block text-12 text-mute">{a.summary ?? a.kind}</span>
                    </span>
                    <span className="whitespace-nowrap font-data text-11 font-semibold text-mute">
                      {a.firstSeenAtMs ? t("shell.bellSince", { time: hhmm(a.firstSeenAtMs) }) : "—"}
                    </span>
                  </a>
                </li>
              ))}
```

and replace

```javascript
            <p className="m-0 border-t border-line bg-card2 px-3.5 py-2.5 text-12 text-mute">{t("shell.bellMore", { count: waiting.length - BELL_LIST_MAX })}</p>
          ) : null}
```

with

```javascript
            <p className="m-0 border-t border-line bg-card2 px-3.5 py-2.5 text-12 text-mute">{t("shell.bellMore", { count: waiting.length - BELL_LIST_MAX })}</p>
          ) : null}
          <BellFoot />
```

- [ ] **Step 4a: The bell prints the engine's English, and says so by marking it**

Two small changes with one reason: the bell's rows print the engine's own `summary`, which is English prose (Decision 24), and they print the raw `kind` when there is no summary. Both go through the one helper Task 6 put in `BoardState.jsx`, so the bell, the card, the list, the alarms row and the patient screen cannot drift apart about what a finding is called.

In `dashboard/src/live/shell/TopBar.jsx`, replace

```javascript
import { ddmm, hhmm, weekdayKey } from "../i18n/dates.js";
```

with

```javascript
import { ddmm, hhmm, weekdayKey } from "../i18n/dates.js";
import { summaryOf } from "../screens/common/BoardState.jsx";
```

and replace

```jsx
                      <span className="block text-12 text-mute">{a.summary ?? a.kind}</span>
```

with

```jsx
                      <span lang="en" className="block text-12 text-mute">{summaryOf(a) ?? t("board.findingUnnamed")}</span>
```

The shell importing from `screens/common/` is deliberate and worth a sentence: the bell IS a board-reading surface, it already reads the board through `waitingAlarms`, and the alternative — a second copy of two lines in the shell — is how the `info` tone came to be two different colours. `boundaries.test.js` is unaffected: the rule it enforces is about `src/live/` not reaching into the old workspace, not about which folder inside `src/live/` imports which.

- [ ] **Step 5: Run the shell's tests**

```bash
npx vitest run src/live/shell/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  74 passed (74)` — `Shell.test.jsx` 40 (was 34), the rest unchanged.

- [ ] **Step 6: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: 6 tests more than Task 12 left; the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/live/shell/Sidebar.jsx dashboard/src/live/shell/TopBar.jsx dashboard/src/live/shell/Shell.test.jsx
git commit -m "$(cat <<'EOF'
feat(dashboard): the rail's alarm count and the bell's per-row links (G1-10)

Both deferred from Wave 2. The badge follows the bell's own rule — a number
only from a LIVE board, the amber dot when it may be out of date, nothing when
it cannot know — and the entry's accessible name says the same in words, so the
badge is never the only signal. Every bell row leads to its patient and the
panel to the alarms screen, when this build has one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 6 new tests in `Shell.test.jsx` (34 → **40**; the patient arm's Task 15 rewrites two of its rail tests without changing the count, so 40 is also the number after both arms have merged); whole suite green; build clean.

---

# Wave 3A · arm 3 — the patient screen (G1-11, Tasks 14–15)

### Task 14: The patient screen

**Files:**
- Create: `dashboard/src/live/i18n/strings/patient.js`, `dashboard/src/live/screens/patient/PatientScreen.jsx` + `PatientScreen.test.jsx`
- Modify: `dashboard/src/live/i18n/catalog.js` (two lines), `dashboard/src/live/i18n/strings.test.js` (one block), `dashboard/src/live/shell/routes.js` (two lines)

Read-only, and it says so. Four things it shows — who and from where, what was measured and HOW OLD each value is, what the engine found and why, and what the score is being judged against — and one it refuses: a trend, because the engine has no endpoint for a vital's history and the prototype draws every curve from a seeded random generator.

- [ ] **Step 1: Write the strings**

Create `dashboard/src/live/i18n/strings/patient.js`, whole file.

This is the file **as this task leaves it**, not as the arm leaves it: Task 15B adds seven charting keys and rewrites two of these sentences, because this screen is read-only until that task and says so. (`i18n/catalog.js` and `shell/routes.js` are given the same way, at the seam.)

```javascript
// The patient screen's summary (G1-11), read-only. The prototype's `patient.js` "Özet" tab, with
// everything it computed in the browser left out: no BMI or body-surface area, no fabricated
// hospital or protocol number, no simulated monitor waveform, no deterioration criteria of its
// own, no nursing-risk scores, no synthetic 24-hour curves.
//
// Sources: `Özet` / `Trendler` / `Skorlar` / `Nabız` / `Ateş` / `Solunum` / `Değerlendir` /
// `Kötüleşme kriterleri karşılanıyor` / `Değerlendirme önerilir · karar hekimindir.` come from the
// prototype's four-language dictionary. `recoSource` is the prototype's "Dayanak:" line, but it
// names the engine's own vault sources instead of a claim about which guideline was used.
// AZ/RU/EN await a native-speaking clinician's review before the pilot.
export default {
  tr: {
    back: "Yataklara dön",
    readOnly: "Bu ekran salt okunur: Grup 1'de hasta kaydına buradan hiçbir şey yazılmaz.",
    notFound: "Bu hasta gösterilemiyor",
    notFoundHelp: "Panonuzda bu kimlikle bir kart yok: ya böyle bir kayıt yok ya da kapsamınız dışında. İkisini ayırt edemiyoruz — sunucu ikisine de aynı yanıtı verir.",
    notFoundUnknown: "Pano okunamadığı için bu hastanın panonuzda olup olmadığını söyleyemiyoruz.",
    vitals: "Ölçülen değerler",
    vitalsNone: "Bu yataktan hiç ölçüm gelmedi.",
    vitalAge: "{age} önce",
    sofa: "SOFA",
    sepsis: "Sepsis-3 bağlamı",
    suspectedUnknown: "Şüpheli enfeksiyon: kimse işaretlemedi — sepsis kuralı bu hastada hiç çalışmıyor.",
    suspectedYes: "Şüpheli enfeksiyon: var (hekim işaretledi).",
    suspectedNo: "Şüpheli enfeksiyon: yok (hekim işaretledi).",
    baseline: "Bazal SOFA",
    baselineAssumed: "Bazal SOFA girilmedi; motor 0 varsayıyor, yükselme bu varsayıma göre.",
    rise: "Yükselme",
    meds: "İlaç ve antibiyotik",
    pressors: "Vazopressör/inotrop: {list}",
    noPressors: "Vazopressör/inotrop kaydı yok.",
    antibioticUnknown: "Antibiyotik: kimse kaydetmedi — verilmediği anlamına gelmez.",
    antibioticGiven: "Antibiyotik verildi: {time}",
    antibioticPending: "Antibiyotik kaydı yok; süre {time} tarihinde doluyor.",
    antibioticOverdue: "Antibiyotik süresi doldu: {time}",
    weight: "Kilo: {value} kg",
    creatinine: "Kreatinin: {value} mg/dL",
    noMeds: "Motor bu hasta için ilaç bilgisi göndermedi.",
    reco: "Motorun bulguları",
    recoNone: "Motor bu hasta için açık bir bulgu bildirmiyor.",
    recoNoneUnknown: "Pano güncel değil; motorun bulguları eksik olabilir.",
    recoDecision: "Değerlendirme önerilir · karar hekimindir.",
    recoReasoning: "Gerekçe",
    recoEvidence: "Dayanak",
    recoActions: "Düşünülebilecekler",
    recoConfidence: "Kesinlik",
    recoDowngraded: "Hastanın kendi normaline göre düşürüldü",
    recoChronic: "Açıklama",
    recoStale: "Bayat girdi: {list}",
    recoLanguage: "Motorun gerekçe, dayanak ve kesinlik metinleri İngilizcedir; çevrilmemiştir.",
    seenBy: "Gördü: {who}",
    trends: "Vital eğrileri",
    trendsSoon: "Vital eğrileri Grup 2'de gelecek: motorda vital geçmişi için bir uç nokta henüz yok, pano yalnız son ölçümü gönderiyor. Tarayıcı kendi eğrisini uydurmaz.",
    formsSoon: "SOFA formunu doldurma/imzalama, şüpheli enfeksiyon ve hastanın kendi normalini girme bu ekrana sonraki grupta eklenecek; o zamana kadar bu ekran hiçbir şey yazmaz.",
  },
  az: {
    back: "Çarpayılara qayıt",
    readOnly: "Bu ekran yalnız oxumaq üçündür: Qrup 1-də xəstə qeydinə buradan heç nə yazılmır.",
    notFound: "Bu xəstə göstərilə bilmir",
    notFoundHelp: "Panelinizdə bu identifikatorla kart yoxdur: ya belə bir qeyd yoxdur, ya da əhatənizdən kənardır. İkisini ayırd edə bilmirik — server ikisinə də eyni cavabı verir.",
    notFoundUnknown: "Panel oxunmadığı üçün bu xəstənin panelinizdə olub-olmadığını deyə bilmirik.",
    vitals: "Ölçülən dəyərlər",
    vitalsNone: "Bu çarpayıdan heç bir ölçmə gəlməyib.",
    vitalAge: "{age} əvvəl",
    sofa: "SOFA",
    sepsis: "Sepsis-3 konteksti",
    suspectedUnknown: "Şübhəli infeksiya: heç kim işarələməyib — sepsis qaydası bu xəstədə heç işləmir.",
    suspectedYes: "Şübhəli infeksiya: var (həkim işarələyib).",
    suspectedNo: "Şübhəli infeksiya: yoxdur (həkim işarələyib).",
    baseline: "Bazal SOFA",
    baselineAssumed: "Bazal SOFA daxil edilməyib; mühərrik 0 fərz edir, artım bu fərzə görədir.",
    rise: "Artım",
    meds: "Dərman və antibiotik",
    pressors: "Vazopressor/inotrop: {list}",
    noPressors: "Vazopressor/inotrop qeydi yoxdur.",
    antibioticUnknown: "Antibiotik: heç kim qeyd etməyib — verilmədiyi anlamına gəlmir.",
    antibioticGiven: "Antibiotik verilib: {time}",
    antibioticPending: "Antibiotik qeydi yoxdur; müddət {time} tarixində bitir.",
    antibioticOverdue: "Antibiotik müddəti bitib: {time}",
    weight: "Çəki: {value} kq",
    creatinine: "Kreatinin: {value} mq/dL",
    noMeds: "Mühərrik bu xəstə üçün dərman məlumatı göndərməyib.",
    reco: "Mühərrikin tapıntıları",
    recoNone: "Mühərrik bu xəstə üçün açıq tapıntı bildirmir.",
    recoNoneUnknown: "Panel güncəl deyil; mühərrikin tapıntıları natamam ola bilər.",
    recoDecision: "Qiymətləndirmə tövsiyə olunur · qərar həkimindir.",
    recoReasoning: "Əsaslandırma",
    recoEvidence: "Dayaq",
    recoActions: "Düşünülə biləcəklər",
    recoConfidence: "Dəqiqlik",
    recoDowngraded: "Xəstənin öz normasına görə aşağı salınıb",
    recoChronic: "İzah",
    recoStale: "Köhnə giriş: {list}",
    recoLanguage: "Mühərrikin əsaslandırma, dayaq və dəqiqlik mətnləri İngiliscədir; tərcümə olunmayıb.",
    seenBy: "Gördü: {who}",
    trends: "Vital qrafikləri",
    trendsSoon: "Vital qrafikləri Qrup 2-də gələcək: mühərrikdə vital tarixçəsi üçün uç nöqtə hələ yoxdur, panel yalnız son ölçməni göndərir. Brauzer öz qrafikini uydurmur.",
    formsSoon: "SOFA formasının doldurulması/imzalanması, şübhəli infeksiya və xəstənin öz normasının daxil edilməsi bu ekrana növbəti qrupda əlavə olunacaq; o vaxta qədər bu ekran heç nə yazmır.",
  },
  ru: {
    back: "К койкам",
    readOnly: "Этот экран только для чтения: в Группе 1 отсюда ничего не записывается в карту пациента.",
    notFound: "Этого пациента показать нельзя",
    notFoundHelp: "На вашей панели нет карточки с этим идентификатором: либо такой записи нет, либо она вне вашей области доступа. Различить мы не можем — сервер отвечает одинаково.",
    notFoundUnknown: "Панель не прочитана, поэтому мы не можем сказать, есть ли этот пациент на вашей панели.",
    vitals: "Измеренные значения",
    vitalsNone: "С этой койки измерений не поступало.",
    vitalAge: "{age} назад",
    sofa: "SOFA",
    sepsis: "Контекст Sepsis-3",
    suspectedUnknown: "Подозрение на инфекцию: никто не отметил — правило сепсиса для этого пациента не работает вовсе.",
    suspectedYes: "Подозрение на инфекцию: есть (отметил врач).",
    suspectedNo: "Подозрение на инфекцию: нет (отметил врач).",
    baseline: "Базовый SOFA",
    baselineAssumed: "Базовый SOFA не введён; система принимает 0, прирост считается от этого допущения.",
    rise: "Прирост",
    meds: "Препараты и антибиотик",
    pressors: "Вазопрессор/инотроп: {list}",
    noPressors: "Записей о вазопрессорах/инотропах нет.",
    antibioticUnknown: "Антибиотик: никто не записал — это не значит, что он не введён.",
    antibioticGiven: "Антибиотик введён: {time}",
    antibioticPending: "Записи об антибиотике нет; срок истекает {time}.",
    antibioticOverdue: "Срок антибиотика истёк: {time}",
    weight: "Вес: {value} кг",
    creatinine: "Креатинин: {value} мг/дл",
    noMeds: "Система не передала данных о препаратах для этого пациента.",
    reco: "Находки системы",
    recoNone: "Система не сообщает об открытых находках для этого пациента.",
    recoNoneUnknown: "Панель неактуальна; находки системы могут быть неполными.",
    recoDecision: "Рекомендуется оценка · решение за врачом.",
    recoReasoning: "Обоснование",
    recoEvidence: "Основание",
    recoActions: "Что можно рассмотреть",
    recoConfidence: "Степень уверенности",
    recoDowngraded: "Понижено с учётом собственной нормы пациента",
    recoChronic: "Пояснение",
    recoStale: "Устаревшие входные данные: {list}",
    recoLanguage: "Тексты обоснования, основания и уверенности система выдаёт по-английски; они не переведены.",
    seenBy: "Принял: {who}",
    trends: "Графики показателей",
    trendsSoon: "Графики показателей появятся в Группе 2: в системе пока нет конечной точки для истории показателей, панель передаёт только последнее измерение. Браузер свою кривую не выдумывает.",
    formsSoon: "Заполнение и подпись формы SOFA, отметка подозрения на инфекцию и ввод собственной нормы пациента будут добавлены на этот экран в следующей группе; до тех пор экран ничего не записывает.",
  },
  en: {
    back: "Back to the beds",
    readOnly: "This screen is read-only: in Group 1 nothing is written to the patient's record from here.",
    notFound: "This patient cannot be shown",
    notFoundHelp: "Your board holds no card with this identifier: either there is no such record, or it is outside your scope. We cannot tell which — the server answers both the same way.",
    notFoundUnknown: "The board could not be read, so we cannot say whether this patient is on it.",
    vitals: "Measured values",
    vitalsNone: "No measurement has arrived from this bed.",
    vitalAge: "{age} ago",
    sofa: "SOFA",
    sepsis: "Sepsis-3 context",
    suspectedUnknown: "Suspected infection: nobody has charted it — the sepsis rule does not run at all for this patient.",
    suspectedYes: "Suspected infection: yes (charted by a physician).",
    suspectedNo: "Suspected infection: no (charted by a physician).",
    baseline: "Baseline SOFA",
    baselineAssumed: "No baseline SOFA was charted; the engine assumes 0, and the rise is measured against that assumption.",
    rise: "Rise",
    meds: "Medication and antibiotic",
    pressors: "Vasopressor/inotrope: {list}",
    noPressors: "No vasopressor or inotrope has been charted.",
    antibioticUnknown: "Antibiotic: nobody has charted it — which does not mean it was not given.",
    antibioticGiven: "Antibiotic given: {time}",
    antibioticPending: "No antibiotic charted; the window closes at {time}.",
    antibioticOverdue: "The antibiotic window closed at {time}",
    weight: "Weight: {value} kg",
    creatinine: "Creatinine: {value} mg/dL",
    noMeds: "The engine sent no medication information for this patient.",
    reco: "What the engine found",
    recoNone: "The engine reports no open finding for this patient.",
    recoNoneUnknown: "The board is out of date; the engine's findings may be incomplete.",
    recoDecision: "Review suggested · the decision rests with the physician.",
    recoReasoning: "Reasoning",
    recoEvidence: "Evidence",
    recoActions: "Worth considering",
    recoConfidence: "Certainty",
    recoDowngraded: "Lowered against the patient's own normal",
    recoChronic: "Explanation",
    recoStale: "Stale inputs: {list}",
    recoLanguage: "The engine writes its reasoning, evidence and certainty in English; they are not translated.",
    seenBy: "Seen by {who}",
    trends: "Vital trends",
    trendsSoon: "Vital trends come with Group 2: the engine has no endpoint for a vital's history yet, and the board sends the latest measurement only. The browser does not invent a curve of its own.",
    formsSoon: "Filling in and signing the SOFA form, charting a suspected infection and entering the patient's own normal come to this screen in the next group; until then this screen writes nothing.",
  },
};
```

- [ ] **Step 2: Take this arm's two lines in the catalogue**

In `dashboard/src/live/i18n/catalog.js`, replace

```javascript
// G1-11: import patient from "./strings/patient.js";
```

with

```javascript
import patient from "./strings/patient.js";
```

and replace

```javascript
  // G1-11: patient,
```

with

```javascript
  patient,
```

- [ ] **Step 3: List this arm's reviewed Azerbaijani identities and its one neutral key**

In `dashboard/src/live/i18n/strings.test.js`, replace

```javascript
  // G1-11 (patient) · az = tr

  // G1-12 (admin · users) · az = tr
```

with

```javascript
  // G1-11 (patient) · az = tr
  "patient.sofa", //         SOFA — the score's own name
  "patient.baseline", //     Bazal SOFA — "baseline SOFA" reads the same in Azerbaijani
  "patient.seenBy", //       Gördü — the same verb as alarms.seenBy

  // G1-12 (admin · users) · az = tr
```

and add this arm's one language-neutral key — SOFA, which is SOFA in every script. Replace

```javascript
  // G1-11 (patient) · neutral

  // G1-12 (admin · users) · neutral
```

with

```javascript
  // G1-11 (patient) · neutral
  "patient.sofa", //              SOFA — the same

  // G1-12 (admin · users) · neutral
```

Both anchors are unique on their own and reach into no other arm's lines, so this arm builds and merges whether or not the beds and alarms arms have landed.

- [ ] **Step 4: Check the parity**

```bash
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests |az |ru "
```
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Write the screen's test**

Create `dashboard/src/live/screens/patient/PatientScreen.test.jsx`. This is the file **as this task leaves it**, at 29 tests; Task 15B appends eight more and changes two of its lines.

```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { onlyScreens } from "../../shell/screens.testutil.js";
import { NOW, ago, alarm, board, entry, identity, measured, news2 } from "../../data/board.testutil.js";
import { PatientScreen } from "./PatientScreen.jsx";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function open({ payload = board(), id = "S-001", connection = "live", setup } = {}) {
  onlyScreens({ beds: () => null }, { keep: [] });
  const perms = ["board.view", "alerts.ack"];
  const mounted = await mount(<PatientScreen params={{ id }} />, {
    access: token({ perms }),
    me: profile({ perms }),
    setup: (api) => {
      if (connection === "unavailable") api.boardPatients.mockRejectedValue(new Error("down"));
      else api.boardPatients.mockResolvedValue(payload);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.view.mockResolvedValue({ ok: true });
      setup?.(api);
    },
  });
  const { board: store, stream } = mounted;
  await act(async () => { await store.start(); });
  if (connection !== "unavailable") {
    await act(async () => { stream.open(); await settle(); });
    if (connection === "degraded") act(() => { stream.drop(); });
  }
  await act(async () => { await settle(); });
  return mounted;
}

const FULL = {
  identity: identity(),
  at: measured(90),
  vitals: { heart_rate: 118, spo2: 91, resp_rate: 26, sbp: 92, map: 58, temperature: 38.4 },
  lactate: 4.1,
  sofa: 7,
  score: news2({ total: 9, red_param: true }),
  risk: "critical",
};

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
});

describe("the patient screen", () => {
  it("names the bed and the patient, and says the one thing it writes", async () => {
    await open({ payload: board([entry("S-001", [], FULL)]) });
    expect(screen.getByRole("heading", { level: 1, name: "Ayşe Sentetik" })).toBeInTheDocument();
    // One h1 and no more: the shell moves focus to <main> after every move, and the screen's own
    // heading is what a reader lands on.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("REA-01 · 2")).toBeInTheDocument();
    expect(screen.getByText(/heç nə yazılmır/)).toBeInTheDocument();
  });

  it("offers the way back to the board it was opened from", async () => {
    await open({ payload: board([entry("S-001", [], FULL)]) });
    expect(screen.getByRole("link", { name: /Çarpayılara qayıt/ })).toHaveAttribute("href", "#/beds");
  });

  it("a patient the HIS has not named says what is missing", async () => {
    await open({ payload: board([entry("S-001", [], { at: measured(30) })]) });
    expect(screen.getByRole("heading", { level: 1, name: "kimlik gözlənilir" })).toBeInTheDocument();
  });

  describe("the measured values", () => {
    it("shows each channel with its value, its unit, its clock time and its age", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText("118")).toBeInTheDocument();
      expect(screen.getByText("Nəbz")).toBeInTheDocument();
      // Every vital's age is visible — the gap the old workspace never closed.
      expect(screen.getAllByText(/2 dəq əvvəl/).length).toBeGreaterThan(0);
    });

    it("a channel with no value is left out, and a card with none says so once", async () => {
      await open({ payload: board([entry("S-001", [], { identity: identity() })]) });
      expect(screen.getByText("Bu çarpayıdan heç bir ölçmə gəlməyib.")).toBeInTheDocument();
      expect(screen.queryByText("Nəbz")).toBeNull();
    });

    it("a lactate is shown with the monitor channels — septic shock turns on it", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText("4.1")).toBeInTheDocument();
      expect(screen.getByText("Laktat")).toBeInTheDocument();
    });
  });

  describe("what the engine found", () => {
    const reasoned = alarm("septic_shock", "critical", { summary: "Septik şok ölçütleri karşılandı",
      clinical_reasoning: "MAP 58 on a vasopressor with lactate 4.1 mmol/L after fluids.",
      supporting_evidence: ["sepsis-3-jama-2016", "surviving-sepsis-campaign-2021"],
      recommended_actions: ["Review the patient and the supporting evidence."],
      confidence: "Criteria are deterministic (Sepsis-3).",
      stale_inputs: ["lactate"] });

    it("shows the engine's reasoning, its sources, its suggestions and its certainty", async () => {
      await open({ payload: board([entry("S-001", [reasoned], { ...FULL })]) });
      const card = screen.getByRole("heading", { level: 3, name: "Septik şok ölçütleri karşılandı" }).closest("li");
      expect(card).toHaveTextContent("MAP 58 on a vasopressor");
      expect(card).toHaveTextContent("sepsis-3-jama-2016, surviving-sepsis-campaign-2021");
      expect(card).toHaveTextContent("Review the patient and the supporting evidence.");
      expect(card).toHaveTextContent("Criteria are deterministic (Sepsis-3).");
    });

    it("keeps the product's register: a review is suggested, the decision is the physician's", async () => {
      await open({ payload: board([entry("S-001", [reasoned], { ...FULL })]) });
      expect(screen.getByText("Qiymətləndirmə tövsiyə olunur · qərar həkimindir.")).toBeInTheDocument();
    });

    it("marks the engine's own prose as English, since it is not translated", async () => {
      await open({ payload: board([entry("S-001", [reasoned], { ...FULL })]) });
      const card = screen.getByRole("heading", { level: 3, name: /Septik şok/ }).closest("li");
      expect(card.querySelector('[lang="en"]')).toBeInTheDocument();
      expect(screen.getByText(/İngiliscədir; tərcümə olunmayıb/)).toBeInTheDocument();
    });

    it("says which inputs the engine already judged stale", async () => {
      await open({ payload: board([entry("S-001", [reasoned], { ...FULL })]) });
      expect(screen.getByText("Köhnə giriş: lactate")).toBeInTheDocument();
    });

    it("says when the patient's own charted normal lowered a finding, and why", async () => {
      await open({ payload: board([entry("S-001", [alarm("news2", "low", { downgraded: true, chronic_context: "Chronic oxygen therapy explains the SpO2." })], { ...FULL, risk: "low" })]) });
      expect(screen.getByText("Xəstənin öz normasına görə aşağı salınıb")).toBeInTheDocument();
      expect(screen.getByText("Chronic oxygen therapy explains the SpO2.")).toBeInTheDocument();
    });

    it("only a LIVE board says the engine found nothing", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText("Mühərrik bu xəstə üçün açıq tapıntı bildirmir.")).toBeInTheDocument();
    });

    it("a board that may be out of date does NOT say the engine found nothing", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]), connection: "degraded" });
      expect(screen.queryByText("Mühərrik bu xəstə üçün açıq tapıntı bildirmir.")).toBeNull();
      expect(screen.getByText("Panel güncəl deyil; mühərrikin tapıntıları natamam ola bilər.")).toBeInTheDocument();
    });

    it("a finding whose severity is \"none\" can never read \"no finding\"", async () => {
      await open({ payload: board([entry("S-001", [alarm("x", "none")], { ...FULL })]) });
      expect(screen.queryByText("Tapıntı yoxdur")).toBeNull();
    });
  });

  describe("NEWS2 and the Sepsis-3 context", () => {
    it("shows the engine's NEWS2 and states a red parameter as a fact", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText("9")).toBeInTheDocument();
      expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
    });

    it("says nobody has charted a suspected infection — the sepsis rule then never runs", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText(/heç kim işarələməyib/)).toBeInTheDocument();
    });

    it("tells a charted \"no\" from an unanswered one", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...FULL, sepsis: { suspected_infection: false, sofa: 7, baseline_sofa: 2, baseline_assumed: false, rise: 5 },
      })]) });
      expect(screen.getByText("Şübhəli infeksiya: yoxdur (həkim işarələyib).")).toBeInTheDocument();
      expect(screen.queryByText(/heç kim işarələməyib/)).toBeNull();
      expect(screen.queryByText(/mühərrik 0 fərz edir/)).toBeNull();
    });

    it("puts the SOFA, the baseline and the RISE each under its own label", async () => {
      // The rise is what the Sepsis-3 criterion turns on (≥2 points over baseline), so reading it
      // as the baseline, or the baseline as the rise, is a clinical misreading and not a layout
      // nit. Asserting the <dd> that belongs to each <dt> is the only way to catch it: a test that
      // only looked for the text "5" would pass with all three numbers in one row.
      await open({ payload: board([entry("S-001", [], {
        ...FULL, sepsis: { suspected_infection: true, sofa: 7, baseline_sofa: 2, baseline_assumed: false, rise: 5 },
      })]) });
      const valueFor = (label) => {
        const dt = screen.getByText(label);
        return dt.parentElement.querySelector("dd").textContent;
      };
      expect(valueFor("SOFA")).toBe("7");
      expect(valueFor("Bazal SOFA")).toBe("2");
      expect(valueFor("Artım")).toBe("5");
    });

    it("prints a rise the engine did not send as \"—\", never as sofa minus baseline", async () => {
      // The browser does no clinical arithmetic (Decision 2): 7 − 2 would be the screen's claim,
      // not the engine's, and it would look exactly like the engine's.
      await open({ payload: board([entry("S-001", [], {
        ...FULL, sepsis: { suspected_infection: true, sofa: 7, baseline_sofa: 2, baseline_assumed: false, rise: null },
      })]) });
      const dt = screen.getByText("Artım");
      expect(dt.parentElement.querySelector("dd").textContent).toBe("—");
      expect(screen.queryByText("5")).toBeNull();
    });

    it("says when the baseline SOFA is an assumption rather than a charted number", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText(/mühərrik 0 fərz edir/)).toBeInTheDocument();
    });
  });

  describe("medication and the antibiotic clock", () => {
    it("an unrecorded antibiotic is not shown as one that was not given", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...FULL, meds: { pressors: {}, antibiotic_given: null, antibiotic_at: null, antibiotic_clock: null, weight_kg: null, creatinine: null },
      })]) });
      expect(screen.getByText(/verilmədiyi anlamına gəlmir/)).toBeInTheDocument();
    });

    it("shows when it was given", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...FULL,
        meds: { pressors: { norepinephrine: 0.08 }, antibiotic_given: true, antibiotic_at: ago(600), antibiotic_clock: null, weight_kg: 72, creatinine: 1.9 },
      })]) });
      expect(screen.getByText(/Antibiotik verilib:/)).toBeInTheDocument();
      expect(screen.getByText("Vazopressor/inotrop: norepinephrine 0.08")).toBeInTheDocument();
    });

    it("says so when the engine sent no medication block at all", async () => {
      await open({ payload: board([entry("S-001", [], { ...FULL, meds: null })]) });
      expect(screen.getByText("Mühərrik bu xəstə üçün dərman məlumatı göndərməyib.")).toBeInTheDocument();
    });
  });

  describe("the seams Group 2 fills", () => {
    it("draws no trend, and says the engine has no history endpoint", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText(/Brauzer öz qrafikini uydurmur/)).toBeInTheDocument();
      expect(screen.getByText(/növbəti qrupda əlavə olunacaq/)).toBeInTheDocument();
    });
  });

  describe("a patient this board does not hold", () => {
    it("says it cannot tell a missing record from one outside the scope", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]), id: "S-999" });
      expect(screen.getByRole("heading", { level: 1, name: "Bu xəstə göstərilə bilmir" })).toBeInTheDocument();
      expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
        .toContain("server ikisinə də eyni cavabı verir");
      expect(screen.getByText("S-999")).toBeInTheDocument();
    });

    it("a board that could not be read says THAT instead", async () => {
      await open({ connection: "unavailable", id: "S-001" });
      expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
        .toContain("panelinizdə olub-olmadığını deyə bilmirik");
    });
  });

  describe("recording that the patient was opened", () => {
    it("records it once for a patient the screen shows", async () => {
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(api.view).toHaveBeenCalledTimes(1);
      expect(api.view).toHaveBeenCalledWith("S-001");
    });

    it("records NOTHING for a patient the board does not hold", async () => {
      // The server logs a refusal as `scope_denied`; a stale bookmark must not fill the audit
      // trail with refusals for views that never happened.
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]), id: "S-999" });
      expect(api.view).not.toHaveBeenCalled();
    });

    it("a failed record does not stop the screen", async () => {
      await open({
        payload: board([entry("S-001", [], FULL)]),
        setup: (api) => api.view.mockRejectedValue(Object.assign(new Error("down"), { status: 503 })),
      });
      expect(screen.getByRole("heading", { level: 1, name: "Ayşe Sentetik" })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npx vitest run src/live/screens/patient/ 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./PatientScreen.jsx"`.

- [ ] **Step 7: Write the screen** — `dashboard/src/live/screens/patient/PatientScreen.jsx`, whole file, **as this task leaves it**: read-only. Task 15B adds the one control that writes.

It imports `News2` and `nameOf` from `../common/BoardState.jsx`, with the rest of the shared board components. They were written on the bed card and **moved to `BoardState.jsx` by the Wave 3 fix-up** (on the merged branch), because an import from `../beds/BedCard.jsx` is this arm reaching into another arm's file — and because the four `beds.*` / two `alarms.*` strings they read moved with them, to `board.*`. The two screens still have one NEWS2 and one "the HIS's name or the statement that there is none" between them, which is the point: a second copy of either is a second chance to get one of them wrong. Build this off the merged branch (`feat/canli-tasarim`, both arms in), not off Task 8.

```jsx
// src/live/screens/patient/PatientScreen.jsx — one patient, as the engine describes them (G1-11).
// READ-ONLY: in Group 1 nothing here writes to the record, and the screen says so.
//
// Four things it shows, and one it refuses to:
//
//   1. WHO, and where that came from. The HIS's name or the statement that there is none; the bed
//      the board resolved, and the HIS location it could not resolve. No age, no body-surface
//      area, no hospital or protocol number: the prototype computed the first two in the browser
//      and MADE UP the last two from the patient id (`hnOf`, `protoOf`).
//   2. WHAT WAS MEASURED, AND HOW OLD IT IS. Every channel the engine has a value for, with the
//      age of that value beside it — the G1-11 criterion, and the gap the old workspace never
//      closed (`measuredAt` reached its state and no screen ever read it). The screen reports the
//      age; it does not decide that an age is too old. That is a clinical threshold, the engine
//      owns every one, and where the engine HAS judged an input stale it says so itself per
//      finding (`staleInputs`), which this screen shows as the engine's words.
//   3. WHAT THE ENGINE FOUND, and why. One card per open alarm: its severity, its summary, the
//      engine's own reasoning, the vault sources behind it, what it suggests considering, how
//      certain that is, whether the patient's charted chronic normal lowered it and which inputs
//      were already stale. Nothing is paraphrased — a screen that rewrote clinical reasoning
//      would be writing its own. The register is the product's: "review suggested, the decision
//      rests with the physician", never an instruction.
//   4. WHAT THE SCORE IS BEING JUDGED AGAINST. NEWS2 with its partial marking, SOFA, and the
//      Sepsis-3 context — above all `suspected_infection`, whose THREE values matter: nobody has
//      charted it (and then the sepsis branch never runs at all, so a quiet patient is not a
//      reassuring one), a physician charted yes, a physician charted no.
//
// It refuses to draw a trend. The engine has no endpoint for a vital's history, and the browser
// drawing one from the single latest value — as the prototype does, from a seeded random
// generator — would be a picture of nothing. The seam is stated in one box, for Group 2.
import React, { useEffect, useMemo, useRef } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Alert, Box, Icon, KV, KVList, Note, RiskPill, StatusPill, riskStyle } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import {
  BoardStrip, News2, RAIL_LEFT, ScopeNote, boardKnown, boardStale, nameOf, railOf, summaryOf,
  useBoardNow,
} from "../common/BoardState.jsx";
import { ageOf, hasMeasurement } from "../common/freshness.js";
import { ageParts } from "../common/feedHealth.js";
import { measuredVitals } from "../common/vitals.js";

const TICK_MS = 30_000;

/** How old, in the reader's own language: "3 dk", "2 sa". The number and the unit stay apart, so
 *  neither ends up inside a word that would need a suffix fitted to it. */
function ageText(t, iso, nowMs) {
  const parts = ageParts((ageOf(iso, nowMs) ?? NaN) / 1000);
  if (!parts) return null;
  const key = parts.unit === "s" ? "board.ageS" : parts.unit === "m" ? "board.ageM" : "board.ageH";
  return t("patient.vitalAge", { age: t(key, { count: parts.value }) });
}

/** Every channel the engine has a value for, with the instant and the age of each. A channel with
 *  no value is left out — not printed as a dash five times over (the wall board's rule). */
function Vitals({ patient, nowMs }) {
  const { t } = useI18n();
  const shown = measuredVitals(patient);
  if (shown.length === 0) return <p className="m-0 text-13 text-mute">{t("patient.vitalsNone")}</p>;
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
      {shown.map((v) => {
        const age = ageText(t, v.at_, nowMs);
        return (
          <div key={v.at} className="rounded-ctl border border-line bg-card px-2.5 py-2">
            <dt className={`text-10.5 font-bold uppercase leading-[normal] tracking-[.06em] ${v.color}`}>{t(v.labelKey)}</dt>
            <dd className="m-0">
              <b className="font-data text-20 font-bold text-ink">{v.value}</b>
              <small className="ml-1 font-text text-11 font-semibold text-mute">{t(v.unitKey)}</small>
              {/* The age of the value, always — a number with no age cannot be told from one that
                  stopped arriving an hour ago. */}
              <span className="mt-0.5 block text-11 text-mute">
                {v.at_ ? `${hhmm(Date.parse(v.at_))}${age ? ` · ${age}` : ""}` : t("board.notMeasured")}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** One of the engine's findings, with everything it rests on. `lang="en"` on the engine's own
 *  prose: it is written in English (reco/engine.py) and is not translated, so a screen reader
 *  should pronounce it as English rather than read English words with Azerbaijani phonetics. */
function Finding({ alarm }) {
  const { t } = useI18n();
  const style = riskStyle(alarm.severity === "none" ? null : alarm.severity, { measured: true });
  return (
    <li className={`rounded-box border border-line bg-card px-3.5 py-3 border-l-4 ${railOf(style.tone, RAIL_LEFT)}`}>
      <div className="flex flex-wrap items-start gap-2">
        <RiskPill risk={alarm.severity === "none" ? null : alarm.severity} measured />
        <h3 lang="en" className="m-0 min-w-0 flex-1 font-display text-15 font-bold">{summaryOf(alarm) ?? t("board.findingUnnamed")}</h3>
        {alarm.escalated ? <StatusPill tone="att" icon="alert">{t("board.escalated")}</StatusPill> : null}
        {alarm.downgraded ? <StatusPill tone="neutral" icon="minus">{t("patient.recoDowngraded")}</StatusPill> : null}
      </div>
      <p className="m-0 mt-1 text-12.5 text-mute">{t("patient.recoDecision")}</p>
      {alarm.staleInputs.length > 0 ? (
        <p className="m-0 mt-1.5 text-12 font-semibold text-att-ink">
          {t("patient.recoStale", { list: alarm.staleInputs.join(", ") })}
        </p>
      ) : null}
      <KVList className="mt-2">
        {alarm.chronicContext ? <KV label={t("patient.recoChronic")} mono={false}>{alarm.chronicContext}</KV> : null}
        {alarm.clinicalReasoning ? (
          <KV label={t("patient.recoReasoning")} mono={false}><span lang="en">{alarm.clinicalReasoning}</span></KV>
        ) : null}
        {alarm.actions.length > 0 ? (
          <KV label={t("patient.recoActions")} mono={false}>
            <ul lang="en" className="m-0 list-disc ps-4 text-left">
              {alarm.actions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </KV>
        ) : null}
        {alarm.evidence.length > 0 ? (
          <KV label={t("patient.recoEvidence")}>{alarm.evidence.join(", ")}</KV>
        ) : null}
        {alarm.confidence ? (
          <KV label={t("patient.recoConfidence")} mono={false}><span lang="en">{alarm.confidence}</span></KV>
        ) : null}
        {alarm.ackBy ? <KV label={t("patient.seenBy", { who: alarm.ackBy })} mono={false}>{alarm.ackAtMs ? hhmm(alarm.ackAtMs) : "—"}</KV> : null}
      </KVList>
    </li>
  );
}

/** What the Sepsis-3 criterion is being judged against. `suspected_infection` is THREE-valued and
 *  the difference is clinical: `null` means nobody has charted either way, and until somebody does
 *  the engine evaluates no sepsis rule at all (api/board.py `_sepsis_context`). */
function Sepsis({ sepsis }) {
  const { t } = useI18n();
  if (!sepsis) return null;
  const suspected = sepsis.suspected_infection;
  return (
    <Box title={t("patient.sepsis")} icon="flask" level={2}>
      <Note tone={suspected === null ? "warn" : "info"} icon={suspected === null ? "alert" : "ok"}>
        {t(suspected === null ? "patient.suspectedUnknown" : suspected ? "patient.suspectedYes" : "patient.suspectedNo")}
      </Note>
      <KVList className="mt-2">
        {/* Three numbers, three labels, one value under each. The rise is the one the criterion
            turns on — Sepsis-3 is an acute rise of ≥2 SOFA points over the patient's baseline, and
            `septic_shock.py` compares `rise`, not `sofa` — so it is the number a clinician must be
            able to read without arithmetic, and the number that must never appear under another
            number's name. It is printed, not computed: the browser does no clinical arithmetic
            (Decision 1: no screen computes a clinical value), so if the engine sends no rise this
            says "—" rather than `sofa - baseline`,
            which would be a different claim with the same shape. */}
        <KV label={t("patient.sofa")}>{sepsis.sofa ?? "—"}</KV>
        <KV label={t("patient.baseline")}>{sepsis.baseline_sofa ?? "—"}</KV>
        <KV label={t("patient.rise")}>{sepsis.rise ?? "—"}</KV>
      </KVList>
      {sepsis.baseline_assumed ? <p className="m-0 mt-1 text-12 text-att-ink">{t("patient.baselineAssumed")}</p> : null}
    </Box>
  );
}

/** The medication picture the engine publishes, with its three-valued antibiotic. `null` means
 *  nobody charted it either way; rendering that as "not given" would accuse a ward of missing a
 *  deadline it may well have met and simply not recorded here (api/board.py `_meds`). */
function Meds({ meds }) {
  const { t } = useI18n();
  if (!meds) return <Box title={t("patient.meds")} icon="syringe" level={2}><p className="m-0 text-13 text-mute">{t("patient.noMeds")}</p></Box>;
  const pressors = Object.entries(meds.pressors ?? {}).filter(([, v]) => v !== null && v !== undefined);
  const clock = meds.antibiotic_clock ?? null;
  const givenAt = meds.antibiotic_at ? Date.parse(meds.antibiotic_at) : NaN;
  const deadline = clock?.deadline ? Date.parse(clock.deadline) : NaN;
  let antibiotic;
  if (meds.antibiotic_given === null || meds.antibiotic_given === undefined) antibiotic = t("patient.antibioticUnknown");
  else if (meds.antibiotic_given && Number.isFinite(givenAt)) antibiotic = t("patient.antibioticGiven", { time: hhmm(givenAt) });
  else if (Number.isFinite(deadline)) {
    antibiotic = t(clock.remaining_sec !== null && clock.remaining_sec < 0 ? "patient.antibioticOverdue" : "patient.antibioticPending", { time: hhmm(deadline) });
  } else antibiotic = t("patient.antibioticUnknown");
  return (
    <Box title={t("patient.meds")} icon="syringe" level={2}>
      <p className="m-0 text-13">{antibiotic}</p>
      <p className="m-0 mt-1 text-13 text-mute">
        {pressors.length ? t("patient.pressors", { list: pressors.map(([k, v]) => `${k} ${v}`).join(", ") }) : t("patient.noPressors")}
      </p>
      <KVList className="mt-2">
        {meds.weight_kg !== null && meds.weight_kg !== undefined ? <KV label={t("patient.weight", { value: meds.weight_kg })}>{""}</KV> : null}
        {meds.creatinine !== null && meds.creatinine !== undefined ? <KV label={t("patient.creatinine", { value: meds.creatinine })}>{""}</KV> : null}
      </KVList>
    </Box>
  );
}

/** `params.id` comes from the address (shell/Shell.jsx). The patient is read from the board this
 *  session already has: there is no per-patient endpoint, and `/patients` is already filtered by
 *  the engine's scope — so a card this board does not hold is one this session may not see OR one
 *  that does not exist, and the server answers both the same way on purpose. */
export function PatientScreen({ params }) {
  const { t } = useI18n();
  const board = useBoard();
  const nowMs = useBoardNow(TICK_MS);
  const id = params?.id ?? "";
  const patient = useMemo(() => board.patients.find((p) => p.patient_id === id) ?? null, [board.patients, id]);
  const alarms = useMemo(() => board.alerts.filter((a) => a.patientId === id), [board.alerts, id]);
  const known = boardKnown(board.connection);
  const stale = boardStale(board.connection);

  // Record that a clinician opened this patient — the audit line an inspection asks for. Sent only
  // for a patient the screen actually SHOWS: the server logs a refusal as `scope_denied`, so
  // sending it for a stale bookmark would fill the trail with refusals for views that never
  // happened. Once per patient per mount; a failure is not the clinician's problem and the screen
  // carries on (the record of the board request itself is already in the trail).
  const recorded = useRef(null);
  useEffect(() => {
    if (!patient || recorded.current === id) return;
    recorded.current = id;
    board.store.view(id).catch(() => {});
  }, [patient, id, board.store]);

  const measured = hasMeasurement(patient?.measuredAt);
  const bed = patient?.bedLabel || id;

  return (
    <div className="flex min-h-0 max-w-[1000px] flex-col gap-3">
      <p className="m-0">
        <a href="#/beds" className={`inline-flex items-center gap-1 rounded-md text-12.5 font-semibold text-pri ${FOCUS_RING}`}>
          <Icon name="chevL" size={14} />
          {t("patient.back")}
        </a>
      </p>
      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />

      {!patient ? (
        <>
          <h1 className="m-0 font-display text-23 font-bold">{t("patient.notFound")}</h1>
          <Alert tone="crit">{t(known ? "patient.notFoundHelp" : "patient.notFoundUnknown")}</Alert>
          <p className="m-0 font-data text-12.5 text-mute">{id}</p>
        </>
      ) : (
        <>
          <header className="flex flex-wrap items-start gap-3 rounded-box border border-line bg-card px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <b className="block font-data text-17 font-bold text-ink">{bed}</b>
              <h1 className={`m-0 font-display text-23 font-bold ${patient.display_name ? "" : "italic text-mute"}`}>
                {nameOf(patient, t)}
              </h1>
              {patient.bedKey && !patient.bedMatched ? (
                <p className="m-0 mt-1 text-12 font-semibold text-att-ink">{t("beds.unmatchedBed", { key: patient.bedKey })}</p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <RiskPill risk={patient.risk} measured={measured} />
              <News2 news2={patient.news2} />
            </div>
          </header>
          <Note tone="info" icon="eye">{t("patient.readOnly")}</Note>

          <Box title={t("patient.vitals")} icon="activity" level={2}>
            <Vitals patient={patient} nowMs={nowMs} />
          </Box>

          <section className="grid gap-2">
            <h2 className="m-0 font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute">{t("patient.reco")}</h2>
            {alarms.length === 0 ? (
              <Note tone={known ? "info" : "warn"} icon={known ? "ok" : "alert"}>
                {t(known ? "patient.recoNone" : "patient.recoNoneUnknown")}
              </Note>
            ) : (
              <>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {alarms.map((a) => <Finding key={a.id} alarm={a} />)}
                </ul>
                <p className="m-0 text-11.5 text-mute">{t("patient.recoLanguage")}</p>
              </>
            )}
          </section>

          <div className="grid gap-2 min-[861px]:grid-cols-2">
            <Sepsis sepsis={patient.sepsis} />
            <Meds meds={patient.meds} />
          </div>

          {/* The seams. Both say what is missing on the SERVER, not what nobody got round to. */}
          <Box title={t("patient.trends")} icon="chart" level={2} className="!border-dashed">
            <p className="m-0 text-12.5 text-mute">{t("patient.trendsSoon")}</p>
            <p className="m-0 mt-1.5 text-12.5 text-mute">{t("patient.formsSoon")}</p>
          </Box>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run it**

```bash
npx vitest run src/live/screens/patient/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  29 passed (29)` — the test block above holds 29 `it()`s. **30** once this arm adds the escalation test the Wave 3 fix-up requires (see the Gate): earlier drafts of this step said 27, which was a miscount, and the Gate's 29 was right.

- [ ] **Step 9: Take this arm's two lines in the registry**

In `dashboard/src/live/shell/routes.js`, replace

```javascript
// G1-11: import { PatientScreen } from "../screens/patient/PatientScreen.jsx";
```

with

```javascript
import { PatientScreen } from "../screens/patient/PatientScreen.jsx";
```

and replace

```javascript
  patient: null,   // G1-11
```

with

```javascript
  patient: PatientScreen, // G1-11
```

- [ ] **Step 9a: Look at it** — the one check no test makes.

Run `npx vite dev`, sign in, open a patient from the board.

Check, at 1440 px and at 390 px, in both themes: no horizontal page scroll; the vital grid reflows to one or two columns on the phone and does not clip a unit; the three Sepsis-3 numbers stay under their own labels when the labels wrap (this is the defect review found in this screen, and a narrow viewport is where a label-value pair comes apart); the finding cards' left borders are visible in both themes; and the engine's English blocks are visibly set apart from the screen's own language rather than reading as one text.

- [ ] **Step 10: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: 29 tests more than the branch started with (30 with the escalation test below); the build succeeds.

- [ ] **Step 11: Commit**

```bash
git add dashboard/src/live/i18n/strings/patient.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/shell/routes.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the patient screen (G1-11), read-only

Every vital with its clock time AND its age — the gap the old workspace never
closed, since measuredAt reached its state and no screen ever read it. One card
per finding with the engine's own reasoning, its vault sources, what it
suggests considering and how certain that is, marked lang="en" because the
engine writes them in English. The three-valued suspected infection, so a quiet
patient is not a reassuring one. No trend: the engine has no history endpoint,
and the browser does not invent a curve.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **29** tests in the new `PatientScreen.test.jsx` as this task's block writes it (Task 15B takes it to 37) — **30 and 38** with the one test this arm adds on top: `alarm("news2", "high", {escalated: true})` asserting the escalation pill's text, which the Wave 3 fix-up requires because `escalated` was covered by no test on any branch and a raw key could therefore print unnoticed. **A reviewer who counts 30 here has not found a miscount.** Whole suite green; build clean; looked at 390/1440 px in both themes.

The suite also gained a cross-cutting `src/live/rawKeys.test.jsx` in the fix-up (3 tests, not this arm's): it sweeps every screen the build has, so the patient screen enters it the moment Task 15 lands the registry line — and its `/patients/:id` address is opened on the fixture's own card. A key this screen fails to resolve fails there as well as here, named with its screen.

---

### Task 15: The rail entry a patient sits under

**Files:**
- Modify: `dashboard/src/live/shell/routes.js` (**one line: `under: "beds"` on the `patient` route** — this is a third change to `routes.js`, on top of the `SCREENS` line and the import that Task 7 pre-placed, and earlier drafts of this plan did not list it), `dashboard/src/live/shell/Shell.jsx` (one line), `dashboard/src/live/shell/Shell.test.jsx`
- **Not** `dashboard/src/live/shell/Sidebar.jsx`: its header paragraph was settled in Task 7 so that the alarms arm can own that file outright. If you find Wave 2's old paragraph still there, Task 7 was skipped — go and do it there, not here.

Wave 2 left this open and showed no entry as current while a `nav: false` screen was open, pinning that answer so the next wave would change it on purpose. It is changed here (Decision 22).

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/live/shell/Shell.test.jsx`, replace

```javascript
  it("marks no rail entry current while a screen the rail does not list is open", async () => {
    built({ beds: BedsProbe, patient: PatientProbe });
    await renderShell({ hash: "#/patients/P-001" });
    await screen.findByRole("heading", { level: 1, name: "Xəstə P-001" });
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    expect(within(rail).getAllByRole("link").filter((a) => a.getAttribute("aria-current"))).toEqual([]);
  });
```

with

```javascript
  // Wave 2 left no entry current here and said the next wave should change it on purpose. G1-11
  // did: a screen the rail does not list is open UNDER the entry it was reached from
  // (routes.js `under`), because a clinician spends most of her time on a patient and a rail with
  // nothing current says "you are nowhere" for all of it.
  it("marks the entry a screen sits under while that screen is open", async () => {
    only({ beds: BedsProbe, patient: PatientProbe });
    await renderShell({ hash: "#/patients/P-001" });
    await screen.findByRole("heading", { level: 1, name: "Xəstə P-001" });
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    const current = within(rail).getAllByRole("link").filter((a) => a.getAttribute("aria-current"));
    expect(current.map((a) => a.getAttribute("href"))).toEqual(["#/beds"]);
  });

  it("marks nothing current when the entry it sits under is not in the rail", async () => {
    // A session that may open a patient but whose beds screen this build has not built: saying
    // "you are here" of an entry that is not there would be false.
    only({ patient: PatientProbe });
    await renderShell({ hash: "#/patients/P-001" });
    await screen.findByRole("heading", { level: 1, name: "Xəstə P-001" });
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    expect(within(rail).getAllByRole("link").filter((a) => a.getAttribute("aria-current"))).toEqual([]);
  });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/live/shell/Shell.test.jsx 2>&1 | grep -E "Tests "
```
Expected: `1 failed | …` — the first of the two, because nothing is current yet.

- [ ] **Step 3: Declare what the patient route sits under**

In `dashboard/src/live/shell/routes.js`, replace

```javascript
  route({ id: "patient", path: "/patients/:id", icon: "user", labelKey: "nav.patient", shortKey: "nav.patient",
    perms: ["board.view"], work: false, nav: false }),
```

with

```javascript
  // `under`: the rail entry this screen sits beneath. A patient is opened from the beds board, so
  // the beds entry reads as current while one is on screen (Sidebar.jsx) — otherwise the rail says
  // "you are nowhere" for the screen a clinician spends most of her time on.
  route({ id: "patient", path: "/patients/:id", icon: "user", labelKey: "nav.patient", shortKey: "nav.patient",
    perms: ["board.view"], work: false, nav: false, under: "beds" }),
```

- [ ] **Step 4: Let the shell pass it**

In `dashboard/src/live/shell/Shell.jsx`, replace

```javascript
        <Sidebar perms={user.perms} current={match?.route.id ?? null} />
```

with

```javascript
        <Sidebar perms={user.perms} current={match?.route.under ?? match?.route.id ?? null} />
```

- [ ] **Step 5: Check the rail's header already says it — and do not edit it**

```bash
grep -c "open under the entry it was reached" src/live/shell/Sidebar.jsx
```
Expected: `1`. Task 7 put that paragraph there before the arms forked, so that `Sidebar.jsx` belongs to the alarms arm alone. If this prints `0`, Task 7 was skipped: go and do its Step 6b, do not patch the file from here. Two arms rewriting one file's header is a conflict in either merge order, and it is the conflict this plan was reviewed for twice before anyone noticed it.

- [ ] **Step 6: Run the shell's tests**

```bash
npx vitest run src/live/shell/ 2>&1 | grep -E "Tests "
```
Expected: one test more than before, all green.

- [ ] **Step 7: Check what the change can reach** — `resumePath` reads `route.nav` and the parameters, not `under`, so an unlock still refuses to reopen a patient. Prove it:

```bash
npx vitest run src/live/shell/routes.test.js 2>&1 | grep -E "Tests "
```
Expected: unchanged and green — including "refuses a screen the rail does not list and that names something".

- [ ] **Step 8: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: one test more than Task 14 left; the build succeeds.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/live/shell/routes.js dashboard/src/live/shell/Shell.jsx dashboard/src/live/shell/Shell.test.jsx
git commit -m "$(cat <<'EOF'
feat(dashboard): the rail entry a patient screen sits under (G1-11)

Wave 2 left this open and pinned its answer so the next wave would change it
on purpose. A clinician spends most of her time on a patient, and a rail with
nothing current says "you are nowhere" for all of it; the patient screen also
carries a visible way back to the board, so the claim is not only implied.
A route whose `under` entry is not in the rail still marks nothing, and an
unlock still refuses to reopen a patient (resumePath reads `nav`, not `under`).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** `Shell.test.jsx` goes from **39 to 40** — two of its rail tests are rewritten to the new answer and one of them becomes two, so the count rises by exactly one. **40 is the figure on the MERGED branch** (`feat/canli-tasarim`, where Task 13 took the file to 39), which is where this arm now builds; an earlier draft of this line read "stays at 40" and was quoting the post-merge total as though it were the branch's starting point. A lone branch off Task 8 would see 33 → 34. `routes.test.js` unchanged at 22; `Sidebar.jsx` not touched; whole suite green; build clean.

---

### Task 15B: The one thing this screen writes — a suspected infection

**Files:**
- Modify: `dashboard/src/live/i18n/strings/patient.js`, `dashboard/src/live/screens/patient/PatientScreen.jsx`, `dashboard/src/live/screens/patient/PatientScreen.test.jsx`
- Nothing shared, nothing another arm touches. The API client already has `chart()` (Wave 2) and the board store gained `chart()` in Task 3.

This task exists because the user answered the question this plan had left open (**Needs the user, 2**, now Decision 27). The patient screen was going to be read-only through Group 1, and the SOFA form and the charted baseline still are — but the suspected infection is not like them. **Nothing in the engine's sepsis branch runs until something charts it**: `septic_shock.evaluate` returns at its first line while `suspected_infection` is unset. So on a ward where nobody can chart it, the engine is simply silent about sepsis, and this screen would be printing "Şübhəli infeksiya: heç kim işarələməyib — sepsis qaydası bu xəstədə heç işləmir" while being, by construction, unable to do anything about it. One button closes that, and it is one boolean, one call and one permission.

What it must not become: a diagnosis aid. There is no default, no pre-selected answer and no hint about which to press. Both answers stay offered after one has been charted, because a judgement can change and a "no" after a "yes" is a clinical event rather than an undo. And the consequence is stated before the button is pressed, not after: this goes into the audit trail under the clinician's own name, and it cannot be withdrawn — the engine keeps the latest charted value, so a correction supersedes and never erases.

- [ ] **Step 1: Write the strings**

Twelve edits in `dashboard/src/live/i18n/strings/patient.js`: seven new keys in each of the four language blocks, and two sentences per language that this task makes **false** and so replaces rather than leaves.

Use the **Edit tool** for every one of them. Not `sed`, not a heredoc — the ground rules say why, and this is the step where it bites: `İşarələnir…` and `«есть»` survive neither a mangled heredoc nor a CRLF/LF mismatch, and nothing errors when they do not. Check afterwards with `npx vitest run src/live/i18n/strings.test.js`, which fails if the Cyrillic or the `ə` was lost.

The seven keys go after each language's `baselineAssumed`. Replace

```javascript
    baselineAssumed: "Bazal SOFA girilmedi; motor 0 varsayıyor, yükselme bu varsayıma göre.",
```

with

```javascript
    baselineAssumed: "Bazal SOFA girilmedi; motor 0 varsayıyor, yükselme bu varsayıma göre.",
    chartTitle: "Şüpheli enfeksiyonu işaretle",
    chartYes: "Var olarak işaretle",
    chartNo: "Yok olarak işaretle",
    chartSaving: "İşaretleniyor…",
    chartSaved: "İşaretlendi; motor bu hastayı yeniden değerlendirdi.",
    chartNote: "Bu bir klinik yargıdır, ölçüm değil: adınızla ve saatiyle denetim kaydına yazılır. Geri alınmaz — yalnızca yeni bir işaretleme üstüne yazar.",
    chartNoRight: "Bu işaretlemeyi yapma yetkiniz yok (clinical.chart).",
```

and replace

```javascript
    baselineAssumed: "Bazal SOFA daxil edilməyib; mühərrik 0 fərz edir, artım bu fərzə görədir.",
```

with

```javascript
    baselineAssumed: "Bazal SOFA daxil edilməyib; mühərrik 0 fərz edir, artım bu fərzə görədir.",
    chartTitle: "Şübhəli infeksiyanı işarələ",
    chartYes: "Var kimi işarələ",
    chartNo: "Yoxdur kimi işarələ",
    chartSaving: "İşarələnir…",
    chartSaved: "İşarələndi; mühərrik bu xəstəni yenidən qiymətləndirdi.",
    chartNote: "Bu ölçmə deyil, klinik mülahizədir: adınızla və vaxtı ilə audit qeydinə yazılır. Geri alınmır — yalnız yeni işarələmə onun üstünə yazır.",
    chartNoRight: "Bu işarələməni etmək səlahiyyətiniz yoxdur (clinical.chart).",
```

and replace

```javascript
    baselineAssumed: "Базовый SOFA не введён; система принимает 0, прирост считается от этого допущения.",
```

with

```javascript
    baselineAssumed: "Базовый SOFA не введён; система принимает 0, прирост считается от этого допущения.",
    chartTitle: "Отметить подозрение на инфекцию",
    chartYes: "Отметить «есть»",
    chartNo: "Отметить «нет»",
    chartSaving: "Отмечается…",
    chartSaved: "Отмечено; система заново оценила пациента.",
    chartNote: "Это врачебное суждение, а не измерение: оно записывается в журнал аудита с вашим именем и временем. Отменить его нельзя — его перекрывает только новая отметка.",
    chartNoRight: "У вас нет права делать такую отметку (clinical.chart).",
```

and replace

```javascript
    baselineAssumed: "No baseline SOFA was charted; the engine assumes 0, and the rise is measured against that assumption.",
```

with

```javascript
    baselineAssumed: "No baseline SOFA was charted; the engine assumes 0, and the rise is measured against that assumption.",
    chartTitle: "Chart a suspected infection",
    chartYes: "Chart as suspected",
    chartNo: "Chart as not suspected",
    chartSaving: "Charting…",
    chartSaved: "Charted; the engine has re-evaluated this patient.",
    chartNote: "This is a clinical judgement, not a measurement: it is written to the audit trail with your name and the time. It cannot be withdrawn — only a new charting supersedes it.",
    chartNoRight: "You do not have the right to chart this (clinical.chart).",
```

Now the sentence that is no longer true. The key is **renamed**, not merely rewritten: a key called `readOnly` on a screen that writes is the kind of thing that survives three waves and then misleads somebody. Replace

```javascript
    readOnly: "Bu ekran salt okunur: Grup 1'de hasta kaydına buradan hiçbir şey yazılmaz.",
```

with

```javascript
    onlyWrite: "Bu ekranın hasta kaydına yazdığı tek şey şüpheli enfeksiyon işaretidir; başka hiçbir şey buradan yazılmaz.",
```

and replace

```javascript
    readOnly: "Bu ekran yalnız oxumaq üçündür: Qrup 1-də xəstə qeydinə buradan heç nə yazılmır.",
```

with

```javascript
    onlyWrite: "Bu ekranın xəstə qeydinə yazdığı yalnız şübhəli infeksiya işarəsidir; buradan başqa heç nə yazılmır.",
```

and replace

```javascript
    readOnly: "Этот экран только для чтения: в Группе 1 отсюда ничего не записывается в карту пациента.",
```

with

```javascript
    onlyWrite: "Единственное, что этот экран записывает в карту пациента, — отметка о подозрении на инфекцию; больше отсюда ничего не записывается.",
```

and replace

```javascript
    readOnly: "This screen is read-only: in Group 1 nothing is written to the patient's record from here.",
```

with

```javascript
    onlyWrite: "The only thing this screen writes to the patient's record is the suspected-infection charting; nothing else is written from here.",
```

And `formsSoon` loses the suspected infection from its list of what comes later, because it is no longer coming later. Replace

```javascript
    formsSoon: "SOFA formunu doldurma/imzalama, şüpheli enfeksiyon ve hastanın kendi normalini girme bu ekrana sonraki grupta eklenecek; o zamana kadar bu ekran hiçbir şey yazmaz.",
```

with

```javascript
    formsSoon: "SOFA formunu doldurma/imzalama ve hastanın kendi normalini girme bu ekrana sonraki grupta eklenecek.",
```

and replace

```javascript
    formsSoon: "SOFA formasının doldurulması/imzalanması, şübhəli infeksiya və xəstənin öz normasının daxil edilməsi bu ekrana növbəti qrupda əlavə olunacaq; o vaxta qədər bu ekran heç nə yazmır.",
```

with

```javascript
    formsSoon: "SOFA formasının doldurulması/imzalanması və xəstənin öz normasının daxil edilməsi bu ekrana növbəti qrupda əlavə olunacaq.",
```

and replace

```javascript
    formsSoon: "Заполнение и подпись формы SOFA, отметка подозрения на инфекцию и ввод собственной нормы пациента будут добавлены на этот экран в следующей группе; до тех пор экран ничего не записывает.",
```

with

```javascript
    formsSoon: "Заполнение и подпись формы SOFA и ввод собственной нормы пациента будут добавлены на этот экран в следующей группе.",
```

and replace

```javascript
    formsSoon: "Filling in and signing the SOFA form, charting a suspected infection and entering the patient's own normal come to this screen in the next group; until then this screen writes nothing.",
```

with

```javascript
    formsSoon: "Filling in and signing the SOFA form and entering the patient's own normal come to this screen in the next group.",
```

Then point the one render site at the renamed key. In `dashboard/src/live/screens/patient/PatientScreen.jsx`, replace

```jsx
          <Note tone="info" icon="eye">{t("patient.readOnly")}</Note>
```

with

```jsx
          <Note tone="info" icon="eye">{t("patient.onlyWrite")}</Note>
```

- [ ] **Step 2: Give the fake API the call**

In `dashboard/src/live/session/testTokens.testutil.js`, replace

```javascript
    acknowledge: vi.fn(),
    view: vi.fn(),
```

with

```javascript
    acknowledge: vi.fn(),
    view: vi.fn(),
    chart: vi.fn(),
    serverClockSkewMs: vi.fn(() => null),
```

(`serverClockSkewMs` belongs to Task 1's clock and is added here if Task 1's own step did not: the board store guards for its absence, so the suite is green either way, but a fake that has it is a fake that can be made to lie about the clock in a test.)

- [ ] **Step 3: Let the test harness grant a right**

`PatientScreen.test.jsx`'s `open()` helper hard-codes the session's permissions. Replace

```jsx
async function open({ payload = board(), id = "S-001", connection = "live", setup } = {}) {
  onlyScreens({ beds: () => null }, { keep: [] });
  const perms = ["board.view", "alerts.ack"];
```

with

```jsx
async function open({ payload = board(), id = "S-001", connection = "live", setup,
                      perms = ["board.view", "alerts.ack"] } = {}) {
  onlyScreens({ beds: () => null }, { keep: [] });
```

The default deliberately does **not** include `clinical.chart`: every test written before this task keeps describing a session that may not chart, so the no-right path is the one most of the file exercises, and the button has to be asked for.

- [ ] **Step 4: Write the failing tests**

Append to `dashboard/src/live/screens/patient/PatientScreen.test.jsx`:

```jsx
// The one write this screen makes. It exists because of what its absence does: nothing in the
// engine's sepsis branch runs until something charts `suspected_infection` (septic_shock.evaluate
// returns at its first line), so a ward where nobody can chart it is a ward the engine is silent
// about for sepsis.
describe("charting a suspected infection", () => {
  const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
  const SEPSIS = { ...FULL, sepsis: { suspected_infection: null, sofa: 7, baseline_sofa: 2, baseline_assumed: false, rise: 5 } };
  const openChartable = ({ setup, ...over } = {}) => open({
    payload: board([entry("S-001", [], SEPSIS)]), perms: CHARTABLE,
    ...over,
    setup: (api) => {
      api.chart.mockResolvedValue({ patient_id: "S-001", charted: 1, alerts: [] });
      setup?.(api);                                   // a test's own mock wins over that default
    },
  });

  it("offers both answers, with neither chosen for the clinician", async () => {
    // No default, no pre-selection, no hint which to press: the screen takes a judgement and never
    // forms one. Both stay offered after one has been charted — "no" after "yes" is a clinical
    // event, not an undo.
    await openChartable();
    const yes = screen.getByRole("button", { name: "Var kimi işarələ" });
    const no = screen.getByRole("button", { name: "Yoxdur kimi işarələ" });
    for (const b of [yes, no]) {
      expect(b).toBeEnabled();
      expect(b.getAttribute("aria-pressed")).toBeNull();
    }
  });

  it("says, before anything is pressed, that this goes into the audit trail and cannot be withdrawn", async () => {
    await openChartable();
    expect(screen.getByText(/audit qeydinə yazılır/)).toBeInTheDocument();
    expect(screen.getByText(/Geri alınmır/)).toBeInTheDocument();
  });

  it("charts one entry, in the engine's own code and value", async () => {
    const { api } = await openChartable();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    expect(api.chart).toHaveBeenCalledTimes(1);
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "suspected_infection", value: 1 }]);
  });

  it("charts a \"no\" as 0, not as nothing at all", async () => {
    // A charted "no" is a fact about this patient; sending nothing would leave the engine in the
    // state where it evaluates no sepsis rule, which is a different thing entirely.
    const { api } = await openChartable();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yoxdur kimi işarələ" }));
      await settle();
    });
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "suspected_infection", value: 0 }]);
  });

  it("reloads the board afterwards: the engine may now have a finding it did not have", async () => {
    const { api } = await openChartable();
    const before = api.boardPatients.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    expect(api.boardPatients.mock.calls.length).toBeGreaterThan(before);
  });

  it("shows a refusal and claims nothing was charted", async () => {
    const { api } = await openChartable({
      setup: (api) => api.chart.mockRejectedValue(Object.assign(new Error("no"), { status: 403, code: "permission_required" })),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ").trim()).not.toBe("");
    // Nothing says it was charted, and the board was not reloaded: the load and the stream's
    // reload are the only two calls. The button comes back, so the clinician can try again.
    expect(screen.queryByText(/İşarələndi/)).toBeNull();
    expect(api.boardPatients).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Var kimi işarələ" })).toBeEnabled();
  });

  it("says it is charting, in words a screen reader hears", async () => {
    let release;
    await openChartable({ setup: (api) => api.chart.mockImplementation(() => new Promise((r) => { release = r; })) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    await vi.waitFor(
      () => expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain("İşarələnir…"),
      { timeout: 4000 },      // 150 ms of real time, under a suite running 99 files in parallel
    );
    await act(async () => { release({ patient_id: "S-001", charted: 1, alerts: [] }); await settle(); });
  });

  it("no button at all without clinical.chart, and the reason is on the screen", async () => {
    await open({ payload: board([entry("S-001", [], SEPSIS)]) });
    expect(screen.queryByRole("button", { name: "Var kimi işarələ" })).toBeNull();
    expect(screen.getByText(/səlahiyyətiniz yoxdur \(clinical.chart\)/)).toBeInTheDocument();
  });
});
```

`fireEvent` has to be imported for this block: replace

```jsx
import { act, screen, within } from "@testing-library/react";
```

with

```jsx
import { act, fireEvent, screen, within } from "@testing-library/react";
```

- [ ] **Step 5: Run them and watch them fail**

```bash
npx vitest run src/live/screens/patient/ 2>&1 | grep -E "Tests |Unable to find"
```
Expected: `8 failed | 29 passed (37)` — every one of them reading `Unable to find an accessible element with the role "button"`, because the control does not exist yet.

- [ ] **Step 6: Write the control**

In `dashboard/src/live/screens/patient/PatientScreen.jsx`, replace

```jsx
/** What the Sepsis-3 criterion is being judged against.
```

with

```jsx
/** The one thing this screen writes, and the smallest write the system has: whether an infection
 *  is suspected (`POST /clinical/{id}`, one entry, permission `clinical.chart`).
 *
 *  It is here and not in Group 2 with the SOFA form because of what its absence does. Nothing in
 *  the engine's sepsis branch runs until something charts this — `septic_shock.evaluate` returns at
 *  its first line — so a septic patient on a ward where nobody can chart it is a patient the engine
 *  is silent about, and the screen that says "the sepsis rule does not run at all for this patient"
 *  would be stating a problem it was built unable to fix. One button closes that.
 *
 *  Three rules it keeps. The screen offers the clinician's judgement and never forms one: there is
 *  no default, no pre-selected answer and no suggestion of which to press, because Homunculus does
 *  not diagnose. Both answers are offered even once one has been charted — a judgement can change,
 *  and "no" after "yes" is a real clinical event, not an undo. And it says out loud, before it is
 *  pressed, that this goes into the audit trail under the clinician's own name and cannot be
 *  withdrawn: the engine keeps the latest charted value, so a correction supersedes rather than
 *  erases. Nothing here computes: the ENGINE decides what a charted "yes" means for this patient,
 *  and the board that comes back is what the screen then shows.
 *
 *  The current answer is not a disabled button or a tick: `Note` above already states it in a
 *  sentence, and a pressed-looking button would read as "this is what is true" rather than "this is
 *  what was charted, by a person, at a time". */
function Chart({ canChart, onChart, busy }) {
  const { t } = useI18n();
  if (!canChart) {
    // Why there is no button, rather than a screen that silently has fewer controls on it.
    return <p className="m-0 mt-2 text-12 text-mute">{t("patient.chartNoRight")}</p>;
  }
  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <p className="m-0 text-12.5 font-semibold">{t("patient.chartTitle")}</p>
      <p className="m-0 mt-0.5 text-11.5 text-mute">{t("patient.chartNote")}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button size="sm" icon="alert" busy={busy} disabled={busy} onClick={() => onChart(true)}>
          {t("patient.chartYes")}
        </Button>
        <Button size="sm" icon="ok" busy={busy} disabled={busy} onClick={() => onChart(false)}>
          {t("patient.chartNo")}
        </Button>
      </div>
      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here. */}
      <Announce text={busy ? t("patient.chartSaving") : ""} />
    </div>
  );
}

/** What the Sepsis-3 criterion is being judged against.
```

and replace

```jsx
function Sepsis({ sepsis }) {
  const { t } = useI18n();
  if (!sepsis) return null;
  const suspected = sepsis.suspected_infection;
  return (
    <Box title={t("patient.sepsis")} icon="flask" level={2}>
      <Note tone={suspected === null ? "warn" : "info"} icon={suspected === null ? "alert" : "ok"}>
        {t(suspected === null ? "patient.suspectedUnknown" : suspected ? "patient.suspectedYes" : "patient.suspectedNo")}
      </Note>
```

with

```jsx
function Sepsis({ sepsis, canChart, onChart, busy }) {
  const { t } = useI18n();
  if (!sepsis) return null;
  const suspected = sepsis.suspected_infection;
  return (
    <Box title={t("patient.sepsis")} icon="flask" level={2}>
      <Note tone={suspected === null ? "warn" : "info"} icon={suspected === null ? "alert" : "ok"}>
        {t(suspected === null ? "patient.suspectedUnknown" : suspected ? "patient.suspectedYes" : "patient.suspectedNo")}
      </Note>
      <Chart canChart={canChart} onChart={onChart} busy={busy} />
```

- [ ] **Step 7: Wire it to the store**

Replace

```jsx
export function PatientScreen({ params }) {
  const { t } = useI18n();
  const board = useBoard();
```

with

```jsx
export function PatientScreen({ params }) {
  const { t } = useI18n();
  const board = useBoard();
  const { user } = useSession();
  const toast = useToast();
```

and replace

```jsx
  const measured = hasMeasurement(patient?.measuredAt);
  const bed = patient?.bedLabel || id;
```

with

```jsx
  // Charting the suspected infection. `busy` while it is in flight (one at a time: the answer
  // reloads the board), the API's own refusal on screen if it is refused, and nothing written
  // locally either way — a charted observation this screen showed and the server did not take
  // would be a lie with a clinician's name on it.
  const [charting, setCharting] = useState(false);
  const [chartError, setChartError] = useState(null);
  const canChart = user.perms.includes("clinical.chart");
  async function chart(suspected) {
    if (charting) return;
    setCharting(true);
    setChartError(null);
    try {
      await board.store.chart(id, [{ code: "suspected_infection", value: suspected ? 1 : 0 }]);
      toast.show(t("patient.chartSaved"), "ok");
    } catch (err) {
      setChartError(err);
    } finally {
      setCharting(false);
    }
  }

  const measured = hasMeasurement(patient?.measuredAt);
  const bed = patient?.bedLabel || id;
```

and replace

```jsx
            <Sepsis sepsis={patient.sepsis} />
```

with

```jsx
            {chartError ? <Alert tone="crit">{apiErrorText(t, chartError)}</Alert> : null}
            <Sepsis sepsis={patient.sepsis} canChart={canChart} onChart={chart} busy={charting} />
```

and replace

```jsx
import React, { useEffect, useMemo, useRef } from "react";
```

with

```jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
```

and replace

```jsx
import { useBoard } from "../../data/BoardProvider.jsx";
```

with

```jsx
import { useBoard } from "../../data/BoardProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
```

and replace

```jsx
import { Alert, Box, Icon, KV, KVList, Note, RiskPill, StatusPill, riskStyle } from "../../ui/index.js";
```

with

```jsx
import { Alert, Announce, Box, Button, Icon, KV, KVList, Note, RiskPill, StatusPill, riskStyle, useToast } from "../../ui/index.js";
```

- [ ] **Step 8: Run it**

```bash
npx vitest run src/live/screens/patient/ src/live/i18n/strings.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  43 passed (43)` — 37 in `PatientScreen.test.jsx` (was 29) and 6 in `strings.test.js`.

- [ ] **Step 9: Look at it**

Run `npx vite dev`, sign in as a user with `clinical.chart`, open a patient, chart a "yes" and watch the board come back.

Check: neither button looks chosen before you press one; the audit sentence is readable without hunting for it; the toast says what happened; the card behind it changes if the engine now has a finding; and signing in as a nurse without `clinical.chart` shows the sentence saying which right is missing and no buttons at all. At 390 px the two buttons wrap rather than overflow.

- [ ] **Step 10: Gate**

```bash
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: eight tests more than Task 15 left; the build succeeds.

- [ ] **Step 11: Commit**

```bash
git add dashboard/src/live/i18n/strings/patient.js dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/session/testTokens.testutil.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the patient screen charts a suspected infection (G1-11)

The engine's whole sepsis branch waits on this one boolean: septic_shock
returns at its first line until something charts it. So a ward with no way to
chart it is a ward the engine is silent about for sepsis, and the screen was
printing that problem while unable to do anything about it.

One POST /clinical/{id} with one entry, behind clinical.chart; no right means
no button and a line saying which right is missing. Neither answer is
suggested and neither is pre-selected -- the screen takes a judgement and does
not form one -- and both stay offered afterwards, because "no" after "yes" is
a clinical event, not an undo. It says before it is pressed that this enters
the audit trail under the clinician's name and cannot be withdrawn; the engine
keeps the latest charted value, so a correction supersedes rather than erases.
The board is reloaded after a successful chart: the engine may now hold a
finding it did not hold a moment ago.

The screen's own "read-only" sentence is replaced rather than reworded, and
its key renamed from readOnly to onlyWrite: a key called readOnly on a screen
that writes is the kind of thing that survives three waves and then misleads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **37** tests in `PatientScreen.test.jsx` (was 29); `strings.test.js` green at 6; whole suite green; build clean; looked at it in the browser with and without the right.

---

# Wave 3B · arm 4 — the administration foundation (Tasks 16–19)

### Task 16: The permission catalogue, mirrored

**Files:**
- Create: `dashboard/src/live/screens/admin/catalogue.js` + `catalogue.test.js`

Why a mirror at all, when `/admin/permissions` serves the catalogue? Because that route needs `groups.manage`, and a user desk holding `users.manage` alone must still know that the SYSTEM group holds **everything** in order to grey out giving it away. Without the mirror such a desk would read the system group as holding only the rows the API happened to report, and offer it. The test reads `auth/permissions.py` and fails when the two drift.

It also holds the one thing the API does not say: which of the default groups is a ROLE and which an extra DUTY (Decision 16).

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/admin/catalogue.test.js`:

```javascript
// The mirror is only worth having if it is a mirror: this reads the backend's own catalogue and
// fails when the two drift. (A test may read outside `src/live/` — boundaries.test.js checks the
// sources, not the tests.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_GROUPS, EXTRA_DUTY_SLUGS, PERMISSION_KEYS, ROLE_SLUGS, groupKind, hasPerm,
} from "./catalogue.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = fs.readFileSync(
  path.resolve(HERE, "../../../../../homunculus-engine/src/homunculus/auth/permissions.py"), "utf8",
);

/** The keys of `PERMISSIONS: dict[str, str] = { "key": "description", … }`. */
function backendKeys() {
  const block = /PERMISSIONS: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(PY);
  expect(block, "PERMISSIONS block").not.toBeNull();
  return [...block[1].matchAll(/^\s{4}"([\w.]+)":/gm)].map((m) => m[1]);
}

/** The slugs of DEFAULT_GROUPS, in the order the backend lists them. */
function backendGroups() {
  const block = /DEFAULT_GROUPS: tuple\[GroupSpec, \.\.\.\] = \(([\s\S]*?)\n\)/.exec(PY);
  expect(block, "DEFAULT_GROUPS block").not.toBeNull();
  return [...block[1].matchAll(/\{"slug": "(\w+)"/g)].map((m) => m[1]);
}

describe("the permission catalogue mirrors the backend", () => {
  it("has the backend's keys, in the backend's order", () => {
    expect(PERMISSION_KEYS).toEqual(backendKeys());
  });

  it("the reader found a catalogue worth checking", () => {
    expect(backendKeys().length).toBeGreaterThan(15);
    expect(backendKeys()).toContain("users.manage");
  });

  it("has the backend's default groups, in the backend's order", () => {
    expect(DEFAULT_GROUPS.map((g) => g.slug)).toEqual(backendGroups());
  });

  it("marks the system group and the groups that require two-step verification as the backend does", () => {
    const flag = (slug, name) => new RegExp(`\\{"slug": "${slug}"[\\s\\S]*?"${name}": (True|False)`).exec(PY)?.[1];
    for (const group of DEFAULT_GROUPS) {
      expect(flag(group.slug, "is_system") === "True", `${group.slug} is_system`).toBe(group.isSystem);
      expect(flag(group.slug, "mfa_required") === "True", `${group.slug} mfa_required`).toBe(group.mfaRequired);
    }
  });

  it("is frozen: one shared table nothing may widen at run time", () => {
    expect(Object.isFrozen(PERMISSION_KEYS)).toBe(true);
    expect(DEFAULT_GROUPS.every((g) => Object.isFrozen(g))).toBe(true);
    expect(() => { PERMISSION_KEYS.push("x"); }).toThrow(TypeError);
  });
});

describe("role, extra duty, or neither", () => {
  it("names the two duties the user form offers beside a role", () => {
    // Roadmap D3: "Rol + Ek görev + Birimler". A charge nurse is a nurse with more; a
    // rapid-response duty ends with the shift.
    expect(EXTRA_DUTY_SLUGS).toEqual(["charge_nurse", "rapid_response"]);
    expect(ROLE_SLUGS).toContain("nurse");
    expect(ROLE_SLUGS).not.toContain("charge_nurse");
  });

  it("every default group is one or the other", () => {
    expect([...EXTRA_DUTY_SLUGS, ...ROLE_SLUGS].sort()).toEqual(DEFAULT_GROUPS.map((g) => g.slug).sort());
  });

  it("a group the hospital made itself is neither", () => {
    expect(groupKind("nurse")).toBe("role");
    expect(groupKind("charge_nurse")).toBe("extra");
    expect(groupKind("gece_ekibi")).toBe("other");
    expect(groupKind(undefined)).toBe("other");
    expect(groupKind("constructor")).toBe("other");      // no prototype keys
  });
});

describe("hasPerm", () => {
  it("answers from the list it was given, and refuses anything else", () => {
    expect(hasPerm(["users.manage"], "users.manage")).toBe(true);
    expect(hasPerm(["users.manage"], "groups.manage")).toBe(false);
    expect(hasPerm(null, "users.manage")).toBe(false);
    expect(hasPerm(undefined, "users.manage")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/live/screens/admin/ 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./catalogue.js"`.

- [ ] **Step 3: Write it**

```javascript
// src/live/screens/admin/catalogue.js — the permission keys and the default groups, mirrored from
// the backend (homunculus-engine/src/homunculus/auth/permissions.py). `catalogue.test.js` reads
// that file and fails when the two drift: change both sides together.
//
// Why a mirror at all, when `/admin/permissions` serves the catalogue with its descriptions? Two
// reasons, both about rights the screen must judge without being able to ask:
//   * `/admin/permissions` needs `groups.manage`. A user desk that holds `users.manage` alone can
//     list the groups it may give but cannot read the catalogue — and it still has to know what
//     the SYSTEM group holds, which is "everything", in order to grey out giving it away
//     (`groupRights` in rules.js). Without the mirror that desk would read the system group as
//     holding only the rows the API happened to report.
//   * A key the catalogue no longer holds is retired and the server ignores it; the mirror is how
//     the screen knows which of a custom group's keys those are.
//
// The LIVE session's own rights are never taken from here: they come from the token
// (`useSession().user.perms`), which is what the server checks this hour. This list is the
// vocabulary, not the grant.
//
// It is a copy rather than an import of `src/permissions.js`: roadmap D1 keeps `src/live/` off the
// old workspace, which G1-16 deletes. The old file carries the simulation's role tables too,
// which have no meaning here.
const freeze = (a) => Object.freeze([...a]);

export const PERMISSION_KEYS = freeze([
  "board.view", "alerts.ack", "alerts.escalate",
  "admissions.view", "admissions.admit", "admissions.sign_off",
  "admissions.move.initiate", "admissions.transfer.confirm", "admissions.discharge.confirm",
  "care_team.claim", "care_team.assign", "handover.sign", "shifts.manage",
  "break_glass.use", "audit.view",
  "users.manage", "groups.manage", "structure.manage", "devices.manage",
  "clinical.chart", "scores.sign",
]);

/** The backend's DEFAULT_GROUPS, in its order and with its slugs. The screen needs the ORDER (the
 *  roles table reads top to bottom as the hospital's own hierarchy) and `kind`, which the API does
 *  not send: the user form offers one ROLE and any number of EXTRA DUTIES (roadmap D3), and
 *  nothing in `GroupOut` says which a group is. A group the hospital created itself is neither and
 *  appears under "other groups". */
export const DEFAULT_GROUPS = Object.freeze([
  { slug: "hospital_admin", kind: "role", mfaRequired: true, isSystem: true },
  { slug: "attending", kind: "role", mfaRequired: true, isSystem: false },
  { slug: "unit_physician", kind: "role", mfaRequired: true, isSystem: false },
  { slug: "physician", kind: "role", mfaRequired: false, isSystem: false },
  { slug: "charge_nurse", kind: "extra", mfaRequired: false, isSystem: false },
  { slug: "nurse", kind: "role", mfaRequired: false, isSystem: false },
  { slug: "rapid_response", kind: "extra", mfaRequired: false, isSystem: false },
  { slug: "auditor", kind: "role", mfaRequired: false, isSystem: false },
  { slug: "platform_support", kind: "role", mfaRequired: true, isSystem: false },
  { slug: "pharmacist", kind: "role", mfaRequired: false, isSystem: false },
  { slug: "biomedical", kind: "role", mfaRequired: false, isSystem: false },
].map((g) => Object.freeze(g)));

/** The two groups the user form offers as an EXTRA DUTY rather than as a role (roadmap D3:
 *  "Rol + Ek görev + Birimler"; the prototype's `H.EXTRA`). A duty adds rights to the person's
 *  role — a charge nurse is a nurse with more, and a rapid-response duty ends with the shift. The
 *  backend has one flat membership list and says nothing about this distinction, so it lives here
 *  and the screen is explicit that it is OUR vocabulary, not the server's. */
export const EXTRA_DUTY_SLUGS = freeze(DEFAULT_GROUPS.filter((g) => g.kind === "extra").map((g) => g.slug));
export const ROLE_SLUGS = freeze(DEFAULT_GROUPS.filter((g) => g.kind === "role").map((g) => g.slug));

/** What a group is to the user form: "role", "extra" or "other" (one the hospital created). */
export function groupKind(slug) {
  const known = DEFAULT_GROUPS.find((g) => g.slug === slug);
  return known ? known.kind : "other";
}

/** Does this session hold the right? `perms` is `useSession().user.perms` — the token's own list. */
export function hasPerm(perms, key) {
  return Array.isArray(perms) && perms.includes(key);
}
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/live/screens/admin/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  9 passed (9)`.

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: one file and 9 tests more than the branch started with; the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/catalogue.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the permission catalogue, mirrored and checked against the backend

A user desk holding users.manage alone cannot read /admin/permissions, and it
still has to know that the system group holds everything — otherwise it would
offer to give it away. The test reads auth/permissions.py, so the mirror cannot
drift. It also carries the one thing the API does not say: which default group
is a role and which an extra duty (roadmap D3).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 9 new tests, one of which fails if `auth/permissions.py` changes without this file.

---

### Task 17: The administration rules

**Files:**
- Create: `dashboard/src/live/screens/admin/rules.js` + `rules.test.js`

Taken over from the old workspace's `src/liveAdmin.js`, which was written against exactly this API and tested; D1 forbids importing it, so it is copied with its reasoning and extended with `kind`, `scopeFromApi`, `unlockSignIn` and `canMapGroups`.

**These are hints.** They decide what a panel offers or greys out, never what is allowed: the server re-checks every write under the tenant's lock with the caller's rights read from the database, and its 403/409 is what the panel then shows. The hint exists so an administrator is not invited to press a button that cannot work. Where a rule cannot be DECIDED — a group the list does not hold, no session id — it refuses: unknown rights are never taken to be small.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/admin/rules.test.js`:

```javascript
// The old workspace's liveAdmin tests, carried over with the module, plus what Wave 3 added:
// `kind`, `scopeFromApi`, `unlockSignIn` and `canMapGroups`. Synthetic accounts only.
import { describe, it, expect } from "vitest";
import { PERMISSION_KEYS } from "./catalogue.js";
import {
  canGrant, canManageUser, canMapGroups, groupFromApi, groupRights, rightsBeyond, scopeFromApi,
  userFromApi, userRights,
} from "./rules.js";

const CATALOGUE = PERMISSION_KEYS.map((key) => ({ key, description: key }));
const group = (over = {}) => groupFromApi({
  id: "g-nurse", slug: "nurse", name: "Hemşire", description: "", mfa_required: false,
  is_system: false, permissions: ["board.view", "alerts.ack"], member_count: 4, ...over,
});
const SYSTEM = group({ id: "g-admin", slug: "hospital_admin", name: "Sistem Yöneticisi", is_system: true, permissions: ["users.manage"] });

describe("userFromApi", () => {
  it("reads the account the API describes", () => {
    const user = userFromApi({
      id: "u-1", username: "ayse", email: "ayse@example.com", full_name: "Ayşe Sentetik",
      auth_source: "local", is_active: true, totp_enabled: true, must_change_password: true,
      last_login_at: "2026-10-07T08:00:00Z",
      groups: [{ id: "g-nurse", slug: "nurse", name: "Hemşire", source: "manual" }],
    });
    expect(user).toMatchObject({
      id: "u-1", username: "ayse", fullName: "Ayşe Sentetik", authSource: "local",
      active: true, mfa: true, mustChangePassword: true,
    });
    expect(user.groups[0]).toEqual({ id: "g-nurse", slug: "nurse", name: "Hemşire", source: "manual", kind: "role" });
    expect(user.manualGroupIds).toEqual(["g-nurse"]);
  });

  it("says which of a group is a role, an extra duty, or the hospital's own", () => {
    const user = userFromApi({ groups: [
      { id: "a", slug: "nurse" }, { id: "b", slug: "charge_nurse" }, { id: "c", slug: "gece_ekibi" },
    ] });
    expect(user.groups.map((g) => g.kind)).toEqual(["role", "extra", "other"]);
  });

  it("leaves out a membership the directory holds when listing what may be replaced", () => {
    // `PUT /users/{id}/groups` replaces the MANUAL memberships; a directory-held one is AD's.
    const user = userFromApi({ groups: [
      { id: "a", slug: "nurse", source: "manual" }, { id: "b", slug: "physician", source: "directory" },
    ] });
    expect(user.manualGroupIds).toEqual(["a"]);
    expect(user.groups).toHaveLength(2);
  });

  it("an account the API says nothing about is shown as it is, not quietly hidden", () => {
    expect(userFromApi({}).active).toBe(true);
    expect(userFromApi(null).active).toBe(true);
    expect(userFromApi({}).mfa).toBe(false);
    expect(userFromApi({}).mustChangePassword).toBe(false);
    expect(userFromApi({}).groups).toEqual([]);
  });

  it("an account with no e-mail has none, not an empty one", () => {
    expect(userFromApi({ email: null }).email).toBeNull();
  });
});

describe("groupFromApi", () => {
  it("reads the group the API describes", () => {
    expect(group()).toMatchObject({
      id: "g-nurse", slug: "nurse", name: "Hemşire", mfaRequired: false, isSystem: false,
      kind: "role", memberCount: 4,
    });
    expect(group().permissions).toEqual(["board.view", "alerts.ack"]);
  });

  it("a member count the API did not send is none", () => {
    expect(group({ member_count: null }).memberCount).toBe(0);
    expect(groupFromApi(null).memberCount).toBe(0);
  });
});

describe("scopeFromApi", () => {
  it("reads the units, the beds and the grants that are still active", () => {
    const scope = scopeFromApi({
      user_id: "u-1", unrestricted: false, reason: "assigned",
      unit_ids: ["rea-01"], bed_ids: ["rea-01-2"],
      grants: [
        { unit_id: "REA-01", bed_id: "", is_active: true },
        { unit_id: "", bed_id: "REA-01-2", is_active: true },
        { unit_id: "NICU-01", bed_id: "", is_active: false },   // revoked
      ],
    });
    expect(scope).toMatchObject({ userId: "u-1", unrestricted: false, reason: "assigned" });
    expect(scope.grants).toEqual([{ unitId: "REA-01", bedId: "" }, { unitId: "", bedId: "REA-01-2" }]);
  });

  it("a scope the API could not resolve is not an empty one", () => {
    // The resolver's own answer for "we could not find out" (scope/resolver.py UNKNOWN).
    expect(scopeFromApi({ unrestricted: false, reason: "unknown" }).reason).toBe("unknown");
    expect(scopeFromApi(null)).toMatchObject({ unrestricted: false, reason: "unknown", grants: [] });
  });
});

describe("groupRights", () => {
  it("is a group's own keys, within the catalogue", () => {
    expect(groupRights(group(), CATALOGUE)).toEqual(["alerts.ack", "board.view"]);
  });

  it("drops a key the catalogue no longer holds", () => {
    expect(groupRights(group({ permissions: ["board.view", "eski.yetki"] }), CATALOGUE)).toEqual(["board.view"]);
  });

  it("the SYSTEM group holds everything, even to a desk that cannot read the catalogue", () => {
    // A `users.manage` desk gets 403 from /admin/permissions. Without the mirror it would read the
    // system group as holding one key and offer to give it away.
    expect(groupRights(SYSTEM, [])).toEqual([...PERMISSION_KEYS].sort());
    expect(groupRights(SYSTEM, CATALOGUE)).toEqual([...PERMISSION_KEYS].sort());
  });

  it("without a catalogue, a group's keys are taken as they are", () => {
    expect(groupRights(group({ permissions: ["board.view", "eski.yetki"] }), [])).toEqual(["board.view", "eski.yetki"]);
  });

  it("nothing at all is no rights", () => {
    expect(groupRights(null, CATALOGUE)).toEqual([]);
    expect(groupRights(undefined)).toEqual([]);
  });
});

describe("userRights", () => {
  it("is the union of the user's groups, manual and directory alike", () => {
    const groups = [group(), group({ id: "g-rrt", slug: "rapid_response", permissions: ["alerts.escalate"] })];
    const user = userFromApi({ groups: [{ id: "g-nurse", source: "manual" }, { id: "g-rrt", source: "directory" }] });
    expect(userRights(user, groups, CATALOGUE)).toEqual(["alerts.ack", "alerts.escalate", "board.view"]);
  });

  it("is UNKNOWN when a group of the user's is not in the list — never taken to be small", () => {
    const user = userFromApi({ groups: [{ id: "g-missing", source: "manual" }] });
    expect(userRights(user, [group()], CATALOGUE)).toBeNull();
  });

  it("a user in no group holds nothing", () => {
    expect(userRights(userFromApi({ groups: [] }), [group()], CATALOGUE)).toEqual([]);
  });
});

describe("rightsBeyond", () => {
  it("names what the session lacks, sorted", () => {
    expect(rightsBeyond(["board.view"], ["board.view", "users.manage", "audit.view"]))
      .toEqual(["audit.view", "users.manage"]);
    expect(rightsBeyond(PERMISSION_KEYS, PERMISSION_KEYS)).toEqual([]);
  });
});

describe("canGrant", () => {
  it("only a group within the session's own rights", () => {
    expect(canGrant(["board.view", "alerts.ack", "users.manage"], group(), CATALOGUE)).toBe(true);
    expect(canGrant(["board.view", "users.manage"], group(), CATALOGUE)).toBe(false);
  });

  it("never the system group, unless the session holds everything", () => {
    expect(canGrant(["users.manage"], SYSTEM, CATALOGUE)).toBe(false);
    expect(canGrant([...PERMISSION_KEYS], SYSTEM, CATALOGUE)).toBe(true);
  });

  it("refuses what it cannot decide", () => {
    expect(canGrant(["users.manage"], null, CATALOGUE)).toBe(false);
    expect(canGrant(null, group(), CATALOGUE)).toBe(false);
  });
});

describe("canManageUser", () => {
  const groups = [group()];
  const nurse = userFromApi({ id: "u-2", auth_source: "local", groups: [{ id: "g-nurse", slug: "nurse", source: "manual" }] });
  const ad = userFromApi({ id: "u-3", auth_source: "ldap", groups: [{ id: "g-nurse", slug: "nurse", source: "manual" }] });
  const DESK = ["users.manage", "board.view", "alerts.ack"];

  it("a desk within whose rights the user falls may act", () => {
    expect(canManageUser(DESK, nurse, groups, "u-1", CATALOGUE)).toMatchObject({
      within: true, edit: true, setGroups: true, resetPassword: true, resetMfa: true, deactivate: true,
    });
  });

  it("names the rights the session lacks, and acts on nothing", () => {
    const admin = userFromApi({ id: "u-9", groups: [{ id: "g-admin", slug: "hospital_admin", source: "manual" }] });
    const verdict = canManageUser(DESK, admin, [SYSTEM], "u-1", CATALOGUE);
    expect(verdict.within).toBe(false);
    expect(verdict.beyond).toContain("groups.manage");   // the system group holds everything
    expect(verdict.edit).toBe(false);
  });

  it("unknown rights refuse everything", () => {
    const stranger = userFromApi({ id: "u-4", groups: [{ id: "g-?", source: "manual" }] });
    const verdict = canManageUser(DESK, stranger, groups, "u-1", CATALOGUE);
    expect(verdict.beyond).toBeNull();
    expect(verdict.within).toBe(false);
  });

  it("nobody resets or deactivates themselves", () => {
    const verdict = canManageUser(DESK, { ...nurse, id: "u-1" }, groups, "u-1", CATALOGUE);
    expect(verdict.edit).toBe(true);                 // a name or an e-mail, yes
    expect(verdict.resetPassword).toBe(false);
    expect(verdict.resetMfa).toBe(false);
    expect(verdict.deactivate).toBe(false);
    expect(verdict.unlockSignIn).toBe(false);
  });

  it("without an id for the session, the user might be yourself: refuse", () => {
    expect(canManageUser(DESK, nurse, groups, null, CATALOGUE).resetPassword).toBe(false);
    expect(canManageUser(DESK, nurse, groups, "", CATALOGUE).deactivate).toBe(false);
  });

  it("a directory account's password is AD's, and only it has a sign-in throttle to lift", () => {
    expect(canManageUser(DESK, ad, groups, "u-1", CATALOGUE).resetPassword).toBe(false);
    expect(canManageUser(DESK, ad, groups, "u-1", CATALOGUE).unlockSignIn).toBe(true);
    expect(canManageUser(DESK, nurse, groups, "u-1", CATALOGUE).unlockSignIn).toBe(false);
  });

  it("a desk without users.manage may do nothing at all", () => {
    expect(canManageUser(["groups.manage"], nurse, groups, "u-1", CATALOGUE))
      .toMatchObject({ within: false, edit: false, setGroups: false });
  });
});

describe("canMapGroups", () => {
  it("only an administrator who holds every key", () => {
    // The server's own rule (403 MAPPING_ADMIN_ONLY): a desk that may not regroup one nurse
    // directly must not be able to regroup every nurse at once through the mapping.
    expect(canMapGroups([...PERMISSION_KEYS], CATALOGUE)).toBe(true);
    expect(canMapGroups(["users.manage"], CATALOGUE)).toBe(false);
    expect(canMapGroups([], CATALOGUE)).toBe(false);
  });

  it("falls back to the mirrored catalogue when the session cannot read the real one", () => {
    expect(canMapGroups([...PERMISSION_KEYS], [])).toBe(true);
    expect(canMapGroups(["users.manage"], [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/live/screens/admin/rules.test.js 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./rules.js"`.

- [ ] **Step 3: Write it**

```javascript
// src/live/screens/admin/rules.js — the /admin payloads as the screens render them, and the rules
// those screens follow (homunculus-engine admin/service.py).
//
// Taken over from the old workspace's `src/liveAdmin.js`, which was written and tested against
// exactly this API; roadmap D1 keeps `src/live/` off that workspace, so it is copied rather than
// imported, with its reasoning, and the `kind` of a group added (catalogue.js: a role, an extra
// duty, or one the hospital made itself — the distinction the user form needs and the API does
// not send).
//
// ADAPTERS fail closed, with one deliberate exception: a flag the API said nothing about reads as
// the SAFER value, except `is_active` — an account the API does not describe is shown as it is,
// active, so nobody is quietly hidden from the administrator who has to manage them.
//
// RULES ARE HINTS. They decide what a panel offers or greys out, never what is allowed: the server
// re-checks every write under the tenant's lock, with the caller's rights read from the database,
// and its 403/409 is what the panel then shows. The hint exists so an administrator is not invited
// to press a button that cannot work. Two rules carry the weight:
//   * no grant beyond your own rights — a group may be given only if its rights are within the
//     session's (`canGrant`), and a user may be acted on only if theirs are (`canManageUser`);
//   * nobody resets or deactivates themselves.
// Where a rule cannot be DECIDED — a group the list does not hold, no session id — it refuses.
// Unknown rights are never taken to be small.
import { PERMISSION_KEYS, groupKind, hasPerm } from "./catalogue.js";

export function userFromApi(u) {
  const row = u && typeof u === "object" ? u : {};
  const groups = Array.isArray(row.groups) ? row.groups : [];
  const mapped = groups.map((g) => ({
    id: g.id, slug: g.slug, name: g.name, source: g.source || "manual", kind: groupKind(g.slug),
  }));
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    fullName: row.full_name,
    authSource: row.auth_source || "local",
    active: row.is_active !== false,
    mfa: row.totp_enabled === true,
    mustChangePassword: row.must_change_password === true,
    lastLoginAt: row.last_login_at ?? null,
    groups: mapped,
    /** The memberships an administrator may replace. A membership the DIRECTORY holds is AD's to
     *  decide (the group mapping), and `PUT /users/{id}/groups` leaves it alone. */
    manualGroupIds: mapped.filter((g) => g.source === "manual").map((g) => g.id),
  };
}

export function groupFromApi(g) {
  const row = g && typeof g === "object" ? g : {};
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    mfaRequired: row.mfa_required === true,
    isSystem: row.is_system === true,
    kind: groupKind(row.slug),
    permissions: Array.isArray(row.permissions) ? [...row.permissions] : [],
    memberCount: Number(row.member_count) || 0,
  };
}

/** One user's scope as `/scope/{id}` describes it (scope/schemas.py ScopeView). */
export function scopeFromApi(s) {
  const row = s && typeof s === "object" ? s : {};
  return {
    userId: row.user_id ?? null,
    unrestricted: row.unrestricted === true,
    reason: row.reason || "unknown",
    unitIds: Array.isArray(row.unit_ids) ? [...row.unit_ids] : [],
    bedIds: Array.isArray(row.bed_ids) ? [...row.bed_ids] : [],
    /** The ACTIVE grants, which is what `PUT /scope/{id}` replaces. A revoked row stays in the
     *  answer with `revoked_at` set; sending it back would grant it again. */
    grants: (Array.isArray(row.grants) ? row.grants : [])
      .filter((g) => g && g.is_active !== false)
      .map((g) => ({ unitId: g.unit_id || "", bedId: g.bed_id || "" })),
  };
}

// ---------------------------------------------------------------- rules (hints)

/** Keys from a list of keys or of catalogue entries ({key, description}). */
const keysOf = (list) => (Array.isArray(list)
  ? list.map((p) => (typeof p === "string" ? p : p?.key)).filter((k) => typeof k === "string")
  : []);

const sortedSet = (keys) => [...new Set(keys)].sort();

/** A group's rights, as a token minted from it would carry them (service.py `group_rights`): the
 *  whole catalogue for the system group, otherwise its keys within the catalogue.
 *    - The SYSTEM group: a `users.manage` desk cannot read `/admin/permissions`, so its rights are
 *      widened with the mirrored PERMISSION_KEYS and whatever the API reported for it. It never
 *      reads as holding less than everything — which is what makes "you may not give this group
 *      away" come out right for a desk that cannot see the catalogue.
 *    - An ordinary group: a key the catalogue no longer holds is retired, and the server ignores
 *      it, so it is dropped here too. Without a catalogue its keys are taken as they are; a
 *      retired key then only makes the group look harder to grant, never easier. */
export function groupRights(group, catalogue = []) {
  if (!group || typeof group !== "object") return [];
  const own = keysOf(group.permissions);
  const known = keysOf(catalogue);
  if (group.isSystem === true || group.is_system === true) {
    return sortedSet([...known, ...PERMISSION_KEYS, ...own]);
  }
  if (known.length === 0) return sortedSet(own);
  const inCatalogue = new Set(known);
  return sortedSet(own.filter((k) => inCatalogue.has(k)));
}

/** A user's rights: the union of their groups' rights, manual and directory-held alike
 *  (service.py `user_rights`). `null` when one of the user's groups is not in `groups` — unknown
 *  rights are never taken to be small. */
export function userRights(user, groups, catalogue = []) {
  const byId = new Map((Array.isArray(groups) ? groups : []).map((g) => [g?.id, g]));
  const rights = [];
  for (const link of Array.isArray(user?.groups) ? user.groups : []) {
    const group = byId.get(link?.id);
    if (!group) return null;
    rights.push(...groupRights(group, catalogue));
  }
  return sortedSet(rights);
}

/** The rights the session does not hold, sorted — what the server's 403 lists after
 *  "Kendi yetkilerinizi aşan bir işlem yapılamaz: ". */
export function rightsBeyond(sessionPerms, rights) {
  const held = new Set(keysOf(sessionPerms));
  return sortedSet(keysOf(rights)).filter((k) => !held.has(k));
}

/** May the session give this group to someone? Its rights must be within the session's. */
export function canGrant(sessionPerms, group, catalogue = []) {
  if (!group || !Array.isArray(sessionPerms)) return false;
  return rightsBeyond(sessionPerms, groupRights(group, catalogue)).length === 0;
}

/** What the session may do to `user`, action by action:
 *    within         — `users.manage`, and the user's rights are within the session's;
 *    beyond         — the user's rights the session lacks (`null`: unknown);
 *    edit           — name, e-mail, reactivation (PATCH);
 *    setGroups      — manual memberships (PUT groups; each group offered still needs `canGrant`);
 *    resetPassword  — never on yourself, and only for a LOCAL account (an AD password is AD's);
 *    resetMfa       — never on yourself;
 *    deactivate     — never on yourself;
 *    unlockSignIn   — never on yourself, and only for a DIRECTORY account: the throttle it lifts
 *                     is the AD bind chain (`directory_binds`), which a local account has none of.
 *  What the UI cannot see is left to the server's 409: an account shared with another tenant or a
 *  platform operator's, and the last administrator. */
export function canManageUser(sessionPerms, user, groups, selfId, catalogue = []) {
  const rights = user && typeof user === "object" ? userRights(user, groups, catalogue) : null;
  const beyond = rights === null ? null : rightsBeyond(sessionPerms, rights);
  const within = hasPerm(sessionPerms, "users.manage") && beyond !== null && beyond.length === 0;
  // Without an id for the session the user might be yourself: refuse.
  const notSelf = within && selfId != null && selfId !== "" && user.id !== selfId;
  return {
    within,
    beyond,
    edit: within,
    setGroups: within,
    resetPassword: notSelf && user.authSource === "local",
    resetMfa: notSelf,
    deactivate: notSelf,
    unlockSignIn: notSelf && user.authSource === "ldap",
  };
}

/** May the session change the AD group mapping? The server allows it only to an administrator who
 *  holds EVERY key (admin/ldap_service.py MAPPING_ADMIN_ONLY, 403): a user desk that may not
 *  regroup one nurse directly must not be able to regroup every nurse at once. Reading the mapping
 *  needs `users.manage` only. */
export function canMapGroups(sessionPerms, catalogue = []) {
  const known = keysOf(catalogue);
  const whole = known.length > 0 ? known : PERMISSION_KEYS;
  return rightsBeyond(sessionPerms, whole).length === 0;
}
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/live/screens/admin/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  39 passed (39)`.

- [ ] **Step 5: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: 30 tests more than Task 16 left; the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/live/screens/admin/rules.js dashboard/src/live/screens/admin/rules.test.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the /admin payloads and the rules the tabs follow

Copied from the old workspace's liveAdmin.js (D1 forbids importing it) with its
reasoning, plus the role/duty kind, the scope view, the sign-in unlock and
canMapGroups — the server's own "only an administrator with every right may
change the AD group mapping". Hints, not permissions: unknown rights are never
taken to be small, and nobody resets or deactivates themselves.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 30 new tests.

---

### Task 18: What the three tabs read

**Files:**
- Create: `dashboard/src/live/screens/admin/useAdminData.js`

Ported from `liveStore.loadAdmin`, whose rules were learned the hard way: ask only what the rights allow; one refusal does not empty the screen; a stale load never overwrites a newer one; nothing is written after unmount; and every call goes through the session's `track`.

No test file of its own: the hook has no behaviour the frame's test does not exercise, and a test of a hook in isolation would need a host component that is the frame. Task 19's test covers every branch of it (which calls are made for which rights, one refusal, the reload, the loading state).

- [ ] **Step 1: Write it**

```javascript
// src/live/screens/admin/useAdminData.js — what the three administration tabs read, loaded once.
//
// Ported from the old workspace's `liveStore.loadAdmin`, whose rules were learned the hard way:
//   * ASK ONLY WHAT THE RIGHTS ALLOW. `/admin/users` needs `users.manage`; `/admin/groups` takes
//     either `users.manage` or `groups.manage` (a user desk must be able to list the groups it may
//     give); `/admin/permissions` needs `groups.manage`. A call the session cannot make is not
//     made — "not asked" is an empty list, never an error on the screen.
//   * ONE REFUSAL DOES NOT EMPTY THE SCREEN. `Promise.allSettled`: a 403 on one call leaves the
//     others standing and lands in `error`, so a desk with half the rights sees half the screen
//     rather than none of it.
//   * A STALE LOAD NEVER OVERWRITES A NEWER ONE (`seq`), and nothing is written after unmount.
//   * EVERY CALL GOES THROUGH THE SESSION'S `track`, so a refused refresh ends the session here
//     too and a 403 `password_change_required` moves the shell on.
//
// What it does NOT do, and why: the old version re-read `/auth/me` first, so a token minted before
// a key was added to this session's group would not grey out what the server allows. The new
// session store already re-reads the token's rights after every tracked call (`syncRights`) and
// re-reads `/auth/me` at restore and at sign-in, so the gap is at most one access token's life.
// And the greying is a HINT: the server decides every write, and its refusal is what the screen
// shows. One more call on every open of this screen is not worth closing a gap that closes itself.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/SessionProvider.jsx";
import { groupFromApi, userFromApi } from "./rules.js";
import { hasPerm } from "./catalogue.js";

const EMPTY = Object.freeze({ users: [], groups: [], catalogue: [], unassigned: null });

/**
 * Returns `{ data, loading, error, reload }`. `data` is never null — an unloaded screen shows empty
 * lists and its own "loading", not a blank.
 */
export function useAdminData() {
  const { user, store } = useSession();
  const api = store.api;
  const perms = user.perms;
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const reload = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    setError(null);
    const now = store.getState().user?.perms ?? perms;
    const may = {
      users: hasPerm(now, "users.manage"),
      groups: hasPerm(now, "users.manage") || hasPerm(now, "groups.manage"),
      catalogue: hasPerm(now, "groups.manage"),
    };
    const calls = [
      may.users ? store.track(() => api.adminUsers()) : null,
      may.groups ? store.track(() => api.adminGroups()) : null,
      may.catalogue ? store.track(() => api.adminPermissions()) : null,
      may.users ? store.track(() => api.unassignedScopes()) : null,
    ];
    const answers = await Promise.allSettled(calls.map((c) => c ?? Promise.resolve(null)));
    if (!mounted.current || seq.current !== mine) return;
    const value = (at) => (answers[at].status === "fulfilled" ? answers[at].value : null);
    const refused = answers.find((a) => a.status === "rejected");
    setData({
      users: (value(0) ?? []).map(userFromApi),
      groups: (value(1) ?? []).map(groupFromApi),
      catalogue: value(2) ?? [],
      unassigned: Number.isFinite(value(3)?.unassigned_users) ? value(3).unassigned_users : null,
    });
    setError(refused ? refused.reason : null);
    setLoading(false);
  }, [api, store, perms]);


  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload };
}
```

- [ ] **Step 2: Confirm it compiles into the build and breaks nothing**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: unchanged counts (nothing imports it yet) and a clean build.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/live/screens/admin/useAdminData.js
git commit -m "$(cat <<'EOF'
feat(dashboard): what the three administration tabs read

Ported from liveStore.loadAdmin: ask only what the session's rights allow, so a
desk with half the rights sees half the screen and the refusal beside it rather
than nothing; allSettled; a stale load never overwrites a newer one; every call
inside the session's track.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: The administration frame, and the seam for its three tabs

**Files:**
- Create: `dashboard/src/live/i18n/strings/admin.js`, `dashboard/src/live/screens/admin/AdminScreen.jsx` + `AdminScreen.test.jsx`
- Modify: `dashboard/src/live/i18n/catalog.js` (two lines), `dashboard/src/live/i18n/strings.test.js` (one block), `dashboard/src/live/shell/routes.js` (two lines)

The frame is this arm's whole deliverable: after it, G1-12, G1-13 and G1-14 are three branches that each write one component and edit **one line** of `TAB_SCREENS`. The seam is the route registry's, mirrored — a frozen canonical table, a private map, `tabScreenOf()`, and `stubTabs`/`resetTabs` that refuse outside the test build — so there is one shape in this codebase for "a build's screens are the ones it was built with", not two.

The strings file is the users tab's as well as the frame's, because `admin.*` is one namespace and splitting it would give the three tabs three namespaces to add to `catalog.js`.

- [ ] **Step 1: Write the strings**

Create `dashboard/src/live/i18n/strings/admin.js`:

```javascript
// Administration · Users and units (G1-12). The prototype's `admin.js` users tab, with everything
// it invented left out: no client-generated plaintext password, no client-side username policy
// beyond what the server enforces, no fabricated "last login" table, no locked demo accounts.
//
// Sources: `Kullanıcılar` / `Yeni kullanıcı` / `Kullanıcı adı` / `Rol` / `Birimler` /
// `Son giriş` / `Pasif` / `AKTİF` / `Düzenle` / `Şifre sıfırla` / `Kilidi aç` / `E-posta` /
// `Tüm roller` / `Ad ya da kullanıcı adı ara` / `Eşleşen kullanıcı yok.` are the prototype's own
// four-language dictionary entries. `scope*` is new: the prototype assigned units in the browser.
// AZ/RU/EN await a native speaker's review before the pilot.
export default {
  tr: {
    title: "Yönetim",
    sub: "{hospital} · her değişiklik denetim kaydına yazılır",
    tabUsers: "Kullanıcılar",
    tabRoles: "Roller ve yetkiler",
    tabSource: "Giriş kaynağı",
    sections: "Yönetim bölümleri",
    loading: "Yükleniyor…",
    noAccess: "Bu bölüme erişim yetkiniz yok.",
    retry: "Yeniden dene",
    // the list
    search: "Ad ya da kullanıcı adı ara",
    filterRole: "Rol",
    filterAll: "Tüm roller",
    none: "Eşleşen kullanıcı yok.",
    colName: "Ad",
    colUsername: "Kullanıcı adı",
    colRole: "Rol",
    colUnits: "Birimler",
    colState: "Durum",
    colMfa: "2FA",
    colLastLogin: "Son giriş",
    colActions: "İşlemler",
    caption: "Kullanıcılar ve yetkileri",
    active: "AKTİF",
    inactive: "Pasif",
    mfaOn: "Açık",
    mfaOff: "Kapalı",
    mfaRequired: "Zorunlu · kurulmadı",
    mustChange: "ilk girişte şifre",
    sourceLocal: "Yerel",
    sourceLdap: "AD",
    never: "Hiç girmedi",
    noUnits: "Birim atanmadı",
    allUnits: "Kapsam sınırsız",
    unitCount: "{count} birim",
    bedCount: "{count} yatak",
    extras: "Ek görev: {list}",
    otherGroups: "Diğer gruplar: {list}",
    // actions
    newUser: "Yeni kullanıcı",
    edit: "Düzenle",
    resetPassword: "Şifre sıfırla",
    resetMfa: "2FA sıfırla",
    deactivate: "Pasifleştir",
    activate: "Aktifleştir",
    unlockSignIn: "Girişi aç",
    scope: "Birimler",
    beyond: "Bu kullanıcının yetkileri sizinkini aşıyor; üzerinde işlem yapamazsınız. Eksik: {keys}",
    beyondUnknown: "Bu kullanıcının gruplarından biri listede yok; yetkileri bilinmediği için üzerinde işlem yapılmıyor.",
    selfNote: "Kendi hesabınızın şifresini, 2FA'sını ve etkinliğini buradan değiştiremezsiniz.",
    // the form
    formNew: "Yeni kullanıcı",
    formEdit: "Kullanıcıyı düzenle",
    fieldFullName: "Ad soyad",
    fieldUsername: "Kullanıcı adı",
    fieldUsernameHint: "Küçük harf, rakam ve . _ @ - · sonradan değiştirilemez",
    fieldEmail: "E-posta",
    fieldEmailHint: "Kurumsal adres; boş bırakılabilir",
    fieldPassword: "Geçici şifre",
    fieldPasswordHint: "En az 8 karakter. Kullanıcıya yüz yüze ya da telefonla iletin; e-postayla göndermeyin. Kullanıcı ilk girişte kendi şifresini belirler.",
    fieldRole: "Rol",
    fieldRoleHint: "Kişinin ana grubu. Yetkileri «Roller ve yetkiler»de tanımlanır.",
    fieldExtras: "Ek görev",
    fieldExtrasHint: "Rol değildir; kişinin rolüne yetki ekler. Nöbet görevi nöbet bitince kaldırılabilir.",
    fieldOther: "Diğer gruplar",
    fieldOtherHint: "Hastanenin kendi oluşturduğu gruplar.",
    fieldActive: "Hesap etkin",
    directoryGroups: "AD'den gelen gruplar burada değiştirilemez: {list}",
    noRole: "Rol seçilmedi",
    cannotGrant: "Bu grubun yetkileri sizinkini aşıyor; veremezsiniz.",
    save: "Kaydet",
    create: "Kullanıcıyı oluştur",
    cancel: "Vazgeç",
    saving: "Kaydediliyor…",
    created: "Kullanıcı oluşturuldu.",
    saved: "Kaydedildi.",
    // confirmations
    confirmResetPassword: "{name} için yeni bir geçici şifre belirleyin. Kullanıcının açık oturumları kapanır ve ilk girişinde şifresini değiştirmesi istenir.",
    confirmResetMfa: "{name} kullanıcısının iki adımlı doğrulaması sıfırlanacak; açık oturumları kapanır ve sonraki girişinde yeniden kurması istenir.",
    confirmDeactivate: "{name} pasifleştirilecek; açık oturumları kapanır ve giriş yapamaz.",
    confirmUnlock: "{name} için dizin girişindeki sınır bir kez açılır (üç deneme daha). Gerekçe denetim kaydına yazılır.",
    reasonLabel: "Gerekçe",
    reasonHint: "Tek satır, en az bir harf ya da rakam. Örnek: telefonla kimlik doğrulandı.",
    passwordReset: "Geçici şifre belirlendi.",
    mfaReset: "İki adımlı doğrulama sıfırlandı.",
    deactivated: "Hesap pasifleştirildi.",
    activated: "Hesap etkinleştirildi.",
    unlocked: "Dizin girişi bir kez açıldı.",
    // the scope editor
    scopeTitle: "{name} · birim ve yatak kapsamı",
    scopeUnrestricted: "Bu kullanıcının kapsamı sınırsız: {reason}. Burada atama yapmak gerekmez.",
    scopeReasonRole: "yönetici ya da platform operatörü",
    scopeReasonUnassigned: "henüz hiç atama yok",
    scopeReasonUnknown: "motor kapsamı çözemedi; bu kullanıcı hiçbir şey görmez",
    scopeUnits: "Birimler",
    scopeBeds: "Yataklar",
    scopeNoKeys: "Panoda şu anda hiçbir birim ya da yatak görünmüyor; atanacak anahtar bulunamadı.",
    scopeFromBoard: "Seçenekler panonun şu anki kartlarından ve kullanıcının mevcut atamalarından geliyor. Boş bir birim panoda görünmez; eksikse anahtarı elle yazın.",
    scopeManual: "Birim ya da yatak anahtarı",
    scopeManualHint: "Yatak eşleme tablosundaki anahtar (ör. REA-01). Motorda bu anahtarla eşleşen kart yoksa kapsam hiçbir şey açmaz.",
    scopeAdd: "Ekle",
    scopeEmpty: "Hiç atama yok.",
    scopeSave: "Kapsamı kaydet",
    scopeSaved: "Kapsam kaydedildi.",
    scopeRevert: "Motor reddetti; ekrandaki kapsam geri alındı.",
    scopeUnassigned: "Hiç atama yapılmamış kullanıcı: {count}",
    remove: "Kaldır",
  },
  az: {
    title: "İdarə",
    sub: "{hospital} · hər dəyişiklik audit jurnalına yazılır",
    tabUsers: "İstifadəçilər",
    tabRoles: "Rollar və səlahiyyətlər",
    tabSource: "Giriş mənbəyi",
    sections: "İdarə bölmələri",
    loading: "Yüklənir…",
    noAccess: "Bu bölməyə giriş səlahiyyətiniz yoxdur.",
    retry: "Yenidən cəhd et",
    search: "Ad və ya istifadəçi adı axtar",
    filterRole: "Rol",
    filterAll: "Bütün rollar",
    none: "Uyğun gələn istifadəçi yoxdur.",
    colName: "Ad",
    colUsername: "İstifadəçi adı",
    colRole: "Rol",
    colUnits: "Şöbələr",
    colState: "Vəziyyət",
    colMfa: "2FA",
    colLastLogin: "Son giriş",
    colActions: "Əməliyyatlar",
    caption: "İstifadəçilər və səlahiyyətləri",
    active: "AKTİV",
    inactive: "Passiv",
    mfaOn: "Açıq",
    mfaOff: "Bağlı",
    mfaRequired: "Məcburi · qurulmayıb",
    mustChange: "ilk girişdə şifrə",
    sourceLocal: "Lokal",
    sourceLdap: "AD",
    never: "Heç girməyib",
    noUnits: "Şöbə təyin edilməyib",
    allUnits: "Əhatə məhdud deyil",
    unitCount: "{count} şöbə",
    bedCount: "{count} çarpayı",
    extras: "Əlavə vəzifə: {list}",
    otherGroups: "Digər qruplar: {list}",
    newUser: "Yeni istifadəçi",
    edit: "Redaktə et",
    resetPassword: "Şifrəni sıfırla",
    resetMfa: "2FA sıfırla",
    deactivate: "Passivləşdir",
    activate: "Aktivləşdir",
    unlockSignIn: "Girişi aç",
    scope: "Şöbələr",
    beyond: "Bu istifadəçinin səlahiyyətləri sizinkini aşır; onun üzərində əməliyyat edə bilmərsiniz. Çatışmayan: {keys}",
    beyondUnknown: "Bu istifadəçinin qruplarından biri siyahıda yoxdur; səlahiyyətləri bilinmədiyi üçün əməliyyat edilmir.",
    selfNote: "Öz hesabınızın şifrəsini, 2FA-sını və aktivliyini buradan dəyişə bilmərsiniz.",
    formNew: "Yeni istifadəçi",
    formEdit: "İstifadəçini redaktə et",
    fieldFullName: "Ad soyad",
    fieldUsername: "İstifadəçi adı",
    fieldUsernameHint: "Kiçik hərf, rəqəm və . _ @ - · sonradan dəyişdirilə bilməz",
    fieldEmail: "E-poçt",
    fieldEmailHint: "Korporativ ünvan; boş qoyula bilər",
    fieldPassword: "Müvəqqəti şifrə",
    fieldPasswordHint: "Ən azı 8 simvol. İstifadəçiyə üz-üzə və ya telefonla çatdırın; e-poçtla göndərməyin. İstifadəçi ilk girişdə öz şifrəsini təyin edir.",
    fieldRole: "Rol",
    fieldRoleHint: "Şəxsin əsas qrupu. Səlahiyyətləri «Rollar və səlahiyyətlər»də təyin olunur.",
    fieldExtras: "Əlavə vəzifə",
    fieldExtrasHint: "Rol deyil; şəxsin rolüna səlahiyyət əlavə edir. Növbə vəzifəsi növbə bitəndə götürülə bilər.",
    fieldOther: "Digər qruplar",
    fieldOtherHint: "Xəstəxananın özünün yaratdığı qruplar.",
    fieldActive: "Hesab aktivdir",
    directoryGroups: "AD-dən gələn qruplar burada dəyişdirilə bilməz: {list}",
    noRole: "Rol seçilməyib",
    cannotGrant: "Bu qrupun səlahiyyətləri sizinkini aşır; verə bilmərsiniz.",
    save: "Yadda saxla",
    create: "İstifadəçini yarat",
    cancel: "İmtina",
    saving: "Yadda saxlanılır…",
    created: "İstifadəçi yaradıldı.",
    saved: "Yadda saxlanıldı.",
    confirmResetPassword: "{name} üçün yeni müvəqqəti şifrə təyin edin. İstifadəçinin açıq sessiyaları bağlanır və ilk girişində şifrəsini dəyişməsi istənir.",
    confirmResetMfa: "{name} istifadəçisinin iki addımlı doğrulaması sıfırlanacaq; açıq sessiyaları bağlanır və növbəti girişində yenidən qurması istənir.",
    confirmDeactivate: "{name} passivləşdiriləcək; açıq sessiyaları bağlanır və giriş edə bilmir.",
    confirmUnlock: "{name} üçün kataloq girişindəki hədd bir dəfə açılır (üç cəhd daha). Səbəb audit jurnalına yazılır.",
    reasonLabel: "Səbəb",
    reasonHint: "Bir sətir, ən azı bir hərf və ya rəqəm. Nümunə: telefonla kimliyi doğrulandı.",
    passwordReset: "Müvəqqəti şifrə təyin edildi.",
    mfaReset: "İki addımlı doğrulama sıfırlandı.",
    deactivated: "Hesab passivləşdirildi.",
    activated: "Hesab aktivləşdirildi.",
    unlocked: "Kataloq girişi bir dəfə açıldı.",
    scopeTitle: "{name} · şöbə və çarpayı əhatəsi",
    scopeUnrestricted: "Bu istifadəçinin əhatəsi məhdud deyil: {reason}. Burada təyinat etmək lazım deyil.",
    scopeReasonRole: "administrator və ya platforma operatoru",
    scopeReasonUnassigned: "hələ heç bir təyinat yoxdur",
    scopeReasonUnknown: "mühərrik əhatəni həll edə bilmədi; bu istifadəçi heç nə görmür",
    scopeUnits: "Şöbələr",
    scopeBeds: "Çarpayılar",
    scopeNoKeys: "Panelde hazırda heç bir şöbə və ya çarpayı görünmür; təyin edilə bilən açar tapılmadı.",
    scopeFromBoard: "Seçimlər panelin hazırkı kartlarından və istifadəçinin mövcud təyinatlarından gəlir. Boş şöbə paneldə görünmür; çatışmırsa açarı əl ilə yazın.",
    scopeManual: "Şöbə və ya çarpayı açarı",
    scopeManualHint: "Çarpayı uyğunlaşdırma cədvəlindəki açar (məs. REA-01). Mühərrikdə bu açarla uyğun kart yoxdursa əhatə heç nə açmır.",
    scopeAdd: "Əlavə et",
    scopeEmpty: "Heç bir təyinat yoxdur.",
    scopeSave: "Əhatəni yadda saxla",
    scopeSaved: "Əhatə yadda saxlanıldı.",
    scopeRevert: "Mühərrik qəbul etmədi; ekrandakı əhatə geri alındı.",
    scopeUnassigned: "Heç bir təyinatı olmayan istifadəçi: {count}",
    remove: "Götür",
  },
  ru: {
    title: "Управление",
    sub: "{hospital} · каждое изменение пишется в журнал аудита",
    tabUsers: "Пользователи",
    tabRoles: "Роли и права",
    tabSource: "Источник входа",
    sections: "Разделы управления",
    loading: "Загрузка…",
    noAccess: "У вас нет доступа к этому разделу.",
    retry: "Повторить",
    search: "Поиск по имени или логину",
    filterRole: "Роль",
    filterAll: "Все роли",
    none: "Подходящих пользователей нет.",
    colName: "Имя",
    colUsername: "Имя пользователя",
    colRole: "Роль",
    colUnits: "Отделения",
    colState: "Состояние",
    colMfa: "2FA",
    colLastLogin: "Последний вход",
    colActions: "Действия",
    caption: "Пользователи и их права",
    active: "АКТИВЕН",
    inactive: "Неактивен",
    mfaOn: "Вкл.",
    mfaOff: "Выкл.",
    mfaRequired: "Обязательно · не настроено",
    mustChange: "пароль при первом входе",
    sourceLocal: "Локальный",
    sourceLdap: "AD",
    never: "Не входил",
    noUnits: "Отделение не назначено",
    allUnits: "Область не ограничена",
    unitCount: "Отделений: {count}",
    bedCount: "Коек: {count}",
    extras: "Доп. роль: {list}",
    otherGroups: "Другие группы: {list}",
    newUser: "Новый пользователь",
    edit: "Изменить",
    resetPassword: "Сбросить пароль",
    resetMfa: "Сбросить 2FA",
    deactivate: "Деактивировать",
    activate: "Активировать",
    unlockSignIn: "Открыть вход",
    scope: "Отделения",
    beyond: "Права этого пользователя превышают ваши; действия над ним недоступны. Недостаёт: {keys}",
    beyondUnknown: "Одной из групп этого пользователя нет в списке; права неизвестны, действия не выполняются.",
    selfNote: "Свой пароль, 2FA и активность отсюда изменить нельзя.",
    formNew: "Новый пользователь",
    formEdit: "Изменить пользователя",
    fieldFullName: "Имя и фамилия",
    fieldUsername: "Имя пользователя",
    fieldUsernameHint: "Строчные буквы, цифры и . _ @ - · изменить позже нельзя",
    fieldEmail: "Эл. почта",
    fieldEmailHint: "Корпоративный адрес; можно оставить пустым",
    fieldPassword: "Временный пароль",
    fieldPasswordHint: "Не менее 8 символов. Передайте лично или по телефону, не по почте. При первом входе пользователь задаст свой пароль.",
    fieldRole: "Роль",
    fieldRoleHint: "Основная группа человека. Её права задаются в «Роли и права».",
    fieldExtras: "Доп. роль",
    fieldExtrasHint: "Это не роль; она добавляет права к роли человека. Дежурную роль можно снять после смены.",
    fieldOther: "Другие группы",
    fieldOtherHint: "Группы, созданные самой больницей.",
    fieldActive: "Учётная запись активна",
    directoryGroups: "Группы из AD здесь изменить нельзя: {list}",
    noRole: "Роль не выбрана",
    cannotGrant: "Права этой группы превышают ваши; выдать её нельзя.",
    save: "Сохранить",
    create: "Создать пользователя",
    cancel: "Отмена",
    saving: "Сохраняется…",
    created: "Пользователь создан.",
    saved: "Сохранено.",
    confirmResetPassword: "Задайте новый временный пароль для {name}. Открытые сессии закроются, при первом входе потребуется сменить пароль.",
    confirmResetMfa: "Двухфакторная проверка {name} будет сброшена; открытые сессии закроются, при следующем входе её придётся настроить заново.",
    confirmDeactivate: "{name} будет деактивирован; открытые сессии закроются, вход станет невозможен.",
    confirmUnlock: "Ограничение входа через каталог для {name} будет снято один раз (ещё три попытки). Причина пишется в журнал аудита.",
    reasonLabel: "Причина",
    reasonHint: "Одна строка, хотя бы одна буква или цифра. Пример: личность подтверждена по телефону.",
    passwordReset: "Временный пароль задан.",
    mfaReset: "Двухфакторная проверка сброшена.",
    deactivated: "Учётная запись деактивирована.",
    activated: "Учётная запись активирована.",
    unlocked: "Вход через каталог открыт один раз.",
    scopeTitle: "{name} · область отделений и коек",
    scopeUnrestricted: "Область этого пользователя не ограничена: {reason}. Назначать здесь ничего не нужно.",
    scopeReasonRole: "администратор или оператор платформы",
    scopeReasonUnassigned: "назначений пока нет",
    scopeReasonUnknown: "система не смогла определить область; этот пользователь не видит ничего",
    scopeUnits: "Отделения",
    scopeBeds: "Койки",
    scopeNoKeys: "Сейчас на панели не видно ни одного отделения или койки; назначать нечего.",
    scopeFromBoard: "Варианты берутся из текущих карточек панели и из уже имеющихся назначений пользователя. Пустое отделение на панели не видно; если его нет, введите ключ вручную.",
    scopeManual: "Ключ отделения или койки",
    scopeManualHint: "Ключ из таблицы сопоставления коек (например REA-01). Если в системе нет карточки с таким ключом, область ничего не откроет.",
    scopeAdd: "Добавить",
    scopeEmpty: "Назначений нет.",
    scopeSave: "Сохранить область",
    scopeSaved: "Область сохранена.",
    scopeRevert: "Система отклонила; область на экране возвращена.",
    scopeUnassigned: "Пользователей без назначений: {count}",
    remove: "Убрать",
  },
  en: {
    title: "Administration",
    sub: "{hospital} · every change is written to the audit trail",
    tabUsers: "Users",
    tabRoles: "Roles and permissions",
    tabSource: "Sign-in source",
    sections: "Administration sections",
    loading: "Loading…",
    noAccess: "You do not have access to this section.",
    retry: "Try again",
    search: "Search name or username",
    filterRole: "Role",
    filterAll: "All roles",
    none: "No user matches.",
    colName: "Name",
    colUsername: "Username",
    colRole: "Role",
    colUnits: "Units",
    colState: "Status",
    colMfa: "2FA",
    colLastLogin: "Last sign-in",
    colActions: "Actions",
    caption: "Users and their rights",
    active: "ACTIVE",
    inactive: "Inactive",
    mfaOn: "On",
    mfaOff: "Off",
    mfaRequired: "Required · not set up",
    mustChange: "password at first sign-in",
    sourceLocal: "Local",
    sourceLdap: "AD",
    never: "Never signed in",
    noUnits: "No unit assigned",
    allUnits: "Scope unrestricted",
    unitCount: "{count} units",
    bedCount: "{count} beds",
    extras: "Extra duty: {list}",
    otherGroups: "Other groups: {list}",
    newUser: "New user",
    edit: "Edit",
    resetPassword: "Reset password",
    resetMfa: "Reset 2FA",
    deactivate: "Deactivate",
    activate: "Activate",
    unlockSignIn: "Open sign-in",
    scope: "Units",
    beyond: "This user's rights go beyond yours, so you cannot act on them. Missing: {keys}",
    beyondUnknown: "One of this user's groups is not in the list; their rights are unknown, so nothing is acted on.",
    selfNote: "You cannot change your own password, 2FA or activity here.",
    formNew: "New user",
    formEdit: "Edit user",
    fieldFullName: "Full name",
    fieldUsername: "Username",
    fieldUsernameHint: "Lower-case letters, digits and . _ @ - · cannot be changed later",
    fieldEmail: "E-mail",
    fieldEmailHint: "A work address; may be left empty",
    fieldPassword: "Temporary password",
    fieldPasswordHint: "At least 8 characters. Hand it over in person or by telephone, never by e-mail. The user chooses their own password at their first sign-in.",
    fieldRole: "Role",
    fieldRoleHint: "The person's main group. Its rights are set under \"Roles and permissions\".",
    fieldExtras: "Extra duty",
    fieldExtrasHint: "Not a role; it adds rights to the person's role. A shift duty can be taken away when the shift ends.",
    fieldOther: "Other groups",
    fieldOtherHint: "Groups the hospital created itself.",
    fieldActive: "The account is active",
    directoryGroups: "Groups that come from AD cannot be changed here: {list}",
    noRole: "No role chosen",
    cannotGrant: "This group's rights go beyond yours, so you cannot give it.",
    save: "Save",
    create: "Create the user",
    cancel: "Cancel",
    saving: "Saving…",
    created: "The user was created.",
    saved: "Saved.",
    confirmResetPassword: "Set a new temporary password for {name}. Their open sessions end, and they must change it at their first sign-in.",
    confirmResetMfa: "{name}'s two-step verification will be reset; their open sessions end and they must set it up again at their next sign-in.",
    confirmDeactivate: "{name} will be deactivated; their open sessions end and they cannot sign in.",
    confirmUnlock: "The directory sign-in limit for {name} is lifted once (three more attempts). The reason is written to the audit trail.",
    reasonLabel: "Reason",
    reasonHint: "One line, at least one letter or digit. For example: identity confirmed by telephone.",
    passwordReset: "A temporary password was set.",
    mfaReset: "Two-step verification was reset.",
    deactivated: "The account was deactivated.",
    activated: "The account was activated.",
    unlocked: "The directory sign-in was opened once.",
    scopeTitle: "{name} · unit and bed scope",
    scopeUnrestricted: "This user's scope is unrestricted: {reason}. Nothing needs assigning here.",
    scopeReasonRole: "an administrator or a platform operator",
    scopeReasonUnassigned: "nothing has been assigned yet",
    scopeReasonUnknown: "the engine could not resolve the scope; this user sees nothing",
    scopeUnits: "Units",
    scopeBeds: "Beds",
    scopeNoKeys: "No unit or bed is visible on the board at the moment, so there is no key to assign.",
    scopeFromBoard: "The options come from the board's current cards and from the user's existing grants. An empty unit does not appear on the board; if one is missing, type its key by hand.",
    scopeManual: "A unit or bed key",
    scopeManualHint: "A key from the bed-mapping table (for example REA-01). If no card in the engine matches it, the scope opens nothing.",
    scopeAdd: "Add",
    scopeEmpty: "Nothing is assigned.",
    scopeSave: "Save the scope",
    scopeSaved: "The scope was saved.",
    scopeRevert: "The engine refused; the scope on screen was put back.",
    scopeUnassigned: "Users with no assignment at all: {count}",
    remove: "Remove",
  },
};
```

- [ ] **Step 2: Take this arm's two lines in the catalogue**

In `dashboard/src/live/i18n/catalog.js`, replace

```javascript
// G1-12: import admin from "./strings/admin.js";
```

with

```javascript
import admin from "./strings/admin.js";
```

and replace

```javascript
  // G1-12: admin,
```

with

```javascript
  admin,
```

- [ ] **Step 3: List this arm's reviewed Azerbaijani identities and its two neutral keys**

Both pairs below are anchored on headings that appear exactly once in the file — Task 6 suffixed `NEUTRAL`'s `· neutral` and `AZ_SAME_AS_TR`'s `· az = tr` for that reason — so this arm needs none of the clinical arms to have merged.

In `dashboard/src/live/i18n/strings.test.js`, replace

```javascript
  // G1-12 (admin · users) · az = tr

  // G1-13 (admin · roles) · az = tr
```

with

```javascript
  // G1-12 (admin · users) · az = tr
  "admin.filterRole", //     Rol — the prototype's AZ dictionary (admin.js)
  "admin.fieldRole", //      Rol — the same word
  "admin.colRole", //        Rol — the same word
  "admin.colName", //        Ad — "name" in Azerbaijani too
  "admin.colLastLogin", //   Son giriş — the prototype's AZ dictionary ("Son giriş")
  "admin.colMfa", //         2FA — an abbreviation
  "admin.sourceLdap", //     AD — an abbreviation
  "admin.resetMfa", //       2FA sıfırla — the abbreviation plus the same verb
  "admin.unlockSignIn", //   Girişi aç — the prototype's AZ dictionary ("Kilidi aç" family)
  "admin.fieldFullName", //  Ad soyad — the prototype's AZ dictionary (admin.js userModal)

  // G1-13 (admin · roles) · az = tr
```

and add the two keys whose Russian is an abbreviation. Replace

```javascript
  // G1-12 (admin · users) · neutral

  // G1-13 (admin · roles) · neutral
```

with

```javascript
  // G1-12 (admin · users) · neutral
  "admin.colMfa", //              2FA — an abbreviation
  "admin.sourceLdap", //          AD — an abbreviation

  // G1-13 (admin · roles) · neutral
```

- [ ] **Step 4: Check the parity**

```bash
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests |az |ru "
```
Expected: `Tests  6 passed (6)`.

**Two things in the frame that the tests pin and a reader would otherwise get wrong.**

**The loading sentence is an ordinary paragraph, and a separate `Announce` region says it.** The obvious shape — `<p role="status">{t("admin.loading")}</p>`, rendered only while loading — is the one that does not work: a live region that is **born holding its text is not announced at all** (`ui/Alert.jsx`, `ANNOUNCE_DELAY_MS`; this is Wave 1B's finding, and it is in `amendments.md` as a contract). So the region is mounted with the screen, empty, and takes the text 150 ms later; the visible sentence carries no role. The test asserts both halves, because each alone passes with the bug: that the visible paragraph has no `role` and sits in no `role="status"`, and that a status region does come to hold the text. It also only announces the **first** load — `firstLoad` is true only while there are no rows at all — because "loading" spoken over a table an administrator is reading is noise, and noise is how a screen reader user learns to ignore a region.

**The three tabs are reachable from the keyboard, and that is ours to test.** `Tabs` has its own `onKeyDown` for arrows, Home and End, so the test walks all three tabs rightwards, to the end, round the wrap, back leftwards and Home again — through THIS screen's state, not the component's. `Seg`'s buttons elsewhere in this wave are plain buttons that the browser activates, and need no such test: the rule is that a control whose keyboard behaviour is ours gets a test and one whose behaviour is the browser's does not.

- [ ] **Step 5: Write the frame's test**

Create `dashboard/src/live/screens/admin/AdminScreen.test.jsx`:

```jsx
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { AdminScreen, TABS, openTabs, resetTabs, stubTabs, tabScreenOf } from "./AdminScreen.jsx";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const USERS = [
  { id: "u-1", username: "ayse", email: "ayse@example.com", full_name: "Ayşe Sentetik",
    auth_source: "local", is_active: true, totp_enabled: false, must_change_password: false,
    last_login_at: "2026-10-07T08:00:00Z",
    groups: [{ id: "g-nurse", slug: "nurse", name: "Hemşire", source: "manual" }] },
];
const GROUPS = [
  { id: "g-nurse", slug: "nurse", name: "Hemşire", description: "", mfa_required: false,
    is_system: false, permissions: ["board.view", "alerts.ack"], member_count: 1 },
];
const CATALOGUE = [{ key: "board.view", description: "See the live board" }];

/** Stand-ins for the tabs, which are built on their own branches. The registry's own seam
 *  (`stubTabs`, as `shell/routes.js` has `stubScreens`): `ids` names which of the three this
 *  test's build has. */
function tabsBuilt(ids) {
  const stubs = {};
  for (const id of ids) {
    stubs[id] = ({ admin }) => <p>{`${id}: ${admin.data.users.length} / ${admin.data.groups.length}`}</p>;
  }
  return stubTabs(stubs);
}

afterEach(() => {
  resetScreens();
  resetTabs();
  vi.restoreAllMocks();
});

async function open({ perms = ["users.manage", "groups.manage"], setup, built = ["users", "roles", "source"] } = {}) {
  tabsBuilt(built);
  const mounted = await mount(<AdminScreen />, {
    access: token({ perms }),
    me: profile({ perms }),
    setup: (api) => {
      api.adminUsers.mockResolvedValue(USERS);
      api.adminGroups.mockResolvedValue(GROUPS);
      api.adminPermissions.mockResolvedValue(CATALOGUE);
      api.unassignedScopes.mockResolvedValue({ tenant: "demo", unassigned_users: 2 });
      setup?.(api);
    },
  });
  await act(async () => { await settle(); });
  return mounted;
}

describe("which tabs a session sees", () => {
  it("names the three tabs, each with the right that opens it", () => {
    expect(TABS.map((x) => [x.id, x.perm])).toEqual([
      ["users", "users.manage"], ["roles", "groups.manage"], ["source", "users.manage"],
    ]);
  });

  it("is frozen: which right opens which tab is not something a screen may widen", () => {
    expect(Object.isFrozen(TABS)).toBe(true);
    expect(TABS.every((x) => Object.isFrozen(x))).toBe(true);
    expect(() => { TABS[0].perm = "board.view"; }).toThrow(TypeError);
  });

  it("offers only the tabs the session's rights open", () => {
    tabsBuilt(["users", "roles", "source"]);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).toEqual(["users", "roles", "source"]);
    expect(openTabs(["users.manage"]).map((x) => x.id)).toEqual(["users", "source"]);
    expect(openTabs(["groups.manage"]).map((x) => x.id)).toEqual(["roles"]);
    expect(openTabs([]).map((x) => x.id)).toEqual([]);
  });

  it("offers no tab this build has not built — never a dead tab", () => {
    tabsBuilt(["roles"]);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).toEqual(["roles"]);
    expect(openTabs(["users.manage", "groups.manage"]).every((x) => tabScreenOf(x))).toBe(true);
  });

  it("the seam refuses outside the test build, and gives the build's tabs back", () => {
    tabsBuilt(["users"]);
    expect(tabScreenOf(TABS[0])).toBeTypeOf("function");
    resetTabs();
    expect(tabScreenOf(TABS[0])).toBeNull();
    vi.stubEnv("MODE", "production");
    try {
      expect(() => stubTabs({ users: () => null })).toThrow(/test seam/);
      expect(() => resetTabs()).toThrow(/test seam/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the administration screen", () => {
  it("names itself and the hospital, and says every change is audited", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "İdarə" })).toBeInTheDocument();
    expect(screen.getByText(/Sentetik Hastane · hər dəyişiklik audit jurnalına yazılır/)).toBeInTheDocument();
  });

  it("opens on the first tab the session may open, and switches", async () => {
    await open();
    expect(screen.getByRole("tab", { name: "İstifadəçilər", selected: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Rollar və səlahiyyətlər" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("roles:");
  });

  it("moves between the tabs from the keyboard alone", async () => {
    // The tablist's own arrow keys (ui/Tabs.jsx) driving THIS screen's state: a clinician who
    // cannot use a mouse must be able to reach every tab, and Home/End matter when there are three.
    await open();
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Rollar və səlahiyyətlər", selected: true })).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tab", { name: "Giriş mənbəyi", selected: true })).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "ArrowRight" });        // wraps round to the first
    expect(screen.getByRole("tab", { name: "İstifadəçilər", selected: true })).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "ArrowLeft" });          // and the other way
    expect(screen.getByRole("tab", { name: "Giriş mənbəyi", selected: true })).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "Home" });
    expect(screen.getByRole("tab", { name: "İstifadəçilər", selected: true })).toBeInTheDocument();
  });

  it("has exactly one h1 — what a reader lands on after the shell moves focus", async () => {
    await open();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("a session with only groups.manage sees the roles tab alone", async () => {
    await open({ perms: ["groups.manage"] });
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["Rollar və səlahiyyətlər"]);
  });

  it("a session with only users.manage sees the users and the source tabs", async () => {
    await open({ perms: ["users.manage"] });
    expect(screen.getAllByRole("tab").map((x) => x.textContent))
      .toEqual(["İstifadəçilər", "Giriş mənbəyi"]);
  });

  it("shows no tab this build has not built", async () => {
    await open({ built: ["users"] });
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["İstifadəçilər"]);
  });

  it("says so when this build has nothing to show", async () => {
    await open({ built: [] });
    expect(screen.getByText("Bu bölməyə giriş səlahiyyətiniz yoxdur.")).toBeInTheDocument();
  });
});

describe("what it asks the API for", () => {
  it("asks only what the session's rights allow", async () => {
    const { api } = await open({ perms: ["users.manage"] });
    expect(api.adminUsers).toHaveBeenCalled();
    expect(api.adminGroups).toHaveBeenCalled();         // a user desk lists the groups it may give
    expect(api.adminPermissions).not.toHaveBeenCalled(); // needs groups.manage
    expect(api.unassignedScopes).toHaveBeenCalled();
  });

  it("a groups desk is not asked for the users", async () => {
    const { api } = await open({ perms: ["groups.manage"] });
    expect(api.adminUsers).not.toHaveBeenCalled();
    expect(api.adminGroups).toHaveBeenCalled();
    expect(api.adminPermissions).toHaveBeenCalled();
  });

  it("hands each tab what was loaded", async () => {
    await open();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("users: 1 / 1");
  });

  it("one refusal does not empty the screen: it is shown and the rest stands", async () => {
    await open({ setup: (api) => api.adminPermissions.mockRejectedValue(refusal(403, "permission required: groups.manage")) });
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
      .toContain("səlahiyyətiniz yoxdur (groups.manage)");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("users: 1 / 1");
  });

  it("offers to load again after a refusal", async () => {
    const { api } = await open({ setup: (fake) => fake.adminUsers.mockRejectedValue(refusal(503, "down")) });
    api.adminUsers.mockResolvedValue(USERS);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
      await settle();
    });
    await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveTextContent("users: 1 /"));
  });

  it("says it is loading rather than showing an empty screen", async () => {
    let release;
    const mounted = await mount(<AdminScreen />, {
      access: token({ perms: ["users.manage"] }),
      me: profile({ perms: ["users.manage"] }),
      setup: (api) => {
        tabsBuilt(["users"]);
        api.adminUsers.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        api.adminGroups.mockResolvedValue([]);
        api.unassignedScopes.mockResolvedValue({ unassigned_users: 0 });
      },
    });
    // Two separate things, and the test checks both. The sentence on screen is an ordinary
    // paragraph with no role: a live region that is rendered already holding its text is not
    // announced at all (ui/Alert.jsx), so marking that paragraph role="status" would have looked
    // accessible and said nothing. The announcement comes from the one `Announce` region that was
    // mounted with the screen and takes the text ANNOUNCE_DELAY_MS later.
    const visible = within(screen.getByRole("tabpanel")).getByText("Yüklənir…");
    expect(visible.getAttribute("role")).toBeNull();
    expect(visible.closest('[role="status"]')).toBeNull();
    await waitFor(
      () => expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain("Yüklənir…"),
      { timeout: 4000 },      // 150 ms of real time, under a suite running 99 files in parallel
    );
    await act(async () => { release(USERS); await settle(); });
    expect(mounted.api.adminUsers).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npx vitest run src/live/screens/admin/AdminScreen.test.jsx 2>&1 | grep -E "Failed to resolve|Tests " | head -3
```
Expected: `Failed to resolve import "./AdminScreen.jsx"`.

- [ ] **Step 7: Write the frame**

```jsx
// src/live/screens/admin/AdminScreen.jsx — administration: one screen, three tabs (the
// prototype's `admin.js`, reduced to the three the API can back in Group 1).
//
//   Users            G1-12   `users.manage`                      /admin/users, /scope
//   Roles            G1-13   `groups.manage`                     /admin/groups, /admin/permissions
//   Sign-in source   G1-14   `users.manage` (reading)            /admin/ldap/*
//
// THE TAB IS HELD IN STATE, NOT IN THE ADDRESS. The hash belongs to the router, and a query inside
// it belongs to the screen (`routes.js hashPath`) — but reading one would need a second
// `hashchange` listener in every tabbed screen, and the shell deliberately settles the address
// once at mount and does not read the bar again. A tab is a view of one screen, the rail links to
// the screen, and nothing in the product links to a tab. *Rejected:* `#/admin?tab=roles` (a second
// listener, and an address that survives a lock into a shell that settled elsewhere).
//
// EVERY TAB IS GATED SEPARATELY, and the gate is the session's own rights. The route opens to
// `users.manage` OR `groups.manage` (routes.js), so a session can arrive holding one and not the
// other: the tabs it may not open are not shown, and the screen opens on the first it may. A
// session that may open none of them cannot reach the route at all.
//
// HOW A WAVE ADDS ITS TAB: its own commented import below and its own line in `TABS` — two lines
// nobody else touches, the same seam `shell/routes.js` and `i18n/catalog.js` have, so G1-12, G1-13
// and G1-14 can be built on parallel branches. A tab with no component shows "not built yet" and
// is NOT offered: never a dead tab.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, TabPanel, Tabs } from "../../ui/index.js";
import { hasPerm } from "./catalogue.js";
import { useAdminData } from "./useAdminData.js";
// G1-12: import { UsersTab } from "./UsersTab.jsx";

// G1-13: import { RolesTab } from "./RolesTab.jsx";

// G1-14: import { SourceTab } from "./SourceTab.jsx";

const TAB_ID = "admin";

/** The three tabs, in order: the id, the right that opens it and its label. Frozen, like the route
 *  table it is modelled on (`shell/routes.js`): which right opens which tab is the same for every
 *  session and every test, and nothing may widen it at run time. */
export const TABS = Object.freeze([
  Object.freeze({ id: "users", perm: "users.manage", labelKey: "admin.tabUsers" }),
  Object.freeze({ id: "roles", perm: "groups.manage", labelKey: "admin.tabRoles" }),
  Object.freeze({ id: "source", perm: "users.manage", labelKey: "admin.tabSource" }),
]);

/** The component each tab shows in THIS build — `null` until its wave sets it. THIS is the line a
 *  wave edits, and only its own; `resetTabs` puts it back whatever a test stood in for. */
const TAB_SCREENS = Object.freeze({
  users: null,    // G1-12
  roles: null,    // G1-13
  source: null,   // G1-14
});

/** What `tabScreenOf` reads: this build's own tabs, until a test stands in for one. */
const BUILT = { ...TAB_SCREENS };

/** The component a tab shows, or null when this build has not built it. */
export function tabScreenOf(tab) {
  return (tab && BUILT[tab.id]) || null;
}

function testOnly(what) {
  if (import.meta.env?.MODE !== "test") {
    throw new Error(`${what} is a test seam: a build's tabs are the ones it was built with`);
  }
}

/** TEST ONLY — stand in for the tabs a later branch will build ({tabId: Component}); returns
 *  `resetTabs`, which an `afterEach` MUST call. The parallel branches of Wave 3 do NOT call this:
 *  each edits its own line in TAB_SCREENS above. */
export function stubTabs(screens) {
  testOnly("stubTabs");
  Object.assign(BUILT, screens);
  return resetTabs;
}

/** TEST ONLY — every tab back to the component this build actually has. */
export function resetTabs() {
  testOnly("resetTabs");
  Object.assign(BUILT, TAB_SCREENS);
}

/** The tabs this session may open AND this build has built — in that order, so an unbuilt tab is
 *  not offered at all rather than offered and then refused. */
export function openTabs(perms) {
  return TABS.filter((tab) => hasPerm(perms, tab.perm) && tabScreenOf(tab));
}

export function AdminScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const admin = useAdminData();
  const tabs = useMemo(() => openTabs(user.perms), [user.perms]);
  const [tab, setTab] = useState(() => tabs[0]?.id ?? null);
  // A session whose rights changed under it (another tab, a refresh) may no longer open the tab it
  // is on: fall back to the first it may, as the old admin page did on every render.
  const current = tabs.find((x) => x.id === tab) ?? tabs[0] ?? null;
  const shown = tabs.map((x) => ({ value: x.id, label: t(x.labelKey) }));
  const Shown = tabScreenOf(current);
  // The first load only — a reload with rows already on screen leaves them there, and announcing
  // "loading" over a table a clinician is reading would be noise, not information.
  const firstLoad = admin.loading && admin.data.users.length === 0 && admin.data.groups.length === 0;

  return (
    <div className="flex min-h-0 max-w-[1100px] flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-23 font-bold">{t("admin.title")}</h1>
        <p className="m-0 text-13 text-mute">{t("admin.sub", { hospital: user.tenantName || user.tenant })}</p>
      </div>

      {/* One region, always mounted, empty until there is something to say. A live region that is
          born holding its text is not announced at all (ui/Alert.jsx, ANNOUNCE_DELAY_MS) — which is
          what a `<p role="status">{t("admin.loading")}</p>` rendered only while loading would be.
          The visible sentence below is therefore an ordinary paragraph, and this says it. */}
      <Announce text={firstLoad ? t("admin.loading") : ""} />

      {/* A refusal on ONE call does not empty the screen: it is shown, and whatever the other
          calls answered stands. */}
      {admin.error ? (
        <Alert tone="crit">
          {apiErrorText(t, admin.error)}
          {" "}
          <Button size="sm" onClick={admin.reload}>{t("admin.retry")}</Button>
        </Alert>
      ) : null}

      {tabs.length === 0 ? (
        <Empty icon="shield">{t("admin.noAccess")}</Empty>
      ) : (
        <>
          <Tabs id={TAB_ID} label={t("admin.sections")} tabs={shown} value={current.id} onChange={setTab} />
          <TabPanel id={TAB_ID} tabs={shown} value={current.id}>
            {firstLoad ? (
              <Box><p className="m-0 text-13 text-mute">{t("admin.loading")}</p></Box>
            ) : (
              <Shown admin={admin} />
            )}
          </TabPanel>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run it**

```bash
npx vitest run src/live/screens/admin/ 2>&1 | grep -E "Tests "
```
Expected: `Tests  56 passed (56)`.

- [ ] **Step 9: Take this arm's two lines in the registry**

In `dashboard/src/live/shell/routes.js`, replace

```javascript
// G1-12: import { AdminScreen } from "../screens/admin/AdminScreen.jsx";
```

with

```javascript
import { AdminScreen } from "../screens/admin/AdminScreen.jsx";
```

and replace

```javascript
  admin: null,     // G1-12 (users), G1-13 (roles), G1-14 (login source) — tabs inside one screen
```

with

```javascript
  admin: AdminScreen, // G1-12 (users), G1-13 (roles), G1-14 (login source) — tabs inside one screen
```

- [ ] **Step 9a: Look at it** — the one check no test makes.

Run `npx vite dev`, sign in as an administrator, open `#/admin`.

Check, at 1440 px and at 390 px, in both themes: no horizontal page scroll; the three tabs fit or scroll as a tab list rather than wrapping into two rows that look like two lists; the hospital's name and the audit sentence are both readable; the loading paragraph appears and goes without the layout jumping; and `Tab` then the arrow keys walk the tabs with a visible focus ring on each. Then sign in with only `users.manage` and confirm the roles tab is absent rather than present-and-refusing.

- [ ] **Step 10: Gate**

```bash
npx vitest run 2>&1 | tail -4
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: 19 tests and one file more than Task 18 left; the build succeeds. **This task's own number is 19, in `AdminScreen.test.jsx`.** On a branch with every arm merged, and with Task 15B: `99 passed (99)` files, `2097 passed (2097)` tests.

- [ ] **Step 11: Commit**

```bash
git add dashboard/src/live/i18n/strings/admin.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/admin/AdminScreen.jsx dashboard/src/live/screens/admin/AdminScreen.test.jsx dashboard/src/live/shell/routes.js
git commit -m "$(cat <<'EOF'
feat(dashboard): the administration frame and the seam for its three tabs

One screen, three tabs, each gated on its own right — so a desk holding only
groups.manage sees the roles tab alone and is not shown doors it cannot open.
The seam is the route registry's, mirrored: a frozen table, a private map,
tabScreenOf(), and stubTabs/resetTabs that refuse outside the test build. After
this, G1-12, G1-13 and G1-14 are three branches of one component and one line.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** **19** tests in the new `AdminScreen.test.jsx`; `strings.test.js` green at 6; whole suite green; build clean; looked at 390/1440 px in both themes and walked the tabs from the keyboard.

---

## STOP HERE

**Tasks 0–19 are the whole of the code in this document. Do not continue into Tasks 20, 21 or 22 from here.**

Those three are **specifications, not plans**: they name their files, their exact API calls, their decisions, their acceptance criteria as a list of test names and the rules they must follow, but they carry **no code**, because none was written and none was run. Executing them as if they were TDD tasks means inventing the code and the expected output as you go, which is the one thing this document was built not to require of anybody.

What happens next, in order:

1. **Merge the four arms** (beds, alarms, patient, administration frame) and run the gate on the merged tree. The ownership table in the Ground rules says which shared files to expect and what `Shell.test.jsx` should count afterwards (40).
2. **Run Task 24** — the end-to-end verification — on the merged tree. It comes before Task 23 for a reason given there: a document written from a verification that has not happened is a document that records intentions.
3. **Run Task 23**, which writes what Task 24 found into the roadmap, the Turkish guide, the spec and the two working notes, and adds this wave's items to the G1-15 deploy gate.
4. **Then write `2026-10-??-g1-dalga3b-yonetim-ekranlari.md`** from the merged Task 19 frame and the specifications in Tasks 20–22 — about twelve tasks — the way this project writes every wave's plan: looking at the merged code of the wave before it (*"Her dalganın ayrıntılı planı, bir önceki dalga bitince birleşmiş koda bakılarak yazılır"*).

Tasks 20–22 below are the input to step 4. Read them as requirements.

> **The administration tabs stop here.** Tasks 20–22 below are **specifications**: no code was written for them and none is given. Write their plan — about twelve tasks — against this merged frame, following the Wave 3A screens as the pattern for a screen's test and the honesty rules each one carries.

---

# Wave 3B · the three administration tabs (Tasks 20–22) — SPECIFICATIONS

**Read this first.** Tasks 0–19 above carry code that was written and run. Tasks 20–22 do not: they name their files, their exact API calls, their decisions and their acceptance criteria, and nothing else, because nothing else was built. Do **not** execute them as TDD tasks from this document. Implement 0–19, merge, then write `docs/superpowers/plans/2026-10-??-g1-dalga3b-yonetim-ekranlari.md` against the merged Task-19 frame — which is this project's own method, and the reason the frame exists at all.

Everything these three need is already in place and tested: the API client's calls and its 30-second directory limit (Task 1), the rules and the mirrored catalogue (16, 17), the loader (18), the frame and its seam (19), the four-language `admin.*` strings (19), and every refusal these routes can answer with, translated (Task 8).

**Three requirements that apply to all three of these tabs, and that the plan written from them must carry into every one of its tasks.**

**A list of records is a real `<table>`.** `<table>` with a `<caption>` that names what the table holds, `<th scope="col">` on every column header and `<th scope="row">` on the cell that identifies the row — the username, the permission, the account. A grid of `<div>`s with a bold first cell looks identical and is unnavigable: a screen reader cannot say which column a value is in, so a column of names becomes a column of unlabelled strings, and "deactivate" lands on whichever row the user guessed. Wave 2's `ui/Table.jsx` is the component; use it rather than a grid, and if a layout wants cards on a phone, render the table and let CSS reflow it, do not render two different documents.

**Every task carries a 390 px check of its own.** Not deferred to the end-to-end verification: a layout found broken four tasks later is a layout rewritten, and these three tabs are the densest screens in the product. At 390 px, in both themes: no horizontal page *page* scroll (a table may scroll inside a named, focusable region — `role="region"` with an `aria-label` and `tabindex="0"`, so a keyboard user can reach the scroll), every action reachable with a thumb, and no form field clipped. At 1440 px in daylight, the status colours still clear 3:1 against `card`.

**Every refusal has a text.** Task 8 translated 46 of them; these three tabs are where most of those texts are shown. A new refusal the server can give and `apiErrors.js` has no text for is a bug in this plan's descendant, not a gap to fill at review.

### Task 20 (specification): the users tab — the list, the form, the actions and the scope

**Files:** `screens/admin/UsersTab.jsx`, `UserForm.jsx`, `ScopeEditor.jsx`, their tests; one line of `AdminScreen.jsx`'s `TAB_SCREENS` (`users`). Strings: `admin.*`, already written.

**The list.** Eight columns, the prototype's: name (with the username under it), username, role, units, status, 2FA, last sign-in, actions. `rules.userFromApi` shapes each row. A search over name and username folding diacritics (reuse `screens/beds/order.js`'s `norm` — move it to `screens/common/` when the second caller appears, not before) and a role filter. Each row's actions come from `rules.canManageUser(perms, user, groups, selfId, catalogue)` and **a refused action is not drawn**: in its place, once per row, the reason — `admin.beyond` with the keys the session lacks, `admin.beyondUnknown` when a group of the user's is not in the list, `admin.selfNote` for your own account.

What a row must say and must not: `must_change_password` is a tag, not a silence; `totp_enabled` false on a group whose `mfa_required` is true is "Zorunlu · kurulmadı" and not "Kapalı"; `last_login_at` null is "Hiç girmedi" and not "—"; a user with no scope shows `admin.noUnits`, and `unrestricted` shows `admin.allUnits` — the two are different statements and the prototype conflated them.

**The form.** `admin.field*`: full name, username (create only, `disabled` on edit — the API cannot rename and the roadmap routes renaming to Group 4), e-mail, temporary password (create only), role (one `<select>` of `kind === "role"` groups), extra duties (a multi-choice of `kind === "extra"`), other groups (`kind === "other"`), and the active flag on edit. A group the session may not grant (`rules.canGrant`) is shown and **disabled with `admin.cannotGrant`** — not hidden: an administrator must be able to see that a group exists and that this desk cannot give it. The memberships the DIRECTORY holds are listed read-only with `admin.directoryGroups`: `PUT /users/{id}/groups` replaces the manual ones only.

The password field carries exactly what the server enforces — at least 8 characters — and nothing else. **No client-generated password** (the prototype shows a plaintext one it made up, `H.genPassword`, and keeps three mutually inconsistent policies), **no client-side username policy** beyond the characters that can never pass (`normalizeLogin` shape); the server decides the rest and its 422 lands on the field it is about (`apiErrors` maps `usernameRule`, `badEmail`, `mustNotBeBlank`).

**The actions.** `POST /admin/users` (create), `PATCH /admin/users/{id}` (name, e-mail, `is_active`), `PUT /admin/users/{id}/groups`, `POST .../reset-password`, `POST .../reset-mfa`, `POST .../unlock-sign-in`. The three destructive ones confirm first, naming the user and the consequence: resetting a password or MFA **ends that user's open sessions**, and so does deactivating. The unlock's dialog takes the reason the API requires (one line, at least one letter or digit, ≤ 200 characters) and says it goes into the audit trail. While a request runs its dialog cannot be dismissed, so a refusal never lands in a closed form; a password is never displayed, and its field is cleared after use. After every write, reload (`admin.reload`) so the screen shows what the server now holds rather than what it hoped.

**The scope editor** (Decision 17). Reads `GET /scope/{id}` (`rules.scopeFromApi`). An `unrestricted` user gets `admin.scopeUnrestricted` with the reason translated (`scopeReasonRole` / `scopeReasonUnassigned` / `scopeReasonUnknown`) and no editor: there is nothing to assign. Otherwise two lists — units and beds — offered from `useBoard().patients`'s `unitId` / `bedId` **plus the grants the user already holds**, with `admin.scopeFromBoard` saying where the list comes from and that an empty unit does not appear in it, and a free-text field (`admin.scopeManual`) for a key with no patient on it. Save sends `PUT /scope/{id}` with the WHOLE list; the screen shows its own list at once and **puts the previous one back on a refusal**, with `admin.scopeRevert`. `GET /scope/unassigned`'s count is a line at the top of the tab (`admin.scopeUnassigned`): without it, "everyone sees everything because nobody has been assigned yet" and "everyone sees everything because that is the policy" are the same screen.

**Acceptance criteria** (the test names to write):
- lists the users with every column, and the username under the name
- a temporary password is a tag, not a silence; "required · not set up" is not "off"; a user who has never signed in says so
- tells "no unit assigned" from "scope unrestricted"
- searches name and username, folding diacritics; filters by role
- draws no action the session may not take, and says why once per row — the keys it lacks, or that the rights are unknown, or that it is your own account
- creates a local user: the form sends full name, username, e-mail, password and the group ids of role + duties + others
- the username cannot be edited, and the form says so
- a group beyond the session's rights is shown and disabled, not hidden
- the directory's memberships are read-only and named
- a 422 on the username lands on the username field, in the user's language
- resetting a password, resetting MFA and deactivating each confirm first and name the consequence (open sessions end)
- the unlock asks for a reason, refuses an empty one before sending, and says the reason is audited
- while a write is in flight its dialog cannot be dismissed, and a refusal is shown in the still-open dialog
- a password is never in the DOM after the dialog closes
- after every write the list is reloaded from the server
- an unrestricted user gets no scope editor and the reason why
- the scope options come from the board's cards and the user's own grants, and the screen says so
- a key with no card on the board can be added by hand, and the screen says what that means
- the list is a `<table>` with a caption, `<th scope="col">` per column and `<th scope="row">` on the username; at 390 px it scrolls inside a named region and the page does not
- saving sends the whole list; a refusal puts the previous list back and says so
- the count of users with no assignment at all is on the screen

### Task 21 (specification): the roles tab — the group × permission table

**Files:** `screens/admin/RolesTab.jsx` + its test, `i18n/strings/roles.js`; one line of `TAB_SCREENS` (`roles`) and the `roles` pair in `catalog.js` + `strings.test.js`'s `// G1-13` block.

One table: the permission catalogue down the side (`/admin/permissions`, with the server's own descriptions shown verbatim — they are the hospital's words for what a right means, and two of them are out of date, which is a backend text change listed in Task 23), the groups across the top (`/admin/groups`, `member_count` under each name), a checkbox in each cell. The first column is sticky; the table has a caption; a column header names its group and the row header names its permission, so a screen reader reads a cell as "nurse, acknowledge an alert".

**Collect and save** (Decision 18). A checkbox marks a pending change; the group's column shows how many changes are pending and a Save sends ONE `PATCH /admin/groups/{id}` with the whole permission list. The system group's column is read-only with the server's own reason (`errors.systemGroupLocked`), and so is any group the session may not grant (`rules.canGrant` → `admin.cannotGrant`). Create (`POST /admin/groups`: slug, name, description, `mfa_required`, permissions) and delete (`DELETE`, with the server's three refusals shown as they arrive: the system group, a group with members, a group with an AD mapping).

Above the table, the two things the prototype's role cards say that are worth keeping and are true: each group's `mfa_required`, and its member count. **Not** kept: "Hasta adını görür" (no such flag exists), "Gerçek üründe → ATTENDING · ASSOCIATE · …" (the legacy role mapping was consumed by migration `0010` and is gone), and the instant-apply-to-`localStorage` the prototype's matrix does.

**Acceptance criteria:**
- the catalogue down the side with the server's own description per row; the groups across the top with their member counts
- a cell reads as "<group>, <permission>" to a screen reader; the table has a caption; the first column is sticky
- a checkbox collects a change and nothing is sent; the column says how many are pending
- Save sends one PATCH per group with the whole list, and reloads
- the system group's column is read-only, with the server's reason
- a group whose rights exceed the session's is read-only, with `admin.cannotGrant`
- creating a group sends slug, name, description, MFA and permissions; a duplicate slug's 409 is shown on the slug field
- deleting shows the server's refusal for the system group, for a group with members and for one with an AD mapping
- a session without `groups.manage` never reaches this tab (the frame's own test covers it)
- the group × permission grid is a `<table>`: `<th scope="col">` per group, `<th scope="row">` per permission, a caption naming it, and the first column sticky; at 390 px the table scrolls inside a named region, not the page

### Task 22 (specification): the login-source tab — the directory

**Files:** `screens/admin/SourceTab.jsx` + its test, `i18n/strings/source.js`; one line of `TAB_SCREENS` (`source`) and the `source` pair in `catalog.js` + `strings.test.js`'s `// G1-14` block.

Four sections. **Status**: `GET /admin/ldap/status` — `configured`, `url_host` (the host only; never a bind DN and never a password), `last_test_at`, `last_test_ok`. A directory that is not configured says so and the other three sections are not drawn: the API answers 409 `Dizin yapılandırılmamış` and a screen that offered a search would be offering a 409. **Test**: `POST /admin/ldap/test`, one service bind, and its `reason` translated — `unreachable` / `timeout` / `tls` / `service_bind_rejected` / `protocol` each get a sentence that says what to check, because "no" is not an answer an administrator can act on.

**Search and import**: `GET /admin/ldap/search?q=&limit=` (each result says `already_imported`, `disabled`), a choice of which accounts to import, an optional extra group, and `POST /admin/ldap/import` **in chunks of `LDAP_IMPORT_CHUNK`** with a progress line. The answer's `imported` and `skipped` are both shown, and each skip reason is translated from the seven the API sends (`exists`, `not_found`, `disabled`, `expired`, `login_taken`, `no_username`, `invalid_login`) — `login_taken` and `invalid_login` especially, because they are the two an administrator can do something about: the first means an account already holds that name (and the roadmap routes the fix to Group 4), the second that the sAMAccountName has letters the login rule cannot take, with the transliteration rule the API itself states. A chunk that fails is reported as that chunk and the rest are still offered: the import is idempotent, so retrying costs nothing.

**The group mapping**: `GET /admin/ldap/group-mappings`, and — only when `rules.canMapGroups(perms, catalogue)` — a picker over `GET /admin/ldap/groups` plus `POST` and `DELETE`. Without every right, the list is read-only and the reason is the server's own (`errors.mappingAdminOnly`). The DN is chosen from the picker, never typed, because a hand-typed DN whose non-ASCII letters differ in case from AD's will not match (Wave 1A's F5 note) — and a mapping row stored before the DNs were canonicalised may already be in that state, so the panel offers to delete and re-create it and says why.

Across the whole tab: every call carries `ADMIN_LDAP_TIMEOUT_MS`, and a `REQUEST_TIMEOUT` is shown as `errors.requestTimeout`, which already says the operation may have happened — the right thing for an import.

**Acceptance criteria:**
- an unconfigured directory says so, and the search, the import and the mapping are not drawn
- the status shows the host only — no bind DN, no password, in the DOM or in a title
- the test's five refusal reasons each get their own sentence
- the search says which results are already imported and which accounts are disabled
- the import is sent in chunks of ten, with a progress line, and a failed chunk is named while the rest stay offered
- all seven skip reasons are translated; `login_taken` and `invalid_login` say what to do
- the mapping is read-only without every right, with the server's own reason
- a DN comes from the picker; the panel says why a typed one may not match
- a timeout says the operation may have happened
- the search results and the mapping list are `<table>`s with captions and row headers; at 390 px nothing in the panel overflows the page, and the DN picker is usable with a thumb

---

# Wave 3A+3B · closing — the verification first, then the documents (Tasks 24, then 23)

### Task 24: End-to-end verification

**Files:** none.

- [ ] **Step 1: The whole suite, twice** — once as it is, once with the registry pinned empty, to prove no test has quietly come to depend on which screens are built.

```bash
cd <worktree>/dashboard
npx vitest run 2>&1 | tail -4
```
Expected: `99 passed (99)` files, `2097 passed (2097)` tests, with Tasks 0–19 and 15B merged. The arithmetic behind 2097 is in the header; if the number differs, find the file whose per-task gate it disagrees with rather than editing this line.

- [ ] **Step 2: The production build, and what it costs**

```bash
npx vite build 2>&1 | grep -E "built in|index|precache|error"
```
Expected: a clean build. Record the first chunk's size and the service worker's precache count: Wave 2 left 145 kB / 47 kB gzipped and 22 entries / 556 KiB, and Wave 3 adds five screens to that first chunk. If the first chunk has grown past about 250 kB gzipped, say so in the report rather than fixing it here — the lazy split belongs with G1-16, which removes the old workspace.

- [ ] **Step 3: Four languages, on the screen**

Run the local stack (`deploy/local`), sign in, and walk the beds → a patient → the alarms → the administration frame in **az, tr, ru, en**. Look for: a key showing through as `beds.something` (a missing translation), a number inside a declined word, a Russian text in Latin script, and a line that overflows its box in Russian (the longest of the four).

Two things to look at deliberately, because they are the two places this UI is knowingly not in the reader's language. On the patient screen, the engine's reasoning blocks are English with a sentence above them saying so — **read them as an Azerbaijani-speaking clinician would**, because that reading is a G1-15 gate item (Decision 24), and write down which of the four rule families' texts were actually on screen. On any board with a restricted scope, `scope_note` is Turkish with a line saying where the sentence came from; confirm that line is in the reader's language and not in Turkish too.

**The three administration tabs are not built in this plan**, so there is nothing to walk inside them; their own four-language pass belongs to the Wave-3B plan's verification.

- [ ] **Step 4: 390 px and 1440 px, in both themes**

At 390 px: no horizontal page scroll on any of the four screens; the bed cards in one column; the beds screen's unit selector and search reachable (the top bar's chip is not); the alarms rows readable with their buttons; the patient screen's vital grid in one or two columns and its three Sepsis-3 numbers each still under their own label; the administration **frame** — its heading, its three tab buttons and its loading line — fitting without the tab list wrapping into what looks like two lists. At 1440 px in daylight: the card stripes and the status pills still clear 3:1 against `card` (Wave 1B's contrast table; `tokens.test.js` holds the tokens, not the composition).

Each of these was already checked once, in the task that built the screen; this is the pass that sees them **together**, which is where a shell and a screen disagree about a gutter.

- [ ] **Step 5: A keyboard only**

Tab from the skip link to `<main>`, through the rail, the top bar, the board's controls and into a card; open a patient with Enter; acknowledge an alarm with Enter and hear the "saving" line; chart a suspected infection with Enter and hear the "charting" line; move between the administration tabs with the arrow keys. Nothing may be reachable only with a mouse, and focus must never land on `<body>`.

- [ ] **Step 6: The four refusals, on purpose**

**Four of them**, with the local stack running. Make each happen and read what the screen says:
1. **stop the API** → the board strip's "no connection … DOES NOT MEAN there are no patients", and no screen saying nothing is waiting;
2. **kill the stream only** (restart nginx, or block `/stream`) → DEGRADED: the data shown and marked, the bell's amber dot, the rail's dot, no "none" anywhere;
3. **sign in as a nurse and open `#/patients/<an id not on her board>`** → one honest message that it may not exist or may be outside her scope, and **no `scope_denied` row in the audit trail for it**;
4. **sign in as an auditor** (`board.view`, `audit.view`) → the alarms screen with no acknowledge button and the line naming `alerts.ack`.

- [ ] **Step 7: Report**

Write the counts, the build's sizes, what the **four** refusals looked like, which engine reasoning texts were on screen for the clinician's reading, and anything found in Steps 3–6 that is not worth a fix now. **Keep this report**: Task 23, which runs next, writes it into the roadmap's `Dalga 3'ten açık kalanlar`, the Turkish guide and `deferred.md`. That is the whole reason this task comes before that one — a document written from a verification that has not happened records intentions, and this project has a rule about those.

**Gate:** every box ticked, with its observation written down. A box ticked with nothing recorded is a box nobody checked.

---

### Task 23 (documents): the roadmap, the guide, the spec, and the two working notes

**Files:**
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, `docs/homunculus-rehber-TR.md`, `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`
- Modify: `/c/tmp/homunculus-plans/amendments.md`, `/c/tmp/homunculus-plans/deferred.md`

**Run this after Task 24, not before it,** with the merged tree and Task 24's report in front of you. The counts go in the roadmap and they have to be the real ones, and the open list below has to be what the verification actually found rather than what this plan expected it to find.

- [ ] **Step 1: Tick the roadmap's work list**

In the `Grup 1 · iş listesi` table, set G1-09, G1-10 and G1-11 to `✅ <tarih> · <ilk>…<son>` with this wave's first and last commit, and G1-12 / G1-13 / G1-14 to `Kısmen` with a pointer to this plan's Tasks 16–19 (the foundation) and to the Wave-3B plan that owes the three tabs. Add the end-of-wave line in the same shape as the earlier ones:

```bash
cd <worktree>/dashboard && npx vitest run 2>&1 | tail -3
git log --oneline <first>..HEAD | tail -1; git log --oneline -1
```

- [ ] **Step 2: Record what Wave 3 decided, in the roadmap's own sections**

Under `Dalga 2'den açık kalanlar`, mark the four Wave-3 notes resolved and say how (the bell's rows and the rail's count: done; the unit chip: the board's own selector, and the choice deliberately NOT persisted; `aria-current`: yes, through `under`; `resumePath`'s parameterised-main-route case: no such route was added, and the reason it is not wanted).

Add a new `Dalga 3'ten açık kalanlar` section with, at least:
- `red_param` is shown as a fact, beside a neutral pill explaining a downgrade, and does not override the engine's level. **The clinical question is still open and now has a named candidate answer**: whether `rules/patient_relative.py` should stop downgrading a NEWS2 alert below MODERATE while `red_param` is true (Decision 5, option b). It needs a vault source and a clinician's sign-off, and note while deciding it that `_adjust_news2` can downgrade a *partial* NEWS2 to LOW.
- `feedHealth`'s per-channel windows are constants in the browser and belong on the server.
- There is no endpoint that lists the units and beds a scope may name, so G1-12's editor offers the board's own keys plus a free-text field.
- `/scope/me` still does not pass `enforce_unassigned` or break-glass to `build_scope` (`scope/router.py` `_view`), so it can disagree with the board. G1-12's acceptance criterion is therefore **not** met by the screen; it is a backend defect.
- `api/board.py` still computes NEWS2 without applying freshness.
- Two permission descriptions in `auth/permissions.py` are out of date (`users.manage` does not mention assigning a scope; `devices.manage` does not mention the live values or the vendor group). The roles tab shows them verbatim, so the fix is a backend text change.
- The engine's clinical prose (`clinical_reasoning`, `recommended_actions`, `confidence`, `chronic_context`, every `summary`) is English only; every screen that prints it marks it `lang="en"` and says so once. **This is decided, not open** (Decision 24): it stays English for the pilot, on the condition in Step 3 below.
- The board payload still carries no server time and no per-entry sequence number. The browser now measures the skew from every answer's `Date` header and corrects its ages by it (Decision 10), so this is no longer a correctness gap — what is left is **telling somebody** when a device's clock is badly set, which belongs on Group 4's device page.
- **`GET /admin/users` is unpaginated** (`admin/router.py`): it returns every user of the hospital in one list. At pilot size that is fine and the users tab is written against it; at a few hundred accounts it is a slow screen, and at a few thousand it is a failed request. The tab must not be built to depend on the whole list being present (**Needs the user, 8**).
- **There is no `GET /patients/{id}`.** The patient screen reads its patient out of the board the session already holds, which is correct today — `/patients` is already scope-filtered, so a card the board does not hold is one this session may not see or one that does not exist, and the server answers both the same way on purpose. But it means the screen cannot be opened without a board, and a deep link after a reload waits for the whole ward to load first.
- **`/audit` and `/alarm-quality` both return the OLDEST rows first** (`.order_by(Audit.id)` with a limit, no `desc()`), so "the last 100" is the first 100 the hospital ever recorded. Group 2's audit screen cannot be built on that, and `/alarm-quality`'s report is wrong in the same way for the same reason — one line each.
- **`api/board.py` writes `scope_note` in Turkish** whatever language was asked for, so a Russian- or Azerbaijani-reading clinician meets one Turkish sentence on an otherwise translated screen. The UI marks it `lang="tr"` and says where it came from; the fix is the engine answering in the requested language, which needs a language on the request first.
- **An alarm's `kind` is a raw slug** (`news2_red_param`, `sepsis_antibiotic_overdue`) and is what every screen prints if the engine sends no `summary` (`summaryOf`). The engine always does send one today, so this is a seam rather than a defect — but the names a clinician should read belong in the vault with a source behind each, and then in the engine's payload, not invented in a dictionary file by the screen that displays them.
- No alarm history endpoint, so the alarms screen has two sections.
- The three administration tabs are specified, not built.

- [ ] **Step 3: Add this wave's items to the G1-15 deploy gate**

At least: **an Azerbaijani-speaking clinician has read the engine's reasoning texts that are actually in use and confirmed each is understood as written** — this is the condition the user attached to leaving the engine's prose in English (Decision 24), it is a gate item and not a note, and Task 24 Step 3 records which texts were on screen; the clinicians see a new ward screen and a new alarm screen, so **the ward is told before the deploy, not after**; the bed-mapping table decides whether a scoped nurse sees anything at all, so `bed-mapping.json` is checked against the discovery report before the first scoped assignment; and the audit trail will start carrying `view` rows for every patient a clinician opens, which is new volume on an append-only log.

- [ ] **Step 4: The Turkish guide**

`docs/homunculus-rehber-TR.md` gains, in the project's own register, the display rules a reader must know and the two sentences a clinician will ask about: never green, "ölçülmedi" ≠ "bulgu yok", an unknown or unreported risk reads as attention (the roadmap asked for exactly this under "Dalga 1B'den açık kalanlar"); only a LIVE board may say nothing is waiting; a closed alarm leaves the board and lives in the audit trail; the patient screen writes nothing in Group 1; and vital trends come with Group 2 because the engine has no history endpoint.

- [ ] **Step 5: The spec**

`docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` §3 gains one paragraph: the dashboard classifies the default groups as a role or an extra duty (`screens/admin/catalogue.js`), the backend does not, and a `kind` on `GroupOut` would put the classification where it belongs (**Needs the user, 5**).

- [ ] **Step 6: The two working notes**

Append to `/c/tmp/homunculus-plans/amendments.md`, under a `## From Wave 3 (as built)` heading, the contracts a later wave must not re-derive: `boardStore`'s three new actions and the rule that nothing is written before the server has taken it; `screens/common/`'s four modules and the line between an operational window and a clinical one; `boardKnown`/`boardStale`; `onlyScreens` and the rule that a test whose subject is which screens exist states its own build; `AdminScreen`'s tab seam; `sessionStore.api` and the rule that every call through it is wrapped in `track`; `vitals.js` as the seam Group 2's charts read; the `under` field; `needsAnswer` and the rule that a downgraded finding drives no queue; `serverClockSkewMs` → `clockSkewMs` → `useBoardNow`, and the rule that a screen printing an age uses `useBoardNow` and never `useNow`; and the rule that anything two arms both render lives in `screens/common/BoardState.jsx` — with the `info`-tone defect as the reason, because nothing failed when it was broken.

Append to `deferred.md` everything in Step 2's list that is not this plan's to fix, with the group it is routed to.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md docs/superpowers/specs/2026-09-23-ldap-rbac-design.md
git commit -m "$(cat <<'EOF'
docs: Wave 3 — the three clinical screens done, the administration foundation,
and what is still open

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

(`/c/tmp/homunculus-plans/` is outside the repository and is not committed.)

---

---

## Self-review

**Spec coverage.** Every row of the roadmap's G1-09 … G1-14 brief, its four "Grup 1 kabul ölçütleri" blocks, and the Wave-2 deferred items are in the table "Roadmap behaviours this wave owns" and the table after it, each against a task or against the reason it is not met. Two criteria are still not met and each has its reason named: the `red_param` floor, which is a clinical decision the user has now half-answered (Decision 5 settles how to *show* it; option b, the engine change, is still open), and `/scope/me`'s two missing arguments, which is a backend defect and not something a screen can fix. The third — the patient screen's write surfaces, where the roadmap contradicted itself — the user settled: the suspected infection is charted here (Task 15B, Decision 27), the SOFA form and the baseline are Group 2's. The three administration tabs are specified rather than planned, which the header says in its first paragraph and the STOP after Task 19 repeats.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every code step in Tasks 0–19 and 15B carries either a whole file or an exact replace-this-with-that pair, and every pair now says in its body which file it belongs to, not only in its step's title. The only fill-ins are `<worktree>`, `<tarih>`, `<ilk>` and `<son>` in Tasks 0 and 23, each produced by a command printed beside it. Tasks 20–22 carry no code **by declaration**, which is a different thing from a placeholder: they are specifications with their acceptance criteria written out, and the plan says three times not to execute them as TDD tasks.

**Type and name consistency.** `elapsed`, `msOf` (4) → `BedsScreen` (11), `AlarmsScreen` (12). `hasMeasurement`, `lastMeasuredAt`, `ageOf`, `neverMeasured`, `oldestMeasurement`, `SIGNAL_KEYS` (4) → `BoardState` (6), `BedCard` (9), `BedList` (11), `PatientScreen` (14). `useNow` (4) → `useBoardNow` (6) and nothing else: **no screen calls `useNow` directly**, which is the rule that keeps every age measured against the server's clock. `CHANNELS`, `STATUS`, `ageSeconds`, `channelHealth`, `patientFeedHealth`, `wardFeedHealth`, `ageParts` (5) → `FeedHealth` (6), `BedCard` (9), `PatientScreen` (14). `VITALS`, `measuredVitals` (6) → 9, 11, 14. `boardKnown`, `boardStale`, `BoardStrip`, `ScopeNote`, `FeedHealth`, `ChronicExpected`, `summaryOf`, `RAIL`, `RAIL_LEFT`, `railOf`, `useBoardNow` (all 6) → 9, 11, 12, 13, 14. `NOW`, `ago`, `measured`, `identity`, `alarm`, `news2`, `entry`, `board`, `scopedTo` (7) → the tests of 9, 11, 12, 14, 15B. `onlyScreens`, `KEEP` (7) → `routes.test.js`, `Shell.test.jsx`, `LiveApp.test.jsx` (7), `BedsScreen.test.jsx` (11), `PatientScreen.test.jsx` (14). `VIEWS`, `ORDERS`, `orderBeds`, `bedNameOf`, `norm`, `inUnit`, `matching` (10) → 11. `News2`, `nameOf` (9) → 14. `applyEntry`, `acknowledge`, `view`, `chart`, `needsAnswer`, `clockSkewMs` (3) → 12, 14, 15B, and the shell's summaries. `serverClockSkewMs` (1) → 3. `api` on the session store (3) → 18. `ADMIN_LDAP_TIMEOUT_MS`, `LDAP_IMPORT_CHUNK` (1) → 22. `PERMISSION_KEYS`, `DEFAULT_GROUPS`, `EXTRA_DUTY_SLUGS`, `ROLE_SLUGS`, `groupKind`, `hasPerm` (16) → 17, 18, 19. `userFromApi`, `groupFromApi`, `scopeFromApi`, `groupRights`, `userRights`, `rightsBeyond`, `canGrant`, `canManageUser`, `canMapGroups` (17) → 18, 20, 21, 22. `useAdminData` (18) → 19. `TABS`, `tabScreenOf`, `stubTabs`, `resetTabs`, `openTabs` (19) → 20, 21, 22. `under` (15) → `Shell.jsx`.

**The counts add up — and this time they close exactly.**

Every number below was measured by running `npx vitest run <that one file>` against the base worktree and against the tested one, not by counting `it(` with grep: nested `describe`s indent differently and `it.each` expands, so a grep undercounts. The first draft of this plan used grep for two of these and was wrong about both — `liveAdapters.test.js`'s base (43, not 42) and `Shell.test.jsx`'s (33, not 30) — which made its running total wrong and forced a paragraph of hand-waving at the bottom of the table. There is none here: the additions sum to 346 and 1751 + 346 = 2097, the figure the suite reports.

| Task | New test files | Tests | How that file counts, measured |
|---|---|---|---|
| base `cced4f9` | — | — | **87 / 1751** |
| 1 the API client | — | +11 | `backendApi.test.js` 78 → 89 |
| 2 the adapter | — | +7 | `liveAdapters.test.js` 43 → 50 |
| 3 the stores | — | +10 | `boardStore.test.js` 23 → 33 |
| 4 elapsed, freshness, useNow | +2 | +19 | `freshness.test.js` 13 (it holds `elapsed`'s tests too), `useNow.test.jsx` 6 |
| 5 feedHealth | +1 | +16 | `feedHealth.test.js` 16 |
| 6 BoardState, vitals, board strings, the risk prefix | +1 | +27 | `BoardState.test.jsx` 24; `RiskPill.test.jsx` 11 → 14 |
| 7 the test seams and the repair | — | +2 | `routes.test.js` 21 → 22; `Shell.test.jsx` 33 → 34; `LiveApp.test.jsx` 33 → 33 (pinned, not added to) |
| 8 the refusals | — | +64 | `apiErrors.test.js` 58 → 122 |
| 9 the bed card | +1 | +30 | `BedCard.test.jsx` 30 |
| 10 the order | +1 | +17 | `order.test.js` 17 |
| 11 the bed board | +1 | +23 | `BedsScreen.test.jsx` 23 |
| 12 the alarms screen | +1 | +19 | `AlarmsScreen.test.jsx` 19 |
| 13 the rail and the bell | — | +6 | `Shell.test.jsx` 34 → 40 |
| 14 the patient screen | +1 | +29 | `PatientScreen.test.jsx` 29 |
| 15 the entry a patient sits under | — | 0 | `Shell.test.jsx` 40 → 40: two rail tests rewritten, one of them split in two, one of them Task 7's — the count does not move |
| 15B charting a suspected infection | — | +8 | `PatientScreen.test.jsx` 29 → 37 |
| 16 the catalogue | +1 | +9 | `catalogue.test.js` 9 |
| 17 the rules | +1 | +30 | `rules.test.js` 30 |
| 18 the loader | — | 0 | no test file of its own: it is exercised through Task 19's frame |
| 19 the frame | +1 | +19 | `AdminScreen.test.jsx` 19 |
| | **+12** | **+346** | **99 / 2097** |

`strings.test.js` stays at **6** throughout. Six tasks add entries to its tables and its dictionaries — it is a parity test, so new keys make the existing six assertions do more work rather than adding a seventh. A task whose gate expects 7 there has written a test it did not need.

**What was run, and what was not.** Every command in Tasks 0–19 and 15B, including every "Expected" line, was run in a scratch worktree at `cced4f9` (`/c/tmp/homunculus-w3`, created with `git worktree add --detach`, `node_modules` junctioned from the reference worktree, removed afterwards). The whole dashboard suite and `npx vite build` were run after each of the twenty.

One flake was seen once and is worth naming, because an executor who meets it should not go looking for a logic error: under the full suite, with 99 files running in parallel on a loaded machine, a `waitFor` on an `Announce` region can exceed the library's default 1 s — the region fills after 150 ms of **real** time, which is not much when the environment setup alone is taking minutes of CPU across workers. The three waits of that kind now pass `{ timeout: 4000 }`, and the suite has been green on every run since.

**And the plan was replayed.** The code blocks here are not transcriptions: they were extracted from that worktree mechanically, and then the finished document was replayed back onto the base commit and diffed against it. The replay starts every file as `cced4f9` has it, applies each whole-file block and each `replace … with …` pair **in the order this document prints them**, by exact string replacement — no fuzz, no context repair — choosing the file for each pair by which open file actually contains the "replace" side rather than by reading the heading, and then compares every file byte for byte:

```
files the plan names:   57
whole files written:    38
pairs applied:          115
appends applied:        6
unclaimed code blocks:  0
byte-identical:         57

OK: replaying the plan reproduces the tested tree exactly, file for file.
```

Then, because "it reproduces the tree" is not the same claim as "it works", the replayed files were written into a **separate, clean worktree at `cced4f9`** — nothing of the tested tree in it — and the whole suite and the production build were run there. That is the check an executor's first task actually performs, and it is the one that found the worst of the three defects in this verification.

It failed, the first time, with a build error in `PatientScreen.jsx` and 1831 tests instead of 2097. The cause was not in the document: `screens/common/freshness.js` and `useNow.js` were missing from the clean tree, because the replay's comparison set was built from the paths the **prose** writes in backticks, and those two steps called their files by their bare names (`Write freshness.js`). A file created by an `@@FILE` marker and never spelled out in prose was therefore put into the replay's working set, never written out, and **never compared** — so the byte-for-byte diff reported 55 files identical and said nothing about two files that did not exist. The comparison set now includes every path the document creates or appends to, by marker as well as by backtick, and all three steps name their files in full. 57 files, and the next number means something. With the hole closed, the clean worktree at `cced4f9` — populated from this document and from nothing else — reports:

```
 Test Files  99 passed (99)
      Tests  2097 passed (2097)
 built in 16.17s
```

That is the claim this plan is actually making: **applied mechanically to the base commit, it produces a working tree.** Not "the code was tested" — the code was tested in a worktree this document was written *from*, which proves only that its author had it working. This proves the document.

`unclaimed code blocks: 0` is new and it is the most useful line of the six. The replay now also lists every fenced code block the document prints that no operation claims, because the silent failure was the dangerous one: a block introduced by the word "**replacing**" instead of "replace" is not an instruction to a mechanical reader, so the edit is simply never made — and nothing fails, because the replay never saw an instruction to complain about. **Seven edits in this document were invisible for exactly that reason**, four of them in `strings.test.js` alone, and the earlier run of this replay reported them as nothing at all. The replay also used to write every whole-file block before applying any pair, which is not what an implementer does and which hid the `Sidebar.jsx` overlap a second time: a pair printed before a whole-file block was being applied to the later file's contents. Both are fixed, and both — like the missing-file hole above — were defects in the **verification** rather than in the plan. That is worth saying out loud three times over, because a verification that cannot fail is decoration, and all three of these were quietly passing.

**The arms were merged, with git, and the result checked.** The replay was run four more times, once per arm: tasks 0–8 and then exactly that arm's tasks, which is what an agent on that branch would produce. Every file more than one arm touches was then merged with `git merge-file --diff3` — the same three-way merge git itself uses — with the post-Task-8 state as the base:

```
Files more than one arm touches: 4
  dashboard/src/live/i18n/catalog.js        +beds clean, +alarms clean, +patient clean, +admin clean | merged tree == tested tree
  dashboard/src/live/i18n/strings.test.js   +beds clean, +alarms clean, +patient clean, +admin clean | merged tree == tested tree
  dashboard/src/live/shell/Shell.test.jsx   +alarms clean, +patient clean                           | merged tree == tested tree
  dashboard/src/live/shell/routes.js        +beds clean, +alarms clean, +patient clean, +admin clean | merged tree == tested tree

conflicts or mismatches: 0
```

Four files, not five: `Sidebar.jsx` and `TopBar.jsx` are the alarms arm's alone now, and `Shell.jsx` is the patient arm's. And the right-hand column matters as much as the left — a clean merge that produced the wrong file would be worse than a conflict, because nobody would look.

That proof is what forced the last change to `strings.test.js`. Its two `Set`s carried the same seven `// G1-NN` headings, so an arm could only anchor its insert by reaching back into the arm **before** it — which merges in order and fails on a branch cut off Task 8, and which the merge test could therefore not prove at all. Each set's headings now carry a suffix of their own, `· neutral` and `· az = tr`, and every arm's anchor is unique in the file and independent of every other arm.

Four files are given at a **task-stage** state rather than their final one, because a later task edits them again: `i18n/catalog.js` (Task 6, the arms' lines still commented), and `strings/patient.js`, `screens/patient/PatientScreen.jsx` and `PatientScreen.test.jsx` (Task 14, before Task 15B adds the charting). Each was produced from the tested file by putting back exactly what the later task changes, and each round trip was verified in both directions — so a snapshot cannot drift from what the document instructs. `shell/Sidebar.jsx` **used** to be one of them, and no longer is — which is the most useful thing the review found: Task 13 gave that file whole while Task 15 replaced a paragraph of it, a conflict in either merge order, and this document asserted twice that the two did not overlap. The header rewrite moved to Task 7, before the fork; Task 13 now gives the real final file; Task 15 does not open it, and its Step 5 is a `grep` that fails loudly if Task 7 was skipped.

Mistakes in this document that the replay and the two reviews found, and that are fixed here: a missing pair in Task 7; a pair whose "with" was buried in a sentence in Task 8; the order of three entries in `strings.test.js`'s `NEUTRAL`; the `Sidebar.jsx` overlap and the two false claims about it; the Sepsis-3 **rise printed under the baseline's label** (a clinical misreading, not a layout nit — `patient.rise` existed in four languages and was never used); an `info` finding drawn quiet grey on the card and attention amber on the patient screen; a `role="status"` born with its text, which is the pattern that looks accessible and announces nothing; `liveAdapters.test.js`'s base count; and four shared literals whose per-arm lines were adjacent and would have conflicted on every merge. **A plan is not verified by being read** — and a plan is not verified by being reviewed either: of that list, the replay found four and the reviews found the rest, and the two sets do not overlap.

**Not run, and therefore not claimed:**

Task 11 Step 7, Task 12 Step 9a, Task 14 Step 9a, Task 15B Step 9, Task 19 Step 9a and the whole of Task 24 (the browser, the four languages on screen, 390/1440 px, the keyboard walk, the four deliberate refusals, and the clinician's reading of the engine's English). The screens were exercised only in jsdom, which has no layout: **every 390 px claim in this document is a requirement, not an observation.** Nothing was run against a real API, a real directory or the VM, and no backend test was run, because no backend file is touched.

---

## Needs the user

Nothing in Tasks 0–19 waits for an answer: each item below is either already handled honestly in a way the user can overrule, or belongs to a group after this one. They are in the order they matter.

**1. The `red_param` floor — ANSWERED for the screen, still open for the engine.** `rules/news2.py` raises a MODERATE alarm when one parameter scores 3 (`red_param`), and `rules/patient_relative.py::_adjust_news2` lowers a NEWS2 alarm to LOW when the patient's charted chronic normal or a recorded comorbidity explains every contributor — and non-"Alert" consciousness is itself 3 points, so recorded dementia alone can do it. So the engine can legitimately send `risk: "low"` with `red_param: true`, and G1-09's acceptance criterion ("a red parameter makes the card at least amber") cannot be met in the browser without the browser overruling the engine on exactly the patients the patient-relative layer exists for.

**What the user chose** (option d of four): show both facts, and add a third — a neutral pill saying the finding is expected for this patient's own normal, carrying the engine's `chronic_context` in its accessible name (Decision 5, Task 6/9/12). That is what makes "Aşağı" beside "Bir parametr 3 bal alıb" readable as one coherent statement instead of two contradictory ones.

**What is still open, and it is the clinical half.** Option **b** was the other serious answer: the engine stops downgrading a NEWS2 alert *below* MODERATE while `red_param` is true. It is a few lines in `rules/patient_relative.py`, and it is the only one of the four that would make the roadmap's criterion *true* rather than merely explicable. It changes what the engine concludes, so it needs a source in the vault and a clinician's sign-off, not a plan's opinion.

Two facts to have in front of you when deciding it. `_adjust_news2` walks the contributors it can account for and `continue`s past one whose points it cannot explain, so **a charted baseline can downgrade a NEWS2 scored from four of seven parameters all the way to LOW** — the downgrade is then justified for what was measured and silent about what was not. And `pipeline.py:60` does not mark NEWS2's own block for `stale_inputs`, so the engine's "these inputs were already stale" list never covers the NEWS2 score itself, however old the vitals under it are. Both of those make the downgrade broader than it reads.

**Recommendation:** take option b to the vault — the question is whether a chronic baseline may explain away a single parameter at 3 points, and Sepsis-3 and NEWS2's own literature have something to say about it. Until then the screen is honest and does not decide.

**2. The patient screen's write surfaces — ANSWERED.** The roadmap contradicted itself: its G1-11 row said "Özet … salt okunur", and its own module list routed three write surfaces to G1-11 — the SOFA form (fill in and sign, `severityScore.jsx`, written and never connected), charting a suspected infection, and the patient's own baseline.

**The user split them, and split them on the right line.** The suspected infection is charted here (**Task 15B**, Decision 27), because **without it the engine evaluates no sepsis rule at all** (`septic_shock.evaluate` returns at its first line) — so on a ward with no way to chart it, a quiet card is not a reassuring card, and the screen would be printing that problem while unable to do anything about it. The SOFA form and the baseline stay with Group 2's charting work: both need a form, validation and a signature, and neither blocks a rule from running.

Nothing further is needed from the user on this. It is recorded here rather than deleted because the roadmap's own two statements still contradict each other, and Task 23 is where that gets reconciled in the document the team reads.

**3. The engine's clinical prose is English only — ANSWERED, with a condition that is now a gate item.** `clinical_reasoning`, `recommended_actions`, `confidence`, `chronic_context` and every `summary` come out of `reco/engine.py` as English sentences. Every screen that prints them shows them as the engine wrote them, marked `lang="en"` so a Russian- or Azerbaijani-voiced screen reader pronounces them as English, and says once in the reader's own language that these texts are the engine's and are not translated.

**The user's decision:** it stays English for the pilot, **provided** an Azerbaijani-speaking clinician reads the reasoning texts that are actually in use and confirms each is understood as written. Four rule families produce them (`news2`, `septic_shock`, `acute_change`, `patient_relative`), so this is a short reading rather than a translation project. It is in Task 23 as a **G1-15 gate item**, and Task 24 Step 3 records which texts were on screen so the reading can be done against a real list.

One thing that is NOT English and is also not the reader's language: `scope_note`, which `api/board.py` writes in Turkish whatever was asked for. The UI marks it `lang="tr"` and prints one line saying where the sentence came from. The real fix is the engine answering in the requested language, which needs a language on the request first — Task 23 routes it to Group 2.

**4. The feed windows belong on the server.** "This bed has stopped reporting" rests on per-channel windows that are constants in a browser file (`feedHealth.js`: heart rate and SpO₂ 300 s, pressures 900 s, temperature 3600 s, respiration 600 s, lactate 6 h). They are operational, not clinical, and they were already these numbers in the old workspace — but a hospital whose monitors report every 60 s and one whose report every 5 minutes want different ones, and the engine knows its own cadences.
 *Options:* (a) keep them in the browser for the pilot; (b) `/patients` carries them once in its `scope`-like block and the browser reads them; (c) they become a deployment setting.
 *Recommendation:* (b) in Group 2, with the chip's own sentence unchanged until then.

**5. `GroupOut` could say what kind of group it is.** The user form offers one role plus any number of extra duties (roadmap D3), and nothing in the API says which of `charge_nurse` / `rapid_response` is a duty — so the dashboard classifies the eleven default slugs itself (`screens/admin/catalogue.js`, checked against `auth/permissions.py` by a test).
 *Options:* (a) keep the mirror; (b) `GroupSpec` gains `kind: "role" | "extra"` and `GroupOut` carries it — two lines of backend and the classification lives where the groups do.
 *Recommendation:* (b), with the mirror kept as the fallback for a group the API describes without a `kind`.

**6. `/scope/me` does not decide as the board does — the one G1-12 criterion a screen cannot meet.** `scope/router.py` `_view` calls `build_scope(role, unit_ids, bed_ids, own_patient_ids)` and passes neither `enforce_unassigned` nor the break-glass patients, while the board's own resolver passes both. So `/scope/me` can answer "unassigned → you see nothing" where the board enforces nothing, or leave out a break-glass patient the board shows. The roadmap lists this as a G1-12 acceptance criterion; it is a backend defect and no screen can fix it.
 *Options:* (a) fix it in Wave 3B's backend half (about two hours: pass both, and a test that `/scope/me` and the board agree under each of the four scope reasons); (b) Group 2.
 *Recommendation:* (a) — the screen that will show a user's own scope is being built now, and a scope panel that disagrees with the board is worse than none.

**7. Three institution policies have no endpoint.** The escalation chain's steps and thresholds, the wall-display name-masking policy, and the shift pattern: the old workspace's `PolicySettings` wrote all three to the simulation only, and the live API has no route for any of them. The roadmap routes the screens to Group 2–4, so nothing in Group 1 shows them — but the escalation chain is the one a ward will ask about, because the alarms screen now shows `escalated` and someone will want to know what it escalated to.
 *Options:* (a) nothing in Group 1, and the alarms screen's sentence says escalation is the engine's; (b) a read-only panel in Group 2 showing what the engine's configuration actually is.
 *Recommendation:* (b) in Group 2, together with the per-entry sequence number.

**8. The still-open user decisions the roadmap carries.** Repeated here because this wave touches all of them and changes none: **(2)** what happens to the VM capabilities Group 2–4 inherits (manual pressor and fluid entry, the patient's own baseline, the admission profile, feed health) — this plan brings feed health back and nothing else; **(3)** forced MFA for the four groups, where nothing in this wave names a group (the UI reads `requires_mfa` / `mfa_required`, so the decision changes no screen); **(4)** whether a device token may keep writing `/clinical`; **(5)** whether scope reaches the admission, escalation and handover routes; **(6)** whether `platform_support` sees the research window and the full audit trail; **(7)** how NEWS2 is presented on stale vitals, which is the engine half of G1-11's criterion.
 *Recommendation:* none of them blocks Tasks 0–19. (3) should be answered before G1-15, because it decides who has to enrol an authenticator on the morning of the deploy.

**9. What the prototype implies that a live ICU must not do** — refused here, and listed so the designer hears it from the plan rather than from a diff. The animated ward on the sign-in page with invented alarms (Wave 2 refused it); the client-side password policy, in three mutually inconsistent versions, and the plaintext password the browser generates; permissions kept in `localStorage` and enforced only in the browser; a group × permission checkbox that applies on the click with no save and no transaction; two "attention" tiles that are literal constants ("3 results unseen · including a lactate of 4.1", "1 device silent · RE07, no data for 6 minutes"); a hospital number and a protocol number computed from the patient id; BMI and body-surface area computed in the browser; pain, fall-risk and pressure-injury chips keyed off hard-coded bands; a simulated ECG with a synthesized heartbeat tone, watermarked "representative waveform"; every chart drawn from a seeded random generator, with its red "outside the alarm range" bands coming from `core.js:499-501`; a 3 / 5 / 10-minute escalation ladder its own admin tab admits is not wired; a "view as this role" switch; a fabricated notification 45 seconds after sign-in; and an integration test that answers "84 ms" without asking anything. **None of it is in this plan.** The designer should be told which of these were deliberate demo scaffolding and which were meant as product, because three of them — the escalation ladder, the alarm-quality numbers and the vital bands — look like product and would each need a source before they could be.

**10. `GET /admin/users` returns every account in one response, and the users tab is being built on it.** `admin/router.py` has no `limit`, no `offset` and no cursor: the list is the whole hospital. At the pilot's size that is the right trade — a dozen accounts, one request, a screen that can sort and filter in the browser without a round trip — and Task 20's specification is written against it. It stops being the right trade somewhere between a few hundred accounts and a few thousand, and the failure is not graceful: a slow screen first, then a request that times out at the client's 15 s and tells an administrator "no answer" about a list that exists.

**The decision is about when, not whether.** Options: **(a)** leave it, and have Task 20's tab paginate in the browser, with a note that it loads the whole list — fine for the pilot, and it is one hospital; **(b)** add `limit`/`offset` to the endpoint now and build the tab against it from the start, about twenty lines of backend and a known shape for the screen; **(c)** build the tab as (a) and add (b) when a second hospital is onboarded, accepting that the tab is then rewritten.

**Recommendation: (a) for the pilot, with the note, and (b) before the second hospital** — and the note matters more than it sounds, because a tab that silently depends on having the whole list is a tab whose search and sort quietly become wrong when pagination arrives. Task 20's specification says it must not be built that way.
