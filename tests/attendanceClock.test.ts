import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CLOCK_SKEW_MINUTES,
  IN_TIME_GRACE_MINUTES,
  clockLabel,
  clockMinutes,
  earliestInTime,
  inTimeError,
  inTimeUnchanged,
  minutesBefore,
  outTimeToStore,
} from "../src/lib/attendance/clock.ts";

/* When attendance may be marked.
 *
 *   1. An In-Time may be up to ten minutes old and no later than now.
 *   2. An Out-Time is stamped with the clock, never typed.
 *
 * Both are checked on the SERVER against its own reading of the plant clock —
 * the page runs the same two functions so the operator is told at once, but it
 * is not what decides. These tests are the rules; the wiring guards at the
 * bottom are what keep the two ends on them. */

const NOW = "18:43"; // the owner's example: the earliest In-Time is 18:33

/* ── Reading the clock ─────────────────────────────────────────────── */

test("a clock time reads as minutes, and nonsense does not", () => {
  assert.equal(clockMinutes("18:43"), 18 * 60 + 43);
  assert.equal(clockMinutes("00:00"), 0);
  assert.equal(clockMinutes("23:59"), 1439);
  for (const bad of ["", "  ", null, undefined, "24:00", "18:60", "6pm", "1843", "18:4"]) {
    assert.equal(clockMinutes(bad as string), null, String(bad));
  }
});

test("minutes read back as a clock, wrapping at both ends", () => {
  assert.equal(clockLabel(0), "00:00");
  assert.equal(clockLabel(18 * 60 + 33), "18:33");
  assert.equal(clockLabel(-10), "23:50"); // ten minutes before midnight
  assert.equal(clockLabel(1440 + 5), "00:05");
});

test("the distance is the short way round the clock", () => {
  const at = (t: string) => clockMinutes(t) as number;
  assert.equal(minutesBefore(at("18:33"), at("18:43")), 10);
  assert.equal(minutesBefore(at("18:43"), at("18:43")), 0);
  assert.equal(minutesBefore(at("18:50"), at("18:43")), -7); // still to come
  // Across midnight, which the night shift does every night: 23:55 is ten
  // minutes before 00:05, not twenty-three hours and fifty minutes after it.
  assert.equal(minutesBefore(at("23:55"), at("00:05")), 10);
  assert.equal(minutesBefore(at("00:05"), at("23:55")), -10);
});

/* ── Rule 1: the In-Time window ────────────────────────────────────── */

test("the owner's example: at 18:43 the earliest In-Time is 18:33", () => {
  assert.equal(IN_TIME_GRACE_MINUTES, 10);
  assert.equal(earliestInTime(NOW), "18:33");
  assert.equal(inTimeError("18:33", NOW), null);
  assert.equal(inTimeError("18:40", NOW), null);
  assert.equal(inTimeError("18:43", NOW), null);
});

test("a minute earlier than the window is refused, and the message says what would work", () => {
  const err = inTimeError("18:32", NOW);
  assert.ok(err, "18:32 should be refused at 18:43");
  assert.match(err, /18:33/);
});

test("the morning cannot be written in during the evening", () => {
  // The whole point: at 18:43 nobody marks themselves in at six o'clock.
  for (const t of ["06:00", "09:15", "13:00", "17:00"]) {
    assert.ok(inTimeError(t, NOW), `${t} should be refused at ${NOW}`);
  }
});

test("the window holds across midnight", () => {
  assert.equal(earliestInTime("00:05"), "23:55");
  assert.equal(inTimeError("23:55", "00:05"), null);
  assert.equal(inTimeError("00:00", "00:05"), null);
  assert.ok(inTimeError("23:54", "00:05"), "a minute before the window, the day before");
  assert.equal(earliestInTime("00:00"), "23:50");
  assert.equal(inTimeError("23:50", "00:00"), null);
});

test("an In-Time in the future is refused, bar a tablet's couple of minutes of drift", () => {
  assert.equal(CLOCK_SKEW_MINUTES, 2);
  assert.equal(inTimeError("18:45", NOW), null, "two minutes fast is believed");
  const err = inTimeError("18:50", NOW);
  assert.ok(err, "seven minutes ahead is not");
  assert.match(err, /later than now/);
  // And across midnight the same way.
  assert.ok(inTimeError("00:30", "23:55"), "half an hour into tomorrow");
});

test("something that is not a time is refused before anything else", () => {
  assert.match(String(inTimeError("25:00", NOW)), /HH:MM/);
  assert.match(String(inTimeError("", NOW)), /HH:MM/);
});

test("an unreadable clock never blocks the floor", () => {
  // If the server could not read its own clock the register still has to work;
  // refusing every entry would stop the line to no purpose.
  assert.equal(inTimeError("06:00", ""), null);
  assert.equal(earliestInTime("nonsense"), "");
});

/* ── Rule 2: the Out-Time is stamped ───────────────────────────────── */

test("an Out-Time is the clock, whatever was sent", () => {
  // Typed, pasted, or posted straight at the API — it makes no difference.
  assert.equal(outTimeToStore("23:59", null, NOW), NOW);
  assert.equal(outTimeToStore("06:00", null, NOW), NOW);
  assert.equal(outTimeToStore("18:43", null, NOW), NOW);
});

test("an Out-Time can never be in the future, because it is never taken from the sender", () => {
  for (const sent of ["19:00", "23:59", "18:44"]) {
    assert.equal(outTimeToStore(sent, null, NOW), NOW, sent);
  }
});

test("an Out-Time already stored is left alone when the row is saved again", () => {
  // The case that matters: opening this morning's row at six to tick the other
  // line must not move an Out-Time stamped at 14:30 to now.
  assert.equal(outTimeToStore("14:30", "14:30", NOW), "14:30");
});

test("an Out-Time can be cleared, and re-stamping can only ever be the clock", () => {
  assert.equal(outTimeToStore("", "14:30", NOW), null);
  assert.equal(outTimeToStore(null, "14:30", NOW), null);
  assert.equal(outTimeToStore("09:00", "14:30", NOW), NOW, "changed to anything = stamped now");
});

test("with no clock to read, an Out-Time is not invented", () => {
  assert.equal(outTimeToStore("19:00", null, ""), null);
  assert.equal(outTimeToStore("19:00", "14:30", ""), "14:30");
});

/* ── Carrying a time back is not entering one ──────────────────────── */

test("an In-Time that did not change is recognised as unchanged", () => {
  assert.equal(inTimeUnchanged("06:00", "06:00"), true);
  assert.equal(inTimeUnchanged(" 06:00 ", "06:00"), true);
  assert.equal(inTimeUnchanged("", null), true);
  assert.equal(inTimeUnchanged("06:05", "06:00"), false);
  assert.equal(inTimeUnchanged("06:00", null), false);
});

/* ── Wiring guards ─────────────────────────────────────────────────── */

/** A source file as the repository holds it: LF, whatever the checkout did to
 *  it — see tests/sourceLineEndings.test.ts. */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the server checks against ITS OWN clock, not the one that was sent", () => {
  const s = src("lib/attendance/server.ts");
  assert.match(s, /const nowPlant = toPlantTimeInput\(new Date\(\)\)/);
  // The clock rules are the TABLET's, on today's row (code review, 26 Oct
  // 2026): the Plant In-Charge types today's times as on a past day. The
  // tablet's Out on last night's open row is stamped too.
  assert.match(s, /const clockRules = isToday && !rights\.amendSaved;/);
  assert.match(s, /inTimeErrorOn\(clockRules, inTime, nowPlant\)/);
  // (17 Nov 2026: the same decision is now named once, `stamped`, as the Out's date follows it.)
  assert.match(s, /const stamped = clockRules \|\| closesLastNight;/);
  assert.match(s, /outTimeToStoreOn\(stamped, b\.outTime as string, existing\?\.outTime, nowPlant\)/);
  // And which day it is, is the SERVER's reading of the plant date too —
  // read once into `today`, which the tablet's today-only rule is checked
  // against as well, so the two cannot be told different days.
  assert.match(s, /const today = todayPlant\(\);/);
  assert.match(s, /const kind = dayKind\(date, today\)/);
  // The body's own outTime must not reach the row by any other path.
  assert.doesNotMatch(s, /outTime\s*=\s*timeOrNull\(b\.outTime\)/);
});

test("the server only judges an In-Time that is being entered", () => {
  // Without this, a row saved this morning could never be corrected again:
  // its own 06:00 would come back and the window would refuse it.
  assert.match(src("lib/attendance/server.ts"), /const inTimeChanged = !inTimeUnchanged\(b\.inTime as string, existing\?\.inTime\);\s+if \(inTimeChanged\) \{/);
});

test("the page runs the same two rules, and will not save past them", () => {
  const s = src("components/attendance/AttendanceClient.tsx");
  assert.match(s, /from "@\/lib\/attendance\/clock"/);
  assert.match(s, /const clockRules = isToday && !rights\.amendSaved;/);
  assert.match(s, /inTimeErrorOn\(clockRules, draft\.inTime, now\)/);
  // And past the In-Charge's typed Out-Time on today, by the same server rule.
  assert.match(s, /disabled=\{saving \|\| Boolean\(inError\) \|\| Boolean\(outError\)\}/);
});

test("the page spares an unchanged In-Time exactly as the server does", () => {
  // Both ends have to agree on this or the page refuses to send what the
  // server would have accepted: a row entered this morning would be stuck,
  // its Line uncorrectable, with no way past it on the floor.
  assert.match(src("components/attendance/AttendanceClient.tsx"), /!inTimeUnchanged\(draft\.inTime, originalIn\)/);
});

test("the Out-Time box cannot be typed into — on the tablet's today", () => {
  /* On the tablet's today it is a div and two buttons, not an input: there is
     nothing to type in, so the stamp is the only way a time gets there. On an
     EARLIER day, and for the Plant In-Charge putting today right, it is typed,
     because no reading of the clock would be right for a time already past
     and because a missed Out has to be completable — which the register now
     insists on. The two are the two arms of one ternary on `clockRules`, so
     neither can be reached for the other's case. */
  const s = src("components/attendance/AttendanceClient.tsx");
  const cell = s.slice(s.indexOf("The Out-Time is stamped, never typed"), s.indexOf("/* ── 2. Leave Taken"));
  assert.match(cell, /\{clockRules \? \(/);
  const today = cell.slice(cell.indexOf("{clockRules ? ("), cell.indexOf(") : ("));
  assert.doesNotMatch(today, /<TimeInput/);
  assert.match(today, /onClick=\{props\.markOut\}/);
  assert.match(cell.slice(cell.indexOf(") : (")), /<TimeInput[^>]*value=\{draft\.outTime\}/);
});

test("both ends read the plant's clock, not the server's own timezone", () => {
  for (const p of ["lib/attendance/server.ts", "components/attendance/AttendanceClient.tsx"]) {
    assert.match(src(p), /toPlantTimeInput/, p);
  }
});
