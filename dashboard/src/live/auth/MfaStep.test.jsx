import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import QRCode from "qrcode";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { profile, token } from "../session/testTokens.testutil.js";
import { MfaStep } from "./MfaStep.jsx";

const PENDING = token({ sub: "u-kaya", perms: ["board.view"], mfaRequired: true });
const NEW_ACCOUNT = profile({ id: "u-kaya", totp_enabled: false });
const SECRET = "JBSWY3DPEHPK3PXP";
const URI = `otpauth://totp/Homunculus:kaya?secret=${SECRET}&issuer=Homunculus`;
const enrolling = (api) => api.setupTotp.mockResolvedValue({ provisioning_uri: URI });

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const codeField = () => screen.getByLabelText(/^6 rəqəmli kod \*$/);

describe("MfaStep", () => {
  it("enrols once per showing — even under StrictMode — and draws the QR in the page", async () => {
    const { api } = await mount(<StrictMode><MfaStep /></StrictMode>, {
      access: PENDING, me: NEW_ACCOUNT, setup: enrolling,
    });
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();  // in groups of four
    expect(screen.getByText("Əl ilə daxil etmə açarı")).toBeInTheDocument();
    const qr = await screen.findByAltText("Autentifikator tətbiqi üçün QR kod");
    expect(qr.getAttribute("src")).toMatch(/^data:image\//);        // drawn here, never fetched
    // Every /auth/totp/setup ROTATES the secret: a second call would make the key on screen stale.
    expect(api.setupTotp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Autentifikatoru quraşdırın");
    expect(screen.getByText("Addım 2/2")).toBeInTheDocument();
  });

  // A browser that cannot draw the QR (no canvas, a refused data URL): the key must still be there.
  it("draws no QR when it cannot, and the key still works", async () => {
    vi.spyOn(QRCode, "toDataURL").mockRejectedValue(new Error("no canvas"));
    await mount(<MfaStep />, { access: PENDING, me: NEW_ACCOUNT, setup: enrolling });
    expect(await screen.findByText("QR kodu çəkmək mümkün olmadı; açarı əl ilə daxil edin."))
      .toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(screen.queryByAltText("Autentifikator tətbiqi üçün QR kod")).toBeNull();
  });

  it("offers a retry when the server did not answer the enrolment", async () => {
    const { api } = await mount(<MfaStep />, {
      access: PENDING, me: NEW_ACCOUNT,
      setup: (a) => a.setupTotp.mockRejectedValueOnce(new Error("Failed to fetch"))
        .mockResolvedValueOnce({ provisioning_uri: URI }),
    });
    expect(await screen.findByText(/Serverə qoşulmaq mümkün olmadı/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(api.setupTotp).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Serverə qoşulmaq mümkün olmadı/)).toBeNull();
  });

  // A refusal is an answer: asking again would get the same one.
  it("has no retry for a refusal (403 mfa_reset_required)", async () => {
    await mount(<MfaStep />, {
      access: PENDING, me: NEW_ACCOUNT,
      setup: (a) => a.setupTotp.mockRejectedValue(refusal(403, "mfa_reset_required")),
    });
    expect(await screen.findByText(/sistem administratorundan iki addımlı doğrulamanı sıfırlamasını/))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yenidən cəhd et" })).toBeNull();
  });

  it("offers to copy the key only where the clipboard exists, and says 'copied' only once it wrote", async () => {
    // jsdom, like a plain-HTTP origin, has no navigator.clipboard.
    await mount(<MfaStep />, { access: PENDING, me: NEW_ACCOUNT, setup: enrolling });
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kopyala" })).toBeNull();
    cleanup();

    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      await mount(<MfaStep />, { access: PENDING, me: NEW_ACCOUNT, setup: enrolling });
      const copy = await screen.findByRole("button", { name: "Kopyala" });
      fireEvent.click(copy);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
      await act(async () => {});
      expect(screen.queryByText("Kopyalandı")).toBeNull();        // the write was refused
      fireEvent.click(copy);
      expect(await screen.findByText("Kopyalandı")).toBeInTheDocument();
    } finally {
      delete window.navigator.clipboard;
    }
  });

  it("takes digits only, and sends six of them to the server", async () => {
    const { api } = await mount(<MfaStep />, { access: PENDING, me: NEW_ACCOUNT, setup: enrolling });
    api.verifyTotp.mockResolvedValue({});
    const field = codeField();
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    fireEvent.change(field, { target: { value: "1a2b3c" } });
    expect(field).toHaveValue("123");
    fireEvent.click(screen.getByRole("button", { name: "Təsdiqlə" }));
    expect(field).toHaveAccessibleDescription("Kod səhvdir və ya vaxtı bitib.");
    expect(document.activeElement).toBe(field);
    expect(api.verifyTotp).not.toHaveBeenCalled();                // not sent before it can be right
    fireEvent.change(field, { target: { value: "123 456x" } });
    expect(field).toHaveValue("123456");
    fireEvent.click(screen.getByRole("button", { name: "Təsdiqlə" }));
    await waitFor(() => expect(api.verifyTotp).toHaveBeenCalledWith("123456"));
  });

  it("shows a wrong code as a refusal, empties the field and goes back to it", async () => {
    const { api } = await mount(<MfaStep />, { access: PENDING, me: NEW_ACCOUNT, setup: enrolling });
    api.verifyTotp.mockRejectedValue(refusal(401, "Invalid TOTP code"));
    fireEvent.change(codeField(), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Təsdiqlə" }));
    const said = await screen.findByText("Kod səhvdir və ya vaxtı bitib.");
    expect(said.closest("[role]")).toHaveAttribute("role", "alert");
    expect(codeField()).toHaveValue("");
    expect(document.activeElement).toBe(codeField());
  });

  it("asks an enrolled account for the code alone, and leaving signs out", async () => {
    const { api, store } = await mount(<MfaStep />, {
      access: PENDING, me: profile({ id: "u-kaya", totp_enabled: true }), setup: enrolling,
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("İki addımlı doğrulama");
    expect(api.setupTotp).not.toHaveBeenCalled();
    expect(screen.queryByText("Əl ilə daxil etmə açarı")).toBeNull();
    // In act(): the session ends here, and the step — which in the app is replaced at once by the
    // sign-in form — is still mounted, so it starts an enrolment for the session that just ended.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Girişə qayıt/ })); });
    expect(store.getState().user).toBeNull();
    expect(api.logout).toHaveBeenCalled();
  });
});
