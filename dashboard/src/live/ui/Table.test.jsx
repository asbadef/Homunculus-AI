import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Table } from "./Table.jsx";

const rows = (
  <>
    <thead><tr><th>İstifadəçi adı</th><th>Son giriş</th></tr></thead>
    <tbody><tr><td className="font-data font-bold">dr.ornek</td><td>23.09 19:58</td></tr></tbody>
  </>
);

// jsdom lays nothing out: scrollWidth and clientWidth are 0. Stand in for the browser's numbers.
const size = { scroll: 0, client: 0 };
function widths(scroll, client) {
  size.scroll = scroll;
  size.client = client;
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => size.scroll });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => size.client });
}

afterEach(() => {
  delete HTMLElement.prototype.scrollWidth;
  delete HTMLElement.prototype.clientWidth;
  vi.restoreAllMocks();
});

describe("Table", () => {
  it("is named by its caption, inside a focusable scroll region of the same name when it overflows", () => {
    widths(900, 390);
    render(<Table caption="İstifadəçilər">{rows}</Table>);
    expect(screen.getByRole("table", { name: "İstifadəçilər" })).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "İstifadəçilər" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-x-auto");
  });

  it("when it fits, keeps the table's name but adds no tab stop and no region", () => {
    widths(600, 600);
    const { container } = render(<Table caption="İstifadəçilər">{rows}</Table>);
    expect(screen.getByRole("table", { name: "İstifadəçilər" })).toBeInTheDocument();
    expect(container.firstChild).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("becomes a tab stop when the window narrows and it starts to overflow", () => {
    widths(600, 600);
    const { container } = render(<Table caption="İstifadəçilər">{rows}</Table>);
    size.client = 390;
    fireEvent(window, new Event("resize"));
    expect(container.firstChild).toHaveAttribute("tabindex", "0");
  });

  // Dropping tabindex from the focused element would send a keyboard user's focus to <body>.
  it("stays a focused region when it stops overflowing, and drops it on blur", () => {
    widths(900, 390);
    render(<><Table caption="İstifadəçilər">{rows}</Table><button type="button">sonra</button></>);
    const region = screen.getByRole("region", { name: "İstifadəçilər" });
    act(() => region.focus());
    size.client = 900;
    fireEvent(window, new Event("resize"));
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("role", "region");
    expect(document.activeElement).toBe(region);
    act(() => screen.getByRole("button", { name: "sonra" }).focus());
    expect(region).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("keeps the region when focus moves from it to a control inside the table", () => {
    widths(900, 390);
    render(
      <Table caption="İstifadəçilər">
        <tbody><tr><td><button type="button">Düzəliş et</button></td></tr></tbody>
      </Table>,
    );
    const region = screen.getByRole("region", { name: "İstifadəçilər" });
    act(() => region.focus());
    act(() => screen.getByRole("button", { name: "Düzəliş et" }).focus());
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("renders the caller's rows and headers", () => {
    render(<Table caption="İstifadəçilər">{rows}</Table>);
    expect(screen.getByRole("columnheader", { name: "Son giriş" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "dr.ornek" })).toBeInTheDocument();
  });

  it("without a caption is no region, takes no focus, and warns in development", () => {
    widths(900, 390);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<Table>{rows}</Table>);
    expect(container.firstChild).not.toHaveAttribute("role");
    expect(container.firstChild).not.toHaveAttribute("tabindex");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("caption"));
  });
});
