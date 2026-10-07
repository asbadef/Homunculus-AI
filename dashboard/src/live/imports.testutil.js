// Test-only: what a source file imports, read as TEXT. Used by boundaries.test.js (nothing under
// src/live/ may import the old workspace) and by routing.test.js (the live page must not pull the
// simulation into its first chunk). One reader for both, so a form that slips past one cannot slip
// past the other.
//
// Every way a module can pull another in is read: `import … from`, `export … from`, a bare
// `import "x"` (side effects only), each over several lines, and `import("x")`. What cannot be
// followed by reading — `import(` with anything but a quoted path, `import.meta.glob` — is
// reported separately: an import a test cannot see is an import it cannot check.
const STATIC = /(?:^|[;}\s])(?:import|export)(?:\s+[^;'"`]*?\bfrom\s*|\s*)["']([^"']+)["']/g;
const DYNAMIC = /\bimport\s*\(\s*(?:["']([^"']+)["']\s*\))?/g;

/** What a source imports ({specs}), and what it pulls in that reading cannot follow ({unreadable}).
 *  `specs` holds the static ones in source order, then the dynamic ones. */
export function importsOf(text) {
  const specs = [...text.matchAll(STATIC)].map((m) => m[1]);
  const unreadable = [];
  for (const m of text.matchAll(DYNAMIC)) {
    if (m[1]) specs.push(m[1]);
    else unreadable.push(m[0].trim());
  }
  if (/\bimport\.meta\.glob/.test(text)) unreadable.push("import.meta.glob");
  return { specs, unreadable };
}

/** The statically imported specifiers only: what a module pulls in whether or not it is used.
 *  A dynamic `import("x")` is removed before reading, so what is left is the static graph. */
export function staticImportsOf(text) {
  return importsOf(text.replace(/\bimport\s*\(\s*["'][^"']+["']\s*\)/g, "0")).specs;
}
