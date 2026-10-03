// src/live/gallery/DesignGallery.jsx — design review page, opened with ?tasarim=1.
//
// Every token, face, icon and base component of the live UI on one page, with switches for theme,
// text size and language, so the result can be compared side by side with the prototype
// (tasarim-taslaklari/app, anasayfa/gorsel/*.webp). No API, no patient data, not linked from the
// app. Loaded lazily from main.jsx: none of it is in the main bundle.
import "../theme/assets.js";
import React, { useState } from "react";
import { ThemeProvider, useTheme } from "../theme/ThemeProvider.jsx";
import { COLOR_TOKENS, kebab } from "../theme/tokens.js";
import { I18nProvider, useI18n } from "../i18n/I18nProvider.jsx";
import {
  Box, Button, Empty, ENGINE_RISKS, Field, Icon, ICON_NAMES, Input, KV, KVList, Modal, Note, Pill,
  RiskPill, Seg, Select, StatusPill, Table, TabPanel, Tabs, Tag, ToastProvider, useToast,
} from "../ui/index.js";

export default function DesignGallery() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <Gallery />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="mb-3 font-display text-17 font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Sub({ title, children }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{title}</h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Gallery() {
  const { t, lang, setLang, langs } = useI18n();
  const { theme, setTheme, size, setSize } = useTheme();
  return (
    <main className="min-h-full bg-page px-4 pb-10 pt-[18px] font-text text-14.5 leading-[1.5] text-ink sm:px-5">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="m-0 font-display text-23 font-bold leading-[1.1]">{t("gallery.title")}</h1>
          <p className="mb-0 mt-1 text-13 text-mute">{t("gallery.intro")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Seg
            label={t("prefs.theme")}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "gece", label: t("prefs.themeGece"), icon: "moon" },
              { value: "gun", label: t("prefs.themeGun"), icon: "sun" },
            ]}
          />
          <Seg
            label={t("prefs.size")}
            value={size}
            onChange={setSize}
            options={[
              { value: "normal", label: t("prefs.sizeNormal") },
              { value: "buyuk", label: t("prefs.sizeBuyuk") },
            ]}
          />
          <Seg
            label={t("prefs.lang")}
            value={lang}
            onChange={setLang}
            options={langs.map((l) => ({ value: l.code, label: l.native, lang: l.code }))}
          />
        </div>
      </header>
      <Colours />
      <Typefaces />
      <Icons />
      <Components />
    </main>
  );
}

function Colours() {
  const { t } = useI18n();
  return (
    <Section id="g-colours" title={t("gallery.colours")}>
      <Table caption={t("gallery.colours")}>
        <thead>
          <tr>
            <th>{t("gallery.token")}</th>
            <th>{t("prefs.themeGece")}</th>
            <th>{t("prefs.themeGun")}</th>
          </tr>
        </thead>
        <tbody>
          {COLOR_TOKENS.map((name) => (
            <tr key={name}>
              <td className="font-data text-12">
                --{name} <span className="text-mute">· {kebab(name)}</span>
              </td>
              {["gece", "gun"].map((th) => (
                <td key={th}>
                  <div data-theme={th} className="inline-block rounded-lg bg-page p-1.5">
                    <div className="h-6 w-24 rounded-md border border-line" style={{ backgroundColor: `var(--${name})` }} />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

const FACES = [
  ["font-display", "Space Grotesk · --font-display", "text-23 font-bold"],
  ["font-text", "Figtree · --font-text", "text-14.5"],
  ["font-data", "JetBrains Mono · --font-data", "text-13 font-bold"],
];
const SIZE_CLASSES = ["text-10", "text-10.5", "text-11", "text-11.5", "text-12", "text-12.5", "text-13", "text-13.5", "text-14", "text-14.5", "text-17", "text-23"];
const GLYPHS = "Ə ə · Ğ ğ · İ ı · Ş ş · Ç ç · Ö ö · Ü ü · Ж щ ё Ю я · 0123456789";

function Typefaces() {
  const { t } = useI18n();
  return (
    <Section id="g-type" title={t("gallery.type")}>
      <div className="grid gap-3">
        {FACES.map(([face, name, sizeClass]) => (
          <Box key={face} title={name}>
            <p className={`m-0 ${face} ${sizeClass}`}>{t("gallery.specimen")}</p>
            <p className={`mb-0 mt-1 ${face} ${sizeClass}`} translate="no">{GLYPHS}</p>
          </Box>
        ))}
        <Box title="--fs">
          <ul className="m-0 flex list-none flex-wrap items-baseline gap-4 p-0">
            {SIZE_CLASSES.map((cls) => (
              <li key={cls} className={cls}>{cls.replace("text-", "")}</li>
            ))}
          </ul>
        </Box>
      </div>
    </Section>
  );
}

function Icons() {
  const { t } = useI18n();
  return (
    <Section id="g-icons" title={t("gallery.icons")}>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 p-0">
        {ICON_NAMES.map((name) => (
          <li key={name} className="flex flex-col items-center gap-1.5 rounded-box border border-line bg-card px-2 py-3">
            <Icon name={name} size={22} />
            <span className="font-data text-11 text-mute">{name}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Components() {
  const { t } = useI18n();
  const toast = useToast();
  const [filter, setFilter] = useState("open");
  const [tab, setTab] = useState("users");
  const [dialog, setDialog] = useState(false);
  return (
    <Section id="g-components" title={t("gallery.components")}>
      <Sub title={t("gallery.buttons")}>
        <Button>{t("common.cancel")}</Button>
        <Button variant="primary" icon="userPlus">{t("common.save")}</Button>
        <Button variant="danger">{t("gallery.escalate")}</Button>
        <Button variant="ghost">{t("common.close")}</Button>
        <Button variant="primary" size="sm">{t("gallery.seen")}</Button>
        <Button size="sm">{t("gallery.snooze")}</Button>
        <Button variant="danger" size="sm">{t("gallery.escalate")}</Button>
        <Button variant="ghost" size="sm" icon="edit" label={t("gallery.edit")} />
        <Button variant="primary" size="lg">{t("common.save")}</Button>
        <Button disabled>{t("common.save")}</Button>
      </Sub>

      <Sub title={t("gallery.boxes")}>
        <Box title={t("gallery.status")} icon="user" right="hs.ornek" className="w-full max-w-sm">
          <KVList>
            <KV label={t("gallery.username")}>hs.ornek</KV>
            <KV label={t("gallery.lastLogin")}>23.09 19:58</KV>
            <KV label={t("gallery.status")} mono={false}><StatusPill tone="ok">{t("gallery.active")}</StatusPill></KV>
          </KVList>
        </Box>
      </Sub>

      <Sub title={t("gallery.choices")}>
        <Seg
          label={t("gallery.choices")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: t("gallery.open", { n: 3 }) },
            { value: "crit", label: t("gallery.criticalOnly") },
            { value: "mine", label: t("gallery.myPatients") },
          ]}
        />
        <div className="w-full">
          <Tabs
            id="g-tabs"
            label={t("gallery.choices")}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "users", label: t("gallery.users") },
              { value: "roles", label: t("gallery.roles"), count: 2 },
            ]}
          />
          <TabPanel id="g-tabs" value={tab}>
            <p className="m-0 text-13 text-mute">{tab === "users" ? t("gallery.users") : t("gallery.roles")}</p>
          </TabPanel>
        </div>
      </Sub>

      <Sub title={t("gallery.tags")}>
        <Tag>{t("gallery.allUnits")}</Tag>
        <Tag tone="warn">{t("gallery.mfaRequired")}</Tag>
        <Tag tone="crit" icon="lock">{t("risk.critical")}</Tag>
        <Pill icon="ok">{t("gallery.on")}</Pill>
        <StatusPill tone="ok">{t("gallery.active")}</StatusPill>
      </Sub>

      <Sub title={t("gallery.risks")}>
        {ENGINE_RISKS.map((risk) => (
          <RiskPill key={risk} risk={risk} />
        ))}
        <RiskPill risk="none" measured={false} />
        <RiskPill risk="stable" />
      </Sub>

      <Sub title={t("gallery.form")}>
        <div className="w-full max-w-xl">
          <Field label={t("gallery.username")} hint={t("gallery.usernameHint")} required>
            <Input placeholder="hs.ornek" autoComplete="off" />
          </Field>
          <Field label={t("prefs.lang")}>
            <Select defaultValue="az">
              {[["az", "Azərbaycan"], ["tr", "Türkçe"], ["ru", "Русский"], ["en", "English"]].map(([code, name]) => (
                <option key={code} value={code} lang={code}>{name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Sub>

      <Sub title={t("gallery.notes")}>
        <div className="grid w-full max-w-xl gap-2">
          <Note icon="alert">{t("gallery.slowNote")}</Note>
          <Note tone="info" icon="shield">{t("gallery.auditNote")}</Note>
          <Empty icon="search">{t("gallery.noMatch")}</Empty>
        </div>
      </Sub>

      <Sub title={t("gallery.dialogs")}>
        <Button onClick={() => setDialog(true)}>{t("gallery.openDialog")}</Button>
        <Button onClick={() => toast(t("gallery.saved"))}>{t("gallery.showToast")}</Button>
        <Button onClick={() => toast(t("gallery.warning"), "warn")}>{t("gallery.warning")}</Button>
        <Button onClick={() => toast(t("gallery.failed"), "error")}>{t("gallery.failed")}</Button>
        <Modal
          open={dialog}
          title={t("gallery.dialogTitle")}
          onClose={() => setDialog(false)}
          actions={(
            <>
              <Button onClick={() => setDialog(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={() => setDialog(false)}>{t("common.save")}</Button>
            </>
          )}
        >
          <Field label={t("gallery.username")}><Input placeholder="hs.ornek" /></Field>
          <Note tone="info">{t("gallery.auditNote")}</Note>
        </Modal>
      </Sub>
    </Section>
  );
}
