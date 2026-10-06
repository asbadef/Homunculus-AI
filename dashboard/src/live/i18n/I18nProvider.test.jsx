// The D2 versions of the language cases that i18n.rbac.test.js pins for the old workspace
// ("the UI language a ward opens in"): those stay as they are until the old workspace is removed
// (G1-16); the new shell opens in Azerbaijani.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { I18nProvider, useI18n } from "./I18nProvider.jsx";

function Probe() {
  const { lang, setLang, t } = useI18n();
  return (
    <div>
      <p data-testid="lang">{lang}</p>
      <p>{t("common.close")}</p>
      <button type="button" onClick={() => setLang("ru")}>ru</button>
      <button type="button" onClick={() => setLang("de")}>de</button>
    </div>
  );
}

const locale = (languages) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(navigator, "language", "get").mockReturnValue(languages[0]);
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

describe("the language the live UI opens in (roadmap D2)", () => {
  it("is Azerbaijani with nothing stored, even on an English-locale browser", () => {
    locale(["en-US", "en"]);
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("lang")).toHaveTextContent("az");
    expect(screen.getByText("Bağla")).toBeInTheDocument();
  });

  it("is Azerbaijani on a Turkish- or Russian-locale device too: there is no detection", () => {
    locale(["tr-TR", "ru-RU"]);
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("lang")).toHaveTextContent("az");
  });

  it("is the language the user chose, when one is stored", () => {
    locale(["az-AZ", "az"]);
    localStorage.setItem("hmc.lang", "en");
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText("Close")).toBeInTheDocument();
  });

  it.each(["AZ", "TR", "tr-TR", "russian", "", "constructor"])(
    "is Azerbaijani when the stored language is one it does not have (%j: the prototype's spelling, junk)",
    (stored) => {
      localStorage.setItem("hmc.lang", stored);
      render(<I18nProvider><Probe /></I18nProvider>);
      expect(screen.getByTestId("lang")).toHaveTextContent("az");
      expect(screen.getByText("Bağla")).toBeInTheDocument();
      expect(document.documentElement.lang).toBe("az");
    },
  );

  // The old workspace's choice (clinicalI18n, key homunculus-clang) is not the new shell's: a
  // pilot PC where someone once picked Turkish in the old app still opens in Azerbaijani (D2).
  it("is not changed by the old workspace's stored language", () => {
    localStorage.setItem("homunculus-clang", "tr");
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("lang")).toHaveTextContent("az");
    expect(screen.getByText("Bağla")).toBeInTheDocument();
  });

  it("is Azerbaijani when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText("Bağla")).toBeInTheDocument();
  });
});

describe("switching language", () => {
  it("re-renders, stores the choice and sets <html lang>", () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(document.documentElement.lang).toBe("az");
    fireEvent.click(screen.getByText("ru"));
    expect(screen.getByText("Закрыть")).toBeInTheDocument();
    expect(localStorage.getItem("hmc.lang")).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
  });

  it("ignores a language it does not have", () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    fireEvent.click(screen.getByText("de"));
    expect(screen.getByTestId("lang")).toHaveTextContent("az");
    expect(localStorage.getItem("hmc.lang")).toBeNull();
  });

  it("still switches when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    render(<I18nProvider><Probe /></I18nProvider>);
    fireEvent.click(screen.getByText("ru"));
    expect(screen.getByText("Закрыть")).toBeInTheDocument();
  });
});

describe("beside another page and other tabs", () => {
  it("gives <html lang> back as it was when it unmounts", () => {
    document.documentElement.setAttribute("lang", "tr");
    const { unmount } = render(<I18nProvider><Probe /></I18nProvider>);
    expect(document.documentElement.lang).toBe("az");
    unmount();
    expect(document.documentElement.lang).toBe("tr");
    document.documentElement.removeAttribute("lang");
    const again = render(<I18nProvider><Probe /></I18nProvider>);
    again.unmount();
    expect(document.documentElement.hasAttribute("lang")).toBe(false);
  });

  it("follows a language chosen in another tab, and ignores one it does not have", () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "hmc.lang", newValue: "en" })));
    expect(screen.getByText("Close")).toBeInTheDocument();
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "hmc.lang", newValue: "de" })));
    expect(screen.getByText("Close")).toBeInTheDocument();
  });
});

describe("without a provider", () => {
  it("speaks Azerbaijani", () => {
    render(<Probe />);
    expect(screen.getByText("Bağla")).toBeInTheDocument();
  });
});
