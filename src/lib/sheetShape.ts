// HOW BIG A SPREADSHEET'S DECLARED RANGE MAY BE BEFORE IT IS TURNED INTO ROWS.
//
// Code review 27 Oct 2026 (E2E-78 / E2E-82): SheetJS's sheet_to_json builds one
// entry per cell of the sheet's declared range (`!ref`), not per cell that
// holds something. A workbook of a few KB whose range says A1:XFD4000 (or one
// stray cell far to the right, or a 16,000-column CSV header) is 65 million
// entries — gigabytes — and the function dies out of memory before a single row
// is looked at, past every try/catch. The store uploads cap the bytes, the
// inflated size and the rows read, but nothing capped the width; the Robo and
// Chromia register imports capped nothing but the file size.
//
// So the range is measured first, from the text of `!ref` alone, and a sheet
// whose rows x columns are past the budget is refused with a sentence. The
// budget is rows x columns, not columns alone: a narrow sheet may be long and
// a short sheet may be wide, and only the product costs memory. 5,000,000 cells
// is about 250 MB of rows. The largest real file is a register of a few
// thousand rows by 25 columns, or a store sheet of 5,000 rows by 30 (150,000
// cells), so the limit sits more than thirty times above either.
//
// Review fixes (27 Oct 2026):
//  - FAILS CLOSED. SheetJS keeps whatever `<dimension ref>` says, however many
//    letters or digits (A1:ZZZZ2000, A1:B99999999), so the reader accepts any
//    column letters and any row digits, and a range it cannot read at all is
//    refused, not waved through.
//  - A DECLARED RANGE IS NOT THE REAL EXTENT. A register whose used range runs
//    to row 1,048,576 because whole rows were formatted is a few thousand real
//    rows and imports today. So when the declared range is over budget the
//    extent is recomputed from the sheet's own cell keys (bounded by the cells
//    really in the file); only a sheet still over budget is refused, otherwise
//    `!ref` is narrowed to the real extent and the read goes ahead as before.
//
// PURE AND IMPORT-FREE (no SheetJS), so `node --test` holds it
// (tests/sheetShape.test.ts); callers pass `sheet["!ref"]`, or the sheet itself
// to sheetShapeGuard.

/** Cells (rows x columns of the declared range) one sheet may have. */
export const MAX_SHEET_CELLS = 5_000_000;

/** "XFD" -> 16384 (1-based); any number of letters. NaN for anything else. */
function columnNumber(letters: string): number {
  if (!/^[A-Za-z]+$/.test(letters)) return NaN;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const RANGE = /^\$?([A-Za-z]+)\$?(\d+)(?::\$?([A-Za-z]+)\$?(\d+))?$/;

/** A range's corners, 1-based, in the order written. Null when it cannot be read. */
function rangeCorners(ref: string): { c1: number; r1: number; c2: number; r2: number } | null {
  const m = RANGE.exec(ref.trim());
  if (!m) return null;
  const c1 = columnNumber(m[1]);
  const r1 = Number(m[2]);
  const c2 = m[3] ? columnNumber(m[3]) : c1;
  const r2 = m[4] ? Number(m[4]) : r1;
  if (Number.isNaN(c1) || Number.isNaN(c2) || Number.isNaN(r1) || Number.isNaN(r2)) return null;
  return { c1, r1, c2, r2 };
}

/**
 * Rows and columns a range such as "A1:XFD4000" (or a single cell, "B2") spans.
 * Null when the text is not a range. The numbers may be Infinity (a range of
 * thousands of digits); that is "too big", never "unreadable".
 */
export function rangeSize(ref: string): { rows: number; columns: number } | null {
  const c = rangeCorners(ref);
  if (!c) return null;
  return { rows: Math.abs(c.r2 - c.r1) + 1, columns: Math.abs(c.c2 - c.c1) + 1 };
}

function overBudget(rows: number, columns: number): boolean {
  const cells = rows * columns;
  return !Number.isFinite(cells) || cells > MAX_SHEET_CELLS;
}

function bigMessage(rows: number, columns: number): string {
  const say = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US") : "an impossible number of");
  return `The sheet claims to be ${say(rows)} rows by ${say(columns)} columns, far larger than any real register or store sheet, and is too big to read safely. Delete the unused columns and rows (or copy just the data onto a new sheet), save, and upload it again.`;
}

/**
 * The plain sentence to refuse a sheet with, or null when its range is a size
 * a real file has. A sheet with no range (an empty one) is left to the reader,
 * exactly as before; a range that is written but cannot be read is refused.
 */
export function sheetShapeRefusal(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const size = rangeSize(ref);
  if (!size) return "The sheet's size could not be read, so it is too big to read safely. Copy just the data onto a new sheet, save, and upload it again.";
  if (!overBudget(size.rows, size.columns)) return null;
  return bigMessage(size.rows, size.columns);
}

/** A column number (1-based) back to letters. */
function columnLetters(n: number): string {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

/**
 * The guard the readers call, with the sheet itself. Within budget (or no
 * range) it changes nothing. Over budget by its declared range, the real
 * extent is taken from the sheet's own cell keys (those inside the declared
 * range, which is all sheet_to_json reads): refused if that is over budget
 * too, otherwise `!ref` is narrowed to it, keeping the declared start corner,
 * and the read goes on exactly as it would have with a tight range.
 * Returns the sentence to refuse with, or null.
 */
export function sheetShapeGuard(ws: Record<string, unknown> | null | undefined): string | null {
  if (!ws) return null;
  const ref = ws["!ref"];
  if (typeof ref !== "string" || !ref) return null;
  const refusal = sheetShapeRefusal(ref);
  if (!refusal) return null;
  const corners = rangeCorners(ref);
  if (!corners) return refusal; // unreadable: nothing to measure against
  const top = Math.min(corners.r1, corners.r2), left = Math.min(corners.c1, corners.c2);
  const bottom = Math.max(corners.r1, corners.r2), right = Math.max(corners.c1, corners.c2);
  let maxRow = 0, maxCol = 0;
  for (const key of Object.keys(ws)) {
    if (key.charCodeAt(0) === 33) continue; // "!ref", "!merges", ...
    const m = /^([A-Z]+)(\d+)$/.exec(key);
    if (!m) continue;
    const col = columnNumber(m[1]), row = Number(m[2]);
    if (!(row >= top && row <= bottom && col >= left && col <= right)) continue;
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  if (maxRow === 0) {
    // No cell at all: nothing to read. Leave it to the reader as an empty sheet.
    delete ws["!ref"];
    return null;
  }
  if (overBudget(maxRow - top + 1, maxCol - left + 1)) return bigMessage(maxRow - top + 1, maxCol - left + 1);
  ws["!ref"] = `${columnLetters(left)}${top}:${columnLetters(maxCol)}${maxRow}`;
  return null;
}
