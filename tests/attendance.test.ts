import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  INCOMPLETE_PREVIOUS_DAY,
  LEAVE_TYPES,
  LEAVE_TYPE_HUES,
  LEAVE_TYPE_LABELS,
  LINES,
  amendsSavedRow,
  cleanOperatorName,
  dayKind,
  joinLines,
  leaveLabel,
  leaveTypeError,
  leaveTypeHue,
  leaveTypeLabel,
  linesLabel,
  operatorNameError,
  outDate,
  outDaysOf,
  parseLeaveType,
  parseLines,
  previousDay,
  previousDayIncomplete,
  rollsOvernight,
  shiftDate,
  workedLabel,
  workedMinutes,
} from "../src/lib/attendance/attendance.ts";
import {
  ATTENDANCE_COLUMNS,
  LEAVE_COLUMNS,
  columnsFor,
  describeFilter,
  filterFileName,
  matchesFilter,
  periodBounds,
  widthsFor,
  type AttendanceFilter,
} from "../src/lib/attendance/filters.ts";

/* The attendance register, shared by the Robo line and the Chromia line.
 *
 * The one thing these tests are really protecting: there is ONE register. Not
 * two that are kept in step — one set of tables, one handler, one screen, and
 * a unique key on (date, operator) so the same day entered from either ERP is
 * the same row. Anything that quietly makes a second copy is the bug. */

/* ── The two lines ─────────────────────────────────────────────────── */

test("an operator can be on one line or both", () => {
  assert.deepEqual(parseLines("ROBO"), ["ROBO"]);
  assert.deepEqual(parseLines("CHROMIA"), ["CHROMIA"]);
  assert.deepEqual(parseLines("ROBO,CHROMIA"), ["ROBO", "CHROMIA"]);
  assert.deepEqual(parseLines(""), []);
  assert.deepEqual(parseLines(null), []);
});

test("the lines read in one order however they were stored", () => {
  // Two screens writing the same pair must not produce two different strings.
  assert.deepEqual(parseLines("CHROMIA,ROBO"), ["ROBO", "CHROMIA"]);
  assert.equal(joinLines(["CHROMIA", "ROBO"]), "ROBO,CHROMIA");
  assert.equal(joinLines(["ROBO", "CHROMIA"]), "ROBO,CHROMIA");
});

test("a line named twice is still one line, and a line nobody runs is dropped", () => {
  assert.equal(joinLines(["ROBO", "ROBO", "CHROMIA"]), "ROBO,CHROMIA");
  assert.equal(joinLines(["ROBO", "POLISHING", ""]), "ROBO");
  assert.equal(joinLines([]), "");
});

test("lowercase and spacing do not make a different line", () => {
  assert.equal(joinLines([" robo ", "chromia"]), "ROBO,CHROMIA");
});

test("the register names the lines in words", () => {
  assert.equal(linesLabel("ROBO"), "Robo Line");
  assert.equal(linesLabel("ROBO,CHROMIA"), "Robo Line + Chromia Line");
  assert.equal(linesLabel(""), "-");
});

/* ── Worked hours ──────────────────────────────────────────────────── */

test("the hours are the gap between In and Out", () => {
  assert.equal(workedMinutes("09:00", "17:30"), 510);
  assert.equal(workedLabel("09:00", "17:30"), "8h 30m");
  assert.equal(workedLabel("09:00", "17:00"), "8h");
  assert.equal(workedLabel("09:00", "09:45"), "45m");
});

test("a night shift crosses midnight instead of going backwards", () => {
  // 22:00 → 06:00 is eight hours, not minus sixteen.
  assert.equal(workedMinutes("22:00", "06:00"), 8 * 60);
  assert.equal(workedLabel("22:00", "06:00"), "8h");
  assert.equal(workedLabel("23:50", "00:10"), "20m");
});

test("a pair that cannot be a day's work reads as nothing, not as a number", () => {
  assert.equal(workedMinutes("09:00", "09:00"), null); // nobody works no time
  assert.equal(workedMinutes("09:00", ""), null);
  assert.equal(workedMinutes(null, "17:00"), null);
  assert.equal(workedMinutes("nonsense", "17:00"), null);
  assert.equal(workedMinutes("25:00", "17:00"), null);
  assert.equal(workedMinutes("09:70", "17:00"), null);
  assert.equal(workedLabel("09:00", ""), "-");
});

test("there is no longest shift: 08:00 to 07:00 the next morning is 23 hours, and 35 h counts from the Out date", () => {
  // The owner removed the 16-hour limit on 17 Nov 2026. With no Out date the
  // times are read as before (an Out earlier than the In is the next morning)...
  assert.equal(workedMinutes("08:00", "07:00"), 23 * 60);
  assert.equal(workedLabel("08:00", "07:00"), "23h");
  assert.equal(workedMinutes("06:00", "22:00"), 16 * 60);
  // ...and a recorded Out date says how many days later it fell: 08:00 on the
  // 1st to 19:00 on the 2nd is 35 hours, never rolled into days.
  assert.equal(outDaysOf("2026-11-01", "2026-11-02"), 1);
  assert.equal(workedMinutes("08:00", "19:00", 1), 35 * 60);
  assert.equal(workedLabel("08:00", "19:00", 1), "35h");
  assert.equal(workedLabel("08:00", "19:30", outDaysOf("2026-11-01", "2026-11-02")), "35h 30m");
  assert.equal(workedMinutes("08:00", "19:00", 0), 11 * 60);
  // The same date with the Out before (or equal to) the In is still no shift.
  assert.equal(workedMinutes("09:00", "08:00", 0), null);
  assert.equal(workedMinutes("09:00", "09:00", 0), null);
  assert.equal(outDaysOf("2026-11-01", null), undefined);
});

/* ── Leave ─────────────────────────────────────────────────────────── */

test("leave reads as the hours away, or as the whole day", () => {
  assert.equal(leaveLabel("14:00", "16:30"), "14:00–16:30");
  assert.equal(leaveLabel("", ""), "Full day");
  assert.equal(leaveLabel(null, null), "Full day");
  assert.equal(leaveLabel("14:00", ""), "14:00");
});

/* ── Operator names ────────────────────────────────────────────────── */

test("a typed name is tidied, and an empty one refused", () => {
  assert.equal(cleanOperatorName("  Praveen   Kumar.S  "), "Praveen Kumar.S");
  assert.equal(operatorNameError("Praveen Kumar.S"), null);
  assert.match(String(operatorNameError("   ")), /name/i);
  assert.match(String(operatorNameError("x".repeat(200))), /characters/);
});

/* ── The download filters ──────────────────────────────────────────── */

const TODAY = "2026-10-18";
const f = (over: Partial<AttendanceFilter> = {}): AttendanceFilter =>
  ({ type: "ATTENDANCE", operatorId: "", period: "ALL", ...over });

test("a single date covers that one day", () => {
  assert.deepEqual(periodBounds(f({ period: "DATE", date: "2026-10-12" }), TODAY), { from: "2026-10-12", to: "2026-10-12" });
});

test("last week is seven days up to and including today", () => {
  assert.deepEqual(periodBounds(f({ period: "LAST_WEEK" }), TODAY), { from: "2026-10-12", to: "2026-10-18" });
});

test("month-wise is the whole calendar month, short months and leap years included", () => {
  assert.deepEqual(periodBounds(f({ period: "MONTH", month: "2026-10" }), TODAY), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(periodBounds(f({ period: "MONTH", month: "2026-02" }), TODAY), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodBounds(f({ period: "MONTH", month: "2028-02" }), TODAY), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(periodBounds(f({ period: "MONTH", month: "2026-12" }), TODAY), { from: "2026-12-01", to: "2026-12-31" });
});

test("a custom range typed the wrong way round is still the range they meant", () => {
  assert.deepEqual(periodBounds(f({ period: "RANGE", from: "2026-10-20", to: "2026-10-01" }), TODAY), { from: "2026-10-01", to: "2026-10-20" });
});

test("a half-filled range stays open at that end rather than quietly becoming today", () => {
  assert.deepEqual(periodBounds(f({ period: "RANGE", from: "2026-10-01" }), TODAY), { from: "2026-10-01", to: null });
  assert.deepEqual(periodBounds(f({ period: "RANGE", to: "2026-10-01" }), TODAY), { from: null, to: "2026-10-01" });
});

test("all records is open at both ends", () => {
  assert.deepEqual(periodBounds(f(), TODAY), { from: null, to: null });
});

test("a period with nothing filled in selects nothing silently, not everything", () => {
  // An unusable month must not fall back to "every record ever".
  assert.deepEqual(periodBounds(f({ period: "MONTH", month: "" }), TODAY), { from: null, to: null });
  assert.deepEqual(periodBounds(f({ period: "DATE", date: "oops" }), TODAY), { from: null, to: null });
});

/* ── Filters combine ───────────────────────────────────────────────── */

const row = (date: string, operatorId: string) => ({ date, operatorId });

test("an operator on their own shows only that operator", () => {
  const filter = f({ operatorId: "op1" });
  assert.equal(matchesFilter(row("2026-10-12", "op1"), filter, TODAY), true);
  assert.equal(matchesFilter(row("2026-10-12", "op2"), filter, TODAY), false);
});

test("a date on its own shows every operator on that date", () => {
  const filter = f({ period: "DATE", date: "2026-10-12" });
  assert.equal(matchesFilter(row("2026-10-12", "op1"), filter, TODAY), true);
  assert.equal(matchesFilter(row("2026-10-12", "op2"), filter, TODAY), true);
  assert.equal(matchesFilter(row("2026-10-13", "op1"), filter, TODAY), false);
});

test("an operator AND a month means that operator, in that month", () => {
  const filter = f({ operatorId: "op1", period: "MONTH", month: "2026-10" });
  assert.equal(matchesFilter(row("2026-10-01", "op1"), filter, TODAY), true);
  assert.equal(matchesFilter(row("2026-10-31", "op1"), filter, TODAY), true);
  assert.equal(matchesFilter(row("2026-09-30", "op1"), filter, TODAY), false);
  assert.equal(matchesFilter(row("2026-11-01", "op1"), filter, TODAY), false);
  assert.equal(matchesFilter(row("2026-10-15", "op2"), filter, TODAY), false);
});

test("a type, an operator and a range all apply together", () => {
  const filter = f({ type: "LEAVE", operatorId: "op1", period: "RANGE", from: "2026-10-05", to: "2026-10-09" });
  assert.equal(matchesFilter(row("2026-10-05", "op1"), filter, TODAY), true);
  assert.equal(matchesFilter(row("2026-10-09", "op1"), filter, TODAY), true);
  assert.equal(matchesFilter(row("2026-10-04", "op1"), filter, TODAY), false);
  assert.equal(matchesFilter(row("2026-10-07", "op2"), filter, TODAY), false);
});

test("all records with no operator keeps everything", () => {
  assert.equal(matchesFilter(row("2020-01-01", "anyone"), f(), TODAY), true);
});

/* ── What the sheet says ───────────────────────────────────────────── */

test("the sheet's columns are the register's columns", () => {
  assert.deepEqual([...ATTENDANCE_COLUMNS], ["Date", "Operator Name", "Line", "In-Time", "Out-Time", "Total Working Hours"]);
  // Leave Type sits immediately after the operator, as it does on screen.
  assert.deepEqual([...LEAVE_COLUMNS], ["Date", "S.No.", "Operator Name", "Leave Type", "Leave Time", "Leave Reason", "Remarks"]);
  assert.deepEqual(columnsFor("LEAVE"), LEAVE_COLUMNS);
  assert.deepEqual(columnsFor("ATTENDANCE"), ATTENDANCE_COLUMNS);
  assert.equal(widthsFor("LEAVE").length, LEAVE_COLUMNS.length);
  assert.equal(widthsFor("ATTENDANCE").length, ATTENDANCE_COLUMNS.length);
});

test("the filter says in words what it selected, and names the file by it", () => {
  const filter = f({ operatorId: "op1", period: "MONTH", month: "2026-10" });
  // On screen a date reads dd/mm/yyyy, as the table under it does (dmy); the
  // file name keeps the sortable yyyy-mm-dd.
  assert.equal(describeFilter(filter, TODAY, "Praveen Kumar.S"), "Attendance · Praveen Kumar.S · 01/10/2026 → 31/10/2026");
  assert.equal(describeFilter(f({ type: "LEAVE", period: "DATE", date: "2026-10-12" }), TODAY, ""), "Leave · All operators · 12/10/2026");
  assert.equal(describeFilter(f({ period: "RANGE", from: "2026-10-05" }), TODAY, ""), "Attendance · All operators · from 05/10/2026");
  assert.equal(describeFilter(f({ period: "RANGE", to: "2026-10-05" }), TODAY, ""), "Attendance · All operators · up to 05/10/2026");
  assert.equal(describeFilter(f(), TODAY, ""), "Attendance · All operators · All dates");
  assert.equal(filterFileName(filter, TODAY, "Praveen Kumar.S"), "Attendance_Praveen-Kumar-S_2026-10-01_2026-10-31.xlsx");
  assert.equal(filterFileName(f(), TODAY, ""), "Attendance_all-operators_all.xlsx");
  assert.match(filterFileName(f({ type: "LEAVE", period: "DATE", date: "2026-10-12" }), TODAY, ""), /^Leave_all-operators_2026-10-12\.xlsx$/);
});

/* ── Which day, and the night shift ────────────────────────────────── */

test("the day before is the day before, across a month and a year", () => {
  assert.equal(previousDay("2026-10-21"), "2026-10-20");
  assert.equal(previousDay("2026-10-01"), "2026-09-30");
  assert.equal(previousDay("2026-01-01"), "2025-12-31");
  assert.equal(previousDay("2024-03-01"), "2024-02-29", "a leap year is a leap year");
  assert.equal(previousDay("nonsense"), "");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
});

test("a row's date is judged against the PLANT's today, not the tablet's", () => {
  assert.equal(dayKind("2026-10-21", "2026-10-21"), "today");
  assert.equal(dayKind("2026-10-20", "2026-10-21"), "past");
  assert.equal(dayKind("2026-10-22", "2026-10-21"), "future");
});

test("the owner's night shift: in at 22:00, out at 06:00, eight hours", () => {
  assert.equal(workedMinutes("22:00", "06:00"), 8 * 60);
  assert.equal(workedLabel("22:00", "06:00"), "8h");
  assert.equal(rollsOvernight("22:00", "06:00"), true);
  assert.equal(outDate("2026-10-21", "22:00", "06:00"), "2026-10-22", "the Out is the next date");
});

test("a shift inside one day keeps its own date", () => {
  assert.equal(rollsOvernight("06:00", "14:30"), false);
  assert.equal(outDate("2026-10-21", "06:00", "14:30"), "2026-10-21");
  assert.equal(outDate("2026-10-21", "22:00", ""), "", "no Out, no date for it");
});

/* ── Yesterday has to be finished first ────────────────────────────── */

test("the message is the owner's sentence, word for word", () => {
  assert.equal(INCOMPLETE_PREVIOUS_DAY, "Previous day's attendance entry is incomplete. Please complete it first.");
});

test("a previous day with no Out-Time is unfinished", () => {
  assert.equal(previousDayIncomplete({ row: { inTime: "06:00", outTime: "" } }), true);
  assert.equal(previousDayIncomplete({ row: { inTime: "06:00", outTime: null } }), true);
  assert.equal(previousDayIncomplete({ row: { inTime: "06:00", outTime: "14:30" } }), false);
});

test("a previous day with no row at all holds nobody", () => {
  /* Code review, 26 Oct 2026: a weekly off, a plant holiday and a day from
     before the register went live all leave no row, and the register has no
     roster of working days to tell them from a missed shift. Holding on a
     missing row held every operator the morning after every day off. Only a
     day that was started and not finished holds. */
  assert.equal(previousDayIncomplete({ row: null }), false);
  assert.equal(previousDayIncomplete({ row: undefined }), false);
  assert.equal(previousDayIncomplete({ row: { inTime: "", outTime: "" } }), false, "an empty line is not an entry");
});

test("an operator on recorded leave yesterday is not held", () => {
  assert.equal(previousDayIncomplete({ row: null, onLeave: true }), false);
  assert.equal(previousDayIncomplete({ row: { inTime: "06:00", outTime: "" }, onLeave: true }), false);
});

/* ── Writing a row once ───────────────────────────────────────────────
   The shared tablet may fill in what is blank and may not write over what is
   there (owner, 26 Oct 2026). The Plant In-Charge is not held by it at all —
   the caller asks this only when rights.amendSaved is false. */

test("a row being entered for the first time is not an amendment", () => {
  assert.equal(amendsSavedRow(null, { lines: "L1", inTime: "06:00", outTime: null }), false);
  assert.equal(amendsSavedRow(undefined, { lines: "L1", inTime: "06:00", outTime: "14:00" }), false);
});

test("the evening's Out-Time goes onto the morning's row — that is the job, not an edit", () => {
  assert.equal(
    amendsSavedRow({ lines: "L1", inTime: "06:00", outTime: null }, { lines: "L1", inTime: "06:00", outTime: "14:30" }),
    false,
  );
  assert.equal(
    amendsSavedRow({ lines: "L1", inTime: "06:00", outTime: "" }, { lines: "L1", inTime: "06:00", outTime: "14:30" }),
    false,
  );
});

test("a saved row cannot be rewritten, in any of its three columns", () => {
  const saved = { lines: "L1", inTime: "06:00", outTime: "14:30" };
  assert.equal(amendsSavedRow(saved, { ...saved, inTime: "06:05" }), true, "the In-Time");
  assert.equal(amendsSavedRow(saved, { ...saved, outTime: "14:45" }), true, "the Out-Time");
  assert.equal(amendsSavedRow(saved, { ...saved, lines: "L1,L2" }), true, "the Lines");
  // Saving it back exactly as it stands changes nothing and is allowed.
  assert.equal(amendsSavedRow(saved, { ...saved }), false);
});

test("emptying a column that is written is an amendment too", () => {
  // Clearing a stamped Out-Time would un-mark an operator who has gone home.
  const saved = { lines: "L1", inTime: "06:00", outTime: "14:30" };
  assert.equal(amendsSavedRow(saved, { ...saved, outTime: null }), true);
  assert.equal(amendsSavedRow(saved, { ...saved, outTime: "" }), true);
  assert.equal(amendsSavedRow(saved, { ...saved, inTime: null }), true);
});

test("whitespace is not a change, and a missing column is read as empty", () => {
  assert.equal(amendsSavedRow({ inTime: "06:00" }, { inTime: " 06:00 " }), false);
  // A row holding only an In-Time: the other two are blank and may be filled.
  assert.equal(amendsSavedRow({ inTime: "06:00" }, { inTime: "06:00", lines: "L2", outTime: "14:00" }), false);
});

test("a half-finished row is held whichever half is missing", () => {
  assert.equal(previousDayIncomplete({ row: { inTime: "", outTime: "14:30" } }), true);
});

/* ── Informed or not ───────────────────────────────────────────────── */

test("there are two kinds of leave, and the register says which in words", () => {
  assert.deepEqual([...LEAVE_TYPES], ["INFORMED", "UNINFORMED"]);
  assert.equal(LEAVE_TYPE_LABELS.INFORMED, "Informed Leave");
  assert.equal(LEAVE_TYPE_LABELS.UNINFORMED, "Uninformed Leave");
});

test("informed is dark green and uninformed dark red — the pair that was checked", () => {
  // Red against green is the ONE pair a red-green colour-blind reader cannot
  // separate, and the obvious #1b5e20 / #c62828 come out at ΔE 2.0 under
  // protanopia: the same colour. These two are the validated steps — ΔE 8.5
  // protan, 28.9 normal, both over 3:1 on white. Changing them back to
  // "proper" dark green and red makes the column unreadable for about one man
  // in twelve.
  assert.equal(LEAVE_TYPE_HUES.INFORMED, "#1a7a42");
  assert.equal(LEAVE_TYPE_HUES.UNINFORMED, "#cf2f26");
  assert.equal(leaveTypeHue("INFORMED"), "#1a7a42");
  assert.equal(leaveTypeHue("UNINFORMED"), "#cf2f26");
});

test("UNINFORMED is never read as INFORMED, which it contains", () => {
  // The trap in this field: "uninformed" ends with "informed". Reading it the
  // wrong way round would mark an unexcused absence as excused, which is the
  // one mistake this field exists to prevent.
  for (const v of ["UNINFORMED", "uninformed", "Uninformed", "Uninformed Leave", "un-informed", "UN_INFORMED", " uninformed "]) {
    assert.equal(parseLeaveType(v), "UNINFORMED", `"${v}"`);
  }
  for (const v of ["INFORMED", "informed", "Informed", "Informed Leave", " informed "]) {
    assert.equal(parseLeaveType(v), "INFORMED", `"${v}"`);
  }
});

test("anything that is not one of the two is refused, never guessed", () => {
  for (const v of ["", "   ", null, undefined, "yes", "no", "leave", "INFORM", "A", 1, {}]) {
    assert.equal(parseLeaveType(v), null, String(v));
  }
  assert.equal(leaveTypeLabel("nonsense"), "");
  assert.equal(leaveTypeHue("nonsense"), undefined, "an unknown value gets no colour, so it cannot read as a meaning");
});

test("a leave record must say which kind it is", () => {
  assert.equal(leaveTypeError("INFORMED"), null);
  assert.equal(leaveTypeError("Uninformed Leave"), null);
  assert.match(String(leaveTypeError("")), /leave type/i);
  assert.match(String(leaveTypeError(null)), /leave type/i);
});

test("a row written before the field existed shows a dash, not a colour", () => {
  assert.equal(leaveTypeLabel(""), "");
  assert.equal(leaveTypeHue(""), undefined);
});

/* ── Yesterday first, and the plant's day: the wiring ──────────────── */

test("the hold is enforced where the row is written, not only on the page", () => {
  const s = srcFile("lib/attendance/server.ts");
  // Only a NEW entry is held: the row being complained about has to stay
  // correctable, or the message would name a day nobody could put right.
  // Since 7 Nov 2026 (the shift register) the previous date is read as a
  // state: genuinely unfinished holds, as before; last night's shift still
  // running asks for its Out first.
  assert.match(s, /if \(!existing\) \{[\s\S]{0,400}const before = \(await previousDayStates\(date\)\)\.get\(operatorId\);\s*\n\s*if \(before\?\.kind === "incomplete"\) return bad\(INCOMPLETE_PREVIOUS_DAY\);\s*\n\s*if \(before\?\.kind === "overnight"\) return bad\(nightShiftStillOpen\(previousDay\(date\)\)\);/);
});

test("the hold asks the two questions the rule needs, once for the register", () => {
  const fn = srcFile("lib/attendance/server.ts");
  const body = fn.slice(fn.indexOf("async function previousDayStates"), fn.indexOf("/* ── Leave ──"));
  assert.match(body, /attendanceDay\.findMany\(\{\s*where: \{ date: prev \},/, "the previous day's rows");
  assert.match(body, /attendanceLeave\.findMany\(\{ where: \{ date: prev \}/, "and their leave");
  // A missing row holds nobody, so whether they were ever marked in before is
  // no longer a question (code review, 26 Oct 2026).
  assert.doesNotMatch(body, /date: \{ lte: prev \}/);
  // Each operator's shifts of that date, read by the one rule (7 Nov 2026),
  // which asks previousDayIncomplete of each.
  assert.match(body, /previousDayState\(shifts, onLeave\.has\(operatorId\), at\)/);
  assert.match(srcFile("lib/attendance/attendance.ts"), /if \(!previousDayIncomplete\(\{ row \}\)\) continue;/);
});

test("a day that has not happened cannot be attended", () => {
  assert.match(srcFile("lib/attendance/server.ts"), /if \(kind === "future"\) return bad\(/);
});

test("the page shows the hold and offers no way past it", () => {
  const s = srcFile("components/attendance/AttendanceClient.tsx");
  assert.match(s, /r\.blocked && !r\.saved \?/);
  assert.match(s, /\{INCOMPLETE_PREVIOUS_DAY\}/);
});

test("the register opens on the PLANT's today, and the date stays a field", () => {
  const s = srcFile("components/attendance/AttendanceClient.tsx");
  assert.match(s, /const todayStr = \(\) => toPlantDateInput\(new Date\(\)\)/);
  assert.match(s, /useState\(todayStr\)/);
  assert.match(s, /<input type="date" value=\{date\} onChange=\{\(e\) => setDate\(e\.target\.value\)\}/);
});

test("the night shift's Out carries its own date, on screen and in the row", () => {
  // Since 17 Nov 2026 the date the Out fell on is recorded (attendance_day."outDate") and read first.
  assert.match(srcFile("lib/attendance/server.ts"), /outDate: outDate\(date, d\?\.inTime, d\?\.outTime, d\?\.outDate\)/);
  assert.match(srcFile("components/attendance/AttendanceClient.tsx"), /r\.outDate && r\.outDate !== date/);
});

/* ── Leave Taken: the wiring ───────────────────────────────────────── */

/** A source file as the repository holds it: LF, whatever the checkout did to
 *  it — see tests/sourceLineEndings.test.ts. */
const srcFile = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the section is Leave Taken, and Request Leave is gone", () => {
  const s = srcFile("components/attendance/AttendanceClient.tsx");
  assert.match(s, /<SectionHead title="Leave Taken"/);
  assert.doesNotMatch(s, /Request Leave/);
});

test("the server will not store a leave record that cannot say which kind it is", () => {
  // The form disables its button, but the form is not what decides: a request
  // made without one has to be refused where the row is written.
  const s = srcFile("lib/attendance/server.ts");
  const create = s.slice(s.indexOf('if (head === "leave" && !id)'), s.indexOf('if (head === "leave" && id)'));
  assert.match(create, /const typeErr = leaveTypeError\(b\.leaveType\);\s*\n\s*if \(typeErr\) return bad\(typeErr\);/);
  // And the CODE is stored, never whatever words arrived.
  assert.match(create, /leaveType: parseLeaveType\(b\.leaveType\) as string/);
});

test("an edit may change the kind, and is checked the same way", () => {
  const s = srcFile("lib/attendance/server.ts");
  const patch = s.slice(s.indexOf('if (head === "leave" && id)'));
  assert.match(patch, /if \(b\.leaveType !== undefined\) \{[\s\S]{0,200}leaveTypeError\(b\.leaveType\)/);
  assert.match(patch, /data\.leaveType = parseLeaveType\(b\.leaveType\) as string/);
});

test("the register hands over both the code and the words", () => {
  const s = srcFile("lib/attendance/server.ts");
  assert.match(s, /leaveType: parseLeaveType\(r\.leaveType\) \?\? ""/);
  assert.match(s, /leaveTypeLabel: leaveTypeLabel\(r\.leaveType\)/);
});

test("Leave Type reads immediately after Operator Name, everywhere it is shown", () => {
  const page = srcFile("components/attendance/AttendanceClient.tsx");
  assert.match(page, /"Operator Name", "Leave Type", "Leave Time"/);
  const leaveStart = page.indexOf("function LeaveTaken");
  assert.ok(leaveStart > 0, "the Leave Taken section is gone");
  const form = page.slice(leaveStart, page.indexOf("<table", leaveStart));
  assert.ok(form.indexOf(">Operator Name<") < form.indexOf(">Leave Type<"), "the field follows the operator");
  assert.ok(form.indexOf(">Leave Type<") < form.indexOf(">Leave Time<"), "and comes before the hours");
  const cols = [...LEAVE_COLUMNS];
  assert.equal(cols[cols.indexOf("Operator Name") + 1], "Leave Type");
  assert.match(srcFile("lib/attendance/server.ts"), /"Operator Name": r\.operator\?\.name \?\? "",\s*\n\s*"Leave Type": leaveTypeLabel\(r\.leaveType\)/);
});

test("the two colours are shown wherever the type is, and never hard-coded", () => {
  // One source for the pair, so the dropdown, the register and the downloads
  // table cannot drift into three shades of green.
  const page = srcFile("components/attendance/AttendanceClient.tsx");
  assert.doesNotMatch(page, /#1a7a42|#cf2f26/, "the hues come from the library, not from the page");
  assert.match(page, /<option key=\{t\} value=\{t\} style=\{\{ color: LEAVE_TYPE_HUES\[t\]/);
  assert.match(page, /style=\{\{ color: leaveTypeHue\(form\.leaveType\) \}\}/);
  assert.match(page, /style=\{\{ color: leaveTypeHue\(r\.leaveType\) \}\}/);
  assert.match(page, /c === "Leave Type" \? \{ color: leaveTypeHue\(r\[c\]\) \} : undefined/);
});

test("the colour is never the only thing saying which kind it is", () => {
  const page = srcFile("components/attendance/AttendanceClient.tsx");
  assert.match(page, /\{r\.leaveTypeLabel\}/);
  assert.match(page, /\{LEAVE_TYPE_LABELS\[t\]\}/);
});

/* ── One register, two ERPs ────────────────────────────────────────── */

/** A source file as the repository holds it: LF, whatever the checkout did to
 *  it — see tests/sourceLineEndings.test.ts. */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// STANDALONE (Robo ERP): in Pacific ERP the two tests below also held the
// Chromia door (/api/chromia/attendance, app/chromia/attendance) to the Robo
// one. Chromia is not part of Robo ERP, so only the Robo half is asserted; the
// Robo assertions themselves are unchanged.
test("both ERPs run the same handler over the same tables", () => {
  // The moment one of them grows its own copy, the two registers can disagree
  // — which is the only thing this feature had to avoid.
  for (const p of ["app/api/robo/attendance/[...path]/route.ts"]) {
    assert.match(src(p), /attendanceApi\(req, path \?\? \[\]\)/, p);
  }
  assert.match(src("app/api/robo/attendance/[...path]/route.ts"), /roboGate\(\)/);
});

test("both pages render the one component, each through its own door", () => {
  assert.match(src("app/robo/attendance/page.tsx"), /<AttendanceClient api="\/api\/robo\/attendance" rights=\{rights\} \/>/);
  // AND BOTH READ THE RIGHTS THE SAME WAY, from the session on the server.
  // A page that worked them out in the client would be working them out from
  // something the browser can change; two pages that read them differently
  // would be one register with two sets of permissions, which is the one
  // thing the owner's "consistently in both ERPs" rules out.
  for (const p of ["app/robo/attendance/page.tsx"]) {
    assert.match(src(p), /plantRightsOfUser\(/, p);
  }
});

test("a shift is upserted on (date, operator, shift), so the same shift is never two rows", () => {
  // (date, operatorId) until 7 Nov 2026; a save that names no shift is shift
  // 1, the column's default (scripts/0156), so for it the key is the old one.
  const s = src("lib/attendance/server.ts");
  assert.match(s, /attendanceDay\.upsert/);
  assert.match(s, /where:\s*\{\s*date_operatorId_shiftNo:/);
  assert.doesNotMatch(s, /date_operatorId:/);
  assert.doesNotMatch(s, /attendanceDay\.create\(/);
  assert.match(s, /const shiftNo = b\.shiftNo === undefined \|\| b\.shiftNo === null \|\| b\.shiftNo === "" \? 1 : Number\(b\.shiftNo\);/);
});

test("a write is never started during an admin's View as; a read goes straight through", () => {
  // The Lab and Accounts idiom (lib/viewAsServer unlessViewing): every request
  // that is not a GET runs inside it, so a view skips the save and the screen
  // reads the sentence why.
  const s = src("lib/attendance/server.ts");
  assert.match(s, /if \(method === "GET"\) return route\(req, segments, method, rights\);/);
  assert.match(s, /const done = await unlessViewing\(async \(\) => \(\{ res: await route\(req, segments, method, rights\) \}\)\);\s+return done \? done\.res : bad\(\(await viewAsBlocked\(\)\) \?\? VIEWING, 403\);/);
  assert.equal((s.match(/\broute\(req, segments, method, rights\)/g) ?? []).length, 2, "the dispatch is reached through those two calls only");
  assert.doesNotMatch(s, /export async function route\b/, "and is not exported past them");
});

test("the table and the spreadsheet are filled by the same query", () => {
  // Two queries is how a download ends up disagreeing with the page above it.
  const s = src("lib/attendance/server.ts");
  assert.equal((s.match(/await filteredRows\(f, today\)/g) ?? []).length, 2);
});

test("Attendance is the last row of Robo's navigation, and the one before Orders in Chromia's", () => {
  // The sidebar's rows live in lib/navModel.ts; Nav.tsx only draws them.
  const nav = src("lib/navModel.ts");
  const lastOf = (name: string) => {
    const start = nav.indexOf(`const ${name}: NavItem[] = [`);
    assert.ok(start >= 0, `${name} not found`);
    const block = nav.slice(start, nav.indexOf("];", start));
    const hrefs = [...block.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
    return hrefs[hrefs.length - 1];
  };
  assert.equal(lastOf("ROBO_ITEMS"), "/robo/attendance");
  // STANDALONE (Robo ERP): the CHROMIA_ITEMS half of this test, and the next
  // test in the ERP ("the Chromia swipe order ends on Orders, right after
  // Attendance"), checked Chromia's own navigation, which is not part of Robo
  // ERP. Both are removed; the Robo half is unchanged.
  // And the shop-floor arms are allowlists — a row missing there is a page the
  // tablet has no link to at all.
  assert.match(nav, /ROBO_ITEMS\.filter\(\(t\) => t\.href === "\/robo\/attendance"\)/);
});

test("the two lines offered are the two lines that exist", () => {
  assert.deepEqual([...LINES], ["ROBO", "CHROMIA"]);
});

test("every attendance write leaves an action_log row in its own transaction, as an edit Undo never replays", () => {
  // Two shared tablet logins write this register through either door, and the
  // tables carry no actor column: the trail is the only record of who changed
  // what, and what it said before.
  const s = src("lib/attendance/server.ts");
  // No write outside a transaction.
  assert.doesNotMatch(s, /prisma\.attendance\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  const writes = s.match(/tx\.attendance\w+\.(create|update|upsert|delete)\(/g) ?? [];
  assert.equal(writes.length, 8, "operator add, edit, take off, remove; the day; leave add, edit, remove");
  assert.equal((s.match(/await prisma\.\$transaction\(async \(tx\) => \{/g) ?? []).length, 7);
  // One trail row per write, written through logActionTx (not the best-effort
  // logAction): if the row cannot be written, neither is the change.
  assert.equal((s.match(/await trail\(tx, "Attendance(Operator|Day|Leave)",/g) ?? []).length, 8);
  assert.match(s, /function trail\([^)]*\) \{\s+return logActionTx\(tx, \{ kind: "edit", model, summary, payload \}\);/);
  // "edit" is never offered by Undo: the global Undo on /batch must not put
  // back a leave record someone removed on purpose.
  assert.match(src("lib/actionLogKinds.ts"), /NOT_UNDOABLE[^\n]*"edit"/);
  // A removal keeps the whole row; an edit keeps what was there before.
  for (const action of ["attendance.leave.delete", "attendance.operator.delete"]) {
    assert.match(s, new RegExp(`\\{ action: "${action.replace(/\./g, "\\.")}", before`), action);
  }
  for (const action of ["attendance.leave.edit", "attendance.operator.edit", "attendance.operator.deactivate"]) {
    assert.match(s, new RegExp(`\\{ action: "${action.replace(/\./g, "\\.")}", before, after`), action);
  }
  assert.match(s, /action: before \? "attendance\.day\.edit" : "attendance\.day\.add",\s+before: before \?/);
  // And all of it inside the one unlessViewing door (the View-as test above).
  assert.doesNotMatch(s, /logAction\(|logActionAs\(/, "never the best-effort writers");
});

test("the register says a failed read or save where it happened, never only at the top of the page", () => {
  const s = src("components/attendance/AttendanceClient.tsx");
  // A new date closes the open row and clears the old date's rows first.
  assert.match(s, /const changeDate = \(d: string\) => \{\s+if \(d === date\) return;\s+setEditing\(null\);\s+setDraft\(NO_DRAFT\);\s+setRowError\(null\);\s+setRows\(\[\]\);/);
  assert.match(s, /date=\{date\} setDate=\{changeDate\}/);
  // A failed day read empties the register rather than leaving another date's rows.
  assert.match(s, /\/\/ Nothing read for another date stays on screen under this one\.\s+setRows\(\[\]\);/);
  // Reads that fail are said in the table, not swallowed into an empty register.
  assert.doesNotMatch(s, /catch \{ \/\*/, "no read failure is swallowed");
  assert.equal((s.match(/<UnreadRow /g) ?? []).length, 2, "the day's register and the leave register");
  // The leave form says its own errors under its own buttons, and Edit takes the reader to it.
  assert.match(s, /\{error && <p ref=\{errorRef\} role="alert" className=\{`mt-3 \$\{errorBox\}`\}>\{error\}<\/p>\}/);
  assert.match(s, /formRef\.current\?\.scrollIntoView\(\{ block: "start", behavior: "smooth" \}\);\s+firstField\.current\?\.focus\(\{ preventScroll: true \}\);/);
});
