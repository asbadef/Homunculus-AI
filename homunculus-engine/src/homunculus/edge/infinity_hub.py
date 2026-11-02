"""Isolated research transport receiver. No imports from clinical ingest or engine."""
from __future__ import annotations

import json
import logging
import math
import os
import queue
import re
import secrets
import threading
import time
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from .infinity_journal import CapacityError, ConflictError
from .infinity_stream import MAX_BATCH, MAX_REQUEST, UnknownDevice, validate_event
from .infinity_timing import WORKER_NAMES, Timings, valid_snapshot
from .infinity_waves import MAX_QUERY_DEVICES, SCHEMA as WAVES_SCHEMA, iso_z

MAX_PENDING_BATCHES = 64   # acknowledged batches the wave decoder may hold back; at a worker's rate
                           # (≈13 beds, ≈5 POSTs/s) that is seconds of backlog. Memory: each is one
                           # parsed batch, up to MAX_REQUEST (3 MB) of it, so 64 × 3 MB = 192 MB at the
                           # very worst while the decoder stalls, ≈64 × 100 KB ≈ 6 MB for the ward's
                           # POSTs — bounded, and visible as `dropped` once the bound is hit. A batch
                           # older than MAX_TRANSPORT_DELAY (3 s) is not dropped but REFUSED by the
                           # buffer at decode time (WaveBuffer.consume), so a backlog of more than 3 s
                           # shows as waves.refused climbing WITH waves.queued > 0: a starved decoder,
                           # not a worker clock ahead of the hub's. Dropping the oldest batch of a full
                           # queue therefore loses nothing still servable.


PAGE = """<!doctype html><html lang="tr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Homunculus · Infinity bağlantıları</title>
<style>
body{font:16px system-ui;background:#101923;color:#edf3f8;margin:0;padding:32px;max-width:1250px}
h1{font-size:26px}p{color:#bdcad5;line-height:1.6}input,button{font:inherit;padding:10px;border-radius:6px;margin:4px}
button{background:#9cd6c5;border:0;cursor:pointer}table{border-collapse:collapse;width:100%;margin-top:24px}
th,td{text-align:left;padding:12px;border-bottom:1px solid #334451}th{color:#a7becd}
.notice{border-left:4px solid #e7b664;padding:8px 18px;background:#222d38}
#error{color:#ffbcaf}small{color:#a7becd}section{overflow:auto}
</style><h1>Infinity bağlantıları</h1>
<p class="notice">Araştırma görünümü. Paket alınması, ölçümün çözüldüğü anlamına gelmez.
HR, SpO₂ ve ECG henüz doğrulanmış değil; bu sayfa klinik izleme veya alarm ekranı değildir.</p>
<form id="login"><label>Görüntüleme anahtarı <input id="token" type="password" autocomplete="off" required></label>
<button>Bağlantıları göster</button><button id="logout" type="button">Kapat</button></form>
<p id="overview">Veri bekleniyor.</p><p id="error" role="alert"></p>
<section><table><thead><tr><th>Cihaz</th><th>Kaynak</th><th>Paket durumu</th><th>Son paket yaşı</th>
<th>Paket sayısı</th><th>Ölçüm</th></tr></thead><tbody id="devices"></tbody></table></section>
<p><small>Eski kayıtlar “Kayıt tekrarı” olarak gösterilir. Sayaçlar taşıma olaylarını sayar;
cihazın ölçüm sıklığı veya ağda kaybolan paket sayısı değildir.</small></p>
<script src="/app.js"></script></html>"""

JS = """let key='', timer=null, generation=0;
const el=id=>document.getElementById(id);
function clear(){key='';generation++;clearTimeout(timer);el('devices').replaceChildren();el('overview').textContent='Bağlantı kapalı.';el('token').value='';}
el('logout').onclick=clear;
el('login').onsubmit=e=>{e.preventDefault();clearTimeout(timer);generation++;key=el('token').value;el('token').value='';poll(generation);};
async function poll(g){try{
 const r=await fetch('/v1/status',{headers:{Authorization:'Bearer '+key},cache:'no-store'});
 if(!r.ok)throw Error(r.status===401?'Görüntüleme anahtarı geçersiz.':'Alıcıya ulaşılamadı.');
 const s=await r.json();if(g!==generation)return;
 el('error').textContent='';el('devices').replaceChildren();
 const states={waiting:'Paket bekleniyor',streaming:'Paket geliyor',stale:'Paket akışı eski',replay:'Kayıt tekrarı',clock_error:'Saat farkı'};
 for(const d of s.devices){const tr=document.createElement('tr');
  for(const v of [d.id,d.source_ip,states[d.status]||d.status,d.packet_age_seconds===null?'—':d.packet_age_seconds.toFixed(1)+' sn',d.packets,'Çözümleme doğrulanmadı']){
   const td=document.createElement('td');td.textContent=v;tr.append(td);}el('devices').append(tr);}
 const q=s.collector.heartbeat?.queue;
 el('overview').textContent=s.devices.length+' cihaz · Toplayıcı: '+(s.collector.connected?'erişilebilir':'kalp atışı yok/eski')+
  ' · Bekleyen: '+(q?.rows??'bilinmiyor')+' · Kapasite nedeniyle alınamayan: '+(q?.counters?.queue_full_dropped??0)+
  ' · Süresi dolan: '+(q?.counters?.expired??0)+' · Aktarım hatası: '+(q?.counters?.forward_errors??0)+
  (s.waves?' · Dalga: imleç '+s.waves.cursor+' · reddedilen '+s.waves.refused+' · atılan '+s.waves.dropped+' · canlı '+(s.waves.alive?'evet':'HAYIR'):'');
 }catch(e){if(g!==generation)return;el('error').textContent=e.message;el('devices').replaceChildren();el('overview').textContent='Güncel durum doğrulanamıyor.';}
 if(g===generation&&key)timer=setTimeout(()=>poll(g),2000);
}
"""


CURSOR = re.compile(r"[0-9]{1,15}")
log = logging.getLogger(__name__)


class WaveDecoder:
    """The one thread between `/v1/packets` and the WaveBuffer (dalga-perf).

    The handler used to decode on the event loop, after the ack was computed and before it was
    sent: ≈2 ms a POST on the ward's hub, and every reader of the buffer made that wait on the lock
    too. Now the handler hands the acknowledged batch over in O(1) and returns; this thread decodes
    it and times the decode as waves_ms. The queue is bounded: when it is full the OLDEST waiting
    batch is dropped and counted (`dropped`), so the handler never blocks and never raises. A batch
    the buffer raises on is handed to `failed` (I4: the ack stood before the batch got here) and
    the thread goes on to the next. `start` in the app's lifespan, `close` at its end: what is still
    queued is dropped, not flushed; the ring dies with the process anyway. The thread ends for no
    exception but SystemExit/KeyboardInterrupt (review M1): one raised outside `consume` — by
    `failed` itself, by the timings — is counted the same way and the loop goes on, and `alive`
    tells /v1/status whether it is still running."""

    def __init__(self, waves, timings, failed, *, limit=MAX_PENDING_BATCHES):
        self.waves, self.timings, self.failed = waves, timings, failed
        self.pending = queue.Queue(limit)
        self.dropped = 0
        self.lock = threading.Lock()        # M5: one producer at a time through `submit`'s drop-then-put
        self.hook_broken = set()            # M1: error types `failed` itself raised, logged once each
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self._run, name="infinity-wave-decoder", daemon=True)

    @property
    def queued(self) -> int:
        return self.pending.qsize()

    @property
    def alive(self) -> bool:
        return self.thread.is_alive()

    def submit(self, events) -> None:
        """Queue one acknowledged batch: O(1), never blocks, never raises. A full queue drops its
        oldest batch first. The drop and the put are one step under `lock` (M5): the handler submits
        from the event loop and `close` puts its sentinel, and a second producer slipping into the slot
        the drop freed would have cost one batch more than the bound asked for. The decoder thread
        only takes, so the slot freed under the lock is ours."""
        with self.lock:
            try:
                self.pending.put_nowait(events)
            except queue.Full:
                try:
                    self.pending.get_nowait()
                except queue.Empty:
                    pass                                    # the decoder drained it meanwhile: room now
                else:
                    self.pending.task_done()
                    self.dropped += 1
                self.pending.put_nowait(events)

    def start(self) -> None:
        if self.thread.is_alive():
            # A `close` that timed out: the thread is still inside `consume` (a lock never released,
            # a hook that hangs). A second consumer beside it would race it on the buffer, and a
            # thread that did not answer in `close`'s timeout is not one to hand the queue back to.
            raise RuntimeError("the wave decoder's previous thread is still running")
        if self.thread.ident is not None:
            # The lifespan ran before (a test client entered the same app twice): a thread runs once,
            # so a fresh one, and an empty queue — the old sentinel and what `close` dropped go with it.
            while True:
                try:
                    self.pending.get_nowait()
                except queue.Empty:
                    break
                self.pending.task_done()
            self.stopping = threading.Event()
            self.thread = threading.Thread(target=self._run, name=self.thread.name, daemon=True)
        self.thread.start()

    def close(self, timeout=5.0) -> None:
        """Stop the thread: what it is decoding finishes, what is queued is dropped."""
        self.stopping.set()
        # The sentinel wakes a `get` that is waiting on an empty queue. It takes its own path, not
        # `submit` (M3): on a full queue `submit` would drop a real batch and count it to make room
        # for a sentinel nobody needs — a full queue has no `get` to wake, and `stopping` is checked
        # before every `get`, so the thread ends on its own at the next batch boundary.
        with self.lock:
            try:
                self.pending.put_nowait(None)
            except queue.Full:
                pass
        self.thread.join(timeout)

    def settle(self, timeout=5.0) -> None:
        """Wait until every queued batch has been decoded (tests; the handler never waits). Bounded:
        RuntimeError at once when no thread drains the queue — the lifespan never ran (a TestClient
        used without `with`) or `close` ended it — and at `timeout` when the thread is stuck; a bare
        `queue.join()` would wait forever in either case."""
        if not self.thread.is_alive():
            raise RuntimeError("the wave decoder is not running")
        deadline = time.monotonic() + timeout
        with self.pending.all_tasks_done:
            while self.pending.unfinished_tasks:
                if not self.thread.is_alive():
                    raise RuntimeError("the wave decoder is not running")
                left = deadline - time.monotonic()
                if left <= 0:
                    raise RuntimeError(f"the wave decoder did not settle within {timeout} s "
                                       f"({self.pending.unfinished_tasks} batches pending)")
                self.pending.all_tasks_done.wait(min(left, 0.05))

    def _run(self) -> None:
        while not self.stopping.is_set():
            events = self.pending.get()
            try:
                if events is None or self.stopping.is_set():
                    break
                decoding = self.timings.clock()
                try:
                    self.waves.consume(events)
                except Exception as error:
                    self.failed(error)
                else:
                    self.timings.since("waves_ms", decoding)
            except Exception as error:
                # M1: an exception outside the guarded `consume` — `failed` raising, the timings —
                # used to end the thread with nothing to say so: `queued` pinned at the bound and
                # `dropped` climbing, the waves dark. Only SystemExit/KeyboardInterrupt end the loop.
                self._survive(error)
            finally:
                self.pending.task_done()

    def _survive(self, error) -> None:
        """Count an error the loop body leaked through `failed`, the hook that counts decode errors.
        When `failed` is what raises, it is logged here instead — once per error type, by type and
        code location only: an exception's own message may quote the payload — and the loop goes on."""
        try:
            self.failed(error)
        except Exception as again:
            kind = type(again)
            if kind in self.hook_broken:
                return
            self.hook_broken.add(kind)
            frames = traceback.extract_tb(again.__traceback__)
            where = f"{os.path.basename(frames[-1].filename)}:{frames[-1].lineno} in {frames[-1].name}" if frames else "?"
            log.error("Infinity hub: the wave decoder's error hook raised %s at %s; the thread goes on, "
                      "uncounted (logged once per error type).", kind.__name__, where)


def create_hub(inventory, journal, collector_token, viewer_token, *, accept_payload=False, clock=time.time,
               research_view=None, timings=None, waves=None):
    if min(len(collector_token), len(viewer_token)) < 32 or collector_token == viewer_token:
        raise ValueError("Use distinct collector and viewer tokens of at least 32 characters.")
    if research_view is not None and not accept_payload:
        raise ValueError("Research decoding requires explicit payload acceptance.")
    if waves is not None and not accept_payload:
        raise ValueError("Waveform decoding requires explicit payload acceptance.")
    # One value per hub process (named hub_started because the handlers' own `started` is a timing
    # start). The wave cursor counts from 0 in every process, so a reader that holds a cursor compares
    # this with the one it saw: a different value is a restarted hub and its cursor means nothing.
    hub_started = iso_z(clock()) if waves is not None else None
    # Pass the journal's own Timings here too, and /v1/status shows the whole handler,
    # the journal's phases included, under one key.
    timings = timings or Timings()
    heartbeat = {"seen": None, "value": None}
    lock = threading.Lock()
    # I4: the live view and the WaveBuffer read a batch the journal already holds, for display only.
    # One that raises must not turn the batch into a 500: the worker would resend it until its events
    # were over 3 s old, every packet behind it would arrive old too, and the strip and Aşama B's
    # shadow lane would go stale over a display bug. So the ack stands, the error is counted under
    # /v1/status, and it is logged once per hook and error type, by type and code location only:
    # an exception's own message may quote the payload. The research hook fails on the event loop
    # and the waves hook on the decoder thread (dalga-perf): the counters and the check-then-add on
    # the logged set are under one lock, so no count is lost and no type is logged twice.
    hook_errors = {"research": 0, "waves": 0}
    hook_logged = set()
    hook_lock = threading.Lock()

    def hook_failed(hook, error):
        kind = type(error)
        with hook_lock:
            hook_errors[hook] += 1
            if (hook, kind) in hook_logged:
                return
            hook_logged.add((hook, kind))
        frames = traceback.extract_tb(error.__traceback__)
        where = f"{os.path.basename(frames[-1].filename)}:{frames[-1].lineno} in {frames[-1].name}" if frames else "?"
        log.error("Infinity hub: the %s hook raised %s at %s; the batch stays acknowledged, counted under "
                  "/v1/status %s.errors (logged once per error type).", hook, kind.__name__, where, hook)

    # dalga-perf: the wave decode leaves the event loop. The decoder thread lives as long as the app
    # does (uvicorn runs the lifespan; so does `with TestClient(app)`), and nothing is flushed at the
    # end: the ring is display-only memory that dies with the process.
    decoder = WaveDecoder(waves, timings, lambda error: hook_failed("waves", error)) if waves is not None else None

    @asynccontextmanager
    async def lifespan(app):
        if decoder is not None:
            decoder.start()
        try:
            yield
        finally:
            if decoder is not None:
                decoder.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.wave_decoder = decoder

    def collector_age():
        with lock:
            seen = heartbeat["seen"]
        return None if seen is None else max(0.0, clock() - seen)

    # Aşama A's forwarder reads how long ago the collector last spoke, so the board can say "the
    # collector is not connected" instead of "13 monitors silent". Read-only; no answer changes.
    app.state.collector_age = collector_age

    @app.middleware("http")
    async def response_headers(request, call_next):
        response = await call_next(request)
        response.headers.update({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                 "Referrer-Policy": "no-referrer",
                                 "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
        return response

    def auth(request, token):
        provided = request.headers.get("authorization", "")
        if not secrets.compare_digest(provided.encode(), ("Bearer " + token).encode()):
            raise HTTPException(401, "Authentication required.")

    async def body(request, limit=MAX_REQUEST):
        chunks = bytearray()
        async for chunk in request.stream():
            if len(chunks) + len(chunk) > limit:
                raise HTTPException(413, "Request too large.")
            chunks.extend(chunk)
        try:
            return json.loads(chunks)
        except (ValueError, RecursionError):
            raise HTTPException(400, "Invalid JSON.") from None

    @app.get("/", response_class=HTMLResponse)
    def page():
        return PAGE

    @app.get("/app.js")
    def script():
        return Response(JS, media_type="application/javascript")

    @app.post("/v1/packets")
    async def packets(request: Request):
        started = timings.clock()
        auth(request, collector_token)
        data = await body(request)
        timings.since("body_ms", started)
        validating = timings.clock()
        not_now = False
        try:
            if not isinstance(data, dict) or set(data) != {"events"} or not isinstance(data["events"], list) or not 1 <= len(data["events"]) <= MAX_BATCH:
                raise ValueError
            for event in data["events"]:
                try:
                    validate_event(event, inventory, match_name=False)
                except UnknownDevice:
                    not_now = True
                    continue
                if event["received_at"] > clock() + 5 or (event["payload_base64"] is not None and not accept_payload):
                    not_now = True
        except (ValueError, TypeError):
            raise HTTPException(400, "Rejected event.") from None
        if not_now:
            # Well-formed, but not acceptable here yet: an address this inventory does not list,
            # a clock ahead of the hub's, or a payload this hub does not take. 400 would be final
            # and the worker would set the whole batch aside, every good event with it; 503 is
            # retried until the inventory, the clock or the configuration is put right.
            raise HTTPException(503, "Not accepted yet: unknown device address, clock ahead or payload policy.")
        timings.since("validate_ms", validating)
        try:
            ack = journal.append(data["events"], update_devices=True, device_ids=[
                inventory.lookup(e["source_ip"], e["group"], e["port"]).id for e in data["events"]])
        except CapacityError:
            raise HTTPException(507, "Archive capacity reached; delivery not acknowledged.") from None
        except ConflictError:
            raise HTTPException(409, "Conflicting event ID.") from None
        now = clock()
        for event in data["events"]:
            # How far behind the hub's clock a live packet arrives: the number the 3 s live
            # window judges. A replay carries its capture time, which is not a delay.
            if event["mode"] == "live":
                timings.add("lag_ms", (now - event["received_at"]) * 1000)
        # From here on the batch is acknowledged whatever the display hooks do (I4, hook_failed). A hook
        # that raised is not timed.
        if research_view is not None:
            consuming = timings.clock()
            try:
                research_view.consume(data["events"])
            except Exception as error:
                hook_failed("research", error)
            else:
                timings.since("consume_ms", consuming)
        if decoder is not None:
            # Lane C (dalga): the wave blocks of the same acknowledged events, for display only. Not
            # decoded here (dalga-perf): the decoder thread does that and times it as waves_ms, so
            # packets_ms is the handler alone. The batch is not touched again after this line.
            decoder.submit(data["events"])
        timings.add("batch_events", len(data["events"]))
        timings.since("packets_ms", started)
        return {"ack": ack, "clinical_forwarding": False}

    @app.get("/infinity-research/state")
    def research_state(request: Request):
        auth(request, viewer_token)
        if research_view is None:
            raise HTTPException(409, "Continuous research decoding is not enabled.")
        return research_view.snapshot()

    @app.get("/infinity-research/waves")
    def research_waves(request: Request):
        """Lane C (dalga): the last seconds of wave blocks of 1 to 16 monitors, named by address,
        after one hub-wide cursor. Display only; unvalidated; nothing here reads the journal."""
        started = timings.clock()
        auth(request, viewer_token)
        if waves is None:
            raise HTTPException(409, "Waveform decoding is not enabled.")
        names = request.query_params.getlist("device")
        since = request.query_params.get("since", "0")
        if (not 1 <= len(names) <= MAX_QUERY_DEVICES or len(set(names)) != len(names)
                or not CURSOR.fullmatch(since)):
            raise HTTPException(400, "Name 1 to 16 distinct devices, and a cursor.")
        if not all(waves.knows(name) for name in names):
            raise HTTPException(404, "Unknown device.")
        # waves_lock_ms is the part of waves_read_ms spent inside the buffer lock, which /v1/packets'
        # decoder waits on: dalga-perf moved the answer's building out of it, and this shows by how much.
        cursor, found = waves.since(names, int(since), timings=timings)
        now = iso_z(clock())
        timings.since("waves_read_ms", started)
        # JSONResponse, not a bare dict: FastAPI would run its encoder on the event loop, where it
        # blocks /v1/packets (a wall poll of 16 devices was measured at ~300 ms); this way
        # json.dumps runs here, on the threadpool thread.
        if len(names) == 1:
            return JSONResponse({"schema": WAVES_SCHEMA, "device_id": names[0], "cursor": cursor, "hub_now": now,
                                 "started": hub_started, "blocks": found[names[0]]})
        return JSONResponse({"schema": WAVES_SCHEMA, "cursor": cursor, "hub_now": now, "started": hub_started,
                             "devices": {name: {"blocks": found[name]} for name in names}})

    @app.post("/infinity-research/restart")
    def no_live_restart(request: Request):
        auth(request, viewer_token)
        raise HTTPException(409, "Continuous live data cannot be replayed.")

    @app.post("/v1/heartbeat")
    async def update_heartbeat(request: Request):
        auth(request, collector_token)
        data = await body(request, 8192)
        try:
            # `timings` is optional: a worker that predates it keeps its heartbeat accepted.
            # A worker that sends it needs this hub first (deploy hub first, worker second).
            if (not isinstance(data, dict)
                    or set(data) - {"timings"} != {"collector_id", "mode", "queue", "clinical_forwarding"}
                    or data["collector_id"] != inventory.collector_id or data["mode"] not in ("live", "replay")
                    or data["clinical_forwarding"] is not False
                    or ("timings" in data and not valid_snapshot(data["timings"], WORKER_NAMES))):
                raise ValueError
            queue = data["queue"]
            if set(queue) != {"rows", "encrypted_bytes", "oldest_age_seconds", "counters", "retention_seconds"}:
                raise ValueError
            for key in ("rows", "encrypted_bytes", "retention_seconds"):
                if type(queue[key]) is not int or not 0 <= queue[key] <= 10**12:
                    raise ValueError
            age = queue["oldest_age_seconds"]
            if age is not None and (type(age) not in (float, int) or not math.isfinite(age) or not 0 <= age <= 10**12):
                raise ValueError
            counters = queue["counters"]
            # The membership_refresh_* names carry the collector's rejoin activity. A hub
            # must learn them BEFORE a worker that sends them, or the whole heartbeat is
            # rejected as malformed: deploy hub first, worker second.
            if (not isinstance(counters, dict) or not set(counters).issubset({"accepted", "expired", "forward_errors", "queue_full_dropped", "rejected_datagrams", "membership_refresh_scheduled", "membership_refresh_silence", "membership_refresh_failed", "quarantined"})
                    or any(type(v) is not int or not 0 <= v <= 10**12 for v in counters.values())):
                raise ValueError
        except (ValueError, TypeError, KeyError):
            raise HTTPException(400, "Invalid heartbeat.") from None
        with lock:
            heartbeat.update(seen=clock(), value=data)
        return {"ok": True}

    @app.get("/v1/status")
    def status(request: Request):
        started = timings.clock()
        auth(request, viewer_token)
        states = journal.device_states()
        devices = []
        for device in inventory.devices:
            state = states.get(device.id, {})
            stamp = state.get("last_packet_at")
            age = None if stamp is None else clock() - stamp
            label = "waiting" if age is None else ("replay" if state.get("mode") == "replay" else
                    "clock_error" if age < 0 else "stale" if age > 5 else "streaming")
            devices.append({"id": device.id, "source_ip": device.source, "group": device.group,
                            "status": label, "packet_age_seconds": age, "packets": state.get("packets", 0),
                            "last_packet_at": stamp, "last_payload_bytes": state.get("last_payload_bytes"),
                            "measurement_status": "unverified", "measurements": {}})
        with lock:
            collector = {"id": inventory.collector_id, "connected": heartbeat["seen"] is not None and 0 <= clock()-heartbeat["seen"] <= 15,
                         "heartbeat": heartbeat["value"]}
        archive = journal.snapshot()
        timings.since("status_ms", started)
        answer = {"devices": devices, "collector": collector, "archive": archive,
                  "clinical_forwarding": False, "kernel_drop_count": None, "timings": timings.snapshot()}
        if research_view is not None:
            # I4: batches the live view raised on; each was acknowledged all the same.
            answer["research"] = {"errors": hook_errors["research"]}
        if waves is not None:
            # Lane C (dalga): what the buffer holds back, readable without asking for waves. `refused`
            # counts events the buffer turned away (not live, older than 3 s, ahead of the hub's clock):
            # a worker clock a few hundred ms fast would otherwise black out every wave silently.
            # `errors` counts batches the buffer raised on (I4), acknowledged all the same. `dropped`
            # counts acknowledged batches the decoder thread never got to (its queue was full), and
            # `queued` is its backlog now (dalga-perf): a starved decoder shows here before it shows
            # as a stalled trace. `alive` is the decoder thread itself (M1): a dead one would show as
            # `queued` pinned at the bound and `dropped` climbing, and nothing would say why.
            answer["waves"] = {"cursor": waves.cursor, "refused": waves.refused, "started": hub_started,
                               "errors": hook_errors["waves"], "dropped": decoder.dropped, "queued": decoder.queued,
                               "alive": decoder.alive}
        return answer

    return app
