// src/live/ui/index.js — the live UI's base components, for screens to import from one place.
//
// Tones, by component. Each keeps its own table, and a tone it does not have falls back:
//   Tag          neutral | warn | crit                          -> neutral
//   StatusPill   crit | high | mid | low | ok | att | neutral    -> neutral   (STATUS_TONES)
//   Note         warn | info                                     -> warn
//   Alert        crit | info                                     -> crit
//   toast()      ok | warn | error                               -> ok
//   riskStyle    an engine risk -> a StatusPill tone; an unknown risk -> att (attention), never ok
// Callers pass only a tone the component has: the fallbacks are a safety net, not a vocabulary.
export { Icon } from "./Icon.jsx";
export { ICON_NAMES } from "./icons.js";
export { FOCUS_RING } from "./focus.js";
export { Button } from "./Button.jsx";
export { Box } from "./Box.jsx";
export { Note } from "./Note.jsx";
export { Alert } from "./Alert.jsx";
export { Empty } from "./Empty.jsx";
export { KV, KVList } from "./KV.jsx";
export { Tag, Pill, StatusPill, STATUS_TONES } from "./Tag.jsx";
export { riskStyle, ENGINE_RISKS } from "./riskStyle.js";
export { RiskPill } from "./RiskPill.jsx";
export { Seg } from "./Seg.jsx";
export { Tabs, TabPanel } from "./Tabs.jsx";
export { Field, Input, Select } from "./Field.jsx";
export { Table } from "./Table.jsx";
export { Modal, MODAL_EXEMPT, MODAL_OPEN } from "./Modal.jsx";
export { ToastProvider, useToast, TOAST_MS, TOAST_WARN_MS, TOAST_MAX } from "./Toast.jsx";
