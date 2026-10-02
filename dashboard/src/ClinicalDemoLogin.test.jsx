import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ClinicalDemo from "./ClinicalDemo.jsx";

describe("ClinicalDemo giriş ekranı", () => {
  it("demo parolasını açıkça gösterir ve 'Doldur' ile yönetici hesabıyla giriş yapılır", () => {
    render(<ClinicalDemo />);
    expect(screen.getByTestId("demo-login-note")).toHaveTextContent("Demo hesap — parola: demo");
    const row = screen.getByTitle("yonetici@demo.homunculus.example").closest("li");
    fireEvent.click(row.querySelector("button"));
    fireEvent.submit(document.querySelector("form"));
    expect(screen.queryByTestId("demo-login-note")).not.toBeInTheDocument();
  });
});
