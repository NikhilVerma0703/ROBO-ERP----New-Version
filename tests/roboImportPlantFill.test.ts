// ROBO IMPORT: BLANK BATCH AND THICKNESS FILLED FROM THE PLANT (owner, 17 Nov 2026,
// "Import: fill blanks"). The rule is lib/robo/importPlantFill; the reads are
// lib/robo/importPlantRead; the preview and the import call the one function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fillBlanksFromPlant, countFilled, plainSlabNumbersOf, misBatchBySlab, fillSummaryText,
  IMPORT_FILL_MAX_SLABS, type PlantFillValue,
} from "../src/lib/robo/importPlantFill.ts";
import { planRegisterImport, setupIndex } from "../src/lib/robo/registerImport.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const row = (rowNumber: number, slabNumber: string, batchNo = "", thickness: number | null = null) =>
  ({ rowNumber, slabNumber, batchNo, thickness, designName: "Crystallo" });
const plant = (entries: [number, PlantFillValue][]) => new Map(entries);

test("a blank batch and a blank thickness are filled from the plant, by slab number", () => {
  const rows = [row(2, "172600"), row(3, " 0172601 ")];
  const r = fillBlanksFromPlant(rows, plant([[172600, { batch: "D-1507", thicknessCm: 2 }], [172601, { batch: "1507", thicknessCm: 3 }]]));
  assert.equal(r.rows[0].batchNo, "D-1507");
  assert.equal(r.rows[0].thickness, 2);
  assert.equal(r.rows[1].batchNo, "1507");
  assert.equal(r.rows[1].thickness, 3);
  assert.deepEqual(r.filled.get(2), { batch: true, thickness: true });
  assert.deepEqual(countFilled(r.filled, r.rows), { batches: 2, thicknesses: 2 });
  assert.equal(rows[0].batchNo, "", "the file's own rows are not changed");
});

test("a typed cell is never overwritten; only the blank one is filled", () => {
  const r = fillBlanksFromPlant(
    [row(2, "100", "D-1400", null), row(3, "101", "", 1.2), row(4, "102", "D-1400", 2)],
    plant([[100, { batch: "1507", thicknessCm: 3 }], [101, { batch: "1507", thicknessCm: 3 }], [102, { batch: "1507", thicknessCm: 3 }]]),
  );
  assert.deepEqual([r.rows[0].batchNo, r.rows[0].thickness], ["D-1400", 3]);
  assert.deepEqual([r.rows[1].batchNo, r.rows[1].thickness], ["1507", 1.2]);
  assert.deepEqual([r.rows[2].batchNo, r.rows[2].thickness], ["D-1400", 2]);
  assert.deepEqual(r.filled.get(2), { batch: false, thickness: true });
  assert.deepEqual(r.filled.get(3), { batch: true, thickness: false });
  assert.equal(r.filled.has(4), false);
  assert.deepEqual(countFilled(r.filled, r.rows), { batches: 1, thicknesses: 1 });
  // Counted only over the rows that will be imported.
  assert.deepEqual(countFilled(r.filled, [r.rows[1]]), { batches: 1, thicknesses: 0 });
});

test("a slab number that is not a plain number is left untouched", () => {
  const rows = [row(2, "140748-A"), row(3, "17 2600"), row(4, "")];
  const r = fillBlanksFromPlant(rows, plant([[140748, { batch: "1507", thicknessCm: 2 }], [172600, { batch: "1507", thicknessCm: 2 }]]));
  rows.forEach((x, i) => assert.strictEqual(r.rows[i], x));
  assert.equal(r.filled.size, 0);
});

test("when the plant says nothing, every row comes back as it was", () => {
  const rows = [row(2, "172600"), row(3, "172601", "D-1", 2)];
  for (const lookup of [plant([]), plant([[999, { batch: "1", thicknessCm: 2 }]]), plant([[172600, { batch: null, thicknessCm: null }]]), plant([[172600, { batch: "  ", thicknessCm: 0 }]])]) {
    const r = fillBlanksFromPlant(rows, lookup);
    rows.forEach((x, i) => assert.strictEqual(r.rows[i], x));
    assert.equal(r.filled.size, 0);
  }
  assert.equal(fillSummaryText({ batches: 0, thicknesses: 0 }), "0 batch numbers and 0 thicknesses filled from the plant.");
  assert.equal(fillSummaryText({ batches: 12, thicknesses: 3 }), "12 batch numbers and 3 thicknesses filled from the plant.");
});

test("a filled batch groups into setups exactly like a typed one", () => {
  const filled = fillBlanksFromPlant([row(2, "100")], plant([[100, { batch: "D-1507", thicknessCm: 2 }]])).rows[0];
  const typed = row(3, "101", "D-1507", 2);
  const idx = setupIndex([{ id: "s1", designName: "Crystallo", batchNo: "d1507" }]);
  assert.equal(idx.find(filled.batchNo, "Crystallo"), "s1");
  assert.equal(idx.find(typed.batchNo, "Crystallo"), "s1");
  // The plan (what is imported, what is skipped) reads the filled rows the same way.
  const plan = planRegisterImport([filled, typed, row(4, "100")], new Set());
  assert.equal(plan.toImport.length, 2);
  assert.equal(plan.skipped[0].reason, "repeated");
});

test("slab numbers asked of the plant: plain ones, each once, in file order, capped and said", () => {
  assert.deepEqual(plainSlabNumbersOf(["5", " 5 ", "7", "8-A", "", "0009"]), { numbers: [5, 7, 9], capped: false });
  const big = plainSlabNumbersOf(Array.from({ length: 10 }, (_, i) => String(i + 1)), 4);
  assert.deepEqual(big, { numbers: [1, 2, 3, 4], capped: true });
  assert.equal(plainSlabNumbersOf(["1", "2", "3", "3"], 3).capped, false);
  assert.equal(IMPORT_FILL_MAX_SLABS, 6000);
});

test("plant thickness: the one rule the import reads (lib/robo/plantThickness), one plant row per slab", () => {
  const reader = read("src/lib/robo/importPlantRead.ts");
  assert.match(reader, /const thicknessCm = plantThicknessCm\(s\.thk\);/);
  // One row per slab number (the later by F_ID): the limit can never cut a number off the end.
  assert.match(reader, /SELECT DISTINCT ON \(s\.slab_no\) s\.slab_no, s\.line_order, s\.data->>'F_SLAB_THICKNESS' AS thk\s+FROM plant_slab s\s+WHERE s\.slab_no = ANY\(\$\{numbers\}::int\[\]\)\s+ORDER BY s\.slab_no, s\.f_id DESC\s+LIMIT \$\{IMPORT_FILL_MAX_SLABS\}/);
});

test("MIS names the batch: the hour holding the slab, as typed; two answers is no answer", () => {
  const hours = [
    { batch: "D-1506", start: 100, end: 110 },
    { batch: "D-1507", start: 111, end: 120 },
    { batch: "D-9", start: 200, end: 400 },       // not an hour: 201 numbers wide
    { batch: "", start: 130, end: 140 },
    { batch: "D-1", start: 150, end: 160 }, { batch: "D-2", start: 155, end: 165 },
  ];
  const m = misBatchBySlab([105, 111, 250, 135, 152, 158, 999], hours);
  assert.equal(m.get(105), "D-1506");
  assert.equal(m.get(111), "D-1507");
  assert.equal(m.get(152), "D-1");
  for (const n of [250, 135, 158, 999]) assert.equal(m.has(n), false, String(n));
});

/* ── source pins ─────────────────────────────────────────────────────── */
const READER = read("src/lib/robo/importPlantRead.ts");
const IMPORT = read("src/app/api/robo/imports/route.ts");
const PREVIEW = read("src/app/api/robo/imports/preview/route.ts");
const GATE = "  const refused = await roboGate();\n  if (refused) return refused;";

test("the reader only SELECTs, never selects *, guards on the plant tables and never throws", () => {
  assert.equal(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s|ALTER\s|TRUNCATE\s)/i.test(READER), false);
  assert.equal(/\$executeRaw|\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(READER), false);
  assert.equal(/SELECT\s+\*|\bs\.\*|\bb\.\*/i.test(READER), false);
  assert.equal([...READER.matchAll(/\$queryRaw</g)].length, 2);
  assert.equal([...READER.matchAll(/^\s+SELECT /gm)].length, 2);
  assert.match(READER, /await plantTablesReady\(\)/);
  assert.match(READER, /ORDER BY s\.slab_no, s\.f_id/);
  assert.match(READER, /b\.state = 'resolved'/);
  assert.match(READER, /catch \(e\) \{\n    console\.warn\(`\[robo\/import-fill\] the plant could not be read \(\$\{code\(e\)\}\)`\);/);
  assert.equal(/to_char|new Date\(/.test(READER), false, "no plant timestamp is read");
  assert.match(READER, /plantThicknessCm\(/);
  assert.match(READER, /export async function fillRowsFromPlant/);
});

test("both routes keep the roboGate first lines", () => {
  assert.ok(PREVIEW.includes(`export async function POST(req: Request) {\n${GATE}`));
  assert.ok(IMPORT.includes(`export async function GET() {\n${GATE}`));
  assert.ok(IMPORT.includes(`export async function POST(req: Request) {\n${GATE}`));
});

test("the preview and the import both fill through the same function, and use its rows", () => {
  for (const s of [PREVIEW, IMPORT]) {
    assert.match(s, /import \{ fillRowsFromPlant \} from "@\/lib\/robo\/importPlantRead";/);
    assert.equal([...s.matchAll(/await fillRowsFromPlant\(parsed\.rows\)/g)].length, 1);
    assert.equal(/recordedSlabNumbers\([^)]*parsed\.rows/.test(s), false);
    assert.equal(/planRegisterImport\(parsed\.rows/.test(s), false);
  }
  assert.match(PREVIEW, /planRegisterImport\(rows, recorded\)/);
  assert.match(IMPORT, /planRegisterImport\(fileRows, recorded\)/);
});

test("the pure module imports nothing from the app", () => {
  const imports = [...read("src/lib/robo/importPlantFill.ts").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./plantSlabs.ts"]);
});

test("the preview marks a filled cell and says the line", () => {
  const ui = read("src/components/robo/ImportClient.tsx");
  assert.match(ui, /function PlantTag/);
  assert.match(ui, /fillSummaryText\(preview\.plantFill\)/);
  assert.match(ui, /s\.filledBatch && <PlantTag \/>/);
  assert.match(ui, /s\.filledThickness && <PlantTag \/>/);
});
