"""Isolated, memory-only test preview. Never connected to the clinical Engine."""
from __future__ import annotations

import hashlib
import math
import subprocess
import threading
import time
from collections import deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .infinity_discovery import device_addresses, find_tool
from .infinity_research import FIELDS, MAX_LINE, ResearchError, validate_profile

NAMES = ("hr_candidate", "spo2_candidate", "pls_candidate", "resp_candidate")
ORIGINS = [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1")
           for port in (5173, 5174, 3000)]


class PreviewState:
    def __init__(self, mode, source, *, clock=time.monotonic, stale_after=3.0):
        if mode not in ("live", "replay"):
            raise ValueError("Invalid preview mode")
        self.mode, self.source, self.clock, self.stale_after = mode, source, clock, stale_after
        self.lock = threading.Lock()
        self.cycle = 0
        self.reset()

    def reset(self):
        with self.lock:
            self.values = {}
            self.received = self.capture_epoch = None
            self.status = "waiting"
            self.accepted = self.duplicates = self.out_of_order = 0
            self.seen = set()
            self.order = deque()
            self.cycle += 1

    def publish(self, values, capture_epoch, fingerprint):
        if (set(values) != set(NAMES) or not all(type(v) is int and 0 <= v <= 0xFFFFFFFF for v in values.values())
                or not math.isfinite(capture_epoch) or capture_epoch < 0):
            self.clear("unsupported")
            return False
        with self.lock:
            if self.capture_epoch is not None and capture_epoch <= self.capture_epoch:
                self.out_of_order += 1
                return False
            if fingerprint in self.seen:
                self.duplicates += 1
                return False  # duplicates never refresh arrival freshness
            self.seen.add(fingerprint)
            self.order.append(fingerprint)
            if len(self.order) > 512:
                self.seen.remove(self.order.popleft())
            self.values = dict(values)
            self.capture_epoch = capture_epoch
            self.received = self.clock()
            self.accepted += 1
            self.status = "streaming"
            return True

    def clear(self, status):
        with self.lock:
            self.values = {}
            self.status = status

    def snapshot(self):
        with self.lock:
            age = None if self.received is None else max(0, self.clock() - self.received)
            status = self.status
            if status == "streaming" and age is not None and age >= self.stale_after:
                status = "stale"
            return {"schema": "homunculus.infinity-preview.v1", "mode": self.mode,
                    "source_ip": self.source, "status": status, "clinical_ingest_enabled": False,
                    "clinical_mapping_verified": False, "clinical_validity": "unknown",
                    "raw_candidates": dict(self.values) if status == "streaming" else {},
                    "packet_age_ms": None if age is None else round(age * 1000),
                    "stale_after_ms": round(self.stale_after * 1000),
                    "capture_epoch": self.capture_epoch, "accepted_packets": self.accepted,
                    "duplicate_payloads": self.duplicates, "out_of_order_packets": self.out_of_order,
                    "replay_cycle": self.cycle if self.mode == "replay" else None}


def preview_profile(value):
    profile = validate_profile(value)
    if not set(NAMES).issubset({field["name"] for field in profile["fields"]}):
        raise ResearchError("Preview requires four explicitly named candidate fields.")
    return profile


def consume_row(state, profile, row):
    """Other ports/shapes are ignored; malformed or mismatched candidate packets clear the view."""
    try:
        if len(row) > MAX_LINE:
            raise ValueError
        parts = row.split("\t")
        if len(parts) != len(FIELDS):
            raise ValueError
        _, stamp, cap, wire, src, _, proto, frag, more, _, dport, length, payload = parts
        if src != state.source or proto != "17" or dport != "2050":
            return
        if (int(cap) != int(wire) or int(cap) <= 0 or int(frag) != 0
                or more.lower() not in ("0", "false")):
            raise ValueError
        data = bytes.fromhex(payload.replace(":", ""))
        if len(data) + 8 != int(length):
            raise ValueError
        if len(data) != profile["payload_length"]:
            return
        for guard in profile["guards"]:
            expected = bytes.fromhex(guard["hex"])
            if data[guard["offset"]:guard["offset"] + len(expected)] != expected:
                raise ValueError
        values = {f["name"]: int.from_bytes(data[f["offset"]:f["offset"] + f["width"]], f["byteorder"])
                  for f in profile["fields"] if f["name"] in NAMES}
        state.publish(values, float(stamp), hashlib.sha256(data).digest())
    except (ValueError, TypeError, OverflowError):
        state.clear("unsupported")


def replay_source(state, stop, ready, series):
    """Loop an explicitly labelled recording, respecting its original arrival intervals."""
    while not ready.wait(0.1):
        if stop.is_set():
            return
    while not stop.is_set():
        state.reset()
        previous = None
        for row in series:
            stamp = row["capture_epoch"]
            if previous is not None and stop.wait(max(0, stamp - previous)):
                return
            previous = stamp
            values = {name: row["raw_candidates"][name] for name in NAMES}
            state.publish(values, stamp, str(row["frame_number"]))
        state.clear("ended")
        if stop.wait(2):
            return


def live_source(state, stop, ready, profile, interface, duration):
    """Full packets travel only through pipes. No join, device command, file or upload."""
    if not interface or "://" in interface or interface == "-" or not 1 <= duration <= 300:
        state.clear("error")
        return
    producer = consumer = None
    done = threading.Event()
    watchdog = None

    def terminate():
        for process in (consumer, producer):
            if process is not None:
                try:
                    process.kill()
                except OSError:
                    pass

    def watch():
        deadline = time.monotonic() + duration + 10
        while not done.wait(0.1):
            if stop.is_set() or time.monotonic() >= deadline:
                terminate()
                return

    try:
        source = device_addresses([state.source])[0]
        base = f"ip and src host {source} and udp dst port 2050"
        producer = subprocess.Popen([find_tool("dumpcap"), "-q", "-i", interface, "-f",
                                     f"({base}) or (vlan and ({base}))", "-s", "65535",
                                     "-a", f"duration:{duration}", "-c", "20000", "-P", "-w", "-"],
                                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        command = [find_tool("tshark"), "-l", "-n", "-r", "-", "--only-protocols",
                   "eth,ethertype,vlan,ip,udp,tcp,igmp,sll", "-o", "ip.defragment:FALSE",
                   "-T", "fields", "-E", "occurrence=f"]
        for field in FIELDS:
            command.extend(["-e", field])
        consumer = subprocess.Popen(command, stdin=producer.stdout, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        producer.stdout.close()
        watchdog = threading.Thread(target=watch, daemon=True)
        watchdog.start()
        while line := consumer.stdout.readline(MAX_LINE + 1):
            if stop.is_set():
                break
            if len(line) > MAX_LINE:
                raise ResearchError("Live row limit exceeded.")
            consume_row(state, profile, line.decode("ascii").rstrip("\r\n"))
        consumer.wait(timeout=5)
        producer.wait(timeout=5)
        state.clear("ended" if consumer.returncode == producer.returncode == 0 else "error")
    except Exception:
        state.clear("error")  # no raw fields, paths or process diagnostics enter logs
    finally:
        done.set()
        terminate()
        if watchdog:
            watchdog.join(timeout=2)
        for process in (consumer, producer):
            if process:
                process.wait(timeout=5)
                if process.stdout:
                    process.stdout.close()


def create_preview_app(state, source=None):
    stop, ready = threading.Event(), threading.Event()

    @asynccontextmanager
    async def lifespan(app):
        def run():
            try:
                source(state, stop, ready)
            except Exception:
                state.clear("error")

        worker = threading.Thread(target=run, daemon=True) if source else None
        if worker:
            worker.start()
        yield
        stop.set()
        ready.set()
        if worker:
            worker.join(timeout=6)
        state.clear("ended")

    app = FastAPI(title="Homunculus experimental preview", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET"], allow_headers=[])

    @app.middleware("http")
    async def local_origin_only(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in ORIGINS:
            return JSONResponse({"error": "Local test origin required"}, status_code=403,
                                headers={"Cache-Control": "no-store"})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/state")
    def get_state():
        ready.set()
        return state.snapshot()

    return app
