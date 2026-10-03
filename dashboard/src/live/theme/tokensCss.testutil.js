// src/live/theme/tokensCss.testutil.js — reads tokens.css as text, for the tests (never shipped).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// node:path, not new URL(): under jsdom the global URL is jsdom's, which fileURLToPath refuses.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector.trim().replace(/\s+/g, " "),
  props: Object.fromEntries(
    [...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  ),
}));

/** The custom properties of the rule whose selector list is exactly `selector`, by name without "--". */
export function rule(selector) {
  const found = RULES.find((r) => r.selector === selector);
  if (!found) throw new Error(`tokens.css has no rule "${selector}"`);
  return found.props;
}

export const THEMES = {
  gece: rule(':root, [data-theme="gece"]'),
  gun: rule('[data-theme="gun"], :root[data-theme="gun"]'),
};
