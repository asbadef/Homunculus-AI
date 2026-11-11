import "@testing-library/jest-dom";
import { beforeAll } from "vitest";
import { preloadScreens } from "./live/shell/lazyScreen.js";

// The live shell's screens and the administration screen's tabs are fetched the first time they
// are opened (live/shell/lazyScreen.js). Before a file's first test, every lazy screen that file's
// imports have made is fetched here — the routes' screens, and the admin tabs their chunks make —
// so a test opens a screen as it did before the split, AT ONCE (a screen whose code is here does
// not suspend), and none has to wait for a chunk or meet the loading note by surprise. A file that
// imports no screen fetches nothing. The loading note and the chunk that does not come are tested
// on purpose, with stand-ins made inside the test (shell/lazyScreen.test.jsx, shell/Shell.test.jsx,
// screens/admin/AdminScreen.test.jsx).
beforeAll(async () => {
  await preloadScreens();
});

// Vite `define` ile gelen derleme bilgisi; testlerde tanımlı olmadığı için burada karşılanıyor.
globalThis.__BUILD_SHA__ = globalThis.__BUILD_SHA__ ?? "";
globalThis.__BUILD_TIME__ = globalThis.__BUILD_TIME__ ?? "";
