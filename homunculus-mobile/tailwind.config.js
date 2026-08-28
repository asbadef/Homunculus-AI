const palette = require("./src/theme/palette");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: palette.background,
        card: palette.card,
        foreground: palette.foreground,
        clinical: palette.clinical,
      },
    },
  },
  plugins: [],
};
