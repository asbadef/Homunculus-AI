import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider.jsx";

function Probe() {
  const { theme, size, setTheme, setSize } = useTheme();
  return (
    <div>
      <p data-testid="theme">{theme}</p>
      <p data-testid="size">{size}</p>
      <button type="button" onClick={() => setTheme("gun")}>gun</button>
      <button type="button" onClick={() => setTheme("auto")}>auto</button>
      <button type="button" onClick={() => setSize("buyuk")}>buyuk</button>
    </div>
  );
}

const html = document.documentElement;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete html.dataset.theme;
  delete html.dataset.size;
  html.removeAttribute("lang");
});

describe("ThemeProvider", () => {
  it("opens in Gece at normal size, and says so on <html>", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent("gece");
    expect(screen.getByTestId("size")).toHaveTextContent("normal");
    expect(html.dataset.theme).toBe("gece");
    expect(html.dataset.size).toBe("normal");
  });

  it("restores the stored choice", () => {
    localStorage.setItem("hmc.theme", "gun");
    localStorage.setItem("hmc.size", "buyuk");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(html.dataset.theme).toBe("gun");
    expect(html.dataset.size).toBe("buyuk");
  });

  it("switches, stores the choice and updates <html>", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("gun"));
    fireEvent.click(screen.getByText("buyuk"));
    expect(html.dataset.theme).toBe("gun");
    expect(html.dataset.size).toBe("buyuk");
    expect(localStorage.getItem("hmc.theme")).toBe("gun");
    expect(localStorage.getItem("hmc.size")).toBe("buyuk");
  });

  it("ignores a theme it does not have (there is no automatic theme yet)", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("auto"));
    expect(html.dataset.theme).toBe("gece");
    expect(localStorage.getItem("hmc.theme")).toBeNull();
  });

  it.each([
    ["AZ", "TR"], // the prototype's spelling style
    ["GUN", "BUYUK"],
    ["dark", "large"],
    ["", ""],
  ])("falls back to Gece at normal size for a stored value it does not have (%j, %j)", (theme, size) => {
    localStorage.setItem("hmc.theme", theme);
    localStorage.setItem("hmc.size", size);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent("gece");
    expect(screen.getByTestId("size")).toHaveTextContent("normal");
    expect(html.dataset.theme).toBe("gece");
    expect(html.dataset.size).toBe("normal");
  });

  it("still switches when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("gun"));
    fireEvent.click(screen.getByText("buyuk"));
    expect(screen.getByTestId("theme")).toHaveTextContent("gun");
    expect(html.dataset.theme).toBe("gun");
    expect(html.dataset.size).toBe("buyuk");
  });

  // Leaving the live UI must not leave its theme on <html> (the old app that once shared the tab
  // went in G1-16) — and a value the page had before is given back, not deleted.
  it("takes data-theme and data-size off <html> when it unmounts", () => {
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("gun"));
    expect(html.dataset.theme).toBe("gun");
    unmount();
    expect(html.hasAttribute("data-theme")).toBe(false);
    expect(html.hasAttribute("data-size")).toBe(false);
  });

  it("gives back the values <html> had before it mounted", () => {
    html.dataset.theme = "eski";
    html.dataset.size = "kucuk";
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(html.dataset.theme).toBe("gece");
    unmount();
    expect(html.dataset.theme).toBe("eski");
    expect(html.dataset.size).toBe("kucuk");
  });

  it("gives back the page's own values after a remount in one commit (a key change)", () => {
    html.dataset.theme = "eski";
    html.dataset.size = "kucuk";
    const { rerender, unmount } = render(<ThemeProvider key="a"><Probe /></ThemeProvider>);
    rerender(<ThemeProvider key="b"><Probe /></ThemeProvider>);
    expect(html.dataset.theme).toBe("gece");
    unmount();
    expect(html.dataset.theme).toBe("eski");
    expect(html.dataset.size).toBe("kucuk");
  });

  it("follows a theme or size chosen in another tab, without writing it back", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    const write = vi.spyOn(Storage.prototype, "setItem");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "hmc.theme", newValue: "gun" }));
      window.dispatchEvent(new StorageEvent("storage", { key: "hmc.size", newValue: "buyuk" }));
    });
    expect(screen.getByTestId("theme")).toHaveTextContent("gun");
    expect(html.dataset.size).toBe("buyuk");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "hmc.theme", newValue: "auto" })));
    expect(screen.getByTestId("theme")).toHaveTextContent("gun");
    expect(write).not.toHaveBeenCalled();
  });

  it("renders in Gece when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(html.dataset.theme).toBe("gece");
  });

  it("without a provider, reports Gece at normal size", () => {
    render(<Probe />);
    expect(screen.getByTestId("theme")).toHaveTextContent("gece");
    expect(screen.getByTestId("size")).toHaveTextContent("normal");
  });
});
