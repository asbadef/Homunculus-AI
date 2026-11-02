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
# The monitor repeats its last NBP in every packet as a valid record, and the device's own
# timestamp is not decoded, so a packet's age says nothing about when the cuff measured. What the
# hub can know is when the (systolic, diastolic, mean) triple last CHANGED: a measurement happened
# at or before that packet. That time is an upper bound of the measurement; an identical
# re-measurement is not seen and leaves it older, the safe direction. A change keeps its time only
# when the packet before it that carried a COMPLETE VALID triple is at most NBP_CONTINUITY_S
# older: after a gap (an outage, a monitor off the network, a spell of flagged or partial NBP) it
# may have happened at any moment of the gap, and stamping it with the first packet after the gap
# would make an old measurement read as fresh. Strict on purpose (X46): a flagged record can mean
# "not carried in this message type", so hearing one proves nothing about having watched the
# value; the time shown is never more than NBP_CONTINUITY_S too fresh.
NBP = ("nbp_systolic", "nbp_diastolic", "nbp_mean")
# Its own constant, not STALE_AFTER_MS: that is how long any strip value counts as live; this is
# how much fresher than the truth a shown NBP time may be. 3 s assumes the monitor repeats a
# complete valid triple at least that often. The ward walk (open item O30) may widen it, with
# evidence: the longest gap between complete valid triples seen on a real bed.
NBP_CONTINUITY_S = 3.0


class DeviceState:
    def __init__(self):
        self.parameters = {}
        self.history = {}
        self.last_epoch = None
        self.last_arrival = None
        self.unsupported = False
        self.packets = 0
        # The last complete valid NBP triple, and the receipt time of the packet in which it
        # changed. None until a change has been seen as it happened: after a start, an outage or
        # any gap of more than NBP_CONTINUITY_S between complete valid triples, the next change
        # (and a triple first seen) may be hours old, or another patient's, so its time is unknown.
        # `nbp_valid_at` is the last packet that carried a complete valid triple; flagged and
        # partial NBP packets do not set it.
        self.nbp_triple = None
        self.nbp_changed_at = None
        self.nbp_valid_at = None


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
        self._track_nbp(state, decoded, epoch)

    @staticmethod
    def _track_nbp(state, decoded, epoch):
        """A change of this packet's own complete, valid NBP triple stamps it with the packet's
        receipt time — if the previous complete valid triple arrived at most NBP_CONTINUITY_S
        before it; after any longer gap the change has no time. A packet missing a component, or
        carrying one the device flags invalid, changes nothing at all: it neither counts as a
        change, nor clears the triple held, nor keeps the run unbroken. The first triple seen is
        held with no time."""
        records = [decoded.get(name) for name in NBP]
        if not all(record is not None and record["valid"] for record in records):
            return
        triple = tuple(record["value"] for record in records)
        if state.nbp_triple is not None and triple != state.nbp_triple:
            unbroken = state.nbp_valid_at is not None and epoch - state.nbp_valid_at <= NBP_CONTINUITY_S
            state.nbp_changed_at = epoch if unbroken else None
        state.nbp_triple = triple
        state.nbp_valid_at = epoch

    @staticmethod
    def _nbp_changed_at(state, name, record):
        """The change time an NBP entry may carry: the triple's, and only while the entry still
        holds that triple's component. A newer value a partial packet brought alone has none."""
        if state.nbp_changed_at is None or not record["valid"]:
            return None
        return state.nbp_changed_at if record["value"] == state.nbp_triple[NBP.index(name)] else None

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
                    if name in NBP:
                        # When the value last changed (receipt time), or None: not known.
                        # Describes the held reading; `status` says whether it is current (stale keeps it).
                        parameters[name]["changed_at"] = self._nbp_changed_at(state, name, record)
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
                    # The last complete valid NBP triple held, or None while none has been seen.
                    # It may be older than its entries' readings; their `status` says what is current.
                    "nbp_triple": None if state.nbp_triple is None else list(state.nbp_triple),
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
