import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoDataBanner } from "./DemoDataBanner.jsx";

describe("DemoDataBanner", () => {
  it("names the board as demonstration data", () => {
    render(<DemoDataBanner />);
    expect(screen.getByText(/ÖRNEK VERİ/)).toBeInTheDocument();
  });

  it("says it is not this server's live device feed", () => {
    render(<DemoDataBanner />);
    expect(screen.getByText(/canlı cihaz akışı değildir/i)).toBeInTheDocument();
  });

  it("offers no way to dismiss it", () => {
    // A clinician arriving mid-shift at a screen someone else opened must see it too, so a
    // dismissible notice is not good enough.
    const { container } = render(<DemoDataBanner />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryByLabelText(/kapat/i)).toBeNull();
  });

  it("is announced to assistive technology", () => {
    render(<DemoDataBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
