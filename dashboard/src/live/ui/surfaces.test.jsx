import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Box } from "./Box.jsx";
import { Note } from "./Note.jsx";
import { Empty } from "./Empty.jsx";
import { KV, KVList } from "./KV.jsx";

describe("Box", () => {
  it("names its section with a real heading, h3 by default", () => {
    render(<Box title="Alarm keyfiyyəti" icon="chart" right="7 gün"><p>içində</p></Box>);
    expect(screen.getByRole("heading", { level: 3, name: "Alarm keyfiyyəti" })).toBeInTheDocument();
    expect(screen.getByText("7 gün")).toBeInTheDocument();
    expect(screen.getByText("içində")).toBeInTheDocument();
  });

  it("takes another heading level", () => {
    render(<Box title="Başlıq" level={2}>x</Box>);
    expect(screen.getByRole("heading", { level: 2, name: "Başlıq" })).toBeInTheDocument();
  });

  it("draws no header without a title", () => {
    const { container } = render(<Box>yalnız məzmun</Box>);
    expect(container.querySelector("h2, h3, h4, h5, h6")).toBeNull();
  });
});

describe("Note", () => {
  it.each([["warn", "bg-att"], ["info", "bg-pri-soft"]])("%s tone paints %s", (tone, cls) => {
    render(<Note tone={tone}>Bağlantı yavaşdır.</Note>);
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-tone", tone);
    expect(note.className).toContain(cls);
    expect(note).toHaveTextContent("Bağlantı yavaşdır.");
  });
});

describe("Empty", () => {
  it("says what is missing", () => {
    render(<Empty icon="search">Uyğun qeyd yoxdur.</Empty>);
    expect(screen.getByText("Uyğun qeyd yoxdur.")).toBeInTheDocument();
  });
});

describe("KV", () => {
  it("writes label–value rows as a description list, values in the data face", () => {
    render(<KVList><KV label="Son giriş">23.09 19:58</KV><KV label="Vəziyyət" mono={false}>Aktiv</KV></KVList>);
    expect(screen.getByText("Son giriş").tagName).toBe("DT");
    expect(screen.getByText("23.09 19:58").tagName).toBe("DD");
    expect(screen.getByText("23.09 19:58").className).toContain("font-data");
    expect(screen.getByText("Aktiv").className).not.toContain("font-data");
    expect(screen.getByText("Son giriş").closest("dl")).not.toBeNull();
  });
});
