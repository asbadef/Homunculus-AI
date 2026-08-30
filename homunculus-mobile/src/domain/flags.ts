import type { MessageKey } from "../i18n";
import { tr } from "../i18n/tr";
import type { BoardAlert } from "../transport/types";

// M5: the condition flag shown on a MonitorTile. A pure, tested lookup rather than inline ternary
// chains, because it has three genuinely different cases:
//   - no alert at all -> the bed is stable ("flag.stable")
//   - an alert whose kind the catalogue has a name for -> that finding's own name ("kind.<kind>")
//   - an alert whose kind is NOT yet named (a rule the mobile UI hasn't been taught to label) ->
//     falling back to "flag.stable" would claim a calm bed that has an open alert, which is worse
//     than showing something. `risk.<severity>` always exists (six entries, one per Severity/Risk
//     value) and is at least honestly "this bed has a problem of this severity", not a false-calm
//     mislabel.
export function flagKeyFor(top: BoardAlert | null): MessageKey {
  if (top === null) return "flag.stable";
  const kindKey = `kind.${top.kind}` as MessageKey;
  if (kindKey in tr) return kindKey;
  return `risk.${top.severity}` as MessageKey;
}
