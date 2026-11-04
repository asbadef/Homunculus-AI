// Pure scaling for the result trend sparkline — no RN imports so it unit-tests in plain Jest.
export type Pt = { x: number; y: number };

export function scalePoints(series: number[], w: number, h: number): Pt[] {
  const n = series.length;
  if (n === 0) return [];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1; // flat series → avoid divide-by-zero
  return series.map((v, i) => ({
    x: n === 1 ? 0 : (i / (n - 1)) * w,
    y: h - ((v - min) / span) * h, // min at bottom (y=h), max at top (y=0)
  }));
}
