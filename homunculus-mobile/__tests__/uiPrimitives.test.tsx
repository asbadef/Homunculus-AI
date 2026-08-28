/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { DemoBanner } from "../src/ui/DemoBanner";
import { RiskPill } from "../src/ui/RiskPill";
import { Skeleton } from "../src/ui/Skeleton";
import { StalenessBadge } from "../src/ui/StalenessBadge";

describe("RiskPill", () => {
  it("names the risk in Turkish", async () => {
    await render(<RiskPill risk="critical" />);
    expect(screen.getByText("Kritik")).toBeTruthy();
  });

  it("labels a calm bed rather than showing an empty pill", async () => {
    await render(<RiskPill risk="none" />);
    expect(screen.getByText("Sakin")).toBeTruthy();
  });
});

describe("StalenessBadge", () => {
  it("renders nothing when no input is stale", async () => {
    await render(<StalenessBadge inputs={[]} />);
    expect(screen.queryByLabelText("staleness-badge")).toBeNull();
  });

  it("names the stale inputs", async () => {
    await render(<StalenessBadge inputs={["creatinine"]} />);
    expect(screen.getByText("Bayat veri: kreatinin")).toBeTruthy();
  });

  it("states the age when one is supplied", async () => {
    await render(<StalenessBadge inputs={["creatinine"]} agesMs={{ creatinine: 14 * 3600 * 1000 }} />);
    expect(screen.getByText("Bayat veri: kreatinin · 14 sa")).toBeTruthy();
  });
});

describe("Skeleton", () => {
  it("is present while data has not arrived", async () => {
    await render(<Skeleton height={64} />);
    expect(screen.getByLabelText("skeleton")).toBeTruthy();
  });
});

describe("DemoBanner", () => {
  it("says out loud that the data is a recording", async () => {
    await render(<DemoBanner />);
    expect(screen.getByText("GÖSTERİM VERİSİ — kayıtlı sentetik senaryo")).toBeTruthy();
  });
});
