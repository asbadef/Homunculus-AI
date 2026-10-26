// src/live/screens/kabul/KabulScreen.jsx — "Hasta Kabul" (Group 2 · B1a, spec §5.1): Kabul ·
// Taburcu · Yataklar, each gated by the rights it acts with. The route opens to any of
// `admissions.view`, `admissions.admit`, `admissions.discharge.confirm`, `beds.release`
// (shell/routes.js); a tab this session may not open is not shown, and the screen opens on the
// first it may. Writes inside a tab are gated again by their own right; the server checks all.
//
// The tab is held in state, not in the address, as the administration screen holds its own
// (AdminScreen.jsx): nothing in the product links to a tab.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Empty, TabPanel, Tabs } from "../../ui/index.js";
import { AdmitTab } from "./AdmitTab.jsx";
import { DischargeTab } from "./DischargeTab.jsx";
import { BedsTab } from "./BedsTab.jsx";

const TAB_ID = "kabul";

/** The three tabs, in order: the id, the rights that open it (any one), its label, its screen. */
export const KABUL_TABS = Object.freeze([
  Object.freeze({ id: "admit", perms: Object.freeze(["admissions.admit", "admissions.view"]), labelKey: "kabul.tabAdmit", Tab: AdmitTab }),
  Object.freeze({ id: "discharge", perms: Object.freeze(["admissions.view", "admissions.discharge.confirm"]), labelKey: "kabul.tabDischarge", Tab: DischargeTab }),
  Object.freeze({ id: "beds", perms: Object.freeze(["admissions.view", "beds.release"]), labelKey: "kabul.tabBeds", Tab: BedsTab }),
]);

export const kabulTabs = (perms) => KABUL_TABS.filter((tab) => tab.perms.some((key) => perms?.includes(key)));

export function KabulScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const tabs = useMemo(() => kabulTabs(user?.perms), [user?.perms]);
  const [tab, setTab] = useState(() => tabs[0]?.id ?? null);
  const current = tabs.find((x) => x.id === tab) ?? tabs[0] ?? null;
  const shown = tabs.map((x) => ({ value: x.id, label: t(x.labelKey) }));
  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-23 font-bold">{t("kabul.title")}</h1>
        <p className="m-0 text-13 text-mute">{t("kabul.sub")}</p>
      </div>
      {current === null ? <Empty icon="shield">{t("kabul.noAccess")}</Empty> : (
        <>
          <Tabs id={TAB_ID} label={t("kabul.sections")} tabs={shown} value={current.id} onChange={setTab} />
          <TabPanel id={TAB_ID} tabs={shown} value={current.id}>
            <current.Tab />
          </TabPanel>
        </>
      )}
    </div>
  );
}
