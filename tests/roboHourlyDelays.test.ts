import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { hourlyProduction, type HourlyDelay, type HourlySlab } from "../src/lib/robo/hourlyProduction.ts";

/* The delays behind each hour of "Production Rate per Hour" — what the chart's
 * tooltip lists when a supervisor asks why an hour was quiet.
 *
 * TWO RULES, both of them the register's own doing (2026-10-20):
 *
 *   1. A delay is listed in EVERY hour it ran through, cut at the boundary,
 *      keeping its code and carrying the part of itself that fell in that
 *      hour. It used to be listed whole under the hour it began in, which put
 *      a 480-minute power cut into one bucket and left the seven hours it
 *      actually covered reading "No delays".
 *
 *   2. The hour's TOTAL is the minutes of the hour that were under a delay,
 *      counted once. The floor logs a delay against the slab it held up, so
 *      one stoppage is written down once per slab waiting on it and the rows
 *      overlap — an hour that lists 69 minutes of them still only lost sixty
 *      at the very most. */

/** A slab of one batch, in and out within the hour given. */
const slab = (date: string, hour: number, id: string, n: string): HourlySlab => ({
  productionDate: date,
  inTime: `${String(hour).padStart(2, "0")}:05`,
  outTime: `${String(hour).padStart(2, "0")}:45`,
  id,
  slabNumber: n,
  createdAtMs: hour,
});

/** A straight run, one slab an hour, 10:00 → 19:00 on 10 Oct. */
const RUN: HourlySlab[] = Array.from({ length: 10 }, (_, i) =>
  slab("2026-10-10", 10 + i, `s${i}`, String(5000 + i)),
);

const delay = (over: Partial<HourlyDelay> = {}): HourlyDelay => ({
  slabId: "s6", // the 16:00 slab
  code: "D1",
  minutes: 6,
  startTime: "16:15",
  endTime: "16:21",
  ...over,
});

/** The bucket labelled HH:00–… */
const at = (series: ReturnType<typeof hourlyProduction>, label: string) => {
  const b = series.find((x) => x.label === label);
  assert.ok(b, `no bucket ${label}`);
  return b;
};

/* ── The owner's example ───────────────────────────────────────────── */

test("the hour lists its delays and totals them", () => {
  const series = hourlyProduction(RUN, [
    delay(),
    delay({ code: "RM1", minutes: 22, startTime: "16:33", endTime: "16:55" }),
  ]);
  const b = at(series, "16:00–17:00");
  assert.deepEqual(b.delays, [
    { code: "D1", minutes: 6, start: "16:15", end: "16:21" },
    { code: "RM1", minutes: 22, start: "16:33", end: "16:55" },
  ]);
  // 6 + 22 = 28, and the total is the sum of exactly the lines shown.
  assert.equal(b.delayMins, 28);
  assert.equal(b.delayMins, b.delays.reduce((t, d) => t + d.minutes, 0));
});

test("an hour with no delays says so, and totals nothing", () => {
  const series = hourlyProduction(RUN, [delay()]);
  const quiet = at(series, "11:00–12:00");
  assert.deepEqual(quiet.delays, []);
  assert.equal(quiet.delayMins, 0);
});

test("every delay of an hour is listed, not the first one or two", () => {
  // Six of them, one every eight minutes, each a minute longer than the last
  // and none touching the next: 1+2+3+4+5+6 minutes of the hour lost.
  const many = Array.from({ length: 6 }, (_, i) =>
    delay({
      code: `C${i}`, minutes: i + 1,
      startTime: `16:${String(i * 8).padStart(2, "0")}`,
      endTime: `16:${String(i * 8 + i + 1).padStart(2, "0")}`,
    }),
  );
  const b = at(hourlyProduction(RUN, many), "16:00–17:00");
  assert.equal(b.delays.length, 6);
  assert.equal(b.delayMins, 1 + 2 + 3 + 4 + 5 + 6);
  assert.equal(b.delaysOverlap, false, "none of them overlap, so the lines add up");
});

test("the delays of an hour read in the order they happened", () => {
  const b = at(hourlyProduction(RUN, [
    delay({ code: "RM1", minutes: 22, startTime: "16:33", endTime: "16:55" }),
    delay({ code: "D1", minutes: 6, startTime: "16:15", endTime: "16:21" }),
  ]), "16:00–17:00");
  assert.deepEqual(b.delays.map((d) => d.code), ["D1", "RM1"]);
});

/* ── Where a delay lands ───────────────────────────────────────────── */

/* ── Rule 1: a delay is cut at the hour, and listed in each ────────── */

test("the owner's example: 03:55 → 04:12 is 5 minutes of one hour and 12 of the next", () => {
  const run: HourlySlab[] = [slab("2026-10-10", 3, "a", "9001"), slab("2026-10-10", 4, "b", "9002")];
  const series = hourlyProduction(run, [
    { slabId: "a", code: "D1", minutes: 17, startTime: "03:55", endTime: "04:12" },
  ]);
  assert.deepEqual(at(series, "03:00–04:00").delays, [{ code: "D1", minutes: 5, start: "03:55", end: "04:00" }]);
  assert.deepEqual(at(series, "04:00–05:00").delays, [{ code: "D1", minutes: 12, start: "04:00", end: "04:12" }]);
  assert.equal(at(series, "03:00–04:00").delayMins, 5);
  assert.equal(at(series, "04:00–05:00").delayMins, 12);
});

test("a delay runs through every hour it covers, and each one gets its own part", () => {
  // 95 minutes from 16:40: 20 of this hour, the whole of the next, 15 of the
  // one after. The 17:00 hour used to read "No delays" while the line stood
  // still for all sixty minutes of it.
  const series = hourlyProduction(RUN, [delay({ code: "C10", minutes: 95, startTime: "16:40", endTime: "18:15" })]);
  assert.deepEqual(at(series, "16:00–17:00").delays, [{ code: "C10", minutes: 20, start: "16:40", end: "17:00" }]);
  assert.deepEqual(at(series, "17:00–18:00").delays, [{ code: "C10", minutes: 60, start: "17:00", end: "18:00" }]);
  assert.deepEqual(at(series, "18:00–19:00").delays, [{ code: "C10", minutes: 15, start: "18:00", end: "18:15" }]);
  // And nothing was invented or lost on the way: the parts are the whole.
  assert.equal(series.reduce((t, b) => t + b.delayMins, 0), 95);
});

test("a full-hour stoppage reads as the full hour, in the hour it stopped", () => {
  /* The owner's case, and a real one: T1 22:00 → 06:00 on D-1449, 480 minutes
     of power cut. Every hour of it has no slabs — BECAUSE of the cut — and
     every one of them must say so. */
  const run: HourlySlab[] = [
    { productionDate: "2026-09-23", inTime: "21:30", outTime: "21:50", id: "before", slabNumber: "8000", createdAtMs: 1 },
    { productionDate: "2026-09-24", inTime: "06:10", outTime: "06:40", id: "after", slabNumber: "8001", createdAtMs: 2 },
  ];
  const series = hourlyProduction(run, [
    { slabId: "before", code: "T1", minutes: 480, startTime: "22:00", endTime: "06:00" },
  ]);
  for (const label of ["22:00–23:00", "23:00–00:00", "00:00–01:00", "03:00–04:00", "05:00–06:00"]) {
    const b = at(series, label);
    assert.equal(b.slabs, 0, `${label} made nothing`);
    assert.equal(b.delayMins, 60, `${label} lost the whole hour`);
    assert.deepEqual(b.delays, [{ code: "T1", minutes: 60, start: label.slice(0, 5), end: label.slice(6) }], label);
  }
  // Eight hours of it, and not a minute in the hour it ended on.
  assert.equal(series.filter((b) => b.delayMins === 60).length, 8);
  assert.equal(at(series, "06:00–07:00").delayMins, 0, "it ended AT 06:00, so the 06:00 hour lost none of it");
  assert.equal(series.reduce((t, b) => t + b.delayMins, 0), 480);
});

test("a delay that ends on the hour does not leave an empty line in the next one", () => {
  const series = hourlyProduction(RUN, [delay({ code: "D1", minutes: 20, startTime: "16:40", endTime: "17:00" })]);
  assert.deepEqual(at(series, "16:00–17:00").delays, [{ code: "D1", minutes: 20, start: "16:40", end: "17:00" }]);
  assert.deepEqual(at(series, "17:00–18:00").delays, []);
});

test("a delay of no length still gets its line, so it can be found", () => {
  const b = at(hourlyProduction(RUN, [delay({ code: "D1", minutes: 0, startTime: "16:20", endTime: "16:20" })]), "16:00–17:00");
  assert.deepEqual(b.delays, [{ code: "D1", minutes: 0, start: "16:20", end: "16:20" }]);
  assert.equal(b.delayMins, 0);
  // Including one logged ON the hour, where "the hour its last minute fell in"
  // is the hour BEFORE the one it happened in.
  const onTheHour = at(hourlyProduction(RUN, [delay({ code: "D1", minutes: 0, startTime: "17:00", endTime: "17:00" })]), "17:00–18:00");
  assert.deepEqual(onTheHour.delays, [{ code: "D1", minutes: 0, start: "17:00", end: "17:00" }]);
  assert.deepEqual(at(hourlyProduction(RUN, [delay({ code: "D1", minutes: 0, startTime: "17:00", endTime: "17:00" })]), "16:00–17:00").delays, []);
});

test("an end before the start crossed midnight, it did not run backwards", () => {
  // Eight of the delays on record end before they start. 22:00 → 06:00 is
  // eight hours, never minus sixteen.
  const run: HourlySlab[] = [
    { productionDate: "2026-10-10", inTime: "21:40", outTime: "21:55", id: "p", slabNumber: "8100", createdAtMs: 1 },
    { productionDate: "2026-10-11", inTime: "02:10", outTime: "02:30", id: "q", slabNumber: "8101", createdAtMs: 2 },
  ];
  const series = hourlyProduction(run, [
    { slabId: "p", code: "T1", minutes: 240, startTime: "23:00", endTime: "03:00" },
  ]);
  assert.equal(series.reduce((t, b) => t + b.delayMins, 0), 240);
  assert.equal(at(series, "23:00–00:00").delayMins, 60);
  assert.equal(at(series, "02:00–03:00").delayMins, 60);

  /* And the CLOCK is what says how long, not the stored duration — the two
     agree on every one of the 1,783 rows on record, so where they could not,
     the operator's own "back at 03:00" is the record. Read without wrapping,
     23:00 → 03:00 is minus twenty hours, and a stored figure standing in for
     it would hide that. */
  const wrong = hourlyProduction(run, [
    { slabId: "p", code: "T1", minutes: 1, startTime: "23:00", endTime: "03:00" },
  ]);
  assert.equal(wrong.reduce((t, b) => t + b.delayMins, 0), 240);
});

test("with no end time the register's own duration says how long", () => {
  const series = hourlyProduction(RUN, [delay({ code: "RM1", minutes: 25, startTime: "16:50", endTime: null })]);
  assert.deepEqual(at(series, "16:00–17:00").delays, [{ code: "RM1", minutes: 10, start: "16:50", end: "17:00" }]);
  assert.deepEqual(at(series, "17:00–18:00").delays, [{ code: "RM1", minutes: 15, start: "17:00", end: "17:15" }]);
});

/* ── Rule 2: an hour cannot lose more than it has ──────────────────── */

test("D-1473, 19 Oct 05:00 — eight overlapping rows, and an hour that has 60 minutes", () => {
  /* The register as it stands. Every one of these is a real row, logged
     against the slab it held up, which is why they overlap: 05:28–05:49 runs
     through 05:32–05:34 and 05:36–05:39, and 05:41–06:07 starts before it has
     ended. Added up they are 69 minutes. The line was stopped 05:28 → 06:07,
     once; this hour lost 05:00–05:10, 05:12–05:15, 05:16–05:20 and
     05:28–06:00 — 49 minutes. */
  const run: HourlySlab[] = Array.from({ length: 3 }, (_, i) =>
    slab("2026-10-19", 4 + i, `r${i}`, String(167117 + i)));
  const d = (minutes: number, startTime: string, endTime: string): HourlyDelay =>
    ({ slabId: "r1", code: "D1", minutes, startTime, endTime });
  const series = hourlyProduction(run, [
    d(3, "05:00", "05:03"), d(7, "05:03", "05:10"), d(3, "05:12", "05:15"), d(4, "05:16", "05:20"),
    d(21, "05:28", "05:49"), d(2, "05:32", "05:34"), d(3, "05:36", "05:39"), d(26, "05:41", "06:07"),
  ]);
  const b = at(series, "05:00–06:00");
  assert.equal(b.delays.length, 8, "every row is still listed");
  assert.equal(b.delayMins, 49);
  assert.equal(b.delaysOverlap, true, "and the box says why they do not add up");
  // The last one was cut at the hour; the rest of it is in the next.
  assert.deepEqual(b.delays[7], { code: "D1", minutes: 19, start: "05:41", end: "06:00" });
  assert.deepEqual(at(series, "06:00–07:00").delays[0], { code: "D1", minutes: 7, start: "06:00", end: "06:07" });
});

test("no hour of any run can ever lose more than sixty minutes", () => {
  // The property, not an example: whatever the register holds — overlapping
  // rows, rows longer than a day, rows piled on one minute — an hour has
  // sixty minutes to lose.
  const run: HourlySlab[] = Array.from({ length: 12 }, (_, i) => slab("2026-10-10", 8 + i, `h${i}`, String(9100 + i)));
  const pile: HourlyDelay[] = [
    { slabId: "h2", code: "T1", minutes: 480, startTime: "10:00", endTime: "18:00" },
    { slabId: "h2", code: "D1", minutes: 90, startTime: "10:30", endTime: "12:00" },
    { slabId: "h3", code: "RM1", minutes: 30, startTime: "11:10", endTime: "11:40" },
    { slabId: "h3", code: "L1", minutes: 59, startTime: "11:00", endTime: "11:59" },
    { slabId: "h5", code: "C1", minutes: 1, startTime: "13:00", endTime: "13:01" },
    { slabId: "h5", code: "C2", minutes: 1, startTime: "13:00", endTime: "13:01" },
  ];
  for (const b of hourlyProduction(run, pile)) {
    assert.ok(b.delayMins <= 60, `${b.label} claims ${b.delayMins} minutes of a 60-minute hour`);
    assert.ok(b.delayMins >= 0, b.label);
  }
  // The 11:00 hour has four of them running at once and is simply gone.
  assert.equal(at(hourlyProduction(run, pile), "11:00–12:00").delayMins, 60);
});

test("the same minute written down twice is one minute lost", () => {
  const b = at(hourlyProduction(RUN, [
    delay({ code: "C1", minutes: 1, startTime: "16:00", endTime: "16:01" }),
    delay({ code: "C2", minutes: 1, startTime: "16:00", endTime: "16:01" }),
  ]), "16:00–17:00");
  assert.equal(b.delays.length, 2, "both rows are shown");
  assert.equal(b.delayMins, 1);
  assert.equal(b.delaysOverlap, true);
});

test("delays that do not overlap are not flagged, and their lines do add up", () => {
  const b = at(hourlyProduction(RUN, [
    delay({ code: "D1", minutes: 6, startTime: "16:15", endTime: "16:21" }),
    delay({ code: "RM1", minutes: 22, startTime: "16:33", endTime: "16:55" }),
  ]), "16:00–17:00");
  assert.equal(b.delaysOverlap, false);
  assert.equal(b.delayMins, b.delays.reduce((t, d) => t + d.minutes, 0));
});

test("one delay inside another is counted once, and both are still shown", () => {
  const b = at(hourlyProduction(RUN, [
    delay({ code: "T1", minutes: 40, startTime: "16:10", endTime: "16:50" }),
    delay({ code: "D1", minutes: 5, startTime: "16:20", endTime: "16:25" }),
  ]), "16:00–17:00");
  assert.equal(b.delays.length, 2);
  assert.equal(b.delayMins, 40);
  assert.equal(b.delaysOverlap, true);
});

test("a delay with no start time is left out rather than guessed into an hour", () => {
  const series = hourlyProduction(RUN, [delay({ startTime: null, endTime: null })]);
  assert.equal(series.reduce((t, b) => t + b.delays.length, 0), 0);
  assert.equal(series.reduce((t, b) => t + b.delayMins, 0), 0);
});

test("a delay outside the run's own hours is not drawn into it", () => {
  // The run is 10:00 → 19:00; a delay at 03:00 belongs to no hour of it.
  const series = hourlyProduction(RUN, [delay({ startTime: "03:00", endTime: "03:20", minutes: 20 })]);
  assert.equal(series.reduce((t, b) => t + b.delayMins, 0), 0);
});

test("a delay follows the slab it held up when the chart moved that slab a day", () => {
  /* The entry form's working-date slip: one slab of a run carries a date a day
     off, and placeSlabs draws it with the rest of its run. Its delay has to go
     with it — a delay drawn 24 hours from the slab it held up would sit in an
     hour where nothing was happening. */
  const run: HourlySlab[] = [
    ...Array.from({ length: 6 }, (_, i) => slab("2026-10-10", 10 + i, `a${i}`, String(6000 + i))),
    // Keyed a day early by mistake, but made at 16:xx with the others.
    slab("2026-10-09", 16, "late", "6006"),
    ...Array.from({ length: 5 }, (_, i) => slab("2026-10-10", 17 + i, `b${i}`, String(6007 + i))),
  ];
  const series = hourlyProduction(run, [
    { slabId: "late", code: "D1", minutes: 9, startTime: "16:20", endTime: "16:29" },
  ]);
  // One timeline, one 16:00 hour, and the delay is in it.
  const sixteens = series.filter((b) => b.label === "16:00–17:00");
  assert.equal(sixteens.length, 1, "the run should be one day, not two");
  assert.equal(sixteens[0].delayMins, 9);
});

test("a delay after midnight belongs to the next day, like the slab's own Out", () => {
  // The slab went in at 23:50 and came out at 00:40 — it crossed midnight, and
  // a delay logged at 00:10 was after the crossing, not nineteen hours before
  // the slab started.
  const run: HourlySlab[] = [
    { productionDate: "2026-10-10", inTime: "23:50", outTime: "00:40", id: "x", slabNumber: "7000", createdAtMs: 1 },
  ];
  const series = hourlyProduction(run, [
    { slabId: "x", code: "D1", minutes: 12, startTime: "00:10", endTime: "00:22" },
  ]);
  const midnight = series.find((b) => b.label === "00:00–01:00");
  assert.ok(midnight, "the run should reach past midnight");
  assert.equal(midnight.delayMins, 12);
  assert.equal(series[0].label, "23:00–00:00");
  assert.equal(series[0].delayMins, 0);
});

test("a delay logged without a slab falls back to its own date", () => {
  const series = hourlyProduction(RUN, [
    { slabId: null, code: "P1", minutes: 30, startTime: "12:10", endTime: "12:40", date: "2026-10-10" },
  ]);
  assert.equal(at(series, "12:00–13:00").delayMins, 30);
});

test("a slab-less delay with no date of its own is left out", () => {
  const series = hourlyProduction(RUN, [
    { slabId: null, code: "P1", minutes: 30, startTime: "12:10", endTime: "12:40", date: null },
  ]);
  assert.equal(series.reduce((t, b) => t + b.delayMins, 0), 0);
});

/* ── Nothing else changed ──────────────────────────────────────────── */

test("the hourly counts are exactly what they were before delays were added", () => {
  const without = hourlyProduction(RUN);
  const withDelays = hourlyProduction(RUN, [delay(), delay({ code: "RM1", startTime: "16:40", endTime: "16:50" })]);
  assert.deepEqual(withDelays.map((b) => b.slabs), without.map((b) => b.slabs));
  assert.deepEqual(withDelays.map((b) => b.label), without.map((b) => b.label));
  assert.deepEqual(withDelays.map((b) => b.date), without.map((b) => b.date));
});

test("no delays given means every hour reads none, not undefined", () => {
  for (const b of hourlyProduction(RUN)) {
    assert.deepEqual(b.delays, []);
    assert.equal(b.delayMins, 0);
  }
});

/* ── Wiring guards ─────────────────────────────────────────────────── */

/** A source file as the repository holds it: LF, whatever the checkout did to it.
 *  A CRLF working copy would make every \n in the patterns below miss, and a
 *  doesNotMatch pass without looking — see tests/sourceLineEndings.test.ts. */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the route reads this batch's delays through its slabs, and hands them to the series", () => {
  const s = src("app/api/robo/reports/hourly/route.ts");
  assert.match(s, /productionRecord:\s*\{\s*batchRecipeId:\s*\{\s*in:\s*batchIds\s*\}\s*\}/);
  assert.match(s, /hourlyProduction\(rows,\s*delays\)/);
  // The code alone — the tooltip shows codes, not descriptions.
  assert.match(s, /delayCode:\s*\{\s*select:\s*\{\s*code:\s*true\s*\}\s*\}/);
  assert.doesNotMatch(s, /description:\s*true/);
});

test("the tooltip shows the code, the duration, the range and the total", () => {
  const s = src("components/robo/reports/report-charts.tsx");
  assert.match(s, /\{d\.code\}/);
  assert.match(s, /fmtDurationLong\(d\.minutes\)/);
  assert.match(s, /\[\{d\.start\}–\{d\.end\}\]/);
  assert.match(s, /Total delays: \{fmtDurationLong\(b\.delayMins \?\? 0\)\}/);
  assert.match(s, /No delays/);
});

test("the tooltip says when its lines overlap, instead of printing an addition that fails", () => {
  assert.match(src("components/robo/reports/report-charts.tsx"), /\{b\.delaysOverlap && \(/);
});

test("the hour's total is the time covered, not the lines added up", () => {
  // The guard against the fix being quietly undone: summing the entries is
  // exactly what produced "1 hour 9 minutes" in a sixty-minute hour.
  const s = src("lib/robo/hourlyProduction.ts");
  assert.match(s, /const lost = coveredMinutes\(pieces\.map\(\(p\) => p\.at\)\)/);
  assert.match(s, /delayMins: lost,/);
  assert.doesNotMatch(s, /delayMins: hourDelays\.reduce/);
});

test("a delay is cut at the hour boundary, not filed under the hour it began in", () => {
  const s = src("lib/robo/hourlyProduction.ts");
  assert.match(s, /const a = Math\.max\(from, h \* 60\);/);
  assert.match(s, /const b = Math\.min\(to, \(h \+ 1\) \* 60\);/);
  // The old one-hour-only placement is gone, not merely unused.
  assert.doesNotMatch(s, /function delayHour\b/);
});

test("touch gets the reading under the chart, where a phone can show all of it", () => {
  const s = src("components/robo/reports/report-charts.tsx");
  assert.match(s, /trigger=\{coarsePointer \? "click" : "hover"\}/);
  assert.match(s, /content=\{coarsePointer \? \(\) => null : <HourTooltip \/>\}/);
  assert.match(s, /\{tappedHour && \(/);
});
