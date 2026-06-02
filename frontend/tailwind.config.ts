import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
  ],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        bg: { DEFAULT: "#0a0d14", soft: "#0f131c", panel: "#121826", elevated: "#161d2c" },
        border: { DEFAULT: "rgba(255,255,255,0.06)", strong: "rgba(255,255,255,0.10)" },
        accent: { DEFAULT: "#6366f1", glow: "#818cf8", muted: "#3b3f6b" },
        ink: { DEFAULT: "#e6e9f2", muted: "#9aa3b8", faint: "#5b6478" },
        success: "#34d399",
        danger: "#f87171",
        warning: "#fbbf24",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem", "3xl": "1.5rem" },
      backdropBlur: { xs: "2px" },
      keyframes: {
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "slide-up": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        pulse_glow: { "0%,100%": { opacity: "0.6" }, "50%": { opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in 220ms ease-out",
        "slide-up": "slide-up 220ms ease-out",
        shimmer: "shimmer 2.2s linear infinite",
        "pulse-glow": "pulse_glow 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
