// D1 — demo sitesinin güvenlik başlıkları vercel.json'da tanımlı kalmalı.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cfg = JSON.parse(readFileSync(resolve(process.cwd(), "..", "vercel.json"), "utf-8"));
const all = cfg.headers?.find((h) => h.source === "/(.*)");
const header = (k) => all?.headers.find((h) => h.key === k)?.value;

describe("vercel.json güvenlik başlıkları (D1)", () => {
  it("tüm yollar için başlık bloğu var", () => expect(all).toBeTruthy());
  it("çerçeveye gömmeyi engeller", () => {
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
  it("CSP kapalı varsayılanlı ve satır içi betik izni yok", () => {
    const csp = header("Content-Security-Policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    const script = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("script-src"));
    expect(script).toBe("script-src 'self'");
  });
  it("diğer başlıklar tanımlı", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBeTruthy();
    expect(header("Permissions-Policy")).toContain("camera=()");
  });
});
