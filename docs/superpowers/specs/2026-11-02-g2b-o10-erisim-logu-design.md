# G2-B1d follow-up O10 — the access logs and the patient key

**Date:** 2026-11-02 · **Lane:** B (B1d follow-up; run by session homunculus-ai-0a) · **Branch:**
`feat/g2b-o10-erisim-logu`, cut from main `c72cbe5` · **Closes:** B1d spec
(`2026-11-01-g2b-b1d-protokol-barkod-design.md`) §12 open item **O10**, except the residual items of §6.

## 1. The problem

The patient screen's routes carry the board key in the path: `/patients/<key>/trends`,
`/scores/sofa/<key>`, `/alerts/<key>`, `/clinical/<key>` (the protocol number since B1d, the H-number
before). Two access logs wrote that path:

- **uvicorn's** (`docker compose logs api`): the request line, query string included.
- **nginx's** (`docker compose logs web`): the stock format writes `$request` (the line, query string
  included) and `$http_referer` (the dashboard page's address, which can hold a key).

The bridge's device route, `POST /edge/patient-query`, carries the number in the body and was never in
either log. Lane A (2026-11-02): "real but not a blocker — own small slice (uvicorn `--no-access-log` +
nginx log format without id segments), owner's timing."

One more thing the old logs held: `/stream` and `/notifications` accept a tenant token in the query
(`?token=`, the wall board's) and a one-time ticket (`?ticket=`). Both were in the query string of the
logged line.

## 2. Decisions

- **D1 — uvicorn: the access log is off** (`--no-access-log`). Nothing is lost that the ward reads: the
  API publishes no host port (pinned by `test_the_api_publishes_no_host_port`), every browser request
  passes nginx, which keeps its own log, and the bridge's calls carry no key in the path. The engine's own
  `homunculus.*` lines are a different logger and stay (`tests/test_prodserver_logging.py`).
- **D2 — nginx: its own log format, written through a redacting map.** The query string and the referer
  are not logged at all; the path is written after every route parameter has been replaced by a
  placeholder.
- **D3 — the error log is left as it is.** See §6, R1.

## 3. Design

### 3.1 uvicorn

`--no-access-log` after `--port` in `homunculus-engine/Dockerfile.api` (the `exec` and the absence of
`--workers` stay, and the comment above the command says why the flag is there), in `render.yaml`'s
`startCommand`, and in the Run line of `api/prodserver.py`'s docstring. These are the only launch commands
of the production app (`test_every_launch_of_the_production_app_is_covered` scans for a third).

### 3.2 nginx (`deploy/local/web/nginx.conf`)

Three additions; `map` and `log_format` sit at the file's top level (it is installed as
`conf.d/default.conf`, inside `http {}`), like the `limit_req_zone` lines above them.

1. **`map $uri $homunculus_log_uri`.** nginx's order: an exact string first, then the regular
   expressions in file order (the first match wins), then `default $uri`.
   - *Passthrough* (a static route that a catch-all would otherwise take): `/scope/me`, `/scope/unassigned`.
   - *`:key`, a patient's key:* `/patients/:key/trends`, `/alerts/:key`, `/clinical/:key`,
     `/clinical/:key/profile`, `/scores/sofa/:key`, `/scores/sofa/:key/preview`.
   - *`:id`, any other record:* `/admin/{groups,users}/:id`, `/admin/users/:id/{groups,reset-mfa,reset-password,unlock-sign-in}`,
     `/admin/ldap/group-mappings/:id`, `/admissions/:id` and its nine sub-routes, `/alerts/:id/{acknowledge,escalate,snooze}`,
     `/break-glass/:id/{close,extend}`, `/handovers/:id/{countersign,sign-outgoing}`, `/scope/:id`,
     `/tenant/{beds,rooms,units}/:id`, `/tenant/beds/:id/{release,transition}`, `/tenant/rooms/:id/beds`,
     `/tenant/sites/:id/units`, `/tenant/tenants/:id/sites`, `/tenant/units/:id/rooms`.
   - *Catch-all, last:* anything else below a prefix that carries a key or an id (`/patients/`, `/clinical/`,
     `/scores/sofa/`, `/alerts/`, `/admissions/`, `/handovers/`, `/break-glass/`, `/scope/`, `/admin/users/`,
     `/admin/groups/`, `/admin/ldap/group-mappings/`, `/tenant/{beds,rooms,sites,tenants,units}/`) becomes
     `<prefix>:redacted`. nginx logs a request whatever the API answers: `GET /patients/<key>` is a 404
     at the API and a log line at nginx. The catch-all also takes a key with an encoded slash (`%2F`,
     which nginx decodes into `$uri`), a trailing slash and a path typed wrongly.
2. **`log_format homunculus_redacted`:** `$remote_addr [$time_local] "$request_method
   $homunculus_log_uri $server_protocol" $status $body_bytes_sent $request_time "$http_user_agent"`.
   The client address stays first, as `docs/EDGE-BRIDGE-LOCAL.md` and the hub allow-list step (Aşama A, D-3)
   read it.
3. **`access_log /var/log/nginx/access.log homunculus_redacted;`** in `server {}` (nginx:alpine links
   that path to stdout). No `location` declares its own `access_log`, which would replace the server's;
   the test allows exactly one in the file.

`$uri` is what the log writes after the request has been served, so a path that falls through to the
single-page app (`try_files … /index.html`) is logged as `/index.html`, key or not.

### 3.3 The dashboard's key routes

The task named client-side routes as a second source of keys in nginx's log (a page reload of
`/patients/<key>`). They are not: the dashboard routes by the URL **fragment** (`#/patients/<key>`;
`live/shell/routes.js`, `hashPath`), and a browser sends no fragment to a server, nor in a Referer. A
reload reaches nginx as `/`. `test_the_dashboards_key_routes_never_reach_the_log` pins it three ways:
the `:param` routes of `routes.js` are exactly `/patients/:id`; no dashboard source calls `pushState` (the
call that would turn a client route into a request path); and were `/patients/<key>` ever sent as a path,
the map redacts it.

### 3.4 Who read the old lines

- `deploy/local/nce-doctor.sh` step 5 grepped `homunculus-api` for `POST /ingest` and for the status codes 401 and 400.
  With the access log off that step would have printed "no /ingest in 30 minutes" for a healthy
  system. It now reads the bridge's uplink warnings (`uplink refused an observation (HTTP <n>)`,
  `uplink unavailable`), which carry the same answer, and the api log for `ERROR|Traceback` only.
- `docs/EDGE-BRIDGE-LOCAL.md` gets a short *Access logs* section (what each log records; the error-log
  gap). `docker compose logs api` in its start-up checks reads engine lines, which stay.
- The VM block files (`/c/tmp/infinity-a-releases/*.txt`) read engine lines of the api log only (the
  stage, the bed table, "gölge motor"), never request lines; none reads the web log. Two entries need
  Lane A's eye when the O10 deploy is written (§6, R4). They were not edited.

## 4. Testing

`tests/test_access_log_redaction.py` (12 tests, no database). The map is read from the real file and
applied as nginx applies it.

- **Drift guard:** every path of the route table with a `{param}` (a `{x:path}` one included) is filled
  with a synthetic key, run through the map and must come out as its placeholder form with the key gone.
  A route added later with a path parameter fails here until the map covers it.
- Static routes come out unchanged; an unrecognised tail below a key's prefix is redacted whole; the
  reader itself is tested (first match wins, named captures, `$uri`, an unmatched capture is empty).
- The log format may write only an allow-list of variables, and never `$request`, `$request_uri`,
  `$args`, `$query_string`, `$http_referer`, `$uri` or a cookie; the server's `access_log` is the one in
  the file and sits at the server level.
- `Dockerfile.api` and `render.yaml` carry `--no-access-log`; uvicorn accepts it, prints no request line
  with `access_log=False` (and does print it with `True`: the check can fail) while an engine line still
  reaches the log.

Red first: before the change 10 of the 12 failed on the missing map, format, `access_log` and flag.

**Gates (at the config commit `4381fc6`):**
- the new file 12 passed; with the nginx, prodserver-logging, image, build-context and route-walk files
  79 passed / 6 skipped (database);
- the whole engine suite without the database: 3164 passed / 1110 skipped / 0 failed. Main `c72cbe5` gives
  3153 / 1109; this is 3153 + 12 new − 1, the one test that skipped here being
  `test_infinity_transport.py:149` ("Node and dashboard jsdom required": this worktree has no
  `dashboard/node_modules`), an environment difference and no regression;
- the 3.14 check of the touched files: 64 passed;
- the dashboard is untouched, so no dashboard gate (two of its tests read `nginx.conf`: the patterns they
  read — `location ~ ^/(…)` and `location @…_limited { … return 429 '…'; }` — are unchanged).

**Real nginx** (`nginx:alpine`, the file mounted as `conf.d/default.conf`, `--add-host api:127.0.0.1`, a
throwaway certificate, a synthetic key `202600000001`): `nginx -t` passed ("syntax is ok … test is
successful"). Requests with a query string and a referer holding the key gave, for example:

```text
172.17.0.1 [02/Nov/2026:11:42:23 +0000] "GET /patients/:key/trends HTTP/1.1" 502 157 0.002 "o10-check/1.0"
172.17.0.1 [02/Nov/2026:11:42:23 +0000] "POST /scores/sofa/:key/preview HTTP/1.1" 502 157 0.001 "o10-check/1.0"
172.17.0.1 [02/Nov/2026:11:42:23 +0000] "POST /admissions/:id/care-team/claim HTTP/1.1" 502 157 0.000 "o10-check/1.0"
172.17.0.1 [02/Nov/2026:11:42:23 +0000] "GET /patients/:redacted HTTP/1.1" 502 157 0.000 "o10-check/1.0"
172.17.0.1 [02/Nov/2026:11:42:24 +0000] "GET /stream HTTP/1.1" 502 157 0.000 "o10-check/1.0"
172.17.0.1 [02/Nov/2026:11:42:24 +0000] "GET /index.html HTTP/1.1" 200 896 0.000 "o10-check/1.0"
```

(The last two were `/stream?ticket=…` and `/202600000001`.) The key, the query string and the referer
appeared in none of the 44 access lines. The 429 from the sign-in limiter, answered by a named location,
is logged as `"POST /auth/login HTTP/1.1" 429`.

## 5. Docs

- This record; `docs/EDGE-BRIDGE-LOCAL.md` (*Access logs*); `deploy/local/nce-doctor.sh` step 5.
- Left to the integration (controller-owned): the B1d spec §12 O10 (decided and done), the roadmap's
  G2-B1d row (W-2 → O10 closed except R1/R2), the Turkish guide (one sentence in §3.10 beside "hiçbir numara
  loglanmaz").
- **No PHI:** the key in every example is a synthetic number.

## 6. Residual items

- **R1 — nginx's `error_log` still carries the request (owner and Lane A).** When the upstream is
  unreachable (the API down or restarting: 502) nginx writes one error line per failed request, to the same
  container stream, with the request line, the upstream URL and the referrer as they were sent. An
  `error_log` line cannot be formatted. Reproduced in the check above:

  ```text
  2026/11/02 11:42:23 [error] 23#23: *1 connect() failed (111: Connection refused) while connecting to
  upstream, client: 172.17.0.1, server: _, request: "GET /patients/202600000001/trends?x=1 HTTP/1.1",
  upstream: "http://127.0.0.1:8000/patients/202600000001/trends?x=1", host: "127.0.0.1:58080",
  referrer: "http://localhost:58080/?live=1&tab=202600000001"
  ```

  (On the VM the upstream shows the API container's address.) The line also holds the query string, so a
  `/stream?token=` request in such a window puts the tenant token there. The level is left unchanged: raising
  it would hide real faults (a failed upstream, a rate-limit warning). The options, none built: treat
  `docker compose logs web` as holding keys after any API outage or restart and limit who reads it; give
  the `web` service a `logging:` rotation (it has none, `bridge` and `nce` do) so old lines age out; send
  the error log to a short-lived file instead of the container stream. The exposure is the length of an
  API outage or restart, which includes the seconds a deploy takes to start `api` (`up -d --no-build api web`
  starts both together).
- **R2 — old lines on the VM.** The running `api` and `web` containers hold the lines written before
  this change, keys and any `?token=` included. Docker's json-file logs belong to the container: checked
  here (Docker 29.7.2, `json-file`) — create a container, write a line, `docker rm` it, and its
  `/var/lib/docker/containers/<id>/<id>-json.log` is gone with its directory. `docker compose up -d`
  recreates a container by removing the old one, so the deploy that brings this change (both `api` and
  `web` change) should drop their old logs. Not verified, so to be checked on the VM before relying on it:
  the daemon's log driver (`docker info --format '{{.LoggingDriver}}'`; a different driver or
  `daemon.json` option keeps lines elsewhere), that the deploy really recreates both containers
  (`StartedAt` differs; a plain `restart` keeps the file), and copies outside the containers (a saved
  `docker logs > file`, a backup of `/var/lib/docker`). `api` and `web` have no `max-size`, so nothing
  ages those lines out before the recreate. Lane A decides whether a `?token=` seen in them means
  rotating the tenant token.
- **R3 — the hub's uvicorn keeps its access log** (`scripts/run_infinity_transport.py` calls
  `uvicorn.run` with the default). Its routes are `/v1/packets`, `/v1/heartbeat`, `/v1/status` and
  `/infinity-research/*`: none has a path parameter, so no key. Left alone.
- **R4 — the VM blocks.** `G2B-ESLEME-bloklari.txt` (lines 200–204) compares the running API's `Config.Cmd`
  with the old command item by item, and its rollback G-1 (line 389) re-declares that command as a compose
  `command:`. Run after this deploy, the first stops on the new command and the second would put the
  access log back. The O10 deploy block must expect the old command before and the new one after, and its
  own rollback must carry the flag. The B1d plan's "no number in a log" check (`docker logs … | grep -cE
  "2026000000(01|02|99)"`) covers the bridge and the api; adding `homunculus-web` fits it after this slice,
  outside an API outage (R1).
- **R5 — the client address stays in the web log** (`$remote_addr`): the ward PCs' addresses are what the
  rate-limit check reads, and the hub's address is what the Aşama A allow-list waits for. It is no patient key.

## 7. Not in this follow-up

- The error log (R1) and the old lines (R2): owner and Lane A.
- The VM deploy: the owner's «main'e al» and «onay». Nothing here touches the VM.
- A different edge (a log shipper, a WAF) that could redact an error line: out of scope.
- The audit trail's own records (`/audit`), which are a database record and not a log.
