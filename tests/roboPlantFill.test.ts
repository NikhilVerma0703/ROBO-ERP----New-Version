// ROBO, FILLED FROM THE PLANT (owner, 17 Nov 2026: "go through the whole robo
// module, get all the things we can get from plant"; "fill wherever possible",
// "warnings are good"). Three things here: a new slab's own thickness, the
// batch setup picked from a batch the plant made, and a warning when a typed
// In or Out time falls outside the plant's window for the slab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPlantSlabList, plantBatchOffers, plantBatchOfferWords, plantTimeWarnings, slabThicknessToStore, thicknessWords,
  PLANT_BATCH_OFFERS_MAX, PLANT_TIME_ALLOW_MIN, type MisBatchHour, type PlantBatchSlab, type PlantSlabRow,
} from "../src/lib/robo/plantSlabs.ts";
import { plantThicknessCm } from "../src/lib/robo/plantThickness.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the plant's thickness code in Robo's centimetres; a slab stores its own only when it differs from the setup", () => {
  assert.equal(plantThicknessCm(4), 2);
  assert.equal(plantThicknessCm("5"), 3);
  assert.equal(plantThicknessCm(1), 0.7);
  assert.equal(plantThicknessCm(3), 1.2);
  for (const c of [0, 2, 6, "", null, undefined, "x", 4.5]) assert.equal(plantThicknessCm(c), null, String(c));
  assert.equal(slabThicknessToStore(3, 2), 3, "the setup said 2 cm, the plant made it in 3: the slab carries 3");
  assert.equal(slabThicknessToStore(3, 3), null, "the same as the setup: NULL keeps meaning 'the setup's'");
  assert.equal(slabThicknessToStore(2, null), 2, "a setup with no thickness: the plant's");
  assert.equal(slabThicknessToStore(null, 2), null, "the plant does not say: nothing changes");
  assert.equal(slabThicknessToStore(0, 2), null);
  assert.equal(thicknessWords(2), "2 cm");
  assert.equal(thicknessWords(0.7), "0.7 cm");
  assert.equal(thicknessWords(1.2000000001), "1.2 cm");
  assert.equal(thicknessWords(null), "");
});

test("a listed slab carries the plant's thickness, line-head end and press time", () => {
  const { rows } = buildPlantSlabList([10, 11], [
    { slabNo: 10, distAt: "2026-11-14T23:10:00.000", pressAt: "2026-11-15T00:40:00.000", lineOrder: 1, headEndAt: "2026-11-14T23:50:12.000", headName: "distributor", thicknessCm: 3 },
    { slabNo: 11, distAt: "2026-11-14T23:20:00.000", pressAt: null, lineOrder: 1 },
  ], []);
  assert.equal(rows[0].thickness, 3);
  assert.equal(rows[0].headEndAt, "2026-11-14T23:50");
  assert.equal(rows[0].headName, "distributor");
  assert.equal(rows[0].pressAtFull, "2026-11-15T00:40");
  assert.equal(rows[1].thickness, null);
  assert.equal(rows[1].headEndAt, null);
  assert.equal(rows[1].pressAtFull, null);
});

test("In and Out against the plant's window: after the line head, before the press, a few minutes' allowance, across midnight", () => {
  assert.equal(PLANT_TIME_ALLOW_MIN, 5);
  const row: Pick<PlantSlabRow, "headEndAt" | "headName" | "pressAtFull"> = { headEndAt: "2026-11-14T23:50", headName: "distributor", pressAtFull: "2026-11-15T00:40" };
  assert.deepEqual(plantTimeWarnings(row, "23:55", "00:30"), []);
  assert.deepEqual(plantTimeWarnings(row, "23:46", "00:44"), [], "inside the allowance");
  assert.deepEqual(plantTimeWarnings(row, "23:40", ""), ["In time 23:40 is before this slab left the distributor at 23:50 (plant)."]);
  assert.deepEqual(plantTimeWarnings(row, "", "00:50"), ["Out time 00:50 is after this slab reached the press at 00:40 (plant)."]);
  assert.deepEqual(plantTimeWarnings(row, "01:00", ""), ["In time 01:00 is after this slab reached the press at 00:40 (plant)."]);
  assert.deepEqual(plantTimeWarnings(row, "", "23:30"), ["Out time 23:30 is before this slab left the distributor at 23:50 (plant)."]);
  assert.equal(plantTimeWarnings(row, "13:40", "13:50").length, 2, "an hour slip (13 for 23) is caught");
  // Nothing typed, half-typed, or no plant window: no word.
  assert.deepEqual(plantTimeWarnings(row, "", ""), []);
  assert.deepEqual(plantTimeWarnings(row, "2:3", null), []);
  assert.deepEqual(plantTimeWarnings({ headEndAt: null, headName: "distributor", pressAtFull: null }, "03:00", "04:00"), []);
  // One end only: that end is still checked.
  assert.deepEqual(plantTimeWarnings({ headEndAt: null, headName: "distributor", pressAtFull: "2026-11-15T10:00" }, "09:00", "10:30"),
    ["Out time 10:30 is after this slab reached the press at 10:00 (plant)."]);
  assert.deepEqual(plantTimeWarnings({ headEndAt: "2026-11-15T10:00", headName: "Kreos", pressAtFull: null }, "09:30", ""),
    ["In time 09:30 is before this slab left the Kreos at 10:00 (plant)."]);
  // Month and year ends are counted by hand, not through a Date.
  assert.deepEqual(plantTimeWarnings({ headEndAt: "2026-12-31T23:58", headName: "distributor", pressAtFull: "2027-01-01T00:30" }, "00:05", "00:20"), []);
  assert.deepEqual(plantTimeWarnings({ headEndAt: "2028-02-28T23:58", headName: "distributor", pressAtFull: "2028-02-29T00:30" }, "00:05", "00:40"),
    ["Out time 00:40 is after this slab reached the press at 00:30 (plant)."]);
});

test("the batches offered to a new setup: newest first, first slab's day and thickness, every thickness, set up or not", () => {
  const hours: MisBatchHour[] = [
    { batchKey: "1507", batch: "D1507", design: "Alchemy", start: 172820, end: 172830 },
    { batchKey: "1506", batch: "D1506", design: "Honeydew", start: 172770, end: 172780 },
    { batchKey: "1507", batch: "D1507", design: "Alchemy", start: 172781, end: 172790 },
    { batchKey: "1599", batch: "D1599", design: "Ghost", start: 999000, end: 999005 }, // the plant has none: not offered
    { batchKey: "1506", batch: "D-1506", design: null, start: 172350, end: 172355 },
    { batchKey: "", batch: "x", design: "x", start: 1, end: 2 },
  ];
  const plant: PlantBatchSlab[] = [];
  for (let n = 172350; n <= 172355; n++) plant.push({ slabNo: n, distAt: "2026-11-12T04:24:00.000", pressAt: "2026-11-12T05:36:00.000", thicknessCm: 3 });
  for (let n = 172770; n <= 172780; n++) plant.push({ slabNo: n, distAt: "2026-11-14T08:00:00.000", pressAt: "2026-11-14T09:00:00.000", thicknessCm: 2 });
  plant.push({ slabNo: 172781, distAt: "2026-11-14T23:50:00.000", pressAt: "2026-11-15T00:40:00.000", thicknessCm: null });
  for (let n = 172782; n <= 172790; n++) plant.push({ slabNo: n, distAt: "2026-11-15T01:00:00.000", pressAt: "2026-11-15T02:00:00.000", thicknessCm: 2 });
  for (let n = 172820; n <= 172830; n++) plant.push({ slabNo: n, distAt: "2026-11-15T09:00:00.000", pressAt: "2026-11-15T10:00:00.000", thicknessCm: 3 });
  const offers = plantBatchOffers(hours, plant, new Set(["1506"]));
  assert.deepEqual(offers.map((o) => o.batchKey), ["1507", "1506"], "newest first; a batch the plant has nothing of is left out");
  const [b7, b6] = offers;
  assert.equal(b7.batch, "D1507", "the batch as MIS spells it, from its newest hour");
  assert.equal(b7.firstSlab, 172781);
  assert.equal(b7.date, "2026-11-14", "the first slab's day (across midnight: the distributor's)");
  assert.equal(b7.thickness, 2, "the first slab whose thickness the plant knows");
  assert.deepEqual(b7.thicknesses, [2, 3]);
  assert.equal(b7.slabs, 21);
  assert.equal(b7.setUp, false);
  assert.equal(b6.firstSlab, 172350, "a batch's first slab, from all its hours");
  assert.equal(b6.date, "2026-11-12");
  assert.equal(b6.thickness, 3);
  assert.equal(b6.design, "Honeydew");
  assert.equal(b6.setUp, true);
  assert.equal(plantBatchOfferWords(b7), "D1507 · Alchemy · from 14 Nov · 2 cm and 3 cm · 21 slabs");
  assert.deepEqual(b6.thicknesses, [2, 3]);
  assert.equal(plantBatchOfferWords(b6), "D1506 · Honeydew · from 12 Nov · 2 cm and 3 cm · 17 slabs · already set up");
  // At most PLANT_BATCH_OFFERS_MAX batches.
  const many: MisBatchHour[] = Array.from({ length: 40 }, (_, i) => ({ batchKey: String(2000 + i), batch: `D${2000 + i}`, design: "", start: 500000 + i * 10, end: 500000 + i * 10 + 1 }));
  const manyPlant: PlantBatchSlab[] = many.flatMap((h) => [Number(h.start), Number(h.end)].map((n) => ({ slabNo: n, distAt: "2026-11-15T09:00:00.000", pressAt: null, thicknessCm: null })));
  const capped = plantBatchOffers(many, manyPlant, new Set());
  assert.equal(capped.length, PLANT_BATCH_OFFERS_MAX);
  assert.equal(capped[0].batchKey, "2000");
  assert.equal(plantBatchOfferWords(capped[0]), "D2000 · from 15 Nov · 2 slabs");
  assert.deepEqual(plantBatchOffers([], plant, new Set()), []);
});

// ---------- the wiring, pinned from the source ----------
test("a new slab's thickness: read from the plant before the save, stored only when it differs, never in the way of the save", () => {
  const post = code(read("src/app/api/robo/production/route.ts"));
  const at = post.indexOf("const ownThickness = await slabThicknessFromPlant(slabNumber, body.batchRecipeId || null);");
  assert.ok(at > 0, "read once, by slab number and setup");
  assert.ok(at < post.indexOf("prisma.$transaction"), "outside the transaction: a plant read never holds the save's locks");
  assert.match(post, /roymixBodyWeight: body\.roymixBodyWeight \? Number\(body\.roymixBodyWeight\) : null,\s*thickness:\s+ownThickness,/);
  const reader = code(read("src/lib/robo/plantSlabThickness.ts"));
  assert.doesNotMatch(reader, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$transaction|\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/);
  assert.match(reader, /FROM plant_slab s\s+WHERE s\.slab_no = \$\{n\}\s+ORDER BY s\.f_id DESC\s+LIMIT 1/);
  assert.match(reader, /if \(!\(await plantTablesReady\(\)\)\) return null;/);
  assert.equal((reader.match(/catch \(e\) \{/g) ?? []).length, 2, "both reads are caught: no answer is the old behaviour");
  assert.match(reader, /return slabThicknessToStore\(plantCm, setup\?\.thickness \?\? null\);/);
});

test("the batch offers are read behind the Robo gate, only read, and never fail the setup", () => {
  const route = read("src/app/api/robo/batch-recipes/plant-batches/route.ts");
  assert.ok(route.includes("const refused = await roboGate();\n  if (refused) return refused;"));
  const body = code(route);
  assert.doesNotMatch(body, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$transaction|\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/);
  assert.match(body, /FROM plant_slab s\s+WHERE s\.slab_no = ANY\(\$\{numbers\}::int\[\]\)\s+ORDER BY s\.slab_no, s\.f_id/);
  assert.match(body, /catch \(e\) \{\s*console\.warn\(`[^`]*\$\{code\(e\)\}[^`]*`\);\s*return NextResponse\.json\(\{ state: "failed", offers: \[\] \}\);/);
  assert.doesNotMatch(body, /status: [45]\d\d/);
  // Every hour of the chosen batches is read, so a long batch starts at its real first slab.
  assert.match(body, /where: \{ batchKey: \{ in: keys \}, startingSlabNumber: \{ not: null \}, endingSlabNumber: \{ not: null \} \}/);
});

test("the tablet's rule file loads no server code; the screens take the plant's word only where it belongs", () => {
  const rules = read("src/lib/robo/plantSlabs.ts");
  assert.deepEqual([...rules.matchAll(/^import .* from "(.+)";$/gm)].map((m) => m[1]), ["./productionShift.ts", "../shiftScoreMath.ts"]);
  assert.doesNotMatch(rules, /new Date\(|Date\.parse|toISOString|Date\.UTC/);
  const form = read("src/components/robo/RoboEntryForm.tsx");
  // The batch picker: a NEW setup only.
  assert.match(form, /\{!editingBatchId && !isSetupEdit && \(\s*<PlantBatchPicker /);
  assert.match(form, /batchNo: o\.batch,\s*productionDate: o\.date \|\| p\.productionDate,\s*thickness: o\.thickness != null \? String\(o\.thickness\) : p\.thickness,/);
  assert.doesNotMatch(form.slice(form.indexOf("<PlantBatchPicker"), form.indexOf("<PlantBatchPicker") + 600), /designName/, "the design stays the operator's");
  // The time warning: a listed slab only (plantRow is null while correcting a slab), and never in the save's way.
  assert.match(form, /const plantTimeNotes = plantRow\s*\? plantTimeWarnings\(plantRow,/);
  const save = form.slice(form.indexOf("const saveSlab = async"), form.indexOf("const saveSlab = async") + 3000);
  assert.doesNotMatch(save, /plantTimeNotes|plantTimeWarnings/);
  const picker = read("src/components/robo/PlantBatchPicker.tsx");
  assert.match(picker, /fetch\("\/api\/robo\/batch-recipes\/plant-batches", \{ cache: "no-store" \}\)/);
  assert.match(picker, /if \(state === "off"\) return null;/);
});

// ---------- corrections from the review of 17 Nov ----------
import { setupIndex } from "../src/lib/robo/registerImport.ts";

test("a batch the plant filled joins the setup a blank cell would have joined, or the same batch however spelt", () => {
  // A shift with a setup of Crystallo that has no batch number (every import before batch numbers looked so).
  const blank = setupIndex([{ id: "old", designName: "Crystallo", batchNo: null }]);
  assert.equal(blank.find("", "Crystallo"), "old", "a blank cell joins it");
  assert.equal(blank.find("D-1372", "Crystallo"), undefined, "find alone would make a second setup");
  assert.equal(blank.findForFilled("D-1372", "crystallo"), "old", "a filled cell joins it, as the blank did");
  // The same batch spelt three ways is one batch.
  const typed = setupIndex([{ id: "t", designName: "Crystallo", batchNo: "1372" }]);
  assert.equal(typed.find("D1372", "Crystallo"), undefined);
  assert.equal(typed.findForFilled("D1372", "Crystallo"), "t");
  assert.equal(typed.findForFilled("D-1372", "CRYSTALLO"), "t");
  // Another batch of the design, and no blank setup: a new setup for the plant's batch.
  assert.equal(typed.findForFilled("D1373", "Crystallo"), undefined);
  // Another design: never.
  assert.equal(blank.findForFilled("D-1372", "Arena"), undefined);
  // A setup the import makes is found the same way.
  const idx = setupIndex([]);
  idx.remember({ id: "new", designName: "Arena", batchNo: "D1480" });
  assert.equal(idx.findForFilled("1480", "Arena"), "new");
  // The route asks it only for a FILLED batch, after find.
  const route = code(read("src/app/api/robo/imports/route.ts"));
  assert.match(route, /const \{ rows: fileRows, filled \} = await fillRowsFromPlant\(parsed\.rows\);/);
  assert.match(route, /let recipeId = setups\.find\(row\.batchNo, rowDesign\);\s*if \(!recipeId && filled\.get\(row\.rowNumber\)\?\.batch\) recipeId = setups\.findForFilled\(row\.batchNo, rowDesign\);/);
});

test("the slab leaves the distributor at its END: the list's time, date and shift follow it", () => {
  const { rows } = buildPlantSlabList([172849], [{
    slabNo: 172849, lineOrder: 1, distAt: "2026-11-14T23:42:00.000", headEndAt: "2026-11-15T00:16:00.417",
    headName: "distributor", pressAt: "2026-11-15T01:03:00.000", thicknessCm: 3,
  }], []);
  const r = rows[0];
  assert.equal(r.dist, "00:16");
  assert.equal(r.distDate, "2026-11-15");
  assert.equal(r.date, "2026-11-15", "the robots worked after midnight: the next day (it began 23:42)");
  assert.equal(r.shift, "C");
  // An end the list cannot read is as good as none: the begin stands in, never a blank.
  const odd = buildPlantSlabList([6], [{ slabNo: 6, lineOrder: 1, distAt: "2026-11-15T09:00:00.000", headEndAt: "garbled", pressAt: null }], []).rows[0];
  assert.equal(odd.dist, "09:00");
  assert.equal(odd.date, "2026-11-15");
  // Until the end is known, the begin stands in.
  const early = buildPlantSlabList([5], [{ slabNo: 5, lineOrder: 1, distAt: "2026-11-15T09:00:00.000", pressAt: null }], []).rows[0];
  assert.equal(early.dist, "09:00");
  assert.equal(early.date, "2026-11-15");
});

test("the made-vs-entered report reads every batch in three reads, and says nothing when there is no plant", () => {
  const route = code(read("src/app/api/robo/reports/coverage/route.ts"));
  assert.doesNotMatch(route, /oneBatch/);
  assert.equal((route.match(/prisma\.mis\.findMany/g) ?? []).length, 1);
  assert.equal((route.match(/\$queryRaw/g) ?? []).length, 2);
  assert.match(route, /where: \{ batchKey: \{ in: keys \}, startingSlabNumber: \{ not: null \}, endingSlabNumber: \{ not: null \} \}/);
  assert.match(route, /let capped = keys\.length > 0 && hours\.length >= hoursTake;/, "a full page of MIS hours is said, never silent");
  const card = read("src/components/robo/reports/CoverageCard.tsx");
  assert.match(card, /if \(!loading && answer\?\.state === "off"\) return null;/);
});
