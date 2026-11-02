"""Aşama A forwarder: the hub's live research values, thinned, to the clinical API's shadow lane.

Display only. The API shows these values in a strip labelled "doğrulanmamış" and feeds them to
nothing: no rule, score, alert, notification or audit row. This is NOT clinical forwarding, and
the hub keeps saying `clinical_forwarding: False`. No imports outside `homunculus.edge` and the
standard library: the release packs only `edge/` (deploy/infinity/build_transport_release.py).

One body per cycle: for each device, its status and, for each forwarded parameter, the value the
live view holds now — at most one value per parameter per device per INTERVAL_S; NBP also carries
the time its value last changed, or null while no change has been seen and the three are the complete
valid triple the monitor repeats (NBP-2). A device is named by its address only; a bed comes from the
API's approved table, never from here.

Off unless its environment is set (`settings_from_env`), which on the hub only the drop-in
`93-asama-a-golge.conf` does, through an `EnvironmentFile=`. Its failures never leave its thread;
it logs one line per change of state, never the token, the URL's query or a value.
"""
from __future__ import annotations

import json
import logging
import ssl
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .infinity_live import NBP

SCHEMA = "homunculus.infinity-shadow.v2"
INTERVAL_S = 5.0
MAX_FORWARD_AGE_MS = 3000.0          # = infinity_live.STALE_AFTER_MS: nothing older leaves the hub
BACKOFF_S = 60.0                     # after 401 or 409
TIMEOUT_S = 3.0
MIN_TOKEN = 32
PORT = 2050                          # the inventory admits no other (infinity_stream.Inventory.parse)
# NBP travels with `changed_at`, the time its triple last changed as the live view saw it: the
# monitor repeats the last NBP in every packet and its own clock is not decoded, so that time is an
# upper bound of the measurement: the cuff measured then or earlier. Without a change seen as it
# happened (after a hub start, an outage, or any gap of more than NBP_CONTINUITY_S between complete
# valid triples; X46) the hub has no time, and the three travel with `changed_at: None` — what the
# monitor shows now, its measurement time unknown (NBP-2, D1) — but only whole: all three present,
# valid, fresh and the values of the triple the hub holds (`_untimed_nbp`). A newer value of one
# component that is not the held triple's carries no time and is not sent (X38), and while it is
# held no untimed NBP is sent at all; nor is an untimed triple with a "***", stale or missing part.
# The API must take a null `changed_at` before a hub sends one (NBP-2 D6: the API first). Airway RESP
# is absent on purpose (layout unverified).
FORWARDED = ("hr", "pls", "spo2", "etco2", "temperature",
             "art_systolic", "art_diastolic", "art_mean", "respiration") + NBP
_STATES = {401: "token_refused", 409: "stage_off", 429: "too_soon"}

log = logging.getLogger(__name__)


class ShadowMisconfigured(ValueError):
    """The forwarder's environment is set but unusable. The message is a fixed sentence that names
    variables, never their values, so the runner may print it as it is."""


def settings_from_env(env):
    """None when none of the three variables is set (forwarding off); the settings when all three
    are usable; `ShadowMisconfigured` otherwise — a half-set environment stops the hub rather than
    running a forwarder nobody can see failing."""
    url = (env.get("INFINITY_SHADOW_URL") or "").strip()
    token = (env.get("INFINITY_SHADOW_TOKEN") or "").strip()
    ca_file = (env.get("INFINITY_SHADOW_CA_FILE") or "").strip()
    if not (url or token or ca_file):
        return None
    parts = urlsplit(url) if url else None
    if (not (url and token and ca_file) or parts.scheme != "https" or not parts.hostname
            or len(token) < MIN_TOKEN or not token.isascii() or not token.isprintable() or " " in token):
        raise ShadowMisconfigured(
            "Shadow forwarding misconfigured: INFINITY_SHADOW_URL (https), INFINITY_SHADOW_TOKEN "
            "(>= 32 printable characters, no spaces) and INFINITY_SHADOW_CA_FILE must all be set.")
    return {"url": url, "token": token, "ca_file": ca_file}


def _untimed_nbp(device):
    """Whether the device's three NBP entries travel untimed: each present, valid, younger than
    MAX_FORWARD_AGE_MS, with no change time, and holding its component of the triple the hub holds
    (`nbp_triple`) — the complete valid triple the monitor repeats now, its change not seen. All
    three or none: a missing, stale or "***" part, or a partial packet's lone newer value (X38),
    would put half a cuff, or a half-updated one, on the strip."""
    triple = device.get("nbp_triple")
    if triple is None or len(triple) != len(NBP):
        return False
    for name, held in zip(NBP, triple):
        entry = device["parameters"].get(name)
        if (entry is None or entry["status"] != "candidate" or entry["age_ms"] >= MAX_FORWARD_AGE_MS
                or entry.get("changed_at") is not None or entry["value"] != held):
            return False
    return True


def thin(snapshot, *, now, collector_age, counters):
    """The body for one cycle, from one live-view snapshot: per device its address, the hub's own
    status word and packet age, and each forwarded parameter's current value if it is younger
    than MAX_FORWARD_AGE_MS. A device's "***" travels as `valid: false, value: null`; a stale
    parameter does not travel; an NBP reading travels with its `changed_at`, or with
    `changed_at: None` when the three are a whole untimed triple (`_untimed_nbp`), else not at all.
    No device id or inventory name leaves the hub."""
    devices = []
    for device in snapshot["devices"]:
        readings = []
        untimed = _untimed_nbp(device)
        for name in FORWARDED:
            entry = device["parameters"].get(name)
            if entry is None or entry["status"] == "stale" or entry["age_ms"] >= MAX_FORWARD_AGE_MS:
                continue
            if name in NBP and entry.get("changed_at") is None and not untimed:
                continue                                    # no time, and not a whole untimed triple
            valid = entry["status"] == "candidate"
            reading = {"parameter": name, "value": entry["value"] if valid else None,
                       "unit": entry["unit"], "valid": valid,
                       "captured_at": float(entry["capture_epoch"])}
            if name in NBP:
                changed = entry.get("changed_at")
                reading["changed_at"] = None if changed is None else float(changed)
            readings.append(reading)
        age = device["packet_age_ms"]
        devices.append({"source": device["source_ip"], "group": device["group"], "port": PORT,
                        "status": device["status"], "packet_age_ms": None if age is None else float(age),
                        "readings": readings})
    return {"schema": SCHEMA, "sent_at": now,
            "forwarder": {"interval_s": INTERVAL_S, "sent": counters["sent"], "failed": counters["failed"],
                          "decoder": snapshot.get("schema")},
            "hub": {"collector_age_s": collector_age,
                    "accepted_packets": snapshot.get("accepted_packets", 0),
                    "old_or_duplicate_packets": snapshot.get("old_or_duplicate_packets", 0)},
            "devices": devices}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect would carry the Authorization header to wherever it points: never follow one.
    The 3xx then arrives as an HTTPError, and its status is counted like any other failure."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ShadowSender:
    """POST one body; returns the HTTP status (or 0 for a network failure). Never raises, never logs
    the token or the body. Trusts only `ca_file` (the panel's own self-signed certificate) and
    checks the host name; ignores proxy variables; follows no redirect."""

    def __init__(self, url, token, ca_file, *, opener=None):
        self.url, self._token = url, token
        if opener is None:
            try:
                context = ssl.create_default_context(cafile=ca_file)
            except (OSError, ssl.SSLError, ValueError):
                raise ShadowMisconfigured("Shadow forwarding misconfigured: INFINITY_SHADOW_CA_FILE "
                                          "could not be read as a PEM certificate.") from None
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect(),
                                                 urllib.request.HTTPSHandler(context=context))
        self._opener = opener

    def send(self, body):
        try:
            data = json.dumps(body, allow_nan=False).encode()
        except (TypeError, ValueError):
            return 0
        request = urllib.request.Request(self.url, data=data, method="POST",
                                         headers={"Authorization": "Bearer " + self._token,
                                                  "Content-Type": "application/json"})
        try:
            with self._opener.open(request, timeout=TIMEOUT_S) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code
        except (urllib.error.URLError, OSError, ssl.SSLError, ValueError):
            return 0


def forward_loop(view, sender, stop, *, collector_age, clock=time.time, wait=None):
    """Every INTERVAL_S, one body; after 401 or 409, BACKOFF_S. Runs until `stop` is set."""
    wait = wait or stop.wait
    counters, state = {"sent": 0, "failed": 0}, "starting"
    while not stop.is_set():
        try:
            status = sender.send(thin(view.snapshot(), now=clock(), collector_age=collector_age(),
                                      counters=counters))
        except Exception:                   # a bug here must never end the thread, nor print data
            status = None
        if status == 200:
            counters["sent"] += 1
            new, pause = "ok", INTERVAL_S
        else:
            counters["failed"] += 1
            new = "failing_internal" if status is None else _STATES.get(status, f"failing_{status}")
            pause = BACKOFF_S if status in (401, 409) else INTERVAL_S
        if new != state:
            log.warning("Aşama A forwarder: %s -> %s", state, new)   # one line per change, no token, no value
            state = new
        wait(pause)


def start(view, settings, stop, *, collector_age):
    """Start the forwarder's daemon thread (the runner's one call). Returns the thread."""
    sender = ShadowSender(settings["url"], settings["token"], settings["ca_file"])
    thread = threading.Thread(target=forward_loop, args=(view, sender, stop),
                              kwargs={"collector_age": collector_age}, daemon=True, name="asama-a-forwarder")
    thread.start()
    return thread
