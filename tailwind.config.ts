import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // `brand` keeps DEFAULT/dark/light exactly as they were — every existing
        // `bg-brand`, `text-brand`, `bg-brand-dark` is untouched. The numeric
        // ramp is added for the Chromia module, which was written against a
        // 50-900 scale: the shades are Pacific teal, not the module's original
        // blue, so its screens read as part of this ERP rather than as a guest.
        brand: {
          DEFAULT: "#0f4c5c",
          dark: "#0a3540",
          light: "#5f8c97",
          50: "#eef5f7",
          100: "#d7e8ec",
          200: "#b0d1d9",
          300: "#7fb3bf",
          400: "#4b8fa0",
          500: "#1f6d80",
          600: "#0f4c5c",
          700: "#0d4150",
          800: "#0a3540",
          900: "#07262e",
        },
        pacific: {
          dark: "#112732",
          mid: "#9AA8B6",
          light: "#DAE1E8",
        },
        // Chromia's reserved status palette — one colour per slab outcome, never
        // reused for decoration. `active` is the brand teal so "in progress"
        // matches the rest of the ERP; the other five keep their meanings.
        status: {
          pending: "#94a3b8",
          active: "#1f6d80",
          done: "#16a34a",
          hold: "#d97706",
          recalibration: "#9333ea",
          waste: "#dc2626",
          // The rest of the six production places (27 Oct 2026) — the values
          // of lib/chromia/constants/production-places.ts.
          stock: "#327dff",
          approved: "#0891b2",
          processing: "#64748b",
          // Graded C → Trimming (7 Nov 2026).
          trimming: "#db2777",
        },
        // The CTS – Costing & Quotation module's tokens (scripts/0157): the
        // standalone's Tailwind 4 @theme colours, word for word, under one
        // `cts` key so `text-cts-ink-2`, `bg-cts-brand` and the rest cannot
        // collide with an ERP class. Used only under src/components/cts and
        // src/app/cts; globals.css "CTS module" holds the same values as CSS
        // variables for its sheet styles.
        cts: {
          ink: "#101828",
          "ink-2": "#475467",
          "ink-3": "#7b8698",
          line: "#e7eaee",
          "line-2": "#d0d5dd",
          shell: "#f5f7f9",
          brand: "#0f4c5c",
          "brand-2": "#1a6478",
          "info-bg": "#eef5f7",
          "ok-fg": "#067647",
          "warn-bg": "#fffaeb",
          "warn-line": "#fedf89",
          "warn-fg": "#93530a",
          "bad-bg": "#fef3f2",
          "bad-fg": "#b42318",
          "mute-bg": "#f2f4f7",
          head: "#f8f9fb",
          hairline: "#f0f2f5",
          // A typed input, as on the workbooks. A hand-edited cost cell.
          input: "#1d4ed8",
          edited: "#fef0c7",
          // Internal (My Cost) and customer-facing figures, colour-coded everywhere.
          internal: "#6941c6",
          "internal-bg": "#f4f3ff",
          customer: "#067647",
          "customer-bg": "#ecfdf3",
        },
      },
      borderRadius: {
        card: "0.625rem",
      },
    },
  },
  plugins: [],
};

export default config;
