/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Noto Sans", "Noto Sans Devanagari", "Noto Sans Telugu", "Noto Sans Tamil", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        panel2: "rgb(var(--panel2) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        brand: { DEFAULT: "rgb(var(--brand) / <alpha-value>)", 2: "rgb(var(--brand2) / <alpha-value>)" },
        ok: "#16a34a", watch: "#eab308", warn: "#f97316", danger: "#dc2626", crit: "#9f1239",
      },
      boxShadow: { card: "0 1px 2px rgb(0 0 0 / .06), 0 4px 16px rgb(0 0 0 / .06)" },
    },
  },
  plugins: [],
};
