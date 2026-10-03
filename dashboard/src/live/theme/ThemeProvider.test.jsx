import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
