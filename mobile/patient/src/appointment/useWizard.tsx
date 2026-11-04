import React, { createContext, useContext, useState } from "react";

export type ForWhom = "self" | "other";
export type ApptType = "inperson" | "online" | "assistant";

export type WizardState = {
  forWhom: ForWhom;
  type: ApptType | null;
  hospitalId: string | null;
  departmentId: string | null;
  doctorId: string | null;
  date: string | null;
  time: string | null;
  insurance: string;
};

export const WIZARD_STEPS = ["tip", "hastane", "bolum", "doktor", "tarix", "ozet"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const initialWizard: WizardState = {
  forWhom: "self",
  type: null,
  hospitalId: null,
  departmentId: null,
  doctorId: null,
  date: null,
  time: null,
  insurance: "cari",
};

// Pure per-step guard. State lives in context (below), independent of language,
// so switching language mid-flow never clears a selection.
export function canContinue(step: WizardStep, s: WizardState): boolean {
  switch (step) {
    case "tip":
      return s.type !== null;
    case "hastane":
      return s.hospitalId !== null;
    case "bolum":
      return s.departmentId !== null;
    case "doktor":
      return s.doctorId !== null;
    case "tarix":
      return s.date !== null && s.time !== null;
    case "ozet":
      return true;
  }
}

type Ctx = { state: WizardState; set: (patch: Partial<WizardState>) => void; reset: () => void };
const WizardCtx = createContext<Ctx>({ state: initialWizard, set: () => {}, reset: () => {} });

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WizardState>(initialWizard);
  const set = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));
  const reset = () => setState(initialWizard);
  return <WizardCtx.Provider value={{ state, set, reset }}>{children}</WizardCtx.Provider>;
}

export const useWizard = () => useContext(WizardCtx);
