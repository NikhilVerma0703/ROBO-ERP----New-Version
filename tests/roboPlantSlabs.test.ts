// ROBO: THE BATCH'S SLABS LISTED FROM THE PLANT (owner, 17 Nov 2026: "can we get
// some robo data from plant"; he chose "the plant fills the slab list"). The
// plant knows nothing the robots did; it knows each slab's number and when it
// left the distributor and reached the press. Which slabs are the batch's is
// what MIS files under that batch (lib/robo/plantSlabs header).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  misSlabNumbers, plantClock, plantSlabDate, plainSlabNo, buildPlantSlabList, plantRowFor, nextPlantSlab,
  shortDate, plantWindowWords, plantRowDate, addDays, MAX_SLAB_NO, PLANT_LIST_MAX_NUMBERS, PLANT_LIST_MAX_ROWS, type PlantSlabIn,
} from "../src/lib/robo/plantSlabs.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const slab = (slabNo: number, distAt: string | null, pressAt: string | null, lineOrder: number | null = 10226): PlantSlabIn => ({ slabNo, distAt, pressAt, lineOrder });

test("the batch's numbers are MIS's hour ranges: each once, ascending; a range that cannot be an hour is left out", () => {
  const { numbers, capped } = misSlabNumbers([
    { start: 172781, end: 172783 }, { start: 172784, end: 172790 },
    { start: 172790, end: 172792 },          // an overlap counts once
    { start: 172800, end: 172799 },          // ends before it starts
    { start: 172900, end: 172960 },          // 61 slabs in an hour: a digit slip
    { start: null, end: 172999 }, { start: 172995, end: undefined }, { start: 172604, end: 172604 },
  ]);
  assert.deepEqual(numbers, [172604, ...Array.from({ length: 12 }, (_, i) => 172781 + i)]);
  assert.equal(capped, false);
  assert.deepEqual(misSlabNumbers([]), { numbers: [], capped: false });
  // The cap is said, never silent.
  const big = misSlabNumbers(Array.from({ length: 10 }, (_, i) => ({ start: i * 100, end: i * 100 + 49 })), 120);
  assert.equal(big.numbers.length, 120);
  assert.equal(big.capped, true);
  assert.ok(PLANT_LIST_MAX_NUMBERS >= 2000 && PLANT_LIST_MAX_ROWS >= 300);
  // A number no slab can have (MIS keeps free numbers): that hour is left out and the rest of the batch keeps its list.
  // Every number sent to the database fits its integer.
  assert.deepEqual(misSlabNumbers([
    { start: 3000000000, end: 3000000010 }, { start: 172600, end: 172602 }, { start: -5, end: 3 }, { start: 0, end: 4 },
    { start: 999999990, end: 1000000005 }, { start: MAX_SLAB_NO - 1, end: MAX_SLAB_NO }, { start: 1e300, end: 1e300 }, { start: NaN, end: 5 },
  ]).numbers, [172600, 172601, 172602, MAX_SLAB_NO - 1, MAX_SLAB_NO]);
  assert.ok(MAX_SLAB_NO <= 2147483647);
});

test("a plant time is read as it is stored: naive IST, never through a Date", () => {
  assert.deepEqual(plantClock("2026-11-14T22:30:11.250"), { date: "2026-11-14", hm: "22:30" });
  assert.deepEqual(plantClock("2026-11-15 00:05:00"), { date: "2026-11-15", hm: "00:05" });
  assert.equal(plantClock(null), null);
  assert.equal(plantClock(""), null);
  assert.equal(plantClock("yesterday"), null);
  assert.doesNotMatch(read("src/lib/robo/plantSlabs.ts"), /new Date\(|Date\.parse|toISOString/);
});

test("the slab's date: the plant's day; across midnight, the day the In time is on", () => {
  // The measured slabs of 13 and 14 Nov 2026: distributor 12:03 -> press 12:39, robot in 12:15, out 12:31.
  assert.equal(plantSlabDate("2026-11-13T12:03:00.000", "2026-11-13T12:39:00.000"), "2026-11-13");
  assert.equal(plantSlabDate("2026-11-13T12:03:00.000", "2026-11-13T12:39:00.000", "12:15"), "2026-11-13");
  // Across midnight: the distributor's day until an In time says otherwise.
  const d = "2026-11-14T23:50:00.000", p = "2026-11-15T00:32:00.000";
  assert.equal(plantSlabDate(d, p), "2026-11-14");
  assert.equal(plantSlabDate(d, p, ""), "2026-11-14");
  assert.equal(plantSlabDate(d, p, "23:55"), "2026-11-14", "in before midnight");
  assert.equal(plantSlabDate(d, p, "00:05"), "2026-11-15", "in after midnight");
  assert.equal(plantSlabDate(d, p, "5:00"), "2026-11-14", "not a time yet: nothing is guessed from it");
  // One time missing: the one there is.
  assert.equal(plantSlabDate(d, null), "2026-11-14");
  assert.equal(plantSlabDate(null, p), "2026-11-15");
  assert.equal(plantSlabDate(null, null), "");
});

test("the list: the batch's numbers the plant has, less those already in the Robo register", () => {
  const numbers = [172781, 172782, 172783, 172784, 172785, 172786];
  const plant = [
    slab(172780, "2026-11-14T11:20:00.000", "2026-11-14T12:20:00.000"),   // the plant has it, MIS files it under another batch
    slab(172781, "2026-11-14T11:30:00.000", "2026-11-14T12:30:00.000"),
    slab(172782, "2026-11-14T11:35:00.000", "2026-11-14T12:36:00.000"),
    slab(172783, "2026-11-14T13:50:00.000", "2026-11-14T14:40:00.000"),
    slab(172784, "2026-11-14T21:58:00.000", null),                         // not at the press yet
    slab(172784, "2026-11-14T22:05:00.000", "2026-11-14T23:00:00.000"),   // the plant's later row of one number stands
    slab(172786, "2026-11-14T23:50:00.000", "2026-11-15T00:32:00.000"),   // across midnight
    // 172785: in the MIS range, never made by the plant
  ];
  const list = buildPlantSlabList(numbers, plant, ["172782", " 172781 ", "140748-A", "999999", null]);
  assert.equal(list.total, 5, "172785 is not the plant's, 172780 is not the batch's");
  assert.equal(list.entered, 2);
  assert.equal(list.more, 0);
  assert.deepEqual(list.rows.map((r) => [r.slabNumber, r.date, r.shift, r.dist, r.press]), [
    ["172783", "2026-11-14", "A", "13:50", "14:40"],        // the shift is the distributor time's
    ["172784", "2026-11-14", "C", "22:05", "23:00"],
    ["172786", "2026-11-14", "C", "23:50", "00:32"],
  ]);
  assert.deepEqual([list.rows[2].distDate, list.rows[2].pressDate], ["2026-11-14", "2026-11-15"]);
  // Nothing of the batch in the plant: an empty list, not an error.
  assert.deepEqual(buildPlantSlabList(numbers, [], []), { total: 0, entered: 0, rows: [], more: 0 });
  // More waiting than the tablet is sent: said in `more`.
  const many = Array.from({ length: 30 }, (_, i) => slab(5000 + i, "2026-11-14T10:00:00.000", "2026-11-14T10:40:00.000"));
  const cut = buildPlantSlabList(many.map((s) => s.slabNo), many, [], 12);
  assert.deepEqual([cut.total, cut.rows.length, cut.more, cut.rows[0].slabNo, cut.rows[11].slabNo], [30, 12, 18, 5000, 5011]);
});

test("a slab number is a plain number or it is not the plant's; the form's row and the next row", () => {
  assert.deepEqual(["172600", " 172600 ", "0172600", "140748-A", "", null, "17 2600", "1e5"].map(plainSlabNo), [172600, 172600, 172600, null, null, null, null, null]);
  const rows = buildPlantSlabList([10, 11, 13], [slab(10, "2026-11-14T10:00:00.000", null), slab(11, "2026-11-14T10:05:00.000", null), slab(13, "2026-11-14T10:15:00.000", null)], []).rows;
  assert.equal(plantRowFor(rows, "11")?.slabNo, 11);
  assert.equal(plantRowFor(rows, "12"), null);
  assert.equal(plantRowFor(rows, "11-A"), null);
  // After saving 11 the next is 13 (12 is not the plant's); after 13 there is none; a slab typed by hand below the list starts it.
  assert.equal(nextPlantSlab(rows, "11")?.slabNo, 13);
  assert.equal(nextPlantSlab(rows, "13"), null);
  assert.equal(nextPlantSlab(rows, "5")?.slabNo, 10);
  assert.equal(nextPlantSlab(rows, "140748-A"), null);
});

test("the words on the tablet", () => {
  assert.equal(shortDate("2026-11-14"), "14 Nov");
  assert.equal(shortDate("2026-01-05"), "5 Jan");
  assert.equal(shortDate(""), "");
  assert.equal(plantWindowWords({ dist: "12:03", press: "12:39", distDate: "2026-11-13", pressDate: "2026-11-13" }), "Plant: left the distributor 12:03, reached the press 12:39.");
  assert.equal(plantWindowWords({ dist: "23:50", press: "00:32", distDate: "2026-11-14", pressDate: "2026-11-15" }), "Plant: left the distributor 23:50, reached the press 00:32 (next day).");
  assert.equal(plantWindowWords({ dist: "21:58", press: null, distDate: "2026-11-14", pressDate: null }), "Plant: left the distributor 21:58.");
  assert.equal(plantWindowWords({ dist: null, press: null, distDate: null, pressDate: null }), "");
});

test("a listed slab's date follows the In time typed, from the row alone", () => {
  const { rows } = buildPlantSlabList([10, 11], [
    slab(10, "2026-11-14T23:50:00.000", "2026-11-15T00:30:00.000"),
    slab(11, "2026-11-14T10:00:00.000", "2026-11-14T10:40:00.000"),
  ], []);
  const [across, sameDay] = rows;
  // Across midnight: the distributor's day until an In time says the robot pass was after midnight.
  assert.equal(plantRowDate(across), "2026-11-14");
  assert.equal(plantRowDate(across, ""), "2026-11-14");
  assert.equal(plantRowDate(across, "23:55"), "2026-11-14");
  assert.equal(plantRowDate(across, "00:10"), "2026-11-15");
  assert.equal(plantRowDate(across, "0:1"), "2026-11-14", "a half-typed time is not a time");
  // One calendar day: that day, whatever is typed.
  assert.equal(plantRowDate(sameDay, "02:00"), "2026-11-14");
  // The row's rule is plantSlabDate's.
  for (const t of ["", "23:55", "00:10", "11:59", "12:00"])
    assert.equal(plantRowDate(across, t), plantSlabDate("2026-11-14T23:50:00.000", "2026-11-15T00:30:00.000", t), t);
});

// ---------- the wiring, pinned from the source ----------
const ROUTE = read("src/app/api/robo/production/plant-slabs/route.ts");
const LIST = read("src/components/robo/PlantSlabList.tsx");
const FORM = read("src/components/robo/RoboEntryForm.tsx");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the reader is behind the Robo gate, reads only, and never fails the form", () => {
  assert.ok(ROUTE.includes("const refused = await roboGate();\n  if (refused) return refused;"), "the gate is the first thing the route does");
  const body = code(ROUTE);
  // Reads only: no write of any kind, to the ERP's tables or the plant's.
  assert.doesNotMatch(body, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$transaction/);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/);
  assert.equal((body.match(/\$queryRaw/g) ?? []).length, 2, "two SQL reads: the plant's rows, the register's numbers");
  assert.match(body, /FROM plant_slab s\s+WHERE s\.slab_no = ANY\(\$\{numbers\}::int\[\]\)\s+ORDER BY s\.slab_no, s\.f_id/);
  // The plant's times are read as text in the stored (IST) clock, never as a Date.
  assert.equal((body.match(/to_char\(s\.(sts_begin|pre_begin), \$\{TS_FMT\}\)/g) ?? []).length, 2);
  // Which slabs are the batch's: MIS's hours under the batch's one spelling.
  assert.match(body, /const batchKey = normalizeBatch\(recipe\?\.batchNo\)/);
  assert.match(body, /prisma\.mis\.findMany\(\{\s*where: \{ batchKey, startingSlabNumber: \{ not: null \}, endingSlabNumber: \{ not: null \} \}/);
  // Already entered: by NUMBER, whatever the register's spelling ("0172600" is slab 172600) and whatever the batch.
  // The CASE is what keeps the cast off a register number that is not one ("140748-A").
  assert.match(body, /FROM "RoboProductionRecord" r\s+WHERE CASE WHEN r\."slabNumber" ~ '\^\[\[:space:\]\]\*\[0-9\]\{1,9\}\[\[:space:\]\]\*\$' THEN btrim\(r\."slabNumber"\)::int END = ANY\(\$\{numbers\}::int\[\]\)/);
  assert.doesNotMatch(body, /roboProductionRecord\.findMany/);
  // Every way out is a 200 with a state; a fault logs its code only.
  assert.match(body, /if \(!\(await plantTablesReady\(\)\)\) return NextResponse\.json\(\{ state: "off"/);
  assert.match(body, /catch \(e\) \{\s*console\.warn\(`[^`]*\$\{code\(e\)\}[^`]*`\);\s*return NextResponse\.json\(\{ state: "failed" \}\);/);
  assert.doesNotMatch(body, /status: [45]\d\d/);
  assert.doesNotMatch(body, /e\.message|String\(e\)/);
});

test("the list is an offer: it drops a late answer, keeps its rows through a failed re-read, and always says the slab can be typed", () => {
  assert.match(LIST, /if \(mine !== seq\.current\) return;/);
  // "The same list" is the same setup AND the batch number it was read for: a number corrected in place drops the old rows.
  assert.match(LIST, /if \(state === "failed" && p\.state === "ok" && p\.batchRecipeId === batchRecipeId && p\.batchNo === batchNo\) return \{ \.\.\.p, stale: true \};/);
  assert.match(LIST, /p\.state === "ok" && p\.batchRecipeId === batchRecipeId && p\.batchNo === batchNo \? p : \{ \.\.\.NONE, state: "loading" \}/);
  assert.match(LIST, /stale: false, batchRecipeId, batchNo \};/);
  assert.match(LIST, /cache: "no-store"/);
  assert.equal((LIST.match(/Type the slab as usual\./g) ?? []).length, 3);
  assert.match(LIST, /a slab not listed here can still be typed/);
  assert.doesNotMatch(LIST, /type="submit"/);
  assert.equal((LIST.match(/<button /g) ?? []).length, (LIST.match(/<button [^>]*type="button"/g) ?? []).length, "no button of the list can submit the slab form");
});

test("the form takes the list for new slabs only, and a date or shift set by hand stands", () => {
  // Asked for on the entry screen only, for the running batch.
  assert.match(FORM, /usePlantSlabs\(!isPageEdit && !isSetupEdit \? runningBatch\?\.id \?\? null : null, plantVersion, runningBatch\?\.batchNo \?\? null\)/);
  // A setup corrected in place keeps its id: its batch number is part of what the list is read for.
  assert.match(LIST, /\}, \[batchRecipeId, version, batchNo\]\);/);
  // Never while a slab is being corrected.
  assert.match(FORM, /const plantRow = !editingId && plant\.state === "ok" \? plantRowFor\(plant\.rows, slab\.slabNumber\) : null;/);
  assert.match(FORM, /const pickPlantSlab = \(row: PlantSlabRow\) => \{\s*if \(editingId\) return;/);
  assert.match(FORM, /\{!isPageEdit && !editingId && runningBatch && \(\s*<PlantSlabList /);
  // By hand stands: the two flags guard the plant's day and shift.
  assert.match(FORM, /const date = dateTouched\.current \? "" : plantRowDate\(plantRow, slab\.inTime\);/);
  assert.match(FORM, /const shiftCode = shiftTouched\.current \|\| isValidTime\(slab\.inTime\) \? "" : plantRow\.shift;/);
  assert.match(FORM, /dateTouched\.current = true;\s*setSlab\(\(p\) => \(\{ \.\.\.p, productionDate: v \}\)\);/);
  // Both flags are cleared for the next slab: after a save, on leaving an edit, on a pick.
  assert.equal((FORM.match(/shiftTouched\.current = false;\s*dateTouched\.current = false;/g) ?? []).length, 2);
  assert.match(FORM, /dateTouched\.current = false;\s*shiftTouched\.current = false;\s*plantFilled\.current = \{ shift: plantFilled\.current\?\.shift \?\? slab\.productionShift, slabNo: row\.slabNo \};\s*const date = plantRowDate\(row, slab\.inTime\);/);
  // After a save: the list's next slab only when the saved one was the list's; otherwise counting on as before.
  assert.match(FORM, /const fromPlant = !wasEdit && plant\.state === "ok" && plantRowFor\(plant\.rows, saved\) \? nextPlantSlab\(plant\.rows, saved\) : null;/);
  assert.match(FORM, /const nextSlab = wasEdit \? "" : \(fromPlant\?\.slabNumber \?\? nextSlabNumber\(saved\)\);/);
  // The list is read again after a save, a delete and a tap on Refresh.
  assert.equal((FORM.match(/setPlantVersion\(\(v\) => v \+ 1\)/g) ?? []).length, 3);
  // An offered number that turns out taken is withdrawn WITH its warning, so the next one offered can be saved.
  assert.match(code(FORM), /if \(await checkSlabNumber\(nextSlab\)\) return;\s*setSlab\(\(p\) => \(p\.slabNumber === nextSlab \? \{ \.\.\.p, slabNumber: "" \} : p\)\);\s*setSlabTaken\(false\);\s*setRegisterVersion\(\(v\) => v \+ 1\);/);
  // A picked number is checked like a typed one.
  assert.match(FORM, /void checkSlabNumber\(row\.slabNumber\);/);
  // The save itself is untouched: what is stored is still what the form holds.
  assert.equal((FORM.match(/productionShift: slab\.productionShift \|\| null/g) ?? []).length, 2);
});

test("the plant dates the slab on screen and nothing else: the working day moves by hand or by a save", () => {
  const body = code(FORM);
  // The working day is written in four places: the batch's seed, a date set by hand, and a new slab saved.
  // Never from a slab that was only offered or tapped.
  const writes = [...body.matchAll(/workingDate\.current = ([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(writes.sort(), ["seed", "slab.productionDate", "v"]);
  assert.match(body, /if \(!wasEdit && slab\.productionDate\) workingDate\.current = slab\.productionDate;/);
  // When the number on the form stops being a listed one, the plant's day and shift leave with it.
  // ... with the NUMBER: while the same slab is on the form, a re-read that no longer lists it changes nothing.
  assert.match(body, /if \(!plantRow\) \{\s*const back = plantFilled\.current;\s*if \(!back\) return;\s*if \(plainSlabNo\(slab\.slabNumber\) === back\.slabNo\) return;\s*plantFilled\.current = null;/);
  assert.match(body, /plantRow\?\.shift, slab\.inTime, slab\.slabNumber\]\);/);
  // A new batch's seed replaces the date on the form; a date set by hand before it does not outlive that.
  assert.match(body, /if \(!editingId\) \{\s*dateTouched\.current = false;\s*setSlab\(\(p\) => \(\{ \.\.\.p, productionDate: seed,/);
  assert.match(body, /const d = dateTouched\.current \? p\.productionDate : \(workingDate\.current \|\| p\.productionDate\);/);
  assert.match(body, /const sh = shiftTouched\.current \|\| isValidTime\(p\.inTime\) \? p\.productionShift : \(back\.shift \|\| p\.productionShift\);/);
  // Correcting an existing slab drops it: an edit never inherits a listed slab's leftovers.
  assert.match(body, /if \(editingId\) \{ plantFilled\.current = null; return; \}/);
  // After a save the offered slab's day goes on the form only; what to go back to is the slab just saved.
  assert.match(body, /plantFilled\.current = fromPlant \? \{ shift: slab\.productionShift, slabNo: fromPlant\.slabNo \} : null;/);
  assert.match(body, /productionDate: fromPlantDate \|\| workingDate\.current, productionShift: fromPlant\?\.shift \|\| p\.productionShift/);
});

test("one plant time only: its day, unless the In time is plainly on the other side of midnight", () => {
  assert.equal(addDays("2026-11-14", 1), "2026-11-15");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(addDays("2100-03-01", -1), "2100-02-28", "2100 is not a leap year");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
  assert.equal(addDays("2026-11-14", 0), "2026-11-14");
  assert.equal(addDays("2026-11-14", 17), "2026-12-01");
  assert.equal(addDays("nonsense", 1), "nonsense");
  assert.equal(addDays("2026-13-40", 1), "2026-13-40", "not a date: left alone");
  const D = "2026-11-14T23:58:00.000", P = "2026-11-15T00:32:00.000";
  // Distributor only (the press time never came): its day; a small-hours In time after a late-evening distributor is the next day.
  assert.equal(plantSlabDate(D, null), "2026-11-14");
  assert.equal(plantSlabDate(D, null, "23:59"), "2026-11-14");
  assert.equal(plantSlabDate(D, null, "00:05"), "2026-11-15");
  assert.equal(plantSlabDate(D, null, "02:59"), "2026-11-15");
  assert.equal(plantSlabDate(D, null, "03:00"), "2026-11-14", "outside the window: a mistyped time does not move the day");
  assert.equal(plantSlabDate(D, null, "09:58"), "2026-11-14");
  // A daytime distributor time never moves, whatever is typed (two clocks a few minutes apart, a slip of the finger).
  assert.equal(plantSlabDate("2026-11-14T10:00:00.000", null, "09:55"), "2026-11-14");
  assert.equal(plantSlabDate("2026-11-14T20:59:00.000", null, "00:10"), "2026-11-14");
  assert.equal(plantSlabDate("2026-11-14T21:00:00.000", null, "00:10"), "2026-11-15");
  // Press only: its day; a late-evening In time before a small-hours press is the day before.
  assert.equal(plantSlabDate(null, P), "2026-11-15");
  assert.equal(plantSlabDate(null, P, "00:10"), "2026-11-15");
  assert.equal(plantSlabDate(null, P, "23:50"), "2026-11-14");
  assert.equal(plantSlabDate(null, P, "20:59"), "2026-11-15");
  assert.equal(plantSlabDate(null, "2026-11-15T03:00:00.000", "23:50"), "2026-11-15");
  assert.equal(plantSlabDate(null, "2026-11-01T00:10:00.000", "23:55"), "2026-10-31");
  // The row carries the same rule (the form asks the row, the list was built by the other).
  const { rows } = buildPlantSlabList([1, 2], [slab(1, D, null), slab(2, null, P)], []);
  for (const t of ["", "23:59", "00:05", "03:00", "12:00", "23:50", "20:59"]) {
    assert.equal(plantRowDate(rows[0], t), plantSlabDate(D, null, t), `distributor only, In ${t}`);
    assert.equal(plantRowDate(rows[1], t), plantSlabDate(null, P, t), `press only, In ${t}`);
  }
  // Neither time: the list has no day to offer, and the form keeps its own.
  const none = buildPlantSlabList([3], [slab(3, null, null)], []).rows[0];
  assert.equal(none.date, "");
  assert.equal(plantRowDate(none, "00:05"), "");
});
