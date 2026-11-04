import { scalePoints } from "./trendMath";

test("maps min to bottom edge, max to top edge, inside the box", () => {
  const p = scalePoints([10, 20], 100, 50);
  expect(p[0].y).toBeCloseTo(50);
  expect(p[1].y).toBeCloseTo(0);
  expect(p[0].x).toBeCloseTo(0);
  expect(p[1].x).toBeCloseTo(100);
  expect(p.every((pt) => pt.y >= 0 && pt.y <= 50)).toBe(true);
});

test("flat series produces finite midline points (no divide-by-zero)", () => {
  const p = scalePoints([5, 5, 5], 90, 40);
  expect(p).toHaveLength(3);
  expect(p.every((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y))).toBe(true);
});
