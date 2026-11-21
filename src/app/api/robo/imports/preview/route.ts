import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseRegister } from "@/lib/robo/importRegister";
import { planRegisterImport, skipMessage } from "@/lib/robo/registerImport";
import { recordedSlabNumbers } from "@/lib/robo/registerImportDb";
import { roboGate } from "@/lib/rbac";
import { fillRowsFromPlant } from "@/lib/robo/importPlantRead";
import { countFilled } from "@/lib/robo/importPlantFill";

/** POST /api/robo/imports/preview — parse and validate a register without writing anything. */
export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No workbook uploaded." }, { status: 400 });
  }
  // Same size and name checks as the import itself (see imports/route.ts for
  // why): the preview parses the whole workbook in memory too.
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 413 });
  }
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name ?? "")) {
    return NextResponse.json({ error: "Only an Excel workbook (.xlsx / .xls) is accepted here." }, { status: 415 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseRegister(buf);

  if (parsed.fatal) {
    return NextResponse.json({
      fileName: file.name,
      fatal: parsed.fatal,
      sheetName: parsed.sheetName,
      detectedColumns: parsed.detectedColumns,
      totalRows: 0, willImport: 0, willSkip: 0, failed: 0,
      issues: [], sample: [],
    });
  }

  // Which rows the import would skip — the same rule, read the same way, as
  // the import applies (lib/robo/registerImport.ts, ROBO-2): a slab number
  // already recorded anywhere, or one listed earlier in this file. It used to
  // match on slab number AND the row's date, so the module's own download
  // previewed slabs it would duplicate as "will import".
  // Blank batch and thickness cells filled from the plant, by slab number: the
  // very call the import makes (lib/robo/importPlantRead), so what is shown here
  // is what is imported. Where the plant says nothing the rows are the file's own.
  const fill = await fillRowsFromPlant(parsed.rows);
  const rows = fill.rows;
  const recorded = await recordedSlabNumbers(prisma, rows.map(r => r.slabNumber));
  const plan = planRegisterImport(rows, recorded);
  const filledCounts = countFilled(fill.filled, plan.toImport);
  const willImport = plan.toImport.length;
  const willSkip = plan.skipped.length;
  const duplicates = plan.skipped.slice(0, 10).map(skipMessage);

  return NextResponse.json({
    fileName: file.name,
    fatal: null,
    sheetName: parsed.sheetName,
    detectedColumns: parsed.detectedColumns,
    hasSetupSheet: Object.keys(parsed.setups).length > 0,
    totalRows: parsed.totalRows,
    willImport,
    willSkip,
    failed: parsed.issues.length,
    issues: [...parsed.issues.slice(0, 10).map(i => `Row ${i.rowNumber}: ${i.message}`), ...duplicates].slice(0, 12),
    plantFill: { batches: filledCounts.batches, thicknesses: filledCounts.thicknesses, capped: fill.capped, asked: fill.asked },
    sample: rows.slice(0, 5).map(r => ({
      date: r.date, shiftNumber: r.shiftNumber, slabNumber: r.slabNumber,
      designName: r.designName || "-", batchNo: r.batchNo || "-", inTime: r.inTime || "-", outTime: r.outTime || "-",
      thickness: r.thickness,
      filledBatch: fill.filled.get(r.rowNumber)?.batch === true,
      filledThickness: fill.filled.get(r.rowNumber)?.thickness === true,
    })),
  });
}
