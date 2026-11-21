import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SHIFT_CODES,
  SHIFT_WINDOWS,
  parseShiftCode,
  productionShiftOf,
  shiftCell,
  shiftFromTime,
  shiftOptionLabel,
} from "../src/lib/robo/productionShift.ts";

/* The Shift a slab was made on.
 *
 * Two things called "shift" meet here and must not be confused:
 *   - RoboShift.shiftNumber — ONE row per day, stamped from the wall clock the
 *     first time the tablet is opened. Shared by every slab and batch of that
 *     day, so it says the same thing at 07:00 and at 23:40. Not this.
 *   - RoboProductionRecord.productionShift — the A/B/C the operator picks on
 *     the slab. This.
 *
 * The owner's windows: A 06:00-14:00, B 14:00-22:00, C 22:00-06:00.
 */

/* ── The three windows ─────────────────────────────────────────────── */

test("the three shifts are the ones the plant runs", () => {
  assert.deepEqual([...SHIFT_CODES], ["A", "B", "C"]);
  assert.deepEqual(
    SHIFT_WINDOWS.map((w) => w.label),
    ["Shift A — 06:00–14:00", "Shift B — 14:00–22:00", "Shift C — 22:00–06:00"],
  );
});

test("an option is short enough to read whole in the box it sits in", () => {
  // Measured: a tablet in portrait gives the Shift box 224px and renders the
  // form at 16px on touch, leaving 186px inside the padding and the chevron.
  // At that size the font averages just under 8px a character. Spelling the
  // range "06:00 to 14:00" came to 197px and clipped the last digits.
  for (const w of SHIFT_WINDOWS) {
    assert.ok(w.label.length <= 22, `"${w.label}" is ${w.label.length} characters — it will clip on a tablet`);
  }
});

test("the windows cover the whole clock, once each", () => {
  // Every minute of the day belongs to exactly one shift — no gap at a
  // handover, no minute claimed twice.
  const seen = new Map<string, number>();
  for (let m = 0; m < 1440; m++) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const code = shiftFromTime(hhmm);
    assert.ok(code, `${hhmm} belongs to no shift`);
    seen.set(code, (seen.get(code) ?? 0) + 1);
  }
  assert.deepEqual([...seen.keys()].sort(), ["A", "B", "C"]);
  assert.equal(seen.get("A"), 8 * 60);
  assert.equal(seen.get("B"), 8 * 60);
  assert.equal(seen.get("C"), 8 * 60);
});

test("each handover minute belongs to the shift it starts", () => {
  // 14:00 is B's first minute, not A's last — the rule a supervisor would
  // state, and the one that decides which shift owns a slab logged on the hour.
  assert.equal(shiftFromTime("06:00"), "A");
  assert.equal(shiftFromTime("13:59"), "A");
  assert.equal(shiftFromTime("14:00"), "B");
  assert.equal(shiftFromTime("21:59"), "B");
  assert.equal(shiftFromTime("22:00"), "C");
  assert.equal(shiftFromTime("05:59"), "C");
});

test("the night shift wraps midnight", () => {
  for (const t of ["22:00", "23:30", "00:00", "00:01", "03:15", "05:59"]) {
    assert.equal(shiftFromTime(t), "C", t);
  }
});

test("anything that is not a time is no shift at all", () => {
  for (const t of ["", "  ", null, undefined, "-", "abc", "25:00", "12:99", "9", "12-30"]) {
    assert.equal(shiftFromTime(t as string), null, String(t));
  }
});

test("a time with seconds or stray spaces still reads", () => {
  // Registers and spreadsheets hand over "09:30:00" and " 09:30 " often enough.
  assert.equal(shiftFromTime("09:30:00"), "A");
  assert.equal(shiftFromTime("  09:30  "), "A");
  assert.equal(shiftFromTime("9:30"), "A");
});

/* ── Reading a stored or typed value ───────────────────────────────── */

test("a shift is read however it was written", () => {
  for (const raw of ["A", "a", " a ", "Shift A", "shift a", "SHIFT A", "Shift A — 06:00 to 14:00"]) {
    assert.equal(parseShiftCode(raw), "A", String(raw));
  }
  // The 1/2/3 the register importer and RoboShift.shiftNumber use.
  assert.equal(parseShiftCode(1), "A");
  assert.equal(parseShiftCode(2), "B");
  assert.equal(parseShiftCode(3), "C");
  assert.equal(parseShiftCode("3"), "C");
});

test("a value that is not one of the three shifts is refused, not guessed", () => {
  for (const raw of ["", "  ", null, undefined, "D", "0", "4", "9", 0, 4, 2.5, "General", "Shift D", "Apple"]) {
    assert.equal(parseShiftCode(raw), null, String(raw));
  }
});

test("the label for a code names the hours; an unknown code has none", () => {
  assert.equal(shiftOptionLabel("B"), "Shift B — 14:00–22:00");
  assert.equal(shiftOptionLabel("b"), "Shift B — 14:00–22:00");
  assert.equal(shiftOptionLabel(""), "");
  assert.equal(shiftOptionLabel("D"), "");
});

/* ── What a slab reports ───────────────────────────────────────────── */

test("the stored shift is the answer whenever there is one", () => {
  // Even when the times disagree with it: the operator was there and said C.
  assert.equal(productionShiftOf({ productionShift: "C", inTime: "09:00", outTime: "09:40" }), "C");
  assert.equal(productionShiftOf({ productionShift: "A", inTime: null, outTime: null }), "A");
});

test("a slab with nothing stored reads its shift off its In Time", () => {
  // Every slab entered before this field existed, and every imported one.
  assert.equal(productionShiftOf({ productionShift: null, inTime: "07:12", outTime: "07:45" }), "A");
  assert.equal(productionShiftOf({ productionShift: null, inTime: "15:40", outTime: "16:05" }), "B");
  assert.equal(productionShiftOf({ productionShift: null, inTime: "23:50", outTime: "00:14" }), "C");
  assert.equal(productionShiftOf({ inTime: "02:30" }), "C");
});

test("the In Time decides, not the Out Time, when both are there", () => {
  // A slab that went in at 13:50 and came out at 14:10 was made on A's watch.
  assert.equal(productionShiftOf({ inTime: "13:50", outTime: "14:10" }), "A");
  assert.equal(productionShiftOf({ inTime: "21:55", outTime: "22:20" }), "B");
});

test("a slab with only an Out Time still reports a shift", () => {
  assert.equal(productionShiftOf({ inTime: null, outTime: "16:05" }), "B");
  assert.equal(productionShiftOf({ inTime: "", outTime: "03:00" }), "C");
});

test("a slab with nothing at all reports nothing, and shows a dash", () => {
  assert.equal(productionShiftOf({ productionShift: null, inTime: null, outTime: null }), "");
  assert.equal(productionShiftOf(null), "");
  assert.equal(productionShiftOf(undefined), "");
  assert.equal(shiftCell({ productionShift: null, inTime: null, outTime: null }), "-");
  assert.equal(shiftCell(null), "-");
});

test("a cell shows the bare letter, which is how the register writes it", () => {
  assert.equal(shiftCell({ productionShift: "B" }), "B");
  assert.equal(shiftCell({ inTime: "23:10" }), "C");
});

test("a stored value that is not a shift falls through to the times", () => {
  // Defence in depth: the API only ever writes A/B/C or NULL, but a row touched
  // by SQL or an older import must not put rubbish on the screen.
  assert.equal(productionShiftOf({ productionShift: "", inTime: "10:00" }), "A");
  assert.equal(productionShiftOf({ productionShift: "General", inTime: "10:00" }), "A");
  assert.equal(productionShiftOf({ productionShift: "D", inTime: null, outTime: null }), "");
});

test("reading a slab never changes it", () => {
  // productionShiftOf is a reading, like placeSlabs: the stored column stays
  // NULL until somebody picks a shift, so nothing is silently back-filled.
  const rec = { productionShift: null as string | null, inTime: "23:10", outTime: "23:44" };
  const before = JSON.stringify(rec);
  assert.equal(productionShiftOf(rec), "C");
  assert.equal(shiftCell(rec), "C");
  assert.equal(JSON.stringify(rec), before);
});

/* ── The owner's three windows, slab by slab across a full day ─────── */

test("a 24-hour day splits A / B / C exactly where the plant says", () => {
  const made = (inTime: string) => productionShiftOf({ inTime });
  assert.deepEqual(
    ["06:05", "09:30", "13:55", "14:05", "18:00", "21:50", "22:05", "01:20", "05:50"].map(made),
    ["A", "A", "A", "B", "B", "B", "C", "C", "C"],
  );
});

/* ── Wiring guards ─────────────────────────────────────────────────── */

/** A source file as the repository holds it: LF, whatever the checkout did to it.
 *  A CRLF working copy would make every \n in the patterns below miss, and a
 *  doesNotMatch pass without looking — see tests/sourceLineEndings.test.ts. */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("both write paths validate the shift through parseShiftCode", () => {
  // A raw `body.productionShift` reaching Prisma would let any string into a
  // column every reader treats as A/B/C.
  for (const p of ["app/api/robo/production/route.ts", "app/api/robo/production/[id]/route.ts"]) {
    const s = src(p);
    assert.match(s, /parseShiftCode\(body\.productionShift\)/, p);
    assert.doesNotMatch(s, /productionShift:\s*body\.productionShift\b/, p);
  }
});

test("the screens and the sheets all read the one resolver", () => {
  // Four places show a slab's shift. If any of them read the column directly it
  // would show blank for the three months entered before the field existed,
  // while the others showed a letter.
  for (const p of [
    "components/robo/SlabsBrowser.tsx",
    "app/robo/slabs/[id]/page.tsx",
    "app/api/robo/exports/production/route.ts",
    "app/api/robo/exports/delays/route.ts",
  ]) {
    assert.match(src(p), /from "@\/lib\/robo\/productionShift"/, p);
  }
});

test("Slab Records shows Shift between Production Date and Design Name, and Review last", () => {
  const s = src("components/robo/SlabsBrowser.tsx");
  const headers = /\[("S\.No\.".*?)\]\.map\(\(h, i, arr\)/s.exec(s);
  assert.ok(headers, "could not find the Slab Records header list");
  const cols = headers[1].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  assert.equal(cols[cols.indexOf("Production Date") + 1], "Shift");
  assert.equal(cols[cols.indexOf("Shift") + 1], "Design Name");
  assert.equal(cols[cols.length - 1], "Review");
  assert.equal(cols.includes("Action"), false, "the old Action heading is still there");
  // The empty-state row has to span them all, or "no slabs match" sits under
  // one column with a ragged table beside it.
  assert.match(s, new RegExp(`colSpan=\\{${cols.length}\\}`), `colSpan should be ${cols.length}`);
});

test("the entry form offers exactly the three shifts, with their hours", () => {
  const s = src("components/robo/RoboEntryForm.tsx");
  assert.match(s, /SHIFT_WINDOWS\.map\(\(w\) => <option key=\{w\.code\} value=\{w\.code\}>\{w\.label\}<\/option>\)/);
  // Sent on save, both for a new slab and for a correction.
  assert.equal(s.split("productionShift: slab.productionShift || null").length - 1, 2);
});

test("the importer reads a Shift column back onto the slab", () => {
  // A register exported from here and loaded back keeps its shifts.
  assert.match(src("app/api/robo/imports/route.ts"), /productionShift:\s*row\.shiftCode/);
});
