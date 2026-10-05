# Homunculus on the hospital server — runbook

Everything runs on the server: the database, the engine, the dashboard and the HL7 bridge. No
patient data leaves the building, and no internet access is required at run time.

For running the bridge in Docker see [EDGE-BRIDGE-DOCKER.md](EDGE-BRIDGE-DOCKER.md). For why the
devices reach us through NCE's files rather than HL7, see **The device route** below.

## Bring-up

```bash
sudo mkdir -p /opt/homunculus && cd /opt/homunculus
git clone https://github.com/asbadef/Homunculus-AI.git .        # or copy the repo across
cd deploy/local

cp .env.example .env && chmod 600 .env
$EDITOR .env          # POSTGRES_PASSWORD, JWT_SECRET, TENANT_TOKEN, SEED_ADMIN_*,
                      # LISTEN_ADDR (device network), WEB_LISTEN_ADDR + WEB_PORT (browser)
```

Generate the secrets rather than inventing them:

```bash
openssl rand -base64 36
```

Create `site-mapping.json` next to the compose file **before** the first `up` — Docker creates a
*directory* where a bind-mounted file is missing, and the error that follows names neither the file
nor the cause:

```json
{
  "MDC_ECG_HEART_RATE": "heart_rate",
  "MDC_PULS_OXIM_SAT_O2": "spo2",
  "MDC_PRESS_BLD_NONINV_MEAN": "map",
  "MDC_RESP_RATE": "resp_rate",
  "MDC_TEMP_BLD": "temperature"
}
```

The mapping **replaces** the built-in table rather than merging with it, so it must list every code
the site sends. An unknown signal slug stops startup rather than silently dropping that signal.

## The device route: NCE's files, not WACP

The Connex Spot monitors do not speak HL7. The discovery probe caught a `RNDZCONNECT` rendezvous on
2575 — Welch Allyn's own WACP — and the device hung up when nothing answered it. The address the
device was calling turned out to be the hospital's **Welch Allyn NCE 5.2.0.2** server, which has
been collecting from these monitors since 2020 and writes every session to `SavedCopies` as XML.

So the bridge reads those files instead of implementing the vendor's protocol. The `nce` service in
`deploy/local/docker-compose.yml` mounts that folder **read-only** and runs
`scripts/run_nce_bridge.py`. Nothing is installed on the NCE server and nothing there is
reconfigured: it is a live clinical system four devices have depended on for five years.

Mount the share on the host before the first `up` — see `NCE_SHARE_PATH` in `.env.example` for the
exact `mount -t cifs` line, including the `uid=10001` that the bridge container needs. Without it
the container lists the directory fine and cannot open a single file, which looks exactly like an
empty share.

**What discovery actually found at this site (2026-09-02):** `SavedCopies` holds two kinds of file.
The `DeviceToNCE.xml` sessions are WACP object serialisation — useful for discovery, painful to
map. But the `NCEToHost.txt` copies are **NCE's own HL7 ORU rendering of the same readings**, with
standard MDC codes (`150456^MDC_PULS_OXIM_SAT_O2^MDC` and friends). The bridge therefore parses any
file starting `MSH|` with the same HL7 gateway the MLLP bridge uses, mapped through `hl7_signals`
in `nce-mapping.json` (keyed by the numeric OBX-3 code), and restamps every observation with the
filename's UTC epoch — the vendor's own timestamps are naive local time from a machine with a known
one-hour clock skew. `nce-mapping.json` in the repository already carries this site's four codes;
diastolic (150022) is deliberately unmapped and shows in the report by design.

**A reading saved without a patient id does not reach the board — by design (2026-09-03/04).**
The Connex Spot lets a clinician save vitals without entering or scanning a patient id. NCE then
renders PID-3 as `^^^X^PI`: the identifier components are empty, and only the assigning authority
(`X`) and the identifier-type code (`PI`) are filled. Those are HL7 code-table values, not
identifiers. Until 2026-09-04 the gateway accepted the first non-empty component and so filed every
anonymous reading from every device under one pseudo-patient `X` — a new reading silently
overwrote the previous one on the same card, which is what "I took a reading and nothing changed"
looked like on the ward. The gateway now takes the id only from CX.1–CX.3 and rejects the rest with
`missing or empty PID-3 patient identifier`; the bridge counts it under `reddedilen` and logs the
reason. **The fix on the ward is procedural: enter or scan the patient id on the device before
saving the reading.** `deploy/local/nce-doctor.sh` prints the PID-3 shape of the newest copies so
this is visible in one look.

Unlike `site-mapping.json`, **`nce-mapping.json` ships in the repository** — already present next to
the compose file, so the missing-bind-mount trap above does not apply to it. Its XML sections ship
*empty*, and that is deliberate: for a new site the first run is a discovery run. The bridge
forwards nothing it cannot map and reports the field names the sessions actually carry:

```text
WARNING nce-bridge: Eşlenmemiş alanlar: PatientId (12), SpO2 (12), Nibp_Systolic (12)
```

Fill `nce-mapping.json` in from that line — `patient_fields`, `timestamp_fields` and `signals` —
then `docker compose restart nce`. Guessing the vendor's field names instead is how a pilot receives
nothing while every screen looks healthy. Sessions that arrive *during* the discovery window are
recorded as processed even though they were refused, so to re-ingest them once the mapping is
filled in, stop the service, delete the ledger (`/data/nce.db.ledger` inside the `nce-data`
volume), and start it again with `--since` covering that window.

The compose service passes `--cloud-url` from the start, so `docker compose logs nce` shows an
`uplink:` line rather than the `KEŞİF MODU` banner — but with an empty mapping nothing is forwarded
either way, which is what makes the first run a de-facto discovery run regardless.

By default only sessions written since the bridge's first-ever start (remembered in the ledger, not
reset on every restart) are forwarded. `--since 2026-08-01` or `--all` backfill deliberately; both
put more patient data at rest, so they are a decision, not a default.

Configuring an HL7 ORU output on NCE itself remains the production target. The file route is what
unblocks the pilot without waiting on a vendor. See
[the design](superpowers/specs/2026-08-28-nce-file-bridge-design.md).

```bash
docker compose up -d
docker compose ps            # all services healthy
docker compose logs -f api
```

## The Dräger Infinity route: Gateway or ask

The pilot ICU's real continuous-telemetry source is a Dräger Infinity network — 13 Kappa bedsides
(VF9.1-C) on their own subnet, live ECG on occupied beds. Unlike the NCE monitors, this device
generation's HL7 exit is **Infinity Gateway**, separate Dräger software that exports HL7 ORU from
the Infinity network. Whether the hospital has it, or can license it, is an open question — see
`docs/drager-infinity-biomed-sorulari.md` for the exact questions asked and
`docs/superpowers/specs/2026-09-03-drager-infinity-integration-design.md` for the full design.

**No new code is needed for this path.** The engine's existing MLLP bridge
(`homunculus-engine/scripts/run_bridge.py`, `homunculus-engine/src/homunculus/edge/mllp.py`) is
the same bridge already proven against the NCE and MEDIBUS work — it just needs Gateway's HL7
output pointed at it.

Once Gateway is configured to send its HL7 ORU output at the Homunculus host's MLLP port (the
network path from `172.100.101.72` to the Dräger subnet was already verified reachable on
2026-09-02), run the bridge in discovery mode from `homunculus-engine/`:

```bash
python scripts/run_bridge.py --db bridge.db
```

With no `--cloud-url`, nothing is forwarded — the log prints:

```text
KEŞİF MODU: veri iletilmiyor, yalnızca dinleniyor ve kodlar raporlanıyor (iletmek için --cloud-url verin)
```

followed by periodic `Eşlenmemiş kodlar: <code> (<count>), ...` lines as real Gateway traffic
arrives. From those, write `drager-gateway-mapping.json` — the same flat shape `run_bridge.py`
expects for any site (`{"<OBX code>": "<SignalCode slug>"}`), for example:

```json
{
  "150456": "spo2",
  "150455": "heart_rate",
  "150457": "resp_rate"
}
```

An unknown `SignalCode` slug fails startup loudly rather than silently dropping a signal for the
whole pilot (`run_bridge.py`'s `load_mapping`). Re-run with the mapping and an uplink:

```bash
python scripts/run_bridge.py --db bridge.db \
  --mapping drager-gateway-mapping.json --cloud-url https://<host>/api --token <tenant-token>
```

and confirm one live Dräger-fed bed's observations reach the dashboard, the same acceptance check
already used for NCE and MEDIBUS.

If Gateway turns out not to exist and cannot be licensed, the fallback is the Kappa bedside's own
serial export (*Infinity RS-232 Export Protocol*, Dräger doc MS28819) — a second protocol driver
inside the `medibus/` package, reusing its transport/buffer/CLI machinery, blocked on obtaining
that document. See the design doc's "Track 2" for what that needs.

## Verifying

```bash
# the proxy path works end to end
curl -s http://172.100.101.72/health

# the engine accepts an observation and the whole chain is wired
docker compose exec bridge python scripts/hl7_simulator.py \
  --host bridge --port 2575 --patients 1 --count 3
```

Then check, in order:

```bash
docker compose logs bridge | tail -5                       # messages and observations counted
curl -s -H "Authorization: Bearer $TENANT_TOKEN" http://172.100.101.72/patients
curl -s -H "Authorization: Bearer $TENANT_TOKEN" http://172.100.101.72/alerts/<patient-id>
```

The audit trail records every ingest with its value, unit and observation time:

```bash
docker compose exec postgres psql -U homunculus -d homunculus -c \
  "SELECT event_type, count(*) FROM audit GROUP BY event_type ORDER BY 2 DESC;"
```

Confirm the live stream is not being buffered by nginx — it should hold the connection open and
emit frames rather than printing nothing and exiting:

```bash
curl -N "http://172.100.101.72/stream?token=$TENANT_TOKEN"
```

## Active Directory sign-in (optional)

Clinicians can sign in with their hospital (Active Directory) account instead of a Homunculus
password. It is off until `LDAP_URL` is set. Local accounts keep working either way, and the API
refuses any change that would leave the hospital without an active **local** administrator, so
a directory outage or a mapping mistake can always be repaired from inside Homunculus. Keep at
least two local administrators.

### What to get from hospital IT

1. **The LDAPS address, by name:** `ldaps://<DC name>:636` with the domain controller's DNS
   name exactly as it appears in its certificate — **not an IP address**: the name in the
   certificate is checked, and an IP almost always fails that check (`tls`). The VM must
   resolve the name.
2. **The CA certificate** that signed the domain controller's certificate (PEM; public).
3. **A read-only service account:** its bind DN (e.g.
   `CN=svc-homunculus,OU=Service Accounts,DC=hastane,DC=local`) and password. It must be able
   to read, on user objects, `objectGUID`, `sAMAccountName`, `userPrincipalName`, `mail`,
   `displayName`, `memberOf`, `userAccountControl`, **`pwdLastSet` and `accountExpires`**, and
   `cn` on groups. AD leaves out what an account may not read without any error, and then
   Homunculus silently stops noticing a password changed or an account expired in AD — the
   read-only check below fails loudly on exactly that. Ask for a password that does not
   expire, or note when it does: an expired service password turns every AD sign-in into 503
   (`service_bind_rejected`).
4. **The search base** (`LDAP_BASE_DN`), covering the staff accounts **and** every group that
   will be mapped: the mapping's group picker searches under it, and with
   `LDAP_NESTED_GROUPS=1` (the default) sign-in finds a person's groups by searching under it,
   so a group outside it is never seen. Usually the domain root (`DC=hastane,DC=local`).
5. **The AD group for each role**, e.g. `YB-Hekim` → Hekim, `YB-Hemsire` → Hemşire,
   `YB-Sorumlu-Hemsire` → Sorumlu Hemşire. Nested groups count. **Do any group names contain
   `#` or `=`?** A DN with a bare `#` or `=` cannot be read: such a group cannot be mapped (422)
   and never matches at sign-in.
6. **Port 636 open from the VM to the domain controller.**
7. **The domain's account lockout policy** — "Account lockout threshold" and "Reset account
   lockout counter after". Homunculus counts failed binds per account the way AD does — in a
   run that ends only when 15 minutes pass with none — and makes at most 3 per run, 3 more
   after an administrator's unlock (once per run; see *Sign-in limits*): the threshold must be
   **at least 7**, above 3 + 3, or Homunculus alone could lock a clinician out of every
   hospital system. The clinician's own mistyped Windows logons count toward the same
   threshold. **The reset period must be 15 minutes or less:** Homunculus' run ends after 15
   quiet minutes, and with a longer domain period AD would still be counting the previous
   run when the next one starts — tell the developers if it is longer. Strictly under 15
   minutes is better: it leaves a margin. **With several domain controllers,** ask whether a
   successful logon on one DC resets the bad-password count the PDC emulator keeps for the
   account: Homunculus ends a run at a successful sign-in as if it did — if it does not, tell
   the developers. A restart of the API inside a run is covered under *Sign-in limits*.
8. **Are the sAMAccountNames ASCII?** A name with `ş`, `ç`, `ğ`, `ö`, `ü`, `ı` (or letters of
   another script) breaks the local username rule (`a-z 0-9 . _ @ -`) and is skipped at import
   as `invalid_login`.
9. **Do the ward PCs reach the VM through one shared address** (NAT, a terminal server,
   Citrix)? Then the per-address sign-in limit is shared by the whole ward (see *Sign-in
   limits*).

### Configure

From the VM, first check the network and the certificate:

```bash
getent hosts dc1.hastane.local
openssl s_client -connect dc1.hastane.local:636 -CAfile /opt/homunculus/deploy/local/ldap-ca/ca.pem \
  -verify_hostname dc1.hastane.local </dev/null 2>/dev/null | grep "Verify return code"
```

Expected: an address, then `Verify return code: 0 (ok)`. Then:

```bash
cd /opt/homunculus/deploy/local
mkdir -p ldap-ca && cp /path/to/ca.pem ldap-ca/ca.pem && chmod 644 ldap-ca/ca.pem
$EDITOR .env      # the LDAP_* block from .env.example; LDAP_CA_CERT=/etc/homunculus/ldap-ca/ca.pem
docker compose up -d api
```

The service account's password goes into `.env` only (`chmod 600`); single-quote it if it
contains a `$`, and save `.env` as UTF-8 (a password that is not valid UTF-8 there turns LDAP
off: `LDAP is OFF: LDAP_BIND_PASSWORD is not valid UTF-8 …`). The API binds once with the
service account at start-up. **Check the outcome
with `GET /admin/ldap/status`,** signed in as a local administrator: expected `"configured":
true` and `"last_test_ok": true` (`null` for the first seconds, while the check runs). From the
VM — it asks for the login, the password and the authenticator code, and keeps the password off
the command line:

```bash
read -rp 'Login: ' HU; read -rsp 'Password: ' HP; echo; read -rp 'Code: ' HC
token() { python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'; }
T=$(HU="$HU" HP="$HP" python3 -c 'import json,os; print(json.dumps({"login": os.environ["HU"], "password": os.environ["HP"]}))' \
  | curl -sk https://localhost/auth/login -H 'Content-Type: application/json' -d @- | token)
T=$(curl -sk https://localhost/auth/totp/verify -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$HC\"}" | token)
curl -sk https://localhost/admin/ldap/status -H "Authorization: Bearer $T"; echo
unset HU HP HC T
```

(An administrator whose groups do not require MFA: leave out the second `T=` line.)

`"configured": false` means `LDAP_URL` did not reach the container, or a setting turned LDAP off.
The log says why, second: `docker compose logs api | grep "LDAP"` shows `LDAP: service-account
bind to dc1.hastane.local succeeded` (the API prints its own INFO lines; an image built before
F7 printed only failures, so a missing success line there meant nothing). Otherwise: `FAILED
(tls)` — the certificate or the name in `LDAP_URL`; `FAILED (unreachable)` — DNS or the
firewall; `FAILED (timeout)` — the DC does not answer in time; `FAILED (service_bind_rejected)`
— the bind DN or its password; `LDAP is OFF: …` — a setting the API cannot use (the message
names it, never its value). None of these stops the API, and local sign-in keeps working.
`POST /admin/ldap/test` (same token) binds again once it is fixed.

- **`LDAP_ALLOW_INSECURE=1` is for a lab, never the hospital.** It permits `ldap://`, and when
  no `LDAP_CA_CERT` is given it **switches certificate verification off** for `ldaps://`
  (anyone on the path could read AD passwords). In production — a Postgres `DATABASE_URL`,
  which every hospital deploy has — the API refuses it: LDAP stays **off** (AD accounts get
  503) and every start logs the ERROR `LDAP is OFF: LDAP_ALLOW_INSECURE=1 is refused in
  production …` until the line is removed from `.env`; the API itself still starts. Outside
  production (a lab, a developer machine) it is allowed, with a WARNING at every start.
- **A `tls` failure seen only on a developer machine** may be Python, not the certificate:
  Python 3.13 and newer verify strictly and refuse a CA certificate whose `basicConstraints`
  is not marked critical. The API image runs Python 3.12, which accepts it.
  `openssl x509 -in ldap-ca/ca.pem -noout -text | grep -A1 "Basic Constraints"` shows whether
  it is `critical`.
- **Clocks:** `pwdLastSet` (written on the DC's clock) is compared with the token's issue time
  (the VM's clock), and `accountExpires` with the VM's clock. Keep both synchronised (see
  *Clock* below): a VM running ahead of the DC can miss a password changed just after a
  sign-in; one running behind can end a fresh session at its first refresh.

### Check against the real directory (read-only)

`tests/test_ldap_integration.py` makes five read-only checks with the API's own settings: the
service account binds; a search finds people and the first reads back by objectGUID; one
deliberately failed bind — as the **service account** with a wrong password, never as a
clinician (a failed bind counts toward that account's lockout; one per run, so do not run it in
a loop); `pwdLastSet` and `accountExpires` come back (item 3 above); and a member's group has
the same canonical spelling in `memberOf` as in the group picker (else a mapping made in the
panel never matches at sign-in). It writes nothing. It runs in a throwaway container built from
the API image; the container installs pytest from PyPI, so the VM needs internet access (or a
pip mirror, `PIP_INDEX_URL`) for that moment:

```bash
cd /opt/homunculus/deploy/local
docker compose run --rm --no-deps --user root --entrypoint sh \
  -v /opt/homunculus/homunculus-engine/tests:/app/tests:ro api -c '
    pip install -q -c constraints.txt pytest pytest-asyncio httpx &&
    LDAP_TEST_URL="$LDAP_URL" LDAP_TEST_BIND_DN="$LDAP_BIND_DN" \
    LDAP_TEST_BIND_PASSWORD="$LDAP_BIND_PASSWORD" LDAP_TEST_BASE_DN="$LDAP_BASE_DN" \
    LDAP_TEST_CA_CERT="$LDAP_CA_CERT" LDAP_TEST_USER_FILTER="$LDAP_USER_FILTER" \
    LDAP_TEST_NESTED_GROUPS="$LDAP_NESTED_GROUPS" LDAP_TEST_TIMEOUT_S="$LDAP_TIMEOUT_S" \
    LDAP_TEST_ALLOW_INSECURE="$LDAP_ALLOW_INSECURE" \
    python -m pytest -q -p no:cacheprovider -rs tests/test_ldap_integration.py'
```

The `$LDAP_*` values expand inside the container (the single quotes keep them off the VM's
command line and shell history). Expected: `5 passed` (ldap3's deprecation warnings are
harmless). A search for `a` that finds nobody fails; `1 skipped` on the last check means none
of the people found has a group under `LDAP_BASE_DN` — in both cases add `LDAP_TEST_QUERY=<part
of the name of someone in a group that will be mapped>` inside the quotes. A warning naming
`memberOf` values Homunculus cannot read lists groups with a bare `#` or `=` (item 5): do not
plan to map them. Every failure says what to ask IT for.

### How it behaves

- **Accounts come from an import.** An administrator searches AD (at most 50 rows) and imports
  the people who need Homunculus (at most 50 per request); an AD account that was not imported
  cannot sign in. An import is idempotent and reports what it skipped: `exists` (already has an
  account), `not_found`, `disabled`, `expired` (accountExpires passed), `invalid_login` (item
  8), `login_taken` (the name is already someone's username or e-mail), `no_username`. The AD
  groups' mapped groups and any extra groups must each be within the importer's own rights
  (403 otherwise). Until the AD panel ships (G1-14) the routes are `/admin/ldap/*`
  (`homunculus-engine/src/homunculus/admin/ldap_router.py`); searching, importing and reading
  the mapping need `users.manage`, **changing the mapping needs a full administrator** (every
  permission): a mapping regroups everyone in its AD group.
- **Sign-in forms:** the AD user name (`ayilmaz`), `DOMAIN\ayilmaz`, the UPN
  (`ayilmaz@hastane.local`) or the mail — as `LDAP_LOGIN_ATTRS` allows. The AD password goes to
  one bind exactly as typed — its UTF-8 bytes, nothing normalised: AD compares the password as
  it was set, so a no-break space or a combining accent in it must arrive unchanged — and is
  never stored, logged or audited.
- **AD down:** AD accounts get "Dizin sunucusuna ulaşılamıyor" (503) at sign-in; open sessions
  continue — a token refresh while the DC is unreachable, too slow, refuses TLS or the service
  account goes on without asking it (audited `refresh.directory_unavailable`); local accounts
  are unaffected. Any other directory error at refresh (a reply about the account that cannot
  be read) is a 503 (`refresh.directory_error`): nothing is renewed, and the refresh token is
  kept for the next try.
- **Disabled, expired, deleted or moved out of `LDAP_BASE_DN` in AD:** refused at the next
  sign-in. The open session of such an account — or of one whose password was changed or reset
  in AD — ends at its next token refresh (within the hour). Homunculus's own "active" flag is
  not changed; deactivate the account in Homunculus to stop it whatever AD says. (A locked-out
  or password-expired AD account fails its bind at sign-in; an open session is not ended for
  it: reading AD's lockout state at refresh would let anyone end a clinician's session by
  typing her name with wrong passwords.)
- **AD group changes** apply at the user's next sign-in or token refresh, whichever comes first
  (within the hour); groups an administrator gave by hand are never touched. While the
  directory is down, nothing changes. A new mapping applies from each member's next sign-in or
  refresh; deleting a mapping takes its rights away at once (someone who still holds the group
  through another mapping gets it back at their next sign-in or refresh).
- **A mapping is keyed by the group's DN,** stored and compared in one canonical spelling
  (spacing, escapes and ASCII letter case do not matter; other letters, `Ş`/`ş`, compare as
  written — pick groups from the picker rather than typing the DN). A group renamed or moved
  in AD loses its mapping silently. An account renamed in AD keeps its old Homunculus user
  name, and neither name signs in any more — only its e-mail address does (both are open
  items, Grup 4).
- **Time bounds:** one directory call takes at most `min(2 × LDAP_TIMEOUT_S, 12)` s (10 s at
  the default 5) at sign-in or refresh. Administration shares 3 of the directory's 8 threads,
  so sign-ins always keep 5; an administration call may first wait as long again for its place,
  so it answers within twice that (20 s at the default, more than the dashboard's 15 s — the
  server still finishes; an import is safe to repeat). An import looks up 2 accounts at a time,
  so a search, the group picker or the connection test beside **one** import finds a place at
  once; two imports at the same moment can hold all 3 places, and a search then waits at most
  its deadline and answers 503. An import's total time is not bounded by twice the deadline:
  n accounts can take up to about ⌈n/2⌉ × twice the deadline against a slow DC (the panel will
  import in smaller parts, G1-14). No database connection is held while the directory answers.

### Sign-in limits

- **Per account (AD accounts):** failed binds are counted in a run that ends only when 15
  minutes pass with no failed bind — the way AD counts them, not a sliding window. After 3 in
  the run the sign-in is refused with 429 "Çok fazla hatalı deneme; 15 dakika sonra tekrar
  deneyin" without asking AD, until 15 minutes after the last failed bind; a refused attempt
  reaches no DC and does not extend the run. Only an attempt whose password reached the DC
  counts (a DC outage before the bind does not). A bind whose password had been sent but that
  the DC did not answer — the API's deadline cut it off, the LDAP receive timeout
  (`LDAP_TIMEOUT_S`, which usually comes first) gave up on it, the connection dropped — is
  counted as of one deadline later (`min(2 × LDAP_TIMEOUT_S, 12)` s): the DC may still count it
  until then, so its run lasts 15 minutes from that. A DC that processes a request more than
  one deadline after it was sent is outside this guarantee — a DC that slow is an outage to
  fix first. A right password ends
  the run, as AD resets its count at a successful logon — but only for the failures recorded
  before that sign-in began: wrong passwords that failed while it was being checked may have
  reached the DC after it, so they stay counted and start the next run (with that run's unlock
  already spent if the old run had spent it). The count is in the API's memory: a restart
  clears it (see *A slow run is bounded too*).
- **Unlock:** `POST /admin/users/{id}/unlock-sign-in` with `{"reason": "…"}` lets 3 more failed
  binds through in the current run, **once per run**: a second unlock in the same run is 409
  "Bu hesabın bu hatalı giriş dizisi için tek kilit açma hakkı kullanıldı; 15 dakika hatalı
  parola girilmezse giriş kendiliğinden açılır" (the run, and the throttle with it, ends once
  15 minutes pass without a failed bind). An unlock of an account with no failed bind in its
  current run — or a local account — grants nothing and does not use the run's unlock. The
  reason is one line of at most 200 characters with at least one letter or digit, no control
  character and no invisible formatting character (bidirectional overrides, zero-width
  characters); it is audited as `user.sign_in_unlocked`, with `before` and `after` as
  `{"failed": <failed binds in the run>, "allowed": 3 or 6}` and `granted` (`false` for an
  unlock that had nothing to clear). It needs `users.manage` and
  the account within the caller's rights (a refused unlock uses nothing); not for an account
  active in another hospital or a platform operator's (409). It does not unlock anything in AD
  — an AD lockout is IT's to clear.
- **A slow run is bounded too.** Failures do not age out one by one: one wrong password every
  5 minutes keeps the run alive, and after the third it is refused, exactly as AD keeps
  counting. So Homunculus adds at most 3 + 3 = 6 to the domain's count between two of its
  resets, as long as the domain's reset period is 15 minutes or less (item 7) **and the API is
  not restarted inside a run.** A restart or a deploy within 15 minutes of failed AD binds
  clears Homunculus' runs but not AD's count, so up to 6 more can follow — 12 in one of AD's
  runs, past a threshold of 7. Before restarting the API, look for failed sign-ins in the last
  15 minutes and wait until there are none:

  ```bash
  docker compose exec postgres psql -U homunculus -d homunculus -c "SELECT payload->>'login'
    AS login, count(*) FROM audit WHERE event_type = 'auth' AND subject = 'login.fail' AND
    payload->>'reason' IN ('bad_credentials', 'directory_unavailable', 'cancelled',
    'directory_error') AND ts::timestamptz > now() - interval '15 minutes' GROUP BY 1;"
  ```

  Wrong passwords typed elsewhere for the same account (a ward PC) count in AD too, which is
  why the threshold needs room above 6. The audit trail shows a run: `login.fail` rows for one
  account with `reason` `bad_credentials`, then `throttled`. Every failed bind the run counts
  has its row, written the moment it is counted: a sign-in cut off once its password had
  reached the DC (the request cancelled — the API stopping mid-request, for one) is a
  `cancelled` row, a fault at that point a `directory_error` row — both counted, so the query
  above includes them.
- **What the limits give away** (roadmap, user decision 11). *AD accounts can be told apart:*
  when the directory is down, or `LDAP_URL` is unset while AD accounts exist, an AD login gets
  an immediate 503 "Dizin sunucusuna ulaşılamıyor" — no dummy bcrypt, no 0.5 s floor — while
  an unknown or local login gets 401; and only an AD account ever gets the 429 above. *A
  clinician's Homunculus sign-in can be held at 429:* anyone who knows her login can keep it
  there with 3 wrong passwords every 15 minutes (her Windows logon is not locked by it, with
  the threshold at least 7); an administrator can lift it once per run. The audit trail shows
  both. Accepted for the pilot; the roadmap tracks it.
- **Per address (nginx):** `/auth/login` takes 10 attempts a minute per client address, with a
  burst of 10; beyond that nginx answers 429 `{"detail":"Çok fazla giriş denemesi; bir dakika
  sonra tekrar deneyin"}` with `Retry-After: 60` and logs a warning. If the ward PCs share one
  address (item 9), the whole ward shares those 10 a minute: clinicians can get 429 at shift
  change, and anyone behind that address can keep the ward at 429. Docker may also hand nginx
  its bridge gateway instead of the PCs' addresses: `docker compose logs web | tail` must show
  the ward PCs' IPs, not a `172.x.0.1`. The rate and burst are in `deploy/local/web/nginx.conf`.
- **Response-time floor:** every refused sign-in (401) answers no sooner than 0.5 s after it
  arrived, and an AD refusal also pays the same dummy bcrypt an unknown login does, so timing
  does not tell which logins are AD accounts. If this site's AD failure path (service bind,
  search, nested-group search, user bind) takes longer than 0.5 s, AD refusals become slower
  than the rest again. Measure with a test AD account IT provides, imported into Homunculus —
  never a clinician's (every try counts toward the lockout, and after three in a run the next
  is a 429, which is not held):

  ```bash
  curl -sk -o /dev/null -w '%{time_total}\n' -X POST https://<vm>/auth/login \
    -H 'Content-Type: application/json' -d '{"login":"<test account>","password":"<wrong>"}'
  ```

  then the same with a login that does not exist. If the first is clearly slower, raise
  `LOGIN_FAILURE_FLOOR_S` in `homunculus-engine/src/homunculus/auth/router.py` (a code change;
  keep it far below the dashboard's 15 s).

## Backups — your responsibility now

No managed provider is doing this any more. The audit trail is a legal record, and an unbacked-up
pilot database is one disk failure away from losing it.

```bash
docker compose exec -T postgres pg_dump -U homunculus homunculus \
  | gzip > "/var/backups/homunculus-$(date +%F-%H%M).sql.gz"
```

Restore:

```bash
gunzip -c /var/backups/homunculus-YYYY-MM-DD-HHMM.sql.gz \
  | docker compose exec -T postgres psql -U homunculus -d homunculus
```

Put the dump on a schedule (cron or a systemd timer), keep it on encrypted storage, and **test a
restore at least once** — an untested backup is a belief, not a backup.

## Updating

```bash
git pull
docker compose build          # rebuilds api and web
docker compose pull bridge    # the bridge image comes from GHCR
docker compose up -d
```

The API image is built on Python 3.12 with the exact package versions in
`homunculus-engine/constraints.txt` — a freeze of a clean Python 3.12 install, the set the test
suite ran against — so `docker compose build` installs the same dependencies every time, and a
dependency changes only when that file does. (Before it, a rebuild took whatever was newest:
SQLAlchemy 2.1 arrived without `greenlet` and the API could not start.)

This release adds `NCE_SHARE_PATH` to `.env` — without it, `docker compose up` fails on an invalid
volume spec for the `nce` service and takes the unrelated services down with it. Add it (see
`.env.example`) before pulling.

Data survives: it lives in the `pgdata` volume, not in the containers.

## PHI

- The `pgdata` volume holds patient data. Encrypted storage, and it is removed only deliberately.
- The `bridge-data` volume holds observations in transit; delete it after the pilot.
- The `nce-data` volume holds the same thing for the file route — the SQLite buffer and the
  processed-file ledger; delete it after the pilot too.
- The bridge logs counts, connection events and OBX identifiers — never measurements or patient
  identifiers.
- Nothing in this directory may be committed with real values: `.env` and `site-mapping.json` are
  gitignored.

## What the dashboard shows in Phase 1

The board still draws its patients and alerts from the simulation, and carries a banner saying so.
Real device data is verified through `/patients`, `/alerts/{patient_id}` and the audit table.
Phase 2 wires the board to live data and removes the banner.

## Clock

```bash
timedatectl                  # expect "System clock synchronized: yes"
```

The engine evaluates against the observation timestamp and escalates against the wall clock. A
monitor with a wrong clock makes stale readings look fresh and shifts every scoring window.

## NCE → bridge direct HL7 output (the production target) — Windows-side runbook

NCE is a Welch Allyn/Hillrom "gateway software": WACP in from the devices, HL7 out through
configurable XSL transform sheets to up to four **Host Index** endpoints — 1 Vitals Send,
2 Patient Query, 3 Clinician Query, 4 Patient List Query — each with a Host Address and Host Port
(Connex CSK HL7 Interface Design Specification, doc 60059617 ver C, §7–8; NCE is the CSK/DataCatcher
successor with the same model). Our MLLP bridge (`LISTEN_ADDR:2575`) is a valid Host: it ACKs every
message. Point Host Index 1 at it and vitals arrive the moment NCE receives them, no share polling.

**What the ward found (2026-09-04):** the device sends the patient id it was given
(`Container.Identifier` in the WACP session), but NCE's ORU rendering emits `PID-3 = ^^^X^PI`
because the id was never *validated* — the device's `QBP^Q22` patient query (Host Index 2) had no
host to answer it. So the same change fixes both problems: the patient-query host → our bridge, and
the bridge answers `RSP^K22` echoing the queried id (`edge/pdq.py`, wired into `EdgeBridge.serve`;
counted as `sorgu=` in the report line). No demographics are invented: the id the clinician typed
is the id the reading carries, which is the same trust model as any manual identifier here.

**What the inspection showed at this site (NCEConfig.xml, 2026-09-04):** `HostInformation` is an
array of eight `CHostInformation` entries matching `TransformSheets\Host0..7`: **Host0 = episodic
vitals → 10.10.201.33:7776**, **Host1 = patient query → 10.10.201.33:7775**, Host2 clinician query
(port 0), Host3 location query (file directory), Host4 timesync (file), Host5 alarms (0), Host6
continuous (0), Host7 device.sessions (file). `10.10.201.33` (`aag3lis`, the 2020 HIS/LIS
integration) still pings but **both ports are closed** — NCE has been sending into the void, which
is why every copy in SavedCopies is a "failed" copy. Redirecting Host0 and Host1 breaks nothing
that is alive. NCE also serves its configuration UI over HTTP on **port 8000** (`CSHTTPDConfig`,
`DCMain.htm`) — `http://10.10.218.5:8000/` from the server itself. Devices reach NCE on TCP 281 /
UDP 291; the sheets `nce.hl7.segment.pid.xsl`, `patient.query.xsl`, `message.observation.xsl`,
`hl7.config.xsl`, `segment.pv1.xsl` were customised in March 2020 (`*_default.xsl` are the originals).

**1. Inspect first (read-only, PHI-safe — names and settings, no readings):**

```powershell
$nce = "C:\Program Files (x86)\Welch Allyn\NCE"
# a) host / transport settings in NCEConfig.xml (passwords excluded)
[xml]$cfg = Get-Content "$nce\NCEConfig.xml"
foreach ($d in $cfg.SelectNodes("//DEFINITION")) {
  $cls = $d.GetAttribute("class")
  foreach ($m in $d.SelectNodes("MEMBERS/MEMBER")) {
    $n = $m.GetAttribute("name"); $v = $m.SelectSingleNode("VALUE")
    if ($n -match "Host|Port|Address|Index|Enabled|Protocol|Timeout|Retry|Ack|Patient|Query|Validat|Transform|Sheet|Listen|Facility|Application|Assign|Authority|Send|Unknown|Interface|Network" -and $n -notmatch "Password|Secret") {
      if ($v -and $v.InnerText.Trim()) { "{0,-28} {1,-30} = {2}" -f $cls, $n, $v.InnerText.Trim() }
    }
  }
}
# b) transform sheets: which files exist, and how the ORU sheet builds PID
Get-ChildItem "$nce\TransformSheets" -Recurse -File | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
Get-ChildItem "$nce\TransformSheets" -Recurse -Include *.xsl,*.xslt | Select-String -Pattern "PID" -Context 2,8 | Select-Object -First 60
# c) NCE's live sockets: what it listens on and which host it is (trying to) talk to
$id = (Get-CimInstance Win32_Service -Filter "Name='Welch Allyn NCE'").ProcessId
Get-NetTCPConnection -OwningProcess $id | Select-Object State, LocalAddress, LocalPort, RemoteAddress, RemotePort | Format-Table -AutoSize
# d) can this box reach our bridge?
Test-NetConnection 172.100.101.72 -Port 2575
# e) host-connection errors in the newest debug log (addresses/status lines only)
Get-ChildItem "$nce\NCEDebugLog-*.txt" | Sort-Object LastWriteTime | Select-Object -Last 1 |
  ForEach-Object { Select-String -Path $_.FullName -Pattern "Host|host|connect|Connect|refused|timeout|Timeout|NAK|Index" | Select-Object -Last 40 | ForEach-Object Line }
```

**2. Change:** in the NCE configuration UI (`http://10.10.218.5:8000/` on the server, or the
`NCETray.exe` icon), set **Host0 (episodic / vitals)** and **Host1 (patient query)** both to Host
Address `172.100.101.72`, Host Port `2575`; leave the rest as they are. Save, then
`Restart-Service "Welch Allyn NCE"` in a quiet moment — the Connex Spot stores readings while NCE is
down and resends them. If the UI will not take the change, stop the service, edit the two
`CHostInformation` entries' `HostURL`/`HostPort` in `NCEConfig.xml` (back it up first), start the
service; never edit the file while the service runs.

**3. Verify on the Linux host:** `docker logs -f homunculus-bridge` shows `sorgu=` climbing when a
clinician enters an id on the device and `mesaj=`/`gözlem=` climbing when the reading is saved;
`nce-doctor.sh` shows the PID-3 shape of the copy NCE still writes to SavedCopies, which should now
carry the id in CX.1. The file bridge keeps running in parallel and de-duplicates nothing — once the
direct path is confirmed, stop the `nce` service or the same reading will be ingested twice.

**Do not** touch the transform sheets: the id path works through the query, and the sheets are the
vendor's customised 2020 set for this site.

**Root cause of the missing id, found in the sheets (2026-09-04, after the direct path was live):**
`TransformSheets\nce.hl7.segment.pid.xsl` (customised 18.03.2020) renders PID-3.1 as
`substring-before($patient-id, '_')` — the 2020 HIS integration had clinicians enter
`<patientId>_<visitNumber>` on the device, and the sheet splits it (the visit part goes to PV1-19).
An id with no underscore yields an EMPTY PID-3.1, which is why every reading at this site — validated
or not — arrived as `^^^X^PI`. The fix is a one-line fallback in that sheet (keep the split when an
underscore is present, otherwise pass the id through), applied on the NCE server with a backup and a
service restart; see the PowerShell in the ward notes. The bridge's PDQ reply is still required
(the device otherwise reports the patient as not found), and it is now field-complete
(`PID|||id|||||`) because the query sheets slice fields with `substring-before(…,'|')`.

**Direct path live (2026-09-04 16:00):** after the pid-sheet fallback, readings arrive on 2575 with
the id in PID-3.1 and the board grows a card per id. Two things bit on the way and are now set:
`site-mapping.json` for this source must key on the **numeric** MDC code (`150456`, `149546`,
`150021`, `150023`, `150344`), because NCE's OBX-3 first component is the number, not
`MDC_…`; and the mapping loader treats *every* key as an OBX code — a `_comment` key crashes the
bridge into a restart loop. The `nce` file service is **stopped** (`docker compose stop nce`) so the
same reading is not ingested twice; `docker compose start nce` is the fallback if the direct path
ever fails (SavedCopies keeps 14 days). Name and room typed on the device do not reach the HL7
copy: once the host answers a patient query, the device adopts the host's demographics, and our
reply carries none by design — the HL7 shows `PID-5 = ^^^^^^L`, `PV1-3 = WA^^`. Names on the
board are a product/PHI decision, not a transport gap; bed/room needs a location source (ADT or
the device's location workflow) — see `docs/hastane-hl7-omurgasi-analizi.md`.

## Comed ADT: patient names and beds

The identity integration now supplies the missing demographics described above. Comed's
ADT output (A01/A04/A02/A08/A13/A03/A11) uses the existing MLLP listener at
`LISTEN_ADDR:2575`. PID-3 must contain the protocol number the clinician enters on the device.
The bridge mirrors the identity locally, answers subsequent patient queries with the known
name, and queues FHIR Patient and Encounter resources alongside observations. `/ingest`
accepts all three resource types, so an ADT does not block later readings.

- `PHI_ENCRYPTION_KEY` is REQUIRED for the API and the bridge: compose refuses to start
  without it, the API refuses to boot on a malformed one, the bridge starts without its mirror
  (readings unaffected, device query answered with the id only). Generate a Fernet key with the
  command in `.env.example` **before the first real admission** and keep it with the backups:
  rows written under one key cannot be read under another — names go blank on the board, the
  card and its readings stay. Rotation is not supported in this slice.
- An identity record never holds a reading. One the API refuses as a payload (400/422) is
  dropped and counted (`kimlik_düşen=` in the report); the next ADT or device query resends it.
  One the API cannot take right now (5xx while its database restarts, 401/403 while a token is
  fixed) is held for the next pass (`kimlik_bekleyen=`) while the readings behind it flow; at
  most 50 are held, beyond that the oldest go. An unreachable API holds everything, in order.
- Deploy note: the offset fix moves NCE observation stamps four hours earlier the moment the
  new bridge starts, so for up to four hours "latest" on a card can still be an old
  future-stamped reading. Deploy at a quiet moment or accept the transient.
- A transfer or update (A02/A08) never changes the admission state — an A08 after discharge is
  a billing edit, not a readmission. An empty field never clears a known one (a thin transfer
  keeps the name); a location is one group, so `WARD2^^` does clear the old room and bed.
  Discharge frees the bed and keeps the name for the 24 h the card stays.
- HL7 timestamps with an offset (`20260904143000+0400`) are read as that offset, not as UTC —
  this also corrects NCE observation times, which were stored four hours ahead.
- API production identities use the existing PostgreSQL database and migration `0005`.
  Deploy the API migration and receiving code **before** enabling the Comed feed. The local
  Docker API runs `alembic upgrade head` on startup. Rebuild the API/web and deploy a bridge
  image containing this branch; the configured `:latest` bridge image must actually be updated.
- Local development uses `homunculus-identity.db` (override with `IDENTITY_DB_PATH` in
  `prodserver`). The bridge mirror remains beside its buffer in the `bridge-data` volume.
  Names, birth dates and sex are encrypted in both stores. The transit outbox still requires
  encrypted storage, just as it does for observations.
- Identity records are tenant scoped. Older messages cannot overwrite newer records.
  Discharged identities remain for 24 hours, then are pruned. Live cards lose the identity;
  cards with no observations are removed, while existing measurements remain available.
- Web and mobile cards show the HIS name, bed, source and discharge state. A missing identity
  remains visibly unknown. Identity-only admissions appear before their first measurement.
- Audit events record resource type, source and state, never names or birth dates.
  `nce-doctor.sh` reports aggregate identity counts and the latest update timestamp.

Until Comed is connected, `homunculus-engine/scripts/set_identity.py` sends the same resources
with source `manuel`. For synthetic local testing:

```powershell
python scripts/set_identity.py --patient-id TEST-ADT-1 --family DEMO --given PATIENT --bed "TEST^1^1" --cloud-url http://127.0.0.1:8000 --token dev-token
```

The manual script updates the API only; the bedside query mirror is populated by ADT on the
MLLP port. Manual arguments can be recorded in shell history, so use synthetic data for this
example. Confirm the protocol number, message timestamps/timezone and supported triggers with
Comed IT before connecting the live feed. Hardware acceptance still requires an actual admission,
device query and subsequent observation at the hospital.
