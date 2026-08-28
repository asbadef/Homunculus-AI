export interface SparklineBox {
  width: number;
  height: number;
  padding?: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** Series -> SVG path. Pure geometry: no component, no colour, no units. */
export function sparklinePath(values: readonly number[], box: SparklineBox): string {
  if (values.length < 2) return "";
  const pad = box.padding ?? 0;
  const width = box.width - pad * 2;
  const height = box.height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const x = (i: number) => pad + (width * i) / (values.length - 1);
  const y = (v: number) => (span === 0 ? pad + height / 2 : pad + height - ((v - min) / span) * height);

  return values.map((v, i) => `${i === 0 ? "M" : "L"}${round(x(i))},${round(y(v))}`).join(" ");
}
