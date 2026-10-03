import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import DesignGallery from "./DesignGallery.jsx";
import { ICON_NAMES } from "../ui/icons.js";
import { COLOR_TOKENS } from "../theme/tokens.js";

const html = document.documentElement;

afterEach(() => {
  localStorage.clear();
  delete html.dataset.theme;
  delete html.dataset.size;
  html.removeAttribute("lang");
});

describe("design gallery", () => {
  it("opens in Azerbaijani and Gece, and switches language", () => {
    render(<DesignGallery />);
    expect(screen.getByRole("heading", { level: 1, name: "Dizayn qalereyası" })).toBeInTheDocument();
    expect(html.lang).toBe("az");
    expect(html.dataset.theme).toBe("gece");
    fireEvent.click(screen.getByRole("button", { name: "Türkçe" }));
    expect(screen.getByRole("heading", { level: 1, name: "Tasarım galerisi" })).toBeInTheDocument();
    expect(html.lang).toBe("tr");
  });

  it("switches theme and text size", () => {
    render(<DesignGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Gün işığı" }));
    fireEvent.click(screen.getByRole("button", { name: "Böyük" }));
    expect(html.dataset.theme).toBe("gun");
    expect(html.dataset.size).toBe("buyuk");
  });

  it("shows every colour token in both themes", () => {
    render(<DesignGallery />);
    const table = screen.getByRole("table", { name: "Rənglər" });
    expect(within(table).getAllByRole("row")).toHaveLength(COLOR_TOKENS.length + 1);
    expect(table.querySelectorAll('[data-theme="gece"]')).toHaveLength(COLOR_TOKENS.length);
    expect(table.querySelectorAll('[data-theme="gun"]')).toHaveLength(COLOR_TOKENS.length);
  });

  it("shows every icon by name", () => {
    render(<DesignGallery />);
    const icons = screen.getByRole("region", { name: "İkonlar" });
    for (const name of ICON_NAMES) expect(within(icons).getByText(name)).toBeInTheDocument();
    expect(icons.querySelectorAll("svg")).toHaveLength(ICON_NAMES.length);
  });

  it("shows every engine risk, none of them green", () => {
    render(<DesignGallery />);
    const components = screen.getByRole("region", { name: "Komponentlər" });
    for (const label of ["Kritik", "Yüksək", "Orta", "Aşağı", "Məlumat", "Tapıntı yoxdur", "Ölçülməyib", "Naməlum risk: stable"]) {
      const pill = within(components).getAllByText(label).find((el) => el.hasAttribute("data-tone"));
      expect(pill, label).toBeDefined();
      expect(pill.getAttribute("data-tone"), label).not.toBe("ok");
    }
  });

  it("opens and closes the sample dialog, and shows a toast", () => {
    render(<DesignGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Pəncərəni aç" }));
    expect(screen.getByRole("dialog", { name: "Nümunə pəncərə" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bildiriş göstər" }));
    const notices = screen.getByRole("region", { name: "Bildirişlər" });
    expect(notices.querySelector('[aria-live="polite"]')).toHaveTextContent("Yadda saxlanıldı");
  });

  it("shows a field in error and a busy button", () => {
    render(<DesignGallery />);
    const invalid = screen.getAllByLabelText("İstifadəçi adı").find((el) => el.getAttribute("aria-invalid") === "true");
    expect(invalid).toHaveAccessibleDescription(/Bu istifadəçi adı artıq mövcuddur/);
    const busy = screen.getAllByRole("button", { name: "Yadda saxla" }).find((el) => el.getAttribute("aria-busy") === "true");
    expect(busy).toBeDefined();
  });

  it("shows an error toast that waits to be dismissed", () => {
    render(<DesignGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Yadda saxlanılmadı" }));
    const notices = screen.getByRole("region", { name: "Bildirişlər" });
    expect(within(notices).getByRole("alert")).toHaveTextContent("Xəta: Yadda saxlanılmadı");
  });

  it("opens a dialog from the dialog, and Escape closes the top one first", () => {
    render(<DesignGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Pəncərəni aç" }));
    const outer = screen.getByRole("dialog", { name: "Nümunə pəncərə" });
    fireEvent.click(within(outer).getByRole("button", { name: "Pəncərəni aç" }));
    expect(screen.getByRole("dialog", { name: "İkinci pəncərə" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "İkinci pəncərə" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Nümunə pəncərə" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
