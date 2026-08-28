// The Homunculus clinical palette. CommonJS because tailwind.config.js requires it, and the
// palette must not exist twice — a colour that drifts between config and code is a bug that
// only shows up on a ward at night.
module.exports = {
  background: "hsl(222, 47%, 8%)",
  card: "hsl(222, 40%, 12%)",
  foreground: "hsl(210, 30%, 96%)",
  clinical: {
    border: "hsl(217, 30%, 20%)",
    safe: "hsl(142, 60%, 45%)",
    warning: "hsl(38, 92%, 50%)",
    critical: "hsl(346, 84%, 60%)",  // 55% measured 4.22:1 on card — under the 4.5:1 AA body bar; 60% clears it
    stale: "hsl(215, 15%, 60%)",
  },
};
