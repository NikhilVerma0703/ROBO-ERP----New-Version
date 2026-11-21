/**
 * Chart tokens and row shapes shared by the Robo Reports page and its charts.
 *
 * Deliberately free of any charting library import: the page reads these for
 * its legends and value lists without pulling Recharts into the first load.
 */

/** Categorical slots, fixed order (validated for CVD separation on white). */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];

/**
 * A longer categorical ramp for the all-delay-types bar chart, which shows one
 * bar per delay code — a dozen or more. Extends SERIES with distinct hues and
 * cycles (`% length`) if a plant ever runs past the end. The bar and its table
 * row read the SAME index, so a code's colour is the same in both.
 */
export const DELAY_SERIES = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4",
  "#7c5cd0", "#22b3c9", "#d1512e", "#4b5b6b", "#8a5a2b",
  "#9a9a92", "#3fa34d",
];
export const DELAY_HUE = "#eb6834";
export const PRODUCTION_HUE = "#2a78d6";

/**
 * The three shifts on the Production Rate per Hour line — red, dark blue, dark
 * green, as the plant names them.
 *
 * These exact steps were chosen, not picked by eye: red against dark green is
 * the one pair a red-green colour-blind reader cannot separate, and the obvious
 * #c62828 / #1b5e20 fails outright (ΔE 2.0 under protanopia — the same colour).
 * Lightening both until they part gives ΔE 8.5, clear of the floor, with every
 * other check passing too: all three sit in the lightness band, hold their
 * chroma, and clear 3:1 against the white card. The bold SHIFT A / SHIFT B /
 * SHIFT C labels under the axis carry the same information without colour at
 * all, so the chart is readable with no colour vision whatsoever.
 */
export const SHIFT_HUES: Record<"A" | "B" | "C", string> = {
  A: "#cf2f26", // red        06:00–14:00
  B: "#1f4fa8", // dark blue  14:00–22:00
  C: "#1a7a42", // dark green 22:00–06:00
};

/* Recessive chart chrome */
export const GRID = "#e1e0d9";
export const AXIS = "#c3c2b7";
export const MUTED = "#898781";

/** The dated divider where a run crosses midnight. Deliberately stronger than
 *  GRID and the axis: it is not chrome but a reading — one production day ends
 *  and the next begins — and at the old axis grey it was lost among the
 *  gridlines on a long run. */
export const DATE_RULE = "#6f6d66";
export const DATE_TEXT = "#44423c";

/**
 * Production Rate per Hour, measured: the plot itself, and the whole figure the
 * page reserves while the chart loads. Here, not in report-charts, because the
 * page reads them for its placeholder and must not pull Recharts in to do so.
 *   HOURLY_PLOT_H    the chart (was 380, before the shift band under the hours)
 *   HOURLY_FIGURE_H  the plot plus its two axis titles, "Number of Slabs" above
 *                    and "Time Duration (in Hours)" below — each one text-xs
 *                    line (16px) and its 4px margin. The touch-only "Tap an
 *                    hour…" line under them is not counted: the placeholder is
 *                    drawn before the page knows what kind of screen it is on.
 */
/* 380 before the shift band under the hours, 418 before that band gained its
   second line — the slabs each shift produced (lib/robo/hourlyShifts.ts). The
   band grew by one line of text and the chart grew with it, so the plot area is
   exactly as tall as it was and the placeholder still matches the chart. */
export const HOURLY_PLOT_H = 436;
export const HOURLY_FIGURE_H = HOURLY_PLOT_H + 2 * (16 + 4);

export const TOOLTIP_STYLE = {
  borderRadius: "8px",
  border: `1px solid ${GRID}`,
  fontSize: "12px",
  boxShadow: "0 2px 8px rgba(11,11,11,0.08)",
};

export interface DelaySlice { code: string; description: string; category: string; minutes: number; events: number }
export interface TrendPoint {
  date: string;
  label: string;
  slabs: number;
  delayMins: number;
  /** That date's slabs ÷ the hours the Robo line ran that date (lib/robo/dailyRate.ts). */
  slabsPerHour: number;
  /** The minutes the Robo line ran that date — the divisor behind slabsPerHour. */
  lineMinutes: number;
}

export function pct(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 1000) / 10}%`;
}
