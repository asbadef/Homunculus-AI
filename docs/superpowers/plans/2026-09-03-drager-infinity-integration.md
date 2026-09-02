# Dräger Infinity ICU Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved design (`docs/superpowers/specs/2026-09-03-drager-infinity-integration-design.md`) into three concrete artifacts: a sendable biomed question list, a Gateway runbook section that reuses the engine's existing MLLP bridge unchanged, and a terminology update to the living Turkish guide — so the pilot's next move (asking the hospital) is unblocked immediately, and the moment an answer arrives, executing the Gateway path is a documented runbook, not a design discussion.

**Architecture:** No new production code. Track 1 (Gateway) points the already-tested `homunculus-engine/scripts/run_bridge.py` MLLP bridge at Dräger Infinity Gateway's HL7 output once it exists — this plan documents that runbook. Track 2 (Kappa serial fallback) is architecture-only per the spec (extends `medibus/` once MS28819 is obtained) and produces no files in this plan.

**Tech Stack:** Markdown documentation only. Facts quoted in the docs are verified against the real CLI (`run_bridge.py`) and the real bridge report strings (`homunculus/edge/bridge.py`) via grep, not memory.

---

## Task 1: Biomed question list

**Files:**
- Create: `docs/drager-infinity-biomed-sorulari.md`

- [ ] **Step 1: Write the document**

Create `docs/drager-infinity-biomed-sorulari.md` with this exact content:

```markdown
# Dräger Infinity entegrasyonu — biomed'e sorulacak sorular

**Tarih:** 2026-09-03
**Bağlam:** 2026-09-02 saha taramasında ICU'da 13 yataklı bir Dräger Infinity Kappa ağı
(VF9.1-C, `10.10.203.0/24`) canlı EKG üretirken bulundu — bu, Homunculus motorunun asıl
hedeflediği sürekli telemetri kaynağı. Bu nesil Dräger'in HL7 çıkışı ayrı bir yazılım olan
**Infinity Gateway** gerektiriyor; hastanenin bunu edinip edinemeyeceği bilinmiyor. Tam tasarım:
`docs/superpowers/specs/2026-09-03-drager-infinity-integration-design.md`.

## Sorular

1. **Infinity Gateway yazılımı hastanede kurulu mu?** Değilse, Dräger'den lisanslanabilir mi —
   kabaca maliyet, süre, bir servis ziyareti gerekir mi?

2. **`Win-DRGMON` entegrasyon sunucusu** (`10.10.207.2`) zaten başka sistemlere HL7 konuşuyor
   (Karl Storz SCENARA.connect, Medset PADSY, Nihon Kohden) ama üzerinde Dräger yazılımı yok —
   host adı Dräger'e göre ayrılmış görünüyor. Gateway oraya mı kurulacak, yoksa başka bir yere mi?

3. **Central station'daki (`ICU2`, etiket `BONADEA`) Biomed menüsünü kim yapılandırabilir** —
   HL7 ORU dışa aktarımını açıp bir hedef host:port girmek için? Hastane biomed ekibi mi, saha
   teknisyeni mi, yoksa yalnızca Dräger uzaktan destek mi?

4. **Gateway'in HL7 ORU çıkışı rastgele bir hedefe yönlendirilebilir mi** (bizim tarafımız:
   `172.100.101.72:2575` — ağ yolu 2026-09-02'de doğrulandı), yoksa Dräger tarafında özel bir
   alıcı sistem profili / kayıt mı gerekiyor?

5. **MS28819 Rev12 kılavuzu ("Infinity RS-232 Export Protocol") ve X5 kablosu (5206441)
   temin edilebilir mi?** Bu, Gateway olmadan bir yedek yol için gerekiyor — Kappa'nın kendi
   seri çıkışı, ventilatörler için zaten kurulmuş olan MEDIBUS köprüsünden tamamen farklı bir
   protokol.

6. **Hangi Kappa yataklarında X5 çıkışı fiziksel olarak erişilebilir / Biomed menüsünden aktif?**

## Not

Bu sorulara verilecek cevaplar, `docs/EDGE-BRIDGE-LOCAL.md`'deki "Dräger Infinity route" bölümünde
anlatılan keşif adımlarını doğrudan tetikler — Gateway varsa mevcut köprü hiç değişmeden
çalıştırılır, yoksa MS28819 gelene kadar bu iş beklemede kalır.
```

- [ ] **Step 2: Verify every quoted fact against its source**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
grep -n "172.100.101.72\|10.10.207.2\|Win-DRGMON\|MS28819\|5206441\|BONADEA\|ICU2" \
  docs/superpowers/specs/2026-09-03-drager-infinity-integration-design.md
```

Expected: every one of `172.100.101.72`, `10.10.207.2`, `Win-DRGMON`, `MS28819`, `5206441`,
`BONADEA`, `ICU2` appears at least once in the spec's output — confirming nothing in the new
document was invented or drifted from the approved design.

- [ ] **Step 3: Commit**

```bash
git add docs/drager-infinity-biomed-sorulari.md
git commit -m "docs(drager): biomed question list for the Infinity Gateway path

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Gateway runbook section in EDGE-BRIDGE-LOCAL.md

**Files:**
- Modify: `docs/EDGE-BRIDGE-LOCAL.md` (insert a new `## The Dräger Infinity route: Gateway or ask`
  section immediately after the NCE section's closing bash block and before the `## Verifying`
  heading — i.e. right after the line `[the design](superpowers/specs/2026-08-28-nce-file-bridge-design.md).`
  and its following fenced `docker compose up -d` block, before `## Verifying`)

- [ ] **Step 1: Confirm the exact insertion point**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
grep -n "^## " docs/EDGE-BRIDGE-LOCAL.md
```

Expected output includes, in order:
```
44:## The device route: NCE's files, not WACP
105:## Verifying
```
The new section is inserted between these two lines (after the code block that currently ends
just before line 105).

- [ ] **Step 2: Verify the CLI flags and log strings before quoting them**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI/homunculus-engine"
grep -n "add_argument" scripts/run_bridge.py
grep -n "KEŞİF MODU\|Eşlenmemiş kodlar" scripts/run_bridge.py src/homunculus/edge/bridge.py
```

Expected: `--listen-host` (default `0.0.0.0`), `--listen-port` (default `2575`), `--db` (default
`bridge-buffer.db`), `--mapping`, `--cloud-url`, `--token`, `--flush-interval`,
`--report-interval`, `--max-buffer` all appear; `KEŞİF MODU: veri iletilmiyor, yalnızca
dinleniyor ve kodlar raporlanıyor (iletmek için --cloud-url verin)` appears in `run_bridge.py`;
`"Eşlenmemiş kodlar: "` appears in `edge/bridge.py`. These are the exact strings the new section
quotes — if any of them differ, update the section text to match what grep actually returns
before writing Step 3.

- [ ] **Step 3: Insert the new section**

Insert this section into `docs/EDGE-BRIDGE-LOCAL.md` at the point found in Step 1 (after the NCE
section's `docker compose up -d` block, before `## Verifying`):

````markdown
## The Dräger Infinity route: Gateway or ask

The pilot ICU's real continuous-telemetry source is a Dräger Infinity network — 13 Kappa bedsides
(VF9.1-C) on their own subnet, live ECG on occupied beds. Unlike the NCE monitors, this device
generation's HL7 exit is **Infinity Gateway**, separate Dräger software that exports HL7 ORU from
the Infinity network. Whether the hospital has it, or can license it, is an open question — see
`docs/drager-infinity-biomed-sorulari.md` for the exact questions asked and
`docs/superpowers/specs/2026-09-03-drager-infinity-integration-design.md` for the full design.

**No new code is needed for this path.** The engine's existing MLLP bridge
(`homunculus-engine/scripts/run_bridge.py`, `homunculus-engine/src/homunculus/edge/mllp.py`) is
the same bridge already proven against the NCE and MEDIBUS work — it just needs Gateway's HL7
output pointed at it.

Once Gateway is configured to send its HL7 ORU output at the Homunculus host's MLLP port (the
network path from `172.100.101.72` to the Dräger subnet was already verified reachable on
2026-09-02), run the bridge in discovery mode from `homunculus-engine/`:

```bash
python scripts/run_bridge.py --db bridge.db
```

With no `--cloud-url`, nothing is forwarded — the log prints:

```text
KEŞİF MODU: veri iletilmiyor, yalnızca dinleniyor ve kodlar raporlanıyor (iletmek için --cloud-url verin)
```

followed by periodic `Eşlenmemiş kodlar: <code> (<count>), ...` lines as real Gateway traffic
arrives. From those, write `drager-gateway-mapping.json` — the same flat shape `run_bridge.py`
expects for any site (`{"<OBX code>": "<SignalCode slug>"}`), for example:

```json
{
  "150456": "spo2",
  "150455": "heart_rate",
  "150457": "resp_rate"
}
```

An unknown `SignalCode` slug fails startup loudly rather than silently dropping a signal for the
whole pilot (`run_bridge.py`'s `load_mapping`). Re-run with the mapping and an uplink:

```bash
python scripts/run_bridge.py --db bridge.db \
  --mapping drager-gateway-mapping.json --cloud-url https://<host>/api --token <tenant-token>
```

and confirm one live Dräger-fed bed's observations reach the dashboard, the same acceptance check
already used for NCE and MEDIBUS.

If Gateway turns out not to exist and cannot be licensed, the fallback is the Kappa bedside's own
serial export (*Infinity RS-232 Export Protocol*, Dräger doc MS28819) — a second protocol driver
inside the `medibus/` package, reusing its transport/buffer/CLI machinery, blocked on obtaining
that document. See the design doc's "Track 2" for what that needs.
````

- [ ] **Step 4: Verify the file is well-formed**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
grep -n "^## " docs/EDGE-BRIDGE-LOCAL.md
```

Expected: `## The Dräger Infinity route: Gateway or ask` now appears between `## The device
route: NCE's files, not WACP` and `## Verifying`, and every other heading from the original file
is still present and in its original order (no accidental deletion).

- [ ] **Step 5: Commit**

```bash
git add docs/EDGE-BRIDGE-LOCAL.md
git commit -m "docs(edge): Dräger Infinity Gateway runbook — reuses the MLLP bridge unchanged

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Terminology update in the living Turkish guide

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (extend the existing "Cihaz bağlantı terimleri" bullet
  list, which currently ends with the STOP/Null-modem bullets before the "ML terimleri" heading)

- [ ] **Step 1: Confirm the exact insertion point**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
grep -n "Null-modem\|STOP kuralı\|ML terimleri" docs/homunculus-rehber-TR.md
```

Expected: a `**STOP kuralı:**` bullet followed shortly after by a `**ML terimleri` heading line —
the new bullet is inserted right after the STOP kuralı bullet's paragraph, before the ML
terimleri line.

- [ ] **Step 2: Insert the new bullet**

Add this bullet immediately after the existing `**STOP kuralı:**` bullet's text (still inside the
same "Cihaz bağlantı terimleri" list, before the `- **ML terimleri` line):

```markdown
  - **Infinity Gateway:** Dräger'in yoğun bakım monitör ağından (Infinity Kappa başucu
    monitörleri) HL7 çıkarmak için gereken ayrı bir yazılım. Hastanede kurulu olup olmadığı henüz
    bilinmiyor — biomed'e sorulan sorular `docs/drager-infinity-biomed-sorulari.md`'de. Varsa,
    hiç yeni kod yazmadan mevcut MLLP köprüsü (`run_bridge.py`) kullanılır; yoksa Kappa'nın kendi
    seri protokolü (MS28819, X5 konektörü — MEDIBUS'tan farklı) bir sonraki seçenek olur.
```

- [ ] **Step 3: Verify the insertion didn't break the list structure**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
grep -n -A 1 "Infinity Gateway:" docs/homunculus-rehber-TR.md
grep -c "^- \*\*ML terimleri" docs/homunculus-rehber-TR.md
```

Expected: the first command shows the new bullet with its next line still indented as part of the
same list; the second command returns `1` (the ML terimleri heading still exists exactly once,
confirming nothing was duplicated or deleted).

- [ ] **Step 4: Commit**

```bash
git add docs/homunculus-rehber-TR.md
git commit -m "docs(rehber): Infinity Gateway terimi eklendi

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
