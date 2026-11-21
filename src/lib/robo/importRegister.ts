import * as XLSX from "xlsx";
import { canonicalMachineName } from "@/lib/robo/utils";
import { sheetShapeGuard } from "../sheetShape.ts";
import {
  norm, mapColumns, parseDateCell, parseNumberCell, fitsIntColumn, text, parseRecordRows,
  type ParsedRow, type RowIssue,
} from "./registerRows.ts";

/* The Production Records sheet — its header aliases, cell coercion and the row
   loop — lives in registerRows.ts, which is pure, so the round trip from our
   own download can be tested; see that file. What stays here is opening the
   workbook, choosing the sheets, and the optional Production Setup sheet,
   which needs canonicalMachineName from @/lib/robo/utils. */
export { parseDateCell, parseTimeCell } from "./registerRows.ts";
export type { ParsedRow, RowIssue } from "./registerRows.ts";

const SETUP_ALIASES: Record<string, string[]> = {
  date:            ["productiondate", "date"],
  shiftNumber:     ["shift", "shiftno", "shiftnumber"],
  designName:      ["designname", "design"],
  machine:         ["machine", "machinename"],
  programName:     ["programname", "program"],
  toolName:        ["toolname", "tool"],
  targetCycleTime: ["targetcycletimesec", "targetcycletime"],
  liquidName:      ["liquidname", "liquid"],
  powderName:      ["powdername", "powder"],
  rollerHeight:    ["rollerheightmm", "rollerheight"],
  // CR-001: the run's Target Slabs, which the download writes on every setup row.
  targetSlabs:     ["targetslabs"],
};

/* ── Result shapes ───────────────────────────────────────────── */
export interface ParsedSetupEntry {
  machineName: string;
  programName: string | null;
  toolName: string | null;
  targetCycleTime: number | null;
  liquidName: string | null;
  powderName: string | null;
  rollerHeight: string | null;
  /** The run's Target Slabs from the same row (CR-001); null when not given. */
  targetSlabs: number | null;
}
export interface ParseResult {
  sheetName: string;
  detectedColumns: string[];
  missingColumns: string[];
  totalRows: number;
  rows: ParsedRow[];
  issues: RowIssue[];
  setups: Record<string, ParsedSetupEntry[]>;
  fatal: string | null;
}

import { setupKey, setupShiftOf } from "./registerSetups.ts";
export { setupKey, soleSetupDesign, setupEntriesFor, setupTargetSlabs } from "./registerSetups.ts";

/** Parses a Complete Production style workbook. Never throws — fatal errors come back on the result. */
export function parseRegister(buf: Buffer): ParseResult {
  const empty: ParseResult = {
    sheetName: "", detectedColumns: [], missingColumns: [], totalRows: 0,
    rows: [], issues: [], setups: {}, fatal: null,
  };

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  } catch {
    return { ...empty, fatal: "The file could not be read as an .xlsx workbook." };
  }
  if (!wb.SheetNames.length) return { ...empty, fatal: "The workbook has no sheets." };

  const recordSheetName =
    wb.SheetNames.find(n => norm(n) === "productionrecords") ?? wb.SheetNames[0];
  const ws = wb.Sheets[recordSheetName];
  // Code review 27 Oct 2026 (E2E-82): sheet_to_json builds one entry per cell
  // of the declared range, so a few-KB file claiming A1:XFD4000 ran the
  // function out of memory. Measure the range first (lib/sheetShape.ts).
  const tooBig = sheetShapeGuard(ws);
  if (tooBig) return { ...empty, sheetName: recordSheetName, fatal: tooBig };
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  if (aoa.length < 2) return { ...empty, sheetName: recordSheetName, fatal: "The sheet has no data rows." };

  const records = parseRecordRows(aoa);
  if (records.missingColumns.length > 0) {
    return {
      ...empty,
      sheetName: recordSheetName,
      detectedColumns: records.detectedColumns,
      missingColumns: records.missingColumns,
      fatal: `Required column(s) not found: ${records.missingColumns.join(", ")}. Expected a "Complete Production" style sheet.`,
    };
  }

  /* Optional second sheet — rebuilds machine configuration on import */
  const setups: Record<string, ParsedSetupEntry[]> = {};
  const setupSheetName = wb.SheetNames.find(n => norm(n) === "productionsetup");
  if (setupSheetName) {
    const setupTooBig = sheetShapeGuard(wb.Sheets[setupSheetName]);
    if (setupTooBig) return { ...empty, sheetName: recordSheetName, fatal: `The Production Setup sheet: ${setupTooBig}` };
    const sAoa = XLSX.utils.sheet_to_json(wb.Sheets[setupSheetName], { header: 1, defval: null }) as unknown[][];
    if (sAoa.length >= 2) {
      const sCol = mapColumns(sAoa[0] ?? [], SETUP_ALIASES);
      const sAt = (row: unknown[], field: string): unknown => (field in sCol ? row[sCol[field]] : null);
      for (let i = 1; i < sAoa.length; i++) {
        const raw = sAoa[i] ?? [];
        // Fold "Robo2" back to the stored "Roymix" before it is handed on. The
        // consumer looks this up in a map keyed by stored name and DROPS what
        // it cannot find, so an un-canonicalised display name loses the row in
        // silence. See canonicalMachineName.
        const machineName = canonicalMachineName(text(sAt(raw, "machine")));
        const date = parseDateCell(sAt(raw, "date"));
        if (!machineName || !date) continue;
        // CR-001: with no Shift column the row applies to every shift of its
        // date (ANY_SHIFT); with one, it is read exactly as before.
        const shiftNumber = setupShiftOf("shiftNumber" in sCol, parseNumberCell(sAt(raw, "shiftNumber")));
        const key = setupKey(date, shiftNumber, text(sAt(raw, "designName")));
        const targetSlabs = parseNumberCell(sAt(raw, "targetSlabs"));
        // A target that is not whole seconds is read as blank, the way an
        // unreadable cell already is. The column is an Int, and the import now
        // writes in one transaction (ROBO-7), so a 45.5 here would otherwise
        // roll back the whole register instead of failing that setup's slabs.
        const target = parseNumberCell(sAt(raw, "targetCycleTime"));
        (setups[key] ||= []).push({
          machineName,
          programName: text(sAt(raw, "programName")) || null,
          toolName: text(sAt(raw, "toolName")) || null,
          targetCycleTime: target !== null && fitsIntColumn(target) ? target : null,
          liquidName: text(sAt(raw, "liquidName")) || null,
          powderName: text(sAt(raw, "powderName")) || null,
          rollerHeight: text(sAt(raw, "rollerHeight")) || null,
          targetSlabs: targetSlabs !== null && Number.isInteger(targetSlabs) && fitsIntColumn(targetSlabs) ? targetSlabs : null,
        });
      }
    }
  }

  return {
    sheetName: recordSheetName,
    detectedColumns: records.detectedColumns,
    missingColumns: [],
    totalRows: records.totalRows,
    rows: records.rows,
    issues: records.issues,
    setups,
    fatal: null,
  };
}
