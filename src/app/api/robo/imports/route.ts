import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { currentUser, roboGate } from "@/lib/rbac";
import { parseRegister, setupEntriesFor, setupTargetSlabs, soleSetupDesign } from "@/lib/robo/importRegister";
import {
  IMPORT_RUNNING, groupRowsByShift, importLogView, planRegisterImport, setupIndex, setupMachineEntries,
} from "@/lib/robo/registerImport";
import { REGISTER_IMPORT_LOCK, importShift, recordedSlabNumbers } from "@/lib/robo/registerImportDb";
import { fillRowsFromPlant } from "@/lib/robo/importPlantRead";

/* ROBO-7 (code review of 20 Oct 2026). A month's register is a few thousand
   slabs. The import used to make several sequential round trips per row with
   no limit set, so a large file could hit the platform's default time limit
   part-way: the rows written so far stayed, no history row was written, and
   the operator saw a generic failure. Now it reads the slab numbers once,
   writes each shift's slabs with one createMany, all inside one transaction,
   and is given the 60 s the other heavy routes have. */
export const maxDuration = 60;

/** The transaction's own limit, inside maxDuration so it is the transaction
 *  that gives up — and rolls back — before the platform stops the function. */
const IMPORT_TX_TIMEOUT_MS = 50_000;

export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  try {
    const logs = await prisma.roboImportLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
    // A row an import left "running" because it was cut off reads as
    // "interrupted" here — display only, nothing is written (registerImport.ts).
    const now = Date.now();
    return NextResponse.json({ ready: true, logs: logs.map((l) => importLogView(l, now)) });
  } catch {
    // Table not created yet — the page still renders and explains what to run.
    return NextResponse.json({ ready: false, logs: [] });
  }
}

/** Thrown inside the transaction when another import holds the lock. */
class ImportBusyError extends Error {}

const BUSY_MESSAGE =
  "Another register import is running. Wait for it to finish, then import this file again — slabs the other import has already recorded will be skipped.";

/** POST /api/robo/imports — parse the register and write shifts, setups and slab records. */
export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const form = await req.formData();
  const file = form.get("file");
  const period = (form.get("period") as string | null)?.trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No workbook uploaded." }, { status: 400 });
  }
  // The whole file is read into memory and handed to the XLSX parser, so it is
  // sized and named first — the 10 MB ceiling every other intake uses (OCR,
  // the fab PO PDF, the Chromia register). A real register is well under a
  // megabyte; anything near the cap is the wrong file, and a crafted workbook
  // can inflate far beyond its byte size inside the parser. The name is checked
  // because the browser's MIME for spreadsheets is unreliable (often blank or
  // octet-stream); the picker on the import page already limits to .xlsx/.xls.
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 413 });
  }
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name ?? "")) {
    return NextResponse.json({ error: "Only an Excel workbook (.xlsx / .xls) is accepted here." }, { status: 415 });
  }

  const u = await currentUser();
  const userName = u?.name ?? "unknown";

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseRegister(buf);

  type LogFields = {
    status: string; totalRows: number; imported: number; skipped: number; failed: number; message: string;
  };

  if (parsed.fatal) {
    let logged = false;
    try {
      await prisma.roboImportLog.create({
        data: { fileName: file.name, period, user: userName, status: "failed", totalRows: 0, imported: 0, skipped: 0, failed: 0, message: parsed.fatal },
      });
      logged = true;
    } catch { /* history table not created yet */ }
    return NextResponse.json({ status: "failed", totalRows: 0, imported: 0, skipped: 0, failed: 0, message: parsed.fatal, historyReady: logged });
  }

  /* ROBO-7. The history row is written BEFORE anything else, as "running",
     and finished at the end — so an import the platform stops part-way still
     leaves a row behind (shown as "interrupted" once it is plainly over),
     where before it left none. Null when the table is not there yet. */
  let logId: string | null = null;
  try {
    const log = await prisma.roboImportLog.create({
      data: {
        fileName: file.name, period, user: userName, status: IMPORT_RUNNING,
        totalRows: parsed.totalRows, message: "Import in progress.",
      },
      select: { id: true },
    });
    logId = log.id;
  } catch { /* history table not created yet */ }
  const finishLog = async (data: LogFields): Promise<boolean> => {
    if (!logId) return false;
    try {
      await prisma.roboImportLog.update({ where: { id: logId }, data });
      return true;
    } catch {
      return false;
    }
  };

  /* Blank batch and thickness cells filled from the plant, by slab number: the
     same call the preview makes (lib/robo/importPlantRead), read once, before
     the transaction, so what is imported is what the preview showed. Where the
     plant says nothing these are the file's own rows. */
  const { rows: fileRows, filled } = await fillRowsFromPlant(parsed.rows);

  const machines = await prisma.roboMachine.findMany({ select: { id: true, name: true } });
  const machineByName = new Map(machines.map(m => [m.name.toLowerCase(), m.id]));

  let imported = 0;
  let skipped = 0;
  try {
    /* One transaction for the whole file (ROBO-7, ROBO-8): every shift, setup
       and slab it writes lands together or not at all, so a failure or a
       timeout part-way leaves nothing half-imported to clean up — import the
       file again. */
    ({ imported, skipped } = await prisma.$transaction(async (tx) => {
      // ROBO-8: one import at a time. Taken first, so the slab numbers below
      // are read after any import before this one has committed. See
      // REGISTER_IMPORT_LOCK for why, and why "try".
      const got = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${REGISTER_IMPORT_LOCK})) AS ok`;
      if (!got[0]?.ok) throw new ImportBusyError();

      // ROBO-2: a slab number already recorded anywhere is a duplicate, whatever
      // date the row prints; so is one repeated further down the file. Read
      // once for the whole file, not once per row.
      const recorded = await recordedSlabNumbers(tx, fileRows.map(r => r.slabNumber));
      const plan = planRegisterImport(fileRows, recorded);

      // Entry order. Each slab gets its own createdAt, one millisecond after
      // the last, in file order — what one create per row used to give them,
      // and what Slab Records (newest first) and the createdAt tiebreaks read.
      // A single createMany would otherwise stamp them all alike.
      const stamp = Date.now();
      let written = 0;

      // Grouped by production date + shift number
      for (const rows of groupRowsByShift(plan.toImport)) {
        const { date, shiftNumber } = rows[0];

        /* ── Shift ── */
        const inTimes = rows.map(r => r.inTime).filter(Boolean).sort() as string[];
        const outTimes = rows.map(r => r.outTime).filter(Boolean).sort() as string[];
        const shift = await importShift(tx, {
          date,
          shiftNumber,
          startTime: inTimes[0] ?? "00:00",
          endTime: outTimes.length ? outTimes[outTimes.length - 1] : null,
          operatorName: rows.find(r => r.operatorName)?.operatorName ?? "",
        });

        /* The design for rows that do not carry one. Our own export stopped
           repeating Design Name on every slab line, so on a re-import the second
           sheet is what says which run a slab belongs to. Only used when that
           answer is unambiguous — see soleSetupDesign. */
        const fallbackDesign = soleSetupDesign(parsed.setups, date, shiftNumber);

        /* ── Production setups: one per batch number and design in this shift
           (ROBO-4), or per design for rows that name no batch — setupIndex ── */
        const setups = setupIndex(await tx.roboBatchRecipe.findMany({
          // CR-003: an imported row never joins a trial setup (each belongs to its one trial slab).
          where: { shiftId: shift.id, isTrial: false },
          select: { id: true, designName: true, batchNo: true },
        }));

        /* ── Slab records ── */
        const lastSerial = await tx.roboProductionRecord.findFirst({
          where: { shiftId: shift.id },
          orderBy: { serialNumber: "desc" },
          select: { serialNumber: true },
        });
        let nextSerial = (lastSerial?.serialNumber ?? 0) + 1;

        const data: Prisma.RoboProductionRecordCreateManyInput[] = [];
        for (const row of rows) {
          // Resolve (or create) the setup this slab was produced under
          let batchRecipeId: string | null = null;
          const rowDesign = row.designName || fallbackDesign;
          if (rowDesign) {
            let recipeId = setups.find(row.batchNo, rowDesign);
            // A batch the plant filled in joins the setup of the same batch however it is spelt,
            // else the design's setup with no batch number, where the blank cell went before.
            if (!recipeId && filled.get(row.rowNumber)?.batch) recipeId = setups.findForFilled(row.batchNo, rowDesign);
            if (!recipeId) {
              const design = await tx.roboDesign.upsert({
                where: { name: rowDesign.trim() },
                update: {},
                create: { name: rowDesign.trim() },
              });
              // CR-001: the rows for this slab's own shift, else the date's
              // shift-less rows (our own download has no Shift column there).
              const entries = setupEntriesFor(parsed.setups, row.date, row.shiftNumber, rowDesign);
              const created = await tx.roboBatchRecipe.create({
                data: {
                  shiftId: shift.id,
                  designId: design.id,
                  designName: rowDesign.trim(),
                  programName: "",
                  // CR-001: the run's date and Target Slabs come back with it,
                  // as the setup had them when it was exported.
                  productionDate: row.date || null,
                  targetSlabs: setupTargetSlabs(entries),
                  // ROBO-4: the batch the sheet named, so the slabs are found
                  // by every Batch Number filter. Null when it named none, as
                  // every imported setup was before.
                  batchNo: row.batchNo || null,
                  thickness: row.thickness,
                  notes: "Imported from production register",
                  entries: {
                    // E2E-24: none when the sheet lists a machine twice for
                    // this key (two batches of one design on one date).
                    create: setupMachineEntries(entries, machineByName)
                      .map(({ machineId, entry: e }) => ({
                        machineId,
                        programName: e.programName,
                        toolName: e.toolName,
                        liquidName: e.liquidName,
                        powderName: e.powderName,
                        rollerHeight: e.rollerHeight,
                        targetCycleTime: e.targetCycleTime,
                      })),
                  },
                },
                select: { id: true },
              });
              recipeId = created.id;
              setups.remember({ id: recipeId, designName: rowDesign.trim(), batchNo: row.batchNo || null });
            }
            batchRecipeId = recipeId;
          }

          data.push({
            serialNumber:     row.serialNumber ?? nextSerial,
            slabNumber:       row.slabNumber,
            shiftId:          shift.id,
            batchRecipeId,
            // The A/B/C the sheet's Shift column carried, when it carried one
            // — so a register exported from here and loaded back keeps its
            // shifts. Null otherwise, and the In Time answers instead.
            productionShift:  row.shiftCode,
            inTime:           row.inTime,
            outTime:          row.outTime,
            roymixBodyWeight: row.bodyWeight,
            roymixCycleTime:  row.cycleTime,
            status:           row.status,
            remarks:          row.remarks,
            createdAt:        new Date(stamp + written++),
          });
          if (!row.serialNumber) nextSerial++;
        }
        await tx.roboProductionRecord.createMany({ data });
      }

      return { imported: plan.toImport.length, skipped: plan.skipped.length };
    }, { timeout: IMPORT_TX_TIMEOUT_MS, maxWait: 5_000 }));
  } catch (err) {
    const busy = err instanceof ImportBusyError;
    const timedOut = (err as { code?: string }).code === "P2028";
    const message = busy
      ? `Not imported. ${BUSY_MESSAGE}`
      : timedOut
        ? "Nothing was imported: the import ran out of time and everything was rolled back. If the register is large, split it into smaller files (a week at a time) and import each."
        : `Nothing was imported: the import failed and everything was rolled back. ${(err as Error).message}`;
    const failed = parsed.totalRows;
    const historyReady = await finishLog({ status: "failed", totalRows: parsed.totalRows, imported: 0, skipped: 0, failed, message });
    if (busy) return NextResponse.json({ error: BUSY_MESSAGE, historyReady }, { status: 409 });
    if (!timedOut) console.error("Robo register import failed:", err);
    return NextResponse.json({
      status: "failed", totalRows: parsed.totalRows, imported: 0, skipped: 0, failed, message, historyReady,
      issues: parsed.issues.slice(0, 8).map(i => `Row ${i.rowNumber}: ${i.message}`),
    });
  }

  const failed = parsed.issues.length;
  const status = imported === 0 ? "failed" : skipped + failed > 0 ? "partial" : "success";
  const message =
    status === "success"
      ? `Imported ${imported} slab record(s).`
      : `Imported ${imported}, skipped ${skipped} duplicate(s), ${failed} row(s) could not be read.`;

  const historyReady = await finishLog({
    status, totalRows: parsed.totalRows, imported, skipped, failed, message,
  });

  return NextResponse.json({
    status,
    totalRows: parsed.totalRows,
    imported,
    skipped,
    failed,
    message,
    historyReady,
    issues: parsed.issues.slice(0, 8).map(i => `Row ${i.rowNumber}: ${i.message}`),
  });
}
