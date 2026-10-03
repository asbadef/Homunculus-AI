import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table } from "./Table.jsx";

const rows = (
  <>
    <thead><tr><th>İstifadəçi adı</th><th>Son giriş</th></tr></thead>
    <tbody><tr><td className="font-data font-bold">dr.ornek</td><td>23.09 19:58</td></tr></tbody>
  </>
);

describe("Table", () => {
  it("is named by its caption, inside a focusable scroll region of the same name", () => {
    render(<Table caption="İstifadəçilər">{rows}</Table>);
    expect(screen.getByRole("table", { name: "İstifadəçilər" })).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "İstifadəçilər" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-x-auto");
  });

  it("renders the caller's rows and headers", () => {
    render(<Table caption="İstifadəçilər">{rows}</Table>);
    expect(screen.getByRole("columnheader", { name: "Son giriş" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "dr.ornek" })).toBeInTheDocument();
  });

  it("without a caption is no region and takes no focus", () => {
    const { container } = render(<Table>{rows}</Table>);
    expect(container.firstChild).not.toHaveAttribute("role");
    expect(container.firstChild).not.toHaveAttribute("tabindex");
  });
});
