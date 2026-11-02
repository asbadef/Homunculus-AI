// RetractDialog.test.jsx — «hatalı giriş»: it says which value and what a withdrawal does, waits for a reason of
// ten characters and for its arming window, sends the trimmed reason, and says the engine's answer on the toast,
// named after the bed (G3-01, D10, D11). Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { RETRACT_ARM_MS, RETRACT_MAX_REASON_CHARS, RetractDialog } from "./RetractDialog.jsx";

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
// Enter in the reason box: the form's submit (user-event is not installed here, and jsdom has no implicit submission).
const enter = () => act(async () => {
  fireEvent.submit(within(dialog()).getByRole("textbox").closest("form"));
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
    expect(dialog()).toHaveTextContent("Səbəbə xəstənin adını və ya nömrəsini yazmayın.");   // the audit trail is plaintext and for good
    expect(dialog()).toHaveTextContent("0 / 10 simvol");
    armed();
    reason("  səhv  ");
    expect(dialog()).toHaveTextContent("4 / 10 simvol");
    await confirm();
    expect(onRetract).not.toHaveBeenCalled();
  });

  // G3-01 (final review, I1): the reason goes into the append-only audit trail for good, so the box stops at the
  // engine's ceiling, taken from the one constant the dialog also exports.
  it("stops the reason box at 200 characters, the engine's ceiling", async () => {
    await open();
    expect(RETRACT_MAX_REASON_CHARS).toBe(200);
    expect(within(dialog()).getByRole("textbox")).toHaveAttribute("maxlength", String(RETRACT_MAX_REASON_CHARS));
  });

  it("counts the ten characters after trimming: nine are held back, ten are sent trimmed", async () => {
    const { onRetract } = await open();
    armed();
    reason("   123456789   ");
    expect(dialog()).toHaveTextContent("9 / 10 simvol");
    await confirm();
    expect(onRetract).not.toHaveBeenCalled();
    reason("   1234567890   ");
    expect(dialog()).toHaveTextContent("10 / 10 simvol");
    await confirm();
    expect(onRetract).toHaveBeenCalledTimes(1);
    expect(onRetract).toHaveBeenCalledWith("1234567890");
  });

  it("Enter in the reason box presses the button: ignored in the arming window, a withdrawal after it", async () => {
    const { onRetract, onDone } = await open();
    reason(REASON);
    await enter();
    expect(onRetract).not.toHaveBeenCalled();
    armed();
    await enter();
    expect(onRetract).toHaveBeenCalledWith("yazım hatası, 16 idi");
    expect(onDone).toHaveBeenCalledWith("retracted");
  });

  // Focus lands on the reason box, so the value and the intro are never read unless the box describes itself by them.
  it("the reason box is described by the value line and by what a withdrawal does", async () => {
    await open();
    expect(within(dialog()).getByRole("textbox")).toHaveAccessibleDescription(
      /Tənəffüs: 26 \/dəq · ölçmə 10:00.*Əməliyyat audit jurnalına yazılır\./);
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
    expect(toasted("REA-01 · 2: işarələnmədi — Bu dəyər artıq səhv qeyd kimi işarələnib.").length).toBeGreaterThan(0);
    expect(onDone).toHaveBeenCalledWith("already");
    expect(onClose).toHaveBeenCalled();
  });

  // The engine's RETRACT_DISCHARGED is a 409 too, and it wrote nothing: the value still scores, so the host must
  // not be told «already» and must not strike the row (D11).
  it("a 409 that is not «already» — a discharged patient — is said in the engine's words and marks nothing", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(409, "taburcu edilmiş bir hastada değer geri alınamaz")));
    armed();
    reason(REASON);
    await confirm();
    expect(toasted("REA-01 · 2: işarələnmədi — Evə yazılmış xəstədə dəyər səhv qeyd kimi işarələnə bilməz.").length).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // X22: the engine's 409 for a value outside the bedside form's set (a lactate, a medication row) wrote nothing either.
  // «Already» is decided by the exact RETRACT_ALREADY sentence and by nothing else about a 409.
  it("a 409 that says the value is not a bedside measurement is not «already»: it is said, and marks nothing", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(409, "yalnız yatak başı ölçümü hatalı giriş olarak işaretlenebilir")));
    armed();
    reason(REASON);
    await confirm();
    expect(toasted("REA-01 · 2: işarələnmədi — Yalnız çarpayı başında ölçmə səhv qeyd kimi işarələnə bilər.").length).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("a 403 says she may not, closes the dialog and marks nothing", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(403, "forbidden")));
    armed();
    reason(REASON);
    await confirm();
    expect(toasted("REA-01 · 2: işarələnmədi — ölçmə daxil etmək hüququnuz yoxdur").length).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("a 404 — no such hand entry — closes the dialog and marks nothing", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(404, "bu hastada böyle bir elle girilmiş değer yok")));
    armed();
    reason(REASON);
    await confirm();
    expect(toasted("REA-01 · 2: işarələnmədi — Bu xəstədə belə bir əl ilə daxil edilmiş dəyər yoxdur.").length).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("a reason the engine finds short keeps the dialog open, and nothing is read again", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(400, "gerekçe en az 10 karakter olmalı")));
    armed();
    reason(REASON);
    await confirm();
    expect(toasted("REA-01 · 2: işarələnmədi — Səbəb ən azı 10 simvol olmalıdır.").length).toBeGreaterThan(0);
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
