// src/live/theme/assets.js — the live UI's stylesheet and fonts. Import once, at the live root.
//
// The fonts are npm packages that Vite bundles and the app serves itself: a hospital network may
// not reach Google, and the product must not depend on it (prototype decision #125). What each
// face draws, and why the stacks in tokens.css fall back the way they do: fonts.test.js.
import "@fontsource-variable/figtree";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./tokens.css";
