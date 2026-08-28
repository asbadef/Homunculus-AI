/// <reference types="jest" />
import { sparklinePath } from "../src/domain/sparkline";

const box = { width: 100, height: 10 };

describe("sparklinePath", () => {
  it("draws nothing for fewer than two points", () => {
    expect(sparklinePath([], box)).toBe("");
    expect(sparklinePath([5], box)).toBe("");
  });

  it("maps the range onto the box with y inverted", () => {
    expect(sparklinePath([0, 1], box)).toBe("M0,10 L100,0");
  });

  it("draws a flat series down the middle instead of dividing by zero", () => {
    expect(sparklinePath([3, 3, 3], box)).toBe("M0,5 L50,5 L100,5");
  });

  it("insets the drawing by the padding on both axes", () => {
    expect(sparklinePath([0, 1], { width: 100, height: 10, padding: 2 })).toBe("M2,8 L98,2");
  });
});
