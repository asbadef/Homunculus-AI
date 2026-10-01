# Homunculus prototip v1 — modül sözleşmesi

Tarayıcıda derleme olmadan çalışan, tek sayfalık tıklanabilir prototip. `index.html` şu sırayla yükler:
`core.js` → `patient.js` → `nursing.js` → `admin.js` → `screens.js` → `shell.js`.
Her modül **düz script**tir (ES module değil), `(function(){ ... })();` içine yazılır, yalnızca `window.H` üzerinden konuşur.
Sunucu: `http://localhost:5199/app/` (python http.server). Harici kütüphane YOK. Fontlar: Figtree, Space Grotesk, JetBrains Mono (index.html'de yüklü).

## Kesin kurallar
1. **Gerçek kişi adı yok.** Tüm hasta/personel adları `core.js`'teki uydurma adlardır. Başka ad uydurman gerekirse Azerbaycan'da yaygın ama rastgele ad-soyad birleşimi kullan; asla ekran görüntülerinden ad alma.
2. **Tanı koymaz, emir vermez.** Öneri dili: "…kriterleri karşılanıyor, değerlendirme önerilir", "kararı hekimindir". Doz önerisi yok.
3. **Klinik sayılar kaynaksız uydurulmaz.** Puan tablosu gereken ölçeklerde (Morse, Braden, NEWS2, PEWS, CPOT, FLACC, NIPS, PUSH, GKS…) yalnızca yaygın bilinen standart sürümü kullan ve formda küçük bir "Puan tablosu: <ölçek adı> · hastanenin onayı gerekir" notu göster. Emin olmadığın puanı yazma; yerine "puan tablosu arşive alınacak" de.
4. **Sentetik veri etiketi** zaten kabukta var; ekstra gerekmez.
5. Tasarım dili onaylı: koyu lacivert (Gece) + açık (Gün Işığı) tema, CSS değişkenleri `app.css :root`'ta. Renkleri doğrudan hex yazma; `var(--card)`, `var(--pri)` vb. kullan. Monitör/vital renkleri `--v-hr --v-map --v-spo --v-rr --v-t`.
6. Gereksiz kalabalık yok: her ekranda önce en önemli bilgi, ayrıntı açılır/sekmeli.
7. Menü/başlık dışındaki içerik şimdilik **Türkçe**.
8. Telefon genişliğinde (390px) yatay taşma olmamalı.

## H API (core.js)
- `H.icon(name)` → SVG. İsimler: grid bell clip list user userPlus users pill cpu chart shield tv gear out alert flask plug bed clock ok x plus minus search moon sun lock key building tree heart activity drop thermo syringe food body qr tablet wifi edit trash print chevR chevL chevD globe zap eye file swap star link
- `H.state` → `{ user, lang, theme, size, bedView, page, params }`. `H.state.user` = `{ u, name, role, units[], title, mfa, ... }`
- `H.data.hospital` (Bina > Kat > Birim > yatak), `H.units()`, `H.unit(id)`, `H.bed(id)` (→ `{id,no,room,status:'dolu'|'bos'|'temizlik'|'bloke'|'rezerve', pid, unitId}`)
  - Birim: `{ id, name(AZ), tr, type:'ward'|'icu'|'nicu', ageGroup:'adult'|'child'|'neonate', beds[], rule, building, floor }`
- `H.data.patients`, `H.pt(id)`, `H.ptByBed(bedId)`, `H.myPatients()` (kullanıcının birimlerindekiler), `H.inScope(pid)`
  - Hasta: `{ id, name, sex:'E'|'K', age, ageDays?, ageGroup, bed, dx, icd, admitDays, attending(u), nurse(u), blood, weight, height, allergies[], chronic[], isolation, codeStatus, antibioticDay, monitored, risk:'crit'|'high'|'mid'|'low'|'stable', news2?, sofa?, pews?, nsofa?, gestWeeks?, birthWeight?, v:{hr,sbp,dbp,map,spo2,rr,temp,o2,loc}, flags:{fall,braden,pain} }`
- `H.data.users`, `H.userBy(u)`, `H.data.roles` (`{ key:{ name, az, perms[], home } }`), `H.can(perm)`
- `H.data.alarms`, `H.openAlarms()`, `H.data.handovers`, `H.data.tasks` (`{pid, t(saat; 8=08:00 … 24=00:00 … 30=06:00), kind:'form'|'med'|'care'|'lab', label, form?, state:'done'|'late'|'due'|'plan'}`)
- `H.FORMS` = form kataloğu `[{key,name,icon,freq,ages[]}]`. Anahtarlar: vitals pain wound fall braden gcs io glucose activity
- `H.forms.open(key, pid)` → **nursing.js** bu fonksiyonu gerçekler (modal ya da sayfa açar).
- `H.series(pid, key, hours=24)` → `[{t(saat, negatif=geçmiş), v}]`, key: hr map sbp spo2 rr temp. `H.VITAL[key]` → `{n,s,u,c(css var adı),lo,hi,al[],nb[]}`
- `H.lineChart(svgEl, { series:[{pts,color,width,dots}], lo, hi, bands:[[a,b,color]], ticks:[..], hours|t0,t1, height, xLabels, xTicks:[[t,label]], events:[{t,label,kind:'tx'|'al'}], onHover(t,e) })`
- `H.spark(values[], color)` → küçük çizgi SVG string
- `H.cssVar('--pri')` → renk değeri
- `H.sevPill(risk)`, `H.SEV`, `H.scoreLabel(p)`, `H.ageText(p)`
- `H.register(key, { title:()=>'…', perm:'…', render(root, params) })` → sayfa kaydı. `root` içerik alanıdır (padding'li). `render` HTML basar ve olay dinleyicilerini `root`a bağlar.
- `H.go(page, params)` → sayfaya git (ör. `H.go('patient', {pid:'p1', tab:'ozet'})`)
- `H.modal({ title, body, wide, actions, onMount(modalEl), onClose })`, `H.closeModal()`
- `H.toast(msg, ''|'w'|'e')`, `H.log(action, detail)` (denetim kaydı), `H.esc(str)`, `H.now()` → gerçek saat "HH:MM" (30.09c; `?saat=HH:MM&gun=YYYY-MM-DD` ile donar)
- Saat ve tarih (30.09c, core.js "TEK çapa"): `H.DAY0` nöbet günü (08:00'den önce dün), `H.nowT()` nöbet saati (8…31.99), `H.clockDate()`, `H.calOff()` takvimde bugün.
  Veri "24.09 21:42" varsayılarak yazıldı; **olay** saatleri şu yardımcılarla gerçek saate kaydırılır: `H.at("21:30")` (gün değişince "29.09 · 21:30"),
  `H.atHM`, `H.atFull`, `H.ts("23.09 21:38" | "2026-09-23" …)`, `H.tsPair(tarih, saat)`, `H.recShift(nöbetTarihi, saat)`, `H.tShift(t)`.
  **Takvim** saatleri (tur, ilaç, 08:00 nöbet değişimi, 02:00 yedek…) kaydırılmaz; durumu `H.taskState(t)` verir. Yeni yazılan kod sabit "21:42" varsaymaz.
- `H.t(key)`, `H.LANGS`, `H.flag('AZ'|'TR'|'RU'|'EN')`

## CSS sınıfları (app.css)
Kabuk dışı: `.ph` (sayfa başlığı; içinde `h2`, `p`, `.r` sağ kısım), `.btn` (+ `.p` birincil, `.d` tehlike, `.g` hayalet, `.sm`, `.lg`), `.seg` (+ `button.on`), `.box`/`.card` (+ `h5` başlık, `h5 .r`), `.sec` (+ `small`), `.g2 .g3 .g4` ızgaralar, `.sv` (risk hapı, `--r` ile), `.pill`, `.tag` (+ `.w` uyarı, `.c` kritik), `.kv`, `.note` (+ `.i` bilgi), `.empty`, `.tabs span(.on, em)`, `table.t` (+ `tr.row`, `td.n`), `.tw` (yatay kaydırmalı tablo sarmalı), form: `.fld` (label + alan; `.col` tek sütun), `.opts i(.on)` dokunmatik seçenek, `.step` (−/+ sayı girişi: `<div class="step"><button>−</button><input><button>+</button><span class="u">birim</span></div>`), `.formbar` (sayfa altı yapışkan kayıt çubuğu), `.scoreBadge`, `.att .ac(.crit|.ok)` dikkat kartları, `.beds .bed` yatak kartları, `.vit`, `.flags span(.h|.m|.c)`, `.mon` monitör, `.vitalBar`, `.bodyWrap` + vücut SVG sınıfları `.bf-out .bf-in .bf-det .bf-rg(.sel|.has)`.

## Sahiplik
- **patient.js** → `H.register('patient', …)`: hasta ekranı (sekmeler: ozet, trend, skor, takip, ilac, sivi, sonuc, devir). Ayrıca `H.patientHeader(p)` dışa verir.
- **nursing.js** → `H.forms.open`, `H.body(opts)` (vücut figürü), `H.register('tasks', …)` (Görevlerim), `H.register('bedside', …)` (portatif cihazla yatak başı ölçüm).
- **admin.js** → `H.register('admin', …)` (sekmeler: users, roles, structure, integrations, system, audit), `H.register('admission', …)` (hasta kabul + HBYS yoksa elle/geçici kayıt).
- **screens.js** (ana oturum) → beds, alarms, hand, rrt, pharmacy, devices, summary, settings, profile.
- **shell.js** (ana oturum) → giriş, şifre sıfırlama, 2FA, ilk girişte şifre değiştirme, kilit ekranı, menü, üst çubuk, `H.renderApp`.
