"""Continuous, opt-in research view over committed transport events, one entry per device.

Reading is by parameter record (see `infinity_records`), so no per-device profile is loaded
and a bed whose modules change does not silently start reporting the wrong field. Every
device in the inventory gets its own state; a payload that carries no records — a monitor in
standby transmits at full rate and carries none — is reported as such rather than as silence,
because "the bed is not being monitored" and "we are not receiving" need different answers.

No patient association, clinical ingest, alarm action or waveform interpretation. The alarm
limits carried in the records are the device's own settings, reported as context, not acted on.
"""
from __future__ import annotations

import base64
import threading
import time

from .infinity_records import parse_payload

SCHEMA = "homunculus.infinity-preview.v3"
STALE_AFTER_MS = 3000.0
# A record that took this long to arrive is not a live measurement whatever its contents:
# the outbox retries, so an old row must never be presented as the bed's current state.
MAX_TRANSPORT_DELAY = 3.0
# A short trend, kept here rather than accumulated in the browser so that a screen opened
# now shows the last few minutes instead of an empty graph that fills as you watch. One
# sample a second is plenty: the device sends five, and a displayed vital does not move
# faster than the eye reads it.
HISTORY_SECONDS = 180.0
HISTORY_INTERVAL = 1.0


class DeviceState:
    def __init__(self):
        self.parameters = {}
        self.history = {}
        self.last_epoch = None
        self.last_arrival = None
        self.unsupported = False
        self.packets = 0


class LiveResearchView:
    def __init__(self, inventory, *, clock=time.time, monotonic=time.monotonic):
        self.inventory = inventory
        self.clock, self.monotonic = clock, monotonic
        self.lock = threading.RLock()
        self.devices = {device.id: DeviceState() for device in inventory.devices}
        self.by_source = {device.source: device.id for device in inventory.devices}
        self.accepted = self.rejected = self.old_packets = 0

    def consume(self, events):
        with self.lock:
            for event in events:
                self._consume_one(event)

    def _consume_one(self, event):
        state = self.devices.get(self.by_source.get(event.get("source_ip")))
        if state is None:
            return
        epoch, now = event["received_at"], self.clock()
        # A retried outbox record, or one this device has already delivered, must never
        # become a new live measurement.
        if now - epoch >= MAX_TRANSPORT_DELAY or (state.last_epoch is not None and epoch <= state.last_epoch):
            self.old_packets += 1
            return
        if epoch > now or event.get("mode") != "live":
            state.parameters.clear()
            state.unsupported = True
            self.rejected += 1
            return
        payload = event.get("payload_base64")
        if payload is None:
            self.rejected += 1
            return
        try:
            decoded = parse_payload(base64.b64decode(payload, validate=True))
        except (ValueError, TypeError):
            state.parameters.clear()
            state.unsupported = True
            self.rejected += 1
            return
        state.last_epoch, state.last_arrival = epoch, self.monotonic()
        state.packets += 1
        self.accepted += 1
        state.unsupported = False
        for name, record in decoded.items():
            # Keep a usable reading rather than letting the device's own "no value right
            # now" overwrite it inside the freshness window; staleness still expires it.
            held = state.parameters.get(name)
            if held is not None and held["valid"] and not record["valid"]:
                continue
            state.parameters[name] = dict(record, epoch=epoch, arrival=state.last_arrival,
                                          delay=now - epoch)
            if record["valid"]:
                self._remember(state, name, epoch, record["value"])

    def _remember(self, state, name, epoch, value):
        samples = state.history.setdefault(name, [])
        if samples and epoch - samples[-1][0] < HISTORY_INTERVAL:
            return
        samples.append((epoch, value))
        cutoff = epoch - HISTORY_SECONDS
        while samples and samples[0][0] < cutoff:
            samples.pop(0)

    def _age_ms(self, record, now, tick):
        # Retain the initial transport delay, and use monotonic time so that a backward
        # hub clock adjustment cannot extend a value's validity window.
        return max(0.0, now - record["epoch"], tick - record["arrival"] + record["delay"]) * 1000

    def snapshot(self):
        with self.lock:
            now, tick = self.clock(), self.monotonic()
            devices = []
            for device in self.inventory.devices:
                state = self.devices[device.id]
                parameters = {}
                for name, record in state.parameters.items():
                    age = self._age_ms(record, now, tick)
                    fresh = age < STALE_AFTER_MS
                    parameters[name] = {
                        "value": record["value"] if (fresh and record["valid"]) else None,
                        "status": ("candidate" if record["valid"] else "device_reports_invalid")
                                  if fresh else "stale",
                        "unit": record["unit"],
                        "age_ms": age,
                        "alarm_low": record["alarm_low"],
                        "alarm_high": record["alarm_high"],
                        "evidence": record["evidence"],
                        "capture_epoch": record["epoch"],
                        # Trend only; a point here was valid when recorded and is not
                        # re-judged for freshness. The current reading is `value`.
                        "history": [[stamp, sample] for stamp, sample
                                    in state.history.get(name, ())],
                    }
                # The device's status follows its parameters, not its last packet. A bed
                # interleaves waveform-shaped payloads that carry no records, so judging by
                # the most recent packet makes a fully reporting device flicker into
                # "no parameters" between readings.
                packet_age = (None if state.last_epoch is None else
                              max(0.0, now - state.last_epoch, tick - state.last_arrival) * 1000)
                if state.unsupported:
                    status = "unsupported"
                elif packet_age is None:
                    status = "waiting"
                elif packet_age >= STALE_AFTER_MS:
                    status = "stale"
                elif any(p["status"] != "stale" for p in parameters.values()):
                    status = "streaming"
                else:
                    status = "no_parameters"
                devices.append({
                    "device_id": device.id, "source_ip": device.source, "group": device.group,
                    "status": status, "packets": state.packets,
                    "packet_age_ms": packet_age,
                    "parameters": parameters,
                })
            return {
                "schema": SCHEMA, "mode": "live", "evidence": "record_decoded",
                "clinical_ingest_enabled": False, "clinical_mapping_verified": False,
                "clinical_validity": "unknown", "stale_after_ms": STALE_AFTER_MS,
                "history_seconds": HISTORY_SECONDS,
                "accepted_packets": self.accepted, "rejected_packets": self.rejected,
                "old_or_duplicate_packets": self.old_packets, "replay_cycle": None,
                "devices": devices,
            }
