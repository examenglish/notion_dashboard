import type { Config } from "tailwindcss";

// Tailwind is scoped to the new `/director` UI only. Preflight is off and every
// design-token CSS variable is namespaced with `--sc-` so it can never collide
// with the hand-written tokens/selectors in app/globals.css that the rest of
// the (untouched) app still relies on.
const config: Config = {
  corePlugins: {
    preflight: false,
  },
  content: [
    "./app/director/**/*.{ts,tsx}",
    "./components/ui/**/*.{ts,tsx}",
    "./components/director/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "Apple SD Gothic Neo",
          "Noto Sans KR",
          "sans-serif",
        ],
      },
      colors: {
        border: "hsl(var(--sc-border))",
        input: "hsl(var(--sc-input))",
        ring: "hsl(var(--sc-ring))",
        background: "hsl(var(--sc-background))",
        foreground: "hsl(var(--sc-foreground))",
        primary: {
          DEFAULT: "hsl(var(--sc-primary))",
          foreground: "hsl(var(--sc-primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--sc-muted))",
          foreground: "hsl(var(--sc-muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--sc-accent))",
          foreground: "hsl(var(--sc-accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--sc-destructive))",
          foreground: "hsl(var(--sc-destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--sc-success))",
          foreground: "hsl(var(--sc-success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--sc-warning))",
          foreground: "hsl(var(--sc-warning-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--sc-card))",
          foreground: "hsl(var(--sc-card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sc-sidebar))",
          foreground: "hsl(var(--sc-sidebar-foreground))",
          active: "hsl(var(--sc-sidebar-active))",
          "active-foreground": "hsl(var(--sc-sidebar-active-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--sc-radius)",
        md: "calc(var(--sc-radius) - 2px)",
        sm: "calc(var(--sc-radius) - 4px)",
      },
      boxShadow: {
        subtle: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
        card: "0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
