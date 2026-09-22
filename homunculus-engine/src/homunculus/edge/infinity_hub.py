"""Isolated research transport receiver. No imports from clinical ingest or engine."""
from __future__ import annotations

import json
import math
import secrets
import threading
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response

from .infinity_journal import CapacityError, ConflictError
from .infinity_stream import MAX_BATCH, MAX_REQUEST, validate_event


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
  ' · Süresi dolan: '+(q?.counters?.expired??0)+' · Aktarım hatası: '+(q?.counters?.forward_errors??0);
 }catch(e){if(g!==generation)return;el('error').textContent=e.message;el('devices').replaceChildren();el('overview').textContent='Güncel durum doğrulanamıyor.';}
 if(g===generation&&key)timer=setTimeout(()=>poll(g),2000);
}
"""


def create_hub(inventory, journal, collector_token, viewer_token, *, accept_payload=False, clock=time.time,
               research_view=None):
    if min(len(collector_token), len(viewer_token)) < 32 or collector_token == viewer_token:
        raise ValueError("Use distinct collector and viewer tokens of at least 32 characters.")
    if research_view is not None and not accept_payload:
        raise ValueError("Research decoding requires explicit payload acceptance.")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    heartbeat = {"seen": None, "value": None}
    lock = threading.Lock()

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
        auth(request, collector_token)
        data = await body(request)
        try:
            if not isinstance(data, dict) or set(data) != {"events"} or not isinstance(data["events"], list) or not 1 <= len(data["events"]) <= MAX_BATCH:
                raise ValueError
            for event in data["events"]:
                validate_event(event, inventory)
                if event["received_at"] > clock() + 5 or (event["payload_base64"] is not None and not accept_payload):
                    raise ValueError
        except (ValueError, TypeError):
            raise HTTPException(400, "Rejected event, clock or payload policy.") from None
        try:
            ack = journal.append(data["events"], update_devices=True)
        except CapacityError:
            raise HTTPException(507, "Archive capacity reached; delivery not acknowledged.") from None
        except ConflictError:
            raise HTTPException(409, "Conflicting event ID.") from None
        if research_view is not None:
            research_view.consume(data["events"])
        return {"ack": ack, "clinical_forwarding": False}

    @app.get("/infinity-research/state")
    def research_state(request: Request):
        auth(request, viewer_token)
        if research_view is None:
            raise HTTPException(409, "Continuous research decoding is not enabled.")
        return research_view.snapshot()

    @app.post("/infinity-research/restart")
    def no_live_restart(request: Request):
        auth(request, viewer_token)
        raise HTTPException(409, "Continuous live data cannot be replayed.")

    @app.post("/v1/heartbeat")
    async def update_heartbeat(request: Request):
        auth(request, collector_token)
        data = await body(request, 8192)
        try:
            if (not isinstance(data, dict) or set(data) != {"collector_id", "mode", "queue", "clinical_forwarding"}
                    or data["collector_id"] != inventory.collector_id or data["mode"] not in ("live", "replay")
                    or data["clinical_forwarding"] is not False):
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
            if (not isinstance(counters, dict) or not set(counters).issubset({"accepted", "expired", "forward_errors", "queue_full_dropped", "rejected_datagrams", "membership_refresh_scheduled", "membership_refresh_silence", "membership_refresh_failed"})
                    or any(type(v) is not int or not 0 <= v <= 10**12 for v in counters.values())):
                raise ValueError
        except (ValueError, TypeError, KeyError):
            raise HTTPException(400, "Invalid heartbeat.") from None
        with lock:
            heartbeat.update(seen=clock(), value=data)
        return {"ok": True}

    @app.get("/v1/status")
    def status(request: Request):
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
        return {"devices": devices, "collector": collector, "archive": journal.snapshot(),
                "clinical_forwarding": False, "kernel_drop_count": None}

    return app
