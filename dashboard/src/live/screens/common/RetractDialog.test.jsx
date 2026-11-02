// RetractDialog.test.jsx — «hatalı giriş»: it says which value and what a withdrawal does, waits for a reason of
// ten characters and for its arming window, sends the trimmed reason, and says the engine's answer on the toast,
// named after the bed (G3-01, D10, D11). Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { RETRACT_ARM_MS, RetractDialog } from "./RetractDialog.jsx";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const BED = "REA-01 · 2";
const CHARTABLE = ["board.view", "clinical.chart"];
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const WHAT = { label: "Tənəffüs", value: "26 /dəq", time: "10:00" };
const REASON = "  yazım hatası, 16 idi  ";

async function open(answer = () => Promise.resolve({ retracted: 41, code: "resp_rate", alerts: [] })) {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const onRetract = vi.fn(answer);
  const onDone = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    await mount(<RetractDialog bed={BED} what={WHAT} onRetract={onRetract} onDone={onDone} onClose={onClose} />,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }) });
    await settle();
  });
  return { onRetract, onDone, onClose };
}
const dialog = () => screen.getByRole("dialog", { name: `Səhv qeyd · ${BED}` });
const reason = (text) => fireEvent.change(within(dialog()).getByRole("textbox"), { target: { value: text } });
const confirm = () => act(async () => {
  fireEvent.click(within(dialog()).getByRole("button", { name: "Səhv qeyd kimi işarələ" }));
  await settle();
});
const armed = () => act(() => { vi.advanceTimersByTime(RETRACT_ARM_MS); });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("«hatalı giriş»", () => {
  it("says which value and what a withdrawal does, and waits for a reason of ten characters", async () => {
    const { onRetract } = await open();
    expect(dialog()).toHaveTextContent("Tənəffüs: 26 /dəq · ölçmə 10:00");
    expect(dialog()).toHaveTextContent("audit jurnalına yazılır");
    expect(dialog()).toHaveTextContent("0 / 10 simvol");
    armed();
    reason("  səhv  ");
    expect(dialog()).toHaveTextContent("4 / 10 simvol");
    await confirm();
    expect(onRetract).not.toHaveBeenCalled();
  });

  it("ignores a press in its first RETRACT_ARM_MS, then withdraws with the trimmed reason", async () => {
    const { onRetract, onDone, onClose } = await open();
    reason(REASON);
    await confirm();                                   // the opening double click's second press
    expect(onRetract).not.toHaveBeenCalled();
    armed();
    await confirm();
    expect(onRetract).toHaveBeenCalledWith("yazım hatası, 16 idi");
    expect(toasted("REA-01 · 2: Tənəffüs səhv qeyd kimi işarələndi.").length).toBeGreaterThan(0);
    expect(onDone).toHaveBeenCalledWith("retracted");
    expect(onClose).toHaveBeenCalled();
  });

  it("an entry another desk withdrew first is said in the reader's words, and the host reads again", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(409, "bu değer zaten hatalı giriş olarak işaretlenmiş")));
    armed();
    reason(REASON);
    await confirm();
    // Task 11 maps this sentence: until then the engine's Turkish is shown as written (the AZ text is «Bu dəyər artıq
    // səhv qeyd kimi işarələnib.»).
    expect(toasted("REA-01 · 2: işarələnmədi — bu değer zaten hatalı giriş olarak işaretlenmiş").length).toBeGreaterThan(0);
    expect(onDone).toHaveBeenCalledWith("already");
    expect(onClose).toHaveBeenCalled();
  });

  it("a reason the engine finds short keeps the dialog open, and nothing is read again", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(400, "gerekçe en az 10 karakter olmalı")));
    armed();
    reason(REASON);
    await confirm();
    // Task 11 maps this sentence: until then the engine's Turkish is shown as written (the AZ text is «Səbəb ən azı
    // 10 simvol olmalıdır.»).
    expect(toasted("REA-01 · 2: işarələnmədi — gerekçe en az 10 karakter olmalı").length).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a withdrawal that got no answer may have landed: she is told to look, and the host reads again", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(503, "down")));
    armed();
    reason(REASON);
    await confirm();
    expect(toasted(/^REA-01 · 2: cavab gəlmədi/).length).toBeGreaterThan(0);
    expect(onDone).toHaveBeenCalledWith("uncertain");
    expect(onClose).toHaveBeenCalled();
  });
});
