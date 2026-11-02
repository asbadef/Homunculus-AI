"""The access logs stop recording patient keys (G2-B1d follow-up O10).

The patient screen's routes carry the board key in the path (`/patients/<key>/trends`,
`/scores/sofa/<key>`): the protocol number now, the H-number before B1d. Two access logs wrote it:
uvicorn's, and nginx's. This slice:

- turns uvicorn's access log off (`--no-access-log` in `Dockerfile.api` and `render.yaml`): the API
  publishes no host port, every browser request comes through nginx, and the bridge's calls
  (`/ingest`, `/edge/patient-query`) carry no key in the path;
- gives nginx a log format of its own (`homunculus_redacted`) that writes the path through
  `map $uri $homunculus_log_uri`, which replaces each route parameter by a placeholder
  (`/patients/202600000001/trends` -> `/patients/:key/trends`), and writes no query string and no
  referer (the dashboard keeps a key in the URL fragment, which is never sent, so the referer should
  hold none; it is dropped as defence in depth).

THE DRIFT GUARD. The map is a hand-written list; the route table is code. A route added later with a
path parameter fails `test_every_route_parameter_is_redacted_in_the_log_uri` until the map covers it
(the sentinel key would otherwise reach the log), so a new router cannot quietly bring the keys back.
The map is read from the real `nginx.conf` and applied here as nginx applies it: exact strings first,
then the regular expressions in file order, the first match wins, `default` last.
`deploy/local/web/nginx.conf` says the same in its own comment.

What this slice does NOT cover is nginx's `error_log`: on an upstream failure its line carries the
request (`request: "GET /patients/<key>/trends HTTP/1.1"`) and the line cannot be formatted. That is
the residual item in the O10 spec; nothing here pins or changes it.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
import textwrap
from pathlib import Path

from tests.route_walk import api_routes

ENGINE = Path(__file__).resolve().parents[1]
ROOT = ENGINE.parent
CONF = ROOT / "deploy" / "local" / "web" / "nginx.conf"
DOCKERFILE = ENGINE / "Dockerfile.api"
RENDER = ROOT / "render.yaml"
DASHBOARD_SRC = ROOT / "dashboard" / "src"
DASHBOARD_ROUTES = DASHBOARD_SRC / "live" / "shell" / "routes.js"

#: A synthetic protocol number (12 digits; the shape B1d issues), never a real one. If it is still in
#: the logged path, the redaction failed.
SENTINEL = "202600000001"
SENTINEL_2 = "202600000002"

#: The dashboard's client-side routes that carry a key. Hand-listed, and checked against
#: `dashboard/src/live/shell/routes.js` below (the `path:` of every ROUTES entry with a `:param`).
#: They live in the URL FRAGMENT (`#/patients/<key>`): the browser never sends a fragment to a
#: server, nor in a Referer, so a reload of such an address reaches nginx as `/` — see
#: `test_the_dashboards_key_routes_never_reach_the_log`.
DASHBOARD_KEY_ROUTES = ["/patients/:id"]


# ---------------------------------------------------------------------------------------------
# nginx's map, read from the real file and applied as nginx applies it
# ---------------------------------------------------------------------------------------------

def _conf() -> str:
    return CONF.read_text(encoding="utf-8")


def _map_entries(text: str) -> list[tuple[str, str]]:
    """(key, value) of every entry of `map $uri $homunculus_log_uri { … }`, in file order.
    The block is at the file's top level and ends at the first `}` in column 0."""
    block = re.search(r"^map\s+\$uri\s+\$homunculus_log_uri\s*\{(.*?)^\}", text, re.S | re.M)
    assert block, "no `map $uri $homunculus_log_uri { … }` at the top level of nginx.conf"
    entries = []
    for line in block.group(1).splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        entry = re.fullmatch(r"(\S+)\s+(\S+);", line)
        assert entry, f"a map line this test cannot read (one key, one value, `;`): {line!r}"
        entries.append((entry.group(1), entry.group(2)))
    return entries


def _pcre(pattern: str) -> str:
    """nginx's PCRE as Python's `re` reads it: only the named group differs, `(?<n>…)` -> `(?P<n>…)`
    (a lookbehind, `(?<=` / `(?<!`, is not a name and is left alone)."""
    return re.sub(r"\(\?<([A-Za-z_]\w*)>", r"(?P<\1>", pattern)


def _expand(value: str, match: re.Match[str] | None, uri: str) -> str:
    """A map value: text and `$variables` — `$uri`, `$1`, or the name of a named capture of the
    entry's regex. A capture that did not take part is the empty string, as in nginx."""
    def one(var: re.Match[str]) -> str:
        name = var.group(1)
        if name == "uri":
            return uri
        assert match is not None, f"{name!r} in a value with no regex behind it"
        return match.group(int(name) if name.isdigit() else name) or ""
    return re.sub(r"\$(\w+)", one, value)


def _apply(entries: list[tuple[str, str]], uri: str) -> str:
    """What `$homunculus_log_uri` is for this `$uri`: an exact-string key first, then the regular
    expressions (`~` case-sensitive, `~*` not) in file order — the first match wins — then `default`."""
    for key, value in entries:
        if key != "default" and not key.startswith("~") and key == uri:
            return _expand(value, None, uri)
    for key, value in entries:
        if key.startswith("~"):
            flags = re.I if key.startswith("~*") else 0
            match = re.search(_pcre(key.lstrip("~*")), uri, flags)
            if match:
                return _expand(value, match, uri)
    defaults = [value for key, value in entries if key == "default"]
    assert len(defaults) == 1, "the map needs exactly one `default`"
    return _expand(defaults[0], None, uri)


def _log_uri(uri: str) -> str:
    return _apply(_map_entries(_conf()), uri)


# ---------------------------------------------------------------------------------------------
# The app's routes
# ---------------------------------------------------------------------------------------------

_PARAM = re.compile(r"\{(\w+)(?::(\w+))?\}")


def _app_paths() -> list[str]:
    """Every distinct path of the app's route table, `{param}` kept — the walk of
    tests/test_route_inventory.py, which descends into the included routers."""
    from homunculus.api.app import create_app

    paths = sorted({route.path for route in api_routes(create_app({"t": "h"}, run_escalation_loop=False))})
    # Guard against the walk going vacuous (a FastAPI change once hid every included router).
    assert "/patients/{patient_id}/trends" in paths and "/scores/sofa/{patient_id}" in paths, paths
    assert "/ingest" in paths and "/health" in paths, paths
    return paths


def _fill(path: str) -> str:
    """The path as a client sends it: each parameter replaced by the sentinel; a `{x:path}` one, which
    takes slashes, by two segments."""
    return _PARAM.sub(lambda m: f"{SENTINEL}/{SENTINEL_2}" if m.group(2) == "path" else SENTINEL, path)


def _placeholders(path: str) -> str:
    """What the map is expected to write: `:key` for a patient's key, `:id` for any other id."""
    return _PARAM.sub(lambda m: ":key" if m.group(1) == "patient_id" else ":id", path)


def test_the_log_uri_map_is_declared_at_the_top_level_before_the_server() -> None:
    """`map` and `log_format` belong to `http {}`; this file is installed as conf.d/default.conf,
    which nginx includes there, so they sit at the file's top level, above `server {`."""
    text = _conf()
    server = text.index("\nserver {")
    assert re.search(r"^map\s+\$uri\s+\$homunculus_log_uri\s*\{", text, re.M).start() < server
    assert re.search(r"^log_format\s+homunculus_redacted\s", text, re.M).start() < server
    assert len(_map_entries(text)) >= 10                    # the reader is not reading an empty block


def test_the_map_reader_applies_a_map_as_nginx_does() -> None:
    """The guard below is only as good as this reader: first regex wins, named captures and `$uri`
    work in a value, an unmatched capture is empty, an exact string beats a regex, `default` is last."""
    entries = [("/exact", "/EXACT"), ("~^/a/[^/]+(?<rest>/x)?$", "/a/:id$rest"),
               ("~^/a/", "/a/:rest-of-it"), ("~*^/UPPER$", "/matched-case-insensitively"),
               ("default", "$uri")]
    assert _apply(entries, "/exact") == "/EXACT"
    assert _apply(entries, "/a/1") == "/a/:id"                  # `rest` took no part: empty
    assert _apply(entries, "/a/1/x") == "/a/:id/x"
    assert _apply(entries, "/a/1/y") == "/a/:rest-of-it"        # the first regex did not match
    assert _apply(entries, "/upper") == "/matched-case-insensitively"
    assert _apply(entries, "/other") == "/other"
    assert _pcre("^/(?<pre>a|b)/(?!c)(?<=/)x") == "^/(?P<pre>a|b)/(?!c)(?<=/)x"


def test_every_route_parameter_is_redacted_in_the_log_uri() -> None:
    """THE DRIFT GUARD. For every path of the app with a `{param}` (a `{x:path}` one included), the
    path a client sends — the parameter replaced by a synthetic key — is rewritten by the map to the
    placeholder form, and the key is gone. A new route with a path parameter fails here until
    `nginx.conf`'s `map $uri $homunculus_log_uri` has an entry for it."""
    entries = _map_entries(_conf())
    parametrized = [path for path in _app_paths() if "{" in path]
    assert len(parametrized) >= 40, parametrized
    leaked, misshapen = [], []
    for path in parametrized:
        logged = _apply(entries, _fill(path))
        if SENTINEL in logged or SENTINEL_2 in logged:
            leaked.append(f"{path} -> {logged}")
        elif logged != _placeholders(path):
            misshapen.append(f"{path} -> {logged} (wanted {_placeholders(path)})")
    assert not leaked, f"these routes would put a key in nginx's access log: {leaked}"
    assert not misshapen, (f"covered only by the catch-all, or not as the placeholders say: "
                           f"{misshapen}")


def test_routes_without_a_parameter_are_logged_as_they_are() -> None:
    """The log stays useful: `/ingest`, `/health`, `/scope/me` are not rewritten, so the catch-all at
    the end of the map (everything below a parametrized prefix) does not swallow a static route."""
    entries = _map_entries(_conf())
    static = [path for path in _app_paths() if "{" not in path]
    assert len(static) >= 40, static
    rewritten = [f"{path} -> {_apply(entries, path)}" for path in static
                 if _apply(entries, path) != path]
    assert not rewritten, rewritten
    for path in ("/index.html", "/assets/index-abc.js", "/", "/auth/login"):
        assert _apply(entries, path) == path


def test_an_unrecognised_tail_below_a_parametrized_prefix_is_redacted_whole() -> None:
    """Below every prefix that carries a key, a path the map has no precise entry for — a typo, a
    probe, a route added later, a key with an encoded slash (`%2F`, which nginx decodes in `$uri`) —
    is collapsed to `<prefix>:redacted`. nginx logs a request whatever the API answers, a 404
    included, so the key of `GET /patients/<key>` must not be logged either."""
    entries = _map_entries(_conf())
    prefixes = sorted({path.split("{", 1)[0] for path in _app_paths() if "{" in path})
    assert "/patients/" in prefixes and "/scores/sofa/" in prefixes, prefixes
    leaked = []
    for prefix in prefixes:
        for tail in (f"{SENTINEL}/unknown", f"{SENTINEL}/", f"x/{SENTINEL}/trends",
                     f"{SENTINEL}/{SENTINEL_2}/preview"):
            logged = _apply(entries, prefix + tail)
            if SENTINEL in logged or SENTINEL_2 in logged:
                leaked.append(f"{prefix + tail} -> {logged}")
    assert not leaked, leaked
    assert _apply(entries, f"/patients/{SENTINEL}") == "/patients/:redacted"


#: The calls of the dashboard's own code that move the address bar to another PATH — the only ways a
#: client route (`#/patients/<key>`) could become a request path nginx logs. The fragment-only ways
#: (`location.hash = …`, `location.replace("#…")`) are no concern: the browser sends no fragment.
_NAVIGATION_CALL = re.compile(
    r"\b(?:window\.)?(?:history\.(?:pushState|replaceState)|(?:window\.)?location\.(?:assign|replace))\s*\(")
_NAVIGATION_ASSIGN = re.compile(r"\blocation\.href\s*=(?!=)")

#: The two `replaceState` calls the dashboard makes, matched by their expression text (not by line
#: number). Both keep the page's own path: LiveApp.jsx drops a spent hash and keeps
#: `pathname + search`; main.jsx rewrites the address `withoutRetired(window.location)` returns, which
#: starts with the same `pathname`. A new call, or a reformatted one, fails the scan below until
#: someone has looked at what path it writes.
ALLOWED_NAVIGATION_CALLS = {
    'window.history.replaceState(null, "", window.location.pathname + window.location.search)',
    'window.history.replaceState(window.history.state, "", cleaned)',
}


def _call_text(source: str, start: int) -> str:
    """The call that starts at `start`, from its name to its closing parenthesis, whitespace squeezed
    (a string holding a parenthesis is not handled; none of the calls scanned has one)."""
    depth, i = 0, source.index("(", start)
    while i < len(source):
        depth += (source[i] == "(") - (source[i] == ")")
        if depth == 0:
            break
        i += 1
    return " ".join(source[start:i + 1].split())


def _code_lines(path: Path) -> str:
    """A dashboard source without its whole-line comments, which name these calls in words."""
    return "\n".join(line for line in path.read_text(encoding="utf-8").splitlines()
                     if not re.match(r"\s*(//|/\*|\*)", line))


def _path_navigations(code: str) -> list[str]:
    """Every call or assignment in `code` that may move the address bar to another path: all of
    `_NAVIGATION_CALL` and `location.href = …`, except `location.replace` to a `#…` fragment."""
    calls = [_call_text(code, m.start()) for m in _NAVIGATION_CALL.finditer(code)]
    calls += [code[m.start():].split("\n", 1)[0].strip() for m in _NAVIGATION_ASSIGN.finditer(code)]
    return [call for call in calls
            if not re.match(r"(?:window\.)?location\.replace\(\s*[`'\"]#", call)]


def test_the_navigation_scan_sees_what_it_is_meant_to() -> None:
    """The scan above is only as good as this: each way to a new path is found, a fragment is not."""
    code = """
        window.history.pushState(null, "", `/patients/${id}`);
        history.replaceState(null, "",
            "/patients/" + id);
        window.location.assign("/patients/" + id);
        location.href = "/patients/" + id;
        window.location.replace(`/patients/${id}`);
        window.location.replace(`#${home}`);
        window.location.hash = "#/settings";
        if (location.href === x) {}
    """
    assert _path_navigations(code) == [
        'window.history.pushState(null, "", `/patients/${id}`)',
        'history.replaceState(null, "", "/patients/" + id)',
        'window.location.assign("/patients/" + id)',
        'window.location.replace(`/patients/${id}`)',
        'location.href = "/patients/" + id;',
    ]


def test_the_dashboards_key_routes_never_reach_the_log() -> None:
    """The dashboard's patient screen is `#/patients/:id`. It is routed by the URL FRAGMENT: a browser
    sends no fragment to the server and none in a Referer, so a page reload of that address reaches
    nginx as `/` (served as `/index.html`) and the key is never in a log. Pinned three ways:
    - the table in routes.js has exactly the key routes listed here;
    - the dashboard's own code moves the address bar to another path in no way but the two
      `replaceState` calls of ALLOWED_NAVIGATION_CALLS, which keep the page's path: no `pushState`, no
      `location.assign`, no `location.href = …`, no `location.replace` to anything but a `#…` fragment
      (tests are not scanned);
    - were such an address ever sent as a path, the map would still redact it."""
    routes = DASHBOARD_ROUTES.read_text(encoding="utf-8")
    assert re.findall(r'path:\s*"(/[^"]*:[^"]*)"', routes) == DASHBOARD_KEY_ROUTES
    sources = [path for path in DASHBOARD_SRC.rglob("*")
               if path.suffix in (".js", ".jsx") and ".test." not in path.name
               and "testutil" not in path.name]
    assert any(path.suffix == ".jsx" for path in sources)                # the scan is not empty
    seen, found = set(), []
    for path in sources:
        for call in _path_navigations(_code_lines(path)):
            if call in ALLOWED_NAVIGATION_CALLS:
                seen.add(call)
            else:
                found.append(f"{path.relative_to(ROOT)}: {call}")
    assert not found, (f"{found} may move the address bar to a path: a client route with a key would "
                       f"reach nginx's log. Check what path it writes; add it to "
                       f"ALLOWED_NAVIGATION_CALLS only if it keeps the page's own")
    assert seen == ALLOWED_NAVIGATION_CALLS, ALLOWED_NAVIGATION_CALLS - seen    # the list is not stale
    for route in DASHBOARD_KEY_ROUTES:
        sent = re.sub(r":\w+", SENTINEL, route)
        assert SENTINEL not in _log_uri(sent), sent


# ---------------------------------------------------------------------------------------------
# The log format and the server's log line
# ---------------------------------------------------------------------------------------------

#: Every variable the redacted format may write. An allow-list: a variable that carries the request
#: line, the query string or the referer must be added HERE on purpose, not by accident.
ALLOWED_LOG_VARIABLES = {
    "remote_addr", "time_local", "request_method", "homunculus_log_uri", "server_protocol",
    "status", "body_bytes_sent", "request_time", "http_user_agent",
}
#: What can carry a key, said once by name: the whole request line, the raw URI, the query string
#: and its pieces, the referer (the dashboard page's address), the path before the map, the file
#: system path of the request, cookies and credentials.
FORBIDDEN_LOG_VARIABLES = ["request", "request_uri", "args", "query_string", "http_referer",
                           "uri", "document_uri", "request_filename", "http_cookie",
                           "http_authorization"]


def _log_format() -> str:
    match = re.search(r"^log_format\s+homunculus_redacted\s+(.*?);", _conf(), re.S | re.M)
    assert match, "no `log_format homunculus_redacted` in nginx.conf"
    return match.group(1)


def test_the_log_format_writes_only_the_redacted_path() -> None:
    fmt = _log_format()
    variables = set(re.findall(r"\$(\w+)", fmt))
    assert "homunculus_log_uri" in variables
    assert variables <= ALLOWED_LOG_VARIABLES, sorted(variables - ALLOWED_LOG_VARIABLES)
    for forbidden in FORBIDDEN_LOG_VARIABLES:
        assert forbidden not in variables, forbidden
    assert not re.search(r"\$(arg_|cookie_|http_)(?!user_agent\b)\w+", fmt), fmt
    assert re.search(r'"\$request_method \$homunculus_log_uri \$server_protocol"', fmt), fmt


def _server_block(text: str) -> str:
    """The server block without its comment lines (their apostrophes are not quotes)."""
    text = re.sub(r"(?m)^\s*#.*$", "", text)
    start = text.index("\nserver {")
    depth, quote = 0, None
    for i in range(start, len(text)):         # braces inside a quoted JSON answer balance, but skip them
        ch = text[i]
        if quote:
            quote = None if ch == quote else quote
        elif ch in "'\"":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i]
    raise AssertionError("the server block is not closed")


def test_the_servers_access_log_uses_the_redacted_format() -> None:
    """One `access_log` in the whole file, at the server level — none in a `location`, whose own
    `access_log` would replace the server's — written to nginx:alpine's /var/log/nginx/access.log
    (which the image links to stdout, where `docker compose logs web` reads it)."""
    text = _conf()
    directives = re.findall(r"^\s*access_log\s+([^;]*);", text, re.M)
    assert directives == ["/var/log/nginx/access.log homunculus_redacted"], directives
    server = _server_block(text)
    assert server.count("access_log") == 1
    before = server[:server.index("access_log")]
    depth = 0
    for ch in re.sub(r"'[^']*'|\"[^\"]*\"", "", before):    # quoted answers hold balanced braces
        depth += (ch == "{") - (ch == "}")
    assert depth == 1, "the access_log is inside a location, not at the server level"


# ---------------------------------------------------------------------------------------------
# uvicorn's access log
# ---------------------------------------------------------------------------------------------

def _dockerfile_command() -> list[str]:
    [line] = [line for line in DOCKERFILE.read_text(encoding="utf-8").splitlines()
              if line.startswith("CMD ")]
    exec_form = json.loads(line[len("CMD "):])
    assert exec_form[:2] == ["sh", "-c"], exec_form
    return shlex.split(exec_form[2].split("exec ", 1)[1])


def test_the_api_image_starts_uvicorn_without_its_access_log() -> None:
    """`--no-access-log`, with the rest of the command as the Dockerfile's comments say it must
    stay: `exec` (uvicorn is PID 1 and receives SIGTERM) and no `--workers` (state that has to be one
    per server lives in this process)."""
    command = _dockerfile_command()
    assert command[:2] == ["uvicorn", "homunculus.api.prodserver:app"], command
    assert "--no-access-log" in command, command
    assert "--workers" not in " ".join(command)
    assert command[command.index("--port") + 1] == "8000"


def test_render_starts_uvicorn_without_its_access_log_too() -> None:
    text = RENDER.read_text(encoding="utf-8")
    [start] = re.findall(r"^\s*startCommand:\s*(.+)$", text, re.M)
    assert "uvicorn homunculus.api.prodserver:app" in start and "--no-access-log" in start, start


def test_every_launch_of_the_production_app_is_covered() -> None:
    """The production entry (`homunculus.api.prodserver:app`) is started in the image and on Render;
    a third launch command added later has to carry the flag as well."""
    candidates = [DOCKERFILE, RENDER] + [
        path for path in ROOT.glob("deploy/**/*")
        if path.is_file() and (path.suffix in (".yml", ".yaml", ".sh") or path.name.startswith("Dockerfile"))]
    launches = []
    for path in candidates:
        text = path.read_text(encoding="utf-8", errors="ignore")
        launches += [(path.name, line.strip()) for line in text.splitlines()
                     if "uvicorn homunculus.api.prodserver:app" in line
                     and not line.lstrip().startswith("#")]
    assert launches, "no launch command found: the scan is looking in the wrong place"
    missing = [where for where, line in launches if "--no-access-log" not in line]
    assert not missing, f"started without --no-access-log: {missing}"


def test_uvicorn_accepts_the_flag_and_the_engines_lines_survive_it(tmp_path) -> None:
    """The flag exists in the pinned uvicorn, and with `access_log=False` — what the flag sets — a
    request line is not printed while the engine's own INFO lines (tests/test_prodserver_logging.py)
    still reach the log. The same run WITHOUT it prints the request line: the check can fail.
    A development start (no DATABASE_URL), every file it writes in a temporary directory."""
    script = textwrap.dedent("""
        import logging, sys
        import uvicorn
        config = uvicorn.Config("homunculus.api.prodserver:app", access_log=(sys.argv[1] == "on"))
        config.load()
        logging.getLogger("uvicorn.access").info('127.0.0.1:1 - "GET /patients/202600000001/trends HTTP/1.1" 200')
        logging.getLogger("homunculus.auth.ldap").info("an engine line")
    """)

    def run(access: str) -> str:
        env = {name: value for name, value in os.environ.items()
               if not name.startswith(("LDAP_", "DATABASE_URL", "TENANTS"))}
        env.update(PYTHONPATH=str(ENGINE / "src"), AUDIT_DB_PATH=str(tmp_path / "audit.db"),
                   IDENTITY_DB_PATH=str(tmp_path / "identity.db"))
        done = subprocess.run([sys.executable, "-c", script, access], env=env, cwd=tmp_path,
                              capture_output=True, text=True, timeout=120)
        assert done.returncode == 0, done.stderr
        return done.stdout + done.stderr

    on, off = run("on"), run("off")
    assert "GET /patients/202600000001/trends" in on                    # the control
    assert "GET /patients/" not in off and "an engine line" in off
    help_ = subprocess.run([sys.executable, "-m", "uvicorn", "--help"], capture_output=True,
                           text=True, timeout=60)
    assert "--no-access-log" in help_.stdout, help_.stdout
