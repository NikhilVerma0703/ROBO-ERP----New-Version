import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  shiftBlockCount,
  shiftBlockLabel,
  shiftBlockLines,
  shiftBlocks,
  shiftOfHour,
  shiftSpans,
} from "../src/lib/robo/hourlyShifts.ts";
import { hourlyProduction, type HourlySlab } from "../src/lib/robo/hourlyProduction.ts";
import { productionShiftOf } from "../src/lib/robo/productionShift.ts";

/* The shift colouring of "Production Rate per Hour".
 *
 * The chart is ONE line whose colour says which shift each hour belongs to:
 * A 06:00–14:00 red, B 14:00–22:00 dark blue, C 22:00–06:00 dark green. The
 * shift of an HOUR is a property of the clock, never of a slab — so a batch
 * entered years before the Shift field existed is coloured just as correctly
 * as one entered today, with nothing read from the database. */

/** The owner's example: batch 1465, 10/10 12:21 → 12/10 08:15. The chart's
 *  hours are 12:00–13:00 on the 10th through 08:00–09:00 on the 12th. */
const OWNERS_RUN = Array.from({ length: 45 }, (_, i) => (12 + i) % 24);

/* ── Which shift an hour belongs to ────────────────────────────────── */

test("the three windows are the plant's, and the boundaries belong to the shift they start", () => {
  assert.equal(shiftOfHour(5), "C");
  assert.equal(shiftOfHour(6), "A"); // A starts
  assert.equal(shiftOfHour(13), "A");
  assert.equal(shiftOfHour(14), "B"); // B starts
  assert.equal(shiftOfHour(21), "B");
  assert.equal(shiftOfHour(22), "C"); // C starts
  assert.equal(shiftOfHour(23), "C");
  assert.equal(shiftOfHour(0), "C"); // still the night shift
});

test("every hour of the day belongs to exactly one shift, eight hours each", () => {
  const seen = new Map<string, number>();
  for (let h = 0; h < 24; h++) seen.set(shiftOfHour(h), (seen.get(shiftOfHour(h)) ?? 0) + 1);
  assert.deepEqual([...seen.keys()].sort(), ["A", "B", "C"]);
  for (const c of ["A", "B", "C"]) assert.equal(seen.get(c), 8, c);
});

test("an absolute hour works as well as an hour of the day", () => {
  // The chart counts hours from the epoch; 30 is 06:00 of the following day.
  assert.equal(shiftOfHour(30), "A");
  assert.equal(shiftOfHour(24), "C"); // midnight again
  assert.equal(shiftOfHour(-1), "C"); // 23:00 the day before
});

/* ── Splitting a run into blocks ───────────────────────────────────── */

test("the owner's run splits exactly as the example says", () => {
  assert.deepEqual(
    shiftBlocks(OWNERS_RUN).map((b) => [b.code, b.hours]),
    [["A", 2], ["B", 8], ["C", 8], ["A", 8], ["B", 8], ["C", 8], ["A", 3]],
  );
});

test("the night shift is one block across midnight, not two", () => {
  // 22:00 → 06:00 is one shift however many dates it touches. Splitting it at
  // midnight would put two "SHIFT C" labels on one night.
  const night = [22, 23, 0, 1, 2, 3, 4, 5];
  const blocks = shiftBlocks(night);
  assert.equal(blocks.length, 1);
  assert.deepEqual([blocks[0].code, blocks[0].from, blocks[0].to], ["C", 0, 7]);
});

test("a run inside one shift is one block", () => {
  assert.deepEqual(shiftBlocks([15, 16, 17]).map((b) => [b.code, b.hours]), [["B", 3]]);
});

test("the blocks cover every hour, once, in order", () => {
  const blocks = shiftBlocks(OWNERS_RUN);
  assert.equal(blocks[0].from, 0);
  assert.equal(blocks[blocks.length - 1].to, OWNERS_RUN.length - 1);
  blocks.forEach((b, i) => {
    if (i > 0) assert.equal(b.from, blocks[i - 1].to + 1, `gap or overlap before block ${i}`);
    assert.equal(b.hours, b.to - b.from + 1);
    assert.ok(b.mid >= b.from && b.mid <= b.to, "the label sits inside its own block");
  });
});

test("no hours, no blocks", () => {
  assert.deepEqual(shiftBlocks([]), []);
  assert.deepEqual(shiftSpans([]), []);
});

/* ── The colour stops ──────────────────────────────────────────────── */

test("the colours run end to end with no gap and no overlap", () => {
  const spans = shiftSpans(OWNERS_RUN);
  assert.equal(spans.length, 7);
  assert.equal(spans[0].from, 0);
  assert.equal(spans[spans.length - 1].to, 1);
  spans.forEach((s, i) => {
    if (i > 0) assert.equal(s.from, spans[i - 1].to, `a seam at span ${i}`);
    assert.ok(s.to > s.from, `span ${i} has no width`);
  });
});

test("a colour changes halfway between the two hours, which IS the boundary", () => {
  // Hours 12,13 | 14,…: the change belongs between the 13:00–14:00 point and
  // the 14:00–15:00 point, i.e. at 14:00 itself. With n points, point i sits at
  // i/(n-1), so the boundary before point 2 is at 1.5/(n-1).
  const spans = shiftSpans(OWNERS_RUN);
  const n = OWNERS_RUN.length;
  assert.equal(spans[0].to, 1.5 / (n - 1));
  assert.equal(spans[1].from, 1.5 / (n - 1));
  // And the next one, before the first hour of Shift C (index 10).
  assert.equal(spans[1].to, 9.5 / (n - 1));
});

test("the spans name the same shifts as the blocks, in the same order", () => {
  assert.deepEqual(
    shiftSpans(OWNERS_RUN).map((s) => s.code),
    shiftBlocks(OWNERS_RUN).map((b) => b.code),
  );
});

test("one hour of data is one full-width colour, not a division by zero", () => {
  assert.deepEqual(shiftSpans([9]), [{ code: "A", from: 0, to: 1 }]);
});

/* ── The slabs of a shift ──────────────────────────────────────────── */

/** A count for every hour of the owner's run, so each block has a known total:
 *  hour i produces i+1 slabs. */
const RISING = OWNERS_RUN.map((_, i) => i + 1);

test("a block's total is its own hours added up", () => {
  const blocks = shiftBlocks(OWNERS_RUN, RISING);
  blocks.forEach((b) => {
    const own = RISING.slice(b.from, b.to + 1).reduce((t, n) => t + n, 0);
    assert.equal(b.slabs, own, `${b.code} ${b.from}–${b.to}`);
  });
});

test("every slab is counted exactly once: the blocks add up to the run", () => {
  // The one property that matters. The blocks cover every hour once (tested
  // above), so a count can be neither double-counted into two shifts nor lost
  // between them, whatever the run.
  const total = RISING.reduce((t, n) => t + n, 0);
  assert.equal(shiftBlocks(OWNERS_RUN, RISING).reduce((t, b) => t + b.slabs, 0), total);
});

test("a slab is counted under the shift its hour belongs to, boundaries included", () => {
  // 13:00–14:00 is the last hour of A, 14:00–15:00 the first of B — one slab
  // each, and the boundary does not put either in the other's column.
  const blocks = shiftBlocks([12, 13, 14, 15], [5, 1, 1, 7]);
  assert.deepEqual(blocks.map((b) => [b.code, b.slabs]), [["A", 6], ["B", 8]]);
  // And the same at 22:00, where the night shift takes over.
  assert.deepEqual(
    shiftBlocks([20, 21, 22, 23], [2, 3, 4, 5]).map((b) => [b.code, b.slabs]),
    [["B", 5], ["C", 9]],
  );
});

test("the night shift's count is one figure across midnight, not two", () => {
  // 22:00 → 06:00 is one shift however many dates it touches. Counting it as
  // two would halve every night on the chart.
  const night = [22, 23, 0, 1, 2, 3, 4, 5];
  const blocks = shiftBlocks(night, [4, 6, 3, 0, 2, 5, 9, 10]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].slabs, 39);
});

test("a shift that finished nothing counts nothing, and says so", () => {
  const [a] = shiftBlocks([6, 7, 8], [0, 0, 0]);
  assert.equal(a.slabs, 0);
  assert.equal(shiftBlockCount(a), "0 SLABS");
});

test("counts are optional — the colouring never needed them", () => {
  // shiftSpans and the gradient ask only for hours. Passing none must not make
  // a block's total undefined or NaN.
  for (const b of shiftBlocks(OWNERS_RUN)) assert.equal(b.slabs, 0);
  assert.equal(shiftBlocks([6, 7], [3])[0].slabs, 3, "a short count array does not poison the total");
});

/* ── The labels ────────────────────────────────────────────────────── */

test("a block names its shift in full, and a single hour shows the letter", () => {
  const [first, second] = shiftBlocks([13, 14, 15]); // A for one hour, then B
  assert.equal(shiftBlockLabel(first), "A");
  assert.equal(shiftBlockLabel(second), "SHIFT B");
  assert.equal(shiftBlockLabel(shiftBlocks(OWNERS_RUN)[1]), "SHIFT B");
});

test("every block of the owner's run is named", () => {
  assert.deepEqual(
    shiftBlocks(OWNERS_RUN).map(shiftBlockLabel),
    ["SHIFT A", "SHIFT B", "SHIFT C", "SHIFT A", "SHIFT B", "SHIFT C", "SHIFT A"],
  );
});

test("the owner's example reads SHIFT B over 39 SLABS", () => {
  // Eight hours of Shift B that produced 39 slabs between them.
  const [b] = shiftBlocks([14, 15, 16, 17, 18, 19, 20, 21], [4, 6, 5, 3, 7, 5, 4, 5]);
  assert.equal(b.slabs, 39);
  assert.deepEqual(shiftBlockLines(b), ["SHIFT B", "39 SLABS"]);
});

test("one slab is one SLAB, and the rest are SLABS", () => {
  assert.equal(shiftBlockCount(shiftBlocks([14, 15], [1, 0])[0]), "1 SLAB");
  assert.equal(shiftBlockCount(shiftBlocks([14, 15], [1, 1])[0]), "2 SLABS");
});

test("a one-hour block shows the letter and the bare number", () => {
  // There is no room for "SHIFT A" and "7 SLABS" under a single 52px hour, and
  // the hours either side already name the shift.
  const [first] = shiftBlocks([13, 14, 15], [7, 2, 2]);
  assert.deepEqual(shiftBlockLines(first), ["A", "7"]);
});

test("the two lines are two lines — the sentence on one would not fit", () => {
  // Measured: "SHIFT B: 39 SLABS" bold at 14px is 166px and an hour is 52px, so
  // one line needs a four-hour block. Runs routinely end in two-hour ones.
  for (const b of shiftBlocks(OWNERS_RUN, RISING)) {
    const lines = shiftBlockLines(b);
    assert.equal(lines.length, 2);
    assert.doesNotMatch(lines[0], /\d/, "the name line carries no figure");
    assert.match(lines[1], /^\d+( SLABS?)?$/, "the count line is the figure");
  }
});

/* ── End to end: the band against an independent count ─────────────── */

test("the band's totals are the slabs of each shift, counted from their own times", () => {
  /* The chart's own pipeline — slabs → hourly buckets → shift blocks — against
     a count that shares none of it: each slab assigned the Shift the export
     shows for it (productionShift.productionShiftOf — no pick stored here, so
     its In Time's), straight off the register. If a slab ever landed in two
     blocks, or in none, these two would differ. Every slab here goes in and
     comes out on the same shift; tests/review1026Robo.test.ts has the ones that
     straddle a boundary. */
  const outs = [
    "06:10", "07:45", "09:00", "13:59", // A — 4
    "14:00", "15:30", "18:20", "21:59", "20:05", // B — 5, including both boundaries
    "22:00", "23:30", "00:40", "03:15", "05:59", "04:00", // C — 6, across midnight
  ];
  const slabs: HourlySlab[] = outs.map((out, i) => ({
    productionDate: "2026-10-18",
    // In an hour before the Out, so nothing is read as an overnight slab except
    // the ones that really are.
    inTime: out >= "00:00" && out < "06:00" && i > 10 ? "23:50" : out,
    outTime: out,
    slabNumber: String(100 + i),
    id: `s${i}`,
  }));

  const buckets = hourlyProduction(slabs);
  const got = new Map<string, number>();
  for (const b of shiftBlocks(buckets.map((x) => x.hour), buckets.map((x) => x.shiftSlabs))) {
    got.set(b.code, (got.get(b.code) ?? 0) + b.slabs);
  }

  const want = new Map<string, number>();
  for (const slab of slabs) {
    const code = productionShiftOf(slab) as string;
    want.set(code, (want.get(code) ?? 0) + 1);
  }

  assert.deepEqual(Object.fromEntries([...want].sort()), { A: 4, B: 5, C: 6 });
  assert.deepEqual(Object.fromEntries([...got].sort()), Object.fromEntries([...want].sort()));
  // And nothing was invented or lost on the way through.
  assert.equal([...got.values()].reduce((t, n) => t + n, 0), outs.length);
});

/* ── Wiring guards ─────────────────────────────────────────────────── */

/** A source file as the repository holds it: LF, whatever the checkout did to it.
 *  A CRLF working copy would make every \n in the patterns below miss, and a
 *  doesNotMatch pass without looking — see tests/sourceLineEndings.test.ts. */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the line is stroked with the gradient, and is still one line", () => {
  const s = src("components/robo/reports/report-charts.tsx");
  assert.match(s, /stroke=\{`url\(#\$\{gradientId\}\)`\}/);
  // One <Line> in the hourly chart. Three — one per shift — is the wrong way to
  // colour it: the trend would be cut into pieces at every boundary.
  const hourly = s.slice(s.indexOf("export function HourlyProductionLine"), s.indexOf("export function DelayByDayBar"));
  assert.equal((hourly.match(/<Line\b/g) ?? []).length, 1);
});

test("the shift colours are the ones that were checked, not the obvious ones", () => {
  // #c62828 against #1b5e20 is ΔE 2.0 under protanopia — indistinguishable.
  // These are the lightened steps that pass every check at ΔE 8.5. Changing
  // them back to "proper" dark red/green makes the chart unreadable for a
  // red-green colour-blind reader, which is roughly 1 man in 12.
  const s = src("components/robo/reports/chart-tokens.ts");
  assert.match(s, /A:\s*"#cf2f26"/);
  assert.match(s, /B:\s*"#1f4fa8"/);
  assert.match(s, /C:\s*"#1a7a42"/);
});

test("the shift band and the time labels share one padding, so they line up", () => {
  const s = src("components/robo/reports/report-charts.tsx");
  assert.equal((s.match(/padding=\{HP_XPAD\}/g) ?? []).length, 2);
});

test("the band counts the chart's OWN buckets, each slab under its own Shift", () => {
  // Not a second query: the same slabs the points are drawn from, placed by
  // hourlyProduction. Each is counted under its own Shift (shiftSlabs), not the
  // hour it came out (slabs) — that is how the band came to disagree with the
  // export's Shift column at every boundary (code review, 26 Oct 2026).
  const s = src("components/robo/reports/report-charts.tsx");
  assert.match(s, /shiftBlocks\(hours, data\.map\(\(b\) => b\.shiftSlabs\)\)/);
  assert.match(s, /shiftBlockLines\(b\)/);
});

test("the band draws both lines, the name in the shift's colour and the count in ink", () => {
  const s = src("components/robo/reports/report-charts.tsx");
  const tick = s.slice(s.indexOf("const shiftTick"), s.indexOf("return (\n    <div>"));
  assert.match(tick, /fill=\{SHIFT_HUES\[hit\.code\]\}[\s\S]*\{hit\.lines\[0\]\}/);
  assert.match(tick, /fill=\{DATE_TEXT\}[\s\S]*\{hit\.lines\[1\]\}/);
  // Two baselines, the second below the first.
  const ys = [...tick.matchAll(/y=\{y \+ (\d+)\}/g)].map((m) => Number(m[1]));
  assert.equal(ys.length, 2);
  assert.ok(ys[1] > ys[0], "the count sits under the name");
});

test("the count line was given its own room, not taken out of the plot", () => {
  // The band grew by the height of a second line; the chart grew with it, so
  // the plot area is exactly as tall as it was.
  const s = src("components/robo/reports/report-charts.tsx");
  const num = (name: string, from = s) => {
    const m = new RegExp(`const ${name} = (\\d+);`).exec(from);
    assert.ok(m, `${name} is gone`);
    return Number(m[1]);
  };
  // The chart's height lives in chart-tokens, where the page's placeholder
  // reads it too, so the two cannot drift apart.
  const H = num("HOURLY_PLOT_H", src("components/robo/reports/chart-tokens.ts"));
  assert.match(s, /const HP_HEIGHT = HOURLY_PLOT_H;/);
  const X = num("HP_XAXIS_H");
  const B = num("HP_SHIFT_H");
  assert.ok(B >= 46, `the band must hold two lines of text (is ${B})`);
  assert.equal(H - X - B, 312, "the plot area changed height");
});

test("the date divider is heavier than the gridlines", () => {
  const s = src("components/robo/reports/report-charts.tsx");
  assert.match(s, /<ReferenceLine[^>]*stroke=\{DATE_RULE\}[^>]*strokeWidth=\{2\}/s);
  assert.match(s, /fontWeight:\s*700,\s*fill:\s*DATE_TEXT/);
});

test("both axes are named", () => {
  const s = src("components/robo/reports/report-charts.tsx");
  assert.match(s, /Number of Slabs/);
  assert.match(s, /Time Duration \(in Hours\)/);
});

test("the hourly chart's placeholder is the figure's own height, read without pulling Recharts in", () => {
  const tokens = src("components/robo/reports/chart-tokens.ts");
  // 436 since the band gained its count line; the placeholder moves with it.
  assert.match(tokens, /export const HOURLY_PLOT_H = 436;/);
  assert.match(tokens, /export const HOURLY_FIGURE_H = HOURLY_PLOT_H \+ 2 \* \(16 \+ 4\);/);
  assert.doesNotMatch(tokens, /from "recharts"/);
  assert.match(src("components/robo/reports/report-charts.tsx"), /const HP_HEIGHT = HOURLY_PLOT_H;/);
  const page = src("components/robo/reports/ReportsClient.tsx");
  assert.equal((page.match(/<ChartSkeleton height=\{HOURLY_FIGURE_H\} \/>/g) ?? []).length, 2, "the chunk's loading state and the batch's own read");
  // The page reaches report-charts only through next/dynamic.
  assert.doesNotMatch(page, /^import [^\n]*report-charts/m);
});
