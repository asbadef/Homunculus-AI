/// <reference types="jest" />
import { fireEvent, render, screen } from "@testing-library/react-native";

import { GuidelineDrawer } from "../src/ui/GuidelineDrawer";

describe("GuidelineDrawer", () => {
  it("renders nothing when it has no citation", async () => {
    await render(<GuidelineDrawer citationId={null} confidence="" onClose={() => {}} />);
    expect(screen.queryByLabelText("guideline-drawer")).toBeNull();
  });

  it("shows the vault title and authority", async () => {
    await render(<GuidelineDrawer citationId="sepsis-3-jama-2016" confidence="" onClose={() => {}} />);
    expect(screen.getByText("Sepsis-3 (JAMA 2016)")).toBeTruthy();
    expect(screen.getByText("Otorite: yüksek")).toBeTruthy();
  });

  it("warns that a superseded edition has been replaced", async () => {
    await render(<GuidelineDrawer citationId="surviving-sepsis-campaign-2021" confidence="" onClose={() => {}} />);
    expect(screen.getByText("Bu kaynak daha yeni bir baskıyla değiştirildi.")).toBeTruthy();
  });

  it("shows the alert's own confidence wording and nothing invented", async () => {
    await render(
      <GuidelineDrawer
        citationId="sepsis-3-jama-2016"
        confidence="Sepsis-3 organ-dysfunction criterion (consensus definition)."
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByText("Sepsis-3 organ-dysfunction criterion (consensus definition)."),
    ).toBeTruthy();
  });

  it("admits when a citation is not in the catalogue", async () => {
    await render(<GuidelineDrawer citationId="made-up-2030" confidence="" onClose={() => {}} />);
    expect(screen.getByText("Kaynak notu bulunamadı: made-up-2030")).toBeTruthy();
  });

  it("closes", async () => {
    const onClose = jest.fn();
    await render(<GuidelineDrawer citationId="sepsis-3-jama-2016" confidence="" onClose={onClose} />);
    fireEvent.press(screen.getByText("Kapat"));
    expect(onClose).toHaveBeenCalled();
  });
});
