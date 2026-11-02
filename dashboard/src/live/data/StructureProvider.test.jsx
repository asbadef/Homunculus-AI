// The shell's one read of the ward's structure (Group 2 · B1a): made only for a session whose
// rights open GET /tenant/structure, through the session's `track`, kept when a reload fails.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, cleanup, screen } from "@testing-library/react";
import { useStructure } from "./StructureProvider.jsx";
import { NEO, REA, mountKabul, structure } from "../screens/kabul/kabul.testutil.js";
import { refusal } from "../session/mount.testutil.jsx";
import { token } from "../session/testTokens.testutil.js";

function Probe() {
  const { phase, known, index, reload, rereading } = useStructure();
  return (
    <div>
      <p>{`phase: ${phase}`}</p>
      <p>{`known: ${known}`}</p>
      <p>{`rereading: ${rereading.size}`}</p>
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
  });

  it("is known in the two phases that hold a tree — answered, or kept after a failed reload — and in no other", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["beds.release"] });
    expect(screen.getByText("known: true")).toBeTruthy();
    api.structure.mockRejectedValueOnce(refusal(503, "Sunucuya şu an ulaşılamıyor"));
    await act(async () => { screen.getByText("reload").click(); });
    expect(screen.getByText("phase: stale")).toBeTruthy();
    expect(screen.getByText("known: true")).toBeTruthy();
  });

  it("is not known while the first read is out", async () => {
    await mountKabul(<Probe />, { perms: ["beds.release"], setup: (api) => api.structure.mockReturnValue(new Promise(() => {})) });
    expect(screen.getByText("phase: loading")).toBeTruthy();
    expect(screen.getByText("known: false")).toBeTruthy();
  });

  it("is not known when the first read failed, and says «failed», not «empty»", async () => {
    await mountKabul(<Probe />, { perms: ["beds.release"],
      setup: (api) => api.structure.mockRejectedValue(refusal(503, "Sunucuya şu an ulaşılamıyor")) });
    expect(screen.getByText("phase: failed")).toBeTruthy();
    expect(screen.getByText("known: false")).toBeTruthy();
    expect(screen.getByText("units:")).toBeTruthy();
  });

  it("is not known for a session that asked nothing", async () => {
    await mountKabul(<Probe />, { perms: ["board.view"] });
    expect(screen.getByText("known: false")).toBeTruthy();
  });
});

describe("a failed read is tried again", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const down = () => refusal(503, "Sunucuya şu an ulaşılamıyor");

  it("after a wait that doubles — 2, 4, 8, 16 s — and stops growing at 30 s", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["admissions.view"], setup: (a) => a.structure.mockRejectedValue(down()) });
    expect(api.structure).toHaveBeenCalledTimes(1);
    await advance(1_999);
    expect(api.structure).toHaveBeenCalledTimes(1);
    await advance(1);                                     // 2 s
    expect(api.structure).toHaveBeenCalledTimes(2);
    await advance(3_999);
    expect(api.structure).toHaveBeenCalledTimes(2);
    await advance(1);                                     // + 4 s
    expect(api.structure).toHaveBeenCalledTimes(3);
    await advance(8_000);                                 // + 8 s
    expect(api.structure).toHaveBeenCalledTimes(4);
    await advance(16_000);                                // + 16 s
    expect(api.structure).toHaveBeenCalledTimes(5);
    await advance(29_999);                                // the next wait is the ceiling, 30 s — not 32
    expect(api.structure).toHaveBeenCalledTimes(5);
    await advance(1);
    expect(api.structure).toHaveBeenCalledTimes(6);
    await advance(30_000);
    expect(api.structure).toHaveBeenCalledTimes(7);
  });

  it("until it is answered: the tree is known, and nothing more is asked", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["admissions.view"], setup: (a) => a.structure.mockRejectedValueOnce(down()) });
    expect(screen.getByText("phase: failed")).toBeTruthy();
    await advance(2_000);
    expect(screen.getByText("phase: known")).toBeTruthy();
    expect(screen.getByText("units: Reanimasiya, Neonatal")).toBeTruthy();
    expect(api.structure).toHaveBeenCalledTimes(2);
    await advance(120_000);
    expect(api.structure).toHaveBeenCalledTimes(2);
  });

  // A refusal (403, 404 — a server not yet carrying the route) is not a hiccup: asking again every
  // 2 seconds would only be noise, but it may be mended (a deploy, a grant), so it is still asked
  // again — every 5 minutes. Time-outs and throttling (408, 429) are hiccups.
  for (const status of [400, 403, 404]) {
    it(`after 5 minutes, not 2 seconds, when the server refuses it (${status})`, async () => {
      const { api } = await mountKabul(<Probe />, { perms: ["admissions.view"],
        setup: (a) => a.structure.mockRejectedValue(refusal(status, "Reddedildi")) });
      expect(api.structure).toHaveBeenCalledTimes(1);
      await advance(299_999);
      expect(api.structure).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(api.structure).toHaveBeenCalledTimes(2);
      await advance(299_999);
      expect(api.structure).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(api.structure).toHaveBeenCalledTimes(3);
    });
  }

  for (const status of [408, 429, 500, 503]) {
    it(`after 2 seconds when it is a time-out, throttling or a server fault (${status})`, async () => {
      const { api } = await mountKabul(<Probe />, { perms: ["admissions.view"],
        setup: (a) => a.structure.mockRejectedValue(refusal(status, "Geçici")) });
      await advance(2_000);
      expect(api.structure).toHaveBeenCalledTimes(2);
    });
  }

  it("after 2 seconds when there was no answer at all (no status)", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["admissions.view"],
      setup: (a) => a.structure.mockRejectedValue(new Error("Failed to fetch")) });
    await advance(2_000);
    expect(api.structure).toHaveBeenCalledTimes(2);
  });

  it("also when it is only a reload that failed: the stale tree is replaced when the server answers", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["beds.release"] });
    const renamed = structure();
    renamed.sites[0].units[0].name = "Reanimasiya 2";
    api.structure.mockRejectedValueOnce(down()).mockResolvedValueOnce(renamed);
    await act(async () => { screen.getByText("reload").click(); });
    expect(screen.getByText("phase: stale")).toBeTruthy();
    await advance(2_000);
    expect(screen.getByText("phase: known")).toBeTruthy();
    expect(screen.getByText("units: Reanimasiya 2, Neonatal")).toBeTruthy();
  });

  it("not once the shell has gone", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["admissions.view"], setup: (a) => a.structure.mockRejectedValue(down()) });
    cleanup();
    await advance(120_000);
    expect(api.structure).toHaveBeenCalledTimes(1);
  });

  it("not for a session that lost the right in the meantime", async () => {
    const { api, store } = await mountKabul(<Probe />, { perms: ["admissions.view"], setup: (a) => a.structure.mockRejectedValue(down()) });
    api.accessToken.mockReturnValue(token({ perms: ["board.view"] }));
    await act(async () => { await store.track(() => Promise.resolve(null)); });
    expect(screen.getByText("phase: unasked")).toBeTruthy();
    await advance(120_000);
    expect(api.structure).toHaveBeenCalledTimes(1);
  });
});

describe("the rights change under an open shell", () => {
  const landing = () => {
    const wait = {};
    wait.promise = new Promise((resolve) => { wait.land = resolve; });
    return wait;
  };
  const tracked = (store) => act(async () => { await store.track(() => Promise.resolve(null)); });

  it("drops a read that lands after the session lost the right to it", async () => {
    const wait = landing();
    const { api, store } = await mountKabul(<Probe />, { perms: ["admissions.view"], setup: (a) => a.structure.mockReturnValue(wait.promise) });
    expect(screen.getByText("phase: loading")).toBeTruthy();
    api.accessToken.mockReturnValue(token({ perms: ["board.view"] }));
    await tracked(store);
    expect(screen.getByText("phase: unasked")).toBeTruthy();
    await act(async () => { wait.land(structure()); });
    expect(screen.getByText("phase: unasked")).toBeTruthy();
    expect(screen.getByText("units:")).toBeTruthy();
  });

  it("is «loading», not «unasked», from the moment the session gains the right", async () => {
    const wait = landing();
    const { api, store } = await mountKabul(<Probe />, { perms: ["board.view"], setup: (a) => a.structure.mockReturnValue(wait.promise) });
    expect(screen.getByText("phase: unasked")).toBeTruthy();
    api.accessToken.mockReturnValue(token({ perms: ["board.view", "admissions.view"] }));
    await tracked(store);
    expect(screen.getByText("phase: loading")).toBeTruthy();
    expect(api.structure).toHaveBeenCalledTimes(1);
    await act(async () => { wait.land(structure()); });
    expect(screen.getByText("phase: known")).toBeTruthy();
  });
});

describe("a unit the shell's scope holds and the tree lacks", () => {
  const NEW = "99999999-9999-4999-8999-999999999999";
  const grown = () => {
    const tree = structure();
    tree.sites[0].units.push({ id: NEW, name: "Yeni şöbə", unit_type: "ADULT_ICU", is_active: true, rooms: [] });
    return tree;
  };

  it("makes the structure be read once more — a unit added since it was read", async () => {
    const { api } = await mountKabul(<Probe />, {
      perms: ["admissions.view"], shell: { units: [REA, NEW] },
      setup: (a) => a.structure.mockResolvedValueOnce(structure()).mockResolvedValueOnce(grown()),
    });
    expect(api.structure).toHaveBeenCalledTimes(2);
    expect(screen.getByText("units: Reanimasiya, Neonatal, Yeni şöbə")).toBeTruthy();
  });

  // Until the read made for a unit has landed, the tree is not yet an answer about that unit: the
  // provider says which ids are being read for (`rereading`), and the screens do not call them
  // «unknown» meanwhile.
  it("says which units the read in flight is for, and none once it has landed", async () => {
    let land;
    const { api } = await mountKabul(<Probe />, {
      perms: ["admissions.view"], shell: { units: [REA, NEW] },
      setup: (a) => a.structure.mockResolvedValueOnce(structure())
        .mockReturnValueOnce(new Promise((resolve) => { land = resolve; })),
    });
    expect(api.structure).toHaveBeenCalledTimes(2);
    expect(screen.getByText("phase: known")).toBeTruthy();
    expect(screen.getByText("rereading: 1")).toBeTruthy();
    await act(async () => { land(structure()); });                 // it still lacks the unit
    expect(screen.getByText("rereading: 0")).toBeTruthy();
    expect(api.structure).toHaveBeenCalledTimes(2);                // and the gap is not asked about again
  });

  it("only once: a unit the second read still lacks does not start a loop", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["admissions.view"], shell: { units: [REA, NEW] } });
    expect(api.structure).toHaveBeenCalledTimes(2);
    await act(async () => { screen.getByText("reload").click(); });
    expect(api.structure).toHaveBeenCalledTimes(3);       // her own reload, and nothing more
    expect(screen.getByText("units: Reanimasiya, Neonatal")).toBeTruthy();
  });

  it("not at all when the tree holds every unit of the scope", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["admissions.view"], shell: { units: [REA, NEO] } });
    expect(api.structure).toHaveBeenCalledTimes(1);
  });
});
