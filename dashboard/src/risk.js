const LABELS = { critical: "Kritik", high: "Yüksek", moderate: "Orta", low: "Düşük", none: "Stabil" };
const COLORS = { critical: "#c0392b", high: "#c0392b", moderate: "#e0a800", low: "#e0a800", none: "#2e7d32" };

export function riskLabel(risk) {
  return LABELS[risk] ?? risk;
}

export function riskColor(risk) {
  return COLORS[risk] ?? "#777";
}
