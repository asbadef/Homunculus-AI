# TRƏS-01 · National e-health feed (Azerbaijan, «TRƏS») — design

HBYS programme, outside the five design groups (the HBYS input document asks it as question S9: «Azerbaycan'da zorunlu
bir … e-sağlık ya da raporlama entegrasyonu var mı?»). Owner's decisions of 2026-11-11:

1. **Role.** A complete module in Homunculus's own structure, independent of one hospital: it must work on an install
   outside Bona Dea, and sending is switched on when it is needed.
2. **Scope.** Everything in one spec, the new record screens included.
3. **Vitals.** Per stay, only the admission (first) and discharge (last) values.

Builds on G2-B1a (admissions, the admission form), G2-B1d (the per-tenant settings pattern), G3-01 (hand-entered
vitals as `chart` audit rows), G2-A4 (hand-transcribed labs), the LDAP/RBAC permission catalogue and the Group 1 shell.

## 1. Why

A hospital information system in Azerbaijan reports its clinical records to the ministry's e-health platform, which the
owner calls TRƏS: a FHIR 4.0.1 server (CapabilityStatement software «iMed EHR Server») under `e-health.gov.az`.
Homunculus sends nothing anywhere today — the on-prem design says «No patient data leaves the building»
(`docs/EDGE-BRIDGE-LOCAL.md`) — and half of what the platform expects has no record in Homunculus at all: a coded
diagnosis, a procedure, a discharge summary.

This slice builds the sender and the three missing records. It is **off by default**, under two locks (D2), because at
Bona Dea the same stays are already reported from the present HIS: a second sender would write every stay twice into
the national record.

## 2. Where the contract comes from — and how far to trust it

The contract below was **not read from the ministry's implementation guide**. It was read from a third-party sender for
the same platform, the public repository `github.com/zatruga/ekiz` (`PusulaEHealthSync` v1.2.16, C#, head `92ed0bca`
of 2026-11-10), and from the ministry correspondence filed in that repository's `docs/`.

- That repository has **no licence**. Nothing is copied from it: no code, no resource file, no document. Only facts
  about the platform's interface are used, and this module is written from nothing in Python.
- Its `docs/` hold personal data of real people (a practitioner list with national identifiers). None of it is brought
  here (hard rule 6); every fixture in this slice is synthetic.
- Every fact in §4 is therefore **second-hand**: true of that sender's sandbox and live runs up to October 2026.
  Phase F6 re-checks each one against the sandbox with this module's own requests, and §4 is amended by what the
  server answers. Where §4 and the server disagree, the server is right.
- The name: that repository writes «TRƏS» and «e-Health»; the long form «Tibbi Rəqəmsal Əkiz Sistemi» is the owner's
  and appears in no file read. This spec says TRƏS.

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Eight resource types:** Patient, Practitioner, Encounter, Condition, Procedure, Observation (vital signs), Observation (laboratory), Composition (discharge summary). **Not in this slice:** radiology and pathology reports and ImagingStudy (Homunculus has no such record; they come with H6), outpatient encounters (H5), the newborn profile (O4), Bundles (O3). | Owner chose «hepsi»; «hepsi» is what Homunculus can hold a record of. A mapper with no record behind it is dead code. |
| D2 | **Off by default, two locks.** (a) Per tenant, `tres_settings.mode` ∈ `off` (default) · `validate` · `send`. (b) Per install, the environment variable `TRES_EGRESS` — unset or anything but `on` means the module opens **no** connection, whatever a tenant's row says; the settings tab says so. | The on-prem promise stays true until the owner turns both; at Bona Dea a second sender would duplicate the stays the present HIS reports (O11). |
| D3 | **Settings per tenant, in Postgres** (`tres_settings`, the `protocol_settings` pattern): `mode`, `environment` ∈ `test` · `live`, and per environment `base_url` (https only), `username`, `password`, `provider_id`, `organization_id`, `organization_name`; one switch per resource type; `settle_hours`. The password is an `EncryptedString`; the API never returns it, only `password_set: true/false`. | The engine is multi-tenant and the owner installs it in more than one hospital; a hospital's account is the hospital's. This is the first secret kept in a table rather than the environment — encrypted with the PHI key, write-only at the door. |
| D4 | **One resource per request**, as the reference sender does: find by `local-system-unique-id`, then POST or PUT (§4.2). No Bundle. | It is what is known to work and to show in the citizen portal. Whether Bundles are expected is open with the ministry (O3). |
| D5 | **Local ids** carry the prefix `hmn-` and no PHI. Patient: `hmn-p-{phi_digest(FİN)[:32]}` — from the person's FİN, not the `patients` row, because a row is one admission and a readmitted person would otherwise become a second national Patient. Practitioner: `hmn-pr-{user id}`. Encounter: `hmn-e-{root admission id}` — the root of the transfer chain (`source_admission_id`), so one stay is one Encounter across beds. Condition `hmn-c-{row id}`, Procedure `hmn-x-{row id}`, Composition `hmn-d-{root admission id}`, lab `hmn-l-{audit row id}`, vital `hmn-v-{root admission id}-{loinc}-{first\|last}`. | The platform's only search key is this id, unique per resource type, in a space shared with any other sender on the same provider account; the prefix keeps the two apart. `phi_digest` is keyed, so the id says nothing about the FİN (O9: key rotation). |
| D6 | **A delivery ledger in Postgres**, `tres_deliveries`: one row per `(tenant, environment, resource_type, local_id)` — `status` ∈ `pending` · `sent` · `validated` · `failed` · `skipped` · `stuck` · `deleted`, `operation`, `remote_id`, `payload_digest`, `attempts`, `next_attempt_at`, `reason` (a catalogue code for a skip), `last_error` (EncryptedString — a server message may echo a value), `admission_id`. **No request or response body is stored.** A sandbox success never counts for live (the environment is in the key). | The state must survive a restart and be read by the tab. Bodies are PHI and can be rebuilt on demand (the preview route, D25). |
| D7 | **Change detection by digest.** `payload_digest = phi_digest(canonical JSON of the resource without its id)`. Same digest as the last `sent` → nothing is sent. Different → PUT. | The reference sender compares modification times and re-sends more than it needs (it met HTTP 429). A digest is exact. |
| D8 | **The package of one stay, in order:** Patient → Practitioner(s) → Encounter → Conditions → Encounter again with `diagnosis[]` → Procedures → Composition → laboratory Observations → vital Observations. A skipped or failed Patient or Encounter stops the package there. A Practitioner that cannot be sent is left out of what refers to it (the Encounter goes without `participant`, a Procedure without `performer`) — except the Composition, whose `author` is required: it is skipped. | References must exist before they are used (HTTP 409 «Non-existent reference»). |
| D9 | **When.** Automatically: once the stay is over (the last admission of the chain is `DISCHARGED`) and `settle_hours` have passed since `discharge_at` (default 24, 0–168). By hand: «Şimdi gönder» on the tab for one stay at any time — a patient still admitted goes as `in-progress`. After the first send, any change inside the package is picked up by D7 on the next round. | A record is still being corrected in the hours after a discharge; the reference hospital also waits a day. The owner asked for «gerektiğinde». |
| D10 | **Vital signs: the first and the last** non-withdrawn hand entry of each signal over the stay (`chart` rows minus `chart_retract`, read with `iter_records_of`), plus the admission's `weight_kg` and `height_cm`. One entry only → only `first`. **Monitor samples are never sent** (`monitor_samples` is unvalidated by design). Signals: heart rate, SpO2, temperature, respiratory rate, systolic pressure, mean arterial pressure. Diastolic pressure is not charted, so the systolic value goes alone under its own code, not as a panel. | Owner's decision 3. The hand set is the only validated source on the ward today. |
| D11 | **Laboratory: every** non-withdrawn hand-transcribed value of lactate, platelets, bilirubin, creatinine, arterial pH, bicarbonate, sodium, potassium, haematocrit and white-cell count. Not sent: PaO2/FiO2 and FiO2 (not laboratory results). Each needs a verified LOINC code (D12) and the tenant's procedure code for it (`tres_code_map`; the platform requires `procedure-code` on a laboratory Observation) — one missing → `skipped`. | Results are few and each is a result. Whether these too should be first/last only is the owner's call (O6). |
| D12 | **No code from memory.** Every LOINC code, its display, and every UCUM code in `tres/codes.py` is checked against an official source (loinc.org or `tx.fhir.org` `$lookup`) when it is written, and the check is recorded beside it. The codes the reference sender uses for vitals (§5) are the starting point because the platform accepted them. A signal whose code cannot be verified is not sent. | Hard rule 2 in spirit: a wrong code in a national record survives review. |
| D13 | **Diagnoses become a record:** table `admission_diagnoses` — admission, ICD-10 code and display (from the ministry's list), `kind` ∈ `main` · `additional` · `comorbid`, `certainty` ∈ `provisional` · `confirmed` · `differential`, `recorded_by`, `recorded_at`, `removed_at`. Entered in the admission form and in a «Tanılar» box on the patient screen, by search over the code list. The free-text diagnosis stays as it is; `admissions.icd10_codes` stays unused. A removed row is kept (`removed_at`) and its Condition is deleted (D19). | A Condition needs a code from `az-icd-10` (a required binding); free text cannot be sent. |
| D14 | **Procedures become a record:** table `admission_procedures` — admission, code and display from `az-procedure-codes`, `performed_at` (inside the stay), `performed_by` (user), `note` (EncryptedString ≤ 500), `removed_at`. An «İşlemler» box on the patient screen. | A Procedure needs system, code and display from that list. |
| D15 | **The discharge summary becomes a record:** table `discharge_summaries`, one per stay — six sections as EncryptedString text (`complaint`, `history`, `findings`, `problems`, `course`, `instructions`), `author` (user), `state` ∈ `draft` · `signed`, `signed_at`. At least one section is required to sign. A signed summary can be reopened by its author or the attending; signing again is a new signature and, by D7, a PUT. An «Epikriz» form on the patient screen, offered from the discharge. | The platform's profile requires an author, a title and at least one coded section. |
| D16 | **A practitioner's identity for the platform** lives in `tres_practitioner_identity` — `user_id`, FİN (EncryptedString), `family_name`, `given_name` — edited on the tab. `users` is not touched. No row or no FİN → that practitioner is `skipped`. | `users.full_name` is one string and holds no FİN; staff identity proper is H4's. |
| D17 | **Department mapping:** `tres_department_map` — `unit_id` → a `hospital-departments` code and display, edited on the tab. An unmapped unit → the Encounter is `skipped` (`unit_unmapped`); never a silent «999 Digər». | `serviceType` is required and shows in the portal. |
| D18 | **Code lists** in one table, `terminology_concepts (system, code, display)`, tenant-independent: `az-icd-10`, `az-procedure-codes`, `hospital-departments`. Loaded per install by `scripts/tres_load_codes.py <CodeSystem.json>` from the ministry's own files; **not committed** to this repository. Tests use a few synthetic concepts. Search: `GET /terminology/search`. | The lists are the ministry's (≈33 000 and ≈6 000 concepts), versioned by it, and their licence is not known (O2). |
| D19 | **Withdrawals reach the platform.** A withdrawn lab entry, a removed diagnosis or procedure → DELETE of that resource. A removed diagnosis is first taken out of the Encounter's `diagnosis[]` by a PUT. Order outside-in: Composition → Observations → Procedures and Conditions → Encounter. A Patient is never deleted. | The platform refuses to delete what is still referred to (HTTP 409). |
| D20 | **Patient rules** (`tres/az.py`): FİN trimmed, upper-cased, exactly `^[A-Z0-9]{7}$`, never transliterated — otherwise `skipped` (`fin_missing` / `fin_format`). Name: `display_name` is «Soyad Ad» by the admission form's convention → the first word is `family`, the rest `given`; one word → `skipped` (`name_single`). `father_name` empty → `skipped` (`father_name_missing`). Sex `male` → `K`, `female` → `Q`; `other` / `unknown` → `skipped` (`sex_unmapped`). Phone → `+994` and nine digits or not sent. Blood group from the admission when not `UNKNOWN`. Address, marital status and citizenship are not recorded and not sent (O10). | The platform's `az-patient` profile requires FİN, family, given, father's name and sex; it refuses any other sex code. A skip is shown with its reason so the ward can complete the record. |
| D21 | **Rounds, limits, failures.** A lifespan task (`_escalation_loop`'s pattern) runs a round every 5 minutes; requests are sequential, at least 300 ms apart. HTTP 401 → one new token, one retry. HTTP 429 → the round ends; the next starts after `Retry-After`, or 15 minutes. Five exceptions in a row → the round ends. A resource fails 5 times → `stuck`, retried once a night at 04:00 tenant time and by «Yeniden dene». A `skipped` resource is tried again only when its data changes. | The reference sender met 429 on live. A bad round must never kill the loop. |
| D22 | **Time:** every timestamp sent is in `tenants.timezone` with its offset (`+04:00` for `Asia/Baku`), never UTC `Z`; a birth date is a date. | The platform and the portal read local time. |
| D23 | **Permission** `tres.manage` (the catalogue's 28th key): the tab, every `/admin/tres/*` route. `hospital_admin` holds it by rule; no other default group. Diagnoses and procedures are written with `clinical.chart`, the summary is signed with `admissions.sign_off`, all three are read with `admissions.view`. | The feed is administration; the records are clinical work that already has its rights. |
| D24 | **Audit events** (no PHI, actor in the payload): `tres.settings` (which fields changed, never the password), `tres.map`, `tres.identity`, `tres.send` (a stay sent by hand), `tres.retry`, `tres.preview`, `tres.package` (one row when a stay's package first completes: counts by type and status), `diagnosis_added` / `diagnosis_removed`, `procedure_added` / `procedure_removed`, `summary_signed` / `summary_reopened`. A resource's own send is **not** an audit row — the ledger is its record. | Every human act is attributable; the hash chain is not grown by a row per Observation. |
| D25 | **PHI discipline.** Logs carry ids, types and status codes, never a body. The preview route rebuilds a stay's resources for a `tres.manage` holder and is audited. The ledger holds no body (D6). | Hard rule 6 and the audit rule. |
| D26 | **One migration**, the next free number when it is written (0018 is B1c on main; 0019 is claimed by Eczane) — all nine tables and the permission rows; the downgrade drops exactly these. | Alembic is one chain and three other lanes are numbering in it. |
| D27 | **i18n:** `strings/tres.js`, `strings/tani.js`, `strings/islem.js`, `strings/epikriz.js` with `tr`, `az`, `ru`, `en`; the catalogue's skip reasons and refusals in the catalogue's words. | Shell rule. |

## 4. The contract (second-hand, §2)

**4.1 Session.** `POST {base}/auth/token` with `Authorization: Basic base64(username:password)`,
`Content-Type: application/json-patch+json`, body `{"healthcareProviderId": "<provider id>"}` → `payload.sessionId`.
Every FHIR request then carries `Authorization: Bearer <sessionId>`. No expiry is published; a 401 means a new token.
Sandbox `https://ehr-sandbox.e-health.gov.az`, live `https://ehr.e-health.gov.az`; both are settings, not constants.

**4.2 Writing.** `GET {base}/fhir/{Type}?local-system-unique-id={id}` → `entry[0].resource.id` if any. None →
`POST {base}/fhir/{Type}`; the body **must** carry an `id` although the server assigns its own (returned in the
answer). Found → `PUT {base}/fhir/{Type}/{serverId}` with the body's `id` equal to the URL's. Body
`application/json`. `POST {base}/fhir/{Type}/$validate` checks a resource and stores nothing (`mode = validate`).
The ledger's `remote_id` is trusted for a PUT; a 404 or «Non-existent reference» falls back to the search.

**4.3 Deleting.** `DELETE {base}/fhir/{Type}/{serverId}`, hard. A resource still referred to answers 409.

**4.4 In every resource:** `meta.profile`; the extension `http://fhir.az/StructureDefinition/local-system-unique-id`
(`valueString`); a `display` on every `coding` (without it the portal shows no name).

**4.5 Errors** come in three shapes: an OperationOutcome with `issue[].diagnostics`; one whose text is at
`issue[].details.text.value`; a plain `{"error"|"message": "…"}`. `$validate` does not check every terminology binding:
a green validate proves the shape, not the codes. Sandbox and live run different profile versions.

## 5. Resources

Systems under `http://fhir.az/` are written `az:`; profiles are `az:StructureDefinition/<name>`.

| Resource · profile | From | Elements |
|---|---|---|
| Patient · `az-patient` | `patients`, `admissions.blood_group` (D20) | `identifier` {`type` `az:CodeSystem/identity-document-type` `15`, `system` `az:sid/fin`, `value`}; `name` {`family`, `given[]`}; `birthDate`; extensions `az:StructureDefinition/sex` (`valueCode` K·Q), `…/fathersName`, `…/blood-group` (`az:CodeSystem/blood-group`); `telecom` phone; `active: true` |
| Practitioner · `az-practitioner` | `tres_practitioner_identity` (D16) | the same FİN `identifier`; `name`; `active: true` (the profile fixes it) |
| Encounter · `az-encounter` | the admission chain (D5), D17 | `status` `in-progress` · `finished`; `class` v3-ActCode `IMP`; `type` `az:CodeSystem/encounter-type` `1`; `subject`; `period`; `serviceType` `az:CodeSystem/hospital-departments`; `serviceProvider` `Organization/{organization_id}`; `participant[].individual` (attending); `diagnosis[]` {`condition`, `rank`} on the second PUT |
| Condition · `az-condition` | `admission_diagnoses` (D13) | `category` condition-category `encounter-diagnosis`; `code` `az:CodeSystem/az-icd-10`; `verificationStatus`; `subject`; `encounter`; `recordedDate`; extension `…/diagnosis-type` (`az:CodeSystem/diagnosis-type` 1 main · 2 additional · 3 comorbid) |
| Procedure · `az-procedure` | `admission_procedures` (D14) | `status` `completed`; `code` `az:CodeSystem/az-procedure-codes`; `subject`; `encounter`; `performedDateTime` (not after the Encounter's end); `performer[].actor` |
| Observation · `az-observation` | D10 | `status` `final`; `category` observation-category `vital-signs`; `code` LOINC with the standard display, the local label in `code.text`; `subject`; `encounter`; `effectiveDateTime`; `valueQuantity` {`value`, `unit`, `system` UCUM, `code`} |
| Observation · `az-lab-result-observation` | D11 | as above with `laboratory`; `valueQuantity.unit` required; extension `…/procedure-code` (`az:CodeSystem/az-procedure-codes`), required |
| Composition · `az-discharge-summary` | `discharge_summaries` (D15) | `status` `final`; `type` LOINC `18842-5`, exactly one coding; `category` `az:CodeSystem/composition-type` `hospital-record` (without it the portal does not show the document); `subject`; `encounter`; `date`; `author`; `title`; `custodian`; `section[]` {`title`, `code` LOINC, `text.div`} |

Vital codes the reference sender uses and the platform accepted: temperature `8310-5` (`Cel`), heart rate `8867-4`
(`/min`), SpO2 `2708-6` (`%`, O7), height `8302-2` (`cm`), weight `29463-7` (`kg`), systolic pressure `8480-6`
(`mm[Hg]`). Respiratory rate and mean arterial pressure are not in the reference sender: their codes are fixed under
D12. Section codes it uses: `10154-3` complaint, `11348-0` history, `29545-1` findings, `11450-4` problems, `8648-8`
course, `8653-8` instructions. All of these are re-verified under D12 before they are written into `tres/codes.py`.

An ICD-10 code missing from the ministry's list is walked up **after the dot only** (`S62.60` → `S62.6` → `S62`), the
original kept in `code.text`; still missing → `skipped` (`icd_unlisted`).

## 6. API

All under the caller's tenant.

- `GET|PUT /admin/tres/settings` (`tres.manage`) — D3; the answer carries `egress: true|false` (D2) and never a password.
- `POST /admin/tres/test` — one token request with the stored account; answers `ok` or the platform's words. 409 `egress_off`.
- `GET /admin/tres/deliveries?status=&type=&admission=&cursor=` — the ledger, newest first, with the stay's protocol number.
- `POST /admin/tres/deliveries/{id}/retry` · `POST /admin/tres/admissions/{id}/send` · `GET /admin/tres/admissions/{id}/preview`.
- `GET|PUT /admin/tres/departments` (D17) · `GET /admin/tres/practitioners`, `PUT /admin/tres/practitioners/{user_id}` (D16) · `GET|PUT /admin/tres/codes` (D11).
- `GET /terminology/search?system=&q=&limit=` (`admissions.view`) — code or display, case-insensitive, at most 50.
- `GET|POST /admissions/{id}/diagnoses`, `DELETE …/{row}` · `GET|POST /admissions/{id}/procedures`, `DELETE …/{row}`.
- `GET|PUT /admissions/{id}/discharge-summary`, `POST …/sign`, `POST …/reopen`.

Refusals: 403 right or unit scope; 404; 409 `egress_off`, `tres_off`, `summary_signed` (a write to a signed summary
that was not reopened); 422 an unknown code, `performed_at` outside the stay, a `base_url` that is not https, an empty
summary at signing. A diagnosis, a procedure and the summary can be written after the discharge too: a late correction
reaches the platform by D7 and D19.

## 7. Engine (by file)

- `homunculus/tres/client.py` — the session and the six calls of §4 over `httpx.AsyncClient` (as
  `api/infinity_waves.py`: `trust_env=False`, no redirects, https only, explicit timeouts); the error reader of §4.5.
- `homunculus/tres/az.py`, `codes.py` — D20's rules; the verified signal → LOINC/UCUM table (D12).
- `homunculus/tres/mapping/{patient,practitioner,encounter,condition,procedure,vitals,lab,composition}.py` — pure
  functions, no I/O, each returning a resource or a skip reason.
- `homunculus/tres/package.py` — D8: reads one stay (ORM for the admission world; the audit log through
  `asyncio.to_thread` for `chart` rows, by the board key of `admission/boardkey.py`) and yields its resources in order.
- `homunculus/tres/ledger.py`, `worker.py` — D6, D7, D9, D19, D21.
- `homunculus/tres/models.py`, `schemas.py`, `router.py` — D3, D16, D17, the `/admin/tres/*` routes (as `protocol/router.py`).
- `homunculus/tres/terminology.py` — D18; `scripts/tres_load_codes.py`.
- `homunculus/admission/clinical_records.py` (models, routes) — D13, D14, D15.
- `homunculus/auth/permissions.py` (D23), `api/app.py` (routers; the worker in the lifespan, started only when
  `TRES_EGRESS=on`), `api/prodserver.py` (reads `TRES_EGRESS`), `alembic/versions/00NN_tres.py` (D26).
- `deploy/local/docker-compose.yml` (`TRES_EGRESS` under the api's `environment:`), `.env.example`,
  `deploy/local/web/nginx.conf` (`terminology` joins the prefix list; `tests/test_nginx_routes.py`).

## 8. Dashboard

- `screens/admin/TresTab.jsx` and its panels — Bağlantı ve ayar, Gönderimler, Bölüm eşleme, Hekim kimlikleri, Kod
  eşleme; its own `lazyScreen` line and `TABS` line in `AdminScreen.jsx` (`perm: "tres.manage"`). The `/admin` route
  opens for a `tres.manage` holder too.
- `screens/patient/diagnoses/`, `procedures/`, `epikriz/` — the three boxes; `screens/kabul/` gains the diagnosis search.
- `screens/common/CodeSearch.jsx` — the one search field over `/terminology/search`.
- `screens/admin/catalogue.js`, `i18n/strings/perms.js`, `screens/denetim/denetim.js` (`EVENT_TYPES`), the four strings files (D27), `backendApi.js`.

## 9. Testing

- Engine, DB-less: golden tests of each mapper against §5 (synthetic people only); `az.py` rules; the client over
  `httpx.MockTransport` (token, 401, find → POST/PUT, the two `id` rules, the three error shapes, 429); the worker and
  ledger against `tests/fake_tres.py`, an in-process stand-in that enforces what §4 states (an `id` on POST, the `id`
  match on PUT, search by local id only, 409 on a referred resource, the required elements of §5); `TRES_EGRESS` off →
  no transport is ever built; routes, rights, refusals, audit payloads.
- Engine, Postgres: the migration up and down, the permission rows once, encryption at rest of the password and FİN.
- Dashboard: the tab and its panels, the three boxes, the search field; `reachable`, `boundaries`, `strings`, `rawKeys`.
- Gates as G3-02: the no-DB suite, the Postgres part on a disposable test database, `vitest run`, `npm run build`,
  a walk on the local stack with a synthetic stay from admission to a sent package against the stand-in.
- **Sandbox (F6, owner's account):** `mode = validate` over a synthetic stay, then a real write and delete on the
  sandbox. Live is not touched in this slice.

## 10. Phases (one plan, each through its own gate)

F0 settings, ledger, client, worker skeleton, permission, tab shell, `TRES_EGRESS`, the stand-in · F1 Patient,
Practitioner, Encounter, vitals, the two mapping panels · F2 code lists, «Tanılar», Condition · F3 «İşlemler»,
Procedure · F4 laboratory · F5 «Epikriz», Composition · F6 withdrawals, documents, sandbox.

## 11. Deploy

One release when the owner says: bundle → `alembic upgrade head` → api + web images; hub, bridge, nce and postgres
untouched. With `TRES_EGRESS` unset nothing leaves the server and the tab says the feed is closed. Opening it at a
hospital is its own step with its own «onay»: egress to the platform on 443, the code lists loaded, the account and
the mappings entered, `validate` first. `docs/EDGE-BRIDGE-LOCAL.md` and the on-prem spec gain the sentence that the
promise holds only while the feed is closed, and what leaves when it is open. Guide: `docs/homunculus-rehber-TR.md` §3.25.

## 12. Open items

- O1 The sandbox account (`username`, `password`, `healthcareProviderId`) and each hospital's Organization id — owner.
- O2 Where the code lists are taken from, and whether they may be shipped with the product — owner / ministry.
- O3 Bundles (`az-hospital-bundle`): single resources are accepted today; the ministry has not said for how long.
- O4 The newborn without a FİN (`az-newborn-patient`, the mother's FİN): NICU needs it; the reference sender's own question to the ministry is unanswered.
- O5 The legal basis of sending, and a patient whose consent is `UNCONSCIOUS_LATER` — owner; the module sends whoever the stay rule selects.
- O6 Laboratory: every result (D11) or first and last, as vitals — owner.
- O7 SpO2 goes as `2708-6` (arterial blood) in the reference sender; a pulse-oximetry code would be the usual one — ask the ministry before live.
- O8 The official system for a local, non-LOINC test code — unanswered in the reference correspondence; not needed by D11's list.
- O9 A rotation of `PHI_ENCRYPTION_KEY` changes every Patient's local id (D5): a rotation needs a ledger re-key step.
- O10 Address, marital status, citizenship as a code, the person registry — with H1a.
- O11 Cut-over where another system already reports (Bona Dea): which resource types open, and when the other sender closes — owner's word, per type.
- O12 Radiology, pathology, ImagingStudy — with H6.

## 13. Amendments (plan F0)

Made by `docs/superpowers/plans/2026-11-11-tres-f0-altyapi.md` (phase F0: infrastructure) and by the review of F0
that followed it (commits `7d508d2c`…`9a306d44`). Where a line above and a line here disagree, this section is right.

### 13.1 From the plan

- **§10 — one plan per phase.** F0…F6 are seven plan documents, each with its own gate; «one plan» is withdrawn.
- **D23 — the 29th key.** `pharmacy.view` (G3-04) reached main first; `tres.manage` is appended after it.
- **D26 — migration 0020.** `0019_pharmacy_view.py` is on main; this slice's file is `0020_tres.py`
  (`down_revision = "0019"`). G4-03 reached main first with `0020_quality_view.py` (`b2fb07d0`), so at merge this
  file takes the next free number on main, and every «0020» in this section and in the module follows it (plan F0,
  N13). F0 creates `tres_settings` and `tres_deliveries`; F1–F5 add the other seven tables to the same file while the
  branch is unmerged (O19).
- **D26, §9 — no permission row.** `tres.manage` is in no default group and the system group holds every key by
  rule at token issuance, so the migration writes no `group_permissions` row (as `summary.view`); its test asserts so.
- **D2, §7 — where the switch is read.** `TRES_EGRESS` is read once in `create_app` (`tres/egress.py` →
  `app.state.tres_egress`), as the wave feed reads its settings; `api/prodserver.py` is not touched.
- **§6 — refusal codes.** They live in `tres/errors.py`. Besides `egress_off`: `tres_mode`, `tres_environment`,
  `tres_settle_hours`, `tres_types`, `tres_base_url`, `tres_host_not_allowed`, `tres_field_length` (all 422) and
  `tres_account_incomplete` (409: the selected environment's account lacks the base URL, the username, the password
  or the provider id). The connection test answers `egress_off` and `tres_host_not_allowed` with 409.
  `tres_off` and `summary_signed` come with the phases that need them.
- **§6 — the connection test** is allowed in the mode `off` and writes no audit row.
- **D24 — `tres.settings`** carries `{"actor", "changed": [<field names>]}` — names such as `mode`,
  `test.password`, never a value — and, when a base URL changed, `"hosts": {<environment>: <its new host, or
  null>}`: the bare host name, the one value written, so the trail shows where an account was pointed. A save that
  changes nothing writes no row. The event's label on «Denetim bütünlüğü» was added with the route (the dashboard
  holds its label list to the engine's event types).
- **D21, §7 — the worker's seam.** A `PackageSource` yields packages — async callables handed a `Sender`
  (`send`, `skip`) — not resources: a package reads each ledger row's `remote_id` before it builds what refers to
  it (D8). The 300 ms spacing is a hook on the client the worker sets, so it holds between any two requests.
  After a 429 the whole loop waits `Retry-After` (never less than a round), not the one tenant.
- **D6, D7, D21 — the ledger.** A failed payload's digest is stored; an unchanged failed payload waits 30 minutes,
  an unchanged `stuck` one waits for `force`; a changed payload is tried at once and its count starts again. In
  `validate` mode an unchanged payload already `validated` or `sent` is not validated again. `last_error` is cut to
  500 characters and 1000 UTF-8 bytes (its ciphertext must fit 1536). What counts as an attempt: §13.2, first line.
- **§4 — the client.** A failure with no answer is an error with no status, named by its class; `$validate`
  answering 2xx with an `error` or `fatal` issue is a refusal. Both are this module's reading, to be re-checked in F6.
- **§8 — `/admin` for `tres.manage`.** The key is added to the route's `perms`; `/admin` being a work screen, a
  session that holds `tres.manage` alone can sign in and lands there.
- **§9 — the stand-in** enforces §4 only; each profile's required elements (§5) join it with that profile's mapper.
- **§11 — the guide's section is §3.25.**
- **§8 — the build.** With F0's strings the shared i18n chunk passes Vite's 500 kB note (measured: see the plan's
  Gates block). Splitting the catalogue is not this slice's; the controller accepted the note for F0.

### 13.2 From the review of F0

Two review rounds; the fixes are `7d508d2c`…`9a306d44`.

- **D21 — what is an outage and what is the resource's (closes O13 with «no»).**
  - **An outage leaves the ledger row as it was.** These are outages:
    - a refused session (`TresSessionError`): the token route answering anything but 2xx, a 2xx without a usable
      session id, or a second 401 on a FHIR call;
    - no answer;
    - a 3xx (redirects are off);
    - 408, 429, 502, 503 and 504.
  - **Every other failure is about the resource and counts towards its `stuck`:**
    - a 4xx;
    - 500, 501 or any other 5xx;
    - a `$validate` error;
    - a search answer `find` cannot trust (below).
  - **Why a 500 counts.** A server that chokes on one input answers 500 every time. If a 500 did not count, five such
    resources would end every round before the packages behind them; counted, they reach `stuck` and stop blocking.
  - **How a round ends.** The worker ends a tenant's round at once on a refused session or a 429. Five failures in a
    row also end it. Counted 5xx answers and outages both count towards those five; a 4xx refusal resets the streak.
    In a platform-wide 500, each round costs at most five rows one attempt each, and those rows then wait 30 minutes.
- **D21 — a refused login parks the tenant.** The token route may refuse the account itself: a 4xx other than 408 and
  429 (`TresLoginRefused`). Then `tres_settings.session_refused_at` is set and every later round passes the tenant
  over. The result is one failed login, not one every five minutes; a ministry account can lock. Two things clear it:
  any saved change to the tenant's settings, and a successful connection test. While it is set, the tab says so.
- **D6 — one writer per resource.** The ledger row is taken under a row lock (`INSERT … ON CONFLICT DO NOTHING`, then
  `SELECT … FOR UPDATE`): two deliverers of one resource (a round and «send now», later) take turns, and the platform
  holds one record. The delivery's transaction spans its HTTP calls on purpose. Each call is bounded by the client's
  overall deadline (below), but a delivery makes several calls (PUT, then on a 404 a search and a POST), so it can
  hold its row for a few minutes at worst.
- **§4 — the search is not the answer.** The `local-system-unique-id` search is a FHIR string search,
  case-insensitive and by prefix: its first entry may be another resource's.
  - `find` takes only the entry whose local id is exactly the one asked, anywhere in the answer.
  - With no such entry, it answers «not there» only when the answer is complete: a searchset Bundle with no `next`
    link, a `total` not above its entries, and every entry carrying the local-id extension.
  - Any other answer raises `TresSearchUnclear`, which is counted, and nothing is POSTed: a POST beside a record on a
    later page would duplicate it in the national record.
  - The stand-in searches and pages as the platform does (20 entries a page by default).
- **D2, §7 — the install decides where data may go.** Beside `TRES_EGRESS`, a third install-level setting:
  `TRES_HOSTS` (comma-separated host names; unset = the platform's two, `ehr-sandbox.e-health.gov.az` and
  `ehr.e-health.gov.az`). A base URL on any other host is refused at save (422 `tres_host_not_allowed`) and at connect
  (409).
  - **Hosts are compared in their wire form.** A host IDNA cannot read is refused with 422 `tres_base_url`.
  - **Unchanged addresses are not judged again.** A stored address sent back unchanged is not judged against
    `TRES_HOSTS` again, so narrowing the list never locks the tab's form; the factory refuses that address at connect.
    The refusal names the environment.
  - **What a base URL may carry.** No user name or password, no query, no fragment and no port but 443.
  - **A changed address drops the password.** Changing an environment's base URL without a new password in the same
    save deletes that environment's stored password, so a credential never follows a changed address.
  - **One way to a client.** The only way to a client is the guarded factory (`egress.open_client`,
    `app.state.tres_client_factory`), which checks both install settings when called. No route or round builds a
    client itself.
- **D3, D21 — the tenant's switches hold at the choke point.**
  - The `Sender` skips a record type that is switched off (`type_off`) and asks nothing. Such a skip never touches a
    row the platform holds (one with a `remote_id`).
  - A round re-reads the tenant's settings before every package. When their `updated_at` has moved since the round
    began, that tenant's round ends. Any saved change counts: mode, environment, types or account. The next round
    starts on the new settings.
- **§4, D21 — smaller.**
  - **Deadline.** Every HTTP call, the token's included, has an overall deadline (60 s, `client.CALL_DEADLINE_S`);
    reaching it is «no answer».
  - **Connection test.** It ends its database transaction before it asks the platform.
  - **Failures stay with their tenant.** One tenant's failure never ends the round for the others. Its log line names
    the exception's class and its last five frames as `file:line:function`, never its message.
  - **The package source** is closed whenever a round ends, early or not.
  - **The stand-in** refuses a reference that is not `Type/id` and a PUT that would change a resource's local id.
  - **Migration 0020** also indexes `tres_deliveries.admission_id` (`ix_tres_deliveries_admission_id`) and adds
    `tres_settings.session_refused_at`.

### 13.3 Open items added by F0

- O13 Should a 429 or a dead line count towards `stuck`? **Closed by the F0 review: no** (§13.2, first line).
- O14 `mode = validate` over a whole stay: nothing is stored, so a resource that refers to another (an Encounter to
  its Patient) has no platform id to refer to. What the platform's `$validate` does with such a reference is not
  known; the stand-in refuses it. F1 decides what a validate round sends, F6 checks it on the sandbox.
- O15 The first round's reach. When `send` opens, every stay already discharged is due at once. Where another system
  has reported those stays (Bona Dea, O11), that duplicates them in the national record. Proposed: a per-tenant
  cut-off — only stays discharged after a date, by default the moment `send` was first chosen; an older stay by hand.
  The owner's decision, before F1's source is written.
- O16 The platform's certificate chain. The client verifies TLS against the system's default store. If the ministry's
  hosts chain to a national root that store lacks, an install setting for a CA bundle is needed. Checked on the
  sandbox (F6).
- O17 FastAPI's own 422 answer to a body that fails validation returns the offending `input` to its sender. On
  `PUT /admin/tres/settings` that can be the account block, password included — sent back to the administrator who
  typed it, not to anyone else. A validation handler for `/admin/tres/*` that names fields without values would end
  it; decide before live.
- O18 The ledger's statuses for deletes (D19, F6). «The platform holds this resource» is to be read from `remote_id`,
  not from `status`: a refused PUT leaves the earlier version on the platform and the row `failed`. F6 settles it.
- O19 Migration 0020 grows in place while the branch is unmerged; the review added an index and a column after its
  first cut. A development database upgraded to an earlier cut is taken down to 0019 and up again before the next
  phase's tests. Nothing outside development ever ran 0020.
- O20 Local ids that are nobody's prefix. The search matches by prefix, so `hmn-l-1` also finds `hmn-l-10` through
  `hmn-l-1999`. `find` is safe either way (§13.2), but D5's ids should end every numeric part with a delimiter, so
  that a search answers one entry. F1 decides this before its first mapper, because a sent local id never changes.
- O21 A row in `stuck` leaves that state only by `force`: the nightly retry or «Yeniden dene», neither of which is
  built yet. Since a 500 counts (§13.2), a platform-wide 500 of two hours or more parks the due backlog there. Both
  ship in F1, before any tenant can send to a live host.
- O22 How the platform answers a search, checked on the sandbox (F6):
  - whether it adds `search.mode: outcome` entries, which `find` would refuse today;
  - whether it pages, and how;
  - whether it echoes the local-id extension on every entry.
