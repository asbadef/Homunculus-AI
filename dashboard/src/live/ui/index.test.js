// The barrel hands screens everything they need from one import: the dialog's markers and the
// toast limits included (Wave 1B left them out).
import { describe, it, expect } from "vitest";
import * as ui from "./index.js";

describe("ui/index.js", () => {
  it("exports the dialog markers and the toast constants", () => {
    expect(ui.MODAL_EXEMPT).toBe("data-modal-exempt");
    expect(ui.MODAL_OPEN).toBe("data-modal-open");
    expect(ui.TOAST_WARN_MS).toBeGreaterThan(ui.TOAST_MS);
    expect(ui.TOAST_MAX).toBe(5);
  });
});
