import { transport } from "./transport";
import { FEATURES, visibleFeatures } from "../config/features";

test("getResults returns typed rows including a pending one", async () => {
  const r = await transport.getResults();
  expect(r.length).toBeGreaterThan(0);
  expect(r[0]).toHaveProperty("values");
  expect(r.some((x) => x.status === "pending")).toBe(true);
});

test("only enabled features are visible, sorted by order", async () => {
  const vis = visibleFeatures(FEATURES);
  expect(vis.length).toBeGreaterThan(0);
  expect(vis.every((f) => f.enabled)).toBe(true);
  const orders = vis.map((f) => f.order);
  expect(orders).toEqual([...orders].sort((a, b) => a - b));
});

test("appointments and news fixtures exist", async () => {
  expect((await transport.getAppointments()).length).toBeGreaterThan(0);
  expect((await transport.getNews()).length).toBeGreaterThan(0);
});
