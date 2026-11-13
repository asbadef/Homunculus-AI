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

## 14. Amendments (plan F1)

Made by `docs/superpowers/plans/2026-11-12-tres-f1a-hasta-yatis.md` (the engine) and
`docs/superpowers/plans/2026-11-12-tres-f1b-hasta-yatis.md` (the panels) — phase F1: Patient, Practitioner,
Encounter, vital signs. «A25 (3)» is amendment 25, point (3), of the F1a plan's header, which keeps every amendment's
full reasons: 1–22 are the plan as written, 23–27 its review rounds of 2026-11-12/13, 28 the final review of the whole
phase (2026-11-13). Where a line above and a line here disagree, this section is right.

### 14.1 The engine

- **O20 — closed: a local id ends with its only dot** (A1, A23 (6)). `hmn-p-{phi_digest(FİN)[:32]}.`,
  `hmn-pr-{user id}.`, `hmn-e-{root admission id}.`, `hmn-v-{root admission id}-{signal key}-{first|last}.`; F2–F5's
  follow (`hmn-c-{row}.`…). No id is then a proper prefix of another; each is a FHIR id of at most 64 characters
  (`ids.is_local_id`). A vital sign is keyed by the signal's stable `id_key` (`heart-rate`, `resp-rate`, `spo2`,
  `temperature`, `sbp`, `map`, `weight`, `height`), never its LOINC code: a sent local id never changes, so a code
  change (O7) is a PUT of the same resource, not a second record. Whether the platform takes the dot: O24.
- **D10 — the readings** (A23 (3)(5)). The first and last non-withdrawn `chart` value of each signal. A `chart` row the
  bridge's tenant token wrote (`charted_by` `tenant-token`) is a device's sample, not a person's, and is not sent. A
  `chart_retract` withdraws a row only when its `entry` is an `int` that is not a `bool` (the engine's own guard).
  Drift tests hold both to `api/clinical.py`, `api/rehydrate.py` and `api/app.py`. A reading timed outside the stay is
  sent as charted (O27).
- **N2, N3 — one trail read per stay; the person from the root** (A3, A4, A25 (4)). A transfer keeps the protocol
  number and the patient row, so a stay's chart rows are all under its last row's board key: one read. The Patient's
  id is `phi_digest` of the root's FİN, normalised; without a usable FİN (`fin_missing`, `fin_format`) the Patient is
  skipped under the placeholder `hmn-p-s-{root}.`, whose skip is forgotten once a FİN keys the person.
- **D20 — ASCII only** (A23 (1)(2)(7), A25 (10)). A FİN that is not ASCII is refused before `upper()` (`ß`→`SS`,
  `ı`→`I` would be transliteration); a phone takes ASCII digits only, and its nine national digits never begin with
  `0`. `ids.patient` normalises the FİN itself and never puts it in an error.
- **D12 — the codes**, checked 2026-11-12 at `tx.fhir.org` (LOINC 2.83, UCUM 2.2) and pinned in `tres/codes.py` (A11):
  8867-4 `/min`, 9279-1 `/min`, 2708-6 `%` (O7), 8310-5 `Cel`, 8480-6 `mm[Hg]`, 8478-0 `mm[Hg]`, 29463-7 `kg`, 8302-2
  `cm`. `code.text` is the LOINC display (no reviewed Azerbaijani label exists); `valueQuantity.unit` is the UCUM code.
  A weight or height must be finite and positive (A23 (9)).
- **§5, D20 — not sent yet** (A12). `identity-document-type` `15` and `encounter-type` `1` go without a display; the
  blood group is not sent (O23).
- **D8, D17, D6 — the Encounter** (A13–A15, A23 (10)). Its Practitioners are the chain's distinct
  `attending_physician_id`, in chain order (`participant` without `type`); its department the last admission's unit;
  its period from the root's admission to the last's discharge; `finished` once the last row is DISCHARGED — a finished
  stay with no `discharge_at` is skipped `discharge_missing`, never sent without `period.end`. The ledger's
  `admission_id` is the stay's last admission.
- **D22 — time** (A16, A23 (8)). A zone the server does not know skips the Encounter (`timezone_unknown`), never
  guessed; a time with no zone is refused, never read as the server's. `UTC`, the tenant's default, is used as UTC.
- **D16 — a practitioner's identity is keyed (tenant, user)** (A24 (8)), not per user: the engine is multi-tenant.
- **O14 — closed: validate and references** (A2). In `validate` a resource whose reference has no platform id in the
  ledger is `skipped` `no_reference`; nothing that points at nothing is sent. A tenant that never sent validates its
  Patients and Practitioners. F6 checks `$validate` on the sandbox and may relax this.
- **D9 — the rounds' window** (A5, A25 (3), A26 (3)). A stay is due while `after < key <= now − settle_hours`, its key
  `greatest(discharge_at, updated_at)` of the last admission: a discharge confirmed late, or an edit after the stay
  left the rounds, brings it back, its wait counted from then. `after` is the earlier of a week back (`source.REACH`)
  and `tres_settings.reached_to`, the upper bound of the last round that ran to its end for the tenant (a
  compare-and-set that never touches `updated_at`; reset by an environment change only); before any round has run to
  its end, the cut-off alone bounds it (a week back without one). So a tenant parked or closed for more than a week
  catches up, and a stay a completed round did reach leaves the rounds after its week (D7: an unchanged resource asked
  nothing meanwhile). A DISCHARGED row with no `discharge_at` is never due on its own. This replaces A5's «an older
  stay goes only by hand» for a stay no completed round reached.
- **O15 — PROPOSED, AWAITING THE OWNER'S WORD: the cut-off** (A6, A26 (5)). `tres_settings.send_from`: only a stay
  whose last `discharge_at` is at or after it goes automatically; the save that first chooses `send` sets it to its own
  moment; the tab shows and moves it — from 2020-01-01 to 366 days after the save (422 `tres_send_from`) — and cannot
  clear it. An older stay goes by hand. A `validate` round with no cut-off stored reaches back its week.
- **D21, O21 — closed: the nightly retry** (A8, A25 (6)(7), A26 (1), A27 (1)(3)). At the first round at or after 04:00
  in the tenant's zone — never before, a first night included; a zone the server does not know falls back to UTC,
  said once per tenant per process — marked by a compare-and-set of `tres_settings.retried_at`, the night rebuilds
  with `force` every UNFINISHED stay: one with a row `stuck`, `failed` or `pending` in the selected environment, and in
  `send` one whose Encounter is not `sent` (skipped for any reason but F6's `deleted`) — so a FİN added, a unit mapped
  or a zone set later sends the stay with no hand. Each row is first walked to its stay's last admission (one key with
  the due set; at most `source.CHAIN_MAX` = 64 steps). Never a stay discharged before `send_from`: judged on that last
  admission, and again once the stay is read. Only a stay whose key is within 90 days (`source.NIGHT_REACH`): a stay
  that can never be sent — a newborn or a foreign national with no FİN — is not rebuilt every night for ever; an
  older one keeps its rows and goes by «Yeniden dene». Why: no stay lost in a gap, none sent across the cut-off.
- **D9, D21 — the hand** (A9, A20, A26 (4), A27 (1)(7)). «Şimdi gönder» sends one stay now, due or not (an admitted
  patient as `in-progress`); «Yeniden dene» forces the row's whole stay. Neither is held by the cut-off: a person's
  deliberate act. Refusals: 409 `egress_off`, `tres_off`, `tres_account_incomplete`, `tres_live_closed`,
  `tres_host_not_allowed`; 409 `tres_login_refused` at once for a parked tenant, the platform not asked (each click
  would be one more failed login); 409 `tres_other_environment` for a row of the environment not selected
  (`tres_environment` was already the settings form's); 409 `tres_busy`; 429 `tres_throttled`, with `retry_after` in
  the body and the `Retry-After` header (whole seconds, rounded up) when the platform gave a wait; 503
  `tres_platform_unavailable`; any other failure is rolled back, audited `result: "error"` and raised (500). A refused
  precondition asks nothing and writes no audit row.
- **D9 — a draft stay is not sent by hand** (amendment 28 (2)). A stay whose LAST admission is DRAFT — the admission
  form not yet signed, often with no attending — is 409 `tres_stay_draft` for «Şimdi gönder» and «Yeniden dene»: after
  the locks and the stay's lookup, before the platform is asked, no audit row. The preview still shows it.
- **An Encounter's own skips keep what the platform holds** (amendment 28 (3)). `unit_unmapped`,
  `organization_missing`, `timezone_unknown` and `discharge_missing` are written with `keep_held`, as `patient_unheld`
  is: a held Encounter whose unit's mapping is cleared stays `sent` with its id, and the night does not take it.
- **D21 — a package that raises leaves its stay `failed`** (amendment 28 (5)). An exception nothing else handles (not
  `LedgerBusy`, not the client's `TresError`) is caught in `StaySource.package` — the one door of the rounds, the night
  and the hand: the session is rolled back and the stay's Encounter row (`ids.encounter(root)`, keyed to its last
  admission) reads `failed` with the catalogue reason `package_error` — counted as a refusal is (the 30-minute wait,
  `stuck` at the fifth), no words of the exception — then the exception is raised again (the round counts it, the hand
  audits `error`). A held Encounter stays `sent`. Why: such a stay left the rounds' week with no row, and nothing
  would ever try it again; now «Gönderimler» shows it and the night retries it.
- **Re-review of amendment 28** (2026-11-13): a refusal clears the row's `reason` (it is no `package_error`) and
  one count serves a stay's failures — `record_failure` counts on from a `failed` or `stuck` row whatever its
  reason (a `stuck` row stays `stuck`), a refusal counts on from a package error's attempts; the rollback of a
  failed package is inside its guard (the package's own exception is what is raised); validate's `no_reference`
  Encounter skip keeps what the platform holds.
- **N12 — a person never queues behind a round** (A9, A24 (5)(6)). Each row is taken under `SET LOCAL lock_timeout =
  '2000ms'` → 409 `tres_busy`. The bound covers taking the row only — back to the default once it is held, so the write
  after the HTTP calls is not cut — `forget_skip` included. Not `NOWAIT`: that does not bound a wait on another
  transaction's uncommitted INSERT.
- **N15 — parking on the round's settings** (A10, A24 (4)). `park` sets `session_refused_at` only while `updated_at`
  is the version the round (or request) began on; without a version it parks nothing.
- **A person's one Patient: the newest stay owns it** (A25 (1), A26 (2), A27 (2)(4)). Two stays of one FİN build the
  same Patient id from different patient rows; its ledger row belongs to the stay whose last admission is newest (the
  later admission time; a tie, the larger id), judged under the row's lock — else every round PUT one version, then
  the other. An older stay's SEND yields only to a newer owner whose row holds a platform id (and refers to it);
  otherwise it sends its own version and holds the row until the newer stay runs. An older stay's SKIP yields to any
  newer owner, held or not (else the two took the row in turn every night and the newer's refusal never reached
  `stuck`). A package that stops at its Patient writes, in `send`, its own Encounter `skipped` `patient_unheld` —
  never over an Encounter the platform holds (`keep_held`).
- **D24 — `tres.package` once** (A17, A25 (5)): written by the run whose delivery took the Encounter's `remote_id`
  from None under the row's lock; a run cut short after that moment writes none.
- **D21 — one pacer per tenant** (A26 (4), A27 (6)): the rounds, the hand routes and the connection test share it —
  300 ms between any two requests of a tenant.
- **O5, O11 — the live platform is closed in this version** (A7, A24 (2)(3)). `tres.egress.LIVE_OPEN = False`, pinned
  by a test: no package to the live environment nor to an address on `ehr.e-health.gov.az` — the rounds pass the
  tenant over (`tres_live_closed`), the hand routes answer 409, a settings save with a mode other than `off` on such an
  account 422. The lock is inside the client factory too: `open_client` refuses patient data to a live host by default
  (`TresLiveClosed`), and only the connection test passes `patient_data=False`. An address it cannot read counts as
  live (it fails closed); a trailing dot is the same host. Opening it is a reviewed code change with the owner's word;
  O5 itself is not decided.
- **§6 — the routes and codes** (A20, A26 (4)(5), A27 (1)(c)). `GET /admin/tres/admissions?key=` finds a stay by its
  board key. The list's `admission` filter lists the rows of every admission of that stay's chain; a malformed one is
  422 `tres_filter`, never FastAPI's echo. New codes in `tres/errors.py`: `tres_live_closed`, `tres_unit_unknown`,
  `tres_department_code`, `tres_department_display`, `tres_user_unknown`, `tres_fin_format`, `tres_name`,
  `tres_filter`, `tres_cursor`, `tres_stay_unknown`, `tres_off`, `tres_busy`, `tres_login_refused`,
  `tres_platform_unavailable`, `tres_throttled`, `tres_other_environment`, `tres_send_from`.
- **D16, D17 — the maps** (A19, A26 (5)). A practitioner's FİN is write-only (`fin_set`; null keeps, `""` clears) and
  held to D20 at save; an identity the tab holds for a member who left can still be corrected, none is made for one.
  The department map is saved whole under the tenant's advisory lock: two saves take turns, never merge.
- **D25 — the preview** (A18, A26 (4)). The ledger's list carries no `last_error`; the audited preview does. The
  preview judges as a send: a type switched off shows `type_off` and no body; a Patient the person's newer stay holds
  shows `yielded` and no body; each item's status and last words are its own row's, found by its key.
- **D24 — the payloads** (A17): `tres.map` `{actor, units}`; `tres.identity` `{actor, user_id, changed}`; `tres.send`
  `{actor, admission_id, result, counts?}`; `tres.retry` `{actor, delivery_id, admission_id, result, counts?}`;
  `tres.preview` `{actor, admission_id}`; `tres.package` `{admission_id, environment, counts}`. The row's
  `patient_id` is the board key.
- **§9 — the stand-in** holds each profile by `meta.profile[0]` (A21); the tests of §4 send `UNCHECKED_PROFILE`.
- **§7 — nginx's access log** (A22): the routes with a path parameter join `map $uri $homunculus_log_uri`; `?key=` is
  a query string, which that log never writes.
- **D26 — migration 0020, in place** (A24 (1), A25 (2)(3), A26 (4)): four tables (`tres_department_map` and
  `tres_practitioner_identity` added), `tres_settings.send_from`, `.retried_at`, `.reached_to`, the list's index
  `ix_tres_deliveries_list` (tenant, environment, updated_at DESC, id DESC); the downgrade drops each object
  `IF EXISTS` (O19's down-and-up from F0's cut). No audit index (§14.4).

### 14.2 The panels (plan F1b and its review)

- **§8 — three panels under the settings.** «Gönderimler»: the ledger, newest change first, filtered by status and
  type, saying its environment; a stay found by its protocol number, with «Şimdi gönder» and «Önizle»; «Yeniden dene»
  on a `failed` or `stuck` row; a parked feed said at the top. «Bölüm eşleme», saved whole. «Hekim kimlikleri», one
  row at a time, the FİN write-only. A status or reason the panel does not know shows the engine's code, never a key.
- **The preview** opens in a dialog that says, above the bodies, that it holds patient data and that opening it is
  audited, and names its environment; it is read afresh on every open with `cache: "no-store"` (`0b8448c9`).
- **A hand's result is told by its rows' statuses** — «İşlendi: Gönderildi 3 · Başarısız 1», never «sent» for a failed
  or skipped row; a failed row makes the toast a warning; a throttled hand says the platform's own wait; after a hand
  with no answer or a refused login the list is read again (`7f012ab6`).
- **The hand's wait** (amendment 28 (1)). «Şimdi gönder» and «Yeniden dene» wait 180 s (`backendApi.js`
  `TRES_HAND_TIMEOUT_MS`), the feed's other calls 15 s; nginx gives the two routes a location of their own with
  `proxy_read_timeout` and `proxy_send_timeout` 180 s (`tests/test_nginx_routes.py` holds it to the constant). A first
  package of ~35 paced requests could not finish in 15 s, and the panel said «no answer» about a send that landed.
- **The toast's tone** (amendment 28 (4)): a confirmation only when every row is `sent` or `validated`; a row `failed`,
  `stuck`, `skipped` or `pending` makes it a warning.
- **A found stay in DRAFT** is offered no «Şimdi gönder» (amendment 28 (2)); its preview stays.
- **The list is never stale against the settings**: a save or a successful connection test makes it read again; a
  late answer never overwrites a newer list; one action at a time, the others visibly off (`7f012ab6`, `71956f5e`).
- **`send_from` on the form** is sent only when the user changed it (it carries microseconds; a minute-precision
  round-trip would move it on every save); the field says the reader's zone and the server's bounds, and that it
  cannot be emptied here (`71956f5e`).
- **The words**: `failed` is «Başarısız» (az «Uğursuz»), a skipped row az «Göndərilmədi»; every state, status, reason,
  type and environment the screens say has words in all four languages, held by a test (`6b5a8152`, `5e0d3b5f`).
- **D27 — the build**: the shared i18n chunk (`Toast-*.js`) is 528.34 kB after amendment 28 (527.77 kB at F1b's head,
  504.06 kB at F0), over Vite's 500 kB note;
  not split here — main split the catalogue (§14.4).

### 14.3 Open items

F1 closes O14, O20 and O21 and builds O15 as proposed. **Owner** marks the owner's decisions.

- **O5, O11 — owner.** The legal basis (and `UNCONSCIOUS_LATER`) and the cut-over where another system reports. Until
  both are answered the live platform stays closed in code (§14.1).
- **O7 — owner, with the ministry.** SpO2 as `2708-6` or `59408-5`; a change is a PUT of the same resources.
- **O15 — owner.** The cut-off, built as proposed. Declined: `send_from` leaves `source.due_stays` and the form (the
  column may stay; null = no cut-off). For the answer (A27): moving `send_from` earlier — or a send→validate→send
  toggle — makes the NEXT NIGHT send every stay at or after the new cut-off, within its 90 days, whose Encounter is not
  `sent` (a validate trial's `no_reference` Encounters among them): a one-night, partial catch-up of a validate
  trial. Validate-era stays that stopped at their Patient have no Encounter row (`validate` writes no
  `patient_unheld`) and are not caught; nor is a stay no round ever reached (a moved cut-off does not reset
  `reached_to`, A25 (3)).
- **O17 — extended; decide before live.** FastAPI's own 422 echoes a body's `input`: besides the settings' account
  block, the practitioner identity route can return a typed FİN to its sender (A26 (5)). A validation handler for
  `/admin/tres/*` that names fields without values ends both.
- **O23 — the ministry's CodeSystem files (F2's loader).** The displays of `identity-document-type` `15` and
  `encounter-type` `1`; the codes of `az:CodeSystem/blood-group`.
- **O24 — F6's first POST.** Whether the platform takes a placeholder `id` and a local id ending in `.`; if not, O20's
  end mark changes before any live send.
- **O25 — F6 (D19).** A `last` vital sign withdrawn after a hand send while the patient was admitted stays on the
  platform until F6's deletes.
- **O26 — F2.** The week's reach bounds how late a correction goes without a hand; F2–F5 write records after the
  discharge, and F2 decides whether a change to them brings a stay back within reach.
- **O27 — F6's sandbox.** A reading timed outside the Encounter's period (charting allows 24 h back; `discharge_at`
  can precede the last reading) is sent as charted; a refusal would leave that row `stuck`.
- **O28 — answered from main's code; one question for the owner.** On main (`88f6544c`) G3-05's Welch Allyn ward
  readings arrive at `/ingest` as `ingest` audit rows (`vital_readings.origin` device); TRƏS reads `chart` rows only,
  so it does not send them, and a withdrawal that names an `ingest` row withdraws nothing TRƏS reads. Values typed at
  the bedside stay `chart` rows and are sent. **Owner:** should a ward device's spot check count as an admission or
  discharge value?
- **O29 — a deployment check before F6.** `ZoneInfo("Asia/Baku")` must resolve inside the API container; otherwise
  every Encounter is skipped `timezone_unknown` and the night runs in UTC. With it: a tenant's zone is written only
  when the tenant is made (`POST /tenants`) and no route changes it, so a tenant made with the default `UTC` sends
  UTC times (D22).
- **O31 — decide before live: the owner, with F6** (amendment 28). A FİN corrected after its Patient was sent builds a
  new Patient (the id is the FİN's digest), and the old one — keyed by the wrong FİN's digest, possibly another
  person's FİN — stays on the platform for good: D19 says a Patient is never deleted. Options for F6: a hand delete
  of the orphaned Patient, or a longer wait before a hand send of a stay whose FİN was just entered.
- **The owner's or the controller's call** (A25 (3), A26 (2)): whether `validate` should yield a person to a newer
  stay's `validated` row (today two stays of one person within reach each validate their own version every round);
  whether `reached_to` should advance only to the oldest discharge whose package did not finish (the night now takes
  `failed` and `pending` stays, A26 (1)).
- **F6** (A27 (5)): a stay rebuilt for another row (by the night, a round or a hand) sends its `deleted` Encounter
  again; what a delete does to a later rebuild is F6's.
- O1–O4, O6, O8–O10, O12, O13, O16, O18, O19 and O22 stand as §12 and §13.3 left them.

### 14.4 Merge notes

For whoever merges the branch to main — on the owner's word only («main'e al»).

- **The migration.** `0020_tres.py` is renumbered onto main's head of that moment. At `origin/main` `88f6544c` the
  chain is `0020_quality_view` → `0022_workload_view` → `0021_vital_readings`, head revision `0021`, next free file
  number `0023` — which Lane B's G4-05 also plans: the first to reach main takes it; ask Lane A for the head.
  `down_revision` = that head; every «0020» in the file's docstrings, in §13–§14 and in the guide's §3.25 follows;
  `alembic heads` prints one head; a test of «the head» checks ancestry, never the names' order.
- **No audit index in TRƏS's migration.** Main's `0021_vital_readings` creates `ix_audit_tenant_patient_id` on `audit`
  (tenant, patient_id, id), the index the per-stay read uses (A25 (2)); a second CREATE INDEX would lock `audit` again,
  and TRƏS's downgrade must not drop main's. After the renumbering add a test that the index exists by that name.
- **The permission key.** On the branch `tres.manage` is the 29th key. On main (`88f6544c`) `quality.view` is the 29th
  and `workload.view` the 30th, so `tres.manage` becomes the 31st (or whatever is next then); the route table's count
  and the permission tests follow.
- **The i18n chunk.** Main split the string tables (`746f30a9`): `manualChunks` puts each `strings/*.js` into
  `i18n-a-k` or `i18n-l-z` by its name — `tres.js` lands in `i18n-l-z`, `denetim.js` in `i18n-a-k`; nothing to move.
  Rebuild after the merge: no chunk over 500 kB.
- **Watch: a bulk UPDATE of `admissions`** (A27). The window's key reads `admissions.updated_at`, which the model's
  `onupdate` moves on every ORM flush and every SQLAlchemy `update()` that does not set it: a bulk UPDATE — a
  migration's backfill, a script — puts every touched DISCHARGED stay at or after the cut-off back in the rounds'
  reach for a week, and an unfinished one in the night's 90 days. Check each one when the branches meet (main's
  `0021` and `0022` at `88f6544c` write no `admissions` row).
- **Expect conflicts near the readings.** Main changed `api/audit.py`, `api/clinical.py` (a `chart_retract` may now
  name an `ingest` row, G3-05), `api/rehydrate.py` and `api/app.py`. TRƏS's stay reader leans on `iter_records_of`,
  `RETRACT`, `retracted_entries` and the device token's literal, and its drift tests read those files: they must pass
  after the merge.

### 14.5 Native reading (owner item)

The `az`, `ru` and `en` texts F1 added were written without a native speaker (F0's N10 holds for F0's). F1 added 119
keys to `strings/tres.js` and 6 to `strings/denetim.js`, each in four languages, and changed no F0 key
(`git diff f74b474a..5e0d3b5f`: 117; amendment 28 added `tres.reason.packageError` and `tres.err.stayDraft`):

- `tres.`: `sendFrom`, `sendFromHint`, `sendFromUnset`, `sendFromZone`, `sendFromCleared`, `liveNote`;
- `tres.status.` (7): `pending`, `sent`, `validated`, `failed`, `skipped`, `stuck`, `deleted`;
- `tres.reason.` (16): `finMissing`, `finFormat`, `nameSingle`, `fatherNameMissing`, `sexUnmapped`, `birthDateInvalid`,
  `identityMissing`, `nameMissing`, `unitUnmapped`, `organizationMissing`, `timezoneUnknown`, `noReference`,
  `typeOff`, `dischargeMissing`, `patientUnheld`, `packageError`;
- `tres.deliveries.` (43): `title`, `sub`, `loading`, `readFailed`, `empty`, `emptyFiltered`, `inEnvironment`,
  `parked`, `filterStatus`, `filterType`, `all`, `caption`, `when`, `type`, `key`, `status`, `reason`, `attempts`,
  `actions`, `more`, `retry`, `retried`, `preview`, `findLabel`, `find`, `found`, `discharged`, `stillAdmitted`,
  `sendNow`, `handled`, `handledNone`, `state.{DRAFT, PENDING_DISCHARGE, PENDING_TRANSFER, TRANSFERRED, DISCHARGED}`,
  `previewTitle`, `previewNote`, `held`, `notHeld`, `lastError`, `yielded`, `wait`;
- `tres.departments.` (13): `title`, `sub`, `loading`, `readFailed`, `empty`, `caption`, `unit`, `code`, `display`,
  `closed`, `invalid`, `save`, `saved`;
- `tres.practitioners.` (16): `title`, `sub`, `loading`, `readFailed`, `empty`, `caption`, `name`, `fin`, `finStored`,
  `finClear`, `family`, `given`, `actions`, `invalid`, `save`, `saved`;
- `tres.err.` (18): `liveClosed`, `unitUnknown`, `departmentCode`, `departmentDisplay`, `userUnknown`, `finFormat`,
  `name`, `filter`, `cursor`, `stayUnknown`, `off`, `busy`, `loginRefused`, `platformUnavailable`, `throttled`,
  `otherEnvironment`, `sendFrom`, `stayDraft`;
- `denetim.type.` (6): `tresPackage`, `tresMap`, `tresIdentity`, `tresSend`, `tresRetry`, `tresPreview`.

Named doubts: `tres.err.liveClosed` tells a hospital administrator, in every language, that the legal basis and the
cut-over «are not yet decided» — the project's open items O5 and O11 on a hospital's screen; en and ru
`tres.deliveries.sub` say «resource» / «ресурса» where tr and az now say record («kaydın», «qeydin»; `6b5a8152`); the
az `tres.practitioners.*` wording «şəxsiyyət məlumatları» (also in `tres.reason.identityMissing`) was chosen by a
non-native reader.
