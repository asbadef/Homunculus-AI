// «Monitör–yatak eşleme»: the list's reads are numbered (a stale answer is dropped), paused in a hidden
// tab, and never stacked behind a slow one (Task 17 review). Apart from MappingSection.test.jsx because
// the dialog is replaced here by a stand-in that ends a change as MappingDialog does (`onDone(text, fresh)`,
// `onClose`), which a stale-answer test needs and which the real dialog's own test (MappingDialog.test.jsx)
// must not inherit. That test keeps the real dialog to the same contract, in its last `describe` (A-20).
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { expectNoUuid } from "../kabul/kabul.testutil.js";
import { ANNOUNCE_DELAY_MS } from "../../ui/index.js";
import { device, list, mountMapping, onBed } from "./esleme.testutil.js";
import { MappingSection } from "./MappingSection.jsx";

// What a finished change hands the section: the list the server answered it with.
const { FRESH } = vi.hoisted(() => ({
  FRESH: {
    stage: "shadow", generated_at: "2026-10-30T09:20:00+00:00", can_bind: true,
    devices: [{ source: "192.0.2.11", group: "224.0.2.11", port: 2050, device_bed_label: "BED05", seen: true, status: "streaming",
      last_seen_at: null, row_id: 9, editable: true,
      bed: { id: "55555555-5555-4555-8555-555555555509", in_scope: true, label: "9", room: "Otaq 3", unit: "Reanimasiya" } }],
  },
}));
vi.mock("./MappingDialog.jsx", async () => {
  const { createElement: h } = await import("react");
  return {
    MappingDialog: ({ onDone, onClose }) => h("div", { role: "dialog", "aria-label": "stand-in" },
      h("button", { type: "button", onClick: () => onDone("said", FRESH) }, "done with the list"),
      h("button", { type: "button", onClick: () => onDone("said") }, "done"),
      h("button", { type: "button", onClick: onClose }, "close")),
  };
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const rowOf = (source) => screen.getByText(new RegExp(`^${source.replace(/\./g, "\\.")}`)).closest("tr");

const OLD = list([device("192.0.2.11", { device_bed_label: "BED05", row_id: 1, bed: onBed(1, "1") }), device("192.0.2.13")]);
const NEW = list([device("192.0.2.11", { device_bed_label: "BED05", row_id: 7, bed: onBed(5, "5", "Otaq 2") }), device("192.0.2.13")]);

describe("the list's reads are numbered", () => {
  it("drops the older answer when two reads resolve out of order", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { body: OLD });
    const a = deferred();
    const b = deferred();
    mounted.api.deviceBeds.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await tick(5000);                                                        // the poll: read A is out
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });   // the tab is seen again: read B
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(3);
    await act(async () => { b.resolve(NEW); });
    expect(within(rowOf("192.0.2.11")).getByText("5 · Otaq 2 · Reanimasiya")).toBeTruthy();
    await act(async () => { a.resolve(OLD); });                              // the older read lands last
    expect(within(rowOf("192.0.2.11")).getByText("5 · Otaq 2 · Reanimasiya")).toBeTruthy();
    expect(screen.queryByText("1 · Otaq 1 · Reanimasiya")).toBeNull();
  });

  it("drops a read that was out when a finished change handed the section its fresh list", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { body: OLD });
    const late = deferred();
    mounted.api.deviceBeds.mockReturnValueOnce(late.promise);
    await tick(5000);                                                        // a read started before the change
    fireEvent.click(within(rowOf("192.0.2.13")).getByRole("button", { name: "Çarpayıya qoş: 192.0.2.13" }));
    fireEvent.click(screen.getByRole("button", { name: "done with the list" }));
    expect(within(rowOf("192.0.2.11")).getByText("9 · Otaq 3 · Reanimasiya")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(2);                      // the fresh list has one monitor
    await act(async () => { late.resolve(OLD); });                           // the old bed arrives after the bind
    expect(within(rowOf("192.0.2.11")).getByText("9 · Otaq 3 · Reanimasiya")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.queryByText("1 · Otaq 1 · Reanimasiya")).toBeNull();
    expectNoUuid();
  });

  it("drops a read that was out when a finished change asked for a new one", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { body: OLD });
    const late = deferred();
    mounted.api.deviceBeds.mockReturnValueOnce(late.promise).mockResolvedValue(NEW);
    await tick(5000);
    fireEvent.click(within(rowOf("192.0.2.13")).getByRole("button", { name: "Çarpayıya qoş: 192.0.2.13" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "done" })); });
    expect(within(rowOf("192.0.2.11")).getByText("5 · Otaq 2 · Reanimasiya")).toBeTruthy();
    await act(async () => { late.resolve(OLD); });
    expect(within(rowOf("192.0.2.11")).getByText("5 · Otaq 2 · Reanimasiya")).toBeTruthy();
    expect(screen.queryByText("1 · Otaq 1 · Reanimasiya")).toBeNull();
  });

  it("drops a failure of an older read as well as its answer", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { body: OLD });
    const a = deferred();
    const b = deferred();
    mounted.api.deviceBeds.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await tick(5000);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { b.resolve(NEW); });
    await act(async () => { a.reject(Object.assign(new Error("down"), { status: 503 })); });
    expect(screen.queryByText(/Uyğunlaşdırma siyahısı oxunmadı/)).toBeNull();
    expect(within(rowOf("192.0.2.11")).getByText("5 · Otaq 2 · Reanimasiya")).toBeTruthy();
  });

  it("does not stack a poll behind a read that is still out, and reads again once it lands", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { body: OLD });
    const slow = deferred();
    mounted.api.deviceBeds.mockReturnValueOnce(slow.promise).mockResolvedValue(NEW);
    await tick(5000);
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(2);
    await tick(10000);                                                       // two ticks while it is out
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(2);
    await act(async () => { slow.resolve(OLD); });                           // nothing newer was asked for: it counts
    expect(within(rowOf("192.0.2.11")).getByText("1 · Otaq 1 · Reanimasiya")).toBeTruthy();
    await tick(5000);
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(3);
    expect(within(rowOf("192.0.2.11")).getByText("5 · Otaq 2 · Reanimasiya")).toBeTruthy();
  });

  // On React 18.3 a state update after unmount warns nothing, so this cannot fail for the `alive` guard's sake: it
  // pins what a reader can see, which is no throw and nothing on the page once the section has left (A-20). The
  // guard itself stays (it also keeps a late read from touching a section that is gone).
  it("throws nothing and leaves no list behind when a read lands after the section has left the screen", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mounted = await mountMapping(<MappingSection />, { body: OLD });
    const late = deferred();
    mounted.api.deviceBeds.mockReturnValueOnce(late.promise);
    await tick(5000);
    cleanup();
    await act(async () => { late.resolve(NEW); });
    expect(errors).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).not.toContain("192.0.2.11");
  });
});

// `said` is announced by a live region that speaks only when its text CHANGES: the same sentence twice in a row
// (two monitors unbound one after the other, each «Dəyişiklik yoxdur») has to be spoken twice (A-20).
describe("what a finished change says", () => {
  const status = () => within(screen.getByRole("region", { name: "Monitor–çarpayı uyğunlaşdırması" })).getByRole("status");
  const finishOne = async () => {
    fireEvent.click(within(rowOf("192.0.2.13")).getByRole("button", { name: "Çarpayıya qoş: 192.0.2.13" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "done" })); });
  };

  it("announces the sentence once the live region has had time to take it", async () => {
    vi.useFakeTimers();
    await mountMapping(<MappingSection />, { body: OLD });
    await finishOne();
    expect(status().textContent).toBe("");
    await tick(ANNOUNCE_DELAY_MS + 1);
    expect(status().textContent).toBe("said");
  });

  it("announces the same sentence again when a second change ends with it", async () => {
    vi.useFakeTimers();
    await mountMapping(<MappingSection />, { body: OLD });
    await finishOne();
    await tick(ANNOUNCE_DELAY_MS + 1);
    expect(status().textContent).toBe("said");
    await finishOne();                                                       // the very same text, straight after
    expect(status().textContent).toBe("");                                   // the region was emptied: its text will CHANGE
    await tick(ANNOUNCE_DELAY_MS + 1);
    expect(status().textContent).toBe("said");
  });
});

describe("the list rests in a hidden tab", () => {
  it("reads nothing while the page is hidden, and reads at once when it is seen again", async () => {
    vi.useFakeTimers();
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const mounted = await mountMapping(<MappingSection />, { body: OLD });
    expect(mounted.api.deviceBeds).not.toHaveBeenCalled();
    expect(screen.getByText("Uyğunlaşdırma siyahısı yüklənir…")).toBeTruthy();
    await tick(15000);
    expect(mounted.api.deviceBeds).not.toHaveBeenCalled();
    state.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("table", { name: "Monitorlar və çarpayıları" })).toBeTruthy();
    await tick(5000);
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(2);
  });

  it("stops reading when the page is hidden after it had been read, and ignores a change to hidden", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { body: OLD });
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(1);
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(15000);
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("table", { name: "Monitorlar və çarpayıları" })).toBeTruthy();   // what it showed stays
    state.mockRestore();
  });

  it("takes a document that says hidden for hidden, whatever visibilityState says", async () => {
    vi.useFakeTimers();
    const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    try {
      const mounted = await mountMapping(<MappingSection />, { body: OLD });
      await tick(10000);
      expect(mounted.api.deviceBeds).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(document, "hidden", descriptor); else delete document.hidden;
    }
  });

  it("stops listening for the page being seen again when the section leaves the screen", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { body: OLD });
    cleanup();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(15000);
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(1);
  });
});
