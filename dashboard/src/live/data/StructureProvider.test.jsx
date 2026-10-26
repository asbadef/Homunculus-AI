// The shell's one read of the ward's structure (Group 2 · B1a): made only for a session whose
// rights open GET /tenant/structure, through the session's `track`, kept when a reload fails.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, screen } from "@testing-library/react";
import { useStructure } from "./StructureProvider.jsx";
import { REA, mountKabul, structure } from "../screens/kabul/kabul.testutil.js";
import { refusal } from "../session/mount.testutil.jsx";

function Probe() {
  const { phase, index, reload } = useStructure();
  return (
    <div>
      <p>{`phase: ${phase}`}</p>
      <p>{`units: ${[...index.units.values()].map((u) => u.name).join(", ")}`}</p>
      <button type="button" onClick={reload}>reload</button>
    </div>
  );
}

describe("StructureProvider", () => {
  it("reads the structure once for a session that may, and names its units", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["board.view", "admissions.view"] });
    expect(api.structure).toHaveBeenCalledTimes(1);
    expect(screen.getByText("phase: known")).toBeTruthy();
    expect(screen.getByText("units: Reanimasiya, Neonatal")).toBeTruthy();
  });

  it("asks nothing of a session none of whose rights open the route", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["board.view", "audit.view"] });
    expect(api.structure).not.toHaveBeenCalled();
    expect(screen.getByText("phase: unasked")).toBeTruthy();
  });

  it("keeps the last tree when a reload fails, and says it is stale", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["beds.release"] });
    api.structure.mockRejectedValueOnce(refusal(503, "Sunucuya şu an ulaşılamıyor"));
    await act(async () => { screen.getByText("reload").click(); });
    expect(screen.getByText("phase: stale")).toBeTruthy();
    expect(screen.getByText("units: Reanimasiya, Neonatal")).toBeTruthy();
  });

  it("resolves a reload to the tree it read, and to null when that read failed", async () => {
    function Answer() {
      const { reload } = useStructure();
      const [got, setGot] = React.useState("none");
      const ask = async () => {
        const tree = await reload();
        setGot(tree === null ? "null" : `sites: ${tree.sites.length}`);
      };
      return <button type="button" onClick={ask}>{got}</button>;
    }
    const { api } = await mountKabul(<Answer />, { perms: ["admissions.admit"] });
    await act(async () => { screen.getByText("none").click(); });
    expect(screen.getByText("sites: 1")).toBeTruthy();
    api.structure.mockRejectedValueOnce(refusal(503, "Sunucuya şu an ulaşılamıyor"));
    await act(async () => { screen.getByText("sites: 1").click(); });
    expect(screen.getByText("null")).toBeTruthy();
  });

  it("reads an answer that is not a tree as an empty one", async () => {
    await mountKabul(<Probe />, { perms: ["structure.manage"], setup: (api) => api.structure.mockResolvedValue("x") });
    expect(screen.getByText("phase: known")).toBeTruthy();
    expect(screen.getByText("units:")).toBeTruthy();
    expect(REA).toBeTruthy();
    expect(structure().sites).toHaveLength(1);
  });
});
