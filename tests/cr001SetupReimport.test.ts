import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ANY_SHIFT, setupEntriesFor, setupKey, setupShiftOf, setupTargetSlabs, soleSetupDesign,
} from "../src/lib/robo/registerSetups.ts";

// CR-001 (20 Nov 2026): re-importing our own Complete Production download lost
// the machine setup of every Shift B and C slab. The Production Setup sheet has
// no Shift column, so its rows were filed under shift 1; a Shift C slab matched
// nothing and got a new setup with no machines, no date and no target.

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a setup sheet with no Shift column files its rows under ANY_SHIFT", () => {
  assert.equal(setupShiftOf(false, null), ANY_SHIFT);
  assert.equal(setupShiftOf(false, 3), ANY_SHIFT, "no column means no shift, whatever the cell holds");
});

test("a setup sheet WITH a Shift column is read exactly as before", () => {
  assert.equal(setupShiftOf(true, 1), 1);
  assert.equal(setupShiftOf(true, 2), 2);
  assert.equal(setupShiftOf(true, 3), 3);
  assert.equal(setupShiftOf(true, 2.7), 2);
  // A blank or out-of-range cell was shift 1 and still is.
  assert.equal(setupShiftOf(true, null), 1);
  assert.equal(setupShiftOf(true, 0), 1);
  assert.equal(setupShiftOf(true, 4), 1);
});

test("a Shift C slab finds the date's shift-less setup rows — the CR-001 case", () => {
  const rows = [{ machineName: "Roycut-1" }, { machineName: "Roymix" }];
  const setups = { [setupKey("2026-11-21", ANY_SHIFT, "Taj vein")]: rows };
  assert.deepEqual(setupEntriesFor(setups, "2026-11-21", 3, "Taj vein"), rows);
  assert.deepEqual(setupEntriesFor(setups, "2026-11-21", 1, "TAJ VEIN"), rows, "Shift A too, case-folded as setupKey folds it");
});

test("rows filed under the slab's own shift win over shift-less rows", () => {
  const own = [{ machineName: "Roycut-2" }];
  const any = [{ machineName: "Roycut-1" }];
  const setups = { [setupKey("2026-11-21", 2, "X")]: own, [setupKey("2026-11-21", ANY_SHIFT, "X")]: any };
  assert.deepEqual(setupEntriesFor(setups, "2026-11-21", 2, "X"), own);
  assert.deepEqual(setupEntriesFor(setups, "2026-11-21", 3, "X"), any);
});

test("no rows for the date or the design is still none", () => {
  const setups = { [setupKey("2026-11-21", ANY_SHIFT, "X")]: [{ machineName: "Roymix" }] };
  assert.deepEqual(setupEntriesFor(setups, "2026-11-22", 1, "X"), []);
  assert.deepEqual(setupEntriesFor(setups, "2026-11-21", 1, "Y"), []);
});

test("a shift-less setup gives a design to a row that names none, in every shift of its date", () => {
  const setups = { [setupKey("2026-11-21", ANY_SHIFT, "BANYAN")]: [] };
  assert.equal(soleSetupDesign(setups, "2026-11-21", 3), "BANYAN");
  assert.equal(soleSetupDesign(setups, "2026-11-21", 1), "BANYAN");
  assert.equal(soleSetupDesign(setups, "2026-11-22", 1), "");
});

test("the same design under the shift and shift-less is one design; two designs are still ambiguous", () => {
  assert.equal(soleSetupDesign({ "2026-11-21|2|BANYAN": [], "2026-11-21|0|BANYAN": [] }, "2026-11-21", 2), "BANYAN");
  assert.equal(soleSetupDesign({ "2026-11-21|2|BANYAN": [], "2026-11-21|0|AUREATE": [] }, "2026-11-21", 2), "");
});

test("the run's Target Slabs is read from its setup rows", () => {
  assert.equal(setupTargetSlabs([{ targetSlabs: null }, { targetSlabs: 120 }]), 120);
  assert.equal(setupTargetSlabs([{ targetSlabs: 0 }, { targetSlabs: 4.5 }, {}]), null, "only a whole, positive number");
  assert.equal(setupTargetSlabs([]), null);
});

test("the parser and the import route use the new lookup, and the setup keeps its date and target", () => {
  const parser = src("src/lib/robo/importRegister.ts");
  assert.match(parser, /setupShiftOf\("shiftNumber" in sCol, /);
  assert.match(parser, /targetSlabs:\s+\["targetslabs"\]/);
  const route = src("src/app/api/robo/imports/route.ts");
  assert.match(route, /const entries = setupEntriesFor\(parsed\.setups, row\.date, row\.shiftNumber, rowDesign\);/);
  assert.match(route, /productionDate: row\.date \|\| null,/);
  assert.match(route, /targetSlabs: setupTargetSlabs\(entries\),/);
  assert.doesNotMatch(route, /parsed\.setups\[setupKey\(/, "no lookup left that ignores the fallback");
});
