import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assembleByBatch, assembleContinuous, type ExportRecord } from "../src/lib/robo/productionGrouping.ts";
import { PRODUCTION_RECORD_COLUMNS, type ProductionRecordRow } from "../src/lib/robo/productionExport.ts";
import { parseRecordRows, isSectionRow, fitsIntColumn, text } from "../src/lib/robo/registerRows.ts";
import {
  planRegisterImport, skipMessage, groupRowsByShift, setupIndex, setupLookupKey, setupMachineEntries,
  importLogView, IMPORT_RUNNING, IMPORT_STALE_MS, INTERRUPTED_MESSAGE,
} from "../src/lib/robo/registerImport.ts";
import {
  recordedSlabNumbers, importShift, SLAB_NUMBER_BATCH, REGISTER_IMPORT_LOCK, IMPORTED_SHIFT_NOTE,
  type SlabNumberDb, type ShiftDb,
} from "../src/lib/robo/registerImportDb.ts";

/* The Robo register import — code review of 20 Oct 2026:
   ROBO-2  re-importing the module's own download duplicated every slab whose
           printed production date was not its shift row's date;
   ROBO-4  the Batch No. column was dropped, so imported slabs fell out of every
           batch-filtered report, and the download's BATCH lines failed as
           "Slab Number is empty";
   ROBO-7  a round trip or more per row, no time limit, no transaction, and the
           history row written only at the end;
   ROBO-8  two imports at once both made the date's shift row and both wrote
           every slab. */

/** A source file as the repository holds it: LF, whatever the checkout did to it. */
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* ── the round trip from our own download ─────────────────────────────── */

const rec = (o: Partial<ExportRecord>): ExportRecord => ({
  serialNumber: null,
  productionDate: "2026-09-01",
  productionShift: "A",
  designName: "BANYAN",
  thickness: 1.6,
  batchNo: "D-1372",
  slabNumber: "140000",
  roymixBodyWeight: 52.5,
  roymixCycleTime: 61,
  inTime: "07:00",
  outTime: "07:20",
  remarks: "-",
  createdAtMs: 0,
  ...o,
});

/** The Production Records sheet as the parser receives it: the header, then
 *  each row laid out under it, blanks as null — what json_to_sheet writes and
 *  sheet_to_json({ header: 1, defval: null }) reads back. */
const asSheet = (rows: ProductionRecordRow[]): unknown[][] => [
  [...PRODUCTION_RECORD_COLUMNS],
  ...rows.map((r) => PRODUCTION_RECORD_COLUMNS.map((c) => r[c] ?? null)),
];

/** Two batches of ONE design on one date, as Download Slab Records writes them
 *  with only a date filter: grouped by batch, each opened by a BATCH line and
 *  closed by blank rows and a Total line. */
const twoBatches = [
  rec({ batchNo: "D-1372", slabNumber: "140001", createdAtMs: 1 }),
  rec({ batchNo: "D-1372", slabNumber: "140002", createdAtMs: 2 }),
  rec({ batchNo: "D-1373", slabNumber: "140101", createdAtMs: 3, productionShift: "B", inTime: "15:00", outTime: "15:20" }),
];

test("ROBO-4: the download's BATCH and Total lines are not rows, so a clean re-import reads clean", () => {
  const sheet = assembleByBatch(twoBatches);
  // The layout this has to survive: BATCH lines carry no slab number.
  assert.equal(sheet.filter((r) => r["S.No."] === "BATCH").length, 2);
  assert.equal(sheet.filter((r) => r["Slab No."] === "Total").length, 2);

  const parsed = parseRecordRows(asSheet(sheet));
  assert.deepEqual(parsed.issues, [], "no 'Slab Number is empty' for the BATCH lines");
  assert.equal(parsed.totalRows, 3, "only the slabs are counted as rows");
  assert.deepEqual(parsed.rows.map((r) => r.slabNumber), ["140001", "140002", "140101"]);
});

test("ROBO-4: the Batch No. on each slab line is read", () => {
  const parsed = parseRecordRows(asSheet(assembleByBatch(twoBatches)));
  assert.ok(parsed.detectedColumns.includes("batchNo"));
  assert.deepEqual(parsed.rows.map((r) => r.batchNo), ["D-1372", "D-1372", "D-1373"]);
  // Everything else the line carries still comes back as it did.
  const first = parsed.rows[0]!;
  assert.equal(first.date, "2026-09-01");
  assert.equal(first.shiftCode, "A");
  assert.equal(first.designName, "BANYAN");
  assert.equal(first.thickness, 1.6);
  assert.equal(first.bodyWeight, 52.5);
  assert.equal(first.cycleTime, 61);
  assert.equal(first.status, "COMPLETED");
  assert.equal(parsed.rows[2]!.shiftCode, "B");
  assert.equal(parsed.rows[2]!.shiftNumber, 2);
});

test("ROBO-4: the continuous layout (a batch chosen) and its TOTAL line read clean too", () => {
  const parsed = parseRecordRows(asSheet(assembleContinuous(twoBatches.slice(0, 2))));
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.totalRows, 2);
  assert.deepEqual(parsed.rows.map((r) => r.batchNo), ["D-1372", "D-1372"]);
});

test("a setup with no batch number exports '-', which reads back as no batch", () => {
  const parsed = parseRecordRows(asSheet(assembleByBatch([rec({ batchNo: null, slabNumber: "150000" })])));
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.rows[0]!.batchNo, "");
});

test("a paper register with its own headings: Batch / Batch Number, or no batch column at all", () => {
  for (const heading of ["Batch", "Batch Number", "batch no"]) {
    const parsed = parseRecordRows([["Date", "Slab No", heading], ["01/09/2026", "160000", "A-1248"]]);
    assert.equal(parsed.rows[0]!.batchNo, "A-1248", heading);
  }
  const none = parseRecordRows([["Date", "Slab No", "Design"], ["01/09/2026", "160000", "BANYAN"]]);
  assert.deepEqual(none.issues, []);
  assert.equal(none.rows[0]!.batchNo, "", "no column, no batch — imported exactly as before");
});

test("the section-line rule: TOTAL in Slab No., BATCH in S.No., any case; nothing else", () => {
  assert.equal(isSectionRow("", "TOTAL"), true);
  assert.equal(isSectionRow("", "Total"), true);
  assert.equal(isSectionRow("BATCH", ""), true);
  assert.equal(isSectionRow("batch", ""), true);
  assert.equal(isSectionRow("12", "140001"), false);
  assert.equal(isSectionRow("", "BATCH"), false, "a slab numbered BATCH is not the export's line");
  // A slab line with no number under a real S.No. is still reported, as before.
  const parsed = parseRecordRows([["S.No.", "Production Date", "Slab No."], [3, "2026-09-01", null]]);
  assert.deepEqual(parsed.issues, [{ rowNumber: 2, message: "Slab Number is empty" }]);
});

/* ── ROBO-7: one bad cell fails its row, not the file ──────────────────── */

test("an S.No. or cycle time an Int column would refuse fails that row with the reason; the rest go in", () => {
  const parsed = parseRecordRows([
    ["S.No.", "Production Date", "Slab No.", "Robo2 Cycle Time (sec)"],
    [1, "2026-09-01", "170001", 60],
    [2.5, "2026-09-01", "170002", 60],
    [3, "2026-09-01", "170003", 45.5],
    [4, "2026-09-01", "170004", 3e12],
    [5, "2026-09-01", "170005", "61"],
  ]);
  assert.deepEqual(parsed.rows.map((r) => r.slabNumber), ["170001", "170005"]);
  assert.deepEqual(parsed.issues.map((i) => i.rowNumber), [3, 4, 5]);
  assert.match(parsed.issues[0]!.message, /S\.No\. 2\.5 is not a whole number/);
  assert.match(parsed.issues[1]!.message, /Cycle Time 45\.5 is not a whole number of seconds/);
  assert.equal(parsed.totalRows, 5);
  assert.equal(fitsIntColumn(2147483647), true);
  assert.equal(fitsIntColumn(2147483648), false);
  assert.equal(fitsIntColumn(-3), true, "a negative S.No. went in before and still does");
});

test("a NUL in a cell, which Postgres refuses in text, is dropped rather than failing the file", () => {
  assert.equal(text("BAN\u0000YAN "), "BANYAN");
  assert.equal(text(" - "), "");
});

/* ── ROBO-2: one slab number, one record ──────────────────────────────── */

const row = (rowNumber: number, slabNumber: string, date = "2026-09-01", shiftNumber = 1) =>
  ({ rowNumber, slabNumber, date, shiftNumber });

test("ROBO-2: a slab already recorded is skipped whatever date the row prints", () => {
  // The review's case: slabs 1-80 on the 1 Sep shift, slab 81 carrying its own
  // date of 2 Sep, all recorded. The download prints 81 as 2 Sep; the old key
  // (slab number + shift date) found nothing on 2 Sep and recorded 81 again.
  const rows = [row(2, "80", "2026-09-01"), row(3, "81", "2026-09-02"), row(4, "82", "2026-09-02")];
  const plan = planRegisterImport(rows, new Set(["80", "81"]));
  assert.deepEqual(plan.toImport.map((r) => r.slabNumber), ["82"]);
  assert.deepEqual(plan.skipped.map((s) => [s.row.slabNumber, s.reason]), [["80", "recorded"], ["81", "recorded"]]);
  assert.equal(skipMessage(plan.skipped[1]!), "Row 3: slab 81 is already recorded");
});

test("ROBO-2: a number repeated in the file is written once — on any date, not only the same one", () => {
  const rows = [row(2, "90"), row(3, "91"), row(4, "90", "2026-09-05"), row(5, "90 ")];
  const plan = planRegisterImport(rows, new Set());
  assert.deepEqual(plan.toImport.map((r) => r.rowNumber), [2, 3]);
  assert.deepEqual(plan.skipped.map((s) => [s.row.rowNumber, s.reason]), [[4, "repeated"], [5, "repeated"]]);
  assert.equal(skipMessage(plan.skipped[0]!), "Row 4: slab 90 is listed earlier in this file");
});

test("ROBO-2: importing the same file twice writes nothing the second time", () => {
  const rows = [row(2, "100"), row(3, "101"), row(4, "102", "2026-09-02")];
  const first = planRegisterImport(rows, new Set());
  const nowRecorded = new Set(first.toImport.map((r) => r.slabNumber));
  const second = planRegisterImport(rows, nowRecorded);
  assert.equal(second.toImport.length, 0);
  assert.equal(second.skipped.length, 3);
});

test("rows are grouped by date and shift number, groups and rows in file order", () => {
  const rows = [row(2, "1", "2026-09-02"), row(3, "2", "2026-09-01"), row(4, "3", "2026-09-02"), row(5, "4", "2026-09-02", 2)];
  assert.deepEqual(groupRowsByShift(rows).map((g) => g.map((r) => r.slabNumber)), [["1", "3"], ["2"], ["4"]]);
});

/* ── ROBO-4: which setup a slab joins ─────────────────────────────────── */

test("ROBO-4: two batches of one design on one shift are two setups", () => {
  const idx = setupIndex([]);
  assert.equal(idx.find("D-1372", "BANYAN"), undefined);
  idx.remember({ id: "s1", designName: "BANYAN", batchNo: "D-1372" });
  assert.equal(idx.find("D-1372", "BANYAN"), "s1");
  assert.equal(idx.find("D-1373", "BANYAN"), undefined, "the second batch makes its own setup");
  idx.remember({ id: "s2", designName: "BANYAN", batchNo: "D-1373" });
  assert.equal(idx.find("D-1373", "Banyan "), "s2");
  assert.equal(idx.find("D-1372", "banyan"), "s1");
});

test("ROBO-4: a batch number matches its own setup however it is written, and a different series never", () => {
  const idx = setupIndex([{ id: "live", designName: "BANYAN", batchNo: "D1372" }]);
  assert.equal(idx.find("d-1372", "BANYAN"), "live", "a batch partly entered live joins its live setup");
  assert.equal(idx.find("A-1372", "BANYAN"), undefined);
  assert.equal(idx.find("D-1372", "AUREATE"), undefined, "same batch, other design: not this setup");
  assert.equal(setupLookupKey(" D-1372 ", " banyan"), "D1372|BANYAN");
});

test("a row with no batch number is matched by design alone, exactly as before", () => {
  // A paper register without a batch column lands on the shift's setup of that
  // design, whatever batch it carries — what the import always did.
  const idx = setupIndex([{ id: "live", designName: "BANYAN", batchNo: "D1372" }]);
  assert.equal(idx.find("", "banyan"), "live");
  assert.equal(idx.find(null, "BANYAN"), "live");
  assert.equal(idx.find("", "AUREATE"), undefined);
  // …and a setup it creates is found again by the next row of that design.
  idx.remember({ id: "new", designName: "AUREATE", batchNo: null });
  assert.equal(idx.find("", "AUREATE"), "new");
});

test("a batch-numbered row does not take over a setup that has no batch number", () => {
  const idx = setupIndex([{ id: "old", designName: "BANYAN", batchNo: null }]);
  assert.equal(idx.find("D-1372", "BANYAN"), undefined);
  assert.equal(idx.find("", "BANYAN"), "old");
});

/* ── ROBO-7: the history row ──────────────────────────────────────────── */

test("a 'running' history row reads as interrupted only once an import plainly cannot still be going", () => {
  const began = new Date("2026-10-20T10:00:00Z");
  const log = { id: "l1", status: IMPORT_RUNNING, createdAt: began, message: "Import in progress." };
  assert.equal(importLogView(log, began.getTime() + 60_000), log, "still inside an import's limit");
  const late = importLogView(log, began.getTime() + IMPORT_STALE_MS);
  assert.equal(late.status, "interrupted");
  assert.equal(late.message, INTERRUPTED_MESSAGE);
  assert.equal(late.id, "l1");
  assert.ok(IMPORT_STALE_MS > 60_000, "longer than maxDuration");
  const done = { id: "l2", status: "success", createdAt: began, message: "Imported 3 slab record(s)." };
  assert.equal(importLogView(done, began.getTime() + 10 * IMPORT_STALE_MS), done);
  // The JSON shape the GET hands on works too.
  assert.equal(importLogView({ ...log, createdAt: began.toISOString() }, began.getTime() + IMPORT_STALE_MS).status, "interrupted");
});

/* ── registerImportDb, against stand-ins ──────────────────────────────── */

test("recordedSlabNumbers: one read per batch of numbers for the whole file, trimmed and de-duplicated", async () => {
  const stored = new Set(["200001", "202400", "209999"]); // 209999 is not in the file
  const calls: string[][] = [];
  const db = {
    roboProductionRecord: {
      findMany: async (q: { where: { slabNumber: { in: string[] } } }) => {
        calls.push(q.where.slabNumber.in);
        return q.where.slabNumber.in.filter((n) => stored.has(n)).map((slabNumber) => ({ slabNumber }));
      },
    },
  } as unknown as SlabNumberDb;
  const numbers = Array.from({ length: 2500 }, (_, i) => String(200000 + i));
  const found = await recordedSlabNumbers(db, [...numbers, " 200001 ", "200001", ""]);
  assert.deepEqual([...found].sort(), ["200001", "202400"], "found across the batches, never what the file does not ask");
  assert.equal(calls.length, Math.ceil(2500 / SLAB_NUMBER_BATCH), "3 reads for 2,500 numbers, not 2,500");
  assert.ok(calls.every((c) => c.length <= SLAB_NUMBER_BATCH));
  assert.equal(new Set(calls.flat()).size, calls.flat().length, "each number asked once");
  assert.equal((await recordedSlabNumbers(db, [])).size, 0);
  assert.equal(calls.length, 3, "an empty file asks nothing");
});

/** A stand-in for prisma.roboShift: findFirst on (date, shiftNumber), oldest
 *  first; createMany honours skipDuplicates against a unique (date,
 *  shiftNumber) when `unique` is on — the database after scripts/0131. */
function shiftDb(rows: { id: string; date: string; shiftNumber: number; createdAt: number }[], opts: { unique: boolean; racer?: () => void }) {
  const created: unknown[] = [];
  let seq = 0;
  const db = {
    roboShift: {
      findFirst: async (q: { where: { date: string; shiftNumber: number } }) => {
        const hit = rows
          .filter((r) => r.date === q.where.date && r.shiftNumber === q.where.shiftNumber)
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        return hit ? { id: hit.id } : null;
      },
      createMany: async (q: { data: { date: string; shiftNumber: number }[]; skipDuplicates?: boolean }) => {
        opts.racer?.();
        let count = 0;
        for (const d of q.data) {
          created.push({ ...d, skipDuplicates: q.skipDuplicates });
          const clash = rows.some((r) => r.date === d.date && r.shiftNumber === d.shiftNumber);
          if (clash && opts.unique) {
            if (q.skipDuplicates) continue;
            throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          }
          rows.push({ id: `made-${++seq}`, date: d.date, shiftNumber: d.shiftNumber, createdAt: 1000 + seq });
          count++;
        }
        return { count };
      },
    },
  } as unknown as ShiftDb;
  return { db, created, rows };
}

const fields = { date: "2026-09-01", shiftNumber: 1, startTime: "06:10", endTime: "13:50", operatorName: "Ravi" };

test("importShift: the date's existing shift row is used and nothing is made", async () => {
  const s = shiftDb([{ id: "live", date: "2026-09-01", shiftNumber: 1, createdAt: 5 }, { id: "later", date: "2026-09-01", shiftNumber: 1, createdAt: 9 }], { unique: false });
  assert.deepEqual(await importShift(s.db, fields), { id: "live" }, "the oldest of the pair, every time");
  assert.equal(s.created.length, 0);
});

test("importShift: none there → one CLOSED, noted row, written with skipDuplicates, and read back", async () => {
  const s = shiftDb([], { unique: false });
  const got = await importShift(s.db, fields);
  assert.equal(got.id, "made-1");
  assert.deepEqual(s.created, [{ ...fields, status: "CLOSED", notes: IMPORTED_SHIFT_NOTE, skipDuplicates: true }]);
  // Without the index nothing conflicts: same as the old create.
  assert.equal(s.rows.length, 1);
});

test("ROBO-8: with the unique index, a row made by someone else in the same instant is found, not a failure", async () => {
  const rows: { id: string; date: string; shiftNumber: number; createdAt: number }[] = [];
  // The tablet makes today's row between the import's look and its insert.
  const s = shiftDb(rows, { unique: true, racer: () => { if (!rows.length) rows.push({ id: "tablet", date: "2026-09-01", shiftNumber: 1, createdAt: 7 }); } });
  assert.deepEqual(await importShift(s.db, fields), { id: "tablet" });
  assert.equal(rows.length, 1, "no second row for the pair");
});

/* ── wiring: the routes use all of the above ──────────────────────────── */

const ROUTE = src("src/app/api/robo/imports/route.ts");
const PREVIEW = src("src/app/api/robo/imports/preview/route.ts");

test("ROBO-7: the import has 60 s, one transaction with its own limit inside that, and createMany per shift", () => {
  assert.match(ROUTE, /^export const maxDuration = 60;$/m);
  assert.match(ROUTE, /const IMPORT_TX_TIMEOUT_MS = 50_000;/);
  assert.match(ROUTE, /\}, \{ timeout: IMPORT_TX_TIMEOUT_MS, maxWait: 5_000 \}\)\);/);
  assert.equal(ROUTE.split("prisma.$transaction(").length - 1, 1, "one transaction");
  assert.match(ROUTE, /await tx\.roboProductionRecord\.createMany\(\{ data \}\);/);
  // No per-row round trip and nothing written outside the transaction.
  assert.doesNotMatch(ROUTE, /roboProductionRecord\.create\(/);
  assert.doesNotMatch(ROUTE, /roboProductionRecord\.findFirst\(\{\s*where: \{ slabNumber/);
  assert.doesNotMatch(ROUTE, /await prisma\.robo(Shift|BatchRecipe|ProductionRecord|Design)\./, "every write goes through tx");
});

test("ROBO-7: the history row is written as running before the import starts, and finished after", () => {
  const running = ROUTE.indexOf("status: IMPORT_RUNNING");
  const tx = ROUTE.indexOf("prisma.$transaction(");
  assert.ok(running > 0 && running < tx, "running row first");
  assert.match(ROUTE, /prisma\.roboImportLog\.update\(\{ where: \{ id: logId \}, data \}\)/);
  assert.match(ROUTE, /logs: logs\.map\(\(l\) => importLogView\(l, now\)\)/);
  // Rolled back whole: the failure message says nothing was imported.
  assert.match(ROUTE, /Nothing was imported: the import failed and everything was rolled back\./);
});

test("ROBO-8: the advisory lock is taken first inside the transaction, before the slab numbers are read", () => {
  const body = ROUTE.slice(ROUTE.indexOf("prisma.$transaction("));
  const lock = body.indexOf("SELECT pg_try_advisory_xact_lock(hashtext(${REGISTER_IMPORT_LOCK})) AS ok");
  const read = body.indexOf("recordedSlabNumbers(tx,");
  assert.ok(lock > 0 && read > lock, "lock, then read");
  assert.match(body, /if \(!got\[0\]\?\.ok\) throw new ImportBusyError\(\);/);
  assert.match(ROUTE, /if \(busy\) return NextResponse\.json\(\{ error: BUSY_MESSAGE, historyReady \}, \{ status: 409 \}\);/);
  assert.match(ROUTE, /await importShift\(tx, \{/);
  assert.doesNotMatch(ROUTE, /roboShift\.(findFirst|create)\(/, "the shift goes through importShift");
  assert.equal(REGISTER_IMPORT_LOCK, "robo:register-import");
});

test("ROBO-2: neither route keys a duplicate on the shift's date any more; both use the one plan", () => {
  for (const [name, s] of [["import", ROUTE], ["preview", PREVIEW]] as const) {
    assert.doesNotMatch(s, /shift: \{ date: row\.date \}|shift\.date\}\|/, name);
    // The rows are the file's, blanks filled from the plant (importPlantRead; tests/roboImportPlantFill).
    assert.match(s, /recordedSlabNumbers\((tx|prisma), (fileRows|rows)\.map\(r => r\.slabNumber\)\)/, name);
    assert.match(s, /planRegisterImport\((fileRows|rows), recorded\)/, name);
  }
  assert.match(PREVIEW, /plan\.skipped\.slice\(0, 10\)\.map\(skipMessage\)/);
  assert.match(src("src/components/robo/ImportClient.tsx"), /A slab whose number is already recorded\s+is skipped, whatever its date/);
});

test("ROBO-4: a new setup carries the sheet's batch number and is found by it", () => {
  assert.match(ROUTE, /let recipeId = setups\.find\(row\.batchNo, rowDesign\);/);
  assert.match(ROUTE, /batchNo: row\.batchNo \|\| null,/);
  assert.match(ROUTE, /setups\.remember\(\{ id: recipeId, designName: rowDesign\.trim\(\), batchNo: row\.batchNo \|\| null \}\);/);
  assert.match(ROUTE, /select: \{ id: true, designName: true, batchNo: true \},/);
});

test("the records sheet is parsed by the pure module, and importRegister no longer carries its own copy", () => {
  const ir = src("src/lib/robo/importRegister.ts");
  assert.match(ir, /const records = parseRecordRows\(aoa\);/);
  assert.doesNotMatch(ir, /RECORD_ALIASES|function parseNumberCell|function text\(/);
  // The pure module imports nothing but relative .ts files.
  const imports = [...src("src/lib/robo/registerRows.ts").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  // CR-003 added ./trial.ts (import-free too): "(Trial Slab)" is taken off a batch cell.
  assert.deepEqual(imports, ["./productionShift.ts", "./trial.ts"]);
  const planImports = [...src("src/lib/robo/registerImport.ts").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(planImports, ["./batchNo.ts", "../normalizeBatch.ts"]);
  assert.deepEqual([...src("src/lib/robo/registerImportDb.ts").matchAll(/^import (.*) from "([^"]+)";$/gm)].map((m) => [m[1], m[2]]), [["type { Prisma }", "@prisma/client"]]);
});

/* ── E2E-24 (code review 27 Oct 2026): a machine listed twice for one key ── */

test("E2E-24: a setup gets the sheet's machine rows when each machine is listed once, exactly as before", () => {
  const machineByName = new Map([["robo1", "m1"], ["robo2", "m2"], ["robo3", "m3"]]);
  const entries = [
    { machineName: "Robo1", programName: "P1" },
    { machineName: "Unknown", programName: "PX" },
    { machineName: "ROBO2", programName: "P2" },
    { machineName: "robo3", programName: "P3" },
  ];
  assert.deepEqual(setupMachineEntries(entries, machineByName), [
    { machineId: "m1", entry: entries[0] },
    { machineId: "m2", entry: entries[2] },
    { machineId: "m3", entry: entries[3] },
  ], "the unknown machine is left out, the rest kept in order");
  assert.deepEqual(setupMachineEntries([], machineByName), []);
});

test("E2E-24: two batches of one design on one date list each machine twice; the setup is made with none, not rolled back", () => {
  const machineByName = new Map([["robo1", "m1"], ["robo2", "m2"], ["robo3", "m3"]]);
  // The Complete Production download's Setup sheet for batches 1384 and 1385,
  // both Crystallo on 18 Jul: one key, every machine twice.
  const twoBlocks = ["Robo1", "Robo2", "Robo3", "Robo1", "Robo2", "Robo3"].map((machineName, i) => ({ machineName, programName: `P${i}` }));
  assert.deepEqual(setupMachineEntries(twoBlocks, machineByName), []);
  // A hand-made sheet repeating one machine row, in another spelling, is the same case.
  assert.deepEqual(setupMachineEntries([{ machineName: "Robo1" }, { machineName: "robo1 ".trim() }], machineByName), []);
  // The route creates the entries from this helper, not from the raw list.
  assert.match(ROUTE, /create: setupMachineEntries\(entries, machineByName\)\n\s+\.map\(\(\{ machineId, entry: e \}\) => \(\{\n\s+machineId,/);
  assert.doesNotMatch(ROUTE, /create: entries\n/);
});
