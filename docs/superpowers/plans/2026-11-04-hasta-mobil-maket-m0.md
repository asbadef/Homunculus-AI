# Hasta Mobil Uygulaması — M0 Maket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a professional, demo-data Expo (React Native) patient app the owner can open on their phone — all key screens working on fake data, in the Homunculus visual language, ready to wire to real APIs later.

**Architecture:** One Expo app (TypeScript, Expo Router file-based nav, bottom tabs). A ported theme-token layer (light default + dark toggle) mirrors `dashboard/src/clinicalTheme.js`. Home and menu are driven by one feature-config array (add/remove a feature = one entry). All data comes from an in-app mock transport (no network); every screen is built so its mock call can later be swapped for a real endpoint. No real/PHI data — demo only.

**Tech Stack:** Expo SDK 52 + React Native, TypeScript, Expo Router, `@expo/vector-icons`, `@expo-google-fonts/figtree`, `react-native-svg` (result trend sparkline), `expo-screen-capture`, `expo-secure-store` + `@react-native-async-storage/async-storage`. No heavy chart/UI libraries.

**Spec:** `docs/superpowers/specs/2026-11-04-hasta-mobil-uygulamasi-design.md`

**Scope:** This plan is **M0 only** (the maket). M1+ (binding each screen to real HBYS endpoints, patient FİN/SMS backend auth, video, Sağlığım) are planned separately once the backend modules exist (design doc §7). M0 login/SMS is a **mock** flow for look-and-feel only.

## Global Constraints

- **No copied names.** Screen/tab/section names are original Azerbaijani (default), never copied from any reference app. A naming list (`src/i18n/az.ts`) is the single source; owner confirms. — spec §2 red lines
- **No competitor/reference app name** anywhere in UI or code.
- **No real or PHI data.** Demo/synthetic only, in `src/demo/`. — spec §2
- **No diagnosis language.** Result "explain" copy says "değer genelde şu demek, doktoruna danış"; never states a diagnosis. — spec §2
- **Default language Azerbaijani (`az`)**; also `tr`, `ru`, `en`. — spec §2
- **Default theme light**, user toggles dark; both themes legible. — spec §2
- **Brand** `#0891b2` (accent `#22d3ee`), font **Figtree**. — spec §3, `dashboard/tailwind.config.js`
- **Screen capture blocked** on sensitive screens (results, prescriptions, health card, family-follow). — spec §2

## Review Focus

- **Long AZ/RU labels overflow** tiles/buttons/tabs → every tile and tab label wraps or ellipsizes, never pushes layout; test in Task 1 (tabs) and Task 2 (home tiles) with a long-label fixture.
- **Empty states** (no appointments, no results, no family member) → each list screen renders a designed empty state, not a blank; test in Task 4 (results empty) and Task 3 (appointments empty).
- **Language switch mid-flow keeps state** → switching language on a wizard step re-labels without losing the current step/selection; test in Task 3.
- **Login validation** (empty FİN, wrong length, foreign→passport toggle) → the continue button stays disabled and shows the right field hint; test in Task 5.
- **Theme persists and both themes readable** → toggle writes storage, reload restores it, no token reads only defined in one theme; test in Task 1.

---

### Task 1: Scaffold + theme + i18n + navigation shell

**Files:**
- Create: `mobile/patient/` (Expo app: `app/`, `src/`, `app.json`, `package.json`, `tsconfig.json`)
- Create: `mobile/patient/src/theme/tokens.ts`, `src/theme/ThemeProvider.tsx`
- Create: `mobile/patient/src/i18n/index.ts`, `src/i18n/az.ts`, `src/i18n/{tr,ru,en}.ts`
- Create: `mobile/patient/app/_layout.tsx` (root: providers), `app/(tabs)/_layout.tsx` (bottom tabs), `app/(tabs)/{index,randevu,neticeler,saglik,profil}.tsx` (placeholder screens)
- Test: `mobile/patient/src/theme/tokens.test.ts`, `src/i18n/i18n.test.ts`

**Interfaces:**
- Produces: `tokens` with `light`/`dark` sets `{bg,surface,surface2,fg,muted,border,brand,brandInk,brandSoft,ok,wait,radius}`; `useTheme(): {t, mode, toggle}` (persists via AsyncStorage key `hm-theme`, default `"light"`); `useI18n(): {t:(key)=>string, lang, setLang}` (persists `hm-lang`, default `"az"`).

- [ ] **Step 1: Scaffold** — `npx create-expo-app@latest mobile/patient -t expo-template-blank-typescript`; add deps (expo-router, @expo/vector-icons, @expo-google-fonts/figtree, react-native-svg, expo-screen-capture, expo-secure-store, @react-native-async-storage/async-storage); set Expo Router entry + `app.json` scheme `homunculus-hasta`.
- [ ] **Step 2: Failing test — token completeness & theme shape**

```ts
test("every token key exists in both light and dark", () => {
  const keys = Object.keys(tokens.light);
  expect(Object.keys(tokens.dark)).toEqual(keys);
  expect(tokens.light.brand).toBe("#0891b2");
});
```
- [ ] **Step 3: Run test — FAIL** (`tokens` undefined). Run: `npm test -- tokens`.
- [ ] **Step 4: Implement `tokens.ts`** — port palette from `dashboard/src/clinicalTheme.js` (light = clean white/`#f5f8f9`; dark = slate `icu` family), brand `#0891b2`/`#22d3ee`. Implement `ThemeProvider` + `useTheme` (AsyncStorage, default light).
- [ ] **Step 5: Run test — PASS.**
- [ ] **Step 6: Failing test — i18n default & switch**

```ts
test("default lang az, setLang switches, unknown key returns key", () => {
  // render hook; expect lang==="az"; after setLang("tr") a known key differs; missing key echoes
});
```
- [ ] **Step 7: Run — FAIL**, then implement `i18n/index.ts` (+ `az` seed dict with tab/section names), **Step 8: PASS.**
- [ ] **Step 9: Bottom tabs** — `app/(tabs)/_layout.tsx` with 5 tabs (Ev · Randevu · Nəticələr · Sağlıq · Profil), `@expo/vector-icons`, labels from i18n, center "Randevu" emphasized; tab labels `numberOfLines={1}` + ellipsize. Placeholder screens render a titled empty state using `t`.
- [ ] **Step 10: Verify runs & long-label review** — `npx expo start` (web): app boots, 5 tabs switch, theme toggle flips light/dark and persists on reload, a long AZ label in the tab bar does not break layout.
- [ ] **Step 11: Commit** — `git add mobile/patient && git commit -m "feat(hasta-mobil): M0 scaffold, theme tokens, i18n, tab shell"`

---

### Task 2: Demo data layer + config-driven home

**Files:**
- Create: `mobile/patient/src/demo/db.ts` (fixtures), `src/demo/transport.ts` (async getters), `src/config/features.ts` (home/menu config)
- Create: `mobile/patient/src/components/{Stories,BannerCarousel,ShortcutTile,QuickServices,NewsStrip,Card,StatusPill,EmptyState}.tsx`
- Rewrite: `app/(tabs)/index.tsx` (Home)
- Test: `src/demo/transport.test.ts`, `src/config/features.test.ts`

**Interfaces:**
- Produces: `transport` = `{getDoctors, getDepartments, getHospitals, getResults, getPrescriptions, getAppointments, getInvoices, getNews, getStories, getBanners}` each `() => Promise<T[]>` reading `db.ts`; result/appointment shapes per spec (result: `{id,type:'lab'|'radiology'|'pathology',title,date,status:'ready'|'pending',values?:{name,value,unit,refLow,refHigh}[],protocol,hospital}`). `FEATURES: {key,title,icon,route,group:'shortcut'|'service',enabled,order}[]` — Home renders only `enabled`, sorted by `order`.

- [ ] **Step 1: Failing test — transport shapes & config filter**

```ts
test("getResults returns typed rows; disabled feature is hidden", async () => {
  const r = await transport.getResults();
  expect(r[0]).toHaveProperty("values");
  expect(visibleFeatures(FEATURES).every(f => f.enabled)).toBe(true);
});
```
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** `db.ts` (rich AZ demo fixtures: doctors+CV+photo-placeholder, departments, hospitals+distance, results incl. one pending + trend series, prescriptions+drug detail, appointments incl. empty-day case, invoices, news, stories, banners), `transport.ts`, `features.ts`. **Step 4: PASS.**
- [ ] **Step 5: Build Home** — Stories row, BannerCarousel, shortcut tiles (from `FEATURES` group `shortcut`), QuickServices grid (group `service`), NewsStrip. Placeholder images via `require` of bundled assets or a solid-tint `Image` fallback. Tile labels wrap; grid reflows at narrow width.
- [ ] **Step 6: Long-label + render review** — run on web: Home renders all sections from demo data; a 30-char tile label wraps without overflow.
- [ ] **Step 7: Commit** — `"feat(hasta-mobil): demo transport + config-driven home"`

---

### Task 3: Appointment wizard

**Files:**
- Create: `app/randevu/_layout.tsx`, `app/randevu/{tip,hastane,bolum,doktor,tarix,ozet}.tsx`, `src/appointment/useWizard.ts`
- Create: `src/components/{WizardHeader,DoctorCard,DoctorCV}.tsx`
- Rewrite: `app/(tabs)/randevu.tsx` (my appointments list + "Yeni randevu")
- Test: `src/appointment/useWizard.test.ts`

**Interfaces:**
- Consumes: `transport.getHospitals/getDepartments/getDoctors/getAppointments`.
- Produces: `useWizard()` state `{type,hospital,department,doctor,date,time}` with per-step guards; `canContinue(step)`.

- [ ] **Step 1: Failing test — guards & language-stable state**

```ts
test("cannot continue a step until its field is set; changing lang keeps selection", () => {
  // select hospital → canContinue('hastane') true; setLang('ru') does not clear hospital
});
```
- [ ] **Step 2: FAIL → Step 3: Implement** wizard (type → hastane[mesafe, "seçmeden devam et"] → bölüm[ikonlu] → doktor[arama, favori, en yakın saat, CV aç] → tarix[takvim+saat ızgarası] → özet[sigortalı/sigortasız + Onayla]); "kendim/başkası için" on first step. → **Step 4: PASS.**
- [ ] **Step 5: My appointments** — list from demo (confirmed/pending pills) + **empty state** when none; "Yeni randevu" opens wizard.
- [ ] **Step 6: Review** — walk the 4 steps on web; switch language on step 3, selection survives; empty appointments shows designed empty state.
- [ ] **Step 7: Commit** — `"feat(hasta-mobil): 4-step appointment wizard + my appointments"`

---

### Task 4: Results + Prescriptions

**Files:**
- Rewrite: `app/(tabs)/neticeler.tsx` (filter Lab/Radyoloji/Patoloji + list)
- Create: `app/netice/[id].tsx` (detail: values + refs + trend + explain), `src/components/TrendSparkline.tsx` (react-native-svg)
- Create: `app/(tabs)/saglik.tsx` interim → **Prescriptions** `app/reseptler/index.tsx`, `app/reseptler/[id].tsx` (drug detail), `src/reminder/reminders.ts`
- Test: `src/components/trend.test.ts` (scale math), `src/reminder/reminders.test.ts`

**Interfaces:**
- Consumes: `transport.getResults/getPrescriptions`.
- Produces: `scalePoints(series, w, h) -> {x,y}[]` (min/max → box, clamps); `addReminder(drugId, time)` / `listReminders()`.

- [ ] **Step 1: Failing test — trend scale stays in bounds; empty results**

```ts
test("scalePoints maps min and max to box edges and clamps", () => {
  const p = scalePoints([{v:10},{v:20}], 100, 50);
  expect(p[0].y).toBeCloseTo(50); expect(p[1].y).toBeCloseTo(0);
});
```
- [ ] **Step 2: FAIL → Step 3: Implement** results list (filters, status pills, protocol/hospital, **empty state**), detail (value vs refLow/refHigh with normal/abnormal mark, `TrendSparkline`, **"Sadə dildə izah et"** button → static non-diagnostic copy stub, "doktoruna danış"), prescriptions list + drug detail (barcode, usage, aç/tok, warnings, prospektüs-görüntüle), `addReminder`. → **Step 4: PASS.**
- [ ] **Step 5: Review** — results empty state renders; trend draws inside its box; explain copy contains no diagnosis.
- [ ] **Step 6: Commit** — `"feat(hasta-mobil): results (trend+explain) and prescriptions"`

---

### Task 5: Onboarding + login (mock) + consent + profile + capture-block

**Files:**
- Create: `app/giris/{tanitim,giris,sms,pin,riza}.tsx`, `src/session/SessionProvider.tsx`, `src/session/validate.ts`
- Rewrite: `app/(tabs)/profil.tsx` (kişi, FİN maskeli, aile üyeleri + ekle, dil, tema, bildirim, çıkış)
- Create: `src/security/useScreenGuard.ts` (expo-screen-capture)
- Modify: sensitive screens (`netice/[id]`, `reseptler/[id]`, `saglik`, family-follow) to call `useScreenGuard()`
- Test: `src/session/validate.test.ts`

**Interfaces:**
- Produces: `validateIdentity({country,fin,passport,birthdate,phone}) -> {ok, field?, hint?}` (FİN 7 chars for AZ, passport non-empty for foreign, birthdate+phone required); `useSession()` `{signedIn, user, signIn, signOut}`; `useScreenGuard()` (prevents on focus, allows on blur).

- [ ] **Step 1: Failing test — identity validation**

```ts
test("empty FİN blocks; foreign requires passport not FİN", () => {
  expect(validateIdentity({country:"az",fin:"",birthdate:"1990",phone:"05..."}).ok).toBe(false);
  expect(validateIdentity({country:"foreign",passport:"A123",birthdate:"1990",phone:"05..."}).ok).toBe(true);
});
```
- [ ] **Step 2: FAIL → Step 3: Implement** onboarding slides (4–5), login (country→FİN/passport+birthdate+phone, continue disabled until `validateIdentity.ok`, field hint), mock SMS (any 4-digit passes, labelled "nümunə"), PIN/biometric setup, consent screen; profile (masked FİN, family add via FİN+birthdate, lang, theme, notifications, logout); `useScreenGuard` on sensitive screens. → **Step 4: PASS.**
- [ ] **Step 5: Review** — login button stays disabled on bad input with correct hint; capture-block active on a result detail, released on Home.
- [ ] **Step 6: Commit** — `"feat(hasta-mobil): onboarding, mock login/SMS/PIN, consent, profile, screen-guard"`

---

### Task 6: Secondary screens + visual polish

**Files:**
- Create: `app/saglik-karti.tsx` (kan grubu/alerji/kronik — elle giriş), `app/yakin-takip.tsx` (YBÜ/yeni doğan, maskeli, rıza notu), `app/faturalar/index.tsx` (+ kart ekle), `app/(tabs)/saglik.tsx` (hub: kozlar + güzel haberler), `app/bildirisler.tsx`
- Modify: `src/config/features.ts` (wire new routes)
- Polish pass across components (spacing scale, shadows, consistent cards, reduced-motion, focus states)

- [ ] **Step 1: Implement** the secondary screens on demo data, each with an empty/first-run state; wire into `FEATURES`. Family-follow shows masked names + a one-line consent notice.
- [ ] **Step 2: Polish** — unify radius/spacing/shadow tokens, check both themes on every screen, ensure no horizontal overflow at phone width, `@expo/vector-icons` consistent weight.
- [ ] **Step 3: Verify** — typecheck clean (`tsc --noEmit`), `expo start` boots, every tab + wizard + a sensitive screen render in both light and dark with demo data.
- [ ] **Step 4: Commit** — `"feat(hasta-mobil): secondary screens + visual polish pass"`

---

## Notes for execution tonight
- The owner will enable Expo on their phone in the evening (Metro/tunnel + Expo Go, same account as MedRapor). Build M0 now so it runs when they connect; verify on Expo **web** meanwhile.
- Real images come later via the connected image tool (Gemini/Nano Banana or an image-gen MCP); use tasteful tinted placeholders until then.
- M1 (real data) is a separate plan written when the patient-facing endpoints (design doc Ek A) exist.
