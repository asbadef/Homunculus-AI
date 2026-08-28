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
    critical: "hsl(346, 84%, 55%)",
    stale: "hsl(215, 15%, 60%)",
  },
};
