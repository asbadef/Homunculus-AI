// A root that will not load must not leave the ward a blank page. The roots are fetched on demand
// (main.jsx), and React answers a failed lazy import by throwing during render.
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoadBoundary } from "./LoadFailed.jsx";

function Boom() {
  throw Object.assign(new Error("Failed to fetch dynamically imported module"), { name: "ChunkLoadError" });
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("a root that could not be loaded", () => {
  it("says so, in the language the person chose, with a way out", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem("hmc.lang", "az");
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });
    render(<LoadBoundary><Boom /></LoadBoundary>);
    const message = screen.getByRole("alert");
    expect(message).toHaveTextContent("Səhifə yüklənə bilmədi");
    expect(message).toHaveTextContent(/Bağlantınızı yoxlayıb/);
    fireEvent.click(screen.getByRole("button", { name: "Yenidən yüklə" }));
    expect(reload).toHaveBeenCalled();
    // The real error reaches the console: a chunk that will not load and a bug that throws look
    // the same to the ward, and only this tells them apart afterwards.
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("could not be rendered"), expect.any(Error));
  });

  it("falls back to Azerbaijani for a language this build does not have", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem("hmc.lang", "kl");
    render(<LoadBoundary><Boom /></LoadBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("Səhifə yüklənə bilmədi");
  });

  // The live UI's tokens (--page, --ink, --pri) ship with the chunk that just failed, so a class
  // that reads one would resolve to nothing here: a white label on a colourless button.
  it("leans on no design token, so it is legible without the stylesheet that failed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LoadBoundary><Boom /></LoadBoundary>);
    const message = screen.getByRole("alert");
    const classes = [message, ...message.querySelectorAll("*")]
      .flatMap((el) => [...el.classList]);
    expect(classes.filter((c) => /^(bg|text|border|ring)-(page|app|rail|card|card2|ink|mute|line|line2|pri|onpri)/.test(c)))
      .toEqual([]);
    expect(screen.getByRole("button", { name: /Yenidən|Reload|Перезагрузить|Yeniden/ }))
      .toHaveStyle({ color: "inherit" });
  });

  it("stays out of the way while the root renders", () => {
    render(<LoadBoundary><p>kabuk</p></LoadBoundary>);
    expect(screen.getByText("kabuk")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
