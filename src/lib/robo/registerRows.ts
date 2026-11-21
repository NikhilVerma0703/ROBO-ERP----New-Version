/**
 * The Production Records sheet of a register workbook, read into slab rows.
 *
 * Pure, and its only import is the import-free productionShift.ts, so
 * `node --test` can reach it — importRegister itself pulls in xlsx and
 * @/lib/robo/utils and cannot be loaded by the test runner. importRegister
 * opens the workbook, picks the sheet and hands its rows (an array of arrays,
 * the shape XLSX's sheet_to_json gives with `header: 1`) to parseRecordRows,
 * and re-exports what callers need, so they need not know where it lives.
 *
 * This is the code that used to sit inside importRegister.ts, moved as it was
 * so the round trip from our own Complete Production download can be tested
 * end to end (tests/roboRegisterImport.test.ts). What the code review of
 * 20 Oct 2026 changed in it is marked where it happens:
 *   ROBO-4  the Batch No. column is read, and the download's "BATCH" lines
 *           that open each batch are skipped like its "TOTAL" lines;
 *   ROBO-7  a cell the database would refuse fails its own row here, so one
 *           bad row can no longer stop the whole import (it now writes in one
 *           transaction — see api/robo/imports).
 */
import { SHIFT_CODES, parseShiftCode } from "./productionShift.ts";
import { stripTrialSuffix } from "./trial.ts";

/* ── Header matching ──────────────────────────────────────────
   Headers are normalised to lowercase alphanumerics, so
   "RoyMix Body Weight (kg)" and "Roymix body weight kg" both match. */
export function norm(h: unknown): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const RECORD_ALIASES: Record<string, string[]> = {
  serialNumber: ["sno", "sn", "serial", "serialno", "serialnumber", "srno"],
  date:         ["productiondate", "date", "proddate", "shiftdate"],
  shiftNumber:  ["shift", "shiftno", "shiftnumber"],
  operatorName: ["operator", "operatorname"],
  designName:   ["designname", "design"],
  thickness:    ["thicknesscm", "thickness", "slabthicknesscm"],
  // ROBO-4. The plant's own number for the run. Our download writes "Batch
  // No." on every slab line, and a paper register with a batch column heads it
  // much the same way. Without it every imported slab landed on a setup with
  // no batch number, so it never matched the Batch Number filter that Reports
  // (which opens on the latest batch), the hourly chart, QC rejections,
  // Downloads and the Reference Sheet all use — and two batches of one design
  // on one date were merged into one setup.
  batchNo:      ["batchno", "batchnumber", "batch"],
  slabNumber:   ["slabnumber", "slabno", "slab"],
  inTime:       ["intime", "in"],
  outTime:      ["outtime", "out"],
  // "robo2*" first: after the Robo1..Robo4 rename a freshly written register
  // headers these columns by the name the operator now sees, and the old
  // "roymix*" spellings still arrive from every workbook made before it. Both
  // have to match, or the body weight and cycle time import as blank.
  bodyWeight:   ["robo2bodyweightkg", "roymixbodyweightkg", "bodyweightkg", "bodyweight"],
  cycleTime:    ["robo2cycletimesec", "roymixcycletimesec", "cycletimesec", "roymixcycletime"],
  status:       ["status"],
  remarks:      ["remarks", "remark", "note", "notes"],
};

/** Maps our field names to the column index each one was found at. */
export function mapColumns(header: unknown[], aliases: Record<string, string[]>) {
  const normalised = header.map(norm);
  const index: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases)) {
    const at = normalised.findIndex(h => h && names.includes(h));
    if (at >= 0) index[field] = at;
  }
  return index;
}

/* ── Cell coercion ───────────────────────────────────────────── */
function pad(n: number) { return String(n).padStart(2, "0"); }

function excelSerialToDate(serial: number): Date {
  // Excel epoch 1899-12-30, in whole days
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

/** Any reasonable date cell → "YYYY-MM-DD", or null. */
export function parseDateCell(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === "number" && isFinite(v)) {
    const d = excelSerialToDate(v);
    if (!isNaN(d.getTime())) return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return null;
  }
  const s = String(v).trim();
  if (!s || s === "-") return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  // DD/MM/YYYY (the format this module displays and exports)
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return null;
}

/** Any reasonable time cell → "HH:MM", or null. */
export function parseTimeCell(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === "number" && isFinite(v)) {
    const frac = v - Math.floor(v);
    const mins = Math.round(frac * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const s = String(v).trim();
  if (!s || s === "-") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

export function parseNumberCell(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}

/** The largest value a Postgres `integer` column holds — S.No., the Robo2
 *  cycle time and a setup's target cycle time are all Prisma `Int`. */
const INT_COLUMN_MAX = 2147483647;

/**
 * Can this number go into an `Int` column as it is? A whole number inside the
 * column's range. ROBO-7: the import writes every slab of a register in one
 * transaction now, so a value the database refuses — an S.No. of 12.5, a
 * cycle time of 45.5 s — would roll back the whole file rather than fail its
 * one row as it used to. Such a row is reported as unreadable here instead,
 * with the reason, and the rest of the file goes in.
 */
export function fitsIntColumn(n: number): boolean {
  return Number.isInteger(n) && Math.abs(n) <= INT_COLUMN_MAX;
}

export function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  // A NUL character is the one thing Postgres refuses in a text column. It
  // has no meaning in a register cell, so it is dropped rather than allowed to
  // fail the whole import (see fitsIntColumn).
  const s = String(v).replace(/\u0000/g, "").trim();
  return s === "-" ? "" : s;
}

/**
 * Lines our own Complete Production download writes that are not slabs:
 *  • the "Total" / "TOTAL" line that closes a batch or the sheet, in the Slab
 *    No. column;
 *  • ROBO-4: the "BATCH" line that opens each batch when the download is
 *    grouped by batch (productionGrouping.ts), in the S.No. column. It names
 *    the batch and design but carries no slab number, so every one of them
 *    used to be reported as a failed "Slab Number is empty" row and turned a
 *    clean re-import into a "partial" one.
 * Neither is counted as a row of the register.
 */
export function isSectionRow(serialCell: string, slabCell: string): boolean {
  return slabCell.toUpperCase() === "TOTAL" || serialCell.toUpperCase() === "BATCH";
}

/* ── Result shapes ───────────────────────────────────────────── */
export interface ParsedRow {
  rowNumber: number;
  serialNumber: number | null;
  date: string;
  shiftNumber: number;
  /** The slab's own shift, "A" / "B" / "C", from the same Shift cell: the
   *  register writes letters and our own export now does too, while an older
   *  sheet writes 1/2/3. Null when the cell says neither. Separate from
   *  shiftNumber above, which only picks the RoboShift row to hang the slab
   *  on — see productionShift.ts. */
  shiftCode: string | null;
  operatorName: string;
  designName: string;
  /** ROBO-4: the Batch No. as the sheet wrote it, trimmed; "" when the sheet
   *  has no batch column or the cell is blank or "-". Stored on the setup the
   *  import creates, and part of how a slab finds its setup (registerImport.ts). */
  batchNo: string;
  thickness: number | null;
  slabNumber: string;
  inTime: string | null;
  outTime: string | null;
  bodyWeight: number | null;
  cycleTime: number | null;
  status: string;
  remarks: string | null;
}
export interface RowIssue { rowNumber: number; message: string }

export const REQUIRED_RECORD_COLUMNS = ["date", "slabNumber"];

export interface RecordRows {
  detectedColumns: string[];
  missingColumns: string[];
  totalRows: number;
  rows: ParsedRow[];
  issues: RowIssue[];
}

/**
 * The slab rows of a Production Records sheet: `aoa[0]` is the header, every
 * later entry a row. Never throws. When a required column is missing it says
 * which in `missingColumns` and reads no rows; the caller turns that into the
 * fatal message.
 */
export function parseRecordRows(aoa: readonly unknown[][]): RecordRows {
  const header = aoa[0] ?? [];
  const col = mapColumns(header, RECORD_ALIASES);
  const detectedColumns = Object.keys(col);
  const missingColumns = REQUIRED_RECORD_COLUMNS.filter(f => !(f in col));
  if (missingColumns.length > 0) {
    return { detectedColumns, missingColumns, totalRows: 0, rows: [], issues: [] };
  }

  const at = (row: unknown[], field: string): unknown =>
    field in col ? row[col[field]] : null;

  const rows: ParsedRow[] = [];
  const issues: RowIssue[] = [];
  let totalRows = 0;

  for (let i = 1; i < aoa.length; i++) {
    const raw = aoa[i] ?? [];
    const rowNumber = i + 1;

    // Blank spacer rows, and the exported TOTAL and BATCH lines, are not data
    const nonEmpty = raw.some(c => c !== null && c !== undefined && String(c).trim() !== "");
    if (!nonEmpty) continue;
    const slabNumber = text(at(raw, "slabNumber"));
    if (isSectionRow(text(at(raw, "serialNumber")), slabNumber)) continue;

    totalRows++;

    const date = parseDateCell(at(raw, "date"));
    if (!slabNumber) { issues.push({ rowNumber, message: "Slab Number is empty" }); continue; }
    if (!date) { issues.push({ rowNumber, message: "Production Date is missing or unreadable" }); continue; }

    // ROBO-7: what an Int column would refuse fails this row, not the import.
    const serialNumber = parseNumberCell(at(raw, "serialNumber"));
    if (serialNumber !== null && !fitsIntColumn(serialNumber)) {
      issues.push({ rowNumber, message: `S.No. ${serialNumber} is not a whole number` });
      continue;
    }
    const cycleTime = parseNumberCell(at(raw, "cycleTime"));
    if (cycleTime !== null && !fitsIntColumn(cycleTime)) {
      issues.push({ rowNumber, message: `Robo2 Cycle Time ${cycleTime} is not a whole number of seconds` });
      continue;
    }

    // One cell, read twice: as the 1/2/3 that picks the shift ROW (unchanged),
    // and as the A/B/C that goes on the slab. A numeric sheet gives both, a
    // lettered one gives both, and a blank or unreadable one gives row 1 and no
    // slab shift — which then reads off the In Time like any other old slab.
    const shiftRaw = parseNumberCell(at(raw, "shiftNumber"));
    const shiftCode = parseShiftCode(at(raw, "shiftNumber"));
    const shiftNumber =
      shiftRaw && shiftRaw >= 1 && shiftRaw <= 3 ? Math.trunc(shiftRaw)
      : shiftCode ? SHIFT_CODES.indexOf(shiftCode as never) + 1
      : 1;

    const statusText = text(at(raw, "status")).toLowerCase().replace(/[^a-z]/g, "");
    const outTime = parseTimeCell(at(raw, "outTime"));
    const status =
      statusText.startsWith("inprocess") ? "IN_PROCESSING"
      : statusText.startsWith("complet") ? "COMPLETED"
      : outTime ? "COMPLETED" : "IN_PROCESSING";

    rows.push({
      rowNumber,
      serialNumber,
      date,
      shiftNumber,
      shiftCode,
      operatorName: text(at(raw, "operatorName")),
      designName: text(at(raw, "designName")),
      // CR-003: the downloads label a trial slab "D-1506 (Trial Slab)"; the
      // batch it belongs to is D-1506.
      batchNo: stripTrialSuffix(text(at(raw, "batchNo"))),
      thickness: parseNumberCell(at(raw, "thickness")),
      slabNumber,
      inTime: parseTimeCell(at(raw, "inTime")),
      outTime,
      bodyWeight: parseNumberCell(at(raw, "bodyWeight")),
      cycleTime,
      status,
      remarks: text(at(raw, "remarks")) || null,
    });
  }

  return { detectedColumns, missingColumns: [], totalRows, rows, issues };
}
