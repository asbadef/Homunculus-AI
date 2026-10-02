"""Authenticated, loopback research replay with independent field freshness."""
from __future__ import annotations

import hmac
import math
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .infinity_decoder import NAMES


class MeasurementState:
    def __init__(self, source_ip, profile_id, *, clock=time.monotonic):
        self.source_ip, self.profile_id, self.clock = source_ip, profile_id, clock
        self.lock = threading.RLock()
        self.generation = 0
        self.reset()

    def reset(self):
        with self.lock:
            self.generation += 1
            self.fields, self.seen = {}, set()
            self.last_epoch = self.last_arrival = None
            self.status, self.packets = "waiting", 0
            return self.generation

    def clear(self, status, generation):
        with self.lock:
            if generation == self.generation:
                self.fields.clear()
                self.status = status

    def publish(self, row, generation):
        with self.lock:
            if generation != self.generation:
                return False
            epoch, values = row["epoch"], row["values"]
            if (not math.isfinite(epoch) or epoch <= 0 or not set(values).issubset(NAMES)
                    or any(type(v) is not int or not 0 <= v <= 65535 for v in values.values())):
                self.clear("unsupported", generation)
                return False
            if row["id"] in self.seen or (self.last_epoch is not None and epoch < self.last_epoch):
                return False
            if len(self.seen) >= 20000:
                self.clear("error", generation)
                return False
            arrival = self.clock()
            self.seen.add(row["id"])
            self.packets += 1
            self.last_epoch, self.last_arrival, self.status = epoch, arrival, "streaming"
            for name, value in values.items():
                self.fields[name] = (value, epoch, arrival)
            return True

    def snapshot(self):
        with self.lock:
            now = self.clock()
            fields = {}
            for name in NAMES:
                candidate = self.fields.get(name)
                age = None if candidate is None else max(0, now - candidate[2]) * 1000
                visible = self.status == "streaming" and age is not None and age < 3000
                fields[name] = {"value": candidate[0] if visible else None,
                    "status": "candidate" if visible else "stale" if candidate else "waiting",
                    "age_ms": age, "capture_epoch": candidate[1] if candidate else None,
                    "unit": None, "quality": "unknown"}
            status = self.status
            if status == "streaming":
                available = sum(x["value"] is not None for x in fields.values())
                status = "streaming" if available == 4 else "partial" if available else "stale"
            return {"schema": "homunculus.infinity-preview.v2", "mode": "replay",
                "source_ip": self.source_ip, "profile_id": self.profile_id, "status": status,
                "clinical_ingest_enabled": False, "clinical_mapping_verified": False,
                "clinical_validity": "unknown", "evidence": "capture_correlated",
                "fields": fields, "stale_after_ms": 3000, "capture_epoch": self.last_epoch,
                "packet_age_ms": None if self.last_arrival is None else max(0, now-self.last_arrival)*1000,
                "accepted_packets": self.packets, "replay_cycle": self.generation}


class ReplayController:
    def __init__(self, state, rows):
        self.state, self.rows = state, rows
        self.stop, self.requested = threading.Event(), threading.Event()
        self.lock = threading.Lock()
        self.started = False

    def start(self, *, restart=False):
        with self.lock:
            if restart or not self.started:
                self.state.reset()
                self.started = True
                self.requested.set()

    def run(self):
        while not self.stop.is_set():
            if not self.requested.wait(.05):
                continue
            with self.lock:
                self.requested.clear()
                generation = self.state.generation
            start, first = time.monotonic(), self.rows[0]["epoch"]
            for row in self.rows:
                due = start + row["epoch"] - first
                while time.monotonic() < due and not self.stop.is_set() and generation == self.state.generation:
                    self.stop.wait(min(.05, max(0, due-time.monotonic())))
                if self.stop.is_set() or generation != self.state.generation:
                    break
                self.state.publish(row, generation)
            else:
                self.state.clear("ended", generation)


def create_replay_app(state, rows, viewer_token):
    if not isinstance(viewer_token, str) or len(viewer_token) < 32 or not viewer_token.isascii():
        raise ValueError("Viewer token must be at least 32 ASCII characters.")
    controller = ReplayController(state, rows)

    @asynccontextmanager
    async def lifespan(app):
        thread = threading.Thread(target=controller.run, daemon=True)
        thread.start()
        try:
            yield
        finally:
            controller.stop.set()
            thread.join(timeout=2)
            state.clear("ended", state.generation)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def authorize(request: Request, call_next):
        expected = "Bearer " + viewer_token
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied.encode(), expected.encode()):
            response = JSONResponse({"error": "Viewer authorization required."}, status_code=401)
        else:
            response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/infinity-research/state")
    def snapshot():
        controller.start()
        return state.snapshot()

    @app.post("/infinity-research/restart")
    def restart():
        controller.start(restart=True)
        return {"status": "restarting", "clinical_ingest_enabled": False}

    return app
