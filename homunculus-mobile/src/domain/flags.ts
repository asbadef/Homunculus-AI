import type { MessageKey } from "../i18n";
import { tr } from "../i18n/tr";
import type { BoardAlert, Severity } from "../transport/types";

// M5: the condition flag shown on a bed card (M5's MonitorTile; M6's BedCard, unchanged here). A
// pure, tested lookup rather than inline ternary
// chains, because it has three genuinely different cases:
//   - no alert at all -> the bed is stable ("flag.stable")
//   - an alert whose kind the catalogue has a name for -> that finding's own name ("kind.<kind>")
//   - an alert whose kind is NOT yet named (a rule the mobile UI hasn't been taught to label) ->
//     falling back to "flag.stable" would claim a calm bed that has an open alert, which is worse
//     than showing something. `risk.<severity>` always exists (six entries, one per Severity/Risk
//     value) and is at least honestly "this bed has a problem of this severity", not a false-calm
//     mislabel.
//
// M6/Task 4: the kind+severity half of that lookup is shared with `BoardNotification` (same field
// names/types, different interface) — NotificationFeed and AlertToast both put a finding's own
// name on a solid severity pill now, the same way BedCard/AlertCard already do, so the lookup is
// split out as `flagKeyForKind` rather than duplicated three times.
export function flagKeyForKind(kind: string, severity: Severity): MessageKey {
  const kindKey = `kind.${kind}` as MessageKey;
  if (kindKey in tr) return kindKey;
  return `risk.${severity}` as MessageKey;
}

export function flagKeyFor(top: BoardAlert | null): MessageKey {
  if (top === null) return "flag.stable";
  return flagKeyForKind(top.kind, top.severity);
}
