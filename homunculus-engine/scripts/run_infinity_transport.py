"""Run an isolated Infinity collector or research receiver; clinical ingest stays disabled."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import sys
import threading
import time

from cryptography.fernet import Fernet
import uvicorn

from homunculus.edge.infinity_collector import Sender, collect, forward_loop, membership_capacity, raw_pcap_events, save_batch
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_journal import Journal
# Aşama A's forwarder, under its own names: its `forward_loop` must never shadow the collector's.
from homunculus.edge.infinity_shadow import ShadowMisconfigured
from homunculus.edge.infinity_shadow import settings_from_env as shadow_settings_from_env
from homunculus.edge.infinity_shadow import start as start_shadow_forwarder
from homunculus.edge.infinity_stream import Inventory, MAX_BATCH
from homunculus.edge.infinity_timing import Timings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=("collector", "hub"))
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path, help="outside repositories; encrypted journal")
    parser.add_argument("--max-mib", type=int, default=128)
    parser.add_argument("--max-rows", type=int, default=100000)
    parser.add_argument("--retention-seconds", type=int, default=3600)
    parser.add_argument("--capture-payload", action="store_true", help="explicitly retain/accept encrypted raw research payloads")
    # No profile argument any more: parameters are read from the records in the payload,
    # which name themselves. A path is still accepted and ignored so an existing unit file
    # keeps starting rather than failing at boot on an argument that no longer applies.
    parser.add_argument("--unverified-live-research", nargs="?", const=True, default=None,
                        metavar="IGNORED",
                        help="hub only: continuously decode parameter records from live payloads")
    parser.add_argument("--endpoint", help="collector: HTTPS receiver origin")
    parser.add_argument("--ca-file", help="collector: trusted CA PEM")
    parser.add_argument("--allow-loopback-http", action="store_true", help="collector: local test only")
    parser.add_argument("--replay", type=Path, help="collector: classic RAW IPv4 PCAP, clearly labelled replay")
    parser.add_argument("--host", default="127.0.0.1", help="hub bind address")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--tls-cert")
    parser.add_argument("--tls-key")
    args = parser.parse_args()
    journal = None
    worker = None
    stop = threading.Event()
    failure = threading.Event()
    # One object for the journal, the sender, the forwarding loop and the hub, so a reading
    # of /v1/status or of a heartbeat shows every phase of a batch side by side.
    timings = Timings()
    try:
        inventory = Inventory.read(args.inventory)
        research_view = None
        if args.unverified_live_research:
            if args.role != "hub" or not args.capture_payload or args.replay:
                raise ValueError("Live research requires a hub with explicit payload acceptance.")
            from homunculus.edge.infinity_live import LiveResearchView
            research_view = LiveResearchView(inventory)
        key = os.environ["INFINITY_STORAGE_KEY"].encode()
        token = os.environ["INFINITY_COLLECTOR_TOKEN"]
        Fernet(key)
        if len(token) < 32:
            raise ValueError("Collector token is too short.")
        if args.role == "hub":
            viewer = os.environ["INFINITY_VIEWER_TOKEN"]
            if args.host not in ("127.0.0.1", "::1", "localhost") and not (args.tls_cert and args.tls_key):
                raise ValueError("Non-loopback receiver requires a TLS certificate and key.")
            if not 1 <= args.port <= 65535:
                raise ValueError("Invalid port.")
        else:
            if not args.endpoint:
                raise ValueError("Collector requires --endpoint.")
            sender = Sender(args.endpoint, token, ca_file=args.ca_file, allow_loopback_http=args.allow_loopback_http,
                            timings=timings)
            if not args.replay:
                if sys.platform != "linux":
                    raise ValueError("Live mode requires Linux.")
                capacity = membership_capacity(inventory)
                print(json.dumps(capacity), flush=True)
                if not capacity["sufficient"]:
                    print("Host IGMP membership limit is below the inventory's group count; no groups joined.", flush=True)
                    return 2
        journal = Journal(args.database, key, max_bytes=args.max_mib*1024*1024,
                          max_rows=args.max_rows, retention=args.retention_seconds, timings=timings)
        print("Infinity research transport; clinical forwarding DISABLED.", flush=True)
        if args.role == "hub":
            app = create_hub(inventory, journal, token, viewer, accept_payload=args.capture_payload,
                             research_view=research_view, timings=timings)
            # Aşama A: display values to the clinical API's shadow lane, only with drop-in 93's
            # environment. Not clinical ingest: the hub's answers keep clinical_forwarding False.
            shadow = shadow_settings_from_env(os.environ)
            if shadow is not None and research_view is None:
                print("Shadow display forwarding NOT started: it needs --unverified-live-research.", flush=True)
            elif shadow is not None:
                start_shadow_forwarder(research_view, shadow, stop, collector_age=app.state.collector_age)
                print("Shadow display forwarding ENABLED (Stage A, unvalidated; not clinical ingest) every 5 s.",
                      flush=True)
            uvicorn.run(app, host=args.host, port=args.port, ssl_certfile=args.tls_cert,
                        ssl_keyfile=args.tls_key, access_log=False, proxy_headers=False)
            return 0
        for signum in (signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, lambda *_: stop.set())
        worker = threading.Thread(target=forward_loop, args=(journal, sender, inventory, stop,
                                   "replay" if args.replay else "live", failure),
                                  kwargs={"timings": timings}, daemon=True)
        worker.start()
        if args.replay:
            baseline = journal.snapshot()["counters"]
            batch = []
            for event in raw_pcap_events(args.replay, inventory, retain_payload=args.capture_payload):
                if stop.is_set():
                    break
                batch.append(event)
                if len(batch) == MAX_BATCH:
                    save_batch(journal, batch)
            save_batch(journal, batch)
            deadline = time.monotonic() + 30
            while journal.snapshot()["rows"] and time.monotonic() < deadline and not stop.wait(0.1):
                pass
            state = journal.snapshot()
            if (state["rows"] or stop.is_set() or any(state["counters"].get(k, 0) > baseline.get(k, 0)
                                                     for k in ("queue_full_dropped", "expired"))):
                print("Replay incomplete: pending or dropped records; inspect collector status.", flush=True)
                return 3
            print("Replay delivered; timestamps preserved, no measurements decoded.", flush=True)
        else:
            collect(inventory, journal, stop, retain_payload=args.capture_payload)
        return 2 if failure.is_set() else 0
    except ShadowMisconfigured as error:
        # A fixed sentence naming variables, never their values; the deploy block greps it.
        print(f"Transport stopped: {error}", flush=True)
        return 2
    except (OSError, ValueError, KeyError):
        # Do not log credentials, untrusted payloads or full exception text.
        print("Transport stopped: check inventory, storage key/path, network membership capacity, endpoint "
              "or shadow forwarding configuration.", flush=True)
        return 2
    finally:
        stop.set()
        if worker:
            worker.join(timeout=20)
        if journal and not (worker and worker.is_alive()):
            journal.close()


if __name__ == "__main__":
    raise SystemExit(main())
