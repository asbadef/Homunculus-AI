import "@testing-library/jest-dom";

// Vite `define` ile gelen derleme bilgisi; testlerde tanımlı olmadığı için burada karşılanıyor.
globalThis.__BUILD_SHA__ = globalThis.__BUILD_SHA__ ?? "";
globalThis.__BUILD_TIME__ = globalThis.__BUILD_TIME__ ?? "";
