// The switch main.jsx lazily loads for every root that is not the live system. The screens behind
// it have their own tests (ClinicalDemo.rbac, Board, demo); what is pinned here is which one each
// address reaches — above all that ?eski=1 is the REAL API under the old screens and not the
// simulation, and that it says so to ClinicalDemo (`simulation` false, a live store passed).
// The children are stood in for, so this costs nothing: rendering the real simulation takes
// seconds.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import LegacyRoot from "./legacyRoots.jsx";
import { createLiveStore } from "./liveStore.js";

vi.mock("./Board.jsx", () => ({ Board: ({ token }) => <p>board token={token}</p> }));
vi.mock("./demo.jsx", () => ({ DemoApp: ({ scenario }) => <p>replay scenario={scenario}</p> }));
vi.mock("./ClinicalDemo.jsx", () => ({
  ClinicalDemo: ({ store, simulation }) => <p>{simulation ? "simulation" : `real api, store=${Boolean(store)}`}</p>,
}));
vi.mock("./clinicalDemo.js", () => ({ createDemoStore: vi.fn(() => ({})), buildRealisticState: vi.fn(() => ({})) }));
vi.mock("./liveStore.js", () => ({ createLiveStore: vi.fn(() => ({ restoreSession: vi.fn() })) }));

const params = (query) => new URLSearchParams(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the roots that are not the live system", () => {
  it("gives ?eski=1 the real API and never the simulation", () => {
    render(<LegacyRoot mode="eski" params={params("")} />);
    expect(screen.getByText("real api, store=true")).toBeInTheDocument();
    expect(createLiveStore).toHaveBeenCalledTimes(1);
    // A reload must reopen the stored session instead of signing the clinician out.
    expect(createLiveStore.mock.results[0].value.restoreSession).toHaveBeenCalled();
  });

  it("opens the simulation on ?demo=1, with no live store under it", () => {
    render(<LegacyRoot mode="demo" params={params("")} />);
    expect(screen.getByText("simulation")).toBeInTheDocument();
    expect(createLiveStore).not.toHaveBeenCalled();
  });

  it("takes the replay's scenario from the address, and has a default", () => {
    const { unmount } = render(<LegacyRoot mode="replay" params={params("scenario=nec")} />);
    expect(screen.getByText("replay scenario=nec")).toBeInTheDocument();
    unmount();
    render(<LegacyRoot mode="replay" params={params("")} />);
    expect(screen.getByText("replay scenario=septic_shock")).toBeInTheDocument();
  });

  it("falls back to the legacy board, with the token from the address", () => {
    const { unmount } = render(<LegacyRoot mode="board" params={params("token=abc")} />);
    expect(screen.getByText("board token=abc")).toBeInTheDocument();
    unmount();
    render(<LegacyRoot mode="board" params={params("")} />);
    expect(screen.getByText("board token=dev-token")).toBeInTheDocument();
  });
});
