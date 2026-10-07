// `npm run dev` proxies the API the way nginx does in production: every path nginx sends to the API
// is in vite.config.js's proxy list. The list had fallen behind before (/admin, /scope, /scores and
// /infinity-research were missing: the new shell's screens could not reach them on a laptop).
// Both files are read as text.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VITE = fs.readFileSync(path.resolve(HERE, "../vite.config.js"), "utf8");
const NGINX = fs.readFileSync(path.resolve(HERE, "../../deploy/local/web/nginx.conf"), "utf8");

function nginxApiPaths() {
  const out = new Set();
  for (const m of NGINX.matchAll(/location ~ \^\/\(([a-z|-]+)\)/g)) {
    for (const name of m[1].split("|")) out.add(`/${name}`);
  }
  return out;
}

function viteProxyPaths() {
  const block = /proxy: Object\.fromEntries\(\[([^]*?)\]\.map/.exec(VITE);
  return new Set(block ? [...block[1].matchAll(/"(\/[a-z-]+)"/g)].map((m) => m[1]) : []);
}

describe("the dev server's proxy", () => {
  it("reads both lists", () => {
    expect(nginxApiPaths().size).toBeGreaterThan(15);
    expect(viteProxyPaths().has("/auth")).toBe(true);
  });

  it("covers every API path nginx proxies", () => {
    const vite = viteProxyPaths();
    expect([...nginxApiPaths()].filter((p) => !vite.has(p))).toEqual([]);
  });
});
