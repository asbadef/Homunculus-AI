// The monitor→bed dialog (spec §3.3–§3.6, O5, amendments A-1, A-4, A-17, A-20): pick → confirm → (bed_occupied)
// a second step naming the patient only as «Ahmet Y.», each time beside the bed's label; unbind; mapping_changed
// reloads; refusals by code and beside the bed they concern; no UUID, no patient number, no name anywhere
// but that second step. Synthetic patients only; the screen speaks az (the default).
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { board, entry, identity } from "../../data/board.testutil.js";
import { BED, expectNoUuid, settle, toasts } from "../kabul/kabul.testutil.js";
import { device, list, mountMapping, onBed } from "./esleme.testutil.js";
import { MappingDialog } from "./MappingDialog.jsx";
import { MappingSection } from "./MappingSection.jsx";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });

const WARD = list([
  device("192.0.2.11", { device_bed_label: "BED05", row_id: 1, bed: onBed(1, "1") }),
  device("192.0.2.13"),
]);
const refusal = (apiCode, extra = {}) => Object.assign(new Error("English words"), { status: 409, apiCode, ...extra });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

// A board card for a synthetic patient lying on one of the ward's beds (the dialog finds them by the refusal's
// `patient_id`, never by bed).
const card = (id, displayName, bed) => entry(id, [], {
  identity: identity({ patient_id: id, display_name: displayName, bed_id: BED(bed) }) });
const AHMET = card("H2600042", "Ahmet Yılmaz", 2);
const MAMMADOV = card("H2600043", "Məmmədov Əli Həsən oğlu", 1);

async function open(name, setup, patients = [AHMET]) {
  const mounted = await mountMapping(<MappingSection />, { body: WARD, setup: (api) => {
    api.boardPatients.mockResolvedValue(board(patients));
    setup?.(api);
  } });
  await act(async () => { await mounted.board.start(); });
  // The button has focus when it is pressed, as it has for a keyboard user (and for a mouse in most browsers): the
  // dialog hands focus back to it, or to the row, when it ends.
  const opener = screen.getByRole("button", { name });
  opener.focus();
  fireEvent.click(opener);
  await settle();
  return { ...mounted, dialog: () => screen.getByRole("dialog") };
}

async function pickAndConfirm(dialog, bed) {
  fireEvent.click(within(dialog()).getByRole("radio", { name: new RegExp(`^${bed}`) }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Davam" }));
  await settle();
}

const press = async (dialog, name) => {
  fireEvent.click(within(dialog()).getByRole("button", { name }));
  await settle();
};

// The real dialog on its own, as MappingSection mounts it: `onDone(text, fresh)` ends a change, `onClose` leaves it.
async function standalone({ mode = "bind", on = device("192.0.2.13"), devices = WARD.devices, setup } = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const mounted = await mountMapping(
    <MappingDialog mode={mode} device={on} devices={devices} onClose={onClose} onDone={onDone} />,
    { setup: (api) => { api.boardPatients.mockResolvedValue(board([AHMET, MAMMADOV])); setup?.(api); } },
  );
  await act(async () => { await mounted.board.start(); });
  return { ...mounted, onDone, onClose, dialog: () => screen.getByRole("dialog") };
}

describe("the monitor–bed dialog", () => {
  it("offers the session's beds, dims a closed one and names a bed's monitor and fullness", async () => {
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13");
    const d = within(dialog());
    expect(d.getByRole("heading", { name: "Çarpayı seçin — 192.0.2.13" })).toBeTruthy();
    expect(d.getByRole("radio", { name: /^1 · Otaq 1 · Reanimasiya.*monitor: 192\.0\.2\.11 \(BED05\)/ })).toBeTruthy();
    expect(d.getByRole("radio", { name: /^2 · Otaq 1 · Reanimasiya.*dolu/ })).toBeTruthy();
    expect(d.getByRole("radio", { name: /^4 · Otaq 1 · Reanimasiya.*bağlı/ }).disabled).toBe(true);
    expect(d.getByRole("radio", { name: /^N1 · N-1 · Neonatal.*bağlı/ }).disabled).toBe(true);   // its unit is closed
    expectNoUuid();
  });

  it("holds «Davam» until a bed is picked, and lists the beds in the order a reader sees them", async () => {
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13");
    const next = within(dialog()).getByRole("button", { name: "Davam" });
    expect(next.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(next);
    expect(within(dialog()).getByRole("group", { name: "Çarpayılar" })).toBeTruthy();         // the radios are one group
    expect(screen.getByRole("heading", { name: "Çarpayı seçin — 192.0.2.13" })).toBeTruthy();   // still the pick
    // by unit, then room, then label with its numbers by value: a unit's beds stay together
    expect(within(dialog()).getAllByRole("radio").map((r) => r.closest("label").textContent.split(" · ")[0]))
      .toEqual(["N1", "1", "2", "3", "4", "5"]);
    fireEvent.click(within(dialog()).getByRole("radio", { name: /^1 · Otaq 1/ }));
    expect(within(dialog()).getByRole("button", { name: "Davam" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("confirms naming both monitors, then sends what the screen saw", async () => {
    const { dialog, api } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockResolvedValue({ changed: true, replaced_source: "192.0.2.11", list: WARD });
    });
    await pickAndConfirm(dialog, "1 · Otaq 1");
    expect(within(dialog()).getByText("192.0.2.13 → 1 · Otaq 1 · Reanimasiya")).toBeTruthy();
    expect(within(dialog()).getByText("192.0.2.11 (BED05) bu çarpayıdan ayrılacaq.")).toBeTruthy();
    expect(api.bindDeviceBed).not.toHaveBeenCalled();                   // nothing before the last confirm
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(api.bindDeviceBed).toHaveBeenCalledTimes(1);
    expect(api.bindDeviceBed).toHaveBeenCalledWith({ source: "192.0.2.13", bed_id: BED(1), confirm_occupied: false,
      expected: { device_row_id: null, bed_row_id: 1 } });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toasts().getAllByText("192.0.2.13 çarpayıya qoşuldu: 1 · Otaq 1 · Reanimasiya").length).toBeGreaterThan(0);
  });

  it("names the bed a bound monitor leaves, and sends both rows it saw", async () => {
    const { dialog, api } = await open("Başqa çarpayıya qoş: 192.0.2.11 (BED05)", (a) => {
      a.bindDeviceBed.mockResolvedValue({ changed: true, replaced_source: null, list: WARD });
    });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    expect(within(dialog()).getByText("192.0.2.11 (BED05) → 5 · Otaq 2 · Reanimasiya")).toBeTruthy();
    expect(within(dialog()).getByText("Monitor bu çarpayıdan ayrılacaq: 1 · Otaq 1 · Reanimasiya.")).toBeTruthy();
    expect(within(dialog()).queryByText(/bu çarpayıdan ayrılacaq\.$/)).toBeNull();           // no other monitor on bed 5
    await press(dialog, "Təsdiqlə");
    expect(api.bindDeviceBed).toHaveBeenCalledWith({ source: "192.0.2.11", bed_id: BED(5), confirm_occupied: false,
      expected: { device_row_id: 1, bed_row_id: null } });
  });

  it("never offers the bed a monitor is already on", async () => {
    const { dialog } = await open("Başqa çarpayıya qoş: 192.0.2.11 (BED05)");
    expect(within(dialog()).queryByRole("radio", { name: /^1 · Otaq 1/ })).toBeNull();
    expect(within(dialog()).getAllByRole("radio")).toHaveLength(5);
  });

  it("opens the second step on bed_occupied, names the patient only as «Ahmet Y.» beside the bed, and resends with the confirmation", async () => {
    const { dialog, api } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValueOnce(refusal("bed_occupied", { occupied: [{ bed_id: BED(2), patient_id: "H2600042" }] }))
        .mockResolvedValueOnce({ changed: true, replaced_source: null, list: WARD });
    });
    await pickAndConfirm(dialog, "2 · Otaq 1");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(within(dialog()).getByRole("heading", { name: "Bu çarpayıda xəstə yatır" })).toBeTruthy();
    expect(within(dialog()).getByText("Çarpayıda: 2 · Otaq 1 · Reanimasiya · Ahmet Y.")).toBeTruthy();
    expect(within(dialog()).getByText(/axmağa başlayacaq/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "İmtina" }));
    expect(document.body.textContent).not.toMatch(/H2600042|Yılmaz/);
    expect(api.bindDeviceBed).toHaveBeenCalledTimes(1);                  // the second step is its own confirm
    fireEvent.click(within(dialog()).getByRole("button", { name: "Bəli, davam et" }));
    await settle();
    expect(api.bindDeviceBed).toHaveBeenCalledTimes(2);
    expect(api.bindDeviceBed.mock.calls[1][0]).toEqual({ source: "192.0.2.13", bed_id: BED(2), confirm_occupied: true,
      expected: { device_row_id: null, bed_row_id: null } });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Ahmet|Yılmaz|H2600042/);        // the name leaves with the step
  });

  it("says only that a patient is there, beside the bed, when the session's board has no card for them", async () => {
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(refusal("bed_occupied", { occupied: [{ bed_id: BED(5) }] }));
    });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(within(dialog()).getByText("5 · Otaq 2 · Reanimasiya: Bu çarpayıda yatan xəstə var.")).toBeTruthy();
    expect(within(dialog()).getByText(/axmağa başlayacaq/)).toBeTruthy();
  });

  it("says so the same way for a card with a patient the board knows by no name", async () => {
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(refusal("bed_occupied", { occupied: [{ bed_id: BED(2), patient_id: "H2600042" }] }));
    }, [card("H2600042", null, 2)]);
    await pickAndConfirm(dialog, "2 · Otaq 1");
    await press(dialog, "Təsdiqlə");
    expect(within(dialog()).getByText("2 · Otaq 1 · Reanimasiya: Bu çarpayıda yatan xəstə var.")).toBeTruthy();
  });

  it("names each occupied bed on its own line, the target first, with what happens to that bed's card", async () => {
    const { dialog, api } = await open("Başqa çarpayıya qoş: 192.0.2.11 (BED05)", (a) => {
      a.bindDeviceBed.mockRejectedValueOnce(refusal("bed_occupied", { occupied: [
        { bed_id: BED(2), patient_id: "H2600042" }, { bed_id: BED(1), patient_id: "H2600043" }] }))
        .mockResolvedValueOnce({ changed: true, replaced_source: null, list: WARD });
    }, [AHMET, MAMMADOV]);
    await pickAndConfirm(dialog, "2 · Otaq 1");
    await press(dialog, "Təsdiqlə");
    const target = within(dialog()).getByText("Çarpayıda: 2 · Otaq 1 · Reanimasiya · Ahmet Y.").closest("li");
    const left = within(dialog()).getByText("Çarpayıda: 1 · Otaq 1 · Reanimasiya · Məmmədov Ə. H.").closest("li");
    expect(target.compareDocumentPosition(left) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(target).getByText(/axmağa başlayacaq/)).toBeTruthy();        // the target bed's patient gets the values
    expect(within(left).getByText(/axmağı dayandıracaq/)).toBeTruthy();        // the bed it leaves loses them
    expect(within(dialog()).queryByText(/Əli|Həsən|oğlu/)).toBeNull();          // never the whole name
    await press(dialog, "Bəli, davam et");
    expect(api.bindDeviceBed.mock.calls[1][0]).toEqual({ source: "192.0.2.11", bed_id: BED(2), confirm_occupied: true,
      expected: { device_row_id: 1, bed_row_id: null } });
  });

  it("asks the same second question when an unbind would stop the values of an admitted patient", async () => {
    const { dialog, api } = await open("Bağlantını kəs: 192.0.2.11 (BED05)", (a) => {
      a.unbindDeviceBed.mockRejectedValueOnce(refusal("bed_occupied", { occupied: [{ bed_id: BED(1), patient_id: "H2600043" }] }))
        .mockResolvedValueOnce({ changed: true, replaced_source: null, list: WARD });
    }, [AHMET, MAMMADOV]);
    await press(dialog, "Təsdiqlə");
    expect(within(dialog()).getByText("Çarpayıda: 1 · Otaq 1 · Reanimasiya · Məmmədov Ə. H.")).toBeTruthy();
    expect(within(dialog()).getByText(/axmağı dayandıracaq/)).toBeTruthy();
    expect(within(dialog()).queryByText(/axmağa başlayacaq/)).toBeNull();
    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "İmtina" }));
    await press(dialog, "Bəli, davam et");
    expect(api.unbindDeviceBed).toHaveBeenCalledTimes(2);
    expect(api.unbindDeviceBed.mock.calls[1][0]).toEqual({ source: "192.0.2.11", confirm_occupied: true,
      expected: { device_row_id: 1 } });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes nothing when the second step is declined", async () => {
    const { dialog, api } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(refusal("bed_occupied", { occupied: [{ bed_id: BED(2), patient_id: "H2600042" }] }));
    });
    await pickAndConfirm(dialog, "2 · Otaq 1");
    await press(dialog, "Təsdiqlə");
    await press(dialog, "İmtina");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.bindDeviceBed).toHaveBeenCalledTimes(1);
    expect(api.bindDeviceBed.mock.calls[0][0].confirm_occupied).toBe(false);
    expect(document.body.textContent).not.toMatch(/Ahmet|Yılmaz/);
  });

  it("never lets the short name, or the patient's number, into a request, a toast or the console", async () => {
    const spies = ["log", "info", "warn", "error", "debug"].map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const { dialog, api } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValueOnce(refusal("bed_occupied", { occupied: [{ bed_id: BED(2), patient_id: "H2600042" }] }))
        .mockResolvedValueOnce({ changed: true, replaced_source: null, list: WARD });
    });
    await pickAndConfirm(dialog, "2 · Otaq 1");
    await press(dialog, "Təsdiqlə");
    await press(dialog, "Bəli, davam et");
    expect(JSON.stringify(api.bindDeviceBed.mock.calls)).not.toMatch(/Ahmet|Yılmaz|H2600042/);
    expect(toasts().getAllByText(/çarpayıya qoşuldu/).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Bildirişlər" }).textContent).not.toMatch(/Ahmet|Yılmaz|H2600042/);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Ahmet|Yılmaz|H2600042/);
  });

  it("unbinds after one confirmation naming the monitor and its bed", async () => {
    const { dialog, api } = await open("Bağlantını kəs: 192.0.2.11 (BED05)", (a) => {
      a.unbindDeviceBed.mockResolvedValue({ changed: true, replaced_source: null, list: WARD });
    });
    expect(within(dialog()).getByText("192.0.2.11 (BED05) ilə 1 · Otaq 1 · Reanimasiya arasındakı bağlantı kəsiləcək.")).toBeTruthy();
    expect(api.unbindDeviceBed).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(api.unbindDeviceBed).toHaveBeenCalledWith({ source: "192.0.2.11", confirm_occupied: false,
      expected: { device_row_id: 1 } });
    expect(toasts().getAllByText("192.0.2.11 (BED05) bağlantısı kəsildi").length).toBeGreaterThan(0);
  });

  it("says «no change» when the server finds it already so", async () => {
    const { dialog } = await open("Bağlantını kəs: 192.0.2.11 (BED05)", (a) => {
      a.unbindDeviceBed.mockResolvedValue({ changed: false, replaced_source: null, list: WARD });
    });
    await press(dialog, "Təsdiqlə");
    expect(toasts().getAllByText("Dəyişiklik yoxdur: artıq belədir.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("prints no UUID or patient number at any of its steps", async () => {
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(refusal("bed_occupied", { occupied: [{ bed_id: BED(2), patient_id: "H2600042" }] }));
    });
    expectNoUuid();
    await pickAndConfirm(dialog, "2 · Otaq 1");
    expectNoUuid();
    await press(dialog, "Təsdiqlə");
    expectNoUuid();
    expect(document.body.textContent).not.toContain("H2600042");
  });
});

describe("refusals", () => {
  it("closes and reads the list again when the mapping changed meanwhile", async () => {
    const { dialog, api } = await open("Bağlantını kəs: 192.0.2.11 (BED05)", (a) => {
      a.unbindDeviceBed.mockRejectedValue(refusal("mapping_changed"));
    });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deviceBeds.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Bu arada dəyişdi/).length).toBeGreaterThan(0);
  });

  it("says any other refusal by its code, named after the monitor and the bed it concerns, never in the server's words", async () => {
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(Object.assign(new Error("English words"), { status: 403, apiCode: "out_of_scope" }));
    });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(screen.getAllByText(/192\.0\.2\.13.*sizin şöbələrinizdən birində deyil/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("192.0.2.13 · 5 · Otaq 2 · Reanimasiya: Bu çarpayı sizin şöbələrinizdən birində deyil.").length)
      .toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("English words");
    expect(screen.getByRole("dialog")).toBeTruthy();                       // nothing changed; the nurse reads and leaves
  });

  it("names the bed the monitor LEAVES when that is the one outside her units (A-17)", async () => {
    const away = list([device("192.0.2.14", { device_bed_label: "BEDN1", row_id: 4, bed: { id: BED(9), in_scope: false } })]);
    const mounted = await mountMapping(<MappingSection />, { body: away, setup: (api) => {
      api.boardPatients.mockResolvedValue(board([]));
      api.bindDeviceBed.mockRejectedValue(Object.assign(new Error("English words"), { status: 403, apiCode: "out_of_scope" }));
    } });
    fireEvent.click(screen.getByRole("button", { name: "Başqa çarpayıya qoş: 192.0.2.14 (BEDN1)" }));
    await settle();
    const dialog = () => screen.getByRole("dialog");
    await pickAndConfirm(dialog, "5 · Otaq 2");
    await press(dialog, "Təsdiqlə");
    expect(mounted.api.bindDeviceBed).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("192.0.2.14 (BEDN1) · başqa şöbədə: Bu çarpayı sizin şöbələrinizdən birində deyil.").length)
      .toBeGreaterThan(0);
    expect(screen.queryByText(/5 · Otaq 2 · Reanimasiya: Bu çarpayı sizin/)).toBeNull();      // not the target bed
  });

  it("names the bed an unbind concerns when it is refused for scope", async () => {
    const { dialog } = await open("Bağlantını kəs: 192.0.2.11 (BED05)", (a) => {
      a.unbindDeviceBed.mockRejectedValue(Object.assign(new Error("English words"), { status: 403, apiCode: "out_of_scope" }));
    });
    await press(dialog, "Təsdiqlə");
    expect(screen.getAllByText("192.0.2.11 (BED05) · 1 · Otaq 1 · Reanimasiya: Bu çarpayı sizin şöbələrinizdən birində deyil.").length)
      .toBeGreaterThan(0);
  });

  it.each([
    ["bed_closed", 409, "Bu çarpayı, onun otağı və ya şöbəsi bağlıdır."],
    ["device_unknown", 404, "Bu monitoru şəbəkə toplayıcısı bildirmir."],
    ["monitor_lane_off", 409, "Monitor zolağı bu xəstəxana üçün işləmir; uyğunlaşdırma indi dəyişdirilə bilməz."],
  ])("says %s by its code, after the monitor", async (apiCode, status, sentence) => {
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(Object.assign(new Error("English words"), { status, apiCode }));
    });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    await press(dialog, "Təsdiqlə");
    expect(screen.getAllByText(`192.0.2.13: ${sentence}`).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("English words");
  });

  it("says an uncoded 404 by its status, in the reader's language", async () => {
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(Object.assign(new Error("Bed not found."), { status: 404 }));
    });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    await press(dialog, "Təsdiqlə");
    expect(screen.getAllByText("192.0.2.13: Sorğu uğursuz oldu (404).").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Bed not found.");
  });

  it("closes and reads the list again when a change got no answer, saying it may have gone through", async () => {
    const { dialog, api } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(Object.assign(new Error("Bad gateway"), { status: 504 }));
    });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    const reads = api.deviceBeds.mock.calls.length;
    await press(dialog, "Təsdiqlə");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deviceBeds.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.getAllByText(/Dəyişiklik yenə də tətbiq olunmuş ola bilər/).length).toBeGreaterThan(0);
  });
});

describe("while a request is out", () => {
  it("holds both buttons, ignores a second press and Escape, and ends when the answer lands", async () => {
    const out = deferred();
    const { dialog, api } = await open("Bağlantını kəs: 192.0.2.11 (BED05)", (a) => {
      a.unbindDeviceBed.mockReturnValue(out.promise);
    });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    const ok = within(dialog()).getByRole("button", { name: "Təsdiqlə" });
    expect(ok.getAttribute("aria-busy")).toBe("true");
    expect(within(dialog()).getByRole("button", { name: "İmtina" }).getAttribute("aria-busy")).toBe("true");
    fireEvent.click(ok);
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(api.unbindDeviceBed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { out.resolve({ changed: true, replaced_source: null, list: WARD }); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("keyboard and focus", () => {
  it("cancels on Escape at every step, and sends nothing", async () => {
    const { dialog, api } = await open("Çarpayıya qoş: 192.0.2.13");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Çarpayıya qoş: 192.0.2.13" }));
    await settle();
    await pickAndConfirm(dialog, "5 · Otaq 2");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.bindDeviceBed).not.toHaveBeenCalled();
  });

  it("moves focus off the confirm button when «Davam» is pressed, so Enter twice cannot confirm", async () => {
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13");
    within(dialog()).getByRole("radio", { name: /^5 · Otaq 2/ }).focus();
    fireEvent.click(within(dialog()).getByRole("radio", { name: /^5 · Otaq 2/ }));
    const next = within(dialog()).getByRole("button", { name: "Davam" });
    next.focus();
    fireEvent.click(next);
    await settle();
    const ok = within(dialog()).getByRole("button", { name: "Təsdiqlə" });
    expect(document.activeElement).not.toBe(ok);
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the monitor's own button after a bind", async () => {
    const bound = list([WARD.devices[0], device("192.0.2.13", { row_id: 9, bed: onBed(5, "5", "Otaq 2") })]);
    const { dialog } = await open("Çarpayıya qoş: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockResolvedValue({ changed: true, replaced_source: null, list: bound });
    });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    await press(dialog, "Təsdiqlə");
    expect(screen.queryByRole("dialog")).toBeNull();
    // it now reads «Başqa çarpayıya qoş», on the same row
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Başqa çarpayıya qoş: 192.0.2.13" }));
  });

  it("puts focus on the row's remaining button when an unbind took away the one it started from", async () => {
    const unbound = list([device("192.0.2.11", { device_bed_label: "BED05", row_id: 8 }), device("192.0.2.13")]);
    const { dialog } = await open("Bağlantını kəs: 192.0.2.11 (BED05)", (a) => {
      a.unbindDeviceBed.mockResolvedValue({ changed: true, replaced_source: null, list: unbound });
    });
    await press(dialog, "Təsdiqlə");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /Bağlantını kəs/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Çarpayıya qoş: 192.0.2.11 (BED05)" }));
  });

  it("returns focus to the button it started from when the nurse leaves", async () => {
    const { dialog } = await open("Bağlantını kəs: 192.0.2.11 (BED05)");
    await press(dialog, "İmtina");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bağlantını kəs: 192.0.2.11 (BED05)" }));
  });
});

// MappingSection.poll.test.jsx drives the section with a stand-in that ends a change through `onDone(text, fresh)`
// and leaves it through `onClose`. This is the same contract kept by the real dialog (A-20).
describe("the contract MappingSection relies on", () => {
  it("ends a change with onDone(the sentence it said, the list the server answered with)", async () => {
    const answered = list([device("192.0.2.13", { row_id: 9, bed: onBed(5, "5", "Otaq 2") })]);
    const { dialog, onDone, onClose } = await standalone({ setup: (api) => {
      api.bindDeviceBed.mockResolvedValue({ changed: true, replaced_source: null, list: answered });
    } });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    await press(dialog, "Təsdiqlə");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("192.0.2.13 çarpayıya qoşuldu: 5 · Otaq 2 · Reanimasiya", answered);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says «no change» the same way: onDone(its sentence, the list)", async () => {
    const { dialog, onDone } = await standalone({ mode: "unbind", on: WARD.devices[0], setup: (api) => {
      api.unbindDeviceBed.mockResolvedValue({ changed: false, replaced_source: null, list: WARD });
    } });
    await press(dialog, "Təsdiqlə");
    expect(onDone).toHaveBeenCalledWith("Dəyişiklik yoxdur: artıq belədir.", WARD);
  });

  it("hands over no list when the mapping changed, so the section reads it again", async () => {
    const { dialog, onDone } = await standalone({ mode: "unbind", on: WARD.devices[0], setup: (api) => {
      api.unbindDeviceBed.mockRejectedValue(refusal("mapping_changed"));
    } });
    await press(dialog, "Təsdiqlə");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toMatch(/Bu arada dəyişdi/);
    expect(onDone.mock.calls[0][1] ?? null).toBeNull();
  });

  it("calls onClose, and only onClose, when the nurse leaves: «İmtina», Escape, and the ✕", async () => {
    const { dialog, onDone, onClose } = await standalone();
    await press(dialog, "İmtina");
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Bağla" }));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("stays open, with onDone not called, on a refusal the nurse has to read", async () => {
    const { dialog, onDone, onClose } = await standalone({ setup: (api) => {
      api.bindDeviceBed.mockRejectedValue(Object.assign(new Error("English words"), { status: 409, apiCode: "bed_closed" }));
    } });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    await press(dialog, "Təsdiqlə");
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
