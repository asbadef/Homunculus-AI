# Homunculus MEDIBUS köprüsü / MEDIBUS serial bridge

Dräger **ventilatör ve anestezi cihazlarından** (Evita, Evita 2 dura, Evita 4, Savina, Evita XL,
V500, Fabius, Primus, Perseus…) RS-232 MEDIBUS protokolüyle ölçüm verisi okuyup Homunculus
motoruna FHIR gözlemi olarak ileten, tek başına çalışan küçük bir paket. Sadece **okur**: ayar
değiştirmez, alarm susturmaz.

> **Önemli — Kappa monitörler MEDIBUS konuşmaz.** Infinity Kappa/Delta başucu monitörlerinin
> seri vital çıkışı ayrı bir protokoldür (*Infinity RS-232 Export Protocol*, Dräger doküman
> MS28819, X5 konektörü, kablo 5206441). Bu köprü onlara takılırsa hiçbir şey olmaz. MEDIBUS,
> yoğun bakımdaki **ventilatörlerin** arka COM portu içindir.

---

## Hızlı başlangıç (TR)

**1. USB belleğe koy.** Bu klasörün tamamı (`medibus/`) + `homunculus-engine/src/homunculus/`
(köprü onu yan klasörde arar) + Python 3.12 kurulumu + çevrimdışı pyserial wheel'i
(`pip download pyserial` ile indir, sahada `pip install pyserial-*.whl`).

**2. Adaptörü test et — ventilatöre dokunmadan.** USB-seri adaptörün DB-9 ucunda 2 ile 3 numaralı
pinleri bir ataşla köprüle, sonra:

```text
python scripts/loopback_check.py COM3
```

`LOOPBACK TAMAM` görmeden ventilatöre gitme; sorun adaptör/sürücü/COM numarasındadır.

**3. Biyomedikal onayı.** Ventilatörün COM portuna kablo takmak biyomedikalin işidir. Onlardan:
ventilatörde MEDIBUS'un o port için seçili olması (menüden), baud/parity ayarı (fabrika: 19200,
8, even), ve **null-modem** (2-3 çapraz) kablo. Tek yatakla başla.

**4. Sadece dinle.** Kabloyu tak, hiçbir şey gönderme:

```text
python scripts/loopback_check.py COM3 --device
```

Ventilatör MEDIBUS'a ayarlıysa kendi başına her 3 saniyede ICC gönderir; `CİHAZ KONUŞUYOR`
yazarsa baud/parity doğrudur.

**5. Keşif modu.** Cihazın hangi kodları gönderdiğini gör, hiçbir veri iletilmez:

```text
python -m medibus.run --port COM3 --db medibus.db
```

Log'da `eşlenmemiş MEDIBUS kodları: cp1:EB x12 format=dd; ...` satırı çıkar. Değer yazmaz,
sadece kod ve biçim.

**6. Eşleme dosyası.** `medibus-mapping.example.json`'ı kopyala, keşif raporunda *gerçekten
görünen* kodları bırak, gerisini sil.

**7. Üretim.**

```text
python -m medibus.run --port COM3 --patient-id <takma-kimlik> --bed Y3 ^
    --mapping medibus-mapping.json --db medibus.db ^
    --cloud-url http://sunucu:8000 --token <kiracı-token>
```

`--patient-id` zorunlu: MEDIBUS hasta kimliği taşımaz, operatör verir. Gözlemler önce SQLite'a
yazılır, bağlantı yokken birikir, gelince gönderilir.

**Donanım yokken deneme:** `python -m medibus.run --fake --db demo.db` — içerideki sahte Evita 4
ile aynı log'u üretir.

**Kapatma:** Ctrl+C. Köprü çıkmadan STOP gönderir; yoksa ventilatör 3 saniye sonra ekranda ve
sesli olarak "iletişim hatası" verir. Kabloyu çekmeden önce programı kapat.

---

## Details (EN)

### What it does

```text
ventilator ──RS-232──▶ transport ─bytes─▶ Session ─events─▶ MedibusBridge ─FHIR─▶ SqliteBuffer ─▶ flush_loop ─▶ /ingest
```

- `framing.py` — ESC/SOH frames, checksums, embedded commands, realtime-byte tolerance.
- `messages.py` — measured-data / settings / alarm record decoders, device-ID parser.
- `session.py` — the MEDIBUS life-cycle as a sans-I/O state machine: ICC handshake, device
  identification, 2 s polling, NOP keep-alive, 3 s / 10 s time-outs, STOP. No sockets, no clock;
  the runner feeds it bytes and time.
- `mapping.py` — per-site JSON table: MEDIBUS code → engine `SignalCode`, unit, scale.
- `bridge.py` — events → `Observation` → FHIR dict, plus PHI-free counters and the discovery
  report.
- `fake_device.py` — a scripted Evita 4 (embeds its device-ID request in the ICC response, sends
  NOPs, re-inits on silence, can inject noise and corrupt frames).
- `transport.py` — pyserial port (lazy import) and the in-process fake.
- `run.py` — CLI, buffer, flush and report loops, port reopen every 5 s.

Protocol rules and device tables, with document references: `docs/medibus-protocol-notes.md`.

### Hardware

- Ventilator side: 9-pin Sub-D female, pins 2 RXD / 3 TXD / 5 GND, 1.5 kV isolated (Evita 4 IFU).
- Cable: null-modem (2↔3 crossed, 5 straight). Both ends are DTE.
- Adapter: FTDI-based USB-serial adapters are the ones with a field track record on Dräger
  ports; for anything longer than a bench test use an isolated adapter — the isolation in the
  ventilator protects the patient, not your laptop.
- Serial settings: 19200 8-E-1 by default (`--baud`, `--parity N|E|O`). The ventilator's own
  configuration decides; the bridge cannot change it.

### Modes

| Mode       | Command                                    | Forwards | Needs                       |
| ---------- | ------------------------------------------ | -------- | --------------------------- |
| loopback   | `scripts/loopback_check.py COM3`           | nothing  | adapter with 2–3 jumper     |
| listen     | `scripts/loopback_check.py COM3 --device`  | nothing  | cable to ventilator         |
| discovery  | `-m medibus.run --port COM3`               | nothing  | same                        |
| fake       | `-m medibus.run --fake`                    | optional | nothing                     |
| production | `-m medibus.run --port COM3 --cloud-url …` | yes      | `--patient-id`, `--mapping` |

Optional polls: `--codepage2` (2BH — not on Evita 4), `--settings` (29H), `--alarms` (27H —
counted in the report, never forwarded as observations).

### Mapping file

```json
{
  "device": "Evita 4",
  "codepage1": {
    "EB": {"signal": "spo2", "unit": "%"},
    "F0": {"signal": "fio2", "unit": "fraction", "scale": 0.01}
  },
  "codepage2": {},
  "settings": {},
  "derived": {"on_resp_support": true}
}
```

`signal` must be an engine `SignalCode`; the loader names the bad value otherwise. Ventilator
mechanics (PEEP, pressures, volumes, etCO2) are seen and counted but have no engine signal yet —
adding one is an engine change, not a mapping change. `derived.on_resp_support` emits
`on_resp_support = 1` with every successful code-page-1 poll; it never emits 0.

### Rules of engagement

- The bridge only reads. There is no code path that changes a setting or silences an alarm.
- Cabling a ventilator needs biomed approval; start with one bed.
- Stop the program before pulling the cable, or the ventilator raises a communication alarm.
- Logs and reports carry codes, counts and value *formats*, never values. The buffer file holds
  real observations in transit: encrypted disk, never committed, deleted after the pilot.
- MEDIBUS carries no patient identity. `--patient-id` is a pseudonymous id the operator assigns
  per run; a wrong one attributes a ventilator to the wrong patient, so double-check the bed.

### Development

```text
cd medibus
python -m pytest -q          # 86 tests, no hardware, ~5 s (wall-clock fake runs)
```

`pyproject.toml` points pytest at `../homunculus-engine/src`; `run.py` does the same at runtime
when `homunculus` is not installed.
