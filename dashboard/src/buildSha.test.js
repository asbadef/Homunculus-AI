// @vitest-environment node
//
// The build SHA in the account menu ("which build does the pilot run?", 20.09.2026) must survive
// the Docker build. The image is built without `.git` (.dockerignore), and node:alpine has no git,
// so `git rev-parse` fails there and the bundle said "version unknown" on the VM (G1-15, F2). The
// deploy passes the SHA in instead: `BUILD_SHA=$(git rev-parse --short HEAD) docker compose build
// web` -> compose's build arg -> the Dockerfile's ARG -> `npm run build` -> vite.config.js.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitSha } from "../vite.config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCKERFILE = fs.readFileSync(path.resolve(HERE, "../../deploy/local/web/Dockerfile"), "utf8");
const COMPOSE = fs.readFileSync(path.resolve(HERE, "../../deploy/local/docker-compose.yml"), "utf8");

const noGit = () => {
  throw new Error("git: not found");
};

describe("gitSha", () => {
  it("takes BUILD_SHA when git is absent", () => {
    expect(gitSha({ BUILD_SHA: "667ea91" }, noGit)).toBe("667ea91");
    expect(gitSha({ BUILD_SHA: " 667ea91\n" }, noGit)).toBe("667ea91");
  });

  it("says nothing rather than invent one when neither is there", () => {
    expect(gitSha({}, noGit)).toBe("");
    expect(gitSha({ BUILD_SHA: "" }, noGit)).toBe("");
  });

  it("prefers the checkout's own SHA when git answers", () => {
    expect(gitSha({ BUILD_SHA: "667ea91" }, () => Buffer.from("d1d0a74\n"))).toBe("d1d0a74");
  });
});

describe("the web image's build", () => {
  it("declares BUILD_SHA in the build stage before `npm run build` runs", () => {
    const build = DOCKERFILE.split(/^FROM /m)[1];
    const arg = build.search(/^ARG BUILD_SHA\s*$/m);
    expect(arg).toBeGreaterThan(-1);
    expect(arg).toBeLessThan(build.indexOf("RUN npm run build"));
  });

  it("is handed BUILD_SHA by compose", () => {
    const web = COMPOSE.slice(COMPOSE.indexOf("\n  web:"), COMPOSE.indexOf("\n  bridge:"));
    expect(web).toMatch(/^\s+args:\s*$/m);
    expect(web).toMatch(/^\s+BUILD_SHA: \$\{BUILD_SHA:-\}\s*$/m);
  });
});
