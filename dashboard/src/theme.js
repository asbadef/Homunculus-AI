// Single source of truth for severity styling. Colour is never the only signal — callers pair it
// with an icon + label.
export const SEV = {
  info:     { text: "text-sev-info",     ring: "ring-sev-info/40",     dot: "bg-sev-info" },
  low:      { text: "text-sev-low",      ring: "ring-sev-low/40",      dot: "bg-sev-low" },
  moderate: { text: "text-sev-moderate", ring: "ring-sev-moderate/40", dot: "bg-sev-moderate" },
  high:     { text: "text-sev-high",     ring: "ring-sev-high/40",     dot: "bg-sev-high" },
  critical: { text: "text-sev-critical", ring: "ring-sev-critical/50", dot: "bg-sev-critical" },
};
export const sev = (s) => SEV[s] || SEV.info;
export const riskLabel = { none: "Stabil", low: "Düşük", high: "Yüksek", critical: "Kritik" };
